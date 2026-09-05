/**
 * GPU reaction engine — one render pipeline, one pre-allocated ring buffer.
 *
 * Per Decision 5: a reaction is ONE instance of a quad, not a view. Motion is a
 * pure function of `(now - spawnTime)` evaluated in the vertex shader, so the
 * per-frame CPU cost is one uniform write and one draw call — spawning is the
 * only time we touch the instance buffer, and then only the 20 bytes that
 * changed. That is what lets the cap go to 50 without 50 animated nodes.
 *
 * TypeGPU owns the data schemas: `sizeOf(ReactionInstance)` is the authority on
 * the stride, so the WGSL struct and the JS writer can't silently disagree
 * about layout the way hand-rolled Float32Array offsets do. The shader itself
 * is plain WGSL because web and native run the exact same source.
 */

import tgpu, { type TgpuRoot } from "typegpu";
import * as d from "typegpu/data";
import type { EmojiAtlas } from "./emojiAtlas";

/** Ring capacity. Above the 50-concurrent target with room for burst overlap. */
export const REACTION_CAPACITY = 64;

/** Lifetime of one reaction on screen. Matches the transport's 2400ms TTL. */
export const REACTION_TTL_MS = 2400;

export const ReactionInstance = d.struct({
  atlasIndex: d.u32,
  spawnTimeMs: d.f32,
  lane: d.f32,
  driftSeed: d.f32,
  isOwn: d.u32,
});

export const ReactionUniforms = d.struct({
  timeMs: d.f32,
  aspect: d.f32,
  atlasCols: d.f32,
  ttlMs: d.f32,
});

export const INSTANCE_STRIDE = d.sizeOf(ReactionInstance);
const UNIFORM_SIZE = d.sizeOf(ReactionUniforms);

/** Field order here IS the memory layout contract with the WGSL struct. */
export const INSTANCE_FIELDS = [
  "atlasIndex",
  "spawnTimeMs",
  "lane",
  "driftSeed",
  "isOwn",
] as const;

export interface InstanceRecord {
  atlasIndex: number;
  spawnTimeMs: number;
  lane: number;
  driftSeed: number;
  isOwn: number;
}

/**
 * Encode one instance into `view` at offset 0. Extracted from the hot path so
 * it can be asserted against the schema — a silent stride or field-order drift
 * between this writer and the WGSL struct renders garbage with no error.
 */
export function writeInstance(view: DataView, rec: InstanceRecord): void {
  view.setUint32(0, rec.atlasIndex, true);
  view.setFloat32(4, rec.spawnTimeMs, true);
  view.setFloat32(8, rec.lane, true);
  view.setFloat32(12, rec.driftSeed, true);
  view.setUint32(16, rec.isOwn, true);
}

export const SHADER = /* wgsl */ `
struct Instance {
  atlasIndex: u32,
  spawnTimeMs: f32,
  lane: f32,
  driftSeed: f32,
  isOwn: u32,
};

struct Uniforms {
  timeMs: f32,
  aspect: f32,
  atlasCols: f32,
  ttlMs: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> instances: array<Instance>;
@group(0) @binding(2) var atlasTex: texture_2d<f32>;
@group(0) @binding(3) var atlasSampler: sampler;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) alpha: f32,
};

// Six vertices, one quad. Kept as a function rather than a vertex buffer so
// there is exactly one buffer in this pipeline that ever gets written.
fn cornerOf(i: u32) -> vec2f {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0,  1.0), vec2f(1.0, -1.0), vec2f( 1.0, 1.0),
  );
  return corners[i];
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  let inst = instances[ii];
  let age = u.timeMs - inst.spawnTimeMs;
  let t = age / u.ttlMs;

  var out: VSOut;

  // Expired or never-spawned instances collapse to a degenerate quad. Cheaper
  // than tracking a live count on the CPU and re-uploading it every frame.
  if (age < 0.0 || t >= 1.0) {
    out.pos = vec4f(0.0, 0.0, 2.0, 1.0);
    out.uv = vec2f(0.0);
    out.alpha = 0.0;
    return out;
  }

  // Rise: ease-out cubic, matching the RN/DOM fallback's Easing.out(cubic).
  let ease = 1.0 - pow(1.0 - t, 3.0);
  // Pop then settle, so the glyph reads as arriving rather than sliding in.
  let scale = 0.72 + 0.36 * smoothstep(0.0, 0.16, t) - 0.08 * smoothstep(0.16, 0.34, t);

  // Own reactions rise on the right, others on the left — same convention the
  // RN overlay uses, so the GPU path doesn't relearn the room's language.
  let side = select(-1.0, 1.0, inst.isOwn == 1u);
  let drift = inst.driftSeed * 0.14 * t;
  let x = side * (0.72 + inst.lane * 0.10) + drift * side;
  let y = -0.85 + ease * 1.45;

  let corner = cornerOf(vi);
  let half = 0.085 * scale;
  out.pos = vec4f(x + corner.x * half / u.aspect, y + corner.y * half, 0.0, 1.0);
  // Sample ONE atlas cell, not the whole texture: without this every quad
  // renders the full emoji grid ("one button shows all emojis"). The atlas is
  // square (size = cols * CELL), rows top-down, so both axes divide by cols.
  // v flips because texture row 0 is the image top while corner.y=+1 is the
  // quad top — the old (corner+1)*0.5 mapping drew everything upside down.
  let cols = u.atlasCols;
  let idx = f32(inst.atlasIndex);
  let cell = vec2f(idx % cols, floor(idx / cols));
  let base = vec2f((corner.x + 1.0) * 0.5, (1.0 - corner.y) * 0.5);
  out.uv = (cell + base) / cols;
  out.alpha = 1.0 - t * t;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let texel = textureSample(atlasTex, atlasSampler, in.uv);
  return vec4f(texel.rgb, texel.a * in.alpha);
}
`;

