# Roof System — Drawn Procedural Roofs (Design Spec)

How shaped roofs (gable / hip / dome / shed) work. **Read this before touching roof
geometry or the roof↔space interaction.**

Code: `src/three/roofGeometry.ts` (geometry), `src/three/ProceduralRoofs.tsx` (render),
`src/store/useBuildStore.ts` (truth + lifecycle). Truth: `roofs: RoofRegion[]`.

## 1. The idea — roofs are a procedural layer, not kit pieces

The Kenney Building Kit is **flat-roof only** (verified: 79 pieces — `roof-flat-*` tiles, a
`border` eave rail, rounded *corner trims* and *window/door frames*; **no** gable/hip/dome
/triangular roof anywhere). So shaped roofs are **generated three.js geometry**, an
**additive layer over** the auto flat roof — same "define intent → auto-materialize"
philosophy as spaces and stairs.

- **Truth** (`RoofRegion = {id, level, ci0,cj0,ci1,cj1, style, rotated?}`): a rectangular
  region drawn on a building top + a style. One region = one unified roof mesh, **sized to
  its footprint** (4×4 → big, 3×3 → small — automatic, since geometry is built from the rect
  bounds).
- **Derive/render**: `ProceduralRoofs` reads `roofs`, builds a `BufferGeometry` per region
  (`useMemo`), renders a `<mesh>` **inside the export group** so `GLTFExporter.parse(group)`
  serializes it alongside the GLB pieces. The render path does NOT assume meshes come from
  GLBs. `deriveSkin` is **roof-agnostic** — roofs never enter the `Instance[]` list.

## 2. Geometry facts (`roofGeometry(style, w, d, rise, rotated)`)

Built to fit a `w×d` footprint (X×Z), base at `y=0`, apex/ridge at `y=rise`, centered on the
origin; the caller positions it. **Triangle soup (non-indexed)** → `computeVertexNormals`
gives crisp per-facet shading (proper roof planes). The dome is the exception (a smooth
scaled hemisphere).

- **gable** — full-length ridge along the longer axis; two slope quads + two triangular
  gable ends.
- **hip** — ridge inset from the short ends by half the short span (45° hips). **A square
  footprint collapses the ridge to a single apex = a pyramid (攒尖).** Same function covers
  both; guard the degenerate ridge (`rl <= 1e-6`) → 4 triangles to the apex (avoids NaN
  normals).
- **shed** — one mono-pitch slope (low edge → high edge) + filled sides/back.
- **dome** — upper half-ellipsoid (`SphereGeometry` hemisphere scaled to `hw, rise, hd`).
- **`rise`**: `ROOF_RISE · min(w,d)/2` for pitched; `min(w,d)/2` for dome. Set by the
  component (`ROOF_RISE` in `constants.ts`).
- **`rotated`**: flips the ridge/slope axis (gable & shed). Hip ignores it (its ridge is
  always the longer axis). Implemented via a `swap` emitter that maps authored (x,y,z) →
  world (z,y,x), so one authored shape serves both orientations.

## 3. Integration with the kit (the important part)

The drawn roof **keeps the kit's flat roof + `border` eave (cornice) untouched** and **sits
on top of the cornice**:

- `deriveSkin` still emits `roof-flat-center` + the `border` rail on every roof cell (the
  kit's pretty eave). **It is NOT suppressed** under drawn roofs.
- The pitched cap base sits at `y0 + ROOF_CORNICE` where `y0 = (level+1)·WALL_HEIGHT` (the
  wall-top) and `ROOF_CORNICE = 0.4` (= the `border`'s yOffset 0.1 + its 0.3 height, measured
  from `pieces.json`). So the cornice shows as the eave and the pitch rises above it.
- The cap **oversails** by `ROOF_EAVE` (footprint + overhang). Because the cap base is above
  the wall-top plane and the gable ends are either above the wall's Y range or pushed out by
  the overhang, **there is no z-fight** with the walls.

## 4. Lifecycle — one roof per area, invalidate on build-over

- **Draw** (`addRoof(ai,aj,bi,bj, level?)`, roof tool): caps the building top inside the dragged
  rect, trying the **active level then the level below** (so drawing while on the rooftop OR on
  the empty level just above both work). Clamps to the bbox of the rect's actual top cells.
- **Surface-aware level** (shared with the space tool, `kit/pickLevel.ts` `resolveDrawTarget`):
  the roof tool no longer needs a manual floor switch — `GroundPlane` resolves the draw level
  from the surface **under the cursor** (a rooftop → `rooftop+1`, else `activeLevel`), locks it
  at pointer-down, and passes it as `addRoof`'s `level`. Since `addRoof` then tries
  `topBox(level) ?? topBox(level-1)`, pointing at a 1-storey roof (resolve → level 1) still caps
  level 0's top. The floating grid follows the resolved level via `hoverLevel`. The rooftop
  override is transient (doesn't change `activeLevel`).
- **One roof per area**: a new roof **replaces** any existing roof it overlaps (same level,
  intersecting rect) — latest-wins, like redrawing a space.
- **Invalidate** (`pruneRoofs`, runs every `commit`): a roof stays valid only while its rect
  is a **clean rooftop** — it must have building under it (some cell occupied at `level`) AND
  **nothing built on top** (no cell occupied at `level+1`). So **drawing a space above it / 
  stacking a floor on it → the roof is dropped** (draw a fresh one); erasing its whole surface
  drops it too. An L-shaped notch (occupied at neither `level` nor `level+1`) is tolerated.
- **Erase** (area eraser, `eraseCells`): a drag rect also removes any roof it touches — at the
  active level, or at the level below when that level has nothing to erase (you're erasing the
  empty floor above the building → wipes just the roof, mirroring drawing it from above).
  Removal is on rect *intersection* (roofs are atomic regions). `select → Delete` still removes
  one roof precisely.

## 5. Known limitations (v1, not bugs)

1. A roof region is a **rectangle** (bbox of the rect's top cells). An L-shaped footprint →
   the roof overhangs the notch; draw several rectangular roofs instead.
2. **dome** over a rectangle is an ellipsoid → the footprint corners are left open; squares
   look best.
3. The kit cornice only appears at the **building's** outer roof edge, so a small pitched roof
   drawn in the *middle* of a larger flat roof won't have a cornice around its own eave. The
   common case (roof covers the whole top) aligns fine.

## 6. Pitfalls (do not repeat)

1. **The kit is flat-roof only** — don't look for a pitched-roof GLB; generate geometry.
2. Non-indexed triangle soup is intentional (flat facets). Indexing/merging would smooth the
   ridges. The dome alone is smooth (indexed sphere).
3. Keep the kit `border` eave — it is the cornice the pitch sits on; suppressing it loses the
   kit detail and reintroduces the wall-top seam.

See also: repo `CLAUDE.md` (operational summary), `docs/circulation-system.md` (sibling
stair spec), memory `reference-roof-system`.
