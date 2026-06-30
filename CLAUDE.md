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

- **Truth** (`store/useBuildStore.ts`, Zustand + persist): `cells` (`Record<"level,ci,cj", spaceId>`), `styleBySpace` (spaceId→style), `faceOverrides` (`Record<"level,ci,cj,dir", 'wall'|'window'|'door'>`), `roofOverrides`, `stairs` (`Stair[]`). Plus session state: `tool`, `activeLevel`, `selectedKeys`, `hoveredKey`, undo/redo snapshots.
- **Derive** (`kit/deriveSkin.ts`, **pure & deterministic**): `deriveSkin(cells, groundLvl, styleBySpace, faceOverrides, roofOverrides, fallback, stairs) → Instance[]`. Same input → same output (a stable `faceHash` chooses auto window/wall, no RNG/time). Re-runs on every edit inside `commit()`; the renderer/exporter just consume `instances`.
- **Render** (`three/`): `Scene` (Canvas, lights/sun, ground + grids, gizmo), `PlacedPieces`→`PieceInstance` (cloned GLB per instance via `useKitModel`), `GroundPlane` (pointer→cell, draw/erase + hover volume box), `exportGLB` (GLTFExporter, recenters X/Z).

### Coordinate model (don't break this)
A **cell is the square between grid lines**: cell (i,j) spans `[GRID*i, GRID*(i+1)]`, center `GRID*i+HALF`. Walls/columns sit **on the lines**; floors fill the squares. `GRID=2.0`, `WALL_HEIGHT=2.4` (= fixed floor height; stacked floors must match the wall height). `toCell = Math.floor(v/GRID)`. Constants in `kit/constants.ts`, all measured from the GLBs.

