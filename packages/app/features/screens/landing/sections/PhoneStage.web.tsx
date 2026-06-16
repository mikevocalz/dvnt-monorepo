/**
 * Phone stage — WEB. Interactive Three.js device showcase.
 *
 * A live WebGL phone whose screen is a 2D canvas texture redrawn every frame
 * (feed / passes / passport tabs). Drag *outside* the screen to orbit the
 * chassis; touch the screen plane to navigate, RSVP, and trigger toasts —
 * pointer hits are raycast onto the screen mesh and mapped back to canvas px.
 *
 * The phone is built in-engine — a titanium rounded body + camera island +
 * side buttons — and its screen is a Plane textured with the 2D canvas. No
 * external GLTF asset. Native keeps the lightweight placeholder
 * (PhoneStage.native.tsx).
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RefreshCw, RotateCcw } from "lucide-react";

// High-resolution design canvas the phone screen is drawn into.
const V_WIDTH = 512;
const V_HEIGHT = 1024;

type PhoneTab = "feed" | "events" | "profile";

// ── In-phone app preview ──
// Feed + Events use the REAL DVNT app data (public, non-NSFW rows pulled from
// the production DB, served from the dvnt.b-cdn.net CDN). Profile is the only
// Pexels-backed section. The DVNT wordmark in the header matches the app shell.
const WORDMARK = "/dvnt-wordmark.svg";

const PX = (id: number, w = 500) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=${w}`;

// Real author avatars (resolved from media table)
const AV = {
  oceans: "https://dvnt.b-cdn.net/avatars/2026/02/17/1771359241309-4czxzc.jpg?v=1771359242652",
  shawn: "https://dvnt.b-cdn.net/avatars/2026/02/16/1771293503205-u3c8i3.png?v=1771293504830",
  d6: "https://dvnt.b-cdn.net/avatar/fXyJbiI06cbnnW4rdp8jckA8XQcTqLrB/2026/03/8f260dd1-7ebe-41bd-a120-5cf9f55d93e0.jpg",
  tee: "https://dvnt.b-cdn.net/avatar/RAciY76BRv9VF89YZg7PlDJ2u48hr12M/2026/03/beb7a6bf-5329-4537-be79-8ede1e10b01a.jpg?v=1774649220286",
  nola: "https://dvnt.b-cdn.net/avatar/dnc8dB7iVSClnDhPIAGF81gxsQSjJrGO/2026/04/1224fc37-adfe-44af-b130-c305f2d1a015.jpg",
  genesis: "https://dvnt.b-cdn.net/avatar/Ubd4uPLChc6W8lNkYJ11f8Zcc0Y11nII/2026/03/c052272f-25bc-446b-b51d-e5c51f65dee2.jpg?v=1774530161003",
  boe: "https://dvnt.b-cdn.net/avatar/33HUWszO0WATQHzecY5kPb1wBKjskpQ4/2026/03/294aef80-7c14-477c-b79a-ec8687d33e79.jpg?v=1774360759839",
};

const FEED_POSTS = [
  { img: "https://dvnt.b-cdn.net/posts/2026/02/21/1771716671036-kptxlt.jpeg", av: AV.oceans, user: "oceanshaffiers", likes: "10", loc: "", h: 330 },
  { img: "https://dvnt.b-cdn.net/posts/2026/02/21/1771686068439-i9x7al.jpg", av: AV.shawn, user: "shawnisaiah", likes: "9", loc: "", h: 250 },
  { img: "https://dvnt.b-cdn.net/posts/2026/02/20/1771565959106-n10595.jpeg", av: "", user: "woahmikey", likes: "9", loc: "Miami", h: 300 },
  { img: "https://dvnt.b-cdn.net/post-image/fXyJbiI06cbnnW4rdp8jckA8XQcTqLrB/2026/04/6e10dc67-1cb4-4bcc-b248-a8e5c2d8331b.jpg", av: AV.d6, user: "d6forrest", likes: "8", loc: "", h: 270 },
  { img: "https://dvnt.b-cdn.net/posts/2026/02/19/1771524495465-udkain.jpeg", av: AV.oceans, user: "oceanshaffiers", likes: "9", loc: "", h: 210 },
  { img: "https://dvnt.b-cdn.net/post-image/RAciY76BRv9VF89YZg7PlDJ2u48hr12M/2026/03/96a6446a-a10e-45b3-a6ee-11d938254e2f.jpg", av: AV.tee, user: "teeleezy", likes: "7", loc: "", h: 320 },
  { img: "https://dvnt.b-cdn.net/post-image/dnc8dB7iVSClnDhPIAGF81gxsQSjJrGO/2026/02/9a9c2e0d-2584-4637-8e28-97229a1e706f.jpg", av: AV.nola, user: "nolaboi", likes: "7", loc: "", h: 240 },
  { img: "https://dvnt.b-cdn.net/post-image/Ubd4uPLChc6W8lNkYJ11f8Zcc0Y11nII/2026/05/449e4080-3dff-418c-bb06-0617899f3138.jpg", av: AV.genesis, user: "genesisthemovement", likes: "6", loc: "Copacabana", h: 280 },
];

const EVENTS_DATA = [
  { img: "https://dvnt.b-cdn.net/event-image/pKa8v6movw4tdx0uhVN9v2IPiAEwD7ug/2026/03/87b29af0-f1f9-4edd-afbd-f74a6e290d35.jpg", day: "18", month: "JUL", title: "Spider-Man: “Brand New Day”", going: "2", price: "FREE", avatars: [AV.oceans, AV.d6] },
  { img: "https://dvnt.b-cdn.net/event-image/WU20JUKEdnFxlntkWdMVnKsKdaoiydV8/2026/05/2732e252-457e-4aa3-b46d-df8dddf88768.jpg", day: "07", month: "JUN", title: "Caliente", going: "2", price: "FREE", avatars: [AV.tee, AV.nola] },
  { img: "https://dvnt.b-cdn.net/event-image/WU20JUKEdnFxlntkWdMVnKsKdaoiydV8/2026/05/ff355df3-d329-4319-beb1-d4a4218e6e56.jpg", day: "25", month: "MAY", title: "PLAY Social", going: "3", price: "$20", avatars: [AV.oceans, AV.genesis, AV.boe] },
  { img: "https://dvnt.b-cdn.net/event-image/gIxvRoAUbA4lKTthpKcPlk4B38XEAQIK/2026/05/fb3d0a52-8d3f-488c-adfe-59bbc825f5b4.jpg", day: "30", month: "MAY", title: "Book Club", going: "2", price: "FREE", avatars: [AV.d6, AV.shawn] },
];

// Profile — the only Pexels-backed section (African-American male identity).
const PROFILE_DATA = {
  avatar: "https://images.pexels.com/photos/5082976/pexels-photo-5082976.jpeg?auto=compress&cs=tinysrgb&w=200",
  name: "Marcus Ellis",
  pronoun: "he/him",
  username: "marcusellis",
  bio1: "Resident DJ • warehouse curator",
  bio2: "Brooklyn · tapes in bio",
  link: "dvnt.app/marcusellis",
  stats: [["128", "Posts"], ["8.4k", "Followers"], ["312", "Following"]] as [string, string][],
  posts: [PX(5082974), PX(1190298), PX(167636), PX(1267350), PX(2114365), PX(1763075), PX(2747449), PX(1717969)],
};

const imgReady = (img?: HTMLImageElement) =>
  !!img && img.complete && img.naturalWidth > 0;

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | undefined,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.clip();
  if (imgReady(img)) {
    const ir = img!.naturalWidth / img!.naturalHeight;
    const tr = w / h;
    if (ir > tr) {
      const dh = h, dw = h * ir, dx = x - (dw - w) / 2, dy = y;
      ctx.drawImage(img!, dx, dy, dw, dh);
    } else {
      const dw = w, dh = w / ir, dx = x, dy = y - (dh - h) / 2;
      ctx.drawImage(img!, dx, dy, dw, dh);
    }
  } else {
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, "#1b1535");
    g.addColorStop(1, "#0a0a12");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

// Avatars in DVNT are ALWAYS rounded squares — never circles.
function drawAvatarSquare(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | undefined,
  x: number, y: number, size: number, radius: number, fallback?: string,
) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, radius);
  ctx.clip();
  if (imgReady(img)) {
    const ir = img!.naturalWidth / img!.naturalHeight;
    if (ir > 1) {
      const dh = size, dw = size * ir, dx = x - (dw - size) / 2, dy = y;
      ctx.drawImage(img!, dx, dy, dw, dh);
    } else {
      const dw = size, dh = size / ir, dx = x, dy = y - (dh - size) / 2;
      ctx.drawImage(img!, dx, dy, dw, dh);
    }
  } else {
    const g = ctx.createLinearGradient(x, y, x + size, y + size);
    g.addColorStop(0, "#3a2d5a");
    g.addColorStop(1, "#1a1530");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, size, size);
    if (fallback) {
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = `bold ${Math.round(size * 0.46)}px "Space Grotesk", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(fallback, x + size / 2, y + size / 2 + 1);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }
  }
  ctx.restore();
}

// ── Header icons (stroked, matching the lucide set the app shell uses) ──
function drawSearchIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.save();
  ctx.strokeStyle = "#FAFAF9";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx - 1, cy - 1, 7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + 4, cy + 4);
  ctx.lineTo(cx + 9, cy + 9);
  ctx.stroke();
  ctx.restore();
}

function drawMessageIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.save();
  ctx.strokeStyle = "#FAFAF9";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.roundRect(cx - 10, cy - 9, 20, 16, 5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 6, cy + 7);
  ctx.lineTo(cx - 6, cy + 12);
  ctx.lineTo(cx - 1, cy + 7);
  ctx.stroke();
  ctx.restore();
}

function drawGearIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.save();
  ctx.strokeStyle = "#FAFAF9";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * 7, cy + Math.sin(a) * 7);
    ctx.lineTo(cx + Math.cos(a) * 10, cy + Math.sin(a) * 10);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHeart(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, s: number, color: string,
) {
  ctx.save();
  ctx.fillStyle = color;
  const top = cy - s * 0.35;
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.5);
  ctx.bezierCurveTo(cx - s * 1.1, cy - s * 0.25, cx - s * 0.55, top - s * 0.7, cx, top);
  ctx.bezierCurveTo(cx + s * 0.55, top - s * 0.7, cx + s * 1.1, cy - s * 0.25, cx, cy + s * 0.5);
  ctx.fill();
  ctx.restore();
}

function drawBookmarkIcon(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, color: string,
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w / 2, y + h - h * 0.34);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

export function PhoneStage() {
  const [activeTab, setActiveTab] = useState<PhoneTab>("feed");
  const [toast, setToast] = useState<string | null>(null);
  const [systemLogs, setSystemLogs] = useState<string[]>([
    "DVNT Mobile System: Secure Session Booted",
    "Passport Cryptography Matrix: Loaded",
  ]);

  // Mirror of React state the render loop reads each frame (no re-render churn).
  const stateRef = useRef({
    activeTab,
    toast,
    scrollY: 0,
    maxScroll: 190,
    isDraggingScroll: false,
    dragStartY: 0,
    dragStartScrollY: 0,
    needsRedraw: true,
    hoveredBtn: null as string | null,
  });

  useEffect(() => {
    stateRef.current.activeTab = activeTab;
    // maxScroll is recomputed from the real content height each frame in
    // drawScreenFrame; just snap back to the top when switching tabs.
    stateRef.current.scrollY = 0;
    stateRef.current.needsRedraw = true;
  }, [activeTab]);
  useEffect(() => {
    stateRef.current.toast = toast;
    stateRef.current.needsRedraw = true;
  }, [toast]);

  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const imagesRef = useRef<Record<string, HTMLImageElement>>({});

  // Preload the Pexels imagery painted into the phone screen. crossOrigin keeps
  // the WebGL canvas-texture untainted — a failed CORS load simply errors and
  // the frame falls back to a gradient placeholder instead of drawing.
  useEffect(() => {
    const urls = new Set<string>([WORDMARK]);
    FEED_POSTS.forEach((p) => {
      urls.add(p.img);
      if (p.av) urls.add(p.av);
    });
    EVENTS_DATA.forEach((e) => {
      urls.add(e.img);
      e.avatars.forEach((a) => urls.add(a));
    });
    PROFILE_DATA.posts.forEach((u) => urls.add(u));
    urls.add(PROFILE_DATA.avatar);
    const store = imagesRef.current;
    urls.forEach((u) => {
      if (store[u]) return;
      const im = new Image();
      im.crossOrigin = "anonymous";
      // Repaint the screen texture once each asset arrives (it streams in after
      // the first frame); without this the gated loop would never show them.
      im.onload = () => {
        stateRef.current.needsRedraw = true;
      };
      im.src = u;
      store[u] = im;
    });
  }, []);

  const addLog = (msg: string) =>
    setSystemLogs((prev) => [msg, ...prev.slice(0, 5)]);

  const triggerToast = (message: string) => {
    setToast(message);
    addLog(`System Signal: ${message}`);
    window.setTimeout(() => setToast(null), 3800);
  };

  const resetOrientation = () => {
    if (controlsRef.current && cameraRef.current) {
      controlsRef.current.reset();
      cameraRef.current.position.set(0, 0, 2.3);
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.autoRotate = false;
      addLog("Sensory Matrix: Device aligned to front projection.");
    }
  };

  const setManualRotate = () => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = !controlsRef.current.autoRotate;
      addLog(
        `Auto Rotation state: ${controlsRef.current.autoRotate ? "ON" : "OFF"}`,
      );
    }
  };

  // ── High-fidelity screen frame (drawn into the canvas texture each tick) ──
  const drawScreenFrame = (ctx: CanvasRenderingContext2D) => {
    const current = stateRef.current;

    ctx.fillStyle = "#020203";
    ctx.fillRect(0, 0, V_WIDTH, V_HEIGHT);

    // Diagonal atmospheric mesh
    ctx.strokeStyle = "rgba(168, 85, 247, 0.05)";
    ctx.lineWidth = 1;
    for (let i = 0; i < V_WIDTH + V_HEIGHT; i += 45) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i - V_HEIGHT, V_HEIGHT);
      ctx.stroke();
    }

    // Status bar
    ctx.fillStyle = "#07070a";
    ctx.fillRect(0, 0, V_WIDTH, 64);
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 64);
    ctx.lineTo(V_WIDTH, 64);
    ctx.stroke();

    for (let b = 0; b < 4; b++) {
      ctx.fillStyle = b < 3 ? "#a855f7" : "rgba(255,255,255,0.2)";
      ctx.fillRect(390 + b * 6, 38 - b * 3, 4, b * 3 + 4);
    }
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "bold 12px monospace";
    ctx.fillText("5G", 420, 36);

    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(450, 24, 34, 16);
    ctx.fillStyle = "#22c55e";
    ctx.fillRect(452, 26, 26, 12);
    ctx.fillRect(484, 29, 3, 6);

    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "bold 17px monospace";
    ctx.fillText("1:14 AM", 28, 36);

    // Camera punch-hole pill
    ctx.fillStyle = "#0a0a0f";
    ctx.beginPath();
    ctx.roundRect(V_WIDTH / 2 - 60, 18, 120, 24, 12);
    ctx.fill();
    ctx.strokeStyle = "rgba(168, 85, 247, 0.15)";
    ctx.stroke();
    ctx.fillStyle = "#1e1b4b";
    ctx.beginPath();
    ctx.arc(V_WIDTH / 2 - 40, 30, 5, 0, Math.PI * 2);
    ctx.fill();

    // App header — mirrors the DVNT app shell: logo (or @username on profile)
    // on the left, search + messages icons (or settings on profile) on the right.
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 64, V_WIDTH, 76);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 140);
    ctx.lineTo(V_WIDTH, 140);
    ctx.stroke();

    const headerCY = 103;
    if (current.activeTab === "profile") {
      ctx.textAlign = "left";
      ctx.fillStyle = "#FAFAF9";
      ctx.font = 'bold 16px "Space Grotesk", sans-serif';
      ctx.fillText("@" + PROFILE_DATA.username, 22, headerCY + 5);
      drawGearIcon(ctx, V_WIDTH - 36, headerCY);
    } else {
      const wm = imagesRef.current[WORDMARK];
      if (imgReady(wm)) {
        const hgt = 30;
        const wdt = (hgt * wm!.naturalWidth) / wm!.naturalHeight;
        ctx.drawImage(wm!, 22, headerCY - hgt / 2, wdt, hgt);
      } else {
        ctx.textAlign = "left";
        ctx.fillStyle = "#ffffff";
        ctx.font = 'bold 22px "Space Grotesk", sans-serif';
        ctx.fillText("DVNT", 22, headerCY + 7);
      }
      drawSearchIcon(ctx, V_WIDTH - 94, headerCY);
      drawMessageIcon(ctx, V_WIDTH - 40, headerCY);
      // Unread badge (purple, matching #8A40CF)
      ctx.fillStyle = "#8A40CF";
      ctx.beginPath();
      ctx.roundRect(V_WIDTH - 36, headerCY - 14, 16, 16, 8);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.fillText("3", V_WIDTH - 28, headerCY - 3);
      ctx.textAlign = "left";
    }

    // Clipped scrolling content board
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 140, V_WIDTH, 780);
    ctx.clip();
    const drawYOffset = 140 - current.scrollY;
    const imgs = imagesRef.current;

    if (current.activeTab === "feed") {
      // ── Public feed — 2-column masonry of post cards ──
      const padX = 14;
      const gap = 12;
      const colW = (V_WIDTH - padX * 2 - gap) / 2;
      const colY = [drawYOffset + 14, drawYOffset + 14];

      FEED_POSTS.forEach((post) => {
        const col = colY[0] <= colY[1] ? 0 : 1;
        const x = padX + col * (colW + gap);
        const y = colY[col];
        const h = post.h;

        drawCoverImage(ctx, imgs[post.img], x, y, colW, h, 14);

        // Bottom scrim
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x, y, colW, h, 14);
        ctx.clip();
        const grad = ctx.createLinearGradient(0, y + h - 90, 0, y + h);
        grad.addColorStop(0, "rgba(0,0,0,0)");
        grad.addColorStop(1, "rgba(0,0,0,0.78)");
        ctx.fillStyle = grad;
        ctx.fillRect(x, y + h - 90, colW, 90);
        ctx.restore();

        // Top-left glass avatar (rounded square) + username pill
        const handle = "@" + post.user;
        ctx.font = 'bold 12px "Space Grotesk", sans-serif';
        const nameW = ctx.measureText(handle).width;
        const pillW = 7 + 22 + 7 + nameW + 11;
        ctx.fillStyle = "rgba(10,10,16,0.45)";
        ctx.beginPath();
        ctx.roundRect(x + 8, y + 8, pillW, 34, 12);
        ctx.fill();
        drawAvatarSquare(
          ctx,
          imgs[post.av],
          x + 15,
          y + 14,
          22,
          7,
          post.user.charAt(0).toUpperCase(),
        );
        ctx.fillStyle = "#ffffff";
        ctx.fillText(handle, x + 15 + 22 + 7, y + 30);

        // Bottom action row: heart + like count, bookmark
        drawHeart(ctx, x + 18, y + h - 22, 7, "#FF5BFC");
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 11px monospace";
        ctx.fillText(post.likes, x + 30, y + h - 18);
        drawBookmarkIcon(ctx, x + colW - 26, y + h - 31, 11, 14, "#3FDCFF");
        if (post.loc) {
          ctx.fillStyle = "rgba(255,255,255,0.7)";
          ctx.font = "10px monospace";
          ctx.fillText(post.loc, x + 58, y + h - 18);
        }

        colY[col] += h + gap;
      });

      const bottomY = Math.max(colY[0], colY[1]);
      current.maxScroll = Math.max(0, bottomY - drawYOffset - 780 + 28);
    } else if (current.activeTab === "events") {
      // ── Events — tall rounded cover cards ──
      const padX = 16;
      const cardW = V_WIDTH - padX * 2;
      const cardH = 300;
      const gapE = 18;

      EVENTS_DATA.forEach((ev, i) => {
        const x = padX;
        const y = drawYOffset + 12 + i * (cardH + gapE);
        const r = 26;

        drawCoverImage(ctx, imgs[ev.img], x, y, cardW, cardH, r);

        // Overlay gradient
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x, y, cardW, cardH, r);
        ctx.clip();
        const g = ctx.createLinearGradient(0, y + cardH - 200, 0, y + cardH);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(0.6, "rgba(0,0,0,0.45)");
        g.addColorStop(1, "rgba(0,0,0,0.88)");
        ctx.fillStyle = g;
        ctx.fillRect(x, y + cardH - 200, cardW, 200);
        ctx.restore();

        // Date badge (top-right)
        const bw = 64;
        const bh = 64;
        ctx.fillStyle = "#000000";
        ctx.beginPath();
        ctx.roundRect(x + cardW - bw - 14, y + 14, bw, bh, 18);
        ctx.fill();
        ctx.textAlign = "center";
        ctx.fillStyle = "#ffffff";
        ctx.font = 'bold 28px "Space Grotesk", sans-serif';
        ctx.fillText(ev.day, x + cardW - 14 - bw / 2, y + 14 + 34);
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.font = "bold 10px monospace";
        ctx.fillText(ev.month, x + cardW - 14 - bw / 2, y + 14 + 52);
        ctx.textAlign = "left";

        // Title + going count
        const titleBaseline = y + cardH - 84;
        ctx.fillStyle = "#ffffff";
        ctx.font = 'bold 23px "Space Grotesk", sans-serif';
        ctx.fillText(ev.title, x + 20, titleBaseline + 6);
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.font = "13px sans-serif";
        ctx.fillText(`${ev.going} going`, x + 20, titleBaseline + 30);

        // Attendee avatars (stacked rounded squares with a dark border)
        const ay = y + cardH - 44;
        const asz = 26;
        ev.avatars.forEach((a, idx) => {
          const ax = x + 20 + idx * 17;
          ctx.fillStyle = "#000000";
          ctx.beginPath();
          ctx.roundRect(ax - 2, ay - 2, asz + 4, asz + 4, 9);
          ctx.fill();
          drawAvatarSquare(ctx, imgs[a], ax, ay, asz, 7);
        });

        // Price pill (right)
        ctx.font = 'bold 15px "Space Grotesk", sans-serif';
        const pw = ctx.measureText(ev.price).width + 34;
        ctx.fillStyle = "#3EA2E5";
        ctx.beginPath();
        ctx.roundRect(x + cardW - pw - 16, ay + asz / 2 - 18, pw, 36, 18);
        ctx.fill();
        ctx.textAlign = "center";
        ctx.fillStyle = "#ffffff";
        ctx.fillText(ev.price, x + cardW - 16 - pw / 2, ay + asz / 2 + 5);
        ctx.textAlign = "left";
      });

      const bottomY =
        drawYOffset + 12 + EVENTS_DATA.length * (cardH + gapE);
      current.maxScroll = Math.max(0, bottomY - drawYOffset - 780 + 28);
    } else {
      // ── Profile ──
      const padX = 20;
      const avSize = 78;
      const avX = padX;
      const avY = drawYOffset + 14;
      const avCy = avY + avSize / 2;

      // Avatar — rounded square with cyan ring (never circular)
      ctx.strokeStyle = "#34A2DF";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(avX - 1, avY - 1, avSize + 2, avSize + 2, 19);
      ctx.stroke();
      drawAvatarSquare(
        ctx,
        imgs[PROFILE_DATA.avatar],
        avX,
        avY,
        avSize,
        18,
        PROFILE_DATA.name.charAt(0),
      );

      // Stats row
      const sx0 = padX + avSize + 22;
      const sgap = (V_WIDTH - padX - sx0) / PROFILE_DATA.stats.length;
      ctx.textAlign = "center";
      PROFILE_DATA.stats.forEach((s, i) => {
        const cx = sx0 + sgap * i + sgap / 2;
        ctx.fillStyle = "#ffffff";
        ctx.font = 'bold 19px "Space Grotesk", sans-serif';
        ctx.fillText(s[0], cx, avCy - 2);
        ctx.fillStyle = "#a3a3a3";
        ctx.font = "11px sans-serif";
        ctx.fillText(s[1], cx, avCy + 17);
      });
      ctx.textAlign = "left";

      let yy = avY + avSize + 26;

      // Name + pronoun pill
      ctx.fillStyle = "#ffffff";
      ctx.font = 'bold 17px "Space Grotesk", sans-serif';
      ctx.fillText(PROFILE_DATA.name, padX, yy);
      const nameW = ctx.measureText(PROFILE_DATA.name).width;
      ctx.font = "10px monospace";
      const prW = ctx.measureText(PROFILE_DATA.pronoun).width + 16;
      ctx.fillStyle = "rgba(138,64,207,0.25)";
      ctx.beginPath();
      ctx.roundRect(padX + nameW + 10, yy - 13, prW, 18, 9);
      ctx.fill();
      ctx.fillStyle = "#C084FC";
      ctx.fillText(PROFILE_DATA.pronoun, padX + nameW + 18, yy);

      yy += 24;
      ctx.fillStyle = "rgba(248,250,252,0.9)";
      ctx.font = "13px sans-serif";
      ctx.fillText(PROFILE_DATA.bio1, padX, yy);
      yy += 19;
      ctx.fillStyle = "#a3a3a3";
      ctx.fillText(PROFILE_DATA.bio2, padX, yy);
      yy += 19;
      ctx.fillStyle = "#3EA2E5";
      ctx.font = "bold 13px sans-serif";
      ctx.fillText(PROFILE_DATA.link, padX, yy);

      yy += 18;
      // Edit / Share buttons
      const btnW = (V_WIDTH - padX * 2 - 10) / 2;
      ["Edit profile", "Share"].forEach((label, i) => {
        const bx = padX + i * (btnW + 10);
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        ctx.beginPath();
        ctx.roundRect(bx, yy, btnW, 38, 10);
        ctx.fill();
        ctx.textAlign = "center";
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 13px sans-serif";
        ctx.fillText(label, bx + btnW / 2, yy + 24);
        ctx.textAlign = "left";
      });

      yy += 54;
      // Tab strip
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padX, yy);
      ctx.lineTo(V_WIDTH - padX, yy);
      ctx.stroke();
      const pTabs = ["POSTS", "REELS", "SAVED", "TAGGED"];
      const ptw = (V_WIDTH - padX * 2) / pTabs.length;
      ctx.textAlign = "center";
      pTabs.forEach((t, i) => {
        const cx = padX + ptw * i + ptw / 2;
        ctx.fillStyle = i === 0 ? "#ffffff" : "#737373";
        ctx.font = i === 0 ? "bold 11px monospace" : "11px monospace";
        ctx.fillText(t, cx, yy + 24);
        if (i === 0) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(cx - 22, yy + 34, 44, 2);
        }
      });
      ctx.textAlign = "left";

      yy += 48;
      // Masonry grid of profile posts
      const ggap = 8;
      const gcolW = (V_WIDTH - padX * 2 - ggap) / 2;
      const gcolY = [yy, yy];
      PROFILE_DATA.posts.forEach((u, idx) => {
        const col = gcolY[0] <= gcolY[1] ? 0 : 1;
        const gx = padX + col * (gcolW + ggap);
        const gy = gcolY[col];
        const gh = idx % 3 === 0 ? 180 : idx % 3 === 1 ? 150 : 200;
        drawCoverImage(ctx, imgs[u], gx, gy, gcolW, gh, 10);
        gcolY[col] += gh + ggap;
      });

      const bottomY = Math.max(gcolY[0], gcolY[1]);
      current.maxScroll = Math.max(0, bottomY - drawYOffset - 780 + 28);
    }

    ctx.restore();

    // Bottom tab bar
    ctx.fillStyle = "#09090d";
    ctx.fillRect(0, 920, V_WIDTH, 104);
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 920);
    ctx.lineTo(V_WIDTH, 920);
    ctx.stroke();

    const tabs: { id: PhoneTab; label: string; x: number }[] = [
      { id: "feed", label: "FEED", x: 85 },
      { id: "events", label: "EVENTS", x: 256 },
      { id: "profile", label: "PROFILE", x: 427 },
    ];

    tabs.forEach((tab) => {
      const isSelected = current.activeTab === tab.id;
      if (isSelected) {
        ctx.fillStyle = "rgba(168, 85, 247, 0.1)";
        ctx.beginPath();
        ctx.arc(tab.x, 970, 48, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#d946ef";
        ctx.fillRect(tab.x - 22, 1010, 44, 4);
      }
      ctx.strokeStyle = isSelected ? "#d946ef" : "rgba(255,255,255,0.4)";
      ctx.lineWidth = 2.5;

      if (tab.id === "feed") {
        ctx.beginPath();
        ctx.arc(tab.x, 954, 11, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = isSelected ? "#d946ef" : "rgba(255,255,255,0.4)";
        ctx.beginPath();
        ctx.moveTo(tab.x, 947);
        ctx.lineTo(tab.x + 3, 954);
        ctx.lineTo(tab.x - 3, 954);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(tab.x, 961);
        ctx.lineTo(tab.x + 3, 954);
        ctx.lineTo(tab.x - 3, 954);
        ctx.closePath();
        ctx.fill();
      } else if (tab.id === "events") {
        ctx.strokeRect(tab.x - 14, 944, 28, 18);
        ctx.beginPath();
        ctx.arc(tab.x - 14, 953, 3, -Math.PI / 2, Math.PI / 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(tab.x + 14, 953, 3, Math.PI / 2, -Math.PI / 2);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(tab.x, 948, 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(tab.x, 966, 11, Math.PI, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = isSelected ? "#ffffff" : "#475569";
      ctx.font = "bold 10px monospace";
      ctx.fillText(tab.label, tab.x - ctx.measureText(tab.label).width / 2, 988);
    });

    // Floating toast
    if (current.toast) {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = 30;
      ctx.shadowOffsetY = 15;
      ctx.fillStyle = "rgba(10,10,12,0.95)";
      ctx.beginPath();
      ctx.roundRect(32, 85, V_WIDTH - 64, 76, 16);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.strokeStyle = "rgba(236,72,153,0.3)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "#22c55e";
      ctx.beginPath();
      ctx.arc(60, 123, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "12px monospace";
      const maxW = V_WIDTH - 150;
      const words = current.toast.split(" ");
      let line = "";
      let lineCount = 0;
      for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + " ";
        if (ctx.measureText(testLine).width > maxW && n > 0) {
          ctx.fillText(line, 86, 116 + lineCount * 18);
          line = words[n] + " ";
          lineCount++;
        } else {
          line = testLine;
        }
      }
      ctx.fillText(line, 86, 116 + lineCount * 18);
      ctx.restore();
    }
  };

  // Hit-test on the (unscrolled) screen canvas coordinate space.
  const handleVirtualScreenInteraction = (
    cx: number,
    cy: number,
    type: "down" | "move" | "up",
  ) => {
    const current = stateRef.current;
    let hovered: string | null = null;

    if (cy >= 920 && cy <= 1024) {
      if (type === "down") {
        if (cx <= 170) {
          setActiveTab("feed");
          triggerToast("Feed: switched to the public feed.");
        } else if (cx <= 340) {
          setActiveTab("events");
          triggerToast("Events: tonight and upcoming gatherings.");
        } else {
          setActiveTab("profile");
          triggerToast("Profile: your passport and posts.");
        }
      }
      current.hoveredBtn = null;
      return;
    }

    if (cy >= 140 && cy <= 920) {
      // Content area: drag to scroll the masonry feed / events / profile.
      if (type === "down") {
        current.isDraggingScroll = true;
        current.dragStartY = cy;
        current.dragStartScrollY = current.scrollY;
      }
    }

    if (current.isDraggingScroll && type === "move") {
      const delta = cy - current.dragStartY;
      const next = Math.max(
        0,
        Math.min(current.maxScroll, current.dragStartScrollY - delta),
      );
      if (next !== current.scrollY) {
        current.scrollY = next;
        current.needsRedraw = true;
      }
    }

    current.hoveredBtn = hovered;
    if (hovered || cy >= 920) document.body.style.cursor = "pointer";
    else if (current.isDraggingScroll) document.body.style.cursor = "grabbing";
    else document.body.style.cursor = "default";
  };

  const endVirtualScreenInteraction = () => {
    stateRef.current.isDraggingScroll = false;
    document.body.style.cursor = "default";
  };

  // ── Three.js scene ──
  useEffect(() => {
    if (!mountRef.current) return;
    const container = mountRef.current;
    const scrollState = stateRef.current;

    const clientW = container.clientWidth;
    const clientH = container.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, clientW / clientH, 0.1, 10);
    camera.position.set(0, 0, 2.3);
    cameraRef.current = camera;

    // Guard: if WebGL can't initialize (rare / headless), degrade to the static
    // copy rather than crashing the whole landing.
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (e) {
      console.warn("[PhoneStage] WebGL unavailable — skipping 3D stage", e);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(clientW, clientH);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    // No shadows: there's no ground/receiver plane, so the shadow pass cost
    // nothing visually while re-rendering every frame as the phone spins.
    renderer.shadowMap.enabled = false;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Environment map — metals reflect this; without it a metalness≈1 phone
    // renders pure black. RoomEnvironment gives soft studio reflections.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;

    // Lighting rig — hemisphere fill + key spot + neon rim accents.
    scene.add(new THREE.HemisphereLight(0xbfd3ff, 0x1a0f2e, 1.1));
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const frontSpot = new THREE.SpotLight(0xffffff, 9.0, 0, Math.PI / 4, 0.8);
    frontSpot.position.set(0.6, 3.0, 4.5);
    scene.add(frontSpot);
    const keyDir = new THREE.DirectionalLight(0xffffff, 2.2);
    keyDir.position.set(-1.5, 2.5, 3.5);
    scene.add(keyDir);
    const leftNeon = new THREE.PointLight(0x8a40cf, 14, 18);
    leftNeon.position.set(-2.2, 1.6, 1.2);
    scene.add(leftNeon);
    const rightNeon = new THREE.PointLight(0x3fdcff, 12, 18);
    rightNeon.position.set(2.4, -0.6, 1.6);
    scene.add(rightNeon);
    const bottomNeon = new THREE.PointLight(0xff5bfc, 10, 14);
    bottomNeon.position.set(0.2, -2.2, 1.4);
    scene.add(bottomNeon);

    // Screen canvas texture
    const canvas = document.createElement("canvas");
    canvas.width = V_WIDTH;
    canvas.height = V_HEIGHT;
    const ctx = canvas.getContext("2d");
    const canvasTexture = new THREE.CanvasTexture(canvas);
    canvasTexture.minFilter = THREE.LinearFilter;
    canvasTexture.magFilter = THREE.LinearFilter;
    canvasTexture.colorSpace = THREE.SRGBColorSpace;

    let screenMeshRef: THREE.Mesh | null = null;
    let logoTexture: THREE.CanvasTexture | null = null;

    // Titanium phone built in-engine; the screen is the canvas texture.
    const buildPhone = (): THREE.Object3D => {
      const group = new THREE.Group();
      const W = 0.62;
      const H = 1.24;
      const D = 0.07;

      const bodyMat = new THREE.MeshStandardMaterial({
        color: 0x2a2d34, // brushed titanium charcoal (lifted so it reads)
        roughness: 0.38,
        metalness: 0.85,
        envMapIntensity: 1.4,
      });
      const body = new THREE.Mesh(
        new RoundedBoxGeometry(W, H, D, 6, 0.09),
        bodyMat,
      );
      group.add(body);

      // ── DVNT logo on the titanium back ──
      // The full-color brand SVG (gradient mark, same as the site header) is
      // rasterized to a transparent texture and laid on the back as a flat
      // colored decal. toneMapped:false keeps the gradient vivid against the
      // ACES-graded chassis.
      const logoMat = new THREE.MeshBasicMaterial({
        transparent: true,
        toneMapped: false,
        depthWrite: false,
      });
      const logoSize = 0.42;
      const logo = new THREE.Mesh(
        new THREE.PlaneGeometry(logoSize, logoSize),
        logoMat,
      );
      // Sit just behind the back face, normal pointing out the back (-z).
      logo.position.set(0, -0.04, -D / 2 - 0.001);
      logo.rotation.y = Math.PI;
      group.add(logo);

      // Rasterize the SVG → full-color, transparent-background texture.
      const logoImg = new Image();
      logoImg.onload = () => {
        const px = 1024;
        const lc = document.createElement("canvas");
        lc.width = px;
        lc.height = px;
        const lctx = lc.getContext("2d");
        if (!lctx) return;
        lctx.drawImage(logoImg, 0, 0, px, px);
        const tex = new THREE.CanvasTexture(lc);
        tex.colorSpace = THREE.SRGBColorSpace;
        logoMat.map = tex;
        logoMat.needsUpdate = true;
        logoTexture = tex;
      };
      logoImg.src = "/dvnt-logo.svg";

      // Screen plane (UV 0..1 → maps to the canvas hit-test space)
      const screenMat = new THREE.MeshBasicMaterial({
        map: canvasTexture,
        toneMapped: false,
      });
      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(W - 0.06, H - 0.06),
        screenMat,
      );
      screen.position.z = D / 2 + 0.002;
      screen.name = "ScreenNode";
      group.add(screen);
      screenMeshRef = screen;

      // Camera island on the back
      const island = new THREE.Mesh(
        new RoundedBoxGeometry(0.22, 0.22, 0.03, 4, 0.04),
        new THREE.MeshStandardMaterial({
          color: 0x08080a,
          roughness: 0.1,
          metalness: 0.95,
        }),
      );
      island.position.set(-W / 2 + 0.18, H / 2 - 0.2, -D / 2 - 0.012);
      group.add(island);
      const lensMat = new THREE.MeshStandardMaterial({
        color: 0x020202,
        roughness: 0.02,
        metalness: 0.98,
      });
      [
        [-0.05, 0.04],
        [0.04, 0.04],
        [-0.05, -0.05],
      ].forEach(([lx, ly]) => {
        const lens = new THREE.Mesh(
          new THREE.CylinderGeometry(0.038, 0.038, 0.02, 24),
          lensMat,
        );
        lens.rotation.x = Math.PI / 2;
        lens.position.set(
          island.position.x + lx,
          island.position.y + ly,
          -D / 2 - 0.028,
        );
        group.add(lens);
      });

      // Side buttons (gunmetal)
      const btnMat = new THREE.MeshStandardMaterial({
        color: 0x18191c,
        roughness: 0.22,
        metalness: 1.0,
      });
      const power = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.16, 0.03), btnMat);
      power.position.set(W / 2 + 0.004, 0.12, 0);
      group.add(power);
      [0.18, 0.04].forEach((vy) => {
        const vol = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.1, 0.03), btnMat);
        vol.position.set(-W / 2 - 0.004, vy, 0);
        group.add(vol);
      });

      return group;
    };

    const phone = buildPhone();
    phone.position.set(0, -0.04, 0);
    phone.rotation.set(0.12, -0.55, -0.04);
    scene.add(phone);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.6;
    controls.minDistance = 1.2;
    controls.maxDistance = 3.6;
    controls.enablePan = false;
    controlsRef.current = controls;

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const getScreenUV = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(scene.children, true);
      for (const hit of intersects) {
        if (hit.object === screenMeshRef) return hit.uv ?? null;
      }
      return null;
    };

    const onPointer = (
      clientX: number,
      clientY: number,
      type: "down" | "move" | "up",
    ) => {
      const uv = getScreenUV(clientX, clientY);
      if (uv) {
        const cx = uv.x * V_WIDTH;
        const cy = (1.0 - uv.y) * V_HEIGHT;
        if (type === "down") {
          controls.enabled = false;
          controls.autoRotate = false;
        }
        handleVirtualScreenInteraction(cx, cy, type);
      } else {
        if (type === "down") {
          controls.enabled = true;
          controls.autoRotate = false;
        }
        if (type === "move") {
          document.body.style.cursor = "default";
          scrollState.hoveredBtn = null;
        }
      }
      if (type === "up") {
        controls.enabled = true;
        endVirtualScreenInteraction();
      }
    };

    const handleDown = (e: PointerEvent) => onPointer(e.clientX, e.clientY, "down");
    const handleMove = (e: PointerEvent) => onPointer(e.clientX, e.clientY, "move");
    const handleUp = (e: PointerEvent) => onPointer(e.clientX, e.clientY, "up");
    const el = renderer.domElement;
    el.addEventListener("pointerdown", handleDown);
    el.addEventListener("pointermove", handleMove);
    el.addEventListener("pointerup", handleUp);

    // Pause the loop while the canvas is offscreen.
    let visible = true;
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
      },
      { threshold: 0.01 },
    );
    io.observe(container);

    const reduce =
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
        : false;
    if (reduce) controls.autoRotate = false;

    let frameId = 0;
    const tick = () => {
      frameId = requestAnimationFrame(tick);
      if (!visible) return;
      // The screen artwork is static apart from scroll / tab / toast changes,
      // so only repaint the 512×1024 canvas and re-upload the (≈2MB) texture
      // when something actually changed. The 3D chassis still renders every
      // frame for smooth orbiting — that part is cheap.
      if (ctx && scrollState.needsRedraw) {
        drawScreenFrame(ctx);
        canvasTexture.needsUpdate = true;
        scrollState.needsRedraw = false;
      }
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    const resizeHandler = () => {
      const nextW = container.clientWidth;
      const nextH = container.clientHeight;
      camera.aspect = nextW / nextH;
      camera.updateProjectionMatrix();
      renderer.setSize(nextW, nextH);
    };
    window.addEventListener("resize", resizeHandler);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resizeHandler);
      io.disconnect();
      el.removeEventListener("pointerdown", handleDown);
      el.removeEventListener("pointermove", handleMove);
      el.removeEventListener("pointerup", handleUp);
      if (container.contains(el)) container.removeChild(el);
      controls.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry?.dispose?.();
          const m = o.material as THREE.Material | THREE.Material[];
          if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
          else m?.dispose?.();
        }
      });
      canvasTexture.dispose();
      logoTexture?.dispose();
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section id="app" className="dvnt-ps-section" style={styles.section}>
      <style>{CSS}</style>
      <div className="dvnt-ps-orb" style={styles.orbA} />
      <div className="dvnt-ps-orb" style={styles.orbB} />
      <div style={styles.inner}>
        {/* Left — copy + control desk */}
        <div style={styles.copyCol}>
          <span style={styles.kicker}>Everything before the night starts</span>
          <h2 className="dvnt-ps-h2" style={styles.h2}>Find the room. Buy the ticket. See who&apos;s outside.</h2>
          <p style={styles.lede}>
            DVNT connects the digital build-up to the real-life moment. Drag
            anywhere around the phone to orbit the titanium chassis and inspect
            it — then touch the screen to switch tabs, claim a pass, or scroll
            the feed.
          </p>

          <div style={styles.desk}>
            <h4 style={styles.deskTitle}>Device controls</h4>
            <div style={styles.deskRow}>
              <button onClick={resetOrientation} style={styles.deskBtn} type="button">
                <RotateCcw width={14} height={14} color="#FF5BFC" />
                <span>Snap front</span>
              </button>
              <button onClick={setManualRotate} style={styles.deskBtn} type="button">
                <RefreshCw width={14} height={14} color="#8A40CF" />
                <span>Toggle spin</span>
              </button>
            </div>
            <div style={styles.tabRow}>
              {(["feed", "events", "profile"] as PhoneTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab);
                    triggerToast(`Matrix: Loaded ${tab.toUpperCase()} layout.`);
                  }}
                  style={{
                    ...styles.tabBtn,
                    ...(activeTab === tab ? styles.tabBtnActive : null),
                  }}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div style={styles.logs}>
            <span style={styles.logsHead}>Device signals</span>
            {systemLogs.map((log, i) => (
              <div key={i} style={styles.logRow}>
                <span>{log}</span>
                <span style={styles.logOk}>✓</span>
              </div>
            ))}
          </div>

          <div style={styles.ctaRow}>
            <a href="/auth/login" style={styles.ctaPrimary}>Explore the app</a>
          </div>
        </div>

        {/* Right — WebGL canvas */}
        <div className="dvnt-ps-stage" style={styles.stageCol}>
          <div style={styles.stageFlare} />
          <div ref={mountRef} style={styles.canvasMount} />
          <div style={styles.hint}>
            <span style={styles.hintDot} />
            Click &amp; drag around the phone to rotate &amp; inspect
          </div>
        </div>
      </div>
    </section>
  );
}

