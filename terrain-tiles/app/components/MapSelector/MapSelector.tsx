'use client';

import { useState, useCallback, useEffect } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents, Rectangle, Polygon, Polyline, CircleMarker } from 'react-leaflet';
import styles from './MapSelector.module.css';
import 'leaflet/dist/leaflet.css';

interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

type SelectionMode = 'rectangle' | 'polygon';

interface PolygonPoint {
  lat: number;
  lng: number;
}

interface MapSelectorProps {
  onBoundsChange: (bounds: Bounds) => void;
  initialBounds?: Bounds;
}

function SelectionRectangle({
  bounds,
  onBoundsChange,
  isActive,
}: {
  bounds: Bounds | null;
  onBoundsChange: (bounds: Bounds) => void;
  isActive: boolean;
}) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [currentBounds, setCurrentBounds] = useState<Bounds | null>(bounds);

  useEffect(() => {
    setCurrentBounds(bounds);
  }, [bounds]);

  useMapEvents({
    mousedown(e) {
      if (isActive && e.originalEvent.shiftKey) {
        setIsDrawing(true);
        setStartPoint({ lat: e.latlng.lat, lng: e.latlng.lng });
      }
    },
    mousemove(e) {
      if (isActive && isDrawing && startPoint) {
        const newBounds: Bounds = {
          north: Math.max(startPoint.lat, e.latlng.lat),
          south: Math.min(startPoint.lat, e.latlng.lat),
          east: Math.max(startPoint.lng, e.latlng.lng),
          west: Math.min(startPoint.lng, e.latlng.lng),
        };
        setCurrentBounds(newBounds);
      }
    },
    mouseup() {
      if (isActive && isDrawing && currentBounds) {
        setIsDrawing(false);
        setStartPoint(null);
        onBoundsChange(currentBounds);
      }
    },
  });

  if (!currentBounds) return null;

  const rectangleBounds: [[number, number], [number, number]] = [
    [currentBounds.south, currentBounds.west],
    [currentBounds.north, currentBounds.east],
  ];

  return (
    <Rectangle
      bounds={rectangleBounds}
      pathOptions={{
        color: '#4a9eff',
        weight: 2,
        fillColor: '#4a9eff',
        fillOpacity: 0.2,
      }}
    />
  );
}