### Skinning rules (deriveSkin)
- Floor per occupied cell. Exterior wall on any face whose neighbour cell is empty (occupancy only — connected cells merge into one open building, no interior walls).
- Window/wall is a deterministic hash per face; one auto **entrance door** on the ground floor's front (−Z) face (single + hinged leaf, offset by `DOOR_LEAF_OFFSET`).
- `faceOverrides` let the user force wall/window/door per face. **Contiguous same-kind window/door faces auto-merge into wide (2-cell) pieces** (`wall-*-wide-square`) — width emerges from how many adjacent faces share a kind.
- Roof = `roof-flat-center` per top cell + `border` rail along the outer edge (continuous flat roof). `roofFallbackCenter` drops the rail.
- Per-**space** `styleBySpace` (spaceId→style, not per-level) — a **structural/enclosure typology**, not a building program: `enclosed` (load-bearing walls form the envelope; **corner** columns at convex posts) / `open` (post-and-slab **frame**: no walls; a regular **column grid** at `BAY` spacing — world-aligned, incl. interior posts ∪ the region's convex corners — carries the floor/roof slabs). One level can mix styles. (`BAY` in `constants.ts`, default 2 cells/4m.)
- **Circulation** (vertical, `kit/deriveCirculation.ts`) — full design rationale + the stair-model facts + pitfalls in **`docs/circulation-system.md`** (read before touching stair geometry). Summary: stairs are **derived, not hand-placed** — `deriveCirculation(cells, {groundDoors}, circulation) → Stair[]` (deriveSkin computes the ground door faces). Two kinds of auto stair:
  - **Interior core** — per building (footprint-connected component), one vertical core anchored at a ground **door** (the auto entrance + ground `'door'` overrides), climbing inward, stacked per level; `seed`-chosen among door/interior-perimeter candidates (re-roll = `seed++`). The door-anchored core's **foot is pulled one cell IN** from the door so the door cell stays a flat approach (the `stairs-open` model has no built-in landing; otherwise the first step jams the threshold) — falls back to foot-at-door if the building is too shallow.
  - **Exterior stair = drawn PLATFORMS, chained by placement** (`expandPlatform(cells, platformKey, platformSet)`). In the stair tool you click empty outdoor cells → added to `circulation.platforms` ("level,ci,cj"); each platform tile is a landing (and `addPlatform` opens a door on the adjacent enclosed wall). A platform emits **one flight toward the next platform** if one sits **one floor down + exactly 3 cells away in a cardinal direction** — the flight model fills 2 sloped cells (neither flat), so the next platform must be the flat landing *beyond* them: `platform(0) · flight-high(1) · flight-low(2) · platform(3)`. **Direction follows the user's placement** — place the next platform LEFT vs RIGHT to fold back (switchback) vs go straight; the stair breaks at each platform (each is a landing). A platform with **nothing below** falls back to a straight wall-parallel descent to the ground (the "not enough platforms yet" state — may extend past the building; accepted). All flights stay OUTSIDE the footprint (never cross a wall). **Hard invariant: every flight stays OUTSIDE the footprint — never crosses a wall** (both tangents blocked → platform only, no stair). No central well, no floating mid-air platforms — the only platform is the one you drew at the door. `addPlatform` also opens a `door` on the adjacent enclosed wall face (`platformDoorFace`). Flights share `stairKey = platform:<key>` (delete removes the group). (Stair model `stairs-open` measured from the GLB: pure diagonal, full-height step at the +Z edge, no built-in landings.)
  - **Interior vs exterior is intrinsic**: a stair whose **bottom cell is occupied** is interior (deriveSkin cuts `floorHoles` on `level+1`); bottom cell **outside the footprint** = exterior (no hole — lands on the edge platform).
  - Overrides: `circulation.manual[]` (user-drawn stairs, kept) + `circulation.suppressed[]` (deleted auto cores, by `auto:…` id) + `circulation.platforms[]` (drawn exterior landings, by `"level,ci,cj"`; delete a flight removes the whole group via its `platform:<key>` stairKey); `circulation.auto` toggles the interior auto layer. A `Stair = {level, ci, cj, dir}` is one flight (`stairs-open`, 2 cells deep, high end faces `dir`). Additive — never changes wall/column/roof/style logic.

### Interaction (fixed Tinkercad convention — never swaps)
Right-drag = orbit, middle-drag = pan, wheel = zoom (all tools). Left = the active tool: **select** (default; click a wall face *or a stair* to select — faces: Shift to multi-select + arrow keys cycle the style; a selected stair shows rotate/delete chips, `Delete`/`Backspace` removes it) / **space** (drag a rect to fill cells) / **stair** (circulation: auto-places interior stair cores at doors — dock has 自动 toggle + 换一个/re-roll; click an empty outdoor cell to drop an exterior landing platform that auto-grows a stair down) / **erase** (also drops any stair whose bottom cell is in the rect). Selection state: `selectedKeys` (faces) and `selectedStairId` (one stair) are mutually exclusive. `OrbitControls keyEvents={false}` so arrows don't pan. Shortcuts: V/S/T/E tools; **↑/↓ = floor up/down** (`stepLevel`: ↑ can reach one floor above the topmost built level, then stops; empty scene stays at 0); **←/→ = cycle the selected face's style**; `[`/`]` also change level.

**Exterior stairs** are drawn, not auto: in the **stair tool**, go to the floor with the door, click the empty outdoor cell just outside it → that drops a **landing platform**, and a wall-parallel stair auto-descends from it to the ground (see Skinning rules → Circulation). You control the platform position exactly; the stair falls out of it.

## Verification
**Logic tests are the default** (bundle a `kit/*.ts` with `npx esbuild --bundle` and assert piece counts/positions in node) — cheap and deterministic. **Screenshots are the single most expensive step (image tokens); take at most one, and only when geometry/orientation genuinely can't be confirmed from logic.** A headless harness exists (Playwright + chromium swiftshader, store exposed on `window.useBuildStore` in dev). See `[[reference-playwright-harness]]` memory. Always `npm run build` before finishing.

**Working cadence (cost):** do **one feature per session** — context grows fast and every turn re-reads it, so a fresh session per feature keeps each turn cheap (lean on this CLAUDE.md + memory to get back up to speed). See `[[feedback-verification-cost]]`.

## Gotchas
- three 0.180 OrbitControls dolly methods are private (`_dollyIn`); the nav zoom in `Scene`'s `CameraBridge` scales `camera.position` instead.
- GLTFExporter doesn't keep instancing; fine at school scale.
- Don't reintroduce a hand/`grab` cursor (misleading — camera isn't on left).
- Roof switching is intentionally disabled (kit has only flat roofs); revisit if a pitched-roof asset pack is added.
