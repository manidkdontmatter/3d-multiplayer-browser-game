Original prompt: hey, this game doesn't have a name yet, i want to give it one. i think it's mostly referred to as "Browser Game" right now or something, i don't really recall, not sure where it's placeholder names (if any) even occur though, i know the browser tab says "Browser Game" or something like that at least, but instead, i want the game's name to be "Otherspace", so wherever you see a placeholder name make it Otherspace and whatever else you need to do to make it work

Progress:
- Renamed visible/runtime project placeholders from Browser Game to Otherspace in index.html, README.md, package metadata, package-lock metadata, and the example Nginx config.
- Renamed deploy/nginx.browser-game.example.conf to deploy/nginx.otherspace.example.conf so deploy docs do not keep the placeholder slug.
- Verified with `npm run typecheck:client`.
- Verified browser runtime on local Vite/orchestrator/map server: Playwright reported `document.title` and `#hud h1` as `Otherspace`, and the captured in-game screenshot shows the renamed HUD.
- Hardened `scripts/smoke-e2e.js` after the smoke artifacts showed the game connected and the main UI visible while the old selector wait still timed out; the smoke test now uses a longer default connect timeout and computed-style UI visibility check.
- Verified with `npm run test:smoke`.
- Superseded the Otherspace rename because the name was taken. Current display title is `Praeterspace / Noctis Mundus`; package/deploy slug is `praeterspace-noctis-mundus`.
- Verified the new title with `npm run typecheck:client`, the web-game Playwright client, a DOM title/HUD check, screenshot inspection, and `npm run test:smoke`.

Progress:
- Implemented void-first prototype refactor from the current session:
  - Design direction updated in `design-doc.md`: void-centric world, authored floating locations, terrain islands as optional children, moving locations as reference frames.
  - Added shared void prototype location definitions in `src/shared/worldLocations.ts` and model IDs in `src/shared/config.ts`.
  - Replaced the default static world colliders with authored void location colliders in `src/shared/worldPhysics.ts`.
  - Added replicated location roots via `src/server/location/LocationRootSystem.ts` and ECS location-root tagging.
  - Hardened location roots into their own nengi entity type (`NType.LocationRootEntity`) with explicit replicated metadata: kind, archetype id, seed, environment id, streaming radius, and influence radius. The client now streams locations from these fields instead of inferring roots from `modelId`.
  - Added client-side location-root streaming/cache expansion in `WorldEntityVisualSystem`: terrain island, crystal-bowl placeholder, static castle kitbash, moving castle kitbash, and arena placeholders.
  - Spawn now uses a void spawn anchor instead of terrain slope/height lookup.
  - Added moving-location frame carry prototype for the drifting test citadel on server and local prediction.
  - Added client-only environment preset blending in `WorldEnvironment`: replicated location roots provide numeric environment ids/radii, while the client blends background, fog, ambient light, sun light, and exposure locally.
  - Added shared authored environment volumes in `src/shared/environmentVolumes.ts`, with sphere and oriented-box weighting for large void-region atmospheres.
  - Refactored client environment resolution into priority layers: neutral fallback, authored void-region volumes, then higher-priority location-root overrides. Location visuals override regional void visuals only while inside their influence and still blend smoothly at boundaries.
  - Added client-only preset VFX layer weights for void stars, heavenly mist, infernal nebulas, and arcane motes, keeping visual effects out of server authority.
  - Replaced location root-radius environment influence for authored content with location child environment volumes in `src/shared/worldLocations.ts`. Prototype locations now define spheres and boxes, including multiple boxes for the moving citadel hull/spire case.
  - Updated `WorldEnvironment` to transform each location child volume by the replicated root transform before resolving priority/weight, so moving ships/castles can carry multiple authored atmosphere volumes with them.
  - Split nengi spatial replication into near and far channels. Near view is now 256/128/256 for normal entities; far view is 3200/1600/3200 for location roots and future large distant world objects.
  - Routed `LocationRootEntity` replication through the far channel while players, NPCs, projectiles, platforms, and ability-use spatial messages remain near-channel data.
  - Scaled environment volume blend distances 20x in `src/shared/environmentVolumes.ts` so region/location atmosphere transitions fade over distance much more gradually.
  - Replaced Three.js `Sky` atmospheric helper with a client-only generated void sky system in `WorldEnvironment`. Region presets now blend layered star/nebula sky spheres by distance, using neutral, blue/heavenly, infernal red, and arcane violet generated sky textures.
  - Fixed the basic void star VFX layer to use opacity-controlled client materials so it fades in as well as out instead of appearing abruptly at activation.
  - Validation: `npm run typecheck`, `npm run test:smoke` with pass artifacts, and `npm run test:multiplayer` all passed after the explicit location-root protocol split.
  - Revalidated after authored environment volumes: `npm run typecheck`, `npm run test:smoke`, the `develop-web-game` Playwright canvas loop, screenshot inspection, and `npm run test:multiplayer` passed.
  - Revalidated after location child volumes: `npm run typecheck`, `npm run test:smoke`, the `develop-web-game` Playwright canvas loop, screenshot inspection, and `npm run test:multiplayer` passed.
  - Revalidated after near/far spatial channels and 20x environment fade: `npm run typecheck`, `npm run test:smoke`, smoke state confirmed all four location roots visible from spawn, `develop-web-game` Playwright canvas screenshot showed a distant location visual from spawn, and `npm run test:multiplayer` passed.
  - Revalidated after void sky replacement: `npm run typecheck`, `npm run test:smoke`, `develop-web-game` Playwright canvas screenshot confirmed starfield sky rendering with UI closed, and `npm run test:multiplayer` passed.

