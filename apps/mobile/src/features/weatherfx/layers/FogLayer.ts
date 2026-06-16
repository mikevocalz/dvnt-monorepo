/**
 * Fog Layer — Fullscreen procedural fog with scrolling noise
 *
 * Uses a single fullscreen quad with a fragment shader that generates
 * procedural value noise for fog density. No particle buffer needed.
 */
import { GpuRuntime } from "@/src/gpu/GpuRuntime";
import type { LayerUniforms } from "../weatherTypes";

const UNIFORM_SIZE = 48;

const SHADER = /* wgsl */ `
struct Uniforms {
  time: f32, dt: f32, resX: f32, resY: f32,
  opacity: f32, windX: f32, windY: f32, intensity: f32,
  speed: f32, density: f32, _p0: f32, _p1: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

// Fullscreen triangle (3 verts cover entire screen)
@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VSOut {
  var out: VSOut;
  let x = f32(i32(vid) / 2) * 4.0 - 1.0;
  let y = f32(i32(vid) % 2) * 4.0 - 1.0;
  out.pos = vec4f(x, y, 0.0, 1.0);
  out.uv = vec2f(x * 0.5 + 0.5, 0.5 - y * 0.5);
  return out;
}

// Value noise
fn hash2(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, vec3f(p3.y + 33.33, p3.z + 33.33, p3.x + 33.33));
  return fract((p3.x + p3.y) * p3.z);
}

fn noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash2(i), hash2(i + vec2f(1.0, 0.0)), u.x),
    mix(hash2(i + vec2f(0.0, 1.0)), hash2(i + vec2f(1.0, 1.0)), u.x),
    u.y
  );
}

fn fbm(p_in: vec2f) -> f32 {
  var p = p_in;
  var v = 0.0;
  var a = 0.5;
  let shift = vec2f(100.0);
  for (var i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.0 + shift;
    a *= 0.5;
  }
  return v;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let scrollSpeed = u.speed * 0.08;
  let scroll = vec2f(u.time * scrollSpeed + u.windX * 0.3, u.time * scrollSpeed * 0.3);

  let scale = 3.0;
  let n1 = fbm(in.uv * scale + scroll);
  let n2 = fbm(in.uv * scale * 2.0 + scroll * 1.3 + vec2f(5.2, 1.3));

  let fog = n1 * 0.6 + n2 * 0.4;
  let alpha = fog * u.density * u.opacity;

  // Slight vertical gradient (thicker at bottom)
  let vGrad = mix(0.7, 1.0, in.uv.y);

  let fogColor = vec3f(0.75, 0.78, 0.82);
  return vec4f(fogColor, alpha * vGrad);
}
`;

let _initialized = false;
let _pipeline: GPURenderPipeline | null = null;
let _uniformBuffer: GPUBuffer | null = null;
let _bindGroup: GPUBindGroup | null = null;
const _uData = new Float32Array(12);

export const FogLayer = {
  async init(format: GPUTextureFormat): Promise<boolean> {
    if (_initialized) return true;
    const device = GpuRuntime.getDevice();
    if (!device) return false;

    try {
      _uniformBuffer = device.createBuffer({
        label: "fog-u",
        size: UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      const mod = device.createShaderModule({ label: "fog-shader", code: SHADER });
      const bgl = device.createBindGroupLayout({
        label: "fog-bgl",
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        ],
      });

      _pipeline = device.createRenderPipeline({
        label: "fog-pipeline",
        layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
        vertex: { module: mod, entryPoint: "vs" },
        fragment: {
          module: mod,
          entryPoint: "fs",
          targets: [{
            format,
            blend: {
              color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
              alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
            },
          }],
        },
        primitive: { topology: "triangle-list" },
      });

      _bindGroup = device.createBindGroup({
        label: "fog-bg",
        layout: bgl,
        entries: [{ binding: 0, resource: { buffer: _uniformBuffer } }],
      });

      _initialized = true;
      return true;
    } catch (err) {
      console.error("[FogLayer] init failed:", err);
      return false;
    }
  },

  update(uniforms: LayerUniforms, fogDensity: number): void {
    if (!_initialized || !_uniformBuffer) return;
    const device = GpuRuntime.getDevice();
    if (!device) return;

    _uData[0] = uniforms.time; _uData[1] = uniforms.dt;
    _uData[2] = uniforms.resolution[0]; _uData[3] = uniforms.resolution[1];
    _uData[4] = uniforms.opacity; _uData[5] = uniforms.windX;
    _uData[6] = uniforms.windY; _uData[7] = uniforms.intensity;
    _uData[8] = uniforms.speed; _uData[9] = fogDensity;
    _uData[10] = 0; _uData[11] = 0;
    device.queue.writeBuffer(_uniformBuffer, 0, _uData);
  },

  render(pass: GPURenderPassEncoder): void {
    if (!_initialized || !_pipeline || !_bindGroup) return;
    pass.setPipeline(_pipeline);
    pass.setBindGroup(0, _bindGroup);
    pass.draw(3); // fullscreen triangle
  },

  dispose(): void {
    _uniformBuffer?.destroy();
    _uniformBuffer = null;
    _pipeline = null;
    _bindGroup = null;
    _initialized = false;
  },
};
