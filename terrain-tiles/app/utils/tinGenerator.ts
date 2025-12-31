// Inline Delaunay triangulation implementation
// Based on the Bowyer-Watson algorithm

interface ElevationData {
  elevations: number[];
  width: number;
  height: number;
  minElevation: number;
  maxElevation: number;
}

interface TINPoint {
  x: number;
  y: number;
  z: number;
  originalIndex: number;
}

interface Triangle {
  i: number;
  j: number;
  k: number;
}

// Simple Delaunay triangulation using Bowyer-Watson algorithm
function delaunayTriangulate(points: { x: number; y: number }[]): number[] {
  if (points.length < 3) return [];

  // Find bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  const dx = maxX - minX;
  const dy = maxY - minY;
  const deltaMax = Math.max(dx, dy) * 10;

  // Create super-triangle
  const p1 = { x: minX - deltaMax, y: minY - deltaMax };
  const p2 = { x: minX + dx / 2, y: maxY + deltaMax };
  const p3 = { x: maxX + deltaMax, y: minY - deltaMax };

  const allPoints = [...points, p1, p2, p3];
  const n = points.length;

  // Initial triangle with super-triangle vertices
  let triangles: Triangle[] = [{ i: n, j: n + 1, k: n + 2 }];

  // Add each point one at a time
  for (let i = 0; i < n; i++) {
    const p = allPoints[i];
    const badTriangles: Triangle[] = [];
    const polygon: { i: number; j: number }[] = [];

    // Find all triangles whose circumcircle contains the point
    for (const tri of triangles) {
      if (inCircumcircle(p, allPoints[tri.i], allPoints[tri.j], allPoints[tri.k])) {
        badTriangles.push(tri);
      }
    }

    // Find the boundary of the polygonal hole
    for (const tri of badTriangles) {
      const edges = [
        { i: tri.i, j: tri.j },
        { i: tri.j, j: tri.k },
        { i: tri.k, j: tri.i },
      ];

      for (const edge of edges) {
        let shared = false;
        for (const other of badTriangles) {
          if (tri === other) continue;
          const otherEdges = [
            [other.i, other.j],
            [other.j, other.k],
            [other.k, other.i],
          ];
          for (const [oi, oj] of otherEdges) {
            if ((edge.i === oi && edge.j === oj) || (edge.i === oj && edge.j === oi)) {
              shared = true;
              break;
            }
          }
          if (shared) break;
        }
        if (!shared) {
          polygon.push(edge);
        }
      }
    }

    // Remove bad triangles
    triangles = triangles.filter(t => !badTriangles.includes(t));

    // Re-triangulate the polygonal hole
    for (const edge of polygon) {
      triangles.push({ i: edge.i, j: edge.j, k: i });
    }
  }

  // Remove triangles that share vertices with super-triangle
  triangles = triangles.filter(t => t.i < n && t.j < n && t.k < n);

  // Convert to flat array
  const result: number[] = [];
  for (const tri of triangles) {
    result.push(tri.i, tri.j, tri.k);
  }

  return result;
}

function inCircumcircle(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number }
): boolean {
  const ax = a.x - p.x;
  const ay = a.y - p.y;
  const bx = b.x - p.x;
  const by = b.y - p.y;
  const cx = c.x - p.x;
  const cy = c.y - p.y;

  const det =
    (ax * ax + ay * ay) * (bx * cy - cx * by) -
    (bx * bx + by * by) * (ax * cy - cx * ay) +
    (cx * cx + cy * cy) * (ax * by - bx * ay);

  // Check orientation
  const orient = (a.x - c.x) * (b.y - c.y) - (a.y - c.y) * (b.x - c.x);

  return orient > 0 ? det > 0 : det < 0;
}

/**
 * Generate an adaptive TIN mesh from elevation data.
 * Uses error-based point selection to keep detail where terrain is complex.
 */
