'use client';

import { useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Line, Text, OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import styles from './TerrainViewer.module.css';
import { generateTerrainMesh } from '../../utils/meshGenerator';

export type ColorMode = 'color' | 'grayscale' | 'print';

interface ElevationData {
  elevations: number[];
  width: number;
  height: number;
  minElevation: number;
  maxElevation: number;
}

// Beautiful hypsometric color palette (like National Geographic maps)
function getTerrainColor(t: number, slope: number, colorMode: ColorMode): [number, number, number] {
  // t is normalized elevation (0-1)
  // slope affects color intensity (steeper = darker)

  if (colorMode === 'print') {
    // Single color - like a 3D printed model with lighting
    // Use a neutral clay/stone color
    const base = 0.85;
    const slopeFactor = Math.max(0.7, 1 - slope * 0.4);
    const v = base * slopeFactor;
    return [v, v * 0.95, v * 0.9]; // Slightly warm gray
  }

  if (colorMode === 'grayscale') {
    // Grayscale based on elevation with slope shading
    const slopeFactor = Math.max(0.6, 1 - slope * 0.5);
    // Lighter at higher elevations
    const brightness = 0.3 + t * 0.6;
    const v = brightness * slopeFactor;
    return [v, v, v];
  }

  // Color mode - hypsometric tints
  const slopeFactor = Math.max(0.6, 1 - slope * 0.5);

  const colors: Array<{ stop: number; color: [number, number, number] }> = [
    { stop: 0.0, color: [0.18, 0.32, 0.18] },   // Deep green (lowlands)
    { stop: 0.1, color: [0.28, 0.45, 0.22] },   // Forest green
    { stop: 0.2, color: [0.45, 0.55, 0.30] },   // Light green
    { stop: 0.3, color: [0.65, 0.62, 0.35] },   // Yellow-green
    { stop: 0.4, color: [0.78, 0.68, 0.42] },   // Tan/buff
    { stop: 0.5, color: [0.82, 0.62, 0.45] },   // Light brown
    { stop: 0.6, color: [0.75, 0.52, 0.40] },   // Brown
    { stop: 0.7, color: [0.65, 0.45, 0.38] },   // Dark brown
    { stop: 0.8, color: [0.60, 0.55, 0.55] },   // Gray-brown (rock)
    { stop: 0.9, color: [0.75, 0.75, 0.78] },   // Light gray (alpine)
    { stop: 1.0, color: [0.95, 0.97, 1.0] },    // Snow white
  ];

  let lower = colors[0];
  let upper = colors[colors.length - 1];

  for (let i = 0; i < colors.length - 1; i++) {
    if (t >= colors[i].stop && t <= colors[i + 1].stop) {
      lower = colors[i];
      upper = colors[i + 1];
      break;
    }
  }

  const range = upper.stop - lower.stop;
  const localT = range > 0 ? (t - lower.stop) / range : 0;

  const r = (lower.color[0] + (upper.color[0] - lower.color[0]) * localT) * slopeFactor;
  const g = (lower.color[1] + (upper.color[1] - lower.color[1]) * localT) * slopeFactor;
  const b = (lower.color[2] + (upper.color[2] - lower.color[2]) * localT) * slopeFactor;

  return [r, g, b];
}

interface TerrainMeshProps {
  data: ElevationData;
  verticalExaggeration: number;
  colorMode: ColorMode;
  onMeshReady?: (geometry: THREE.BufferGeometry) => void;
}

function TerrainMesh({ data, verticalExaggeration, colorMode, onMeshReady }: TerrainMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => {
    const { elevations, width, height, minElevation, maxElevation } = data;
    const geo = new THREE.PlaneGeometry(10, 10, width - 1, height - 1);
    const positions = geo.attributes.position;
    const elevationRange = maxElevation - minElevation || 1;
    const scaleFactor = (3 / elevationRange) * verticalExaggeration;

    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const vertexIndex = j * width + i;
        const elevation = elevations[vertexIndex] ?? minElevation;
        const normalizedElevation = (elevation - minElevation) * scaleFactor;
        positions.setZ(vertexIndex, normalizedElevation);
      }
    }

    positions.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }, [data, verticalExaggeration]);

  const coloredGeometry = useMemo(() => {
    const { elevations, width, height, minElevation, maxElevation } = data;
    const elevationRange = maxElevation - minElevation || 1;
    const colors: number[] = [];
    const normals = geometry.attributes.normal;

    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const idx = j * width + i;
        const elevation = elevations[idx] ?? minElevation;
        const t = (elevation - minElevation) / elevationRange;

        const nz = normals.getZ(idx);
        const slope = 1 - Math.abs(nz);

        // Ambient occlusion
        let aoFactor = 1.0;
        const sampleRadius = 2;
        let higherNeighbors = 0;
        let totalNeighbors = 0;

        for (let dj = -sampleRadius; dj <= sampleRadius; dj++) {
          for (let di = -sampleRadius; di <= sampleRadius; di++) {
            if (di === 0 && dj === 0) continue;
            const ni = i + di;
            const nj = j + dj;
            if (ni >= 0 && ni < width && nj >= 0 && nj < height) {
              const neighborIdx = nj * width + ni;
              const neighborElev = elevations[neighborIdx] ?? minElevation;
              if (neighborElev > elevation) {
                higherNeighbors++;
              }
              totalNeighbors++;
            }
          }
        }

        if (totalNeighbors > 0) {
          aoFactor = 1 - (higherNeighbors / totalNeighbors) * 0.3;
        }

        const [r, g, b] = getTerrainColor(t, slope, colorMode);
        colors.push(r * aoFactor, g * aoFactor, b * aoFactor);
      }
    }

    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geometry;
  }, [geometry, data, colorMode]);

  useEffect(() => {
    if (onMeshReady && coloredGeometry) {
      onMeshReady(coloredGeometry);
    }
  }, [coloredGeometry, onMeshReady]);

  return (
    <mesh
      ref={meshRef}
      geometry={coloredGeometry}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0, 0]}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial
        vertexColors
        side={THREE.DoubleSide}
        flatShading={false}
        roughness={colorMode === 'print' ? 0.95 : 0.9}
        metalness={0.0}
      />
    </mesh>
  );
}

