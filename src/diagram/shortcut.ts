// 線の近道。ELK（layered）の線は流れの向きの辺（down なら上下）からしか出入りしないので、
// 横にある相手へも上下から出て大回りすることがある。人は必要なら横から出す。
// 配置の後で、各線について「まっすぐ」か「1 回だけ曲がる」経路（横から出る・横から入るを含む）を試し、
// 何にも当たらず、交差を増やさず、十分短くなるときだけ置き換える。
import { grow, HEADER_CLEARANCE, inflate, intersects, polylineHitsBox } from './geometry.ts';
import type { Box, LaidEdge, LaidNode, Point } from './types.ts';

/** 曲がり 1 回を、線の長さに換算した重み */
const BEND_COST = 40;
/** 置き換えるのは、元の経路の重みのこの割合より軽くなるときだけ */
const GAIN = 0.75;
/** 要素・補足との間隔（ELK の線と要素の間隔 SPACING.edgeNode と同じくらい） */
const CLEAR = 20;
/** 平行に走る別の線との間隔 */
const PARALLEL_GAP = 10;
/** 矢じりの手前（と出口）の直線の長さ */
const ARROW_RUN = 24;
/** 要素の角や、同じ辺に付く別の線の端との間隔 */
const PORT_GAP = 14;
/** 枠の辺に沿って走らないための間隔 */
const BORDER_GAP = 10;
const LABEL_GAP = 6;
/** ラベルと別の線との間隔 */
const LABEL_CLEAR = 6;
const FRACTIONS = [0.5, 0.3, 0.7, 0.15, 0.85, 0.05, 0.95];

const flat = (a: number, b: number): boolean => Math.abs(a - b) < 0.5;
const length = (points: Point[]): number => points.slice(1).reduce((s, q, k) => s + Math.abs(q.x - points[k].x) + Math.abs(q.y - points[k].y), 0);
const cost = (points: Point[]): number => length(points) + (points.length - 2) * BEND_COST;

type Segment = [Point, Point];
const segmentsOf = (points: Point[]): Segment[] => points.slice(1).map((q, k) => [points[k], q]);

/** 垂直と水平の線分が、どちらの端でもない所で交わる数 */
function crossings(points: Point[], others: Point[][]): number {
  const inside = (v: number, a: number, b: number): boolean => v > Math.min(a, b) + 0.5 && v < Math.max(a, b) - 0.5;
  let count = 0;
  for (const [p, q] of segmentsOf(points)) {
    for (const o of others) {
      for (const [r, s] of segmentsOf(o)) {
        if (flat(p.y, q.y) && flat(r.x, s.x) && inside(r.x, p.x, q.x) && inside(p.y, r.y, s.y)) count++;
        else if (flat(p.x, q.x) && flat(r.y, s.y) && inside(p.x, r.x, s.x) && inside(r.y, p.y, q.y)) count++;
      }
    }
  }
  return count;
}

/** 別の線と、間隔 PARALLEL_GAP 未満で平行に重なって走るか */
function runsAlong(points: Point[], others: Point[][]): boolean {
  const overlap = (a0: number, a1: number, b0: number, b1: number): number =>
    Math.min(Math.max(a0, a1), Math.max(b0, b1)) - Math.max(Math.min(a0, a1), Math.min(b0, b1));
  return segmentsOf(points).some(([p, q]) =>
    others.some((o) =>
      segmentsOf(o).some(([r, s]) =>
        (flat(p.y, q.y) && flat(r.y, s.y) && Math.abs(p.y - r.y) < PARALLEL_GAP && overlap(p.x, q.x, r.x, s.x) > 0) ||
        (flat(p.x, q.x) && flat(r.x, s.x) && Math.abs(p.x - r.x) < PARALLEL_GAP && overlap(p.y, q.y, r.y, s.y) > 0),
      ),
    ),
  );
}

