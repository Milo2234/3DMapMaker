'use client';

import { useState, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import ControlPanel, { ColorMode, ViewMode } from './components/ControlPanel';
import { exportTerrainToSTL } from './utils/stlExporter';
import { exportContourSVG } from './utils/svgExporter';
import { generateContourLayers } from './utils/contourGenerator';
import styles from './page.module.css';

// Dynamic imports for components that use browser APIs
const MapSelector = dynamic(() => import('./components/MapSelector'), {
  ssr: false,
  loading: () => <div className={styles.loadingPlaceholder}>Loading map...</div>,
});

const TerrainViewer = dynamic(() => import('./components/TerrainViewer'), {
  ssr: false,
  loading: () => <div className={styles.loadingPlaceholder}>Loading 3D viewer...</div>,
});

interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

interface ElevationData {
  elevations: number[];
  width: number;
  height: number;
  minElevation: number;
  maxElevation: number;
}

// Haversine formula to calculate distance in km
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default function Home() {
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [elevationData, setElevationData] = useState<ElevationData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Terrain settings
  const [resolution, setResolution] = useState(100);
  const [verticalExaggeration, setVerticalExaggeration] = useState(1.5);
  const [smoothingLevel, setSmoothingLevel] = useState(1); // Light smoothing by default
  const [targetScale, setTargetScale] = useState(25000); // 1:25,000 default

  // Print settings
  const [baseThickness, setBaseThickness] = useState(5);
  const [maxTileSize, setMaxTileSize] = useState(200); // Max tile dimension in mm
  const [showTileGrid, setShowTileGrid] = useState(true);
  const [colorMode, setColorMode] = useState<ColorMode>('color');
  const [viewMode, setViewMode] = useState<ViewMode>('perspective');
  const [showContours, setShowContours] = useState(false);
  const [numContourLayers, setNumContourLayers] = useState(10);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState('');

  // Calculate real-world dimensions, print sizes, and auto tile grid
  const terrainDimensions = useMemo(() => {
    if (!bounds) return {
      widthKm: 0,
      heightKm: 0,
      printWidthMm: 0,
      printHeightMm: 0,
      tileRows: 1,
      tileCols: 1,
      tileWidthMm: 0,
      tileHeightMm: 0
    };

    const widthKm = calculateDistance(
      bounds.south, bounds.west,
      bounds.south, bounds.east
    );
    const heightKm = calculateDistance(
      bounds.south, bounds.west,
      bounds.north, bounds.west
    );

    // Calculate print dimensions at target scale
    // At 1:25000, 1mm = 25m, so widthKm * 1000000mm / 25000 = width in mm
    const printWidthMm = (widthKm * 1000000) / targetScale;
    const printHeightMm = (heightKm * 1000000) / targetScale;

    // Auto-calculate tile grid based on max tile size
    const tileCols = Math.max(1, Math.ceil(printWidthMm / maxTileSize));
    const tileRows = Math.max(1, Math.ceil(printHeightMm / maxTileSize));

    // Calculate actual tile dimensions
    const tileWidthMm = printWidthMm / tileCols;
    const tileHeightMm = printHeightMm / tileRows;

    return {
      widthKm,
      heightKm,
      printWidthMm,
      printHeightMm,
      tileRows,
      tileCols,
      tileWidthMm,
      tileHeightMm
    };
  }, [bounds, targetScale, maxTileSize]);

  const handleBoundsChange = useCallback((newBounds: Bounds) => {
    setBounds(newBounds);
    setError(null);
  }, []);

  const fetchTerrain = useCallback(async () => {
    if (!bounds) {
      setError('Please select an area on the map first');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/elevation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...bounds,
          resolution,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch elevation data');
      }

      const data: ElevationData = await response.json();
      setElevationData(data);
    } catch (err) {
      console.error('Error fetching terrain:', err);
      setError('Failed to fetch terrain data. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [bounds, resolution]);

  const handleExportSTL = useCallback(async () => {
    if (!elevationData) {
      setError('No terrain to export. Generate terrain first.');
      return;
    }

    setIsExporting(true);
    setError(null);

    const { tileRows, tileCols, tileWidthMm, tileHeightMm } = terrainDimensions;
    const totalTiles = tileRows * tileCols;

    try {
      // Export each tile separately using grid mesh
      for (let row = 0; row < tileRows; row++) {
        for (let col = 0; col < tileCols; col++) {
          const tileNum = row * tileCols + col + 1;
          setExportProgress(`Exporting tile ${tileNum}/${totalTiles}...`);

          // Extract elevation data for this tile
          const tileData = extractTileElevationData(
            elevationData,
            row,
            col,
            tileRows,
            tileCols
          );

          const locationName = bounds
            ? `terrain_${bounds.north.toFixed(2)}_${bounds.west.toFixed(2)}_r${row + 1}_c${col + 1}`
            : `terrain_r${row + 1}_c${col + 1}`;

          // Use the larger dimension to keep tiles square-ish in the STL
          const actualTileSize = Math.max(tileWidthMm, tileHeightMm);

          // Export using smoothed grid mesh (same as preview)
          exportTerrainToSTL(tileData, {
            tileSize: actualTileSize,
            baseThickness,
            verticalExaggeration,
            smoothingLevel,
            filename: locationName,
          });

          // Small delay between exports to avoid browser freezing
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      setExportProgress('');
    } catch (err) {
      console.error('Export error:', err);
      setError('Failed to export STL. Please try again.');
    } finally {
      setIsExporting(false);
      setExportProgress('');
    }
  }, [bounds, baseThickness, elevationData, verticalExaggeration, smoothingLevel, terrainDimensions]);

  const handleExportSVG = useCallback(async () => {
    if (!elevationData) {
      setError('No terrain to export. Generate terrain first.');
      return;
    }

    setIsExporting(true);
    setError(null);
    setExportProgress('Generating contour layers...');

    try {
      const { printWidthMm, printHeightMm } = terrainDimensions;

      const contourLayers = generateContourLayers(
        elevationData,
        numContourLayers
      );

      const locationName = bounds
        ? `contours_${bounds.north.toFixed(2)}_${bounds.west.toFixed(2)}`
        : 'contours';

      exportContourSVG(contourLayers, {
        width: printWidthMm,
        height: printHeightMm,
        filename: locationName,
      });

      setExportProgress('');
    } catch (err) {
      console.error('SVG export error:', err);
      setError('Failed to export SVG. Please try again.');
    } finally {
      setIsExporting(false);
      setExportProgress('');
    }
  }, [bounds, elevationData, numContourLayers, terrainDimensions]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>TerrainTiles</h1>
        <p className={styles.subtitle}>Transform elevation data into 3D-printable terrain</p>
      </header>

      <main className={styles.main}>
        <div className={styles.leftPanel}>
          <div className={styles.mapSection}>
            <h2 className={styles.sectionTitle}>Select Area</h2>
            <MapSelector
              onBoundsChange={handleBoundsChange}
              initialBounds={bounds || undefined}
            />
          </div>
        </div>

        <div className={styles.centerPanel}>
          <div className={styles.previewSection}>
            <h2 className={styles.sectionTitle}>3D Preview</h2>
            {error && <div className={styles.error}>{error}</div>}
            <div className={styles.terrainContainer}>
              <TerrainViewer
                data={elevationData}
                verticalExaggeration={verticalExaggeration}
                smoothingLevel={smoothingLevel}
                colorMode={colorMode}
                viewMode={viewMode}
                showContours={showContours}
                numContourLayers={numContourLayers}
                isLoading={isLoading}
                tileRows={terrainDimensions.tileRows}
                tileCols={terrainDimensions.tileCols}
                showTileGrid={showTileGrid}
              />
            </div>
            {elevationData && (
              <div className={styles.stats}>
                <span>Min: {elevationData.minElevation.toFixed(0)}m</span>
                <span>Max: {elevationData.maxElevation.toFixed(0)}m</span>
                <span>Range: {(elevationData.maxElevation - elevationData.minElevation).toFixed(0)}m</span>
              </div>
            )}
          </div>
        </div>

        <div className={styles.rightPanel}>
          <ControlPanel
            resolution={resolution}
            onResolutionChange={setResolution}
            verticalExaggeration={verticalExaggeration}
            onVerticalExaggerationChange={setVerticalExaggeration}
            smoothingLevel={smoothingLevel}
            onSmoothingLevelChange={setSmoothingLevel}
            targetScale={targetScale}
            onTargetScaleChange={setTargetScale}
            baseThickness={baseThickness}
            onBaseThicknessChange={setBaseThickness}
            maxTileSize={maxTileSize}
            onMaxTileSizeChange={setMaxTileSize}
            tileRows={terrainDimensions.tileRows}
            tileCols={terrainDimensions.tileCols}
            tileWidthMm={terrainDimensions.tileWidthMm}
            tileHeightMm={terrainDimensions.tileHeightMm}
            showTileGrid={showTileGrid}
            onShowTileGridChange={setShowTileGrid}
            colorMode={colorMode}
            onColorModeChange={setColorMode}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            showContours={showContours}
            onShowContoursChange={setShowContours}
            numContourLayers={numContourLayers}
            onNumContourLayersChange={setNumContourLayers}
            onFetchTerrain={fetchTerrain}
            onExportSTL={handleExportSTL}
            onExportSVG={handleExportSVG}
            isLoading={isLoading}
            isExporting={isExporting}
            exportProgress={exportProgress}
            hasTerrain={!!elevationData}
            terrainWidthKm={terrainDimensions.widthKm}
            terrainHeightKm={terrainDimensions.heightKm}
            printWidthMm={terrainDimensions.printWidthMm}
            printHeightMm={terrainDimensions.printHeightMm}
          />
        </div>
      </main>
    </div>
  );
}

// Extract a single tile's elevation data for server-side processing
function extractTileElevationData(
  fullData: ElevationData,
  row: number,
  col: number,
  totalRows: number,
  totalCols: number
): ElevationData {
  const { elevations, width, height, minElevation, maxElevation } = fullData;

  const tileWidth = Math.floor(width / totalCols);
  const tileHeight = Math.floor(height / totalRows);

  const startX = col * tileWidth;
  const startY = row * tileHeight;
  const endX = col === totalCols - 1 ? width : startX + tileWidth;
  const endY = row === totalRows - 1 ? height : startY + tileHeight;

  const actualTileWidth = endX - startX;
  const actualTileHeight = endY - startY;

  const tileElevations: number[] = [];
  let tileMin = Infinity;
  let tileMax = -Infinity;

  for (let j = 0; j < actualTileHeight; j++) {
    for (let i = 0; i < actualTileWidth; i++) {
      const elevIndex = (startY + j) * width + (startX + i);
      const elevation = elevations[elevIndex] ?? minElevation;
      tileElevations.push(elevation);
      tileMin = Math.min(tileMin, elevation);
      tileMax = Math.max(tileMax, elevation);
    }
  }

  return {
    elevations: tileElevations,
    width: actualTileWidth,
    height: actualTileHeight,
    minElevation: tileMin,
    maxElevation: tileMax,
  };
}
