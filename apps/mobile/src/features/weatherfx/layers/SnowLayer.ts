/**
 * Snow Layer — GPU particle snow with sine-wave drift
 *
 * Slower fall speed, larger particles, horizontal wobble.
 * Compute shader simulates, render shader draws soft point sprites.
 */
import { GpuRuntime } from "@/src/gpu/GpuRuntime";
import type { LayerUniforms } from "../weatherTypes";

const MAX_PARTICLES = 400;
const PARTICLE_STRIDE = 20; // x, y, vy, alpha, phase (5 × f32)
const PARTICLE_BUFFER_SIZE = MAX_PARTICLES * PARTICLE_STRIDE;
const UNIFORM_SIZE = 48;

const COMPUTE_SHADER = /* wgsl */ `
struct Uniforms {
  time: f32, dt: f32, resX: f32, resY: f32,
  opacity: f32, windX: f32, windY: f32, intensity: f32,
  speed: f32, count: f32, _p0: f32, _p1: f32,
};
struct Particle { x: f32, y: f32, vy: f32, alpha: f32, phase: f32, };

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;

fn hash(p: f32) -> f32 {
  var s = fract(p * 0.1031);
  s *= (s + 33.33); s *= (s + s);
  return fract(s);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= u32(u.count)) { return; }
  var p = particles[idx];

  let fallSpeed = (40.0 + p.vy) * u.speed;
  let drift = sin(u.time * 1.5 + p.phase) * 30.0 + u.windX * 60.0;

  p.y += fallSpeed * u.dt;
  p.x += drift * u.dt;

  if (p.y > u.resY + 10.0) {
    p.y = -10.0;
    p.x = hash(f32(idx) + u.time * 3.1) * u.resX;
    p.vy = 20.0 + hash(f32(idx) * 2.7) * 40.0;
    p.alpha = 0.4 + hash(f32(idx) * 4.3) * 0.6;
    p.phase = hash(f32(idx) * 6.1 + u.time) * 6.283;
  }
  if (p.x > u.resX + 10.0) { p.x = -10.0; }
  if (p.x < -10.0) { p.x = u.resX + 10.0; }

  particles[idx] = p;
}
`;

const RENDER_SHADER = /* wgsl */ `
struct Uniforms {
  time: f32, dt: f32, resX: f32, resY: f32,
  opacity: f32, windX: f32, windY: f32, intensity: f32,
  speed: f32, count: f32, _p0: f32, _p1: f32,
};
struct Particle { x: f32, y: f32, vy: f32, alpha: f32, phase: f32, };

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) alpha: f32,
  @location(1) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VSOut {
  let p = particles[iid];
  // Quad: 6 vertices (2 triangles)
  let size = 3.0 + p.alpha * 3.0;
  var corner: vec2f;
  switch (vid) {
    case 0u: { corner = vec2f(-1.0, -1.0); }
    case 1u: { corner = vec2f( 1.0, -1.0); }
    case 2u: { corner = vec2f(-1.0,  1.0); }
    case 3u: { corner = vec2f( 1.0, -1.0); }
    case 4u: { corner = vec2f( 1.0,  1.0); }
    default: { corner = vec2f(-1.0,  1.0); }
  }

  let px = (p.x + corner.x * size) / u.resX * 2.0 - 1.0;
  let py = 1.0 - (p.y + corner.y * size) / u.resY * 2.0;

  var out: VSOut;
  out.pos = vec4f(px, py, 0.0, 1.0);
  out.alpha = p.alpha * u.opacity;
  out.uv = corner * 0.5 + 0.5;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  // Soft circle falloff
  let d = length(in.uv - vec2f(0.5));
  let a = smoothstep(0.5, 0.15, d) * in.alpha;
  // Brand color: #3FDCFF → rgb(0.247, 0.863, 1.0)
  return vec4f(0.247, 0.863, 1.0, a);
}
`;

let _initialized = false;
let _computePipeline: GPUComputePipeline | null = null;
let _renderPipeline: GPURenderPipeline | null = null;
let _uniformBuffer: GPUBuffer | null = null;
let _particleBuffer: GPUBuffer | null = null;
let _computeBG: GPUBindGroup | null = null;
let _renderBG: GPUBindGroup | null = null;
const _uData = new Float32Array(12);