function SelectionPolygon({
  polygonPoints,
  setPolygonPoints,
  onBoundsChange,
  isActive,
  isComplete,
  setIsComplete,
}: {
  polygonPoints: PolygonPoint[];
  setPolygonPoints: (points: PolygonPoint[]) => void;
  onBoundsChange: (bounds: Bounds) => void;
  isActive: boolean;
  isComplete: boolean;
  setIsComplete: (complete: boolean) => void;
}) {
  const [mousePosition, setMousePosition] = useState<PolygonPoint | null>(null);
  const map = useMap();

  const calculateBoundsFromPolygon = useCallback((points: PolygonPoint[]): Bounds => {
    const lats = points.map(p => p.lat);
    const lngs = points.map(p => p.lng);
    return {
      north: Math.max(...lats),
      south: Math.min(...lats),
      east: Math.max(...lngs),
      west: Math.min(...lngs),
    };
  }, []);

  // Get pixel distance for click detection
  const getPixelDistance = useCallback((p1: PolygonPoint, p2: PolygonPoint): number => {
    const point1 = map.latLngToContainerPoint([p1.lat, p1.lng]);
    const point2 = map.latLngToContainerPoint([p2.lat, p2.lng]);
    return Math.sqrt(Math.pow(point1.x - point2.x, 2) + Math.pow(point1.y - point2.y, 2));
  }, [map]);

  useMapEvents({
    click(e) {
      if (!isActive || isComplete) return;

      const clickPoint = { lat: e.latlng.lat, lng: e.latlng.lng };

      // Check if clicking near the first point to close the polygon
      if (polygonPoints.length >= 3) {
        const firstPoint = polygonPoints[0];
        const pixelDistance = getPixelDistance(clickPoint, firstPoint);

        // If within 15 pixels of first point, close the polygon
        if (pixelDistance < 15) {
          const bounds = calculateBoundsFromPolygon(polygonPoints);
          onBoundsChange(bounds);
          setIsComplete(true);
          return;
        }
      }

      // Add new point
      const newPoints = [...polygonPoints, clickPoint];
      setPolygonPoints(newPoints);
    },
    mousemove(e) {
      if (isActive && !isComplete && polygonPoints.length > 0) {
        setMousePosition({ lat: e.latlng.lat, lng: e.latlng.lng });
      }
    },
    dblclick(e) {
      if (!isActive || isComplete || polygonPoints.length < 3) return;

      // Close polygon on double-click
      e.originalEvent.preventDefault();
      e.originalEvent.stopPropagation();
      const bounds = calculateBoundsFromPolygon(polygonPoints);
      onBoundsChange(bounds);
      setIsComplete(true);
    },
  });

  if (polygonPoints.length === 0) return null;

  const positions: [number, number][] = polygonPoints.map(p => [p.lat, p.lng]);

  // Add mouse position for preview line
  const previewPositions: [number, number][] = mousePosition && isActive && !isComplete
    ? [...positions, [mousePosition.lat, mousePosition.lng]]
    : positions;

  return (
    <>
      {/* Completed polygon fill */}
      {polygonPoints.length >= 3 && (
        <Polygon
          positions={positions}
          pathOptions={{
            color: '#4a9eff',
            weight: 2,
            fillColor: '#4a9eff',
            fillOpacity: 0.2,
          }}
        />
      )}

      {/* Preview line while drawing */}
      {isActive && !isComplete && polygonPoints.length > 0 && (
        <Polyline
          positions={previewPositions}
          pathOptions={{
            color: '#4a9eff',
            weight: 2,
            dashArray: '5, 5',
          }}
        />
      )}

      {/* Vertex markers */}
      {polygonPoints.map((point, index) => (
        <CircleMarker
          key={index}
          center={[point.lat, point.lng]}
          radius={index === 0 && polygonPoints.length >= 3 && !isComplete ? 8 : 5}
          pathOptions={{
            color: index === 0 && polygonPoints.length >= 3 && !isComplete ? '#00ff88' : '#4a9eff',
            fillColor: index === 0 && polygonPoints.length >= 3 && !isComplete ? '#00ff88' : '#4a9eff',
            fillOpacity: 1,
            weight: 2,
          }}
        />
      ))}
    </>
  );
}

function MapController({ center }: { center: [number, number] }) {
  const map = useMap();

  useEffect(() => {
    map.setView(center, 10);
  }, [map, center]);

  return null;
}

