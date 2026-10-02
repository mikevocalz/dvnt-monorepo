"use client";

/**
 * Keep It 100 — The Cookout: three.js table (web enhanced renderer).
 *
 * Real card meshes on a felt table: RoundedBox bodies with genuine thickness,
 * front faces rasterized live in the printed Cookout anatomy (cookout-face.ts)
 * and backs carrying the actual printed back art. Motion is GSAP: cards arc
 * off the deck stack, stagger into the player's hand, bounce-land on the
 * felt, and flip face-up on reveal. Selection/judging raycasts straight off
 * the meshes when `interactive`; the HTML controls call the same actions.
 *
 * Falls back to the Skia scene when WebGL2 is unavailable or the module fails.
 */

import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { GameTable } from "./game-table.web";
import type { GameTableProps, TableCard } from "./types";
import {
  cookoutFontsReady,
  renderCookoutFace,
} from "../card/cookout-face";
import {
  COOKOUT_BACK_URL,
  COOKOUT_THEME,
} from "../../decks/blue-100-the-cookout/theme";

const CARD_W = 2.5;
const CARD_H = 3.5;
const CARD_D = 0.06;
const TABLE_W = 17.5;
const TABLE_H = 11;
const FLAT = Math.PI / 2; // |rotation.x| for a card lying on the felt
const HAND_TILT = 0.58; // recline toward the camera for hand cards
// Center height so a reclined card rests on its bottom edge instead of
// dipping that edge under the felt plane (which clipped at the canvas edge).
const HAND_LIFT = (CARD_H / 2) * Math.sin(HAND_TILT);
const FACE_EPS = CARD_D / 2 + 0.004;

// ---------------------------------------------------------------------------
// Face texture cache — one canvas per unique face, disposed with the scene.
// ---------------------------------------------------------------------------

class FaceCache {
  private tex = new Map<string, import("three").CanvasTexture>();

  constructor(
    private THREE: typeof import("three"),
    private maxAnisotropy: number,
  ) {}

  get(spec: Parameters<typeof renderCookoutFace>[0]) {
    const key = JSON.stringify(spec);
    let t = this.tex.get(key);
    if (!t) {
      t = new this.THREE.CanvasTexture(renderCookoutFace(spec));
      t.colorSpace = this.THREE.SRGBColorSpace;
      t.anisotropy = this.maxAnisotropy;
      this.tex.set(key, t);
    }
    return t;
  }

  dispose() {
    for (const t of this.tex.values()) t.dispose();
    this.tex.clear();
  }
}

// ---------------------------------------------------------------------------
// The scene. A small imperative island: three owns the canvas, React owns the
// props, GSAP owns the motion. Every rig remembers its last tweened target so
// realtime re-syncs only animate cards whose destination actually changed.
// ---------------------------------------------------------------------------

interface CardRig {
  group: import("three").Group;
  front: import("three").Mesh;
  targetPos: import("three").Vector3;
  targetRot: { x: number; y: number };
  targetScale: number;
  key: string;
  faceKey: string;
  /** Spawned this sync — next retarget gets a staggered deal delay. */
  fresh?: boolean;
  /** Hover lift folded into the y/scale tween targets. */
  hoverLift?: boolean;
}

class CookoutTable3D {
  private THREE!: typeof import("three");
  private renderer!: import("three").WebGLRenderer;
  private scene!: import("three").Scene;
  private camera!: import("three").PerspectiveCamera;
  private raycaster!: import("three").Raycaster;
  private clock!: import("three").Clock;
  private faces!: FaceCache;
  private cards = new Map<string, CardRig>();
  private chips = new Map<string, import("three").Mesh>();
  private cardGeo!: import("three").BufferGeometry;
  private planeGeo!: import("three").PlaneGeometry;
  private edgeMat!: import("three").MeshStandardMaterial;
  private backTex: import("three").Texture | null = null;
  private props: GameTableProps | null = null;
  private raf = 0;
  private disposed = false;
  private hovered: string | null = null;
  private ro: ResizeObserver | null = null;
  private winnerGlow!: import("three").Mesh;
  private gsap!: typeof import("gsap").gsap;
  /** Fresh-card count for the current sync — drives the deal stagger. */
  private dealOrder = 0;
  /** Horizontal spread squeeze on narrow/portrait viewports (1 = full). */
  private layoutScale = 1;