interface GridTerrainMeshProps {
  data: ElevationData;
  verticalExaggeration: number;
  smoothingLevel: number;
  colorMode: ColorMode;
  onMeshReady?: (geometry: THREE.BufferGeometry) => void;
}

function GridTerrainMesh({ data, verticalExaggeration, smoothingLevel, colorMode, onMeshReady }: GridTerrainMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => {
    // Use the new grid mesh generator with proper smoothing
    const { positions, indices, normals } = generateTerrainMesh(data, {
      smoothingPasses: smoothingLevel,
      smoothingRadius: 1,
      verticalExaggeration,
      meshSize: 10,
      decimationFactor: 1, // Full resolution for preview
      laplacianPasses: smoothingLevel > 0 ? 1 : 0, // Light post-mesh smoothing if any smoothing enabled
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));

    return geo;
  }, [data, verticalExaggeration, smoothingLevel]);

  const coloredGeometry = useMemo(() => {
    const { minElevation, maxElevation } = data;
    const elevationRange = maxElevation - minElevation || 1;

    const positions = geometry.attributes.position;
    const normals = geometry.attributes.normal;
    const vertexCount = positions.count;
    const colors: number[] = [];

    for (let i = 0; i < vertexCount; i++) {
      const z = positions.getZ(i);
      // Convert back from mesh z to elevation
      const scaleFactor = (3 / elevationRange) * verticalExaggeration;
      const elevation = (z / scaleFactor) + minElevation;
      const t = (elevation - minElevation) / elevationRange;

      // Get slope from normal (z component when mesh is flat = up)
      const nz = normals.getZ(i);
      const slope = 1 - Math.abs(nz);

      const [r, g, b] = getTerrainColor(t, slope, colorMode);
      colors.push(r, g, b);
    }

    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geometry;
  }, [geometry, data, colorMode, verticalExaggeration]);

  useEffect(() => {
    if (onMeshReady && coloredGeometry) {
      onMeshReady(coloredGeometry);
    }
  }, [coloredGeometry, onMeshReady]);

  return (
    <mesh
      ref={meshRef}
      geometry={coloredGeometry}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0, 0]}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial
        vertexColors
        side={THREE.DoubleSide}
        flatShading={false}
        roughness={colorMode === 'print' ? 0.95 : 0.9}
        metalness={0.0}
      />
    </mesh>
  );
}