export default function MapSelector({ onBoundsChange, initialBounds }: MapSelectorProps) {
  const [bounds, setBounds] = useState<Bounds | null>(initialBounds || null);
  const [searchQuery, setSearchQuery] = useState('');
  const [mapCenter, setMapCenter] = useState<[number, number]>([39.7392, -104.9903]); // Denver
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('rectangle');
  const [polygonPoints, setPolygonPoints] = useState<PolygonPoint[]>([]);
  const [isPolygonComplete, setIsPolygonComplete] = useState(false);

  const handleBoundsChange = useCallback(
    (newBounds: Bounds) => {
      setBounds(newBounds);
      onBoundsChange(newBounds);
    },
    [onBoundsChange]
  );

  const handleModeChange = (mode: SelectionMode) => {
    setSelectionMode(mode);
    // Clear polygon when switching modes
    if (mode === 'rectangle') {
      setPolygonPoints([]);
      setIsPolygonComplete(false);
    }
  };

  const handleClearPolygon = () => {
    setPolygonPoints([]);
    setIsPolygonComplete(false);
    setBounds(null);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    try {
      // Use Nominatim for geocoding (free, no API key)
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}`
      );
      const data = await response.json();

      if (data && data.length > 0) {
        const { lat, lon, boundingbox } = data[0];
        setMapCenter([parseFloat(lat), parseFloat(lon)]);

        // Set initial bounds from the search result
        if (boundingbox) {
          const newBounds: Bounds = {
            south: parseFloat(boundingbox[0]),
            north: parseFloat(boundingbox[1]),
            west: parseFloat(boundingbox[2]),
            east: parseFloat(boundingbox[3]),
          };
          handleBoundsChange(newBounds);
        }
      }
    } catch (error) {
      console.error('Geocoding error:', error);
    }
  };

  const handleQuickSelect = (name: string, lat: number, lng: number, size: number = 0.1) => {
    setMapCenter([lat, lng]);
    const newBounds: Bounds = {
      north: lat + size,
      south: lat - size,
      east: lng + size,
      west: lng - size,
    };
    handleBoundsChange(newBounds);
    // Switch to rectangle mode for quick select
    setSelectionMode('rectangle');
    setPolygonPoints([]);
    setIsPolygonComplete(false);
  };

  return (
    <div className={styles.container}>
      <div className={styles.searchBar}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search location..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <button className={styles.searchButton} onClick={handleSearch}>
          Search
        </button>
      </div>

      <div className={styles.modeSelector}>
        <span className={styles.modeLabel}>Selection:</span>
        <div className={styles.modeButtons}>
          <button
            className={`${styles.modeButton} ${selectionMode === 'rectangle' ? styles.modeButtonActive : ''}`}
            onClick={() => handleModeChange('rectangle')}
          >
            Rectangle
          </button>
          <button
            className={`${styles.modeButton} ${selectionMode === 'polygon' ? styles.modeButtonActive : ''}`}
            onClick={() => handleModeChange('polygon')}
          >
            Polygon
          </button>
        </div>
        {selectionMode === 'polygon' && polygonPoints.length > 0 && (
          <button className={styles.clearButton} onClick={handleClearPolygon}>
            Clear
          </button>
        )}
      </div>

      <div className={styles.quickSelect}>
        <span>Quick Select:</span>
        <button onClick={() => handleQuickSelect('Grand Canyon', 36.0544, -112.1401, 0.15)}>
          Grand Canyon
        </button>
        <button onClick={() => handleQuickSelect('Mt. Rainier', 46.8523, -121.7603, 0.1)}>
          Mt. Rainier
        </button>
        <button onClick={() => handleQuickSelect('Yosemite', 37.8651, -119.5383, 0.1)}>
          Yosemite
        </button>
      </div>

      <div className={styles.mapWrapper}>
        <MapContainer
          center={mapCenter}
          zoom={10}
          className={styles.map}
          scrollWheelZoom={true}
          doubleClickZoom={selectionMode !== 'polygon'}
        >
          <MapController center={mapCenter} />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <SelectionRectangle
            bounds={selectionMode === 'rectangle' ? bounds : null}
            onBoundsChange={handleBoundsChange}
            isActive={selectionMode === 'rectangle'}
          />
          <SelectionPolygon
            polygonPoints={polygonPoints}
            setPolygonPoints={setPolygonPoints}
            onBoundsChange={handleBoundsChange}
            isActive={selectionMode === 'polygon'}
            isComplete={isPolygonComplete}
            setIsComplete={setIsPolygonComplete}
          />
        </MapContainer>
      </div>

      <div className={styles.instructions}>
        {selectionMode === 'rectangle' ? (
          <>
            <strong>Shift + Click & Drag</strong> to select a rectangular area
          </>
        ) : (
          <>
            <strong>Click</strong> to add points. <strong>Click first point</strong> or <strong>double-click</strong> to close polygon.
          </>
        )}
      </div>

      {bounds && (
        <div className={styles.boundsInfo}>
          <div className={styles.boundsRow}>
            <span>North: {bounds.north.toFixed(4)}</span>
            <span>South: {bounds.south.toFixed(4)}</span>
          </div>
          <div className={styles.boundsRow}>
            <span>East: {bounds.east.toFixed(4)}</span>
            <span>West: {bounds.west.toFixed(4)}</span>
          </div>
          {selectionMode === 'polygon' && polygonPoints.length > 0 && (
            <div className={styles.polygonInfo}>
              {polygonPoints.length} points • Bounding box shown above
            </div>
          )}
        </div>
      )}
    </div>
  );
}
