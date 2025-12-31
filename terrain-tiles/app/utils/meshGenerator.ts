/**
 * Terrain mesh generation with proper noise handling.
 *
 * Correct order of operations:
 * 1. Smooth the DEM (heightfield) before meshing
 * 2. Use regular grid triangulation (not TIN)
 * 3. Match mesh density to DEM resolution
 * 4. Optional Laplacian smoothing post-mesh
 */

interface ElevationData {
  elevations: number[];
  width: number;
  height: number;
  minElevation: number;
  maxElevation: number;
}

interface MeshOptions {
  smoothingPasses?: number;      // Gaussian blur passes (0-3, default 1)
  smoothingRadius?: number;      // Kernel radius (1-2, default 1)
  verticalExaggeration?: number; // Height scale (default 1.5)
  meshSize?: number;             // Output mesh size in units (default 10)
  decimationFactor?: number;     // Skip every N points (1 = full res, 2 = half, etc.)
  laplacianPasses?: number;      // Post-mesh smoothing (0-3, default 0)
}

/**
 * Apply Gaussian smoothing to the elevation data.
 * This is the MOST important step for removing spikes.
 */
export function smoothElevationData(
  data: ElevationData,
  passes: number = 1,
  radius: number = 1
): ElevationData {
  if (passes === 0) return data;

  const { elevations, width, height, minElevation, maxElevation } = data;
  let current = [...elevations];
  let next = new Array(elevations.length);

  // Build Gaussian kernel
  const kernelSize = radius * 2 + 1;
  const kernel: number[][] = [];
  const sigma = radius * 0.5 + 0.5; // Reasonable sigma for the radius
  let kernelSum = 0;

  for (let ky = -radius; ky <= radius; ky++) {
    const row: number[] = [];
    for (let kx = -radius; kx <= radius; kx++) {
      const weight = Math.exp(-(kx * kx + ky * ky) / (2 * sigma * sigma));
      row.push(weight);
      kernelSum += weight;
    }
    kernel.push(row);
  }

  // Normalize kernel
  for (let ky = 0; ky < kernelSize; ky++) {
    for (let kx = 0; kx < kernelSize; kx++) {
      kernel[ky][kx] /= kernelSum;
    }
  }

  // Apply Gaussian blur for each pass
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let weightSum = 0;

        for (let ky = -radius; ky <= radius; ky++) {
          for (let kx = -radius; kx <= radius; kx++) {
            const nx = x + kx;
            const ny = y + ky;

            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const weight = kernel[ky + radius][kx + radius];
              sum += current[ny * width + nx] * weight;
              weightSum += weight;
            }
          }
        }

        next[y * width + x] = sum / weightSum;
      }
    }

    // Swap buffers
    [current, next] = [next, current];
  }

  // Recalculate min/max after smoothing
  let newMin = Infinity;
  let newMax = -Infinity;
  for (const elev of current) {
    newMin = Math.min(newMin, elev);
    newMax = Math.max(newMax, elev);
  }

  return {
    elevations: current,
    width,
    height,
    minElevation: newMin,
    maxElevation: newMax,
  };
}

/**
 * Generate a regular grid mesh from elevation data.
 * This produces consistent topology and avoids TIN noise amplification.
 */
export function generateGridMesh(
  data: ElevationData,
  options: MeshOptions = {}
): { positions: Float32Array; indices: Uint32Array; normals: Float32Array } {
  const {
    verticalExaggeration = 1.5,
    meshSize = 10,
    decimationFactor = 1,
  } = options;

  const { elevations, width, height, minElevation, maxElevation } = data;
  const elevationRange = maxElevation - minElevation || 1;
  const scaleFactor = (3 / elevationRange) * verticalExaggeration;

  // Calculate grid dimensions after decimation
  const gridWidth = Math.ceil(width / decimationFactor);
  const gridHeight = Math.ceil(height / decimationFactor);
  const vertexCount = gridWidth * gridHeight;
  const triangleCount = (gridWidth - 1) * (gridHeight - 1) * 2;

  const positions = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(triangleCount * 3);

  const halfSize = meshSize / 2;

  // Generate vertices
  for (let gy = 0; gy < gridHeight; gy++) {
    for (let gx = 0; gx < gridWidth; gx++) {
      // Map grid coords back to source coords
      const sx = Math.min(gx * decimationFactor, width - 1);
      const sy = Math.min(gy * decimationFactor, height - 1);
      const srcIdx = sy * width + sx;

      const vertIdx = gy * gridWidth + gx;
      const elevation = elevations[srcIdx] ?? minElevation;

      // Map to mesh coordinates
      positions[vertIdx * 3] = (gx / (gridWidth - 1)) * meshSize - halfSize;
      positions[vertIdx * 3 + 1] = (gy / (gridHeight - 1)) * meshSize - halfSize;
      positions[vertIdx * 3 + 2] = (elevation - minElevation) * scaleFactor;
    }
  }

  // Generate triangle indices (two triangles per quad)
  let triIdx = 0;
  for (let gy = 0; gy < gridHeight - 1; gy++) {
    for (let gx = 0; gx < gridWidth - 1; gx++) {
      const topLeft = gy * gridWidth + gx;
      const topRight = topLeft + 1;
      const bottomLeft = (gy + 1) * gridWidth + gx;
      const bottomRight = bottomLeft + 1;

      // Triangle 1: top-left, bottom-left, top-right
      indices[triIdx++] = topLeft;
      indices[triIdx++] = bottomLeft;
      indices[triIdx++] = topRight;

      // Triangle 2: top-right, bottom-left, bottom-right
      indices[triIdx++] = topRight;
      indices[triIdx++] = bottomLeft;
      indices[triIdx++] = bottomRight;
    }
  }

  // Calculate normals
  const normals = calculateNormals(positions, indices, vertexCount);

  return { positions, indices, normals };
}

