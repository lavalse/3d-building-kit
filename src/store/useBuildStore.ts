import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { WALL_HEIGHT } from '../kit/constants';
import { deriveSkin, type StyleBySpace } from '../kit/deriveSkin';
import { type Circulation, platformDoorFace } from '../kit/deriveCirculation';
import { eraseRect, fillRect, groundLevelOfCells, normalizeRect, type CellMap } from '../kit/massing';
import type { Dir, FaceOverride, Instance, PieceDef, SkinTheme, Stair, Tool } from '../kit/types';

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
};
const MAX_HISTORY = 50;

const emptyCirculation = (): Circulation => ({ auto: true, seed: 0, manual: [], suppressed: [], platforms: [] });
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
  floorHeight: number;

  // derived
  instances: Instance[];

  // session-only
  pieces: PieceDef[];
  tool: Tool;
  activeLevel: number;
  activeStyle: SkinTheme; // the style applied to the next drawn space
  roofFallbackCenter: boolean;
  abstractView: boolean;
  camera: CameraOps;
  hoveredKey: string | null;
  selectedKeys: string[];
  selectedStairId: string | null;
  past: Snapshot[];
  future: Snapshot[];

  setPieces: (p: PieceDef[]) => void;
  setTool: (t: Tool) => void;
  setActiveLevel: (n: number) => void;
  stepLevel: (dir: 1 | -1) => void;
  setActiveStyle: (t: SkinTheme) => void;
  toggleRoofFallback: () => void;
  toggleAbstract: () => void;
  setCamera: (ops: CameraOps) => void;
  setHovered: (key: string | null) => void;
  selectFace: (key: string, additive: boolean) => void;
  selectStair: (id: string) => void;
  clearSelection: () => void;
  cycleSelection: (dir: 1 | -1) => void;
  setSelectionStyle: (kind: FaceOverride | 'auto') => void;

  fillSpace: (ai: number, aj: number, bi: number, bj: number) => void;
  eraseCells: (ai: number, aj: number, bi: number, bj: number) => void;
  addStair: (ci: number, cj: number, dir: Dir) => void;
  addPlatform: (ci: number, cj: number) => void;
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
      });

      // Apply an edit producing new {cells/styleBySpace/faceOverrides/roofOverrides/circulation},
      // prune orphan styles, re-derive the skin, and record undo history.
      const commit = (
        producer: (
          s: BuildState
        ) => Partial<
          Pick<BuildState, 'cells' | 'styleBySpace' | 'faceOverrides' | 'roofOverrides' | 'circulation'>
        >
      ) =>
        set((s) => {
          const next = producer(s);
          const cells = next.cells ?? s.cells;
          const styleBySpace = pruneStyles(cells, next.styleBySpace ?? s.styleBySpace);
          const faceOverrides = next.faceOverrides ?? s.faceOverrides;
          const roofOverrides = next.roofOverrides ?? s.roofOverrides;
          const circulation = next.circulation ?? s.circulation;
          return {
            cells,
            styleBySpace,
            faceOverrides,
            roofOverrides,
            circulation,
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
        floorHeight: WALL_HEIGHT, // fixed: stacked floors must match the wall height
        instances: [],

        pieces: [],
        tool: 'select',
        activeLevel: 0,
        activeStyle: 'enclosed',
        roofFallbackCenter: false,
        abstractView: false,
        camera: {},
        hoveredKey: null,
        selectedKeys: [],
        selectedStairId: null,
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
            // Selecting a face deselects any stair (faces & stairs are mutually exclusive).
            if (!additive) return { selectedKeys: [key], selectedStairId: null };
            return {
              selectedStairId: null,
              selectedKeys: s.selectedKeys.includes(key)
                ? s.selectedKeys.filter((k) => k !== key)
                : [...s.selectedKeys, key],
            };
          }),
        // Select a single stair (clears any face selection).
        selectStair: (id) => set({ selectedStairId: id, selectedKeys: [] }),
        clearSelection: () =>
          set((s) =>
            s.selectedKeys.length || s.selectedStairId ? { selectedKeys: [], selectedStairId: null } : {}
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
        eraseCells: (ai, aj, bi, bj) => {
          const level = get().activeLevel;
          const r = normalizeRect(ai, aj, bi, bj);
          const inRect = (lvl: number, ci: number, cj: number) =>
            lvl === level && ci >= r.ci0 && ci <= r.ci1 && cj >= r.cj0 && cj <= r.cj1;
          commit((s) => ({
            cells: eraseRect(s.cells, level, ai, aj, bi, bj),
            // Drop any manual stair whose bottom cell sits in the erased rect (autos re-derive).
            circulation: {
              ...s.circulation,
              manual: s.circulation.manual.filter((st) => !inRect(st.level, st.ci, st.cj)),
            },
          }));
        },
        // Manually add a locked stair from the active level up to the next.
        addStair: (ci, cj, dir) => {
          const level = get().activeLevel;
          commit((s) => ({
            circulation: { ...s.circulation, manual: [...s.circulation.manual, { id: uid(), level, ci, cj, dir }] },
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
                  manual: [...c.manual, { id: uid(), level: a.level, ci: a.ci, cj: a.cj, dir: nextDir }],
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
              return { circulation: { ...c, platforms: c.platforms.filter((p) => p !== key) } };
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
          set({ selectedKeys: [], selectedStairId: null });
          commit(() => ({ cells: {}, styleBySpace: {}, faceOverrides: {}, roofOverrides: {}, circulation: emptyCirculation() }));
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
          const { cells, styleBySpace, faceOverrides, roofOverrides, circulation } = get();
          return JSON.stringify({ version: 10, cells, styleBySpace, faceOverrides, roofOverrides, circulation }, null, 2);
        },
        importProject: (json) => {
          try {
            const data = JSON.parse(json);
            const cells: CellMap =
              data && typeof data.cells === 'object' && data.cells ? data.cells : {};
            // Accept new {circulation} or legacy {stairs:[]} (→ manual).
            const circulation: Circulation = data.circulation
              ? { auto: data.circulation.auto ?? true, seed: data.circulation.seed ?? 0,
                  manual: data.circulation.manual ?? [], suppressed: data.circulation.suppressed ?? [],
                  platforms: data.circulation.platforms ?? [] }
              : { ...emptyCirculation(), manual: Array.isArray(data.stairs) ? data.stairs : [] };
            commit(() => ({
              cells,
              styleBySpace: data.styleBySpace ?? {},
              faceOverrides: data.faceOverrides ?? {},
              roofOverrides: data.roofOverrides ?? {},
              circulation,
            }));
          } catch (e) {
            alert('无法导入工程：' + e);
          }
        },
      };
    },
    {
      name: 'building-kit-project',
      version: 10,
      partialize: (s) => ({
        cells: s.cells,
        styleBySpace: s.styleBySpace,
        faceOverrides: s.faceOverrides,
        roofOverrides: s.roofOverrides,
        circulation: s.circulation,
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
          ? { auto: circ.auto ?? true, seed: circ.seed ?? 0, manual: circ.manual ?? [],
              suppressed: circ.suppressed ?? [], platforms: circ.platforms ?? [] }
          : { ...emptyCirculation(), manual: Array.isArray(s.stairs) ? (s.stairs as Stair[]) : [] };
        return {
          cells: (s.cells ?? {}) as CellMap,
          styleBySpace,
          faceOverrides: (s.faceOverrides ?? {}) as Overrides,
          roofOverrides: (s.roofOverrides ?? {}) as RoofOverrides,
          circulation,
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
