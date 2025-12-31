import { ContourLayer } from './contourGenerator';

interface SVGExportOptions {
  width: number; // mm
  height: number; // mm
  filename: string;
  strokeWidth?: number;
  includeLabels?: boolean;
}

function generateLayerColor(index: number, total: number): string {
  // Generate distinct colors for each layer
  const hue = (index / total) * 360;
  return `hsl(${hue}, 70%, 40%)`;
}

export function exportContourSVG(
  layers: ContourLayer[],
  options: SVGExportOptions
): void {
  const {
    width,
    height,
    filename,
    strokeWidth = 0.5,
    includeLabels = true,
  } = options;

  // SVG dimensions in mm (will be interpreted correctly by laser cutters)
  const svgWidth = width;
  const svgHeight = height;

  let svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${svgWidth}mm"
     height="${svgHeight}mm"
     viewBox="0 0 ${svgWidth} ${svgHeight}">
  <title>Terrain Contour Layers</title>
  <desc>Generated contour layers for laser cutting</desc>

  <!-- Background rectangle (optional - remove for cutting) -->
  <rect x="0" y="0" width="${svgWidth}" height="${svgHeight}"
        fill="none" stroke="#ccc" stroke-width="0.25"/>

`;

  // Add each contour layer as a group
  layers.forEach((layer, layerIndex) => {
    const color = generateLayerColor(layerIndex, layers.length);

    svgContent += `  <!-- Layer ${layerIndex + 1}: ${layer.elevation.toFixed(1)}m -->\n`;
    svgContent += `  <g id="layer-${layerIndex + 1}" stroke="${color}" stroke-width="${strokeWidth}" fill="none">\n`;

    layer.paths.forEach((path, pathIndex) => {
      if (path.length < 2) return;

      // Convert normalized coordinates to SVG coordinates
      // Note: Y is inverted (0,0 is top-left in SVG)
      const points = path.map(([x, y]) => [
        x * svgWidth,
        (1 - y) * svgHeight, // Flip Y
      ]);

      // Create SVG path
      const d = points
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(3)} ${p[1].toFixed(3)}`)
        .join(' ');

      // Check if path is closed (first and last points are close)
      const isClosed =
        Math.abs(points[0][0] - points[points.length - 1][0]) < 0.1 &&
        Math.abs(points[0][1] - points[points.length - 1][1]) < 0.1;

      svgContent += `    <path d="${d}${isClosed ? ' Z' : ''}" />\n`;
    });

    svgContent += `  </g>\n\n`;
  });

  // Add elevation labels if requested
  if (includeLabels) {
    svgContent += `  <!-- Elevation labels -->\n`;
    svgContent += `  <g id="labels" font-family="Arial" font-size="3" fill="#333">\n`;

    layers.forEach((layer, index) => {
      const yPos = 5 + index * 4;
      const color = generateLayerColor(index, layers.length);
      svgContent += `    <text x="2" y="${yPos}">`;
      svgContent += `<tspan fill="${color}">Layer ${index + 1}: ${layer.elevation.toFixed(1)}m</tspan>`;
      svgContent += `</text>\n`;
    });

    svgContent += `  </g>\n`;
  }

  svgContent += `</svg>`;

  // Download the SVG file
  downloadFile(svgContent, `${filename}.svg`, 'image/svg+xml');
}

export function exportLayeredSVGs(
  layers: ContourLayer[],
  options: Omit<SVGExportOptions, 'includeLabels'>
): void {
  const { width, height, filename, strokeWidth = 0.5 } = options;

  // Export each layer as a separate SVG file
  layers.forEach((layer, index) => {
    const svgWidth = width;
    const svgHeight = height;

    let svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${svgWidth}mm"
     height="${svgHeight}mm"
     viewBox="0 0 ${svgWidth} ${svgHeight}">
  <title>Contour Layer ${index + 1} - ${layer.elevation.toFixed(1)}m</title>

  <g id="contour" stroke="#000" stroke-width="${strokeWidth}" fill="none">
`;

    layer.paths.forEach((path) => {
      if (path.length < 2) return;

      const points = path.map(([x, y]) => [
        x * svgWidth,
        (1 - y) * svgHeight,
      ]);

      const d = points
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(3)} ${p[1].toFixed(3)}`)
        .join(' ');

      const isClosed =
        Math.abs(points[0][0] - points[points.length - 1][0]) < 0.1 &&
        Math.abs(points[0][1] - points[points.length - 1][1]) < 0.1;

      svgContent += `    <path d="${d}${isClosed ? ' Z' : ''}" />\n`;
    });

    svgContent += `  </g>
</svg>`;

    downloadFile(
      svgContent,
      `${filename}_layer${String(index + 1).padStart(2, '0')}_${layer.elevation.toFixed(0)}m.svg`,
      'image/svg+xml'
    );
  });
}

function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
