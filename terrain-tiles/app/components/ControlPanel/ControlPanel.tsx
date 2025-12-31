'use client';

import styles from './ControlPanel.module.css';

export type ColorMode = 'color' | 'grayscale' | 'print';
export type ViewMode = 'perspective' | 'orthographic';

interface ControlPanelProps {
  resolution: number;
  onResolutionChange: (value: number) => void;
  verticalExaggeration: number;
  onVerticalExaggerationChange: (value: number) => void;
  smoothingLevel: number;
  onSmoothingLevelChange: (value: number) => void;
  targetScale: number;
  onTargetScaleChange: (value: number) => void;
  baseThickness: number;
  onBaseThicknessChange: (value: number) => void;
  maxTileSize: number;
  onMaxTileSizeChange: (value: number) => void;
  tileRows: number;
  tileCols: number;
  tileWidthMm: number;
  tileHeightMm: number;
  showTileGrid: boolean;
  onShowTileGridChange: (value: boolean) => void;
  colorMode: ColorMode;
  onColorModeChange: (value: ColorMode) => void;
  viewMode: ViewMode;
  onViewModeChange: (value: ViewMode) => void;
  showContours: boolean;
  onShowContoursChange: (value: boolean) => void;
  numContourLayers: number;
  onNumContourLayersChange: (value: number) => void;
  onFetchTerrain: () => void;
  onExportSTL: () => void;
  onExportSVG?: () => void;
  isLoading: boolean;
  isExporting?: boolean;
  exportProgress?: string;
  hasTerrain: boolean;
  terrainWidthKm?: number;
  terrainHeightKm?: number;
  printWidthMm?: number;
  printHeightMm?: number;
}

