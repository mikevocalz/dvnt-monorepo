/**
 * GPU Runtime — Singleton WebGPU device / context manager
 *
 * ONE device, ONE context for the entire app. All pipelines and buffers
 * are cached. Safe-wrapped so OTA updates on binaries without
 * react-native-wgpu gracefully degrade to no-op.
 *
 * Uses react-native-wgpu as the single WebGPU bridge.
 */

// ── Safe import of react-native-wgpu ────────────────────────────────
let _wgpuAvailable = false;
try {
  require("react-native-wgpu");
  _wgpuAvailable = true;
} catch {
  console.warn("[GpuRuntime] react-native-wgpu not available in this binary");
}

export function isWebGPUAvailable(): boolean {
  return _wgpuAvailable;
}

// ── Module-level singletons ─────────────────────────────────────────
let _adapter: GPUAdapter | null = null;
let _device: GPUDevice | null = null;
let _initPromise: Promise<boolean> | null = null;

// Pipeline + buffer caches (keyed by label)
const _pipelineCache = new Map<string, GPURenderPipeline>();
const _computePipelineCache = new Map<string, GPUComputePipeline>();
const _bufferCache = new Map<string, GPUBuffer>();

// ── Public API ──────────────────────────────────────────────────────
export const GpuRuntime = {
  /**
   * Initialise adapter + device ONCE. Returns true if GPU is ready.
   * Safe to call multiple times — subsequent calls return cached promise.
   */
  async initOnce(): Promise<boolean> {
    if (!_wgpuAvailable) return false;
    if (_device) return true;
    if (_initPromise) return _initPromise;

    _initPromise = (async () => {
      try {
        // navigator.gpu is polyfilled by react-native-wgpu
        if (typeof navigator === "undefined" || !navigator.gpu) {
          console.warn("[GpuRuntime] navigator.gpu not available");
          return false;
        }

        _adapter = await navigator.gpu.requestAdapter({
          powerPreference: "low-power",
        });
        if (!_adapter) {
          console.warn("[GpuRuntime] No GPU adapter found");
          return false;
        }

        _device = await _adapter.requestDevice({
          requiredFeatures: [],
          requiredLimits: {},
        });

        _device.lost.then((info) => {
          console.error("[GpuRuntime] Device lost:", info.message);
          _device = null;
          _adapter = null;
          _initPromise = null;
          _pipelineCache.clear();
          _computePipelineCache.clear();
          _bufferCache.clear();
        });

        if (__DEV__) {
          console.log(
            "[GpuRuntime] GPU ready:",
            ((_adapter as any).info?.vendor as string) ?? "unknown",
          );
        }
        return true;
      } catch (err) {
        console.error("[GpuRuntime] Init failed:", err);
        _initPromise = null;
        return false;
      }
    })();

    return _initPromise;
  },

  getDevice(): GPUDevice | null {
    return _device;
  },

  isReady(): boolean {
    return _device !== null;
  },

  // ── Pipeline cache ──────────────────────────────────────────────
  getCachedRenderPipeline(label: string): GPURenderPipeline | undefined {
    return _pipelineCache.get(label);
  },

  setCachedRenderPipeline(label: string, pipeline: GPURenderPipeline): void {
    _pipelineCache.set(label, pipeline);
  },

  getCachedComputePipeline(label: string): GPUComputePipeline | undefined {
    return _computePipelineCache.get(label);
  },

  setCachedComputePipeline(label: string, pipeline: GPUComputePipeline): void {
    _computePipelineCache.set(label, pipeline);
  },

  // ── Buffer helpers ──────────────────────────────────────────────
  getCachedBuffer(label: string): GPUBuffer | undefined {
    return _bufferCache.get(label);
  },

  createBuffer(
    label: string,
    size: number,
    usage: GPUBufferUsageFlags,
  ): GPUBuffer | null {
    if (!_device) return null;
    const existing = _bufferCache.get(label);
    if (existing && existing.size >= size) return existing;

    const buffer = _device.createBuffer({ label, size, usage });
    _bufferCache.set(label, buffer);
    return buffer;
  },

  updateBuffer(buffer: GPUBuffer, data: ArrayBufferLike, offset = 0): void {
    if (!_device) return;
    _device.queue.writeBuffer(buffer, offset, data);
  },

  // ── Shader module helper ────────────────────────────────────────
  createShaderModule(label: string, code: string): GPUShaderModule | null {
    if (!_device) return null;
    return _device.createShaderModule({ label, code });
  },

  // ── Frame helpers ───────────────────────────────────────────────
  createCommandEncoder(label?: string): GPUCommandEncoder | null {
    if (!_device) return null;
    return _device.createCommandEncoder({ label: label ?? "frame" });
  },

  submitCommands(encoder: GPUCommandEncoder): void {
    if (!_device) return;
    _device.queue.submit([encoder.finish()]);
  },

  // ── Cleanup ─────────────────────────────────────────────────────
  dispose(): void {
    for (const buf of _bufferCache.values()) {
      buf.destroy();
    }
    _bufferCache.clear();
    _pipelineCache.clear();
    _computePipelineCache.clear();
    _device?.destroy();
    _device = null;
    _adapter = null;
    _initPromise = null;
  },
};
