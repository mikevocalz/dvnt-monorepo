/**
 * Rain Layer — GPU particle rain with wind drift and motion blur
 *
 * Uses a compute shader for particle simulation and a render pipeline
 * for drawing stretched line particles. All buffers pre-allocated.
 */
import { GpuRuntime } from "@/src/gpu/GpuRuntime";
import type { LayerUniforms } from "../weatherTypes";

// ── Constants ───────────────────────────────────────────────────────
const MAX_PARTICLES = 800;
const PARTICLE_STRIDE = 16; // x, y, vy, alpha (4 × f32)
const PARTICLE_BUFFER_SIZE = MAX_PARTICLES * PARTICLE_STRIDE;
const UNIFORM_SIZE = 48; // 12 × f32 padded to 48 bytes

// ── WGSL: Compute shader — particle simulation ─────────────────────
const COMPUTE_SHADER = /* wgsl */ `
struct Uniforms {
  time: f32,
  dt: f32,
  resX: f32,
  resY: f32,
  opacity: f32,
  windX: f32,
  windY: f32,
  intensity: f32,
  speed: f32,
  count: f32,
  _pad0: f32,
  _pad1: f32,
};

struct Particle {
  x: f32,
  y: f32,
  vy: f32,
  alpha: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;

// Simple hash for pseudo-random
fn hash(p: f32) -> f32 {
  var s = fract(p * 0.1031);
  s = s * (s + 33.33);
  s = s * (s + s);
  return fract(s);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= u32(u.count)) { return; }

  var p = particles[idx];

  // Gravity + wind
  let gravity = 800.0 * u.speed;
  let windDrift = u.windX * 200.0;

  p.y = p.y + (p.vy + gravity) * u.dt;
  p.x = p.x + windDrift * u.dt;

  // Wrap around screen
  if (p.y > u.resY + 20.0) {
    p.y = -20.0;
    p.x = hash(f32(idx) + u.time * 7.3) * u.resX;
    p.vy = 100.0 + hash(f32(idx) * 3.7 + u.time) * 200.0;
    p.alpha = 0.3 + hash(f32(idx) * 5.1) * 0.7;
  }
  if (p.x > u.resX + 10.0) { p.x = -10.0; }
  if (p.x < -10.0) { p.x = u.resX + 10.0; }

  particles[idx] = p;
}
`;

// ── WGSL: Render shader — draw rain streaks ─────────────────────────
const RENDER_SHADER = /* wgsl */ `
struct Uniforms {
  time: f32,
  dt: f32,
  resX: f32,
  resY: f32,
  opacity: f32,
  windX: f32,
  windY: f32,
  intensity: f32,
  speed: f32,
  count: f32,
  _pad0: f32,
  _pad1: f32,
};

struct Particle {
  x: f32,
  y: f32,
  vy: f32,
  alpha: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) alpha: f32,
};

@vertex
fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VSOut {
  let p = particles[iid];

  // Each rain drop is a vertical line (2 vertices: top and bottom)
  let streakLen = 8.0 + p.vy * 0.02;
  let yOff = select(0.0, -streakLen, vid == 0u);

  // NDC
  let nx = (p.x / u.resX) * 2.0 - 1.0;
  let ny = 1.0 - ((p.y + yOff) / u.resY) * 2.0;

  var out: VSOut;
  out.pos = vec4f(nx, ny, 0.0, 1.0);
  out.alpha = p.alpha * u.opacity * select(0.3, 1.0, vid == 1u);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  // Brand color: #8A40CF → rgb(0.541, 0.251, 0.812)
  return vec4f(0.541, 0.251, 0.812, in.alpha);
}
`;

// ── Layer state ─────────────────────────────────────────────────────
let _initialized = false;
let _computePipeline: GPUComputePipeline | null = null;
let _renderPipeline: GPURenderPipeline | null = null;
let _uniformBuffer: GPUBuffer | null = null;
let _particleBuffer: GPUBuffer | null = null;
let _computeBindGroup: GPUBindGroup | null = null;
let _renderBindGroup: GPUBindGroup | null = null;

// Pre-allocated typed array for uniform updates (zero GC)
const _uniformData = new Float32Array(12);

