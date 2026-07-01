# Circulation System — Facade-Grid Stairs (Design Spec)

The hard-won design of the vertical-circulation (stairs) layer. **Read this before
touching stair geometry** — most past churn came from re-guessing the stair model's
cell footprint instead of respecting the facts below.

Code: `src/kit/deriveCirculation.ts` (derive), consumed by `src/kit/deriveSkin.ts`.
Truth: `circulation = { auto, seed, manual, suppressed, platforms }` in the store.

## 1. The idea — circulation is a *facade grid* system

Stairs are **derived, not hand-placed**, and everything **snaps to the 2 m cell grid**
(`GRID=2`, `WALL_HEIGHT=2.4`). The kit's stair model has a **fixed cell footprint that
drives all the geometry** — you don't place a stair freely, you place *intent*
(a door, or an outdoor landing platform) on the grid and the run materializes to fit.
This is the same "define space → auto-materialize" philosophy as the building skin,
applied to movement. Exterior stairs in particular read as a **fire-escape on the
facade grid**: a flat landing at each door, diagonal flights zig-zagging between them.

## 2. The stair model — authoritative facts (measure, don't guess)

`stairs-open` (the piece all auto stairs use), measured from the GLB / `public/kit/pieces.json`:

- **size = 1.3 (W) × 2.5 (H) × 4.0 (D)** → **2 cells deep**, **≈ one floor tall** (2.5 ≈ 2.4).
- **Pure diagonal**: steps climb linearly; the **full-height step is at the +Z edge**.
- **No built-in landing** — neither a flat top nor a flat bottom.

Consequences, burned into the geometry:

- **One flight = 2 cells horizontal + 1 floor vertical.**
- **Both of a flight's 2 cells are sloped — neither is flat.** A landing must therefore be
  a **separate flat floor cell**, never one of the flight's cells.

### Foot / top orientation + the HARD invariant (the part that keeps biting us)

A flight is placed centered across its 2-cell run `A=(ci,cj) → B=(ci+di,cj+dj)`
(`[di,dj]=STEP[dir]`), **high end (the full-height step) pointing along `dir`** (deriveSkin:
`x/z = midpoint(A,B)`, `rotationY = STAIR_ROT[dir]`). Therefore:

