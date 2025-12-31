import { NextRequest, NextResponse } from 'next/server';

interface ElevationRequest {
  north: number;
  south: number;
  east: number;
  west: number;
  resolution?: number;
}

export async function POST(request: NextRequest) {
  try {
    const body: ElevationRequest = await request.json();
    const { north, south, east, west, resolution = 100 } = body;

    // Validate bounds
    if (north <= south || east <= west) {
      return NextResponse.json(
        { error: 'Invalid bounds: north must be > south, east must be > west' },
        { status: 400 }
      );
    }

    // Use AWS Terrain Tiles (Mapzen Terrarium format) - free, high quality
    const elevationData = await fetchFromAWSTerrain(north, south, east, west, resolution);

    return NextResponse.json(elevationData);
  } catch (error) {
    console.error('Elevation API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch elevation data' },
      { status: 500 }
    );
  }
}

async function fetchFromAWSTerrain(
  north: number,
  south: number,
  east: number,
  west: number,
  resolution: number
): Promise<{ elevations: number[]; width: number; height: number; minElevation: number; maxElevation: number }> {
  // Calculate appropriate zoom level based on area size
  const latSpan = north - south;
  const lngSpan = east - west;
  const maxSpan = Math.max(latSpan, lngSpan);

  // Choose zoom level - higher zoom = more detail
  // Zoom 10 ≈ 150m/pixel, Zoom 12 ≈ 38m/pixel, Zoom 14 ≈ 10m/pixel
  let zoom = 12;
  if (maxSpan > 1) zoom = 9;
  else if (maxSpan > 0.5) zoom = 10;
  else if (maxSpan > 0.2) zoom = 11;
  else if (maxSpan > 0.1) zoom = 12;
  else if (maxSpan > 0.05) zoom = 13;
  else zoom = 14;

  // Get the tile coordinates that cover our bounding box
  const tiles = getTilesForBounds(north, south, east, west, zoom);

  // Fetch all required tiles
  const tileData = await fetchTiles(tiles, zoom);

  // Sample elevation data from tiles at our desired resolution
  const elevations = sampleElevationsFromTiles(
    tileData,
    tiles,
    zoom,
    north,
    south,
    east,
    west,
    resolution
  );

  // Calculate min/max
  let min = Infinity;
  let max = -Infinity;
  for (const val of elevations) {
    min = Math.min(min, val);
    max = Math.max(max, val);
  }

  return {
    elevations,
    width: resolution,
    height: resolution,
    minElevation: min,
    maxElevation: max,
  };
}

interface TileCoord {
  x: number;
  y: number;
}

function getTilesForBounds(
  north: number,
  south: number,
  east: number,
  west: number,
  zoom: number
): TileCoord[] {
  const tiles: TileCoord[] = [];

  const minTile = latLngToTile(north, west, zoom);
  const maxTile = latLngToTile(south, east, zoom);

  for (let x = minTile.x; x <= maxTile.x; x++) {
    for (let y = minTile.y; y <= maxTile.y; y++) {
      tiles.push({ x, y });
    }
  }

  return tiles;
}

function latLngToTile(lat: number, lng: number, zoom: number): TileCoord {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

function tileToLatLng(x: number, y: number, zoom: number): { lat: number; lng: number } {
  const n = Math.pow(2, zoom);
  const lng = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const lat = (latRad * 180) / Math.PI;
  return { lat, lng };
}

interface TileImage {
  coord: TileCoord;
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

async function fetchTiles(tiles: TileCoord[], zoom: number): Promise<Map<string, TileImage>> {
  const tileMap = new Map<string, TileImage>();

  // AWS Terrain Tiles URL (Mapzen Terrarium format)
  // These are PNG images where elevation is encoded in RGB values
  const baseUrl = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

  const fetchPromises = tiles.map(async (tile) => {
    const url = `${baseUrl}/${zoom}/${tile.x}/${tile.y}.png`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.log(`Failed to fetch tile ${zoom}/${tile.x}/${tile.y}: ${response.status}`);
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const pixels = await decodePNG(arrayBuffer);

      if (pixels) {
        return {
          coord: tile,
          pixels: pixels.data,
          width: pixels.width,
          height: pixels.height,
        };
      }
    } catch (error) {
      console.error(`Error fetching tile ${zoom}/${tile.x}/${tile.y}:`, error);
    }
    return null;
  });

  const results = await Promise.all(fetchPromises);

  for (const result of results) {
    if (result) {
      const key = `${result.coord.x},${result.coord.y}`;
      tileMap.set(key, result);
    }
  }

  return tileMap;
}

async function decodePNG(arrayBuffer: ArrayBuffer): Promise<{ data: Uint8ClampedArray; width: number; height: number } | null> {
  try {
    // Use sharp or manual PNG decoding
    // For simplicity, we'll decode the PNG manually using pngjs-like approach
    const { PNG } = await import('pngjs');
    const png = PNG.sync.read(Buffer.from(arrayBuffer));

    return {
      data: new Uint8ClampedArray(png.data),
      width: png.width,
      height: png.height,
    };
  } catch (error) {
    console.error('PNG decode error:', error);
    return null;
  }
}

function sampleElevationsFromTiles(
  tileData: Map<string, TileImage>,
  tiles: TileCoord[],
  zoom: number,
  north: number,
  south: number,
  east: number,
  west: number,
  resolution: number
): number[] {
  const elevations: number[] = [];

  for (let row = 0; row < resolution; row++) {
    for (let col = 0; col < resolution; col++) {
      // Calculate the lat/lng for this sample point
      const lat = north - (row / (resolution - 1)) * (north - south);
      const lng = west + (col / (resolution - 1)) * (east - west);

      // Find which tile this point is in
      const tileCoord = latLngToTile(lat, lng, zoom);
      const key = `${tileCoord.x},${tileCoord.y}`;
      const tile = tileData.get(key);

      if (tile) {
        // Calculate position within the tile
        const tileBounds = {
          nw: tileToLatLng(tileCoord.x, tileCoord.y, zoom),
          se: tileToLatLng(tileCoord.x + 1, tileCoord.y + 1, zoom),
        };

        const tileWidth = tileBounds.se.lng - tileBounds.nw.lng;
        const tileHeight = tileBounds.nw.lat - tileBounds.se.lat;

        const pixelX = Math.floor(((lng - tileBounds.nw.lng) / tileWidth) * tile.width);
        const pixelY = Math.floor(((tileBounds.nw.lat - lat) / tileHeight) * tile.height);

        const clampedX = Math.max(0, Math.min(tile.width - 1, pixelX));
        const clampedY = Math.max(0, Math.min(tile.height - 1, pixelY));

        // Get elevation from Terrarium encoding
        const elevation = getElevationFromTerrarium(tile.pixels, clampedX, clampedY, tile.width);
        elevations.push(elevation);
      } else {
        // No tile data available, use 0
        elevations.push(0);
      }
    }
  }

  return elevations;
}

function getElevationFromTerrarium(
  pixels: Uint8ClampedArray,
  x: number,
  y: number,
  width: number
): number {
  // Terrarium encoding: elevation = (R * 256 + G + B / 256) - 32768
  const idx = (y * width + x) * 4;
  const r = pixels[idx];
  const g = pixels[idx + 1];
  const b = pixels[idx + 2];

  const elevation = (r * 256 + g + b / 256) - 32768;
  return elevation;
}
