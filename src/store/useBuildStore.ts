import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { WALL_HEIGHT } from '../kit/constants';
import { deriveSkin } from '../kit/deriveSkin';
import { eraseRect, fillRect, groundLevelOfCells, type CellMap } from '../kit/massing';
import type { FaceOverride, Instance, PieceDef, SkinTheme, Tool } from '../kit/types';

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

type ThemeByLevel = Record<number, SkinTheme>;
type Overrides = Record<string, FaceOverride>;
type RoofOverrides = Record<string, 'open'>;
type Snapshot = {
  cells: CellMap;
  instances: Instance[];
  themeByLevel: ThemeByLevel;
  faceOverrides: Overrides;
  roofOverrides: RoofOverrides;
};
const MAX_HISTORY = 50;

const pieceY = (inst: Instance, floorHeight: number) =>
  inst.floor * floorHeight + (inst.yOffset ?? 0);

const themeAtOf = (themeByLevel: ThemeByLevel) => (lvl: number) => themeByLevel[lvl] ?? 'house';

const reskinFrom = (
  cells: CellMap,
  themeByLevel: ThemeByLevel,
  faceOverrides: Overrides,
  roofOverrides: RoofOverrides,
  fallback: boolean
): Instance[] =>
  deriveSkin(
    cells,
    groundLevelOfCells(cells),
    themeAtOf(themeByLevel),
    faceOverrides,
    roofOverrides,
    fallback
  ).map((sp) => ({ ...sp, id: uid() }));

/** On-screen camera buttons register their handlers here (set by a Canvas bridge). */
interface CameraOps {
  zoomIn?: () => void;
  zoomOut?: () => void;
  home?: () => void;
}

// Cycle order for a wall face. Width comes from how many adjacent faces share
// the same kind (deriveSkin merges contiguous window/door runs into wide pieces).
const ORDER: (FaceOverride | undefined)[] = [undefined /* auto */, 'window', 'door', 'wall'];

interface BuildState {
  // persisted truth
  cells: CellMap;
  themeByLevel: ThemeByLevel;
  faceOverrides: Overrides;
  roofOverrides: RoofOverrides;
  floorHeight: number;

  // derived
  instances: Instance[];

  // session-only
  pieces: PieceDef[];
  tool: Tool;
  activeLevel: number;
  roofFallbackCenter: boolean;
  abstractView: boolean;
  camera: CameraOps;
  hoveredKey: string | null;
  selectedKeys: string[];
  past: Snapshot[];
  future: Snapshot[];

  setPieces: (p: PieceDef[]) => void;
  setTool: (t: Tool) => void;
  setActiveLevel: (n: number) => void;
  setTheme: (t: SkinTheme) => void;
  toggleRoofFallback: () => void;
  toggleAbstract: () => void;
  setCamera: (ops: CameraOps) => void;
  setHovered: (key: string | null) => void;
  selectFace: (key: string, additive: boolean) => void;
  clearSelection: () => void;
  cycleSelection: (dir: 1 | -1) => void;

