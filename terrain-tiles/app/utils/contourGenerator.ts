interface ElevationData {
  elevations: number[];
  width: number;
  height: number;
  minElevation: number;
  maxElevation: number;
}

export interface ContourLayer {
  elevation: number;
  paths: [number, number][][]; // Array of paths, each path is an array of [x, y] points
}

// Marching squares lookup table for contour line segments
// Each entry defines which edges have line segments based on corner configuration
const MARCHING_SQUARES_EDGES: Record<number, [number, number, number, number][]> = {
  0: [],
  1: [[3, 0]], // bottom-left
  2: [[0, 1]], // bottom-right
  3: [[3, 1]], // bottom
  4: [[1, 2]], // top-right
  5: [[3, 0], [1, 2]], // saddle - two separate segments
  6: [[0, 2]], // right
  7: [[3, 2]], // all except top-left
  8: [[2, 3]], // top-left
  9: [[2, 0]], // left
  10: [[0, 1], [2, 3]], // saddle - two separate segments
  11: [[2, 1]], // all except top-right
  12: [[1, 3]], // top
  13: [[1, 0]], // all except bottom-right
  14: [[0, 3]], // all except bottom-left
  15: [], // all corners above threshold
};

// Edge positions: 0=bottom, 1=right, 2=top, 3=left
function getEdgePoint(
  edge: number,
  x: number,
  y: number,
  v0: number,
  v1: number,
  v2: number,
  v3: number,
  threshold: number
): [number, number] {
  // Interpolate along edge based on threshold crossing
  switch (edge) {
    case 0: // bottom edge (between v0 and v1)
      return [x + interpolate(v0, v1, threshold), y];
    case 1: // right edge (between v1 and v2)
      return [x + 1, y + interpolate(v1, v2, threshold)];
    case 2: // top edge (between v3 and v2)
      return [x + interpolate(v3, v2, threshold), y + 1];
    case 3: // left edge (between v0 and v3)
      return [x, y + interpolate(v0, v3, threshold)];
    default:
      return [x + 0.5, y + 0.5];
  }
}

function interpolate(v1: number, v2: number, threshold: number): number {
  if (Math.abs(v2 - v1) < 0.0001) return 0.5;
  return (threshold - v1) / (v2 - v1);
}

export function generateContourLayers(
  data: ElevationData,
  numLayers: number
): ContourLayer[] {
  const { elevations, width, height, minElevation, maxElevation } = data;
  const range = maxElevation - minElevation;
  const layers: ContourLayer[] = [];

  // Generate contours at evenly spaced elevations
  for (let i = 1; i < numLayers; i++) {
    const threshold = minElevation + (range * i) / numLayers;
    const segments: [[number, number], [number, number]][] = [];

    // March through each cell
    for (let y = 0; y < height - 1; y++) {
      for (let x = 0; x < width - 1; x++) {
        // Get corner values (counterclockwise from bottom-left)
        const v0 = elevations[y * width + x]; // bottom-left
        const v1 = elevations[y * width + x + 1]; // bottom-right
        const v2 = elevations[(y + 1) * width + x + 1]; // top-right
        const v3 = elevations[(y + 1) * width + x]; // top-left

        // Calculate case index
        let caseIndex = 0;
        if (v0 >= threshold) caseIndex |= 1;
        if (v1 >= threshold) caseIndex |= 2;
        if (v2 >= threshold) caseIndex |= 4;
        if (v3 >= threshold) caseIndex |= 8;

        // Get edges for this case
        const edges = MARCHING_SQUARES_EDGES[caseIndex];
        for (const [e1, e2] of edges) {
          const p1 = getEdgePoint(e1, x, y, v0, v1, v2, v3, threshold);
          const p2 = getEdgePoint(e2, x, y, v0, v1, v2, v3, threshold);
          segments.push([p1, p2]);
        }
      }
    }

    // Connect segments into paths
    const paths = connectSegments(segments, width, height);

    layers.push({
      elevation: threshold,
      paths,
    });
  }

  return layers;
}

function connectSegments(
  segments: [[number, number], [number, number]][],
  width: number,
  height: number
): [number, number][][] {
  const paths: [number, number][][] = [];
  const used = new Set<number>();
  const tolerance = 0.001;

  function pointsEqual(p1: [number, number], p2: [number, number]): boolean {
    return Math.abs(p1[0] - p2[0]) < tolerance && Math.abs(p1[1] - p2[1]) < tolerance;
  }

  function findConnecting(point: [number, number], excludeIndex: number): number {
    for (let i = 0; i < segments.length; i++) {
      if (used.has(i) || i === excludeIndex) continue;
      if (pointsEqual(segments[i][0], point) || pointsEqual(segments[i][1], point)) {
        return i;
      }
    }
    return -1;
  }

  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;

    const path: [number, number][] = [];
    let currentIdx = i;
    let currentPoint = segments[i][0];
    path.push(segments[i][0]);
    path.push(segments[i][1]);
    used.add(i);
    currentPoint = segments[i][1];

    // Extend path forward
    while (true) {
      const nextIdx = findConnecting(currentPoint, currentIdx);
      if (nextIdx === -1) break;

      used.add(nextIdx);
      const seg = segments[nextIdx];
      if (pointsEqual(seg[0], currentPoint)) {
        path.push(seg[1]);
        currentPoint = seg[1];
      } else {
        path.push(seg[0]);
        currentPoint = seg[0];
      }
      currentIdx = nextIdx;
    }

    // Extend path backward from start
    currentPoint = path[0];
    currentIdx = i;
    while (true) {
      const prevIdx = findConnecting(currentPoint, currentIdx);
      if (prevIdx === -1) break;

      used.add(prevIdx);
      const seg = segments[prevIdx];
      if (pointsEqual(seg[0], currentPoint)) {
        path.unshift(seg[1]);
        currentPoint = seg[1];
      } else {
        path.unshift(seg[0]);
        currentPoint = seg[0];
      }
      currentIdx = prevIdx;
    }

    // Normalize coordinates to 0-1 range
    const normalizedPath: [number, number][] = path.map(([x, y]) => [
      x / (width - 1),
      y / (height - 1),
    ]);

    paths.push(normalizedPath);
  }

  return paths;
}
