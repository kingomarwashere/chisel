import { useEffect, useMemo, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, GizmoHelper, GizmoViewport, Grid, Center, Bounds } from "@react-three/drei";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { BufferGeometry } from "three";

function Model({ stl }: { stl: ArrayBuffer }) {
  // Parse once per STL buffer. STLLoader.parse wants an ArrayBuffer.
  const geometry = useMemo<BufferGeometry>(() => {
    const g = new STLLoader().parse(stl.slice(0));
    g.computeVertexNormals();
    return g;
  }, [stl]);

  const ref = useRef<BufferGeometry>(null);
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <Bounds fit clip observe margin={1.3}>
      <Center>
        <mesh geometry={geometry} castShadow receiveShadow>
          <primitive object={geometry} attach="geometry" ref={ref} />
          <meshStandardMaterial color="#FF2D55" metalness={0.15} roughness={0.55} />
        </mesh>
      </Center>
    </Bounds>
  );
}

export function Viewer({ stl }: { stl: ArrayBuffer | null }) {
  return (
    <Canvas
      shadows
      camera={{ position: [80, 60, 80], fov: 45, near: 0.1, far: 5000 }}
      style={{ background: "#0B0B09" }}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[50, 80, 40]} intensity={1.4} castShadow />
      <directionalLight position={[-40, -20, -50]} intensity={0.4} />
      <Grid
        infiniteGrid
        cellSize={5}
        sectionSize={50}
        fadeDistance={600}
        cellColor="#2a2a26"
        sectionColor="#3a2a2e"
        position={[0, -0.01, 0]}
      />
      {stl && <Model stl={stl} />}
      <OrbitControls makeDefault enableDamping />
      <GizmoHelper alignment="bottom-right" margin={[70, 70]}>
        <GizmoViewport axisColors={["#FF2D55", "#3ddc84", "#4a9eff"]} labelColor="#eee" />
      </GizmoHelper>
    </Canvas>
  );
}
