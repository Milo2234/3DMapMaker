import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { writeFile, readFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

interface ExportRequest {
  elevations: number[];
  width: number;
  height: number;
  minElevation: number;
  maxElevation: number;
  options: {
    verticalExaggeration: number;
    tileSize: number;
    baseThickness: number;
    targetFaces?: number;
    highQuality?: boolean;
    tileRow?: number;
    tileCol?: number;
  };
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const tempDir = join(tmpdir(), 'terrain-tiles', requestId);

  try {
    const data: ExportRequest = await request.json();

    // Create temp directory
    await mkdir(tempDir, { recursive: true });

    const inputPath = join(tempDir, 'input.json');
    const optionsPath = join(tempDir, 'options.json');
    const outputPath = join(tempDir, 'output.stl');

    // Write input data
    await writeFile(inputPath, JSON.stringify({
      elevations: data.elevations,
      width: data.width,
      height: data.height,
      minElevation: data.minElevation,
      maxElevation: data.maxElevation,
    }));

    // Write options
    await writeFile(optionsPath, JSON.stringify(data.options));

    // Run Python processor
    const scriptPath = join(process.cwd(), 'scripts', 'tin_processor.py');

    const result = await new Promise<{ success: boolean; error?: string }>((resolve) => {
      const python = spawn('python', [scriptPath, inputPath, outputPath, optionsPath]);

      let stdout = '';
      let stderr = '';

      python.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      python.stderr.on('data', (data) => {
        stderr += data.toString();
        console.log('[TIN Processor]', data.toString());
      });

      python.on('close', (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(stdout);
            resolve(result);
          } catch {
            resolve({ success: true });
          }
        } else {
          resolve({ success: false, error: stderr || `Process exited with code ${code}` });
        }
      });

      python.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });

    if (!result.success) {
      // Clean up
      await cleanup(tempDir, inputPath, optionsPath, outputPath);
      return NextResponse.json({ error: result.error || 'Export failed' }, { status: 500 });
    }

    // Read the STL file
    const stlData = await readFile(outputPath);

    // Clean up temp files
    await cleanup(tempDir, inputPath, optionsPath, outputPath);

    // Return STL as binary
    const filename = data.options.tileRow !== undefined && data.options.tileCol !== undefined
      ? `terrain_r${data.options.tileRow + 1}_c${data.options.tileCol + 1}.stl`
      : 'terrain.stl';

    return new NextResponse(stlData, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Export failed' },
      { status: 500 }
    );
  }
}

async function cleanup(tempDir: string, ...files: string[]) {
  for (const file of files) {
    try {
      await unlink(file);
    } catch {
      // Ignore errors
    }
  }
  try {
    await unlink(tempDir);
  } catch {
    // Ignore errors
  }
}
