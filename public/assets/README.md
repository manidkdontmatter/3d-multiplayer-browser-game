# Runtime Asset Layout

This directory contains source runtime assets used by the asset build pipeline.

## Structure

- `models/characters/male/`
  - `CoolAlien.vrm`
- `animations/mixamo/`
  - `Idle.fbx`, `Walking.fbx`, `Running.fbx`, `Jump.fbx`, `Punching.fbx`

## Rules

- Keep source runtime files (GLTF/BIN/textures/audio) under `public/assets/**`.
- Register any runtime-loaded asset in `src/client/assets/assetManifest.ts` via `ASSET_CATALOG`.
- Do not reference `public/assets/**` URLs directly from runtime systems.
- Runtime loads resolve via generated hashed manifest URLs under:
  - `public/runtime-manifests/**`
  - `public/runtime-assets/**`
- Prefer canonical filenames referenced by the `.gltf`; avoid duplicate alias copies unless required for compatibility.
- Keep mod-friendly texture formats (`.png` / `.jpg`); do not introduce WebP in this project.
