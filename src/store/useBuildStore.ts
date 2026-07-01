import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { WALL_HEIGHT, PIECE_STAIRS_CLOSED } from '../kit/constants';
import { deriveSkin, type StyleBySpace } from '../kit/deriveSkin';
import { type Circulation, platformDoorFace, cycleDescentDir } from '../kit/deriveCirculation';
import { eraseRect, fillRect, groundLevelOfCells, normalizeRect, type CellMap } from '../kit/massing';
import type { Dir, FaceOverride, Instance, PieceDef, RoofRegion, RoofStyle, SkinTheme, Stair, Tool } from '../kit/types';
import type { PaletteCat } from '../kit/palette';

type Palette = Partial<Record<PaletteCat, string>>; // semantic part → chosen colour

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

type Overrides = Record<string, FaceOverride>;
type RoofOverrides = Record<string, 'open'>;
type Snapshot = {
  cells: CellMap;
  instances: Instance[];
  styleBySpace: StyleBySpace;
  faceOverrides: Overrides;
  roofOverrides: RoofOverrides;
  circulation: Circulation;
  roofs: RoofRegion[];
};
const MAX_HISTORY = 50;

const emptyCirculation = (): Circulation => ({ auto: true, seed: 0, manual: [], suppressed: [], platforms: [], platformModel: {}, platformDir: {} });
const isAutoStair = (id: string) => id.startsWith('auto:');
const isPlatformStair = (id: string) => id.startsWith('platform:');
// Parse an auto stair id "auto:level,ci,cj,dir" back into its fields.
const parseAutoId = (id: string): Stair | null => {
  const m = /^auto:(-?\d+),(-?\d+),(-?\d+),([NESW])$/.exec(id);
  return m ? { id, level: +m[1], ci: +m[2], cj: +m[3], dir: m[4] as Dir } : null;
};

const pieceY = (inst: Instance, floorHeight: number) =>
  inst.floor * floorHeight + (inst.yOffset ?? 0);

const reskinFrom = (
  cells: CellMap,
  styleBySpace: StyleBySpace,
  faceOverrides: Overrides,
  roofOverrides: RoofOverrides,
  fallback: boolean,
  circulation: Circulation
): Instance[] =>
  deriveSkin(cells, groundLevelOfCells(cells), styleBySpace, faceOverrides, roofOverrides, fallback, circulation).map(
    (sp) => ({ ...sp, id: uid() })
  );

// Drop style entries for spaces no longer present in the cell map.
const pruneStyles = (cells: CellMap, styleBySpace: StyleBySpace): StyleBySpace => {
  const used = new Set(Object.values(cells));
  const out: StyleBySpace = {};
  for (const id in styleBySpace) if (used.has(id)) out[id] = styleBySpace[id];
  return out;
};

// A drawn roof stays valid only while its rect is a clean rooftop: it must still have
// building under it (some cell occupied at `level`) AND nothing built on top of it (no cell
// occupied at `level+1`). So drawing a space above a roof — or stacking a floor on it —
// invalidates it (the rooftop is gone) and it's dropped; erasing the whole roofed area
// drops it too. An L-shaped notch (occupied neither at level nor above) is tolerated.
const pruneRoofs = (cells: CellMap, roofs: RoofRegion[]): RoofRegion[] =>
  roofs.filter((r) => {
    let hasSurface = false;
    for (let i = Math.min(r.ci0, r.ci1); i <= Math.max(r.ci0, r.ci1); i++)
      for (let j = Math.min(r.cj0, r.cj1); j <= Math.max(r.cj0, r.cj1); j++) {
        if (cells[`${r.level + 1},${i},${j}`]) return false; // built over → roof void
        if (cells[`${r.level},${i},${j}`]) hasSurface = true;
      }
    return hasSurface;
  });

/** On-screen camera buttons register their handlers here (set by a Canvas bridge). */
interface CameraOps {
  zoomIn?: () => void;
  zoomOut?: () => void;
  home?: () => void;
}

// Cycle order for a wall face. Width comes from how many adjacent faces share
// the same kind (deriveSkin merges contiguous window/door runs into wide pieces).
const ORDER: (FaceOverride | undefined)[] = [undefined /* auto */, 'window', 'door', 'wall'];

// Stair climb-direction cycle (rotate button steps through these in order).
const DIR_ORDER: Dir[] = ['N', 'E', 'S', 'W'];