/**
 * Apply Laplacian smoothing to an existing mesh.
 * Preserves boundary vertices. Use sparingly (1-3 passes max).
 */
export function applyLaplacianSmoothing(
  positions: Float32Array,
  indices: Uint32Array,
  gridWidth: number,
  gridHeight: number,
  passes: number = 1,
  lambda: number = 0.5
): Float32Array {
  if (passes === 0) return positions;

  const vertexCount = gridWidth * gridHeight;
  let current = new Float32Array(positions);
  let next = new Float32Array(positions.length);

  for (let pass = 0; pass < passes; pass++) {
    // Copy all positions first
    next.set(current);

    // Only smooth interior vertices (not boundaries)
    for (let gy = 1; gy < gridHeight - 1; gy++) {
      for (let gx = 1; gx < gridWidth - 1; gx++) {
        const idx = gy * gridWidth + gx;

        // Get Z values of 4 neighbors
        const left = current[(idx - 1) * 3 + 2];
        const right = current[(idx + 1) * 3 + 2];
        const top = current[(idx - gridWidth) * 3 + 2];
        const bottom = current[(idx + gridWidth) * 3 + 2];
        const center = current[idx * 3 + 2];

        // Laplacian: average of neighbors minus center
        const laplacian = (left + right + top + bottom) / 4 - center;

        // Apply smoothing with damping factor
        next[idx * 3 + 2] = center + lambda * laplacian;
      }
    }

    // Swap buffers
    [current, next] = [next, current];
  }

  return current;
}

/**
 * Calculate vertex normals from positions and indices.
 */
function calculateNormals(
  positions: Float32Array,
  indices: Uint32Array,
  vertexCount: number
): Float32Array {
  const normals = new Float32Array(vertexCount * 3);
  const counts = new Uint32Array(vertexCount);

  // Accumulate face normals for each vertex
  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i];
    const i1 = indices[i + 1];
    const i2 = indices[i + 2];

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
  for (let i = 0; i < vertexCount; i++) {
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

  return normals;
}

/**
 * Full pipeline: smooth DEM -> generate grid mesh -> optional Laplacian smoothing
 */
export function generateTerrainMesh(
  data: ElevationData,
  options: MeshOptions = {}
): { positions: Float32Array; indices: Uint32Array; normals: Float32Array } {
  const {
    smoothingPasses = 1,
    smoothingRadius = 1,
    laplacianPasses = 0,
    decimationFactor = 1,
    ...meshOptions
  } = options;

  // Step 1: Smooth the DEM (most important!)
  const smoothedData = smoothElevationData(data, smoothingPasses, smoothingRadius);

  // Step 2: Generate regular grid mesh
  let { positions, indices, normals } = generateGridMesh(smoothedData, {
    ...meshOptions,
    decimationFactor,
  });

  // Step 3: Optional Laplacian smoothing on the mesh
  if (laplacianPasses > 0) {
    const gridWidth = Math.ceil(data.width / decimationFactor);
    const gridHeight = Math.ceil(data.height / decimationFactor);
    positions = applyLaplacianSmoothing(positions, indices, gridWidth, gridHeight, laplacianPasses);
    // Recalculate normals after smoothing
    normals = calculateNormals(positions, indices, gridWidth * gridHeight);
  }

  return { positions, indices, normals };
}
