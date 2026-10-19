# ATHENA V23 relocated source

The final video is ../../athena-v23-60s.mp4. Run preview.ps1 at the package root for the player, or render.ps1 to render and replace that final video. Node.js, Playwright, @napi-rs/canvas and Chrome are external runtime prerequisites; FFmpeg and FFprobe are packaged in tools/ffmpeg. ATHENA_NODE, ATHENA_NODE_MODULES, CHROME_PATH, FFMPEG_PATH and FFPROBE_PATH can override the existing runtime locations.

stage.js, stage.css and feature-detail.js retain their original bytes. Path changes are tracked in ../../migration/manifest.json. Run python ../../migration/verify-package.py to verify the relocated identities.

history/ preserves byte-identical production receipts and the original verify-output.py. They describe production before relocation and are not rewritten to approve changes. Fresh render/audit output uses render/ and verification/. Historical provenance paths refer to original recordings and product repositories that are intentionally not bundled. Runtime authoring uses local media in assets/.

The optional verification/feature-inserts/composite-market-native.py rebuilds the chart insert from the included market-rise.mp4 and chart-plot.mp4. It requires numpy, Pillow and opencv-python; ordinary full rendering uses the already composed media.

Music: Origami — Scott Buckley, CC BY 4.0. See audio/attribution.txt.