  async init(container: HTMLDivElement) {
    const THREE = (this.THREE = await import("three"));
    const { RoundedBoxGeometry } = await import(
      "three/examples/jsm/geometries/RoundedBoxGeometry.js"
    );
    this.gsap = (await import("gsap")).gsap;
    if (this.disposed) return;
    await cookoutFontsReady();
    if (this.disposed) return;

    const width = container.clientWidth || 900;
    const height = container.clientHeight || 560;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.faces = new FaceCache(
      THREE,
      this.renderer.capabilities.getMaxAnisotropy(),
    );

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 100);
    this.fitCamera(width, height);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.72));
    const key = new THREE.DirectionalLight(0xffffff, 1.35);
    key.position.set(4, 10, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -9;
    key.shadow.camera.right = 9;
    key.shadow.camera.top = 7;
    key.shadow.camera.bottom = -7;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    key.shadow.bias = -0.0001;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x8a40cf, 0.5);
    rim.position.set(-6, 4, -6);
    this.scene.add(rim);

    this.cardGeo = new RoundedBoxGeometry(CARD_W, CARD_H, CARD_D, 3, 0.13);
    this.planeGeo = new THREE.PlaneGeometry(CARD_W, CARD_H);
    this.edgeMat = new THREE.MeshStandardMaterial({
      color: 0xf4f1e8,
      roughness: 0.6,
      metalness: 0,
    });

    this.buildTable();
    await this.loadBackTexture();
    this.buildWinnerGlow();

    this.raycaster = new THREE.Raycaster();
    this.clock = new THREE.Clock();

    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("click", this.onClick);

    this.ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!w || !h) return;
      this.renderer.setSize(w, h);
      this.fitCamera(w, h);
      // Spreads depend on layoutScale — retarget every card for the new size.
      if (this.props) this.sync(this.props);
    });
    this.ro.observe(container);

    if (this.props) this.sync(this.props);
    this.loop();
  }

  /**
   * Fit the whole table into the viewport. Distance is solved from the
   * horizontal half-angle (the binding constraint on narrow screens), with a
   * vertical check so portrait aspect never crops the hand. Portrait also gets
   * a wider fov and a compressed horizontal spread instead of a far-away,
   * unreadable table.
   */
  private fitCamera(w: number, h: number) {
    const THREE = this.THREE;
    const aspect = w / h;
    this.camera.fov = aspect < 0.9 ? 48 : aspect < 1.35 ? 42 : 36;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.layoutScale = Math.min(1, Math.max(0.55, aspect / 1.5));

    const vHalf = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * aspect);
    const needX = 8.8 * this.layoutScale;
    const needY = 5.4; // include the reclined hand's dipped far edge
    // The hand fan sits ~4 units nearer the camera than the table center, so
    // the width solve needs that depth added back or the edge cards crop.
    const dist = Math.max(
      needX / Math.tan(hHalf) + 3.7,
      needY / Math.tan(vHalf),
      11,
    );
    const dir = new THREE.Vector3(0, 8.9, 10.1).normalize();
    this.camera.position.set(dir.x * dist, dir.y * dist + 0.1, dir.z * dist);
    this.camera.lookAt(0, 0, 0.1);
  }

  private buildTable() {
    const THREE = this.THREE;
    // Felt: rounded-rect plane with a canvas-drawn radial gradient + rail.
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 640;
    const ctx = c.getContext("2d")!;
    const grad = ctx.createRadialGradient(512, 300, 80, 512, 320, 620);
    grad.addColorStop(0, "#262045");
    grad.addColorStop(0.65, "#181330");
    grad.addColorStop(1, "#0d0919");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(0, 0, 1024, 640, 90);
    ctx.fill();
    ctx.strokeStyle = "#8A40CF33";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.roundRect(22, 22, 980, 596, 74);
    ctx.stroke();
    // Subtle deck-branded watermark in the felt center.
    ctx.font = "700 64px SpaceGrotesk-Bold, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff08";
    ctx.fillText("KEEP IT 100", 512, 320);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const shape = new THREE.Shape();
    const w = TABLE_W / 2;
    const h = TABLE_H / 2;
    const r = 1.6;
    shape.moveTo(-w + r, -h);
    shape.lineTo(w - r, -h);
    shape.absarc(w - r, -h + r, r, -Math.PI / 2, 0);
    shape.lineTo(w, h - r);
    shape.absarc(w - r, h - r, r, 0, Math.PI / 2);
    shape.lineTo(-w + r, h);
    shape.absarc(-w + r, h - r, r, Math.PI / 2, Math.PI);
    shape.lineTo(-w, -h + r);
    shape.absarc(-w + r, -h + r, r, Math.PI, Math.PI * 1.5);
    const geo = new THREE.ShapeGeometry(shape, 24);
    // Shape UVs are world coords — normalize to 0..1 for the gradient.
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (uv.getX(i) + w) / TABLE_W, (uv.getY(i) + h) / TABLE_H);
    }
    const table = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }),
    );
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    this.scene.add(table);
  }

  private async loadBackTexture() {
    const THREE = this.THREE;
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = COOKOUT_BACK_URL;
    });
    if (this.disposed) return;
    if (!img) return;
    // Clip to the card's corner radius so back art sits inside the body.
    const c = document.createElement("canvas");
    c.width = COOKOUT_THEME.texture.width;
    c.height = COOKOUT_THEME.texture.height;
    const ctx = c.getContext("2d")!;
    ctx.beginPath();
    ctx.roundRect(0, 0, c.width, c.height, c.width * 0.045);
    ctx.clip();
    // The back plane faces -z (rotation.y=π mirrors x) and a face-down card
    // tips +y toward the viewer — the net effect is a 180° rotation, so
    // pre-rotate the art to leave it readable to the near player.
    ctx.translate(c.width, c.height);
    ctx.rotate(Math.PI);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.backTex = tex;
    for (const rig of this.cards.values()) {
      this.setBack(rig);
    }
  }

  private buildWinnerGlow() {
    const THREE = this.THREE;
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 358;
    const ctx = c.getContext("2d")!;
    ctx.strokeStyle = "#d9a419";
    ctx.lineWidth = 22;
    ctx.shadowColor = "#d9a419";
    ctx.shadowBlur = 30;
    ctx.beginPath();
    ctx.roundRect(11, 11, 234, 336, 22);
    ctx.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.winnerGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(CARD_W + 0.3, CARD_H + 0.3),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.winnerGlow.rotation.x = -Math.PI / 2;
    this.winnerGlow.visible = false;
    this.scene.add(this.winnerGlow);
  }

  private setBack(rig: CardRig) {
    if (!this.backTex) return;
    const back = rig.group.children[2] as import("three").Mesh;
    const mat = back.material as import("three").MeshBasicMaterial;
    mat.map = this.backTex;
    mat.needsUpdate = true;
  }

  private makeCard(key: string, faceKey: string): CardRig {
    const THREE = this.THREE;
    const group = new THREE.Group();
    group.rotation.order = "YXZ";

    const body = new THREE.Mesh(this.cardGeo, this.edgeMat);
    body.castShadow = true;
    group.add(body);

    const front = new THREE.Mesh(
      this.planeGeo,
      new THREE.MeshBasicMaterial({ transparent: true }),
    );
    front.position.z = FACE_EPS;
    group.add(front);

    const back = new THREE.Mesh(
      this.planeGeo,
      new THREE.MeshBasicMaterial({
        transparent: true,
        map: this.backTex ?? undefined,
      }),
    );
    back.position.z = -FACE_EPS;
    back.rotation.y = Math.PI;
    group.add(back);

    const rig: CardRig = {
      group,
      front,
      key,
      faceKey,
      targetPos: new THREE.Vector3(),
      targetRot: { x: -FLAT, y: 0 },
      targetScale: 1,
    };
    // Spawn face-down on the deck stack — the first retarget tweens it out of
    // the pile, staggered by creation order so a fresh hand deals card by card.
    group.position.set(-6.0 * this.layoutScale, 0.3, 1.9);
    rig.fresh = true;
    group.rotation.x = FLAT;
    group.userData.rigKey = key;
    this.cards.set(key, rig);
    this.scene.add(group);
    return rig;
  }

  private cardAt(
    key: string,
    faceSpec: Parameters<typeof renderCookoutFace>[0],
  ): CardRig {
    const faceKey = JSON.stringify(faceSpec);
    let rig = this.cards.get(key);
    if (!rig) rig = this.makeCard(key, faceKey);
    if (rig.faceKey !== faceKey) {
      rig.faceKey = faceKey;
      const mat = rig.front.material as import("three").MeshBasicMaterial;
      mat.map = this.faces.get(faceSpec);
      mat.needsUpdate = true;
    } else if (!(rig.front.material as import("three").MeshBasicMaterial).map) {
      const mat = rig.front.material as import("three").MeshBasicMaterial;
      mat.map = this.faces.get(faceSpec);
      mat.needsUpdate = true;
    }
    return rig;
  }

  update(props: GameTableProps) {
    this.props = props;
    if (this.renderer) this.sync(props);
  }

  /**
   * Write a rig's destination. Nothing tweens unless the destination actually
   * moved — realtime refreshes re-run sync constantly, and restarting every
   * tween each time would jitter the whole table.
   */
  private setTarget(
    rig: CardRig,
    x: number,
    y: number,
    z: number,
    rx: number,
    ry: number,
    scale: number,
  ) {
    const moved =
      Math.abs(rig.targetPos.x - x) > 1e-3 ||
      Math.abs(rig.targetPos.y - y) > 1e-3 ||
      Math.abs(rig.targetPos.z - z) > 1e-3 ||
      Math.abs(rig.targetRot.x - rx) > 1e-3 ||
      Math.abs(rig.targetRot.y - ry) > 1e-3 ||
      Math.abs(rig.targetScale - scale) > 1e-3;
    if (!moved) return;
    rig.targetPos.set(x, y, z);
    rig.targetRot.x = rx;
    rig.targetRot.y = ry;
    rig.targetScale = scale;
    const delay = rig.fresh ? (this.dealOrder++ * 0.06) : 0;
    rig.fresh = false;
    this.dealTo(rig, delay);
  }

  /**
   * Fly a card to its target. Long hops get an arc: x/z ease out while y
   * climbs then bounce-lands on the felt — deals, submissions and reveals all
   * read as cards being laid on the table. Short hops are a quick settle.
   */
  private dealTo(rig: CardRig, delay: number) {
    const g = rig.group;
    const gsap = this.gsap;
    const dist = g.position.distanceTo(rig.targetPos);
    const flying = dist > 0.9;
    const dur = Math.min(0.65, 0.3 + dist * 0.06);
    gsap.killTweensOf(g.position);
    gsap.killTweensOf(g.rotation);
    gsap.killTweensOf(g.scale);
    const lift = rig.hoverLift ? 0.3 : 0;
    gsap.to(g.position, {
      x: rig.targetPos.x,
      z: rig.targetPos.z,
      duration: dur,
      delay,
      ease: "power2.out",
    });
    if (flying) {
      gsap.to(g.position, {
        keyframes: [
          {
            y: rig.targetPos.y + Math.min(1.4, dist * 0.4),
            duration: dur * 0.45,
            ease: "power2.out",
          },
          { y: rig.targetPos.y + lift, duration: dur * 0.55, ease: "bounce.out" },
        ],
        delay,
      });
    } else {
      gsap.to(g.position, {
        y: rig.targetPos.y + lift,
        duration: 0.3,
        delay,
        ease: "power3.out",
      });
    }
    gsap.to(g.rotation, {
      x: rig.targetRot.x,
      y: rig.targetRot.y,
      duration: Math.max(dur, 0.45),
      delay,
      ease: "power2.inOut",
    });
    const s = rig.targetScale * (rig.hoverLift ? 1.06 : 1);
    gsap.to(g.scale, { x: s, y: s, z: s, duration: 0.3, delay, ease: "power2.out" });
  }

  /** Hover affordance — lift + grow without re-flying the card. */
  private hoverTo(rig: CardRig, on: boolean) {
    rig.hoverLift = on;
    const gsap = this.gsap;
    gsap.to(rig.group.position, {
      y: rig.targetPos.y + (on ? 0.3 : 0),
      duration: 0.18,
      ease: "power2.out",
      overwrite: "auto",
    });
    const s = rig.targetScale * (on ? 1.06 : 1);
    gsap.to(rig.group.scale, {
      x: s,
      y: s,
      z: s,
      duration: 0.18,
      ease: "power2.out",
      overwrite: "auto",
    });
  }

  private sync(props: GameTableProps) {
    this.dealOrder = 0;
    const used = new Set<string>();
    const inDuel = props.state === "duel";
    const hand: TableCard[] = inDuel ? props.duelOptions ?? [] : props.myHand;
    const sx = this.layoutScale; // horizontal squeeze on narrow viewports

    // Prompt card — face-up at the head of the table.
    if (props.prompt?.text) {
      const rig = this.cardAt("prompt", {
        kind: "prompt",
        section: inDuel ? "Duel" : "Game Night",
        label: "Prompt:",
        body: props.prompt.text,
        footnote: props.prompt.pick > 1 ? `Pick ${props.prompt.pick}` : undefined,
      });
      this.setTarget(rig, 0, 0.07, -2.4, -FLAT, 0, 1.12);
      used.add("prompt");
    }

    // Deck stack — face-down pile the hand deals from.
    for (let i = 0; i < 3; i++) {
      const key = `deck-${i}`;
      const rig = this.cardAt(key, { kind: "answer", body: "" });
      const mat = rig.front.material as import("three").MeshBasicMaterial;
      // needsUpdate recompiles the shader — only touch it when the map
      // actually changes, or every prop sync costs a recompile per card.
      if (mat.map !== null) {
        mat.map = null;
        mat.needsUpdate = true;
      }
      // Dealer's-left pocket — clear of the prompt/submission lane and the
      // seat rail so it never crowds the play area on squeezed layouts.
      this.setTarget(
        rig,
        -6.0 * sx,
        0.03 + i * CARD_D,
        1.9,
        FLAT, // back art up
        (i - 1) * 0.05,
        1,
      );
      used.add(key);
    }

    // Submissions: face-down until reveal, then the dealt row flips up.
    const reveals = props.reveal ?? [];
    const showReveals = reveals.length > 0;
    if (!showReveals && props.state !== "lobby") {
      for (let i = 0; i < props.submissionsIn; i++) {
        const key = `sub-${i}`;
        const rig = this.cardAt(key, { kind: "answer", body: "" });
        const spread = props.submissionsIn - 1;
        this.setTarget(
          rig,
          (i * 0.9 - (spread * 0.9) / 2) * sx,
          0.03 + i * 0.004,
          0.6,
          FLAT,
          (i - spread / 2) * 0.14,
          1,
        );
        used.add(key);
      }
    }
    if (showReveals) {
      const n = Math.min(reveals.length, 5);
      reveals.slice(0, 5).forEach((entry, i) => {
        const key = `rev-${entry.submission_id}`;
        const rig = this.cardAt(key, {
          kind: "answer",
          section: "The Answer",
          body: entry.texts.join("  ·  "),
          accent: entry.is_winner ? "gold" : undefined,
        });
        this.setTarget(
          rig,
          (i - (n - 1) / 2) * 3.1 * sx,
          entry.is_winner ? 0.5 : 0.06,
          0.6,
          -FLAT,
          0,
          entry.is_winner ? 1.1 : 1,
        );
        used.add(key);
        if (entry.is_winner) {
          this.winnerGlow.position.set(rig.targetPos.x, 0.05, 0.6);
          this.winnerGlow.visible = true;
        }
      });
      if (!reveals.some((r) => r.is_winner)) this.winnerGlow.visible = false;
    } else {
      this.winnerGlow.visible = false;
    }

    // The player's hand — a reclined fan along the near edge.
    const n = hand.length;
    const selectedSet = new Set(props.selected);
    hand.forEach((card, i) => {
      const key = `hand-${card.card_id}`;
      const t = n > 1 ? (i / (n - 1)) * 2 - 1 : 0; // -1..1 across the fan
      const selected = selectedSet.has(card.card_id);
      const rig = this.cardAt(key, {
        kind: "answer",
        section: "Your Hand",
        body: card.text,
        accent: selected ? "gold" : undefined,
      });
      const arcX = t * Math.min(n * 1.35, 6.8) * sx;
      this.setTarget(
        rig,
        arcX,
        HAND_LIFT + Math.abs(t) * -0.12 + (selected ? 0.45 : 0),
        // Each card sits slightly behind its left neighbour — without the
        // stagger, overlapping reclined cards z-fight where they intersect.
        3.6 + Math.abs(t) * 0.35 - i * 0.05,
        -FLAT + HAND_TILT,
        t * 0.28,
        selected ? 1.07 : 1,
      );
      rig.group.userData.cardId = card.card_id;
      rig.group.userData.zone = "hand";
      used.add(key);
    });

    // Seat chips around the far rail.
    const seats = props.members.filter((m) => m.seat_no != null);
    const usedChips = new Set<string>();
    seats.forEach((m, i) => {
      const t = seats.length > 1 ? (i / (seats.length - 1)) * 2 - 1 : 0;
      const key = `seat-${m.user_id}`;
      usedChips.add(key);
      let chip = this.chips.get(key);
      const chipKey = `${m.name}|${m.user_id === props.judgeUserId}`;
      if (!chip || chip.userData.chipKey !== chipKey) {
        if (chip) {
          this.scene.remove(chip);
          this.disposeChip(chip);
        }
        chip = this.makeChip(m.name, m.user_id === props.judgeUserId);
        chip.userData.chipKey = chipKey;
        this.chips.set(key, chip);
        this.scene.add(chip);
      }
      chip.position.set(t * 6.4 * sx, 0.3, -4.4);
      chip.rotation.x = -0.42;
    });
    for (const [key, chip] of this.chips) {
      if (!usedChips.has(key)) {
        this.scene.remove(chip);
        this.disposeChip(chip);
        this.chips.delete(key);
      }
    }

    // Retire meshes whose cards left the projection (submitted hand cards,
    // cleared reveals).
    for (const [key, rig] of this.cards) {
      if (!used.has(key)) {
        this.killRigTweens(rig);
        this.scene.remove(rig.group);
        (rig.front.material as import("three").Material).dispose();
        ((rig.group.children[2] as import("three").Mesh)
          .material as import("three").Material).dispose();
        this.cards.delete(key);
      }
    }
  }

  private killRigTweens(rig: CardRig) {
    if (!this.gsap) return;
    this.gsap.killTweensOf(rig.group.position);
    this.gsap.killTweensOf(rig.group.rotation);
    this.gsap.killTweensOf(rig.group.scale);
  }

  private makeChip(name: string, judge: boolean) {
    const THREE = this.THREE;
    const c = document.createElement("canvas");
    c.width = 384;
    c.height = 112;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = judge ? "#2c2150" : "#1b1530";
    ctx.beginPath();
    ctx.roundRect(0, 0, 384, 112, 56);
    ctx.fill();
    ctx.strokeStyle = judge ? "#d9a419" : "#8A40CF66";
    ctx.lineWidth = judge ? 8 : 4;
    ctx.stroke();
    ctx.fillStyle = judge ? "#d9a419" : "#8f63c6";
    ctx.beginPath();
    ctx.arc(56, 56, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "700 44px SpaceGrotesk-Bold, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#17102a";
    ctx.fillText(name.slice(0, 1).toUpperCase(), 56, 58);
    ctx.font = "600 34px SpaceGrotesk-SemiBold, sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = "#f7f4ff";
    const label = judge ? `${name} · judging` : name;
    ctx.fillText(label.slice(0, 14), 104, 58);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2.9, 0.85),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true }),
    );
    return mesh;
  }

  private disposeChip(chip: import("three").Mesh) {
    const mat = chip.material as import("three").MeshBasicMaterial;
    mat.map?.dispose();
    mat.dispose();
    chip.geometry.dispose();
  }

  // -- interaction ---------------------------------------------------------

  private pickZone(clientX: number, clientY: number): CardRig | null {
    if (this.props?.interactive === false || !this.props) return null;
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const ndc = new this.THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const groups = [...this.cards.values()]
      .filter(
        (r) =>
          r.key.startsWith("hand-") ||
          (r.key.startsWith("rev-") && this.props?.state === "judging"),
      )
      .map((r) => r.group);
    const hit = this.raycaster.intersectObjects(groups, true)[0];
    if (!hit) return null;
    let obj: import("three").Object3D | null = hit.object;
    while (obj && !obj.userData.rigKey) obj = obj.parent;
    if (!obj) return null;
    return this.cards.get(obj.userData.rigKey) ?? null;
  }

  private lastRaycast = 0;

  private onPointerMove = (e: PointerEvent) => {
    // ~30fps cap on hover raycasts — every event is a full scene intersection.
    const now = performance.now();
    if (now - this.lastRaycast < 33) return;
    this.lastRaycast = now;
    const rig = this.pickZone(e.clientX, e.clientY);
    const id = rig?.key ?? null;
    if (id !== this.hovered) {
      const prev = this.hovered ? this.cards.get(this.hovered) : null;
      this.hovered = id;
      if (prev) this.hoverTo(prev, false);
      if (rig) this.hoverTo(rig, true);
      this.renderer.domElement.style.cursor = id ? "pointer" : "default";
    }
  };

  private onPointerLeave = () => {
    const prev = this.hovered ? this.cards.get(this.hovered) : null;
    this.hovered = null;
    if (prev) this.hoverTo(prev, false);
    if (this.renderer) this.renderer.domElement.style.cursor = "default";
  };

  private onClick = (e: MouseEvent) => {
    const rig = this.pickZone(e.clientX, e.clientY);
    if (!rig || !this.props) return;
    if (rig.key.startsWith("hand-")) {
      const cardId = rig.group.userData.cardId as string;
      if (this.props.state === "duel") this.props.onDuelPick?.(cardId);
      else this.props.onSelectCard(cardId);
    } else if (rig.key.startsWith("rev-") && this.props.state === "judging") {
      this.props.onPickWinner(Number(rig.key.slice(4)));
    }
  };

  // -- frame loop ----------------------------------------------------------

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.clock.getDelta(); // keep elapsedTime advancing for the glow pulse
    if (this.winnerGlow.visible) {
      const t = this.clock.elapsedTime;
      (this.winnerGlow.material as import("three").MeshBasicMaterial).opacity =
        0.55 + Math.sin(t * 5) * 0.3;
    }
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    if (!this.renderer) return;
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerleave", this.onPointerLeave);
    canvas.removeEventListener("click", this.onClick);
    for (const [, rig] of this.cards) {
      this.killRigTweens(rig);
      (rig.front.material as import("three").Material).dispose();
      ((rig.group.children[2] as import("three").Mesh)
        .material as import("three").Material).dispose();
    }
    this.cards.clear();
    for (const [, chip] of this.chips) this.disposeChip(chip);
    this.chips.clear();
    this.faces?.dispose();
    this.cardGeo?.dispose();
    this.planeGeo?.dispose();
    this.edgeMat?.dispose();
    this.backTex?.dispose();
    canvas.parentElement?.removeChild(canvas);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

// ---------------------------------------------------------------------------
// React wrapper — loads three lazily so the baseline never pays for it, and
// reports failure upward so the caller can keep the Skia table on screen.
// ---------------------------------------------------------------------------

export function WebGLAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2"));
  } catch {
    return false;
  }
}

export function ThreeTableScene(props: GameTableProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<CookoutTable3D | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const table = new CookoutTable3D();
    sceneRef.current = table;
    let cancelled = false;
    void table.init(host).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      table.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.update(props);
  });

  if (failed) return <GameTable {...props} />;
  return (
    <div
      ref={hostRef}
      role="img"
      aria-label="Game table"
      style={{
        width: "100%",
        height: "100%",
        minHeight: "clamp(300px, 52vw, 480px)",
      }}
    />
  );
}

/** Error boundary: a three.js init/render fault must never take the room down —
 * the caller renders the Skia table underneath us as the same-tree fallback. */
export class ThreeTableBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { crashed: boolean }
> {
  state = { crashed: false };
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  render() {
    return this.state.crashed ? this.props.fallback : this.props.children;
  }
}