export const RainLayer = {
  async init(format: GPUTextureFormat): Promise<boolean> {
    if (_initialized) return true;
    const device = GpuRuntime.getDevice();
    if (!device) return false;

    try {
      // Buffers
      _uniformBuffer = device.createBuffer({
        label: "rain-uniforms",
        size: UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      _particleBuffer = device.createBuffer({
        label: "rain-particles",
        size: PARTICLE_BUFFER_SIZE,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });

      // Init particles with random positions
      const initData = new Float32Array(MAX_PARTICLES * 4);
      for (let i = 0; i < MAX_PARTICLES; i++) {
        const off = i * 4;
        initData[off + 0] = Math.random(); // x (0–1, scaled in shader)
        initData[off + 1] = Math.random(); // y (0–1)
        initData[off + 2] = 100 + Math.random() * 200; // vy
        initData[off + 3] = 0.3 + Math.random() * 0.7; // alpha
      }
      device.queue.writeBuffer(_particleBuffer, 0, initData);

      // Compute pipeline
      const computeModule = device.createShaderModule({
        label: "rain-compute",
        code: COMPUTE_SHADER,
      });

      const computeBGL = device.createBindGroupLayout({
        label: "rain-compute-bgl",
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "uniform" },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "storage" },
          },
        ],
      });

      _computePipeline = device.createComputePipeline({
        label: "rain-compute-pipeline",
        layout: device.createPipelineLayout({
          bindGroupLayouts: [computeBGL],
        }),
        compute: { module: computeModule, entryPoint: "main" },
      });

      _computeBindGroup = device.createBindGroup({
        label: "rain-compute-bg",
        layout: computeBGL,
        entries: [
          { binding: 0, resource: { buffer: _uniformBuffer } },
          { binding: 1, resource: { buffer: _particleBuffer } },
        ],
      });

      // Render pipeline
      const renderModule = device.createShaderModule({
        label: "rain-render",
        code: RENDER_SHADER,
      });

      const renderBGL = device.createBindGroupLayout({
        label: "rain-render-bgl",
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: "uniform" },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.VERTEX,
            buffer: { type: "read-only-storage" },
          },
        ],
      });

      _renderPipeline = device.createRenderPipeline({
        label: "rain-render-pipeline",
        layout: device.createPipelineLayout({
          bindGroupLayouts: [renderBGL],
        }),
        vertex: { module: renderModule, entryPoint: "vs" },
        fragment: {
          module: renderModule,
          entryPoint: "fs",
          targets: [
            {
              format,
              blend: {
                color: {
                  srcFactor: "src-alpha",
                  dstFactor: "one-minus-src-alpha",
                  operation: "add",
                },
                alpha: {
                  srcFactor: "one",
                  dstFactor: "one-minus-src-alpha",
                  operation: "add",
                },
              },
            },
          ],
        },
        primitive: { topology: "line-list" },
      });

      _renderBindGroup = device.createBindGroup({
        label: "rain-render-bg",
        layout: renderBGL,
        entries: [
          { binding: 0, resource: { buffer: _uniformBuffer } },
          { binding: 1, resource: { buffer: _particleBuffer } },
        ],
      });

      _initialized = true;
      return true;
    } catch (err) {
      console.error("[RainLayer] init failed:", err);
      return false;
    }
  },

  /** Update uniforms + run compute pass. No allocations. */
  update(
    encoder: GPUCommandEncoder,
    uniforms: LayerUniforms,
    particleCount: number,
  ): void {
    if (
      !_initialized ||
      !_uniformBuffer ||
      !_computePipeline ||
      !_computeBindGroup
    )
      return;
    const device = GpuRuntime.getDevice();
    if (!device) return;

    const count = Math.min(particleCount, MAX_PARTICLES);

    // Write uniforms (reuse pre-allocated array)
    _uniformData[0] = uniforms.time;
    _uniformData[1] = uniforms.dt;
    _uniformData[2] = uniforms.resolution[0];
    _uniformData[3] = uniforms.resolution[1];
    _uniformData[4] = uniforms.opacity;
    _uniformData[5] = uniforms.windX;
    _uniformData[6] = uniforms.windY;
    _uniformData[7] = uniforms.intensity;
    _uniformData[8] = uniforms.speed;
    _uniformData[9] = count;
    _uniformData[10] = 0;
    _uniformData[11] = 0;
    device.queue.writeBuffer(_uniformBuffer, 0, _uniformData);

    // Compute pass
    const pass = encoder.beginComputePass({ label: "rain-compute" });
    pass.setPipeline(_computePipeline);
    pass.setBindGroup(0, _computeBindGroup);
    pass.dispatchWorkgroups(Math.ceil(count / 64));
    pass.end();
  },

  /** Draw rain particles into render pass. */
  render(pass: GPURenderPassEncoder, particleCount: number): void {
    if (!_initialized || !_renderPipeline || !_renderBindGroup) return;
    const count = Math.min(particleCount, MAX_PARTICLES);
    if (count <= 0) return;

    pass.setPipeline(_renderPipeline);
    pass.setBindGroup(0, _renderBindGroup);
    pass.draw(2, count); // 2 vertices per line, instanced
  },

  dispose(): void {
    _uniformBuffer?.destroy();
    _particleBuffer?.destroy();
    _uniformBuffer = null;
    _particleBuffer = null;
    _computePipeline = null;
    _renderPipeline = null;
    _computeBindGroup = null;
    _renderBindGroup = null;
    _initialized = false;
  },
};
