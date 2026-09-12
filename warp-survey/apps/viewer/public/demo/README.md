# Demo Data

This directory contains synthetic sample data for testing the Warp Survey Viewer without a real processing pipeline.

The `manifest.json` file demonstrates the contract structure that the viewer expects. It is intentionally empty of actual splat assets (no chunks) so that the viewer loads successfully and displays the UI, but without rendering a 3D model.

This is useful for:
- Testing the camera controls, info panel, and loading UX
- Verifying the manifest schema validation
- Checking WebGL2 support and fallback flows
- Development without depending on a complete pipeline run

**This is NOT a real survey visualization.** It contains no measurement data and no georeferenced geometry. Real survey manifests will contain actual SOG assets in the `viewer.chunks` array.
