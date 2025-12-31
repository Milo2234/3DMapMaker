#!/usr/bin/env python3
"""
High-fidelity TIN mesh processor for terrain STL export.
Uses pymeshlab for advanced mesh simplification that preserves terrain features.
"""

import sys
import json
import numpy as np
from pathlib import Path

try:
    import pymeshlab
    HAS_PYMESHLAB = True
except ImportError:
    HAS_PYMESHLAB = False

def create_terrain_mesh(elevations, width, height, min_elev, max_elev,
                        vertical_exaggeration=1.5, mesh_size=10.0):
    """Create a mesh from elevation data."""
    elev_range = max_elev - min_elev if max_elev != min_elev else 1
    scale_factor = (3 / elev_range) * vertical_exaggeration

    # Create vertices
    vertices = []
    half_size = mesh_size / 2

    for j in range(height):
        for i in range(width):
            x = (i / (width - 1)) * mesh_size - half_size
            y = (j / (height - 1)) * mesh_size - half_size
            z = (elevations[j * width + i] - min_elev) * scale_factor
            vertices.append([x, y, z])

    vertices = np.array(vertices, dtype=np.float64)

    # Create faces (two triangles per grid cell)
    faces = []
    for j in range(height - 1):
        for i in range(width - 1):
            v0 = j * width + i
            v1 = v0 + 1
            v2 = (j + 1) * width + i
            v3 = v2 + 1

            # Two triangles per quad
            faces.append([v0, v2, v1])
            faces.append([v1, v2, v3])

    faces = np.array(faces, dtype=np.int32)

    return vertices, faces


