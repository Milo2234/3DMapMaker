import * as THREE from 'three';
import { generateTerrainMesh } from './meshGenerator';

interface ExportOptions {
  tileSize: number; // in mm
  baseThickness: number; // in mm
  filename?: string;
}

interface ElevationData {
  elevations: number[];
  width: number;
  height: number;
  minElevation: number;
  maxElevation: number;
}

interface TerrainExportOptions {
  tileSize: number;
  baseThickness: number;
  verticalExaggeration: number;
  smoothingLevel?: number;
  filename?: string;
}

/**
 * Export terrain as STL using proper grid mesh with DEM smoothing.
 * This produces clean, print-ready meshes without spikes.
 */
export function exportTerrainToSTL(
  elevationData: ElevationData,
  options: TerrainExportOptions
): void {
  const { tileSize, baseThickness, verticalExaggeration, smoothingLevel = 1, filename = 'terrain' } = options;

  // Generate smoothed grid mesh (same pipeline as preview)
  const { positions, indices } = generateTerrainMesh(elevationData, {
    smoothingPasses: smoothingLevel,
    smoothingRadius: 1,
    verticalExaggeration,
    meshSize: 10,
    decimationFactor: 1, // Full resolution for export
    laplacianPasses: smoothingLevel > 0 ? 1 : 0,
  });

  // Create geometry
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  // Scale to print size
  const scaleFactor = tileSize / 10;
  geometry.scale(scaleFactor, scaleFactor, scaleFactor);

  // Create solid mesh with base
  const solidGeometry = createSolidMesh(geometry, baseThickness);

  // Generate and download STL
  const stlData = generateBinarySTL(solidGeometry);
  downloadBlob(stlData, `${filename}.stl`, 'application/octet-stream');
}

export function exportToSTL(
  geometry: THREE.BufferGeometry,
  options: ExportOptions
): void {
  const { tileSize, baseThickness, filename = 'terrain' } = options;

  // Clone and transform geometry for STL export
  const exportGeometry = geometry.clone();

  // Scale geometry to desired print size
  // The geometry is 10x10 units, so we scale to tileSize mm
  const scaleFactor = tileSize / 10;
  exportGeometry.scale(scaleFactor, scaleFactor, scaleFactor);

  // Create the solid mesh with base
  const solidGeometry = createSolidMesh(exportGeometry, baseThickness);

  // Generate binary STL
  const stlData = generateBinarySTL(solidGeometry);

  // Download the file
  downloadBlob(stlData, `${filename}.stl`, 'application/octet-stream');
}

function createSolidMesh(
  topGeometry: THREE.BufferGeometry,
  baseThickness: number
): THREE.BufferGeometry {
  const positions = topGeometry.attributes.position;
  const indices = topGeometry.index;

  if (!indices) {
    console.error('Geometry must have indices');
    return topGeometry;
  }

  // Find min Z to determine base level
  let minZ = Infinity;
  for (let i = 0; i < positions.count; i++) {
    minZ = Math.min(minZ, positions.getZ(i));
  }

  const baseLevel = minZ - baseThickness;

  // We'll build the solid geometry from triangles
  const triangles: number[][] = [];

  // Add top surface triangles
  for (let i = 0; i < indices.count; i += 3) {
    const a = indices.getX(i);
    const b = indices.getX(i + 1);
    const c = indices.getX(i + 2);

    triangles.push([
      positions.getX(a), positions.getY(a), positions.getZ(a),
      positions.getX(b), positions.getY(b), positions.getZ(b),
      positions.getX(c), positions.getY(c), positions.getZ(c),
    ]);
  }

  // Add bottom surface triangles (inverted winding for correct normals)
  for (let i = 0; i < indices.count; i += 3) {
    const a = indices.getX(i);
    const b = indices.getX(i + 1);
    const c = indices.getX(i + 2);

    triangles.push([
      positions.getX(a), positions.getY(a), baseLevel,
      positions.getX(c), positions.getY(c), baseLevel,
      positions.getX(b), positions.getY(b), baseLevel,
    ]);
  }

  // Add side walls
  // Get the boundary edges of the mesh
  const boundaryEdges = getBoundaryEdges(topGeometry);

  for (const edge of boundaryEdges) {
    const [x1, y1, z1, x2, y2, z2] = edge;

    // Create two triangles for each edge to form a quad
    // Top-left to bottom-right diagonal
    triangles.push([
      x1, y1, z1,
      x2, y2, z2,
      x1, y1, baseLevel,
    ]);

    triangles.push([
      x2, y2, z2,
      x2, y2, baseLevel,
      x1, y1, baseLevel,
    ]);
  }

  // Build final geometry
  const vertices: number[] = [];
  for (const tri of triangles) {
    vertices.push(...tri);
  }

  const finalGeometry = new THREE.BufferGeometry();
  finalGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(vertices, 3)
  );
  finalGeometry.computeVertexNormals();

  return finalGeometry;
}

