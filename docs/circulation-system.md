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

> ⚠️ Before changing any stair math, re-confirm these numbers against the GLB. Guessing
> the cell count (is it 1 cell? 2? where's the landing?) is exactly what caused repeated
> rework (stairs jamming the door, platforms buried under the flight, chains not linking).

## 3. Layout rules

**Interior auto-core** (`deriveCirculation` → `coreAt`):
- One vertical core per building, anchored at a ground **door**, climbing inward, stacked
  per level; `seed`-chosen among candidates, re-rollable.
- The door-anchored foot is **pulled one cell IN** from the door, leaving the door cell as
  a flat **approach** (otherwise the first step jams the threshold). Falls back to
  foot-at-door if the building is too shallow.
- deriveSkin cuts the stairwell hole on `level+1` for interior stairs.

**Exterior — drawn platforms, chained by placement** (`expandPlatform`):
- The user draws **platforms** (flat landings) on the facade grid (`circulation.platforms`);
  each `addPlatform` also opens a door on the adjacent enclosed wall.
- A platform connects to the **next platform** placed **one floor down + exactly 3 cells
  away in a cardinal direction**, via a single flight. Layout along that direction `d`:

  ```
  platform(0) · flight-high(1) · flight-low(2) · platform(3)
  ```

  The flight fills the 2 sloped cells (offsets 1 & 2); the next platform is the **flat
  landing at offset 3** — *beyond* the flight, so you step off onto it.
- **Direction follows the user's placement.** Place the next platform LEFT vs RIGHT to
  **fold back (switchback)** vs **go straight**. The stair *breaks* at each platform.
- A platform with **nothing below** falls back to a straight wall-parallel descent to the
  ground (the "not enough platforms yet" state — may extend past the building; accepted).
- Exterior stairs cut **no** floor hole (they land on the edge / platform).

## 4. Hard invariants

- **Stairs never cross a wall.** Exterior runs stay entirely OUTSIDE the footprint; the
  flight cells are validated clear at every spanned level.
- **A platform is the flat landing BEYOND the flight (offset 3), never on a sloped flight
  cell (offset 2).** Offset 2 buries the platform under the stair — that was a bug.
- **Interior vs exterior is intrinsic**: a stair whose bottom cell is *inside* the
  footprint is interior (cuts a hole); *outside* is exterior (no hole).
- Circulation is **additive** — it never changes wall/column/roof/style logic.

## 5. Pitfalls & lessons (do not repeat)

1. **Verify the model's cell dimensions from the GLB/`pieces.json` before designing.** Do
   not eyeball or assume. This single habit prevents the recurring stair-geometry errors.
2. The diagonal has **no flat landing** — always provide approach/landing cells at both ends.
3. Exterior chaining offset is **3** (2 flight cells between platforms), **not 2**.
4. Connection **direction must follow user placement**, never a hardcoded tangent — that's
   what lets the user choose switchback vs straight.

See also: repo `CLAUDE.md` (operational summary) and memory `reference-stair-model`.