const CSS = `
@media (max-width: 900px) {
  .dvnt-ps-section { padding-top: 64px !important; padding-bottom: 64px !important; }
  /* The 450px blur orbs are placed by percentage and spill past a phone
     viewport; the section is overflow:visible, so hide them on small screens. */
  .dvnt-ps-orb { display: none !important; }
  .dvnt-ps-stage { height: 520px !important; }
}
@media (max-width: 480px) {
  .dvnt-ps-stage { height: 440px !important; }
}`;

const styles: Record<string, React.CSSProperties> = {
  section: {
    position: "relative",
    background: "#040406",
    color: "#fff",
    paddingTop: 96,
    paddingBottom: 96,
    paddingLeft: 24,
    paddingRight: 24,
    borderTop: "1px solid rgba(255,255,255,0.05)",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
    // Let the phone breathe past the section bounds (no clipping).
    overflow: "visible",
  },
  orbA: {
    position: "absolute",
    top: "50%",
    left: "22%",
    width: 450,
    height: 450,
    transform: "translateY(-50%)",
    background: "rgba(138,64,207,0.10)",
    borderRadius: "50%",
    filter: "blur(140px)",
    pointerEvents: "none",
  },
  orbB: {
    position: "absolute",
    top: "50%",
    right: "20%",
    width: 450,
    height: 450,
    transform: "translateY(-50%)",
    background: "rgba(63,220,255,0.06)",
    borderRadius: "50%",
    filter: "blur(140px)",
    pointerEvents: "none",
  },
  inner: {
    position: "relative",
    maxWidth: 1200,
    margin: "0 auto",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 56,
  },
  copyCol: { flex: "1 1 380px", maxWidth: 560, textAlign: "left" },
  kicker: {
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 3,
    color: "#d946ef",
  },
  h2: {
    fontWeight: 800,
    fontSize: "clamp(28px, 6vw, 40px)",
    lineHeight: 1.07,
    letterSpacing: -1,
    margin: "16px 0 18px",
  },
  lede: { color: "rgba(231,229,228,0.72)", fontSize: 17, lineHeight: 1.6, margin: 0 },
  desk: {
    marginTop: 26,
    background: "#0a0a0f",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 18,
    padding: 18,
  },
  deskTitle: {
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 2,
    color: "rgba(255,255,255,0.5)",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    paddingBottom: 10,
    margin: "0 0 14px",
  },
  deskRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 },
  deskBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.06)",
    color: "#fff",
    borderRadius: 12,
    padding: "10px 12px",
    fontSize: 12,
    fontFamily: "monospace",
    textTransform: "uppercase",
    letterSpacing: 1,
    fontWeight: 700,
    cursor: "pointer",
  },
  tabRow: { display: "flex", gap: 8 },
  tabBtn: {
    flex: 1,
    padding: "9px 12px",
    borderRadius: 12,
    fontSize: 12,
    fontFamily: "monospace",
    textTransform: "uppercase",
    letterSpacing: 2,
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.06)",
    color: "rgba(255,255,255,0.6)",
    cursor: "pointer",
  },
  tabBtnActive: {
    backgroundImage: "linear-gradient(120deg,#8A40CF,#FF5BFC)",
    border: "1px solid transparent",
    color: "#fff",
    fontWeight: 700,
  },
  logs: {
    marginTop: 18,
    background: "rgba(0,0,0,0.8)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 12,
    padding: 14,
    fontFamily: "monospace",
    fontSize: 10,
    color: "rgba(255,255,255,0.5)",
  },
  logsHead: {
    color: "#a855f7",
    fontWeight: 700,
    display: "block",
    paddingBottom: 6,
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    marginBottom: 8,
  },
  logRow: { display: "flex", justifyContent: "space-between", padding: "2px 0" },
  logOk: { color: "#22c55e" },
  ctaRow: { display: "flex", flexWrap: "wrap", gap: 14, marginTop: 24 },
  ctaPrimary: {
    backgroundImage: "linear-gradient(135deg,#8A40CF,#FF5BFC)",
    color: "#0A0118",
    fontWeight: 800,
    fontSize: 15,
    padding: "13px 24px",
    borderRadius: 14,
    textDecoration: "none",
  },
  ctaGhost: {
    border: "1px solid rgba(255,255,255,0.22)",
    color: "#fff",
    fontWeight: 700,
    fontSize: 15,
    padding: "13px 24px",
    borderRadius: 14,
    textDecoration: "none",
  },
  stageCol: {
    flex: "1 1 360px",
    position: "relative",
    width: "100%",
    height: 680,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
  },
  stageFlare: {
    position: "absolute",
    inset: 0,
    background:
      "radial-gradient(circle at center, rgba(217,70,239,0.07), transparent 65%)",
    pointerEvents: "none",
  },
  canvasMount: {
    width: "100%",
    height: "100%",
    minHeight: 580,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    touchAction: "none",
  },
  hint: {
    position: "absolute",
    bottom: 12,
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 14px",
    background: "rgba(9,9,11,0.8)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 999,
    fontFamily: "monospace",
    fontSize: 9,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "rgba(255,255,255,0.5)",
    whiteSpace: "nowrap",
  },
  hintDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#3FDCFF",
  },
};