  fillSpace: (ai: number, aj: number, bi: number, bj: number) => void;
  eraseCells: (ai: number, aj: number, bi: number, bj: number) => void;
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
        themeByLevel: s.themeByLevel,
        faceOverrides: s.faceOverrides,
        roofOverrides: s.roofOverrides,
      });

      // Apply an edit producing new {cells/themeByLevel/faceOverrides/roofOverrides},
      // re-derive the skin, and record undo history.
      const commit = (
        producer: (
          s: BuildState
        ) => Partial<Pick<BuildState, 'cells' | 'themeByLevel' | 'faceOverrides' | 'roofOverrides'>>
      ) =>
        set((s) => {
          const next = producer(s);
          const cells = next.cells ?? s.cells;
          const themeByLevel = next.themeByLevel ?? s.themeByLevel;
          const faceOverrides = next.faceOverrides ?? s.faceOverrides;
          const roofOverrides = next.roofOverrides ?? s.roofOverrides;
          return {
            cells,
            themeByLevel,
            faceOverrides,
            roofOverrides,
            instances: reskinFrom(cells, themeByLevel, faceOverrides, roofOverrides, s.roofFallbackCenter),
            past: [...s.past, snapshot(s)].slice(-MAX_HISTORY),
            future: [],
          };
        });

      return {
        cells: {},
        themeByLevel: {},
        faceOverrides: {},
        roofOverrides: {},
        floorHeight: WALL_HEIGHT, // fixed: stacked floors must match the wall height
        instances: [],

        pieces: [],
        tool: 'select',
        activeLevel: 0,
        roofFallbackCenter: false,
        abstractView: false,
        camera: {},
        hoveredKey: null,
        selectedKeys: [],
        past: [],
        future: [],

        setPieces: (pieces) => set({ pieces }),
        setTool: (tool) => set({ tool }),
        setActiveLevel: (n) => set({ activeLevel: Math.max(0, n) }),
        setTheme: (t) => commit((s) => ({ themeByLevel: { ...s.themeByLevel, [s.activeLevel]: t } })),
        toggleRoofFallback: () =>
          set((s) => {
            const roofFallbackCenter = !s.roofFallbackCenter;
            return {
              roofFallbackCenter,
              instances: reskinFrom(s.cells, s.themeByLevel, s.faceOverrides, s.roofOverrides, roofFallbackCenter),
            };
          }),
        toggleAbstract: () => set((s) => ({ abstractView: !s.abstractView })),
        setCamera: (ops) => set({ camera: ops }),
        setHovered: (key) => set((s) => (s.hoveredKey === key ? {} : { hoveredKey: key })),

        selectFace: (key, additive) =>
          set((s) => {
            if (!additive) return { selectedKeys: [key] };
            return s.selectedKeys.includes(key)
              ? { selectedKeys: s.selectedKeys.filter((k) => k !== key) }
              : { selectedKeys: [...s.selectedKeys, key] };
          }),
        clearSelection: () => set((s) => (s.selectedKeys.length ? { selectedKeys: [] } : {})),
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

        fillSpace: (ai, aj, bi, bj) => {
          const level = get().activeLevel;
          const id = uid();
          commit((s) => ({ cells: fillRect(s.cells, level, ai, aj, bi, bj, id) }));
        },
        eraseCells: (ai, aj, bi, bj) => {
          const level = get().activeLevel;
          commit((s) => ({ cells: eraseRect(s.cells, level, ai, aj, bi, bj) }));
        },
        clearAll: () => {
          set({ selectedKeys: [] });
          commit(() => ({ cells: {}, faceOverrides: {}, roofOverrides: {} }));
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
          const { cells, themeByLevel, faceOverrides, roofOverrides } = get();
          return JSON.stringify({ version: 3, cells, themeByLevel, faceOverrides, roofOverrides }, null, 2);
        },
        importProject: (json) => {
          try {
            const data = JSON.parse(json);
            const cells: CellMap =
              data && typeof data.cells === 'object' && data.cells ? data.cells : {};
            commit(() => ({
              cells,
              themeByLevel: data.themeByLevel ?? {},
              faceOverrides: data.faceOverrides ?? {},
              roofOverrides: data.roofOverrides ?? {},
            }));
          } catch (e) {
            alert('无法导入工程：' + e);
          }
        },
      };
    },
    {
      name: 'building-kit-project',
      version: 4,
      partialize: (s) => ({
        cells: s.cells,
        themeByLevel: s.themeByLevel,
        faceOverrides: s.faceOverrides,
        roofOverrides: s.roofOverrides,
      }),
      migrate: () => ({ cells: {}, themeByLevel: {}, faceOverrides: {}, roofOverrides: {} }),
      onRehydrateStorage: () => (state) => {
        if (state)
          state.instances = reskinFrom(
            state.cells,
            state.themeByLevel,
            state.faceOverrides,
            state.roofOverrides ?? {},
            false
          );
      },
    }
  )
);

export { pieceY };