export function generateAdaptiveTIN(
  data: ElevationData,
  maxError: number = 0.5, // Maximum allowed elevation error as fraction of range
  maxPoints: number = 5000 // Maximum points for preview (keeps it fast)
): { points: TINPoint[]; triangles: number[] } {
  const { elevations, width, height, minElevation, maxElevation } = data;
  const elevationRange = maxElevation - minElevation || 1;
  const errorThreshold = maxError * elevationRange;

  // Start with corner points (required for proper triangulation)
  const selectedPoints: TINPoint[] = [
    { x: 0, y: 0, z: elevations[0] ?? minElevation, originalIndex: 0 },
    { x: width - 1, y: 0, z: elevations[width - 1] ?? minElevation, originalIndex: width - 1 },
    { x: 0, y: height - 1, z: elevations[(height - 1) * width] ?? minElevation, originalIndex: (height - 1) * width },
    { x: width - 1, y: height - 1, z: elevations[(height - 1) * width + width - 1] ?? minElevation, originalIndex: (height - 1) * width + width - 1 },
  ];

  // Add edge points for stability
  const edgeStep = Math.max(1, Math.floor(Math.max(width, height) / 20));
  for (let x = edgeStep; x < width - 1; x += edgeStep) {
    selectedPoints.push({ x, y: 0, z: elevations[x] ?? minElevation, originalIndex: x });
    selectedPoints.push({ x, y: height - 1, z: elevations[(height - 1) * width + x] ?? minElevation, originalIndex: (height - 1) * width + x });
  }
  for (let y = edgeStep; y < height - 1; y += edgeStep) {
    selectedPoints.push({ x: 0, y, z: elevations[y * width] ?? minElevation, originalIndex: y * width });
    selectedPoints.push({ x: width - 1, y, z: elevations[y * width + width - 1] ?? minElevation, originalIndex: y * width + width - 1 });
  }

  // Calculate importance score for each point based on local curvature
  const importanceScores: { index: number; score: number }[] = [];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const center = elevations[idx] ?? minElevation;

      // Sample neighbors
      const left = elevations[idx - 1] ?? center;
      const right = elevations[idx + 1] ?? center;
      const top = elevations[idx - width] ?? center;
      const bottom = elevations[idx + width] ?? center;

      // Laplacian (curvature approximation)
      const laplacian = Math.abs((left + right + top + bottom) / 4 - center);

      // Gradient magnitude
      const dx = (right - left) / 2;
      const dy = (bottom - top) / 2;
      const gradient = Math.sqrt(dx * dx + dy * dy);

      // Combined importance: high curvature or steep slopes
      const score = laplacian + gradient * 0.5;

      if (score > errorThreshold * 0.1) { // Only consider significant points
        importanceScores.push({ index: idx, score });
      }
    }
  }

  // Sort by importance and take top points
  importanceScores.sort((a, b) => b.score - a.score);

  const remainingSlots = maxPoints - selectedPoints.length;
  const topPoints = importanceScores.slice(0, remainingSlots);

  for (const { index } of topPoints) {
    const x = index % width;
    const y = Math.floor(index / width);
    selectedPoints.push({
      x,
      y,
      z: elevations[index] ?? minElevation,
      originalIndex: index,
    });
  }

  // If we still have room, add a regular grid for baseline coverage
  if (selectedPoints.length < maxPoints * 0.8) {
    const gridStep = Math.max(2, Math.floor(Math.sqrt((width * height) / (maxPoints - selectedPoints.length))));
    const existingSet = new Set(selectedPoints.map(p => p.originalIndex));

    for (let y = gridStep; y < height - 1; y += gridStep) {
      for (let x = gridStep; x < width - 1; x += gridStep) {
        if (selectedPoints.length >= maxPoints) break;
        const idx = y * width + x;
        if (!existingSet.has(idx)) {
          selectedPoints.push({
            x,
            y,
            z: elevations[idx] ?? minElevation,
            originalIndex: idx,
          });
          existingSet.add(idx);
        }
      }
    }
  }

  // Perform Delaunay triangulation on 2D points
  const points2D = selectedPoints.map(p => ({ x: p.x, y: p.y }));
  const triangles = delaunayTriangulate(points2D);

  return { points: selectedPoints, triangles };
}

/**
 * Convert TIN data to Three.js BufferGeometry format
 */
export function tinToGeometryArrays(
  tin: { points: TINPoint[]; triangles: number[] },
  data: ElevationData,
  meshSize: number = 10,
  verticalExaggeration: number = 1.5
): { positions: Float32Array; indices: Uint32Array; normals: Float32Array } {
  const { points, triangles } = tin;
  const { width, height, minElevation, maxElevation } = data;
  const elevationRange = maxElevation - minElevation || 1;
  const scaleFactor = (3 / elevationRange) * verticalExaggeration;

  // Map grid coordinates to mesh coordinates
  const halfSize = meshSize / 2;
  const positions = new Float32Array(points.length * 3);

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    // Map x: 0..width-1 to -halfSize..halfSize
    positions[i * 3] = (p.x / (width - 1)) * meshSize - halfSize;
    // Map y: 0..height-1 to -halfSize..halfSize
    positions[i * 3 + 1] = (p.y / (height - 1)) * meshSize - halfSize;
    // Z is the elevation
    positions[i * 3 + 2] = (p.z - minElevation) * scaleFactor;
  }

  const indices = new Uint32Array(triangles);

  // Calculate normals
  const normals = new Float32Array(points.length * 3);
  const counts = new Uint32Array(points.length);

  for (let i = 0; i < triangles.length; i += 3) {
    const i0 = triangles[i];
    const i1 = triangles[i + 1];
    const i2 = triangles[i + 2];

    // Get vertices
    const ax = positions[i0 * 3], ay = positions[i0 * 3 + 1], az = positions[i0 * 3 + 2];
    const bx = positions[i1 * 3], by = positions[i1 * 3 + 1], bz = positions[i1 * 3 + 2];
    const cx = positions[i2 * 3], cy = positions[i2 * 3 + 1], cz = positions[i2 * 3 + 2];

    // Calculate face normal (cross product of edges)
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;

    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;

    // Accumulate normals for each vertex
    for (const idx of [i0, i1, i2]) {
      normals[idx * 3] += nx;
      normals[idx * 3 + 1] += ny;
      normals[idx * 3 + 2] += nz;
      counts[idx]++;
    }
  }

  // Normalize
  for (let i = 0; i < points.length; i++) {
    if (counts[i] > 0) {
      const nx = normals[i * 3];
      const ny = normals[i * 3 + 1];
      const nz = normals[i * 3 + 2];
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len > 0) {
        normals[i * 3] = nx / len;
        normals[i * 3 + 1] = ny / len;
        normals[i * 3 + 2] = nz / len;
      }
    }
  }

  return { positions, indices, normals };
}