Current void TODO:
- Add string/table-backed `locationId` handling when needed for persistence/editor tooling; current network path uses compact numeric archetype ids.
- Add editor/tooling support for authoring AABB-only environment volumes when world-building needs more precise region layout.
- Add proper terrain island biome policy and circular/crystal-bowl island generation later.

Progress:
- Replaced the procedural generated void skybox path with asset-backed cubemap loading/blending.
- Normalized five source cubemap folders under `public/assets/textures/skyboxes/skybox1` through `skybox5` to Three.js face names: `px`, `nx`, `py`, `ny`, `pz`, `nz`.
- Extended the asset manifest/build/runtime loader with a `cubemap` asset kind that preserves six ordered image faces and loads them through Three.js `CubeTextureLoader`.
- Added all five skybox cubemaps to `ASSET_CATALOG` and generated runtime manifest assets for them.
- Updated `WorldEnvironment` to render a camera-centered shader skybox that blends up to five cubemaps by environment weights.
- Added a fifth void environment preset/region so all five skyboxes can be seen while flying through the void.
- Validation: `npm run assets:build:manifest`, `npm run typecheck:client`, and `npm run typecheck:server` passed.
- Did not run browser/Playwright visual tests per user instruction; existing dev runtime was already listening on ports `5173`, `9000`, and `9001`.
- Reworked sky/environment blending after user visual feedback:
  - Removed the remaining time-based environment interpolation; sky/fog/lighting/VFX preset blend is now a direct function of current position.
  - Replaced sequential same-priority influence blending with normalized weighted blending, so equal overlap between two regions is 50/50 and equal overlap among three regions is 1/3 each.
  - Reduced `ENVIRONMENT_BLEND_DISTANCE_SCALE` from `20` to `1`, so authored `innerRadius`, `radius`, and `blendDistance` values define the real transition buffer instead of being inflated 20x.
  - Validation: `npm run typecheck:client` and `npm run typecheck:server` passed.
- Collapsed environment volumes to the AABB-only path:
  - Removed sphere, oriented-box/yaw, and spherical `locationInfluenceRadius` fallback handling from environment blending.
  - Converted broad void regions and static location overrides to axis-aligned boxes with explicit blend distances.
  - Removed moving-citadel environment volumes so moving roots do not carry skybox/atmosphere overrides.
  - Validation: `npm run typecheck:client` and `npm run typecheck:server` passed.
