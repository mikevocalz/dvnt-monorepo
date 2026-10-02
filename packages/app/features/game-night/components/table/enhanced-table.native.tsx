import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { Canvas, type CanvasRef } from "react-native-webgpu";
import tgpu from "typegpu";
import * as d from "typegpu/data";
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  WebGPURenderer,
} from "three/webgpu";
import { GpuRuntime } from "../../../gpu/GpuRuntime";
import { GameTable } from "./game-table.native";
import type { GameTableProps } from "./types";

const WinnerParticle = d.struct({
  position: d.vec3f,
  velocity: d.vec3f,
  bornMs: d.f32,
  hue: d.f32,
});
const PARTICLE_COUNT = 48;

export async function canUseEnhanced(): Promise<boolean> {
  return GpuRuntime.initOnce();
}

/** Native enhancement. Three owns camera, lights and dimensional meshes. TypeGPU
 * owns the bounded winner-particle instance allocation on the same shared device. */
export function EnhancedTable(props: GameTableProps) {
  const canvasRef = useRef<CanvasRef>(null);
  const winnerKey = props.reveal?.find((r) => r.is_winner)?.submission_id;

  useEffect(() => {
    let alive = true;
    let raf = 0;
    let renderer: WebGPURenderer | null = null;
    let particleBuffer: { destroy(): void } | null = null;
    const geometries: BoxGeometry[] = [];
    const materials: MeshStandardMaterial[] = [];

    void (async () => {
      if (!(await GpuRuntime.initOnce()) || !alive) return;
      const device = GpuRuntime.getDevice();
      const canvas = canvasRef.current;
      if (!device || !canvas) return;
      const context = canvas.getContext("webgpu");
      if (!context) return;

      const nativeSurface = canvas.getNativeSurface();
      renderer = new WebGPURenderer({
        device,
        context,
        canvas: nativeSurface as unknown as HTMLCanvasElement,
        alpha: true,
        antialias: true,
      });
      renderer.setPixelRatio(1);
      renderer.setSize(nativeSurface.width, nativeSurface.height, false);
      await renderer.init();
      if (!alive) return;

      const scene = new Scene();
      scene.background = new Color(0x120b1b);
      const camera = new PerspectiveCamera(42, nativeSurface.width / Math.max(1, nativeSurface.height), 0.1, 50);
      camera.position.set(0, 5.8, 7.8);
      camera.lookAt(0, 0, 0);
      scene.add(new AmbientLight(0xbca7dd, 1.7));
      const key = new DirectionalLight(0xffffff, 4.2);
      key.position.set(3, 7, 4);
      scene.add(key);

      const tableGeometry = new BoxGeometry(8.5, 0.4, 5.2, 4, 1, 4);
      const tableMaterial = new MeshStandardMaterial({ color: 0x173a32, roughness: 0.72, metalness: 0.08 });
      geometries.push(tableGeometry);
      materials.push(tableMaterial);
      scene.add(new Mesh(tableGeometry, tableMaterial));

      const cards = new Group();
      const visible = props.reveal?.flatMap((r) => r.texts) ?? props.myHand.map((c) => c.text);
      visible.slice(0, 8).forEach((_, i) => {
        const geometry = new BoxGeometry(0.9, 0.06, 1.25);
        const material = new MeshStandardMaterial({ color: i % 2 ? 0xd9c6ff : 0x6b2ea1, roughness: 0.5 });
        geometries.push(geometry);
        materials.push(material);
        const mesh = new Mesh(geometry, material);
        mesh.position.set((i - Math.min(visible.length, 8) / 2) * 0.72, 0.3, 0.2);
        mesh.rotation.y = (i - 3) * 0.05;
        cards.add(mesh);
      });
      scene.add(cards);

      if (winnerKey !== undefined) {
        const particleRoot = tgpu.initFromDevice({ device });
        const instances = particleRoot.createBuffer(d.arrayOf(WinnerParticle, PARTICLE_COUNT)).$usage("storage");
        particleBuffer = instances;
        const now = performance.now();
        instances.write(Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
          position: d.vec3f(0, 0.5, 0),
          velocity: d.vec3f(Math.cos(i) * 0.7, 1 + (i % 7) * 0.1, Math.sin(i) * 0.7),
          bornMs: now,
          hue: i / PARTICLE_COUNT,
        })));
      }

      const frame = (time: number) => {
        if (!alive || !renderer || GpuRuntime.getDevice() !== device) return;
        cards.rotation.y = Math.sin(time * 0.00035) * 0.06;
        void renderer.renderAsync(scene, camera).then(() => context.present?.());
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    })().catch((error) => console.warn("[EnhancedTable] initialization failed", error));

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      particleBuffer?.destroy();
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      renderer?.dispose();
      // GpuRuntime and its device are shared. Never dispose either here.
    };
  }, [props.myHand, props.reveal, winnerKey]);

  return (
    <View style={styles.frame}>
      <GameTable {...props} />
      <Canvas ref={canvasRef} opaque={false} pointerEvents="none" style={StyleSheet.absoluteFill} />
    </View>
  );
}

const styles = StyleSheet.create({ frame: { position: "relative", minHeight: 500 } });
