# Third-Party Notices

Pixora uses the following open-source packages in addition to React and Vite:

- `@imgly/background-removal` 1.7.0, AGPL-3.0. It provides browser-local ONNX background removal and downloads model assets on first use.
- `onnxruntime-web` 1.21.0, MIT. It provides the WebGPU and WASM inference runtime.
- `jszip`, MIT. It creates batch ZIP exports locally in the browser.

Pixora does not send user images to these projects or their asset hosts. The model and runtime assets are downloaded separately from image data. Review the corresponding package license files and asset terms when preparing a redistribution or a different licensing model for Pixora.
