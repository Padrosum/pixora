# Pixora

**Free image tools. No uploads.**

Pixora is a free, local-first image toolkit for compressing, resizing, converting and editing images directly in the browser. Your images never leave your device.

## Features

- Drag and drop, file picker, multi-image selection and paste upload
- PNG, JPEG, WebP and AVIF input support
- Local image preview with zoom, fit-to-screen and before/after comparison
- Dark-first, responsive workspace with keyboard-accessible controls
- No account, backend, database, analytics or tracking

The current Phase 6 workspace includes browser-native resize, compression, format conversion, export, crop, rotation, flipping, non-destructive adjustments, Worker-backed batch processing, ZIP export, a local background cutout pass, offline PWA support and accessible responsive controls.

## Privacy

Files are read through the browser File API and decoded locally. Pixora does not upload image data or call a remote image-processing service. Object URLs are revoked when a project is reset or the page is closed.

## Architecture

Pixora is a static Vite application built with React and TypeScript. The planned processing pipeline is:

```text
File API -> image pipeline -> Worker / WASM -> Blob -> download
```

The repository can be deployed to a GitHub Pages repository subpath. Vite uses a relative base path so the same build can later be served from a custom domain.

## Local AI Background Removal

The AI mode uses `@imgly/background-removal` with `onnxruntime-web`. Inference runs in the browser and prefers WebGPU, with a WASM/CPU fallback. The quantized model is loaded lazily on the first use and is approximately 40 MB; the browser caches it for later runs. Pixora never sends image data to the model provider. Model and WASM assets are fetched from the library's default asset host and can be self-hosted later through its `publicPath` configuration.

The background removal package is licensed under AGPL-3.0. See `THIRD_PARTY_NOTICES.md` before distributing a build.

## Development

```bash
npm install
npm run dev
```

Before opening a pull request, run:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run e2e
```

The browser tests use Playwright. Install Chromium once with `npx playwright install chromium` before running `npm run e2e` locally.

## Deployment

`.github/workflows/deploy.yml` installs dependencies, runs lint, typecheck, tests and a production build, then publishes `dist` through the GitHub Pages deployment environment on pushes to `main`.

Enable **Settings -> Pages -> GitHub Actions** in the repository once. The generated site is available at `https://USERNAME.github.io/REPOSITORY/`.