def simplify_mesh_pymeshlab(vertices, faces, target_faces=None, quality_threshold=0.3):
    """
    Simplify mesh using PyMeshLab's quadric edge collapse decimation.
    This creates an adaptive TIN that preserves terrain features.
    """
    if not HAS_PYMESHLAB:
        raise ImportError("pymeshlab is required for high-fidelity TIN export")

    ms = pymeshlab.MeshSet()

    # Create mesh from numpy arrays
    m = pymeshlab.Mesh(vertices, faces)
    ms.add_mesh(m)

    # Calculate target number of faces if not specified
    if target_faces is None:
        target_faces = max(1000, len(faces) // 10)

    # Apply quadric edge collapse decimation
    # This algorithm preserves geometric features by using quadric error metrics
    ms.meshing_decimation_quadric_edge_collapse(
        targetfacenum=target_faces,
        qualitythr=quality_threshold,
        preserveboundary=True,
        preservenormal=True,
        preservetopology=True,
        optimalplacement=True,
        planarquadric=True,  # Better for terrain
    )

    # Get the simplified mesh
    simplified = ms.current_mesh()

    return simplified.vertex_matrix(), simplified.face_matrix()


def simplify_mesh_basic(vertices, faces, target_ratio=0.1):
    """
    Basic mesh simplification using vertex clustering.
    Fallback when pymeshlab is not available.
    """
    from scipy.spatial import Delaunay

    # Sample points based on importance (curvature/slope)
    n_target = max(1000, int(len(vertices) * target_ratio))

    # Calculate importance scores based on local height variation
    width = int(np.sqrt(len(vertices)))
    height = width

    importance = np.zeros(len(vertices))
    for j in range(1, height - 1):
        for i in range(1, width - 1):
            idx = j * width + i
            center = vertices[idx, 2]
            neighbors = [
                vertices[idx - 1, 2],
                vertices[idx + 1, 2],
                vertices[idx - width, 2],
                vertices[idx + width, 2],
            ]
            # Laplacian = difference from average of neighbors
            avg = sum(neighbors) / 4
            importance[idx] = abs(center - avg)

    # Always include corners and edges
    corner_edge_indices = []
    for j in [0, height - 1]:
        for i in range(width):
            corner_edge_indices.append(j * width + i)
    for j in range(1, height - 1):
        corner_edge_indices.append(j * width)
        corner_edge_indices.append(j * width + width - 1)

    # Select top important interior points
    interior_mask = np.ones(len(vertices), dtype=bool)
    for idx in corner_edge_indices:
        interior_mask[idx] = False

    interior_indices = np.where(interior_mask)[0]
    interior_importance = importance[interior_indices]

    n_interior = n_target - len(corner_edge_indices)
    if n_interior > 0:
        top_interior = interior_indices[np.argsort(interior_importance)[-n_interior:]]
        selected_indices = np.array(list(corner_edge_indices) + list(top_interior))
    else:
        selected_indices = np.array(corner_edge_indices)

    selected_vertices = vertices[selected_indices]

    # Create new triangulation
    points_2d = selected_vertices[:, :2]
    tri = Delaunay(points_2d)
    new_faces = tri.simplices

    return selected_vertices, new_faces


def add_base(vertices, faces, base_thickness=5.0, mesh_size=10.0):
    """Add a solid base to the terrain mesh for 3D printing."""
    half_size = mesh_size / 2
    min_z = vertices[:, 2].min()
    base_z = min_z - base_thickness

    # Get boundary vertices (edges of the terrain)
    width = int(np.sqrt(len(vertices)))
    height = width

    # Create base vertices (copy of surface vertices but at base_z)
    n_surface = len(vertices)
    base_vertices = vertices.copy()
    base_vertices[:, 2] = base_z

    all_vertices = np.vstack([vertices, base_vertices])

    # Add bottom faces (reversed winding for correct normals)
    bottom_faces = faces.copy()
    bottom_faces = bottom_faces + n_surface
    bottom_faces = bottom_faces[:, ::-1]  # Reverse winding

    # Add side faces along the boundary
    side_faces = []

    # Top edge (j=0)
    for i in range(width - 1):
        v0 = i
        v1 = i + 1
        v2 = v0 + n_surface
        v3 = v1 + n_surface
        side_faces.append([v0, v1, v3])
        side_faces.append([v0, v3, v2])

    # Bottom edge (j=height-1)
    for i in range(width - 1):
        v0 = (height - 1) * width + i
        v1 = v0 + 1
        v2 = v0 + n_surface
        v3 = v1 + n_surface
        side_faces.append([v1, v0, v2])
        side_faces.append([v1, v2, v3])

    # Left edge (i=0)
    for j in range(height - 1):
        v0 = j * width
        v1 = (j + 1) * width
        v2 = v0 + n_surface
        v3 = v1 + n_surface
        side_faces.append([v1, v0, v2])
        side_faces.append([v1, v2, v3])

    # Right edge (i=width-1)
    for j in range(height - 1):
        v0 = j * width + width - 1
        v1 = (j + 1) * width + width - 1
        v2 = v0 + n_surface
        v3 = v1 + n_surface
        side_faces.append([v0, v1, v3])
        side_faces.append([v0, v3, v2])

    side_faces = np.array(side_faces, dtype=np.int32)
    all_faces = np.vstack([faces, bottom_faces, side_faces])

    return all_vertices, all_faces


def scale_for_printing(vertices, tile_size_mm):
    """Scale mesh to physical print size."""
    current_size = vertices[:, :2].max() - vertices[:, :2].min()
    scale = tile_size_mm / current_size

    scaled = vertices.copy()
    scaled *= scale

    # Center on origin
    center = (scaled.max(axis=0) + scaled.min(axis=0)) / 2
    center[2] = scaled[:, 2].min()  # Keep z at 0
    scaled -= center

    return scaled


def write_binary_stl(vertices, faces, filepath):
    """Write mesh as binary STL file."""
    n_triangles = len(faces)

    with open(filepath, 'wb') as f:
        # Header (80 bytes)
        header = b'Binary STL - TerrainTiles TIN Export' + b'\0' * (80 - 36)
        f.write(header)

        # Number of triangles
        f.write(np.uint32(n_triangles).tobytes())

        # Write each triangle
        for face in faces:
            v0, v1, v2 = vertices[face[0]], vertices[face[1]], vertices[face[2]]

            # Calculate normal
            e1 = v1 - v0
            e2 = v2 - v0
            normal = np.cross(e1, e2)
            norm = np.linalg.norm(normal)
            if norm > 0:
                normal /= norm

            # Write normal
            f.write(np.float32(normal).tobytes())

            # Write vertices
            f.write(np.float32(v0).tobytes())
            f.write(np.float32(v1).tobytes())
            f.write(np.float32(v2).tobytes())

            # Attribute byte count (unused)
            f.write(np.uint16(0).tobytes())


def process_terrain(input_data, output_path, options):
    """Main processing function."""
    elevations = input_data['elevations']
    width = input_data['width']
    height = input_data['height']
    min_elev = input_data['minElevation']
    max_elev = input_data['maxElevation']

    vertical_exaggeration = options.get('verticalExaggeration', 1.5)
    tile_size = options.get('tileSize', 150)
    base_thickness = options.get('baseThickness', 5)
    target_faces = options.get('targetFaces', None)
    use_high_quality = options.get('highQuality', True)

    print(f"Creating mesh from {width}x{height} elevation data...", file=sys.stderr)
    vertices, faces = create_terrain_mesh(
        elevations, width, height, min_elev, max_elev,
        vertical_exaggeration
    )
    print(f"Initial mesh: {len(vertices)} vertices, {len(faces)} faces", file=sys.stderr)

    # Simplify mesh
    if use_high_quality and HAS_PYMESHLAB:
        print("Applying high-quality TIN simplification (pymeshlab)...", file=sys.stderr)
        vertices, faces = simplify_mesh_pymeshlab(vertices, faces, target_faces)
    else:
        if use_high_quality and not HAS_PYMESHLAB:
            print("pymeshlab not available, using basic simplification...", file=sys.stderr)
        print("Applying basic TIN simplification...", file=sys.stderr)
        vertices, faces = simplify_mesh_basic(vertices, faces)

    print(f"Simplified mesh: {len(vertices)} vertices, {len(faces)} faces", file=sys.stderr)

    # Add base for 3D printing
    print("Adding base for 3D printing...", file=sys.stderr)
    vertices, faces = add_base(vertices, faces, base_thickness)

    # Scale to print size
    print(f"Scaling to {tile_size}mm...", file=sys.stderr)
    vertices = scale_for_printing(vertices, tile_size)

    # Write STL
    print(f"Writing STL to {output_path}...", file=sys.stderr)
    write_binary_stl(vertices, faces, output_path)

    return {
        'success': True,
        'vertices': len(vertices),
        'faces': len(faces),
        'outputPath': str(output_path)
    }


def main():
    if len(sys.argv) < 3:
        print("Usage: tin_processor.py <input.json> <output.stl> [options.json]", file=sys.stderr)
        sys.exit(1)

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    options_path = Path(sys.argv[3]) if len(sys.argv) > 3 else None

    with open(input_path) as f:
        input_data = json.load(f)

    options = {}
    if options_path and options_path.exists():
        with open(options_path) as f:
            options = json.load(f)

    result = process_terrain(input_data, output_path, options)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