- **FOOT = low end, at A's `−dir` edge.** You step onto it from the cell **behind the foot:
  `(ci−di, cj−dj)`** — this *approach* cell (on the flight's base level) **must be open floor**.
- **TOP = high end, at B's `+dir` edge.** You emerge on `level+1` and step off onto a floor
  **neighbour of B** (forward `(ci+2di,cj+2dj)` or a side) — this *exit* **must be open floor**.

> ⚠️ **INVARIANT — every stair needs open space at BOTH ends (foot approach + top exit).**
> Enforced by `flightUsable()` in `deriveCirculation.ts`; reuse it for any new stair code.
> The recurring bug (stairs jamming the door / **starting at the wall root** / platforms buried
> under the flight) is always a violation of this. Before changing any stair math, re-confirm
> the numbers against the GLB **and** that both ends still have their floor cell.

## 3. Layout rules

**Interior auto-core** (`deriveCirculation` → `coreAt`):
- One vertical core per building, **solid model** (`stairs-closed`, set in `coreAt`),
  climbing inward, stacked per level (`coreAt` emits a flight only where a floor exists on
  `L` and `L+1` → the core only appears where there's an upper storey).
- **Placement is scored under the foot/top invariant, not door-anchored.** Candidates are
  hard-filtered by `flightUsable` (foot has an approach cell, top can step off — §2), so the
  stair **never starts at a wall root**. Among usable spots, score
  `(side-tucked-against-wall?4:0) + (that side is a windowless wall?3:0)` (deriveSkin passes
  `openFaces` = ground-floor window/door faceKeys). So the default is a stair **alongside a
  windowless wall with its foot facing the room**, not facing the entrance. `seed` cycles the
  ranked list (re-roll). A building too small to fit *approach + 2-cell run* (e.g. 2×2) gets
  **no** auto interior core (draw an exterior platform stair instead).
- deriveSkin cuts the stairwell hole on `level+1` for interior (`auto:*`/manual) stairs.

**Exterior — drawn platforms, chained by placement** (`expandPlatform`):
- The user draws **platforms** (flat landings) on the facade grid (`circulation.platforms`);
  each `addPlatform(ci,cj, level?)` also opens a door on the adjacent enclosed wall.
- **Placing a platform (stair-tool UI)** — three ways, all snap to the right level so you
  never switch floors (see repo `CLAUDE.md` → interaction for the operational summary):
  1. **Wall-snap** — click an exterior **wall face** (`faceKey`, enclosed). `addPlatformAtFace`
     drops the landing in the empty outdoor cell just outside it, at the face's level (dir Δ:
     W`-1,0` E`1,0` S`0,-1` N`0,1`).
  2. **Surface-edge snap** — click a walkable **surface edge**: a flat-roof (any style) or an
     **open/semi floor** (they carry `surfaceKey="landLevel,cellLevel,ci,cj"`; enclosed floors
     do NOT — you use their wall). `surfaceEdgeLanding` (`kit/pickLevel.ts`, pure) picks the
     nearest **exterior** edge from the hit point → landing at `landLevel` (roof: cell+1, since
     you stand on top; floor: same level). Interior cell → null (no stair mid-surface).
  3. **Empty-ground** — click an empty outdoor cell (`GroundPlane`) → landing at `activeLevel`
     (for chained/switchback descents).
  Picking lives on `PieceInstance` (walls/surfaces) + `GroundPlane` (empty ground); a hovered
  landing previews via `stairLanding`. ⚠️ Pickable pieces MUST consume `onPointerDown`
  (`stopPropagation`, left button) — else the press falls through to `GroundPlane` behind the
  piece and a **second platform** lands on the ground behind the wall (see Pitfalls §5).
- A platform connects to the **next platform** placed **one floor down + exactly 3 cells
  away in a cardinal direction**, via a single flight. Layout along that direction `d`:

  ```
  platform(0) · flight-high(1) · flight-low(2) · platform(3)
  ```

  The flight fills the 2 sloped cells (offsets 1 & 2); the next platform is the **flat
  landing at offset 3** — *beyond* the flight, so you step off onto it.
- **Direction follows the user's placement.** Place the next platform LEFT vs RIGHT to
  **fold back (switchback)** vs **go straight**. The stair *breaks* at each platform.
- A platform with **no drawn platform below** descends to the **nearest walkable surface**:
  a **building roof / terrace**, or the **ground** — whichever the run reaches first
  (`descendFlights`). **Building roofs are platforms too** — a setback's roof is a valid
  landing, so the stair stops on the terrace instead of being forced down to the ground.
  Each flight's air box is validated clear (high cell at L & L+1, low cell at L+1); the
  **only** cell allowed occupied is the low cell at its own level — that's the roof it
  lands on. **Auto-direction prefers** a terrace landing, then the shortest run, then the
  wall-parallel tangent; the user can `rotate` among the directions that actually reach a
  surface (`cycleDescentDir`). Note the 2-cell stair depth means the terrace edge must be
  reachable across a clear gap (same constraint as platform-to-platform chaining).
- Exterior stairs cut **no** floor hole — they land on an outdoor surface (edge, drawn
  platform, **or a roof terrace**). Hole-cutting in `deriveSkin` explicitly skips any
  `platform:*` stair, so a roof landing never punches the terrace.
- **Removal**: select the tower → Delete (removes the `platform:<key>` group), OR the
  **erase tool** — dragging the rect over a platform's landing cell drops it from
  `circulation.platforms` (and cleans its `platformModel`/`platformDir`).
- **Per-platform overrides** (select the tower → dock chips), keyed by platform key:
  - `circulation.platformModel[key]` — stair pieceId. `stairs-open` (default, skeletal),
    `stairs-center`, `stairs-closed` are all **2 cells deep → drop-in swappable**.
    `stairs-sides` (railings) is **3 cells deep** → different footprint, **deferred**.
    Flows via `Stair.model`; deriveSkin emits `st.model ?? PIECE_STAIRS`.
  - `circulation.platformDir[key]` ("rotate") — forces which edge a **straight** descent
    leaves by; used only if that direction's run is clear, else auto. Chained towers
    ignore it (the next platform's placement decides direction).

## 4. Hard invariants

- **Stairs never cross a wall.** Exterior runs stay entirely OUTSIDE the footprint; the
  flight cells are validated clear at every spanned level.
- **A platform is the flat landing BEYOND the flight (offset 3), never on a sloped flight
  cell (offset 2).** Offset 2 buries the platform under the stair — that was a bug.
- **Interior vs exterior is by source, not geometry**: interior auto-cores (`auto:*` /
  manual ids) cut a stairwell hole; **`platform:*` stairs never do** — even when a roof
  landing puts their bottom cell *inside* the footprint, they sit ON the terrace, not
  through it. (The old "bottom cell occupied → interior" heuristic broke once stairs could
  land on roofs, so hole-cutting now keys off the `platform:` id, not occupancy.)
- Circulation is **additive** — it never changes wall/column/roof/style logic.

## 5. Pitfalls & lessons (do not repeat)

1. **Verify the model's cell dimensions from the GLB/`pieces.json` before designing.** Do
   not eyeball or assume. This single habit prevents the recurring stair-geometry errors.
2. The diagonal has **no flat landing** — always provide approach/landing cells at both ends.
3. Exterior chaining offset is **3** (2 flight cells between platforms), **not 2**.
4. Connection **direction must follow user placement**, never a hardcoded tangent — that's
   what lets the user choose switchback vs straight.
5. **R3F event passthrough (placement).** `GroundPlane` places on `onPointerDown`/`onPointerUp`;
   the wall/surface picks place on `onClick`. A mesh with no `onPointerDown` handler does NOT
   consume the press, so `pointerdown` reaches the `GroundPlane` *behind* it → clicking a wall
   ALSO drops a ground platform behind it (1:1). `onClick`'s `stopPropagation` can't stop
   `pointerdown`. Fix: pickable pieces carry `onPointerDown: (e)=>{ if(e.button===0) e.stopPropagation(); }`.
6. **Only frame/roof surfaces are pickable for stair-snap**, not enclosed floors — an aimed-at
   wall would otherwise mis-hit its own floor slab and scatter platforms. Enclosed → wall-snap.

See also: repo `CLAUDE.md` (operational summary) and memory `reference-stair-model`.
