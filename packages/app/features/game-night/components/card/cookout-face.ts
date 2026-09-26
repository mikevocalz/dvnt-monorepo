/**
 * Keep It 100 — The Cookout card-face rasterizer (web).
 *
 * Draws the printed card anatomy to an offscreen canvas which becomes the
 * front texture of the 3D card mesh (and the parity reference for the print
 * PDF). Layout mirrors the deck: white face, "KEEP IT 100 / THE COOKOUT"
 * header, category line, a section label over a solid navy rule, wrapped body
 * text, and the navy footer band. Nothing is baked from the PDF — every face
 * is data-driven per the deck spec.
 */
import { COOKOUT_THEME } from "../../decks/blue-100-the-cookout/theme";

const W = COOKOUT_THEME.texture.width;
const H = COOKOUT_THEME.texture.height;
const C = COOKOUT_THEME.colors;
const F = COOKOUT_THEME.fonts;

export type CookoutFaceKind = "prompt" | "answer" | "concealed";

export interface CookoutFaceSpec {
  kind: CookoutFaceKind;
  /** Category line under the header (e.g. "ROUND 1", "DUEL"). */
  section?: string;
  /** Small section label above the navy rule — "PROMPT:" / "ANSWER:". */
  label?: string;
  body: string;
  footnote?: string;
  /** Winner/selected accent: gold inner keyline like the print's rule. */
  accent?: "gold";
}

function font(family: string, px: number) {
  return `${px}px ${family}, "Space Grotesk", sans-serif`;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Body type shrinks until the wrapped text fits the vertical budget. */
function fitBlock(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxHeight: number,
  startPx: number,
  family: string,
): { lines: string[]; px: number; lineHeight: number } {
  for (let px = startPx; px >= 26; px -= 4) {
    ctx.font = font(family, px);
    const lines = wrapText(ctx, text, maxWidth);
    const lineHeight = px * 1.22;
    if (lines.length * lineHeight <= maxHeight) {
      return { lines, px, lineHeight };
    }
  }
  ctx.font = font(family, 26);
  return { lines: wrapText(ctx, text, maxWidth), px: 26, lineHeight: 32 };
}

function centerText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  family: string,
  px: number,
  color: string,
) {
  ctx.font = font(family, px);
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, y);
}

function navyRule(ctx: CanvasRenderingContext2D, y: number) {
  ctx.fillStyle = C.navy;
  ctx.fillRect(W * 0.22, y, W * 0.56, H * 0.0075);
}

/** "KEEP IT 100 / THE COOKOUT / <section>" — the printed header stack. */
function drawHeader(ctx: CanvasRenderingContext2D, section?: string) {
  const cx = W / 2;
  let y = H * 0.075;
  centerText(ctx, "KEEP IT 100", cx, y, F.label, H * 0.042, C.navy);
  y += H * 0.052;
  centerText(ctx, "THE COOKOUT", cx, y, F.display, H * 0.062, C.navy);
  if (section) {
    y += H * 0.05;
    centerText(ctx, section.toUpperCase(), cx, y, F.label, H * 0.03, C.navy);
  }
  return y;
}

export function renderCookoutFace(spec: CookoutFaceSpec): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // White face with the print's corner radius.
  ctx.clearRect(0, 0, W, H);
  const r = W * 0.045;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, r);
  ctx.clip();
  ctx.fillStyle = C.face;
  ctx.fillRect(0, 0, W, H);

  // Navy footer band — the deck's signature bottom edge.
  ctx.fillStyle = C.band;
  ctx.fillRect(0, H * 0.925, W, H * 0.075);

  const cx = W / 2;
  let y = drawHeader(ctx, spec.section);
  y += H * 0.055;

  if (spec.label) {
    centerText(ctx, spec.label.toUpperCase(), cx, y, F.display, H * 0.04, C.navy);
    y += H * 0.038;
    navyRule(ctx, y);
    y += H * 0.045;
  }

  // Body block — vertically centered in the space between the rule and band.
  const bandTop = H * 0.925;
  const footH = spec.footnote ? H * 0.05 : 0;
  const avail = bandTop - footH - y - H * 0.02;
  const isPrompt = spec.kind === "prompt";
  const block = fitBlock(
    ctx,
    spec.body,
    W * 0.78,
    avail,
    isPrompt ? H * 0.062 : H * 0.052,
    isPrompt ? F.display : F.bodyStrong,
  );
  ctx.font = font(isPrompt ? F.display : F.bodyStrong, block.px);
  ctx.fillStyle = C.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const blockH = block.lines.length * block.lineHeight;
  let ly = y + Math.max(0, (avail - blockH) / 2) + block.lineHeight / 2;
  for (const line of block.lines) {
    ctx.fillText(line, cx, ly);
    ly += block.lineHeight;
  }

  if (spec.footnote) {
    centerText(
      ctx,
      spec.footnote.toUpperCase(),
      cx,
      bandTop - footH / 2 - H * 0.006,
      F.label,
      H * 0.03,
      C.navy,
    );
  }

  if (spec.accent === "gold") {
    ctx.strokeStyle = C.winnerGold;
    ctx.lineWidth = W * 0.016;
    ctx.strokeRect(W * 0.03, W * 0.03, W * 0.94, H - W * 0.06);
  }

  ctx.restore();
  return canvas;
}

/** Fonts must be resident before the first raster or faces bake in fallback
 * type. Call once; re-render is cheap enough not to matter. */
export async function cookoutFontsReady(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load(`${H * 0.062}px ${F.display}`),
      document.fonts.load(`${H * 0.04}px ${F.label}`),
      document.fonts.load(`${H * 0.05}px ${F.bodyStrong}`),
      document.fonts.load(`${H * 0.05}px ${F.body}`),
    ]);
  } catch {
    // Font loading is best-effort — the faces still render in fallback type.
  }
}
