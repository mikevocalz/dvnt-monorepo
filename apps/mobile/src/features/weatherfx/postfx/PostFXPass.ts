/**
 * PostFX Pass — Film grain + vignette + color grading + lightning flash
 *
 * Single fullscreen quad. All effects controlled by uniforms.
 * Can be entirely disabled by flags (low power, reduce motion).
 */
import { GpuRuntime } from "@/src/gpu/GpuRuntime";
import { WeatherEffect } from "../weatherTypes";

const UNIFORM_SIZE = 48;

const SHADER = /* wgsl */ `
struct Uniforms {
  time: f32,
  resX: f32,
  resY: f32,
  grainStrength: f32,
  vignetteStrength: f32,
  colorTintR: f32,
  colorTintG: f32,
  colorTintB: f32,
  opacity: f32,
  _p0: f32,
  _p1: f32,
  _p2: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VSOut {
  var out: VSOut;
  let x = f32(i32(vid) / 2) * 4.0 - 1.0;
  let y = f32(i32(vid) % 2) * 4.0 - 1.0;
  out.pos = vec4f(x, y, 0.0, 1.0);
  out.uv = vec2f(x * 0.5 + 0.5, 0.5 - y * 0.5);
  return out;
}

// Film grain noise
fn grainNoise(uv: vec2f, t: f32) -> f32 {
  let seed = dot(uv, vec2f(12.9898, 78.233)) + t * 43758.5453;
  return fract(sin(seed) * 43758.5453) * 2.0 - 1.0;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  var color = vec3f(0.0);
  var alpha = 0.0;

  // Film grain — subtle noise overlay
  let grain = grainNoise(in.uv * vec2f(u.resX, u.resY), u.time) * u.grainStrength;
  color += vec3f(grain);
  alpha += abs(grain) * 0.5;

  // Vignette — darken edges
  let center = vec2f(0.5, 0.5);
  let dist = length(in.uv - center) * 1.414;
  let vignette = smoothstep(0.4, 1.2, dist) * u.vignetteStrength;
  color -= vec3f(vignette);
  alpha = max(alpha, vignette * 0.8);

  // Color tint overlay (subtle)
  let tint = vec3f(u.colorTintR, u.colorTintG, u.colorTintB);
  color += tint * 0.05;
  alpha = max(alpha, length(tint) * 0.02);

  return vec4f(color, alpha * u.opacity);
}
`;

// Color tints per weather effect
// Brand colors: Rain=#8A40CF Snow=#3FDCFF Sunny=#FC253A
const COLOR_TINTS: Record<string, [number, number, number]> = {
  [WeatherEffect.Rain]: [0.541, 0.251, 0.812], // #8A40CF purple
  [WeatherEffect.HeavyRain]: [0.45, 0.2, 0.75], // deeper purple
  [WeatherEffect.Snow]: [0.247, 0.863, 1.0], // #3FDCFF cyan
  [WeatherEffect.Fog]: [0.35, 0.55, 0.65], // desaturated cyan
  [WeatherEffect.Thunder]: [0.4, 0.18, 0.7], // dark purple
  [WeatherEffect.Cloudy]: [0.3, 0.3, 0.45], // muted blue-grey
  [WeatherEffect.Clear]: [0.988, 0.145, 0.227], // #FC253A red-orange
  [WeatherEffect.None]: [0, 0, 0],
};

let _initialized = false;
let _pipeline: GPURenderPipeline | null = null;
let _uniformBuffer: GPUBuffer | null = null;
let _bindGroup: GPUBindGroup | null = null;
const _uData = new Float32Array(12);

export const PostFXPass = {
  async init(format: GPUTextureFormat): Promise<boolean> {
    if (_initialized) return true;
    const device = GpuRuntime.getDevice();
    if (!device) return false;

    try {
      _uniformBuffer = device.createBuffer({
        label: "postfx-u",
        size: UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      const mod = device.createShaderModule({
        label: "postfx-shader",
        code: SHADER,
      });
      const bgl = device.createBindGroupLayout({
        label: "postfx-bgl",
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: "uniform" },
          },
        ],
      });

      _pipeline = device.createRenderPipeline({
        label: "postfx-pipeline",
        layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
        vertex: { module: mod, entryPoint: "vs" },
        fragment: {
          module: mod,
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

      _bindGroup = device.createBindGroup({
        label: "postfx-bg",
        layout: bgl,
        entries: [{ binding: 0, resource: { buffer: _uniformBuffer } }],
      });

      _initialized = true;
      return true;
    } catch (err) {
      console.error("[PostFXPass] init failed:", err);
      return false;
    }
  },

  update(
    time: number,
    resolution: [number, number],
    effect: WeatherEffect,
    opacity: number,
    enabled: boolean,
  ): void {
    if (!_initialized || !_uniformBuffer || !enabled) return;
    const device = GpuRuntime.getDevice();
    if (!device) return;

    const tint = COLOR_TINTS[effect] ?? [0, 0, 0];

    _uData[0] = time;
    _uData[1] = resolution[0];
    _uData[2] = resolution[1];
    _uData[3] = 0.04; // grain strength (subtle)
    _uData[4] = 0.25; // vignette strength (subtle)
    _uData[5] = tint[0];
    _uData[6] = tint[1];
    _uData[7] = tint[2];
    _uData[8] = opacity;
    _uData[9] = 0;
    _uData[10] = 0;
    _uData[11] = 0;
    device.queue.writeBuffer(_uniformBuffer, 0, _uData);
  },

  render(pass: GPURenderPassEncoder, enabled: boolean): void {
    if (!_initialized || !_pipeline || !_bindGroup || !enabled) return;
    pass.setPipeline(_pipeline);
    pass.setBindGroup(0, _bindGroup);
    pass.draw(3);
  },

  dispose(): void {
    _uniformBuffer?.destroy();
    _uniformBuffer = null;
    _pipeline = null;
    _bindGroup = null;
    _initialized = false;
  },
};
