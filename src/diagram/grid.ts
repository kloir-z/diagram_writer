// grid（ざっくりした配置）の読み取り。行ごとに id を並べ、"." は空き。同じ id を隣り合うマスに書くと、その範囲にまたがる。

/** 要素が占めるマスの範囲（両端を含む） */
export interface Area {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

export interface GridAreas {
  rows: number;
  cols: number;
  areas: Map<string, Area>;
  /** 長方形になっていない id などの問題 */
  errors: string[];
}

export const EMPTY_CELL = '.';

export function gridAreas(grid: string[][]): GridAreas {
  const rows = grid.length;
  const cols = Math.max(...grid.map((r) => r.length));
  const cells = new Map<string, [number, number][]>();
  grid.forEach((row, r) =>
    row.forEach((id, c) => {
      if (id === EMPTY_CELL) return;
      cells.set(id, [...(cells.get(id) ?? []), [r, c]]);
    }),
  );
  const areas = new Map<string, Area>();
  const errors: string[] = [];
  for (const [id, list] of cells) {
    const area = {
      r0: Math.min(...list.map(([r]) => r)),
      r1: Math.max(...list.map(([r]) => r)),
      c0: Math.min(...list.map(([, c]) => c)),
      c1: Math.max(...list.map(([, c]) => c)),
    };
    // 範囲のマスがすべてこの id で埋まっていること（L 字や飛び地は不可）
    const size = (area.r1 - area.r0 + 1) * (area.c1 - area.c0 + 1);
    if (size !== list.length) errors.push(`${id} が長方形になっていない。同じ id は隣り合うマスに長方形に並べる`);
    areas.set(id, area);
  }
  return { rows, cols, areas, errors };
}
