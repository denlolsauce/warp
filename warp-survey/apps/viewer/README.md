# @warp-survey/viewer

A PlayCanvas-based 3D Gaussian splat viewer for Warp Survey visualizations.

## Overview

This viewer renders georeferenced survey site visualizations from Gaussian splat assets (SOG format). It validates incoming survey manifests against the `@warp-survey/contracts` schema and provides a web component for embedding in product pages or dashboards.

### Architecture

- **Manifest-driven:** Loads a `SurveyManifest` JSON file that describes splat chunks, camera position, geospatial metadata, and local-origin transforms.
- **Local coordinate frame:** The manifest includes a `localOrigin` (the site's coordinates translated for float32 stability in the renderer). The viewer renders in this local frame and displays the origin in the info panel.
- **Progressive loading:** Shows a loading overlay with progress feedback as chunks are fetched.
- **WebGL2 requirement:** Checks browser capability and displays a fallback message if unsupported.
- **Non-dismissable measurement warning:** A prominent label enforces the boundary between visualization and measurement.

## Running

### Development

```bash
cd warp-survey/apps/viewer
pnpm install
pnpm dev
```

Open `http://localhost:5173/` to see the standalone page with a demo manifest.

To load a real manifest, paste its URL into the input field and click "Load Visualization".

### Build

```bash
pnpm build
```

Outputs:
- `dist/warp-survey-viewer.js` — UMD and ES module bundle
- `dist/warp-survey-viewer.css` — (if styles are extracted)

## Web Component Usage

Include the viewer bundle and register the component:

```html
<script src="https://cdn.example.com/warp-survey-viewer.js"></script>

<warp-survey-viewer manifest="https://api.example.com/surveys/abc123/manifest.json"></warp-survey-viewer>
```

The component uses Shadow DOM to isolate styles and prevent collisions with host-page CSS.

## Manifest Contract

The viewer expects a `SurveyManifest` (from `@warp-survey/contracts`):

```typescript
interface SurveyManifest {
  manifestVersion: 1;
  surveyId: string;
  revisionId: string;
  siteId: string;
  capturedAt: string; // ISO 8601
  spatial: {
    horizontalCrs: string; // EPSG code
    verticalDatum: { id: string; description?: string };
    unit: "metre" | "us_survey_foot" | "international_foot";
    localOrigin: [x: number, y: number, z: number]; // Engineering frame
    transforms: CoordinateTransform[];
  };
  bounds: { min: Vector3; max: Vector3 };
  artifacts: ArtifactRef[];
  measurementQuality: QualityRecord;
  visualizationQuality: QualityRecord;
  provenance: Provenance;
  viewer: {
    posterArtifactId: string | null;
    previewArtifactId: string | null;
    chunks: SplatChunk[];
    defaultCamera: { position: Vector3; target: Vector3 };
    viewpoints: NamedViewpoint[];
  } | null;
}
```

## Camera Controls

| Input | Action |
|-------|--------|
| Left Mouse Drag | Rotate view (yaw/pitch) |
| Mouse Wheel | Zoom in/out |
| Touch Drag (1 finger) | Rotate view |
| Pinch (2 fingers) | Zoom in/out |

**Constraints:**
- Pitch: –80° to +30° (prevents flying under terrain)
- Distance: 5–500 units
- Smooth damping applied to all rotations and zooms

## Visualization vs. Measurement

**This viewer is for communication and exploration only.** Engineering measurements (distances, areas, volumes, coordinates) must use the approved DSM/DTM and point cloud artifacts, not the splat visualization.

The viewer enforces this boundary with:
1. A non-dismissable warning label: "Visualization only — not for measurement"
2. No built-in measurement tools
3. An info panel displaying the local origin, not interactive coordinates

The splat is optimized for visual quality, not geometric precision. Terrain-safety cleanup (support surface removal, floater pruning) may alter the visible geometry compared to the unprocessed point cloud.

## Demo Data

The `public/demo/` directory contains a synthetic sample manifest (`manifest.json`) with empty splat chunks. This allows testing the viewer UI (camera, controls, panels) without a real processing pipeline.

**Real survey manifests** will populate `viewer.chunks` with actual SOG asset URLs and fill in measurement/visualization quality records.

## Development Notes

### Provenance

This viewer implementation adapts patterns from the original Warp product viewer (`apps/viewer/` in the main repository):
- Vite + TypeScript build setup
- PlayCanvas application structure
- Loading overlay and camera controller patterns
- Manifest fetching and validation

See `warp-survey/VENDORED.md` for full attribution.

### Dependencies

- `playcanvas` — 3D engine with native SOG support
- `@warp-survey/contracts` — Shared Zod schemas for manifest validation
- `zod` — Runtime schema validation

### TypeScript

```bash
pnpm typecheck
```

Strict mode enabled. No `any` types or unused variables permitted.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "WebGL2 is required" | Update your browser or use a different device with WebGL2 support |
| "Manifest validation failed" | Check that the manifest URL is correct and returns valid JSON matching the schema |
| Splats don't load | Verify splat asset URLs are correct and CORS headers allow cross-origin fetch |
| Blank canvas | Check browser console for errors; may indicate shader compilation issues |

## Future Work

- Measurement tools (optional, behind a feature flag)
- Measurement-artifact overlays (point clouds, contours)
- Custom camera presets and bookmarks
- Performance profiling and LOD strategies for large splat sets