function getBoundaryEdges(geometry: THREE.BufferGeometry): number[][] {
  const positions = geometry.attributes.position;
  const indices = geometry.index;

  if (!indices) return [];

  // Count edge occurrences
  const edgeCount = new Map<string, { count: number; vertices: number[] }>();

  for (let i = 0; i < indices.count; i += 3) {
    const a = indices.getX(i);
    const b = indices.getX(i + 1);
    const c = indices.getX(i + 2);

    const edges = [
      [a, b],
      [b, c],
      [c, a],
    ];

    for (const [v1, v2] of edges) {
      const key = v1 < v2 ? `${v1}-${v2}` : `${v2}-${v1}`;

      if (!edgeCount.has(key)) {
        edgeCount.set(key, {
          count: 0,
          vertices: [
            positions.getX(v1), positions.getY(v1), positions.getZ(v1),
            positions.getX(v2), positions.getY(v2), positions.getZ(v2),
          ],
        });
      }

      edgeCount.get(key)!.count++;
    }
  }

  // Boundary edges appear only once
  const boundaryEdges: number[][] = [];
  for (const [, value] of edgeCount) {
    if (value.count === 1) {
      boundaryEdges.push(value.vertices);
    }
  }

  return boundaryEdges;
}

function generateBinarySTL(geometry: THREE.BufferGeometry): Blob {
  const positions = geometry.attributes.position;
  const triangleCount = positions.count / 3;

  // Binary STL format:
  // 80 bytes header
  // 4 bytes number of triangles
  // For each triangle:
  //   12 bytes normal (3 floats)
  //   36 bytes vertices (9 floats)
  //   2 bytes attribute byte count

  const bufferLength = 80 + 4 + triangleCount * 50;
  const buffer = new ArrayBuffer(bufferLength);
  const view = new DataView(buffer);

  // Header (80 bytes)
  const header = 'TerrainTiles STL Export';
  for (let i = 0; i < 80; i++) {
    view.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
  }

  // Number of triangles
  view.setUint32(80, triangleCount, true);

  // Write triangles
  let offset = 84;

  for (let i = 0; i < triangleCount; i++) {
    const i0 = i * 3;
    const i1 = i * 3 + 1;
    const i2 = i * 3 + 2;

    const v0 = new THREE.Vector3(
      positions.getX(i0),
      positions.getY(i0),
      positions.getZ(i0)
    );
    const v1 = new THREE.Vector3(
      positions.getX(i1),
      positions.getY(i1),
      positions.getZ(i1)
    );
    const v2 = new THREE.Vector3(
      positions.getX(i2),
      positions.getY(i2),
      positions.getZ(i2)
    );

    // Calculate normal
    const edge1 = new THREE.Vector3().subVectors(v1, v0);
    const edge2 = new THREE.Vector3().subVectors(v2, v0);
    const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();

    // Write normal
    view.setFloat32(offset, normal.x, true);
    view.setFloat32(offset + 4, normal.y, true);
    view.setFloat32(offset + 8, normal.z, true);
    offset += 12;

    // Write vertices
    view.setFloat32(offset, v0.x, true);
    view.setFloat32(offset + 4, v0.y, true);
    view.setFloat32(offset + 8, v0.z, true);
    offset += 12;

    view.setFloat32(offset, v1.x, true);
    view.setFloat32(offset + 4, v1.y, true);
    view.setFloat32(offset + 8, v1.z, true);
    offset += 12;

    view.setFloat32(offset, v2.x, true);
    view.setFloat32(offset + 4, v2.y, true);
    view.setFloat32(offset + 8, v2.z, true);
    offset += 12;

    // Attribute byte count (unused)
    view.setUint16(offset, 0, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'application/octet-stream' });
}

function downloadBlob(blob: Blob, filename: string, mimeType: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
