// ============================================================
// Canvas Kit Adapter — the SINGLE boundary to react-native-canvas-kit
// ============================================================
// Everything the story editor uses from the kit is re-exported here so the
// dependency is swappable and audited in one place (baseline §1/§6). Do NOT
// import "react-native-canvas-kit" directly anywhere else in stories-editor.
// The kit swap is NATIVE-ONLY — never import this module from a *.web.tsx
// file or apps/web (baseline §5).
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
