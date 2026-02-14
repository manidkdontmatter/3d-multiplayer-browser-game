# Runtime Asset Layout

This directory contains browser-served runtime assets.

## Structure

- `models/characters/male/`
  - `Male_FullBody.gltf` + `Male_FullBody.bin`
  - Male texture set
- `animations/mixamo/`
  - `Idle.fbx`, `Walking.fbx`, `Running.fbx`, `Jump.fbx`, `Punching.fbx`

## Rules

- Keep runtime-loaded files (GLTF/BIN/textures/audio) under `public/assets/**` so Vite serves them by stable URLs.
- Register any runtime-loaded asset in `src/client/assets/assetManifest.ts`.
- Prefer canonical filenames referenced by the `.gltf`; avoid duplicate alias copies unless required for compatibility.
- Keep mod-friendly texture formats (`.png` / `.jpg`); do not introduce WebP in this project.
