import { publishMediaFile } from "../../lib/media/live-photo-original";
import type { MediaAsset } from "../../lib/hooks/use-media-picker";
import { needsSpicyReview, videoSampleTimes, type NudityReview } from "./nudity-review-policy";

// Lazy import keeps inference/weights out of the initial composer bundle. The
// named model's weights ship with nsfwjs, not a third-party inference endpoint.
let modelPromise: Promise<import("nsfwjs/core").NSFWJS> | undefined;
function getModel() {
  return modelPromise ??= Promise.all([import("nsfwjs/core"), import("nsfwjs/models/mobilenet_v2")]).then(([module, { MobileNetV2Model }]) => module.load("MobileNetV2", { modelDefinitions: [MobileNetV2Model] })).catch(error => {
    modelPromise = undefined;
    throw error;
  });
}
function bounded<T>(promise: Promise<T>, signal: AbortSignal, milliseconds = 12000): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new Error("Check cancelled")); };
    const timer = setTimeout(abort, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    promise.then(value => { clearTimeout(timer); signal.removeEventListener("abort", abort); resolve(value); }, error => {
      clearTimeout(timer); signal.removeEventListener("abort", abort); reject(error);
    });
  });
}
function mediaReady(element: HTMLImageElement | HTMLVideoElement, event: string, signal: AbortSignal, start: () => void) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); element.removeEventListener(event, done); element.removeEventListener("error", fail); signal.removeEventListener("abort", fail); };
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error("Media could not be checked")); };
    const timer = setTimeout(fail, 8000);
    element.addEventListener(event, done, { once: true });
    element.addEventListener("error", fail, { once: true });
    signal.addEventListener("abort", fail, { once: true });
    if (signal.aborted) { fail(); return; }
    try { start(); } catch { fail(); }
  });
}

// Serialize inference even after a timeout: WebGL work cannot be cancelled.
let inferenceTail: Promise<unknown> = Promise.resolve();
function classify(model: Awaited<ReturnType<typeof getModel>>, element: HTMLImageElement | HTMLVideoElement, signal: AbortSignal) {
  const pending = inferenceTail.then(() => {
    if (signal.aborted) throw new Error("Check cancelled");
    return model.classify(element);
  });
  inferenceTail = pending.catch(() => undefined);
  return bounded(pending, signal);
}
export async function scanPostMedia(media: MediaAsset[], signal: AbortSignal): Promise<NudityReview> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, 60000);
  try { return await scan(media, controller.signal); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}
async function scan(media: MediaAsset[], signal: AbortSignal): Promise<NudityReview> {
  const result: NudityReview = { flagged: false, incomplete: false };
  if (signal.aborted) return { flagged: false, incomplete: true };
  let model: Awaited<ReturnType<typeof getModel>>;
  try { model = await bounded(getModel(), signal, 30000); }
  catch { return { flagged: false, incomplete: true }; }
  for (const asset of media) {
    let published: ReturnType<typeof publishMediaFile>;
    try { published = publishMediaFile(asset); }
    catch { result.incomplete = true; continue; }
    const sources = [{ uri: published.uri, video: published.type === "video" },
      ...(published.pairedVideoUri ? [{ uri: published.pairedVideoUri, video: true }] : [])];
    for (const source of sources) {
      if (signal.aborted) return { ...result, incomplete: true };
      // Never fetch an arbitrary external URL for classification. Remote handoff
      // media gets the honest incomplete-review dialog instead.
      if (!/^(blob:|data:)/.test(source.uri)) { result.incomplete = true; continue; }
      const element = document.createElement(source.video ? "video" : "img");
      try {
        if (element instanceof HTMLVideoElement) {
          element.muted = true; element.playsInline = true; element.preload = "auto";
          await mediaReady(element, "loadeddata", signal, () => { element.src = source.uri; });
          const times = videoSampleTimes(element.duration);
          if (!times.length) throw new Error("Unsupported duration");
          for (const time of times) {
            if (Math.abs(element.currentTime - time) > 0.01) {
              await mediaReady(element, "seeked", signal, () => { element.currentTime = time; });
            }
            if (needsSpicyReview(await classify(model, element, signal))) result.flagged = true;
          }
        } else {
          await mediaReady(element, "load", signal, () => { element.src = source.uri; });
          if (needsSpicyReview(await classify(model, element, signal))) result.flagged = true;
          // A still decode doesn't check every frame of animated images.
          if (asset.mimeType === "image/gif" || /\.gif$/i.test(asset.fileName ?? "")) result.incomplete = true;
        }
      } catch { result.incomplete = true; }
      finally {
        if (element instanceof HTMLVideoElement) { element.pause(); element.removeAttribute("src"); element.load(); }
        else element.removeAttribute("src");
      }
    }
  }
  return result;
}
