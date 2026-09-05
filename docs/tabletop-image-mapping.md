# Reusing a calibrated image mapping

Create a mesh layer, fit its output corners to the projection surface, and save the project. Import the other images into the Library. In Layers, select the calibrated layer and change its **Source** property or use **Change media** in its context menu.

Switching sources preserves the output geometry. The input vertices are rescaled between the old and new texture rectangles, including their editor positions, so a full-image mapping stays full-image even when resolutions differ. An intentional input crop retains its normalized coordinates. The complete image is stretched into the calibrated output quadrilateral; choose consistent image framing if physical proportions matter.

The macOS/Qt 6 image-mesh renderer uses QPainter's projective transform, so editor zoom, HiDPI scaling, and output corner warps share a coordinate system. The fullscreen output scene tracks the viewport through `resizeEvent`; the old QGLWidget `resizeGL` callback is not invoked by QGraphicsView. Restoring fullscreen is deferred until MainWindow construction completes, avoiding reentrant singleton creation during synchronous painting.

## Source-switch regression test

Build MapMap normally first, then from the repository root:

```sh
make -f source-switch-tests.mk source_switch_tests
QT_QPA_PLATFORM=offscreen ./source_switch_tests
```

The test creates temporary PNG/JPEG fixtures of different sizes and a calibrated project. It exercises the actual Change media action after the active layer has been cleared, repeated grid/image switches, reselecting the same layer row, normalized input crops, unchanged output vertices, invalid/stale layer indices, and a missing target layer. It uses isolated application settings and does not edit the supplied project or media.

To reproduce against specific files:

```sh
QT_QPA_PLATFORM=offscreen ./source_switch_tests /path/calibration.mmp /path/image.png /path/image.jpg
```

A valid project for this optional mode has layer ID 1 initially mapped to the full image of its grid source.