interface TileGridProps {
  rows: number;
  cols: number;
  terrainSize: number;
  maxHeight: number;
}

function TileGrid({ rows, cols, terrainSize, maxHeight }: TileGridProps) {
  const totalTiles = rows * cols;
  const showLabels = totalTiles <= 25; // Only show labels for manageable grids

  // Adjust opacity and line width based on grid density
  const lineOpacity = totalTiles > 100 ? 0.3 : totalTiles > 25 ? 0.5 : 0.8;
  const lineWidth = totalTiles > 100 ? 1 : totalTiles > 25 ? 1.5 : 2.5;

  const gridLines = useMemo(() => {
    const lines: Array<{ points: [number, number, number][]; key: string }> = [];
    const halfSize = terrainSize / 2;
    const cellWidth = terrainSize / cols;
    const cellHeight = terrainSize / rows;
    const gridY = maxHeight + 0.05;

    for (let i = 0; i <= cols; i++) {
      const x = -halfSize + i * cellWidth;
      lines.push({
        key: `v-${i}`,
        points: [[x, gridY, -halfSize], [x, gridY, halfSize]],
      });
    }

    for (let j = 0; j <= rows; j++) {
      const z = -halfSize + j * cellHeight;
      lines.push({
        key: `h-${j}`,
        points: [[-halfSize, gridY, z], [halfSize, gridY, z]],
      });
    }

    return lines;
  }, [rows, cols, terrainSize, maxHeight]);

  const tileLabels = useMemo(() => {
    if (!showLabels) return [];

    const labels: Array<{ position: [number, number, number]; label: string; key: string }> = [];
    const halfSize = terrainSize / 2;
    const cellWidth = terrainSize / cols;
    const cellHeight = terrainSize / rows;
    const labelY = maxHeight + 0.2;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = -halfSize + (col + 0.5) * cellWidth;
        const z = -halfSize + (row + 0.5) * cellHeight;
        labels.push({
          key: `label-${row}-${col}`,
          position: [x, labelY, z],
          label: `${row + 1}-${col + 1}`,
        });
      }
    }

    return labels;
  }, [rows, cols, terrainSize, maxHeight, showLabels]);

  return (
    <group>
      {gridLines.map(({ points, key }) => (
        <Line
          key={key}
          points={points}
          color="#ff4757"
          lineWidth={lineWidth}
          transparent
          opacity={lineOpacity}
        />
      ))}
      {tileLabels.map(({ position, label, key }) => (
        <Text
          key={key}
          position={position}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={0.4}
          color="#ff4757"
          anchorX="center"
          anchorY="middle"
          fontWeight="bold"
          outlineWidth={0.02}
          outlineColor="#000000"
        >
          {label}
        </Text>
      ))}
    </group>
  );
}

function SunLight() {
  return (
    <directionalLight
      position={[15, 25, 10]}
      intensity={2}
      castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-camera-far={100}
      shadow-camera-left={-15}
      shadow-camera-right={15}
      shadow-camera-top={15}
      shadow-camera-bottom={-15}
      shadow-bias={-0.0001}
    />
  );
}

function CameraController({ viewMode }: { viewMode: 'perspective' | 'orthographic' }) {
  const { camera } = useThree();

  useEffect(() => {
    if (viewMode === 'perspective') {
      camera.position.set(10, 12, 10);
    } else {
      // Top-down orthographic view
      camera.position.set(0, 20, 0);
    }
    camera.lookAt(0, 0, 0);
  }, [camera, viewMode]);

  return null;
}

interface ContourLinesProps {
  data: ElevationData;
  numLayers: number;
  verticalExaggeration: number;
}

