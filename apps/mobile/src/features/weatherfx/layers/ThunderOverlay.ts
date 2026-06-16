/**
 * Thunder Overlay — Lightning flash effect
 *
 * Fullscreen white flash that decays rapidly. Triggered randomly
 * based on thunderChance. Uses a simple fullscreen quad shader.
 * Never constant — randomised timing with natural decay curve.
 */
import { GpuRuntime } from "@/src/gpu/GpuRuntime";
import type { LayerUniforms } from "../weatherTypes";

const UNIFORM_SIZE = 32;

const SHADER = /* wgsl */ `
struct Uniforms {
  flashIntensity: f32,
  opacity: f32,
  resX: f32,
  resY: f32,
  time: f32,
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

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  // Slight radial gradient — brighter at center
  let center = vec2f(0.5, 0.3);
  let d = length(in.uv - center);
  let radial = 1.0 - smoothstep(0.0, 1.2, d);

  let flash = u.flashIntensity * u.opacity * (0.5 + radial * 0.5);

  // Lightning is bluish-white
  let color = vec3f(0.9, 0.92, 1.0);
  return vec4f(color, flash);
}
`;

let _initialized = false;
let _pipeline: GPURenderPipeline | null = null;
let _uniformBuffer: GPUBuffer | null = null;
let _bindGroup: GPUBindGroup | null = null;
const _uData = new Float32Array(8);

// Flash state (module-level, no GC)
let _flashActive = false;
let _flashIntensity = 0;
let _cooldown = 0; // seconds until next possible flash
let _decayRate = 4.0; // how fast flash fades

export const ThunderOverlay = {
  async init(format: GPUTextureFormat): Promise<boolean> {
    if (_initialized) return true;
    const device = GpuRuntime.getDevice();
    if (!device) return false;

    try {
      _uniformBuffer = device.createBuffer({
        label: "thunder-u",
        size: UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      const mod = device.createShaderModule({ label: "thunder-shader", code: SHADER });
      const bgl = device.createBindGroupLayout({
        label: "thunder-bgl",
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        ],
      });

      _pipeline = device.createRenderPipeline({
        label: "thunder-pipeline",
        layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
        vertex: { module: mod, entryPoint: "vs" },
        fragment: {
          module: mod,
          entryPoint: "fs",
          targets: [{
            format,
            blend: {
              color: { srcFactor: "src-alpha", dstFactor: "one", operation: "add" },
              alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
            },
          }],
        },
        primitive: { topology: "triangle-list" },
      });

      _bindGroup = device.createBindGroup({
        label: "thunder-bg",
        layout: bgl,
        entries: [{ binding: 0, resource: { buffer: _uniformBuffer } }],
      });

      _initialized = true;
      return true;
    } catch (err) {
      console.error("[ThunderOverlay] init failed:", err);
      return false;
    }
  },

  /**
   * Call each frame. Handles flash triggering + decay.
   * thunderChance: probability 0–1 per second of triggering a flash.
   */
  update(uniforms: LayerUniforms, thunderChance: number): void {
    if (!_initialized || !_uniformBuffer) return;
    const device = GpuRuntime.getDevice();
    if (!device) return;

    const dt = uniforms.dt;

    // Decay existing flash
    if (_flashActive) {
      _flashIntensity -= _decayRate * dt;
      if (_flashIntensity <= 0) {
        _flashIntensity = 0;
        _flashActive = false;
        _cooldown = 1.5 + Math.random() * 3; // 1.5–4.5s cooldown
      }
    }

    // Cooldown
    if (_cooldown > 0) {
      _cooldown -= dt;
    }

    // Random trigger
    if (!_flashActive && _cooldown <= 0 && thunderChance > 0) {
      const roll = Math.random();
      if (roll < thunderChance * dt) {
        _flashActive = true;
        // Random intensity: sometimes subtle, sometimes bright
        _flashIntensity = 0.4 + Math.random() * 0.6;
        _decayRate = 2.5 + Math.random() * 3; // variable decay
        // Double-flash: 30% chance of immediate second pulse
        if (Math.random() < 0.3) {
          _flashIntensity = Math.min(1.0, _flashIntensity + 0.3);
          _decayRate *= 0.7; // slower decay for double
        }
      }
    }

    // Write uniforms
    _uData[0] = _flashIntensity;
    _uData[1] = uniforms.opacity;
    _uData[2] = uniforms.resolution[0];
    _uData[3] = uniforms.resolution[1];
    _uData[4] = uniforms.time;
    _uData[5] = 0;
    _uData[6] = 0;
    _uData[7] = 0;
    device.queue.writeBuffer(_uniformBuffer, 0, _uData);
  },

  /** Only render if flash is active (save GPU) */
  render(pass: GPURenderPassEncoder): void {
    if (!_initialized || !_pipeline || !_bindGroup) return;
    if (_flashIntensity < 0.01) return;

    pass.setPipeline(_pipeline);
    pass.setBindGroup(0, _bindGroup);
    pass.draw(3);
  },

  /** Reset flash state (e.g. when switching away from thunder) */
  reset(): void {
    _flashActive = false;
    _flashIntensity = 0;
    _cooldown = 0;
  },

  dispose(): void {
    _uniformBuffer?.destroy();
    _uniformBuffer = null;
    _pipeline = null;
    _bindGroup = null;
    _initialized = false;
    ThunderOverlay.reset();
  },
};
