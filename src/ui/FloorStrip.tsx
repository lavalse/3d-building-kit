import { useMemo } from 'react';
import { useBuildStore } from '../store/useBuildStore';

/** Vertical elevator-style floor selector. One click switches level; the top
 *  "＋" goes to a new empty level above; the wheel scrolls through levels. */
export function FloorStrip() {
  const cells = useBuildStore((s) => s.cells);
  const activeLevel = useBuildStore((s) => s.activeLevel);
  const setActiveLevel = useBuildStore((s) => s.setActiveLevel);

  const used = useMemo(() => {
    const set = new Set<number>();
    for (const k in cells) set.add(Number(k.slice(0, k.indexOf(','))));
    return set;
  }, [cells]);

  const maxUsed = used.size ? Math.max(...used) : 0;
  const top = Math.max(maxUsed, activeLevel); // highest level to show as a button
  const levels: number[] = [];
  for (let l = top; l >= 0; l--) levels.push(l); // top → bottom for display

  const onWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
    setActiveLevel(Math.max(0, activeLevel + (e.deltaY < 0 ? 1 : -1)));
  };

  return (
    <div className="floorstrip" onWheel={onWheel} title="階:クリックで切替 · ホイールで上下 · [ ] キー">
      <button className="floor-add" onClick={() => setActiveLevel(top + 1)} title="一つ上の階へ">
        ＋
      </button>
      {levels.map((l) => (
        <button
          key={l}
          className={
            'floor-btn' +
            (l === activeLevel ? ' active' : '') +
            (used.has(l) ? ' filled' : '')
          }
          onClick={() => setActiveLevel(l)}
        >
          {l + 1}
        </button>
      ))}
    </div>
  );
}