export interface ReactionSpawn {
  emoji: string;
  isOwn: boolean;
}

export interface ReactionEngine {
  /** Queue one reaction. Overwrites the oldest slot once the ring wraps. */
  spawn: (spawn: ReactionSpawn) => void;
  /** Draw one frame into `context`'s current texture. */
  render: (context: GPUCanvasContext, nowMs: number) => void;
  destroy: () => void;
}

/**
 * Build the engine. Returns `null` when the atlas couldn't be rasterized, which
 * is the caller's signal to keep the RN/DOM fallback mounted.
 */
export function createReactionEngine(
  device: GPUDevice,
  format: GPUTextureFormat,
  atlas: EmojiAtlas,
): ReactionEngine | null {
  let root: TgpuRoot;
  try {
    root = tgpu.initFromDevice({ device });
  } catch (err) {
    console.warn("[reactions] TypeGPU init failed:", err);
    return null;
  }

  const instanceBuffer = root
    .createBuffer(d.arrayOf(ReactionInstance, REACTION_CAPACITY))
    .$usage("storage");
  const uniformBuffer = root.createBuffer(ReactionUniforms).$usage("uniform");

  const texture = device.createTexture({
    label: "reaction-atlas",
    size: [atlas.size, atlas.size],
    format: "rgba8unorm",
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.writeTexture(
    { texture },
    atlas.pixels,
    { bytesPerRow: atlas.size * 4, rowsPerImage: atlas.size },
    { width: atlas.size, height: atlas.size },
  );

  const sampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  });

  const module = device.createShaderModule({
    label: "reactions",
    code: SHADER,
  });
  const pipeline = device.createRenderPipeline({
    label: "reactions",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [
        {
          format,
          // Straight alpha over the room UI — the atlas is unpremultiplied.
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

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer.buffer } },
      { binding: 1, resource: { buffer: instanceBuffer.buffer } },
      { binding: 2, resource: texture.createView() },
      { binding: 3, resource: sampler },
    ],
  });

  // Hoisted scratch — the zero-per-frame-allocation law. One 20-byte record for
  // spawns, one uniform record per frame; both are rewritten in place.
  const instanceScratch = new ArrayBuffer(INSTANCE_STRIDE);
  const instanceView = new DataView(instanceScratch);
  const uniformScratch = new ArrayBuffer(UNIFORM_SIZE);
  const uniformView = new DataView(uniformScratch);

  let head = 0;
  let destroyed = false;

  const spawn = ({ emoji, isOwn }: ReactionSpawn) => {
    if (destroyed) return;
    const slot = head % REACTION_CAPACITY;
    head += 1;

    writeInstance(instanceView, {
      atlasIndex: atlas.indexOf(emoji),
      spawnTimeMs: performance.now(),
      // Lane spreads concurrent reactions across a few columns so a burst reads
      // as a crowd rather than one thick stripe.
      lane: slot % 4,
      driftSeed: Math.random() * 2 - 1,
      isOwn: isOwn ? 1 : 0,
    });

    device.queue.writeBuffer(
      instanceBuffer.buffer,
      slot * INSTANCE_STRIDE,
      instanceScratch,
    );
  };

  const render = (context: GPUCanvasContext, nowMs: number) => {
    if (destroyed) return;
    const view = context.getCurrentTexture();

    uniformView.setFloat32(0, nowMs, true);
    uniformView.setFloat32(4, Math.max(0.0001, view.width / view.height), true);
    uniformView.setFloat32(8, atlas.cols, true);
    uniformView.setFloat32(12, REACTION_TTL_MS, true);
    device.queue.writeBuffer(uniformBuffer.buffer, 0, uniformScratch);

    const encoder = device.createCommandEncoder({ label: "reactions" });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: view.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    // ponytail: draws the full ring every frame and lets expired instances
    // collapse in the vertex shader. 64 degenerate quads is free; track a live
    // count only if the capacity ever grows past a few hundred.
    pass.draw(6, REACTION_CAPACITY);
    pass.end();
    device.queue.submit([encoder.finish()]);
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    texture.destroy();
    instanceBuffer.destroy();
    uniformBuffer.destroy();
  };

  return { spawn, render, destroy };
}