export const SnowLayer = {
  async init(format: GPUTextureFormat): Promise<boolean> {
    if (_initialized) return true;
    const device = GpuRuntime.getDevice();
    if (!device) return false;

    try {
      _uniformBuffer = device.createBuffer({
        label: "snow-u",
        size: UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      _particleBuffer = device.createBuffer({
        label: "snow-p",
        size: PARTICLE_BUFFER_SIZE,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });

      // Init
      const init = new Float32Array(MAX_PARTICLES * 5);
      for (let i = 0; i < MAX_PARTICLES; i++) {
        const o = i * 5;
        init[o] = Math.random();
        init[o + 1] = Math.random();
        init[o + 2] = 20 + Math.random() * 40;
        init[o + 3] = 0.4 + Math.random() * 0.6;
        init[o + 4] = Math.random() * Math.PI * 2;
      }
      device.queue.writeBuffer(_particleBuffer, 0, init);

      // Compute
      const cMod = device.createShaderModule({
        label: "snow-c",
        code: COMPUTE_SHADER,
      });
      const cBGL = device.createBindGroupLayout({
        label: "snow-cbgl",
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
        label: "snow-cp",
        layout: device.createPipelineLayout({ bindGroupLayouts: [cBGL] }),
        compute: { module: cMod, entryPoint: "main" },
      });
      _computeBG = device.createBindGroup({
        label: "snow-cbg",
        layout: cBGL,
        entries: [
          { binding: 0, resource: { buffer: _uniformBuffer } },
          { binding: 1, resource: { buffer: _particleBuffer } },
        ],
      });

      // Render
      const rMod = device.createShaderModule({
        label: "snow-r",
        code: RENDER_SHADER,
      });
      const rBGL = device.createBindGroupLayout({
        label: "snow-rbgl",
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
        label: "snow-rp",
        layout: device.createPipelineLayout({ bindGroupLayouts: [rBGL] }),
        vertex: { module: rMod, entryPoint: "vs" },
        fragment: {
          module: rMod,
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
        primitive: { topology: "triangle-list" },
      });
      _renderBG = device.createBindGroup({
        label: "snow-rbg",
        layout: rBGL,
        entries: [
          { binding: 0, resource: { buffer: _uniformBuffer } },
          { binding: 1, resource: { buffer: _particleBuffer } },
        ],
      });

      _initialized = true;
      return true;
    } catch (err) {
      console.error("[SnowLayer] init failed:", err);
      return false;
    }
  },

  update(
    encoder: GPUCommandEncoder,
    uniforms: LayerUniforms,
    particleCount: number,
  ): void {
    if (!_initialized || !_uniformBuffer || !_computePipeline || !_computeBG)
      return;
    const device = GpuRuntime.getDevice();
    if (!device) return;
    const count = Math.min(particleCount, MAX_PARTICLES);

    _uData[0] = uniforms.time;
    _uData[1] = uniforms.dt;
    _uData[2] = uniforms.resolution[0];
    _uData[3] = uniforms.resolution[1];
    _uData[4] = uniforms.opacity;
    _uData[5] = uniforms.windX;
    _uData[6] = uniforms.windY;
    _uData[7] = uniforms.intensity;
    _uData[8] = uniforms.speed;
    _uData[9] = count;
    _uData[10] = 0;
    _uData[11] = 0;
    device.queue.writeBuffer(_uniformBuffer, 0, _uData);

    const pass = encoder.beginComputePass({ label: "snow-compute" });
    pass.setPipeline(_computePipeline);
    pass.setBindGroup(0, _computeBG);
    pass.dispatchWorkgroups(Math.ceil(count / 64));
    pass.end();
  },

  render(pass: GPURenderPassEncoder, particleCount: number): void {
    if (!_initialized || !_renderPipeline || !_renderBG) return;
    const count = Math.min(particleCount, MAX_PARTICLES);
    if (count <= 0) return;
    pass.setPipeline(_renderPipeline);
    pass.setBindGroup(0, _renderBG);
    pass.draw(6, count); // quad = 6 verts, instanced
  },

  dispose(): void {
    _uniformBuffer?.destroy();
    _particleBuffer?.destroy();
    _uniformBuffer = null;
    _particleBuffer = null;
    _computePipeline = null;
    _renderPipeline = null;
    _computeBG = null;
    _renderBG = null;
    _initialized = false;
  },
};