/** a から b への、まっすぐか 1 回だけ曲がる経路の候補（a・b の辺から出て辺に入る） */
function candidates(a: Box, b: Box): Point[][] {
  const out: Point[][] = [];
  const ax1 = a.x + a.w;
  const ay1 = a.y + a.h;
  const bx1 = b.x + b.w;
  const by1 = b.y + b.h;
  const spread = (lo: number, hi: number): number[] => (lo > hi ? [] : FRACTIONS.map((f) => lo + (hi - lo) * f));

  // まっすぐ（上下、左右）
  for (const x of spread(Math.max(a.x, b.x) + PORT_GAP, Math.min(ax1, bx1) - PORT_GAP)) {
    if (b.y >= ay1) out.push([{ x, y: ay1 }, { x, y: b.y }]);
    if (by1 <= a.y) out.push([{ x, y: a.y }, { x, y: by1 }]);
  }
  for (const y of spread(Math.max(a.y, b.y) + PORT_GAP, Math.min(ay1, by1) - PORT_GAP)) {
    if (b.x >= ax1) out.push([{ x: ax1, y }, { x: b.x, y }]);
    if (bx1 <= a.x) out.push([{ x: a.x, y }, { x: bx1, y }]);
  }

  // 横から出て、上下から入る
  for (const y of spread(a.y + PORT_GAP, ay1 - PORT_GAP)) {
    for (const x of spread(b.x + PORT_GAP, bx1 - PORT_GAP)) {
      const sx = x >= ax1 + ARROW_RUN ? ax1 : x <= a.x - ARROW_RUN ? a.x : undefined;
      const ey = y <= b.y - ARROW_RUN ? b.y : y >= by1 + ARROW_RUN ? by1 : undefined;
      if (sx !== undefined && ey !== undefined) out.push([{ x: sx, y }, { x, y }, { x, y: ey }]);
    }
  }
  // 上下から出て、横から入る
  for (const x of spread(a.x + PORT_GAP, ax1 - PORT_GAP)) {
    for (const y of spread(b.y + PORT_GAP, by1 - PORT_GAP)) {
      const sy = y >= ay1 + ARROW_RUN ? ay1 : y <= a.y - ARROW_RUN ? a.y : undefined;
      const ex = x <= b.x - ARROW_RUN ? b.x : x >= bx1 + ARROW_RUN ? bx1 : undefined;
      if (sy !== undefined && ex !== undefined) out.push([{ x, y: sy }, { x, y }, { x: ex, y }]);
    }
  }
  return out;
}

/** ラベルの置き場を探すときに避けるもの */
export interface Blockers {
  boxes: Box[];
  paths: Point[][];
  containers: Box[];
}

/**
 * 線の長い線分の横で、blockers にかぶらない所にラベルを置く。まず枠の辺をまたがない所を探し、
 * 無ければ枠の辺はまたいでよいことにする（狭い通路を通る線のラベルが、要素や別の線の上に落ちるよりよい）
 */
export function labelSpot(points: Point[], size: { w: number; h: number }, blockers: Blockers, gap = LABEL_GAP): Box | undefined {
  const { w, h } = size;
  const spots = segmentsOf(points)
    .sort(([p, q], [r, s]) => Math.abs(s.x - r.x) + Math.abs(s.y - r.y) - (Math.abs(q.x - p.x) + Math.abs(q.y - p.y)))
    .flatMap(([p, q]) =>
      [0.5, 0.35, 0.65, 0.2, 0.8].flatMap((t) => {
        const m = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
        return flat(p.x, q.x)
          ? [{ x: m.x - gap - w, y: m.y - h / 2, w, h }, { x: m.x + gap, y: m.y - h / 2, w, h }]
          : [{ x: m.x - w / 2, y: m.y - gap - h, w, h }, { x: m.x - w / 2, y: m.y + gap, w, h }];
      }),
    );
  const inside = (l: Box, c: Box): boolean => l.x >= c.x && l.y >= c.y && l.x + l.w <= c.x + c.w && l.y + l.h <= c.y + c.h;
  const clear = (l: Box): boolean =>
    !blockers.boxes.some((b) => intersects(l, b)) &&
    // 自分の線からは gap 離して置くので、自分の線（太い矢印なら幅の分）にかぶらない範囲で近づけてよい
    !polylineHitsBox(points, grow(l, gap - 4)) &&
    !blockers.paths.some((p) => polylineHitsBox(p, grow(l, LABEL_CLEAR)));
  return spots.find((l) => clear(l) && blockers.containers.every((c) => inside(l, c) || !intersects(l, c))) ?? spots.find(clear);
}

/**
 * ELK の配置を保ったまま、大回りしている線を短い経路に置き換える（edges を書き換える）。
 * 近道が別の線のラベルを横切るときは、そのラベルを置き直せる場合に限って置き換える。
 * headerSpot は、線の経路の集まりに対して枠の見出しを置ける位置を返す（置けなければ undefined）。
 */