function ContourLines({ data, numLayers, verticalExaggeration }: ContourLinesProps) {
  const contours = useMemo(() => {
    const { elevations, width, height, minElevation, maxElevation } = data;
    const elevationRange = maxElevation - minElevation || 1;
    const scaleFactor = (3 / elevationRange) * verticalExaggeration;
    const meshSize = 10;
    const halfSize = meshSize / 2;

    const lines: Array<{ points: [number, number, number][]; key: string; elevation: number }> = [];

    // Generate contour lines at each layer elevation
    for (let layer = 0; layer < numLayers; layer++) {
      const layerT = layer / (numLayers - 1);
      const targetElevation = minElevation + layerT * elevationRange;
      const targetZ = (targetElevation - minElevation) * scaleFactor;

      // March through the grid to find contour segments
      const segments: Array<[number, number, number][]> = [];

      for (let j = 0; j < height - 1; j++) {
        for (let i = 0; i < width - 1; i++) {
          // Get elevations at cell corners
          const e00 = elevations[j * width + i];
          const e10 = elevations[j * width + (i + 1)];
          const e01 = elevations[(j + 1) * width + i];
          const e11 = elevations[(j + 1) * width + (i + 1)];

          // Convert to mesh coordinates
          const x0 = (i / (width - 1)) * meshSize - halfSize;
          const x1 = ((i + 1) / (width - 1)) * meshSize - halfSize;
          const z0 = (j / (height - 1)) * meshSize - halfSize;
          const z1 = ((j + 1) / (height - 1)) * meshSize - halfSize;

          // Find intersections using marching squares
          const points: [number, number, number][] = [];

          // Check each edge for intersection
          // Bottom edge (e00 to e10)
          if ((e00 < targetElevation) !== (e10 < targetElevation)) {
            const t = (targetElevation - e00) / (e10 - e00);
            points.push([x0 + t * (x1 - x0), targetZ + 0.02, z0]);
          }
          // Right edge (e10 to e11)
          if ((e10 < targetElevation) !== (e11 < targetElevation)) {
            const t = (targetElevation - e10) / (e11 - e10);
            points.push([x1, targetZ + 0.02, z0 + t * (z1 - z0)]);
          }
          // Top edge (e01 to e11)
          if ((e01 < targetElevation) !== (e11 < targetElevation)) {
            const t = (targetElevation - e01) / (e11 - e01);
            points.push([x0 + t * (x1 - x0), targetZ + 0.02, z1]);
          }
          // Left edge (e00 to e01)
          if ((e00 < targetElevation) !== (e01 < targetElevation)) {
            const t = (targetElevation - e00) / (e01 - e00);
            points.push([x0, targetZ + 0.02, z0 + t * (z1 - z0)]);
          }

          if (points.length === 2) {
            segments.push(points);
          } else if (points.length === 4) {
            // Saddle point - connect based on center value
            const center = (e00 + e10 + e01 + e11) / 4;
            if (center < targetElevation) {
              segments.push([points[0], points[3]]);
              segments.push([points[1], points[2]]);
            } else {
              segments.push([points[0], points[1]]);
              segments.push([points[2], points[3]]);
            }
          }
        }
      }

      // Add segments as separate lines
      segments.forEach((seg, idx) => {
        lines.push({
          key: `contour-${layer}-${idx}`,
          points: seg,
          elevation: targetElevation,
        });
      });
    }

    return lines;
  }, [data, numLayers, verticalExaggeration]);

  return (
    <group>
      {contours.map(({ points, key }) => (
        <Line
          key={key}
          points={points}
          color="#ffffff"
          lineWidth={1.5}
          transparent
          opacity={0.8}
        />
      ))}
    </group>
  );
}

export type ViewMode = 'perspective' | 'orthographic';

interface TerrainViewerProps {
  data: ElevationData | null;
  verticalExaggeration?: number;
  smoothingLevel?: number;
  colorMode?: ColorMode;
  viewMode?: ViewMode;
  showContours?: boolean;
  numContourLayers?: number;
  onMeshReady?: (geometry: THREE.BufferGeometry) => void;
  isLoading?: boolean;
  tileRows?: number;
  tileCols?: number;
  showTileGrid?: boolean;
}