export default function ControlPanel({
  resolution,
  onResolutionChange,
  verticalExaggeration,
  onVerticalExaggerationChange,
  smoothingLevel,
  onSmoothingLevelChange,
  targetScale,
  onTargetScaleChange,
  baseThickness,
  onBaseThicknessChange,
  maxTileSize,
  onMaxTileSizeChange,
  tileRows,
  tileCols,
  tileWidthMm,
  tileHeightMm,
  showTileGrid,
  onShowTileGridChange,
  colorMode,
  onColorModeChange,
  viewMode,
  onViewModeChange,
  showContours,
  onShowContoursChange,
  numContourLayers,
  onNumContourLayersChange,
  onFetchTerrain,
  onExportSTL,
  onExportSVG,
  isLoading,
  isExporting = false,
  exportProgress = '',
  hasTerrain,
  terrainWidthKm,
  terrainHeightKm,
  printWidthMm,
  printHeightMm,
}: ControlPanelProps) {
  const totalTiles = tileRows * tileCols;

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>Terrain Settings</h3>

      <div className={styles.section}>
        <label className={styles.label}>
          Resolution
          <span className={styles.value}>{resolution}x{resolution}</span>
        </label>
        <input
          type="range"
          min="50"
          max="200"
          step="10"
          value={resolution}
          onChange={(e) => onResolutionChange(parseInt(e.target.value))}
          className={styles.slider}
        />
        <div className={styles.sliderLabels}>
          <span>Low</span>
          <span>High</span>
        </div>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>
          Vertical Exaggeration
          <span className={styles.value}>{verticalExaggeration.toFixed(1)}x</span>
        </label>
        <input
          type="range"
          min="0.5"
          max="3"
          step="0.1"
          value={verticalExaggeration}
          onChange={(e) => onVerticalExaggerationChange(parseFloat(e.target.value))}
          className={styles.slider}
        />
        <div className={styles.sliderLabels}>
          <span>Flat</span>
          <span>Steep</span>
        </div>
        {verticalExaggeration > 2 && (
          <div className={styles.warning}>
            High exaggeration may introduce surface artifacts
          </div>
        )}
      </div>

      <div className={styles.section}>
        <label className={styles.label}>
          Terrain Smoothing
          <span className={styles.value}>{['None', 'Light', 'Medium', 'Heavy'][smoothingLevel]}</span>
        </label>
        <input
          type="range"
          min="0"
          max="3"
          step="1"
          value={smoothingLevel}
          onChange={(e) => onSmoothingLevelChange(parseInt(e.target.value))}
          className={styles.slider}
        />
        <div className={styles.sliderLabels}>
          <span>Raw</span>
          <span>Smooth</span>
        </div>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>
          Map Scale
          <span className={styles.value}>1:{targetScale.toLocaleString()}</span>
        </label>
        <input
          type="range"
          min="10000"
          max="100000"
          step="5000"
          value={targetScale}
          onChange={(e) => onTargetScaleChange(parseInt(e.target.value))}
          className={styles.slider}
        />
        <div className={styles.sliderLabels}>
          <span>1:10,000</span>
          <span>1:100,000</span>
        </div>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Preview Style</label>
        <div className={styles.toggleGroup}>
          <button
            className={`${styles.toggleButton} ${colorMode === 'color' ? styles.toggleActive : ''}`}
            onClick={() => onColorModeChange('color')}
          >
            Color
          </button>
          <button
            className={`${styles.toggleButton} ${colorMode === 'grayscale' ? styles.toggleActive : ''}`}
            onClick={() => onColorModeChange('grayscale')}
          >
            Grayscale
          </button>
          <button
            className={`${styles.toggleButton} ${colorMode === 'print' ? styles.toggleActive : ''}`}
            onClick={() => onColorModeChange('print')}
          >
            Print
          </button>
        </div>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Camera View</label>
        <div className={styles.toggleGroup}>
          <button
            className={`${styles.toggleButton} ${viewMode === 'perspective' ? styles.toggleActive : ''}`}
            onClick={() => onViewModeChange('perspective')}
          >
            3D
          </button>
          <button
            className={`${styles.toggleButton} ${viewMode === 'orthographic' ? styles.toggleActive : ''}`}
            onClick={() => onViewModeChange('orthographic')}
          >
            Top-Down
          </button>
        </div>
      </div>

      <div className={styles.divider} />

      <h3 className={styles.title}>Contour Layers</h3>

      <div className={styles.checkboxRow}>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={showContours}
            onChange={(e) => onShowContoursChange(e.target.checked)}
            className={styles.checkbox}
          />
          Show contour lines
        </label>
      </div>

      {showContours && (
        <div className={styles.section}>
          <label className={styles.label}>
            Number of Layers
            <span className={styles.value}>{numContourLayers}</span>
          </label>
          <input
            type="range"
            min="5"
            max="30"
            step="1"
            value={numContourLayers}
            onChange={(e) => onNumContourLayersChange(parseInt(e.target.value))}
            className={styles.slider}
          />
          <div className={styles.sliderLabels}>
            <span>Few</span>
            <span>Many</span>
          </div>
        </div>
      )}

      <div className={styles.divider} />

      <h3 className={styles.title}>Print Layout</h3>

      <div className={styles.section}>
        <label className={styles.label}>
          Max Tile Size
          <span className={styles.value}>{maxTileSize}mm</span>
        </label>
        <input
          type="range"
          min="50"
          max="300"
          step="10"
          value={maxTileSize}
          onChange={(e) => onMaxTileSizeChange(parseInt(e.target.value))}
          className={styles.slider}
        />
        <div className={styles.sliderLabels}>
          <span>50mm</span>
          <span>300mm</span>
        </div>
      </div>

      <div className={styles.checkboxRow}>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={showTileGrid}
            onChange={(e) => onShowTileGridChange(e.target.checked)}
            className={styles.checkbox}
          />
          Show tile grid in preview
        </label>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>
          Base Thickness
          <span className={styles.value}>{baseThickness}mm</span>
        </label>
        <input
          type="range"
          min="1"
          max="20"
          step="1"
          value={baseThickness}
          onChange={(e) => onBaseThicknessChange(parseInt(e.target.value))}
          className={styles.slider}
        />
        <div className={styles.sliderLabels}>
          <span>Thin</span>
          <span>Thick</span>
        </div>
      </div>

      <div className={styles.printInfo}>
        <div className={styles.printInfoRow}>
          <span>Tile grid:</span>
          <strong>{tileCols} x {tileRows} = {totalTiles} tiles</strong>
        </div>
        {printWidthMm && printHeightMm && printWidthMm > 0 ? (
          <>
            <div className={styles.printInfoRow}>
              <span>Total print size:</span>
              <strong>{Math.round(printWidthMm)} x {Math.round(printHeightMm)}mm</strong>
            </div>
            <div className={styles.printInfoRow}>
              <span>Actual tile size:</span>
              <strong>{Math.round(tileWidthMm)} x {Math.round(tileHeightMm)}mm</strong>
            </div>
          </>
        ) : (
          <div className={styles.printInfoRow}>
            <span className={styles.hint}>Select an area on the map</span>
          </div>
        )}
        {terrainWidthKm && terrainHeightKm && terrainWidthKm > 0 && (
          <div className={styles.printInfoRow}>
            <span>Real area:</span>
            <strong>{terrainWidthKm.toFixed(1)} x {terrainHeightKm.toFixed(1)}km</strong>
          </div>
        )}
      </div>

      <div className={styles.actions}>
        <button
          className={styles.primaryButton}
          onClick={onFetchTerrain}
          disabled={isLoading}
        >
          {isLoading ? 'Loading...' : 'Generate Terrain'}
        </button>

        <button
          className={styles.secondaryButton}
          onClick={onExportSTL}
          disabled={!hasTerrain || isLoading || isExporting}
        >
          {isExporting
            ? (exportProgress || 'Exporting...')
            : `Export STL Tiles (${totalTiles} files)`}
        </button>

        {onExportSVG && showContours && (
          <button
            className={styles.secondaryButton}
            onClick={onExportSVG}
            disabled={!hasTerrain || isLoading || isExporting}
          >
            Export Contour SVG ({numContourLayers} layers)
          </button>
        )}
      </div>
    </div>
  );
}
