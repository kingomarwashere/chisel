import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, GizmoHelper, GizmoViewport, Grid, Center, Bounds } from "@react-three/drei";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { BufferGeometry } from "three";

function Model({ stl }: { stl: ArrayBuffer }) {
  const geometry = useMemo<BufferGeometry>(() => {
    const g = new STLLoader().parse(stl.slice(0));
    g.computeVertexNormals();
    return g;
  }, [stl]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <Center>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial color="#FF2D55" metalness={0.15} roughness={0.55} />
      </mesh>
    </Center>
  );
}

// Exposes a screenshot function to the parent (used by the vision-verify loop).
// Needs preserveDrawingBuffer on the GL context (set on <Canvas> below).
function CaptureBridge({ captureRef }: { captureRef: MutableRefObject<(() => string | null) | null> }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    captureRef.current = () => {
      try {
        return gl.domElement.toDataURL("image/png");
      } catch {
        return null;
      }
    };
    return () => {
      captureRef.current = null;
    };
  }, [gl, captureRef]);
  return null;
}

interface ViewerProps {
  stl: ArrayBuffer | null;
  // Changes ONLY when a new design loads (or the user hits Fit). Param tweaks keep
  // the same fitKey so the camera holds still and size changes stay visible.
  fitKey: string;
  captureRef: MutableRefObject<(() => string | null) | null>;
}

export function Viewer({ stl, fitKey, captureRef }: ViewerProps) {
  const controls = useRef(null);
  return (
    <Canvas
      shadows
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      camera={{ position: [90, 70, 90], fov: 45, near: 0.1, far: 8000 }}
      style={{ background: "#0B0B09" }}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[50, 80, 40]} intensity={1.4} castShadow />
      <directionalLight position={[-40, -20, -50]} intensity={0.4} />
      <Grid
        infiniteGrid
        cellSize={5}
        sectionSize={50}
        fadeDistance={800}
        cellColor="#2a2a26"
        sectionColor="#3a2a2e"
        position={[0, -0.01, 0]}
      />
      {/* key={fitKey} → Bounds refits exactly once per new design, not per param. */}
      {stl && (
        <Bounds key={fitKey} fit clip margin={1.35}>
          <Model stl={stl} />
        </Bounds>
      )}
      <OrbitControls ref={controls} makeDefault enableDamping />
      <GizmoHelper alignment="bottom-right" margin={[70, 70]}>
        <GizmoViewport axisColors={["#FF2D55", "#3ddc84", "#4a9eff"]} labelColor="#eee" />
      </GizmoHelper>
      <CaptureBridge captureRef={captureRef} />
    </Canvas>
  );
}
