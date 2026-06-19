import { useEffect, useState } from 'react';
import type { PieceDef } from './types';

/** Loads the piece manifest produced by scripts/build-kit.mjs. */
export function useManifest() {
  const [pieces, setPieces] = useState<PieceDef[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/kit/pieces.json')
      .then((r) => {
        if (!r.ok) throw new Error(`pieces.json ${r.status}`);
        return r.json();
      })
      .then((data: PieceDef[]) => {
        if (alive) setPieces(data);
      })
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  return { pieces, error };
}
