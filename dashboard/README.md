# Tabletop projection control

Local browser controls for the `stmharry/mapmap` fork, on 5090-01. Rendering stays in MapMap on the ViewSonic projector; the Node backend serves the static Sites/Vinext app, camera proxy and Python/OpenCV calibration worker.

## Run

```sh
# From the repository root (Ubuntu / Qt 6)
sudo apt-get install qt6-tools-dev qt6-multimedia-dev qt6-base-dev libqt6opengl6-dev qt6-httpserver-dev qt6-websockets-dev
qmake6 mapmap.pro
make -j8
cd dashboard
npm ci
uv venv .venv
uv pip install --python .venv/bin/python -r requirements.txt
npm run build
./server/start-mapmap.sh
# In a second terminal:
node server/index.mjs
```

The private URL is http://5090-01-1.tail83edfc.ts.net:3210/. The backend listens on `127.0.0.1:3210`. Development uses `npm run dev` on `127.0.0.1:3211`, proxying API requests to the backend. Static output is in `dist/client`. No cloud storage or Sites deployment is used.

Installed user units are `mapmap.service` and `mapmap-dashboard.service`; templates are in `deployment/`. The projector uses the logged-in X session `:0` with its Xauthority. MapMap loads the saved tabletop project at startup. Its generated token is handed to the backend through an owner-only file and reread on every request. Tokens are not exposed to browsers.

## Use

1. Choose the ViewSonic `HDMI-1-0` display and show fullscreen output.
2. Upload a PNG or JPEG, then select its gallery tile. Switching images preserves the normalized crop and output corners.
3. Use **Rotate 180°** for image orientation and **Blackout** to hide the projection.
4. Use **Calibration grid**, then select a corner or paired edge for small adjustments. Dragging a corner updates the projector live; release sends the final position. Arrows move in projector coordinates. Numbered corners represent far-left, far-right, robot-side-left, robot-side-right in source/table coordinates; they may appear reversed on the output canvas.
5. **Save profile** saves both the `.mmp` and dashboard metadata. **Restore saved** reloads them. An edited or restored mapping needs visual rechecking.
6. **Calibrate tabletop** temporarily displays patterns, verifies both views, and restores the chosen image. A failed run restores the entire prior project.

## Calibration and evidence

`data/profiles/tabletop.mmp` is the saved mapping; `data/calibration.json` contains its measured residuals and coverage limits. Timestamped `data/captures/` folders contain baseline frames, marker frames, independent validation patterns and rollback projects. Initial setup evidence is in `data/captures/initial/`.

The top and observer camera serials are `261222075881` and `310222077068`. The worker resolves their IDs from `http://127.0.0.1:6060/status`; capture resolution is currently 640 × 360. It averages fresh frames, refines marker corners to subpixel precision, fits a planar homography, and validates on a separately projected pattern. Passing requires RMS ≤ 2 camera pixels, maximum ≤ 4, and no measured border spill. This is camera-pixel verification, not a millimeter certificate.

`data/table-targets.json` contains physical table-edge measurements and conservative robot exclusion masks measured for this installation. Repeat calibration searches near those edges in a fresh blank frame. Moving cameras, replacing the table, or changing projector resolution can require remeasuring these anchors. Do not infer visible coverage from a successful homography alone: one far corner is outside the top view and parts of the robot-side edge are occluded. Reports explicitly mark full coverage false.

The raw DRM connector status on this machine is misleading; use the active X display (`xrandr`) and MapMap display enumeration to identify the connected projector.

## Validation

```sh
node --test tests/control.test.mjs
npx tsc --noEmit
npm run build
# These integration tests temporarily switch the real projection and restore it:
.venv/bin/python tests/native-api.py
.venv/bin/python tests/backend-live.py
# Repository source-switch regression, from the repository root:
make -f source-switch-tests.mk source_switch_tests
DISPLAY=:0 XAUTHORITY=/run/user/1007/gdm/Xauthority ./source_switch_tests
```

The two optional WebMCP tools expose projection readback and blackout through the same backend actions when the browser supports `document.modelContext`. They are feature-detected; no supported WebMCP validation context was available in this environment.

## Source and build notes

Base fork revision: `fdb15aa5342e8e724e3913882edb8e2fdb3495a1` (`dev`). Additions include explicit display/source APIs, geometric readback, invalid-quad rejection, secure token handoff, and atomic source rotation/crop updates. Existing loopback/token API restrictions remain in force.

Qt dependencies installed successfully. The package manager also attempted to finish previously pending NVIDIA/kernel configuration and reported existing-module DKMS errors for the 7.0 kernels. This did not prevent the Qt build or the live projector session; no reboot or driver reload was performed.