export function shortenEdges(
  nodes: LaidNode[],
  edges: LaidEdge[],
  headerSpot: (id: string, paths: Point[][]) => Box | undefined,
): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const leaves = nodes.filter((n) => !n.container);
  const containers = nodes.filter((n) => n.container);
  const lineage = (id: string): Set<string> => {
    const out = new Set<string>();
    for (let n = byId.get(id); n; n = n.parent === null ? undefined : byId.get(n.parent)) out.add(n.id);
    return out;
  };
  const run = (p: Point, q: Point): number => Math.abs(p.x - q.x) + Math.abs(p.y - q.y);

  /** e を近道に置き換えられたら置き換えて true */
  const improve = (e: LaidEdge): boolean => {
    const a = byId.get(e.from)?.box;
    const b = byId.get(e.to)?.box;
    if (!a || !b) return false;
    const placeable = containers.filter((c) => headerSpot(c.id, edges.map((o) => o.points)) !== undefined);
    const others = edges.filter((o) => o !== e);
    const otherPaths = others.map((o) => o.points);
    const related = new Set([...lineage(e.from), ...lineage(e.to)]);
    // 同じ要素の辺に付いている別の線の端
    const ends = others.flatMap((o) => [
      ...(o.from === e.from || o.from === e.to ? [o.points[0]] : []),
      ...(o.to === e.from || o.to === e.to ? [o.points[o.points.length - 1]] : []),
    ]);

    const clear = (points: Point[]): boolean => {
      const first = points[0];
      const last = points[points.length - 1];
      if (e.dir !== 'none' && run(points[points.length - 2], last) < ARROW_RUN) return false;
      if (e.dir === 'both' && run(first, points[1]) < ARROW_RUN) return false;
      if (ends.some((p) => run(p, first) < PORT_GAP || run(p, last) < PORT_GAP)) return false;
      if (polylineHitsBox(points.slice(1), a) || polylineHitsBox(points.slice(0, -1), b)) return false;
      if (leaves.some((n) => n.id !== e.from && n.id !== e.to && polylineHitsBox(points, grow(n.box, CLEAR)))) return false;
      for (const c of containers) {
        // 両端の要素を含まない枠には入らない。含む枠でも、辺に沿っては走らない
        if (!related.has(c.id)) {
          if (polylineHitsBox(points, grow(c.box, CLEAR))) return false;
          continue;
        }
        if (c.id === e.from || c.id === e.to) continue;
        const along = segmentsOf(points).some(([p, q]) =>
          flat(p.x, q.x)
            ? (Math.abs(p.x - c.box.x) < BORDER_GAP || Math.abs(p.x - c.box.x - c.box.w) < BORDER_GAP) && Math.max(p.y, q.y) > c.box.y && Math.min(p.y, q.y) < c.box.y + c.box.h
            : (Math.abs(p.y - c.box.y) < BORDER_GAP || Math.abs(p.y - c.box.y - c.box.h) < BORDER_GAP) && Math.max(p.x, q.x) > c.box.x && Math.min(p.x, q.x) < c.box.x + c.box.w,
        );
        if (along) return false;
      }
      return !runsAlong(points, otherPaths);
    };

    /** 近道 points に置き換えたときの、ラベルの新しい位置（e 自身と、横切られる別の線の分）。置けなければ undefined */
    const relabel = (points: Point[], headers: Box[]): Map<LaidEdge, Box> | undefined => {
      const moved = new Map<LaidEdge, Box>();
      const paths = [...otherPaths, points];
      const fixed = [...leaves.map((n) => grow(n.box, 4)), ...headers.map((h) => inflate(h, HEADER_CLEARANCE))];
      const hit = others.filter((o) => o.label && polylineHitsBox(points, grow(o.label.box, 4)));
      for (const o of [...hit, e]) {
        if (!o.label) continue;
        // 避けるのは、置き直し済みのラベルと、動かさないラベル（置き直し待ちと e 自身の元の位置は空く）
        const labels = edges.flatMap((x) => {
          const box = moved.get(x) ?? (x === o || x === e || hit.includes(x) ? undefined : x.label?.box);
          return box ? [grow(box, 2)] : [];
        });
        const spot = labelSpot(o === e ? points : o.points, o.label.box, {
          boxes: [...fixed, ...labels],
          paths: paths.filter((p) => p !== (o === e ? points : o.points)),
          containers: containers.map((c) => c.box),
        });
        if (!spot) return undefined;
        moved.set(o, spot);
      }
      return moved;
    };

    const before = crossings(e.points, otherPaths);
    let best: { points: Point[]; labels: Map<LaidEdge, Box> } | undefined;
    for (const points of candidates(a, b)) {
      if (cost(points) >= GAIN * cost(e.points) || (best && cost(points) >= cost(best.points))) continue;
      if (!clear(points) || crossings(points, otherPaths) > before) continue;
      // 今は見出しを置ける枠は、置き換えた後も置けること
      const spots = placeable.map((c) => headerSpot(c.id, [...otherPaths, points]));
      if (spots.some((s) => s === undefined)) continue;
      const labels = relabel(points, spots.flatMap((s) => (s ? [s] : [])));
      if (!labels) continue;
      best = { points, labels };
    }
    if (!best) return false;
    e.points = best.points;
    for (const [o, box] of best.labels) if (o.label) o.label = { ...o.label, box };
    return true;
  };

  // 1 本を近道にすると、別の線の近道が空くことがある。変わらなくなるまで（最大 3 回）繰り返す
  for (let round = 0; round < 3; round++) {
    const order = edges.filter((e) => e.cls !== 'note').sort((p, q) => cost(q.points) - cost(p.points));
    let changed = false;
    for (const e of order) if (improve(e)) changed = true;
    if (!changed) break;
  }
}
