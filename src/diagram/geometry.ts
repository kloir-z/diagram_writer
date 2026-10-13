// 箱と直交線分の当たり判定（レイアウトの後処理と機械チェックで共通）。
import type { Box, Point } from './types.ts';

/** 線分が箱に当たるとみなすのは、箱の縁からこれだけ内側に入ったとき（縁に沿う・縁で止まる線は当たらない） */
export const INSET = 2;

export function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** 見出しの文字に線が近づきすぎない（矢印の先や × 印がかぶらない）ための余白 */
export const HEADER_CLEARANCE = 8;

export function inflate(b: Box, d: number): Box {
  return { x: b.x - d, y: b.y - d / 2, w: b.w + d * 2, h: b.h + d };
}

/** 四方に同じだけ広げる */
export function grow(b: Box, d: number): Box {
  return { x: b.x - d, y: b.y - d, w: b.w + d * 2, h: b.h + d * 2 };
}

/** 水平/垂直の線分が箱の内側（縁から INSET 内側）を通るか */
export function segmentHitsBox(p: Point, q: Point, b: Box): boolean {
  const x0 = b.x + INSET;
  const x1 = b.x + b.w - INSET;
  const y0 = b.y + INSET;
  const y1 = b.y + b.h - INSET;
  // ELK の座標には 342.00000000000006 のような誤差が混ざるので、完全一致では比べない
  if (Math.abs(p.y - q.y) < 0.5) {
    const [a, c] = p.x < q.x ? [p.x, q.x] : [q.x, p.x];
    return p.y > y0 && p.y < y1 && a < x1 && c > x0;
  }
  const [a, c] = p.y < q.y ? [p.y, q.y] : [q.y, p.y];
  return p.x > x0 && p.x < x1 && a < y1 && c > y0;
}

/** 連続する同じ点と、一直線上の途中の点を取り除く（つなぎ合わせた線の後始末） */
export function simplifyPolyline(points: Point[]): Point[] {
  const same = (a: Point, b: Point): boolean => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
  const deduped = points.filter((p, i) => i === 0 || !same(p, points[i - 1]));
  return deduped.filter((p, i) => {
    if (i === 0 || i === deduped.length - 1) return true;
    const a = deduped[i - 1];
    const b = deduped[i + 1];
    const vertical = Math.abs(a.x - p.x) < 0.5 && Math.abs(p.x - b.x) < 0.5;
    const horizontal = Math.abs(a.y - p.y) < 0.5 && Math.abs(p.y - b.y) < 0.5;
    return !vertical && !horizontal;
  });
}

export function polylineHitsBox(points: Point[], b: Box): boolean {
  for (let k = 0; k + 1 < points.length; k++) if (segmentHitsBox(points[k], points[k + 1], b)) return true;
  return false;
}
