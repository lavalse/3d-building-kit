import { useMemo } from 'react';
import { useBuildStore, pieceY } from '../store/useBuildStore';
import { PieceInstance } from './PieceInstance';

/** Renders every materialized instance. This group is the one exported to GLB. */
export function PlacedPieces() {
  const instances = useBuildStore((s) => s.instances);
  const pieces = useBuildStore((s) => s.pieces);
  const floorHeight = useBuildStore((s) => s.floorHeight);

  const byId = useMemo(() => new Map(pieces.map((p) => [p.id, p])), [pieces]);

  return (
    <>
      {instances.map((inst) => {
        const def = byId.get(inst.pieceId);
        if (!def) return null;
        return <PieceInstance key={inst.id} inst={inst} def={def} y={pieceY(inst, floorHeight)} />;
      })}
    </>
  );
}