export default function TerrainViewer({
  data,
  verticalExaggeration = 1.5,
  smoothingLevel = 1,
  colorMode = 'color',
  viewMode = 'perspective',
  showContours = false,
  numContourLayers = 15,
  onMeshReady,
  isLoading = false,
  tileRows = 1,
  tileCols = 1,
  showTileGrid = false,
}: TerrainViewerProps) {
  const maxHeight = useMemo(() => {
    if (!data) return 3;
    const elevationRange = data.maxElevation - data.minElevation || 1;
    const scaleFactor = (3 / elevationRange) * verticalExaggeration;
    return (data.maxElevation - data.minElevation) * scaleFactor;
  }, [data, verticalExaggeration]);

  // Background color based on color mode
  const bgColor = colorMode === 'print' ? '#2a2a35' : '#1a1a2e';

  // Orthographic camera size
  const orthoSize = 8;

  return (
    <div className={styles.container}>
      {isLoading && (
        <div className={styles.loading}>
          <div className={styles.spinner}></div>
          <span>Loading terrain...</span>
        </div>
      )}
      {!data && !isLoading && (
        <div className={styles.placeholder}>
          Select an area on the map and click &quot;Generate Terrain&quot;
        </div>
      )}
      <Canvas
        camera={viewMode === 'perspective'
          ? { fov: 45, near: 0.1, far: 1000, position: [10, 12, 10] }
          : undefined
        }
        orthographic={viewMode === 'orthographic'}
        shadows
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 }}
      >
        {viewMode === 'orthographic' && (
          <OrthographicCamera
            makeDefault
            position={[0, 20, 0]}
            zoom={50}
            near={0.1}
            far={100}
          />
        )}

        <CameraController viewMode={viewMode} />

        <color attach="background" args={[bgColor]} />
        {viewMode === 'perspective' && <fog attach="fog" args={[bgColor, 30, 60]} />}

        <ambientLight intensity={viewMode === 'orthographic' ? 0.8 : (colorMode === 'print' ? 0.5 : 0.3)} />
        {viewMode === 'perspective' && (
          <hemisphereLight
            args={[
              colorMode === 'print' ? '#ffffff' : '#7eb8da',
              colorMode === 'print' ? '#cccccc' : '#5a4a3a',
              colorMode === 'print' ? 0.6 : 0.4
            ]}
          />
        )}

        {viewMode === 'perspective' && <SunLight />}
        {viewMode === 'perspective' && (
          <directionalLight position={[-10, 8, -10]} intensity={0.3} color="#b8d4e8" />
        )}
        {viewMode === 'orthographic' && (
          <directionalLight position={[0, 20, 0]} intensity={0.5} />
        )}

        {data && (
          <>
            <GridTerrainMesh
              data={data}
              verticalExaggeration={verticalExaggeration}
              smoothingLevel={smoothingLevel}
              colorMode={colorMode}
              onMeshReady={onMeshReady}
            />
            {showTileGrid && (
              <TileGrid
                rows={tileRows}
                cols={tileCols}
                terrainSize={10}
                maxHeight={maxHeight}
              />
            )}
            {showContours && (
              <ContourLines
                data={data}
                numLayers={numContourLayers}
                verticalExaggeration={verticalExaggeration}
              />
            )}
          </>
        )}

        <OrbitControls
          enablePan={true}
          enableZoom={true}
          enableRotate={viewMode === 'perspective'}
          minDistance={3}
          maxDistance={50}
          maxPolarAngle={viewMode === 'perspective' ? Math.PI / 2.1 : 0}
          minPolarAngle={viewMode === 'orthographic' ? 0 : 0}
          enableDamping
          dampingFactor={0.05}
        />

        {viewMode === 'perspective' && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
            <planeGeometry args={[30, 30]} />
            <meshStandardMaterial color={colorMode === 'print' ? '#1a1a20' : '#151520'} roughness={1} />
          </mesh>
        )}
      </Canvas>
    </div>
  );
}
