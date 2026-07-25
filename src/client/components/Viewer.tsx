import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import {
  OrbitControls,
  GizmoHelper,
  GizmoViewport,
  Grid,
  Bounds,
  Environment,
  Lightformer,
  ContactShadows,
} from "@react-three/drei";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { BufferGeometry } from "three";

// Material finishes — each maps to physical-material params. Keys are the source
// of truth shared with the FinishPicker UI.
export type Finish = "plastic" | "matte" | "glossy" | "metal" | "chrome";
export const FINISHES: Record<Finish, { metalness: number; roughness: number; clearcoat: number; clearcoatRoughness: number }> = {
  plastic: { metalness: 0.15, roughness: 0.55, clearcoat: 0, clearcoatRoughness: 0 },
  matte: { metalness: 0.0, roughness: 0.95, clearcoat: 0, clearcoatRoughness: 0 },
  glossy: { metalness: 0.1, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.12 },
  metal: { metalness: 1.0, roughness: 0.35, clearcoat: 0, clearcoatRoughness: 0 },
  chrome: { metalness: 1.0, roughness: 0.05, clearcoat: 0, clearcoatRoughness: 0 },
};
export const FINISH_OPTIONS: { key: Finish; label: string }[] = [
  { key: "plastic", label: "Plastic" },
  { key: "matte", label: "Matte" },
  { key: "glossy", label: "Glossy" },
  { key: "metal", label: "Metal" },
  { key: "chrome", label: "Chrome" },
];

function Model({ stl, color, finish }: { stl: ArrayBuffer; color: string; finish: Finish }) {
  const geometry = useMemo<BufferGeometry>(() => {
    const g = new STLLoader().parse(stl.slice(0));
    // build123d/CAD is Z-up; three.js is Y-up. Rotate so models stand upright.
    g.rotateX(-Math.PI / 2);
    g.computeVertexNormals();
    g.computeBoundingBox();
    return g;
  }, [stl]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  // Center on X/Z and rest the model ON the ground plane (y=0) so ContactShadows
  // sit under it instead of through its middle.
  const bb = geometry.boundingBox!;
  const cx = (bb.min.x + bb.max.x) / 2;
  const cz = (bb.min.z + bb.max.z) / 2;
  const f = FINISHES[finish] ?? FINISHES.plastic;

  return (
    <mesh geometry={geometry} position={[-cx, -bb.min.y, -cz]} castShadow receiveShadow>
      <meshPhysicalMaterial
        color={color}
        metalness={f.metalness}
        roughness={f.roughness}
        clearcoat={f.clearcoat}
        clearcoatRoughness={f.clearcoatRoughness}
        envMapIntensity={1}
      />
    </mesh>
  );
}

// Exposes a screenshot function to the parent (vision-verify + snapshot).
function CaptureBridge({ captureRef }: { captureRef: MutableRefObject<(() => string | null) | null> }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    captureRef.current = () => {
      try {
        gl.render(scene, camera); // force a fresh frame into the preserved buffer
        return gl.domElement.toDataURL("image/png");
      } catch {
        return null;
      }
    };
    return () => {
      captureRef.current = null;
    };
  }, [gl, scene, camera, captureRef]);
  return null;
}

interface ViewerProps {
  stl: ArrayBuffer | null;
  fitKey: string;
  color: string;
  finish: Finish;
  hideOverlays?: boolean; // hide grid + gizmo for clean snapshots
  captureRef: MutableRefObject<(() => string | null) | null>;
}

export function Viewer({ stl, fitKey, color, finish, hideOverlays, captureRef }: ViewerProps) {
  const controls = useRef(null);
  return (
    <Canvas
      shadows
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      camera={{ position: [90, 70, 90], fov: 45, near: 0.1, far: 8000 }}
    >
      {/* Scene background so captures render on a solid colour, not transparent. */}
      <color attach="background" args={["#0B0B09"]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[50, 80, 40]} intensity={1.1} castShadow shadow-mapSize={[1024, 1024]} />

      {/* Self-contained studio environment (no external HDRI fetch) for reflections. */}
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={3} position={[0, 8, 1]} scale={[12, 8, 1]} rotation={[Math.PI / 2, 0, 0]} />
        <Lightformer form="rect" intensity={1.6} position={[-7, 3, -5]} scale={[6, 6, 1]} />
        <Lightformer form="rect" intensity={1.6} position={[7, 3, 5]} scale={[6, 6, 1]} color="#ffe9e0" />
      </Environment>

      {!hideOverlays && (
        <Grid
          infiniteGrid
          cellSize={5}
          sectionSize={50}
          fadeDistance={800}
          cellColor="#2a2a26"
          sectionColor="#3a2a2e"
          position={[0, 0, 0]}
        />
      )}

      {/* key={fitKey} → Bounds refits exactly once per new design, not per param. */}
      {stl && (
        <Bounds key={fitKey} fit clip margin={1.3}>
          <Model stl={stl} color={color} finish={finish} />
        </Bounds>
      )}
      {stl && (
        <ContactShadows position={[0, 0, 0]} opacity={0.5} scale={320} blur={2.4} far={140} color="#000000" />
      )}

      <OrbitControls ref={controls} makeDefault enableDamping />
      {!hideOverlays && (
        <GizmoHelper alignment="bottom-right" margin={[70, 70]}>
          <GizmoViewport axisColors={["#FF2D55", "#3ddc84", "#4a9eff"]} labelColor="#eee" />
        </GizmoHelper>
      )}
      <CaptureBridge captureRef={captureRef} />
    </Canvas>
  );
}