interface BuildState {
  // persisted truth
  cells: CellMap;
  styleBySpace: StyleBySpace;
  faceOverrides: Overrides;
  roofOverrides: RoofOverrides;
  circulation: Circulation;
  roofs: RoofRegion[];
  palette: Palette; // per-semantic-part recolour (appearance only; not in undo/reskin)
  floorHeight: number;

  // derived
  instances: Instance[];

  // session-only
  pieces: PieceDef[];
  tool: Tool;
  activeLevel: number;
  activeStyle: SkinTheme; // the style applied to the next drawn space
  activeRoofStyle: RoofStyle; // the style applied to the next drawn roof
  roofFallbackCenter: boolean;
  abstractView: boolean;
  camera: CameraOps;
  hoveredKey: string | null;
  selectedKeys: string[];
  selectedStairId: string | null;
  selectedRoofId: string | null;
  selectedCols: string[]; // "i,j" columns marquee-selected in the move tool (to relocate)
  moveOverwrite: boolean; // move tool: overlap overwrites the target building instead of blocking
  past: Snapshot[];
  future: Snapshot[];

  setPieces: (p: PieceDef[]) => void;
  setTool: (t: Tool) => void;
  setActiveLevel: (n: number) => void;
  stepLevel: (dir: 1 | -1) => void;
  setActiveStyle: (t: SkinTheme) => void;
  setActiveRoofStyle: (t: RoofStyle) => void;
  setPaletteColor: (cat: PaletteCat, hex: string) => void;
  resetPalette: () => void;
  toggleRoofFallback: () => void;
  toggleAbstract: () => void;
  setCamera: (ops: CameraOps) => void;
  setHovered: (key: string | null) => void;
  selectFace: (key: string, additive: boolean) => void;
  selectStair: (id: string) => void;
  selectRoof: (id: string) => void;
  selectCols: (cols: string[]) => void;
  clearSelection: () => void;
  cycleSelection: (dir: 1 | -1) => void;
  setSelectionStyle: (kind: FaceOverride | 'auto') => void;

  fillSpace: (ai: number, aj: number, bi: number, bj: number) => void;
  eraseCells: (ai: number, aj: number, bi: number, bj: number) => void;
  addStair: (ci: number, cj: number, dir: Dir) => void;
  addPlatform: (ci: number, cj: number) => void;
  moveBuilding: (cols: string[], di: number, dj: number) => void;
  toggleMoveOverwrite: () => void;
  addRoof: (ai: number, aj: number, bi: number, bj: number) => void;
  setRoofStyle: (id: string, style: RoofStyle) => void;
  rotateRoof: (id: string) => void;
  removeRoof: (id: string) => void;
  setPlatformModel: (platformKey: string, model: string) => void;
  rotatePlatformDir: (platformKey: string) => void;
  rotateStair: (id: string) => void;
  removeStair: (id: string) => void;
  rerollStairs: () => void;
  toggleAutoStairs: () => void;
  clearAll: () => void;

  undo: () => void;
  redo: () => void;

  exportProject: () => string;
  importProject: (json: string) => void;
}

