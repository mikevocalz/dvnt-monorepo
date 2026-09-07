// ============================================================
// Canvas Kit Adapter — the SINGLE boundary to react-native-canvas-kit
// ============================================================
// Everything the story editor uses from the kit is re-exported here so the
// dependency is swappable and audited in one place (baseline §1/§6). Do NOT
// import "react-native-canvas-kit" directly anywhere else in stories-editor.
// The kit swap is NATIVE-ONLY — never import this module from a *.web.tsx
// file or apps/web (baseline §5).
//
// DEFERRED, not blocked (2026-09-07). That rule is a project decision, not a
// technical limit, and the two reasons usually given for it are both wrong:
//   • react-native-canvas-kit is pure JS (no ios/ or android/, zero runtime
//     deps, peer-deps @shopify/react-native-skia >=1.0.0), so webpack resolves
//     it through exports.default like any other package.
//   • Skia itself already runs on web here. Verified in the running Next app:
//     /canvaskit.wasm serves 200 application/wasm (8,076,553 bytes),
//     WebAssembly.compile() succeeds, and CanvasKit drew a rect whose pixel
//     read back [255,0,0,255]. next.config.ts already has CopySkiaPlugin,
//     `AssetRegistry: false` and the node fallbacks.
// The one genuinely missing piece is the runtime loader: nothing calls
// LoadSkiaWeb()/<WithSkiaWeb/>, so window.CanvasKit is undefined. Adding it is
// deliberately deferred until a web surface actually renders Skia — the story
// editor's web path is its own DOM implementation today, so the loader would
// cost an 8MB wasm fetch for no consumer. Wire the loader in the SAME change
// that gives it one.
// ============================================================

// Allow-listed kit component surface (values)
export {
  Stage,
  Layer,
  Group,
  Rect,
  Circle,
  Image,
  Text,
  Transformer,
  SnapGrid,
  BrushLayer,
} from "react-native-canvas-kit";

// Allow-listed kit type surface
export type {
  StageProps,
  LayerProps,
  GroupProps,
  RectProps,
  ImageProps,
  TextProps,
  TransformerProps,
  SnapGridProps,
  BrushLayerProps,
  BrushStrokeEvent,
  BrushTool,
  NodeConfig,
  ShapeConfig,
  NodeHandle,
  EventObject,
  EventListener,
  TransformResult,
  TransformEvent,
  TransformEventListener,
  AnchorId,
  Vector2d,
} from "react-native-canvas-kit";

export * from "./version";
export * from "./mappers";
export * from "./brush-mapping";
export { CanvasKitElementLayer } from "./CanvasKitElementLayer";
export type { CanvasKitElementLayerProps } from "./CanvasKitElementLayer";
