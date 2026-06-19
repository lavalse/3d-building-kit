# CLAUDE.md

Guidance for working in this repo.

## What this is

A pure-frontend, Townscaper-style 3D building tool for students. The product is **a spatial-language editor**: the user defines *space* (rectangular volumes per floor, stacked) and the system **automatically materializes** the building skin (floors, exterior walls with deterministic windows + one ground door, corner columns, a continuous flat roof). The whole composition exports to a single **GLB**. Assets are Kenney's Building Kit (flat-roof only — no pitched roofs).

Stack: **React 19 + React Three Fiber v9 + @react-three/drei v10 + three 0.180 + Zustand 5 + Vite + TypeScript.**

## Run / build

```bash
node scripts/build-kit.mjs   # one-time: unpack the Kenney zip → public/kit/* + pieces.json
npm install
npm run dev                  # http://localhost:5173
npm run build                # tsc -b && vite build  (always run before declaring done)
```
`public/kit/` is generated (committed for convenience). Source zip default: `/mnt/c/Users/laval/Downloads/kenney_building-kit.zip` (pass another path as arg).

## Architecture (the important part)

**Truth → derived.** The persisted truth is small; everything visible is derived.

- **Truth** (`store/useBuildStore.ts`, Zustand + persist): `cells` (`Record<"level,ci,cj", spaceId>`), `themeByLevel`, `faceOverrides` (`Record<"level,ci,cj,dir", 'wall'|'window'|'door'>`), `roofOverrides`. Plus session state: `tool`, `activeLevel`, `selectedKeys`, `hoveredKey`, undo/redo snapshots.
- **Derive** (`kit/deriveSkin.ts`, **pure & deterministic**): `deriveSkin(cells, groundLvl, themeAt, faceOverrides, roofOverrides, fallback) → Instance[]`. Same input → same output (a stable `faceHash` chooses auto window/wall, no RNG/time). Re-runs on every edit inside `commit()`; the renderer/exporter just consume `instances`.
- **Render** (`three/`): `Scene` (Canvas, lights/sun, ground + grids, gizmo), `PlacedPieces`→`PieceInstance` (cloned GLB per instance via `useKitModel`), `GroundPlane` (pointer→cell, draw/erase + hover volume box), `exportGLB` (GLTFExporter, recenters X/Z).

### Coordinate model (don't break this)
A **cell is the square between grid lines**: cell (i,j) spans `[GRID*i, GRID*(i+1)]`, center `GRID*i+HALF`. Walls/columns sit **on the lines**; floors fill the squares. `GRID=2.0`, `WALL_HEIGHT=2.4` (= fixed floor height; stacked floors must match the wall height). `toCell = Math.floor(v/GRID)`. Constants in `kit/constants.ts`, all measured from the GLBs.

### Skinning rules (deriveSkin)
- Floor per occupied cell. Exterior wall on any face whose neighbour cell is empty (occupancy only — connected cells merge into one open building, no interior walls).
- Window/wall is a deterministic hash per face; one auto **entrance door** on the ground floor's front (−Z) face (single + hinged leaf, offset by `DOOR_LEAF_OFFSET`).
- `faceOverrides` let the user force wall/window/door per face. **Contiguous same-kind window/door faces auto-merge into wide (2-cell) pieces** (`wall-*-wide-square`) — width emerges from how many adjacent faces share a kind.
- Corner columns at convex posts. Roof = `roof-flat-center` per top cell + `border` rail along the outer edge (continuous flat roof). `roofFallbackCenter` drops the rail.
- Per-level `themeByLevel`: `house` (full) / `pavilion` (columns+roof, no walls) / `open` (floor+roof only).

### Interaction (fixed Tinkercad convention — never swaps)
Right-drag = orbit, middle-drag = pan, wheel = zoom (all tools). Left = the active tool: **select** (default; click a wall face to select, Shift to multi-select, arrow keys cycle the selection's style) / **space** (drag a rect to fill cells) / **erase**. `OrbitControls keyEvents={false}` so arrows don't pan.

## Verification
Prefer **logic tests** (bundle a `kit/*.ts` with `npx esbuild --bundle` and assert piece counts/positions in node) over screenshots — much cheaper. Only screenshot when geometry/orientation is genuinely in doubt. A headless harness exists (Playwright + chromium swiftshader, store exposed on `window.useBuildStore` in dev). See `[[reference-playwright-harness]]` memory. Always `npm run build` before finishing.

## Gotchas
- three 0.180 OrbitControls dolly methods are private (`_dollyIn`); the nav zoom in `Scene`'s `CameraBridge` scales `camera.position` instead.
- GLTFExporter doesn't keep instancing; fine at school scale.
- Don't reintroduce a hand/`grab` cursor (misleading — camera isn't on left).
- Roof switching is intentionally disabled (kit has only flat roofs); revisit if a pitched-roof asset pack is added.