export const useBuildStore = create<BuildState>()(
  persist(
    (set, get) => {
      const snapshot = (s: BuildState): Snapshot => ({
        cells: s.cells,
        instances: s.instances,
        styleBySpace: s.styleBySpace,
        faceOverrides: s.faceOverrides,
        roofOverrides: s.roofOverrides,
        circulation: s.circulation,
        roofs: s.roofs,
      });

      // Apply an edit producing new {cells/styleBySpace/faceOverrides/roofOverrides/circulation},
      // prune orphan styles, re-derive the skin, and record undo history.
      const commit = (
        producer: (
          s: BuildState
        ) => Partial<
          Pick<BuildState, 'cells' | 'styleBySpace' | 'faceOverrides' | 'roofOverrides' | 'circulation' | 'roofs'>
        >
      ) =>
        set((s) => {
          const next = producer(s);
          const cells = next.cells ?? s.cells;
          const styleBySpace = pruneStyles(cells, next.styleBySpace ?? s.styleBySpace);
          const faceOverrides = next.faceOverrides ?? s.faceOverrides;
          const roofOverrides = next.roofOverrides ?? s.roofOverrides;
          const circulation = next.circulation ?? s.circulation;
          const roofs = pruneRoofs(cells, next.roofs ?? s.roofs);
          return {
            cells,
            styleBySpace,
            faceOverrides,
            roofOverrides,
            circulation,
            roofs,
            instances: reskinFrom(cells, styleBySpace, faceOverrides, roofOverrides, s.roofFallbackCenter, circulation),
            past: [...s.past, snapshot(s)].slice(-MAX_HISTORY),
            future: [],
          };
        });

      return {
        cells: {},
        styleBySpace: {},
        faceOverrides: {},
        roofOverrides: {},
        circulation: emptyCirculation(),
        roofs: [],
        palette: {},
        floorHeight: WALL_HEIGHT, // fixed: stacked floors must match the wall height
        instances: [],

        pieces: [],
        tool: 'select',
        activeLevel: 0,
        activeStyle: 'enclosed',
        activeRoofStyle: 'gable',
        roofFallbackCenter: false,
        abstractView: false,
        camera: {},
        hoveredKey: null,
        selectedKeys: [],
        selectedStairId: null,
        selectedRoofId: null,
        selectedCols: [],
        moveOverwrite: false,
        past: [],
        future: [],

        setPieces: (pieces) => set({ pieces }),
        setTool: (tool) => set({ tool }),
        setActiveLevel: (n) => set({ activeLevel: Math.max(0, n) }),
        // Arrow-key floor nav. Up can go ONE above the topmost built level (a fresh
        // floor to draw on); never higher (can't stack on empty air), and an empty
        // scene caps at 0. Down stops at the ground.
        stepLevel: (dir) =>
          set((s) => {
            let maxUsed = -1;
            for (const k in s.cells) {
              const lvl = Number(k.slice(0, k.indexOf(',')));
              if (lvl > maxUsed) maxUsed = lvl;
            }
            const cap = maxUsed >= 0 ? maxUsed + 1 : 0;
            const next = Math.min(cap, Math.max(0, s.activeLevel + dir));
            return next === s.activeLevel ? {} : { activeLevel: next };
          }),
        setActiveStyle: (t) => set({ activeStyle: t }),
        setActiveRoofStyle: (t) => set({ activeRoofStyle: t }),
        // Appearance only — recolour one semantic part; not part of commit/undo/reskin.
        setPaletteColor: (cat, hex) => set((s) => ({ palette: { ...s.palette, [cat]: hex } })),
        resetPalette: () => set((s) => (Object.keys(s.palette).length ? { palette: {} } : {})),
        toggleRoofFallback: () =>
          set((s) => {
            const roofFallbackCenter = !s.roofFallbackCenter;
            return {
              roofFallbackCenter,
              instances: reskinFrom(s.cells, s.styleBySpace, s.faceOverrides, s.roofOverrides, roofFallbackCenter, s.circulation),
            };
          }),
        toggleAbstract: () => set((s) => ({ abstractView: !s.abstractView })),
        setCamera: (ops) => set({ camera: ops }),
        setHovered: (key) => set((s) => (s.hoveredKey === key ? {} : { hoveredKey: key })),

        selectFace: (key, additive) =>
          set((s) => {
            // Selecting a face deselects any stair/roof/columns (all mutually exclusive).
            if (!additive) return { selectedKeys: [key], selectedStairId: null, selectedRoofId: null, selectedCols: [] };
            return {
              selectedStairId: null,
              selectedRoofId: null,
              selectedCols: [],
              selectedKeys: s.selectedKeys.includes(key)
                ? s.selectedKeys.filter((k) => k !== key)
                : [...s.selectedKeys, key],
            };
          }),
        // Select a single stair (clears any face/roof/column selection).
        selectStair: (id) => set({ selectedStairId: id, selectedKeys: [], selectedRoofId: null, selectedCols: [] }),
        // Select a single roof (clears any face/stair/column selection).
        selectRoof: (id) => set({ selectedRoofId: id, selectedKeys: [], selectedStairId: null, selectedCols: [] }),
        // Marquee-select a set of "i,j" columns to relocate (clears face/stair/roof).
        selectCols: (cols) => set({ selectedCols: cols, selectedKeys: [], selectedStairId: null, selectedRoofId: null }),
        clearSelection: () =>
          set((s) =>
            s.selectedKeys.length || s.selectedStairId || s.selectedRoofId || s.selectedCols.length
              ? { selectedKeys: [], selectedStairId: null, selectedRoofId: null, selectedCols: [] }
              : {}
          ),
        // Cycle the style of every selected face together (as one unit).
        cycleSelection: (dir) => {
          const keys = get().selectedKeys;
          if (!keys.length) return;
          commit((s) => {
            const cur = s.faceOverrides[keys[0]];
            const nextVal = ORDER[(ORDER.indexOf(cur) + dir + ORDER.length) % ORDER.length];
            const faceOverrides = { ...s.faceOverrides };
            for (const k of keys) {
              if (nextVal) faceOverrides[k] = nextVal;
              else delete faceOverrides[k];
            }
            return { faceOverrides };
          });
        },
        // Set every selected face directly to a kind ('auto' clears the override).
        setSelectionStyle: (kind) => {
          const keys = get().selectedKeys;
          if (!keys.length) return;
          commit((s) => {
            const faceOverrides = { ...s.faceOverrides };
            for (const k of keys) {
              if (kind === 'auto') delete faceOverrides[k];
              else faceOverrides[k] = kind;
            }
            return { faceOverrides };
          });
        },

        // Draw a rectangle of cells as a new space, stamped with the active style.
        fillSpace: (ai, aj, bi, bj) => {
          const level = get().activeLevel;
          const style = get().activeStyle;
          const id = uid();
          commit((s) => ({
            cells: fillRect(s.cells, level, ai, aj, bi, bj, id),
            styleBySpace: { ...s.styleBySpace, [id]: style },
          }));
        },
        // Area eraser: wipe everything anchored in the dragged rect on the active level —
        // cells, manual stairs, exterior platform stairs, and drawn roofs. Auto interior
        // stairs re-derive; pruneRoofs (in commit) mops up any roof left orphaned.
        eraseCells: (ai, aj, bi, bj) => {
          const level = get().activeLevel;
          const r = normalizeRect(ai, aj, bi, bj);
          const inRect = (lvl: number, ci: number, cj: number) =>
            lvl === level && ci >= r.ci0 && ci <= r.ci1 && cj >= r.cj0 && cj <= r.cj1;
          const rectHitsRoof = (rf: RoofRegion) =>
            Math.min(rf.ci0, rf.ci1) <= r.ci1 && Math.max(rf.ci0, rf.ci1) >= r.ci0 &&
            Math.min(rf.cj0, rf.cj1) <= r.cj1 && Math.max(rf.cj0, rf.cj1) >= r.cj0;
          commit((s) => {
            // Is there anything to erase at this level inside the rect? (drives roof scope)
            let erasedAtLevel = false;
            for (let i = r.ci0; i <= r.ci1 && !erasedAtLevel; i++)
              for (let j = r.cj0; j <= r.cj1; j++)
                if (s.cells[`${level},${i},${j}`]) { erasedAtLevel = true; break; }
            // Platform stairs whose landing cell is in the rect → drop + clean their overrides.
            const c = s.circulation;
            const platforms = c.platforms.filter((key) => {
              const { 0: pl, 1: pi, 2: pj } = key.split(',').map(Number);
              return !inRect(pl, pi, pj);
            });
            const platformModel = { ...c.platformModel };
            const platformDir = { ...c.platformDir };
            for (const key of c.platforms) if (!platforms.includes(key)) { delete platformModel[key]; delete platformDir[key]; }
            // Roofs the rect touches: this level always; the level below only when we're
            // erasing empty air above a building (mirrors "draw a roof from the level above").
            const roofs = s.roofs.filter(
              (rf) => !(rectHitsRoof(rf) && (rf.level === level || (rf.level === level - 1 && !erasedAtLevel)))
            );
            return {
              cells: eraseRect(s.cells, level, ai, aj, bi, bj),
              circulation: { ...c, manual: c.manual.filter((st) => !inRect(st.level, st.ci, st.cj)), platforms, platformModel, platformDir },
              roofs,
            };
          });
        },
        // Manually add a locked stair from the active level up to the next.
        addStair: (ci, cj, dir) => {
          const level = get().activeLevel;
          commit((s) => ({
            circulation: { ...s.circulation, manual: [...s.circulation.manual, { id: uid(), level, ci, cj, dir, model: PIECE_STAIRS_CLOSED }] },
          }));
        },
        // Draw an outdoor landing platform at the active level (empty cell only); a
        // stair auto-descends from it to the ground. If it sits against an enclosed
        // wall, open a door on that face so you can step in.
        addPlatform: (ci, cj) => {
          const level = get().activeLevel;
          const key = `${level},${ci},${cj}`;
          commit((s) => {
            if (s.cells[key]) return {}; // must be an empty (outdoor) cell
            const c = s.circulation;
            if (c.platforms.includes(key)) return {};
            const isEnclosed = (l: number, i: number, j: number) => {
              const id = s.cells[`${l},${i},${j}`];
              return id ? (s.styleBySpace[id] ?? 'enclosed') === 'enclosed' : false;
            };
            const door = platformDoorFace(s.cells, key, isEnclosed);
            const faceOverrides = door ? { ...s.faceOverrides, [door]: 'door' as const } : s.faceOverrides;
            return { faceOverrides, circulation: { ...c, platforms: [...c.platforms, key] } };
          });
        },
        // Draw a roof over a rectangle of building-top cells, stamped with the active
        // style. Caps the building TOP within the rect: we try the active level first, then
        // the level just below it — so drawing while standing on the rooftop OR on the empty
        // level above it both work (the common "go up one, then roof it" instinct). Clamps to
        // the bounding box of the actual top cells (occupied there, open above); ignored if
        // the rect covers no rooftop on either level.
        // Translate a whole connected building (all its columns `cols`, every level)
        // by a grid delta (di,dj). Every cell-keyed truth moves together: cells,
        // faceOverrides, drawn roofs, manual/suppressed stairs, and the exterior
        // platform stairs attached to it. Blocked (no-op) if any target cell would
        // land on a NON-moving occupied cell. Auto interior cores aren't stored →
        // they re-derive at the new position.
        moveBuilding: (cols, di, dj) => {
          if ((di === 0 && dj === 0) || cols.length === 0) return;
          const colSet = new Set(cols);
          const inCols = (i: number, j: number) => colSet.has(`${i},${j}`);
          const overwrite = get().moveOverwrite;
          const before = get().cells;
          // Cells the movers will land on that are currently occupied by a different
          // (non-moving) column — the overwritten set.
          const movedTargets = new Set<string>();
          let overlaps = false;
          for (const k in before) {
            const [lvl, i, j] = k.split(',').map(Number);
            if (!inCols(i, j)) continue;
            const tk = `${lvl},${i + di},${j + dj}`;
            if (before[tk] && !inCols(i + di, j + dj)) { overlaps = true; movedTargets.add(tk); }
          }
          // Default: overlap is blocked → true no-op (no undo snapshot). With the
          // overwrite toggle on, the mover wins and buries the target instead.
          if (overlaps && !overwrite) return;
          commit((s) => {
            // cells — write non-moving first, then movers (so a mover overwrites any
            // non-moving cell at its target; in block mode there are no collisions).
            const cells: typeof s.cells = {};
            for (const k in s.cells) {
              const [, i, j] = k.split(',').map(Number);
              if (!inCols(i, j)) cells[k] = s.cells[k];
            }
            for (const k in s.cells) {
              const [lvl, i, j] = k.split(',').map(Number);
              if (inCols(i, j)) cells[`${lvl},${i + di},${j + dj}`] = s.cells[k];
            }
            // faceOverrides ("level,ci,cj,dir"): non-moving first (skip those on a cell
            // the mover overwrote — their owner changed), then movers.
            const faceOverrides: typeof s.faceOverrides = {};
            for (const k in s.faceOverrides) {
              const [lvl, i, j] = k.split(',');
              if (inCols(+i, +j)) continue;
              if (movedTargets.has(`${lvl},${i},${j}`)) continue; // cell overwritten by a mover
              faceOverrides[k] = s.faceOverrides[k];
            }
            for (const k in s.faceOverrides) {
              const [lvl, i, j, dir] = k.split(',');
              if (inCols(+i, +j)) faceOverrides[`${lvl},${+i + di},${+j + dj},${dir}`] = s.faceOverrides[k];
            }
            // roofs — split each roof by which of its cells move vs stay, so cutting a
            // building in half yields a roof over each half (pruneRoofs cleans up leftovers).
            const bbox = (cellList: [number, number][]) => {
              let a = Infinity, b = Infinity, c2 = -Infinity, d2 = -Infinity;
              for (const [i, j] of cellList) { a = Math.min(a, i); b = Math.min(b, j); c2 = Math.max(c2, i); d2 = Math.max(d2, j); }
              return { ci0: a, cj0: b, ci1: c2, cj1: d2 };
            };
            const roofs = s.roofs.flatMap((r) => {
              const moved: [number, number][] = [];
              const stayed: [number, number][] = [];
              for (let i = Math.min(r.ci0, r.ci1); i <= Math.max(r.ci0, r.ci1); i++)
                for (let j = Math.min(r.cj0, r.cj1); j <= Math.max(r.cj0, r.cj1); j++)
                  (inCols(i, j) ? moved : stayed).push([i, j]);
              if (!moved.length) return [r]; // nothing of this roof moves → untouched
              const out: RoofRegion[] = [];
              if (moved.length) {
                const bb = bbox(moved);
                out.push({ id: uid(), level: r.level, style: r.style, rotated: r.rotated,
                  ci0: bb.ci0 + di, ci1: bb.ci1 + di, cj0: bb.cj0 + dj, cj1: bb.cj1 + dj });
              }
              if (stayed.length) {
                const bb = bbox(stayed);
                out.push({ id: uid(), level: r.level, style: r.style, rotated: r.rotated, ...bb });
              }
              return out;
            });
            // circulation: manual stairs, suppressed auto-ids, exterior platforms.
            const c = s.circulation;
            const manual = c.manual.map((st) =>
              inCols(st.ci, st.cj) ? { ...st, ci: st.ci + di, cj: st.cj + dj } : st
            );
            const suppressed = c.suppressed.map((id) => {
              const m = /^auto:(-?\d+),(-?\d+),(-?\d+),([NESW])$/.exec(id);
              return m && inCols(+m[2], +m[3])
                ? `auto:${m[1]},${+m[2] + di},${+m[3] + dj},${m[4]}`
                : id;
            });
            // Which platforms move with the building? Seed = platforms fronting a moved
            // column (in it or 4-adjacent = a door landing), then BFS along the exterior-
            // stair CHAIN (a platform links to another one level up/down and exactly 3
            // cells away in a cardinal), so a whole stair — including its far/floating
            // landings — follows the building. A chain cut by a partial selection just
            // splits into two towers (deriveCirculation re-derives each safely).
            const attached = (i: number, j: number) =>
              inCols(i, j) ||
              [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => inCols(i + a, j + b));
            const platSet = new Set(c.platforms);
            const parse = (k: string) => k.split(',').map(Number) as [number, number, number];
            const movePlats = new Set<string>();
            const queue: string[] = [];
            for (const k of c.platforms) {
              const [, pi, pj] = parse(k);
              if (attached(pi, pj)) { movePlats.add(k); queue.push(k); }
            }
            const CHAIN: [number, number, number][] = [
              [1, 3, 0], [1, -3, 0], [1, 0, 3], [1, 0, -3],
              [-1, 3, 0], [-1, -3, 0], [-1, 0, 3], [-1, 0, -3],
            ];
            while (queue.length) {
              const [pl, pi, pj] = parse(queue.pop()!);
              for (const [dl, dx, dy] of CHAIN) {
                const nb = `${pl + dl},${pi + dx},${pj + dy}`;
                if (platSet.has(nb) && !movePlats.has(nb)) { movePlats.add(nb); queue.push(nb); }
              }
            }
            const remapPlat = (key: string) => {
              const [pl, pi, pj] = parse(key);
              return movePlats.has(key) ? `${pl},${pi + di},${pj + dj}` : key;
            };
            const platforms = c.platforms.map(remapPlat);
            const platformModel: typeof c.platformModel = {};
            for (const key in c.platformModel) platformModel[remapPlat(key)] = c.platformModel[key];
            const platformDir: typeof c.platformDir = {};
            for (const key in c.platformDir) platformDir[remapPlat(key)] = c.platformDir[key];
            const circulation = { ...c, manual, suppressed, platforms, platformModel, platformDir };
            return { cells, faceOverrides, roofs, circulation };
          });
          // Keep a marquee selection following its columns to the new spot.
          set((s) =>
            s.selectedCols.length
              ? {
                  selectedCols: s.selectedCols.map((k) => {
                    const [i, j] = k.split(',').map(Number);
                    return colSet.has(k) ? `${i + di},${j + dj}` : k;
                  }),
                }
              : {}
          );
        },
        toggleMoveOverwrite: () => set((s) => ({ moveOverwrite: !s.moveOverwrite })),
        addRoof: (ai, aj, bi, bj) => {
          const active = get().activeLevel;
          const style = get().activeRoofStyle;
          commit((s) => {
            const r = normalizeRect(ai, aj, bi, bj);
            const topBox = (level: number) => {
              if (level < 0) return null;
              let ci0 = Infinity, cj0 = Infinity, ci1 = -Infinity, cj1 = -Infinity, any = false;
              for (let i = r.ci0; i <= r.ci1; i++)
                for (let j = r.cj0; j <= r.cj1; j++) {
                  const top = !!s.cells[`${level},${i},${j}`] && !s.cells[`${level + 1},${i},${j}`];
                  if (!top) continue;
                  any = true;
                  ci0 = Math.min(ci0, i); cj0 = Math.min(cj0, j); ci1 = Math.max(ci1, i); cj1 = Math.max(cj1, j);
                }
              return any ? { level, ci0, cj0, ci1, cj1 } : null;
            };
            const box = topBox(active) ?? topBox(active - 1);
            if (!box) return {};
            // One roof per area: the new one replaces any existing roof it overlaps (same
            // level, intersecting cell rect) — latest-wins, like redrawing a space.
            const overlaps = (r: RoofRegion) =>
              r.level === box.level &&
              Math.min(r.ci0, r.ci1) <= box.ci1 && Math.max(r.ci0, r.ci1) >= box.ci0 &&
              Math.min(r.cj0, r.cj1) <= box.cj1 && Math.max(r.cj0, r.cj1) >= box.cj0;
            return { roofs: [...s.roofs.filter((r) => !overlaps(r)), { id: uid(), ...box, style }] };
          });
        },
        setRoofStyle: (id, style) =>
          commit((s) => ({ roofs: s.roofs.map((r) => (r.id === id ? { ...r, style } : r)) })),
        // Swap the ridge/slope axis (gable & shed); no-op visual for hip/dome.
        rotateRoof: (id) =>
          commit((s) => ({ roofs: s.roofs.map((r) => (r.id === id ? { ...r, rotated: !r.rotated } : r)) })),
        removeRoof: (id) => {
          set((s) => (s.selectedRoofId === id ? { selectedRoofId: null } : {}));
          commit((s) => ({ roofs: s.roofs.filter((r) => r.id !== id) }));
        },
        // Swap the stair model for a platform tower (its `platform:<key>` group).
        setPlatformModel: (platformKey, model) =>
          commit((s) => ({ circulation: { ...s.circulation, platformModel: { ...s.circulation.platformModel, [platformKey]: model } } })),
        // Rotate which edge a platform's straight descent goes down — jumps to the next
        // CLEAR (buildable) direction so every press changes something (skips blocked ones).
        rotatePlatformDir: (platformKey) =>
          commit((s) => {
            const next = cycleDescentDir(s.cells, platformKey, s.circulation.platformDir[platformKey]);
            if (!next) return {}; // boxed in on every side → nothing to rotate to
            return { circulation: { ...s.circulation, platformDir: { ...s.circulation.platformDir, [platformKey]: next } } };
          }),
        // Rotate climb direction (N→E→S→W). Manual: in place. Auto: promote to a manual
        // (locked) stair at that spot with the next dir, and suppress the auto flight.
        rotateStair: (id) => {
          commit((s) => {
            const c = s.circulation;
            if (isAutoStair(id)) {
              const a = parseAutoId(id);
              if (!a) return {};
              const nextDir = DIR_ORDER[(DIR_ORDER.indexOf(a.dir) + 1) % 4];
              return {
                circulation: {
                  ...c,
                  suppressed: c.suppressed.includes(id) ? c.suppressed : [...c.suppressed, id],
                  manual: [...c.manual, { id: uid(), level: a.level, ci: a.ci, cj: a.cj, dir: nextDir, model: PIECE_STAIRS_CLOSED }],
                },
              };
            }
            if (!c.manual.some((st) => st.id === id)) return {};
            return {
              circulation: {
                ...c,
                manual: c.manual.map((st) =>
                  st.id === id ? { ...st, dir: DIR_ORDER[(DIR_ORDER.indexOf(st.dir) + 1) % 4] } : st
                ),
              },
            };
          });
        },
        // Delete: attachment tower → drop its faceKey; auto → suppress that flight;
        // manual → remove it.
        removeStair: (id) => {
          set((s) => (s.selectedStairId === id ? { selectedStairId: null } : {}));
          commit((s) => {
            const c = s.circulation;
            if (isPlatformStair(id)) {
              const key = id.slice('platform:'.length);
              const platformModel = { ...c.platformModel }; delete platformModel[key];
              const platformDir = { ...c.platformDir }; delete platformDir[key];
              return { circulation: { ...c, platforms: c.platforms.filter((p) => p !== key), platformModel, platformDir } };
            }
            if (isAutoStair(id)) {
              return c.suppressed.includes(id)
                ? {}
                : { circulation: { ...c, suppressed: [...c.suppressed, id] } };
            }
            return { circulation: { ...c, manual: c.manual.filter((st) => st.id !== id) } };
          });
        },
        // "Re-roll": pick another valid auto stair-core arrangement.
        rerollStairs: () =>
          commit((s) => ({ circulation: { ...s.circulation, seed: s.circulation.seed + 1 } })),
        toggleAutoStairs: () =>
          commit((s) => ({ circulation: { ...s.circulation, auto: !s.circulation.auto } })),
        clearAll: () => {
          set({ selectedKeys: [], selectedStairId: null, selectedRoofId: null });
          commit(() => ({ cells: {}, styleBySpace: {}, faceOverrides: {}, roofOverrides: {}, circulation: emptyCirculation(), roofs: [] }));
        },

        undo: () =>
          set((s) => {
            if (!s.past.length) return {};
            const prev = s.past[s.past.length - 1];
            return {
              ...prev,
              past: s.past.slice(0, -1),
              future: [snapshot(s), ...s.future].slice(0, MAX_HISTORY),
            };
          }),
        redo: () =>
          set((s) => {
            if (!s.future.length) return {};
            const next = s.future[0];
            return {
              ...next,
              future: s.future.slice(1),
              past: [...s.past, snapshot(s)].slice(-MAX_HISTORY),
            };
          }),

        exportProject: () => {
          const { cells, styleBySpace, faceOverrides, roofOverrides, circulation, roofs, palette } = get();
          return JSON.stringify({ version: 14, cells, styleBySpace, faceOverrides, roofOverrides, circulation, roofs, palette }, null, 2);
        },
        importProject: (json) => {
          try {
            const data = JSON.parse(json);
            const cells: CellMap =
              data && typeof data.cells === 'object' && data.cells ? data.cells : {};
            // Accept new {circulation} or legacy {stairs:[]} (→ manual).
            const circulation: Circulation = data.circulation
              ? { ...emptyCirculation(), ...data.circulation,
                  manual: data.circulation.manual ?? [], suppressed: data.circulation.suppressed ?? [],
                  platforms: data.circulation.platforms ?? [],
                  platformModel: data.circulation.platformModel ?? {}, platformDir: data.circulation.platformDir ?? {} }
              : { ...emptyCirculation(), manual: Array.isArray(data.stairs) ? data.stairs : [] };
            set({ palette: data.palette && typeof data.palette === 'object' ? data.palette : {} });
            commit(() => ({
              cells,
              styleBySpace: data.styleBySpace ?? {},
              faceOverrides: data.faceOverrides ?? {},
              roofOverrides: data.roofOverrides ?? {},
              circulation,
              roofs: Array.isArray(data.roofs) ? data.roofs : [],
            }));
          } catch (e) {
            alert('プロジェクトを読み込めません:' + e);
          }
        },
      };
    },
    {
      name: 'building-kit-project',
      version: 14,
      partialize: (s) => ({
        cells: s.cells,
        styleBySpace: s.styleBySpace,
        faceOverrides: s.faceOverrides,
        roofOverrides: s.roofOverrides,
        circulation: s.circulation,
        roofs: s.roofs,
        palette: s.palette,
      }),
      // v7: house/pavilion/open program names → enclosed/open structural types.
      // v8: manual `stairs[]` → `circulation.manual` (auto cores now derive themselves).
      migrate: (persisted: unknown) => {
        const s = (persisted ?? {}) as Record<string, unknown>;
        const mapStyle = (v: unknown): SkinTheme =>
          v === 'house' ? 'enclosed' : v === 'pavilion' || v === 'open' ? 'open' : 'enclosed';
        const oldStyles = (s.styleBySpace ?? {}) as Record<string, unknown>;
        const styleBySpace: StyleBySpace = {};
        for (const k in oldStyles) styleBySpace[k] = mapStyle(oldStyles[k]);
        const circ = s.circulation as Circulation | undefined;
        const circulation: Circulation = circ
          ? { ...emptyCirculation(), ...circ, manual: circ.manual ?? [],
              suppressed: circ.suppressed ?? [], platforms: circ.platforms ?? [],
              platformModel: circ.platformModel ?? {}, platformDir: circ.platformDir ?? {} }
          : { ...emptyCirculation(), manual: Array.isArray(s.stairs) ? (s.stairs as Stair[]) : [] };
        return {
          cells: (s.cells ?? {}) as CellMap,
          styleBySpace,
          faceOverrides: (s.faceOverrides ?? {}) as Overrides,
          roofOverrides: (s.roofOverrides ?? {}) as RoofOverrides,
          circulation,
          roofs: (Array.isArray(s.roofs) ? s.roofs : []) as RoofRegion[], // v11: drawn roofs
          palette: {} as Palette, // v14: palette keys changed (semantic parts); reset old colours
        };
      },
      onRehydrateStorage: () => (state) => {
        if (state)
          state.instances = reskinFrom(
            state.cells,
            state.styleBySpace ?? {},
            state.faceOverrides,
            state.roofOverrides ?? {},
            false,
            state.circulation ?? emptyCirculation()
          );
      },
    }
  )
);

export { pieceY };
