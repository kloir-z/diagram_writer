// grid で並べた要素の間の線の経路探索（直交、障害物よけ）。
// 要素・関係のない枠・見出し・ラベルの辺の座標と、その間の通路の中心線から格子を作り、
// 「長さ ＋ 曲がり ＋ 交差」の重みが最小の経路を探す（A*。残りの長さの見積もりは相手の要素までの距離）。
// 出口と入口は要素の四辺のどこでもよい。入口の手前には矢じりのための直線を必ず取る。
// 先に引いた線と平行に重なって走る経路は取らない（間隔 PARALLEL_GAP 未満）。
//
// 格子の線分の重みは、障害物ごと・先に引いた線ごとに、当たる行・列の範囲だけを二分探索で求めて書き込む
// （線分ごとに全障害物を調べると、要素 40・線 60 の図で数十秒かかるため）。
//
// 通れる経路が無いときは、間隔を詰めて通す。それでも無理なら、両端をまっすぐ結んで「道が無い」と印を付ける。
// どちらも呼び出し側へ返し（RouteFailure）、呼び出し側は枠の余白を広げて組み直す。
import { grow, HEADER_CLEARANCE, inflate, INSET, segmentHitsBox, simplifyPolyline } from './geometry.ts';
import { labelSpot } from './shortcut.ts';
import { EDGE_THEME } from './theme.ts';
import type { Box, LaidEdge, LaidNode, Point } from './types.ts';

/** 要素・補足との間隔（ELK の枠の余白 14px の中も通れるように小さめ） */
const CLEAR = 10;
/** 通常の間隔で通れないとき、詰めて通す間隔 */
const TIGHT = 3;
/** 曲がり 1 回の重み（線の長さに換算） */
const BEND = 40;
/** 先に引いた線との交差 1 回の重み */
const CROSS = 120;
/** 平行に走る別の線との間隔 */
const PARALLEL_GAP = 10;
/** 隣り合う格子の座標の間がこれ以上あるときだけ、中ほどにも通路を足す */
const MID_MIN = 2 * PARALLEL_GAP + 4;
/** 先に引いた線の隣を通る通路の間隔 */
const LANE = 14;
/** 矢じりの手前の直線 */
const ARROW_RUN = 24;
/** 矢じりのない端の出口の直線 */
const STUB = 12;
/** 同じ辺に付く別の線の端との間隔 */
const PORT_GAP = 14;
/** 枠の辺に沿って走らないための間隔 */
const BORDER_GAP = 8;
/** 要素・枠の辺からこれより近くを沿って走る区間は、長さ × NEAR_COST だけ重くする */
const NEAR = 18;
const NEAR_COST = 0.5;
/** 枠の見出し（既定の位置）を横切る重み。見出しは後で線の右へずらせる（狭ければ枠を広げて組み直す）が、ずらさずに済む経路を好む */
const HEADER_COST = 150;
/** 図の外周の通路（中身の外側をこれだけ離れて回れる） */
const OUTER = 24;
const FRACTIONS = [0.5, 0.3, 0.7, 0.15, 0.85];
/** 辺の中ほどから出る線を好む重み（端に寄るほど重い） */
const PORT_BIAS = 40;
/** 太い矢印（移行など）のラベルと矢印の中心線の間（矢印の幅の半分より広く） */
const FAT_LABEL_GAP = 14;

/** 経路が取れなかった線と、その線の両端をともに含むいちばん内側の枠（無ければ null＝図全体） */
export interface RouteFailure {
  edge: string;
  frame: string | null;
}

/** 0：右、1：下、2：左、3：上 */
type Dir = 0 | 1 | 2 | 3;
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const DIRS: Dir[] = [0, 1, 2, 3];

interface Port {
  /** 要素の辺の上の点 */
  edge: Point;
  /** 辺から外へ出た点（格子の上） */
  out: Point;
  /** 外向き */
  dir: Dir;
  bias: number;
}

/** 探す厳しさ。上から順に試し、経路が取れたところで止める */
interface Level {
  /** 要素・関係のない枠との間隔 */
  clear: number;
  /** 両端を含む枠の辺との間隔 */
  borderGap: number;
  /** 先に引いた線・そのラベル・同じ辺の端との間隔を守る */
  respectOthers: boolean;
  /** 両端を含む枠の辺に沿って走らない */
  avoidAlong: boolean;
}

const LEVELS: Level[] = [
  { clear: CLEAR, borderGap: BORDER_GAP, respectOthers: true, avoidAlong: true },
  { clear: CLEAR, borderGap: BORDER_GAP, respectOthers: false, avoidAlong: true },
  { clear: TIGHT, borderGap: TIGHT, respectOthers: false, avoidAlong: false },
];

/** 要素 b の四辺の出入口。辺の決まった割合の位置と、xs・ys（相手にそろえた位置）のうち辺に収まるもの */
function ports(b: Box, length: number, xs: number[], ys: number[]): Port[] {
  const inside = (v: number, lo: number, size: number): boolean => v >= lo + PORT_GAP && v <= lo + size - PORT_GAP;
  const atX = [...FRACTIONS.map((f) => b.x + b.w * f), ...xs.filter((x) => inside(x, b.x, b.w))];
  const atY = [...FRACTIONS.map((f) => b.y + b.h * f), ...ys.filter((y) => inside(y, b.y, b.h))];
  const out: Port[] = [];
  for (const x of atX) {
    const bias = (Math.abs(x - b.x - b.w / 2) / b.w) * PORT_BIAS;
    out.push({ edge: { x, y: b.y + b.h }, out: { x, y: b.y + b.h + length }, dir: 1, bias });
    out.push({ edge: { x, y: b.y }, out: { x, y: b.y - length }, dir: 3, bias });
  }
  for (const y of atY) {
    const bias = (Math.abs(y - b.y - b.h / 2) / b.h) * PORT_BIAS;
    out.push({ edge: { x: b.x + b.w, y }, out: { x: b.x + b.w + length, y }, dir: 0, bias });
    out.push({ edge: { x: b.x, y }, out: { x: b.x - length, y }, dir: 2, bias });
  }
  return out;
}

/** 0.5px 未満の差をまとめて並べる */
function axis(values: number[]): number[] {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  return sorted.filter((v, i) => i === 0 || v - sorted[i - 1] >= 0.5);
}

/** 昇順の arr で、v より大きい最初の位置 */
function above(arr: number[], v: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] > v) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** 二分ヒープ（重みの小さい順）。要素ごとに配列を作らないよう、重みと状態を別々の型付き配列に持つ */
class Heap {
  private keys = new Float64Array(1024);
  private vals = new Int32Array(1024);
  size = 0;
  /** 直前に pop した重み */
  key = 0;
  push(key: number, val: number): void {
    if (this.size === this.keys.length) {
      const keys = new Float64Array(this.size * 2);
      const vals = new Int32Array(this.size * 2);
      keys.set(this.keys);
      vals.set(this.vals);
      this.keys = keys;
      this.vals = vals;
    }
    const { keys, vals } = this;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }
  /** いちばん軽い状態を取り出す（重みは this.key に入る） */
  pop(): number {
    const { keys, vals } = this;
    const top = vals[0];
    this.key = keys[0];
    const n = --this.size;
    if (n > 0) {
      const key = keys[n];
      const val = vals[n];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const c = l + 1 < n && keys[l + 1] < keys[l] ? l + 1 : l;
        if (keys[c] >= key) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = key;
      vals[i] = val;
    }
    return top;
  }
}

const flat = (a: number, b: number): boolean => Math.abs(a - b) < 0.5;

/** 格子と、隣り合う格子点を結ぶ短い線分の重み。h[j*nx+i]：(i,j)→(i+1,j)、v[j*nx+i]：(i,j)→(i,j+1) */
class CostGrid {
  readonly xs: number[];
  readonly ys: number[];
  readonly nx: number;
  readonly ny: number;
  readonly h: Float64Array;
  readonly v: Float64Array;

  constructor(xs: number[], ys: number[]) {
    this.xs = xs;
    this.ys = ys;
    this.nx = xs.length;
    this.ny = ys.length;
    this.h = new Float64Array(this.nx * this.ny);
    this.v = new Float64Array(this.nx * this.ny);
    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i < this.nx; i++) {
        this.h[j * this.nx + i] = i + 1 < this.nx ? xs[i + 1] - xs[i] : Infinity;
        this.v[j * this.nx + i] = j + 1 < this.ny ? ys[j + 1] - ys[j] : Infinity;
      }
    }
  }

  /** 横の線分のうち、高さが (y0, y1) の中で、(x0, x1) と重なるものに add を足す */
  addH(y0: number, y1: number, x0: number, x1: number, add: number): void {
    const { xs, ys, nx, ny, h } = this;
    const i0 = Math.max(0, above(xs, x0) - 1);
    for (let j = above(ys, y0); j < ny && ys[j] < y1; j++) {
      for (let i = i0; i < nx - 1 && xs[i] < x1; i++) h[j * nx + i] += add;
    }
  }

  /** 縦の線分のうち、位置が (x0, x1) の中で、(y0, y1) と重なるものに add を足す */
  addV(x0: number, x1: number, y0: number, y1: number, add: number): void {
    const { xs, ys, nx, ny, v } = this;
    const j0 = Math.max(0, above(ys, y0) - 1);
    for (let i = above(xs, x0); i < nx && xs[i] < x1; i++) {
      for (let j = j0; j < ny - 1 && ys[j] < y1; j++) v[j * nx + i] += add;
    }
  }

  /** 箱の内側（縁から INSET 内側。geometry.ts の segmentHitsBox と同じ判定）を通る線分に add を足す */
  addBox(b: Box, add: number): void {
    const x0 = b.x + INSET;
    const x1 = b.x + b.w - INSET;
    const y0 = b.y + INSET;
    const y1 = b.y + b.h - INSET;
    if (x1 <= x0 || y1 <= y0) return;
    this.addH(y0, y1, x0, x1, add);
    this.addV(x0, x1, y0, y1, add);
  }

  /** 箱の辺から near より近くを、辺に沿って走る線分に、沿う長さ × perLength を足す（Infinity なら通れなくする） */
  addAlong(b: Box, near: number, perLength: number): void {
    const { xs, ys, nx, ny, h, v } = this;
    const add = (overlap: number): number => (perLength === Infinity ? Infinity : overlap * perLength);
    const i0 = Math.max(0, above(xs, b.x) - 1);
    for (let j = above(ys, b.y - near); j < ny && ys[j] < b.y + b.h + near; j++) {
      if (!(Math.abs(ys[j] - b.y) < near || Math.abs(ys[j] - b.y - b.h) < near)) continue;
      for (let i = i0; i < nx - 1 && xs[i] < b.x + b.w; i++) {
        const overlap = Math.min(xs[i + 1], b.x + b.w) - Math.max(xs[i], b.x);
        if (overlap > 0) h[j * nx + i] += add(overlap);
      }
    }
    const j0 = Math.max(0, above(ys, b.y) - 1);
    for (let i = above(xs, b.x - near); i < nx && xs[i] < b.x + b.w + near; i++) {
      if (!(Math.abs(xs[i] - b.x) < near || Math.abs(xs[i] - b.x - b.w) < near)) continue;
      for (let j = j0; j < ny - 1 && ys[j] < b.y + b.h; j++) {
        const overlap = Math.min(ys[j + 1], b.y + b.h) - Math.max(ys[j], b.y);
        if (overlap > 0) v[j * nx + i] += add(overlap);
      }
    }
  }

  /**
   * 先に引いた線の線分 p–q：平行に PARALLEL_GAP 未満で重なる線分は通れなくし、直交して横切る線分に CROSS を足す。
   * 横切る位置がちょうど格子点のときは、その点から先の線分に数える（まっすぐ通り抜ける経路に 1 回だけ数えるため）
   */
  addOther(p: Point, q: Point): void {
    const { xs, ys, nx, ny, h, v } = this;
    if (flat(p.y, q.y)) {
      const lo = Math.min(p.x, q.x);
      const hi = Math.max(p.x, q.x);
      if (hi - lo < 0.5) return;
      this.addH(p.y - PARALLEL_GAP, p.y + PARALLEL_GAP, lo, hi, Infinity);
      const j = above(ys, p.y) - 1;
      if (j < 0 || j >= ny - 1) return;
      for (let i = above(xs, lo); i < nx && xs[i] < hi; i++) v[j * nx + i] += CROSS;
    } else {
      const lo = Math.min(p.y, q.y);
      const hi = Math.max(p.y, q.y);
      if (hi - lo < 0.5) return;
      this.addV(p.x - PARALLEL_GAP, p.x + PARALLEL_GAP, lo, hi, Infinity);
      const i = above(xs, p.x) - 1;
      if (i < 0 || i >= nx - 1) return;
      for (let j = above(ys, lo); j < ny && ys[j] < hi; j++) h[j * nx + i] += CROSS;
    }
  }
}

/**
 * pending の線（points が空）の経路とラベルの位置を決める（edges を書き換える）。
 * それ以外の線（ELK が引いた線・補足の点線）は動かさず、避ける相手にする。
 * headers は枠の見出しの位置、extra はタイトルなど線が通ってはいけない箱。
 * 通常の間隔で経路が取れなかった線を返す（間隔を詰めて通した線・道が無かった線には problem を付ける）。
 */
export function routeEdges(nodes: LaidNode[], edges: LaidEdge[], pending: Set<string>, headers: Box[], extra: Box[]): RouteFailure[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const leaves = nodes.filter((n) => !n.container);
  const containers = nodes.filter((n) => n.container);
  const lineage = (id: string): string[] => {
    const out: string[] = [];
    for (let n = byId.get(id); n; n = n.parent === null ? undefined : byId.get(n.parent)) out.push(n.id);
    return out;
  };
  const all = nodes.map((n) => n.box);
  const bounds = {
    x0: Math.min(...all.map((b) => b.x)) - OUTER,
    y0: Math.min(...all.map((b) => b.y)) - OUTER,
    x1: Math.max(...all.map((b) => b.x + b.w)) + OUTER,
    y1: Math.max(...all.map((b) => b.y + b.h)) + OUTER,
  };
  const center = (b: Box): Point => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  const headerBoxes = headers.map((h) => inflate(h, HEADER_CLEARANCE));
  const failures: RouteFailure[] = [];
  // 近い線から引く（近い線はまっすぐ引けることが多く、遠い線はその脇を回る）
  const order = edges
    .filter((e) => pending.has(e.id))
    .sort((p, q) => {
      const d = (e: LaidEdge): number => {
        const a = byId.get(e.from);
        const b = byId.get(e.to);
        if (!a || !b) return 0;
        return Math.abs(center(a.box).x - center(b.box).x) + Math.abs(center(a.box).y - center(b.box).y);
      };
      return d(p) - d(q);
    });

  for (const e of order) {
    const a = byId.get(e.from)?.box;
    const b = byId.get(e.to)?.box;
    if (!a || !b) continue;
    const drawn = edges.filter((o) => o !== e && o.points.length >= 2);
    const fromLine = lineage(e.from);
    const toLine = lineage(e.to);
    const related = new Set([...fromLine, ...toLine]);
    // 両端をともに含む枠（内側から順）。その外には出ない（同じ区画の中の線が、区画の外を回らない）
    const shared = fromLine.filter((id) => id !== e.from && id !== e.to && toLine.includes(id));
    const ends = drawn.flatMap((o) => [
      ...(o.from === e.from || o.from === e.to ? [o.points[0]] : []),
      ...(o.to === e.from || o.to === e.to ? [o.points[o.points.length - 1]] : []),
    ]);
    // 避けるラベルは、ELK が置いたもの（経路探索で引く線のラベルは、線を全部引いてから置く）
    const labelBoxes = drawn.flatMap((o) => (o.label && !pending.has(o.id) ? [grow(o.label.box, 4)] : []));

    const route = (level: Level): Point[] | undefined => {
      // 両端の要素にも、出入口の短い直線のほかは近づかない（要素の辺に沿って走らない）
      const aZone = grow(a, level.clear);
      const bZone = grow(b, level.clear);
      const hard = [
        ...leaves.filter((n) => n.id !== e.from && n.id !== e.to).map((n) => grow(n.box, level.clear)),
        ...containers.filter((c) => !related.has(c.id)).map((c) => grow(c.box, level.clear)),
        ...extra,
        ...(level.respectOthers ? labelBoxes : []),
      ];
      const startLength = e.dir === 'both' ? ARROW_RUN : STUB;
      const endLength = e.dir === 'none' ? STUB : ARROW_RUN;
      const free = (p: Point): boolean => !level.respectOthers || !ends.some((q) => Math.abs(p.x - q.x) + Math.abs(p.y - q.y) < PORT_GAP);
      const stubOk = (p: Port): boolean => free(p.edge) && !hard.some((h) => segmentHitsBox(p.edge, p.out, h));
      // 相手の辺の位置にそろえた出入口も足す（向かい合う要素どうしを、段差なくまっすぐ結べるように）。
      // 向かい合う範囲の中ほどと、そこから通路の間隔ずつずらした位置も足す（同じ 2 つの間に線が何本かあっても、まっすぐ並べられる）
      const facing = (lo0: number, hi0: number, lo1: number, hi1: number): number[] => {
        const lo = Math.max(lo0, lo1);
        const hi = Math.min(hi0, hi1);
        if (hi - lo < 2 * PORT_GAP) return [];
        const c = (lo + hi) / 2;
        return [c, c - LANE, c + LANE, c - 2 * LANE, c + 2 * LANE];
      };
      const alongX = [...FRACTIONS.map((f) => b.x + b.w * f), ...FRACTIONS.map((f) => a.x + a.w * f), ...facing(a.x, a.x + a.w, b.x, b.x + b.w)];
      const alongY = [...FRACTIONS.map((f) => b.y + b.h * f), ...FRACTIONS.map((f) => a.y + a.h * f), ...facing(a.y, a.y + a.h, b.y, b.y + b.h)];
      const starts = ports(a, startLength, alongX, alongY).filter(stubOk);
      const goals = ports(b, endLength, alongX, alongY).filter(stubOk);
      if (starts.length === 0 || goals.length === 0) return undefined;

      // 通ってよい範囲：図の外周まで。両端を含む枠があれば、いちばん内側の枠の辺から borderGap 内側まで
      let x0 = bounds.x0;
      let y0 = bounds.y0;
      let x1 = bounds.x1;
      let y1 = bounds.y1;
      for (const id of shared) {
        const c = byId.get(id)?.box;
        if (!c) continue;
        x0 = Math.max(x0, c.x + level.borderGap);
        y0 = Math.max(y0, c.y + level.borderGap);
        x1 = Math.min(x1, c.x + c.w - level.borderGap);
        y1 = Math.min(y1, c.y + c.h - level.borderGap);
      }

      // 格子の座標：障害物の辺、ポート、先に引いた線の隣の通路、範囲の端。隣り合う座標の間（通路の中心）も足す
      const xsRaw = [x0, x1, ...[...starts, ...goals].flatMap((p) => [p.edge.x, p.out.x])];
      const ysRaw = [y0, y1, ...[...starts, ...goals].flatMap((p) => [p.edge.y, p.out.y])];
      for (const h of [...hard, aZone, bZone]) {
        xsRaw.push(h.x, h.x + h.w);
        ysRaw.push(h.y, h.y + h.h);
      }
      if (level.respectOthers) {
        for (const o of drawn) {
          for (let k = 1; k < o.points.length; k++) {
            const p = o.points[k - 1];
            const q = o.points[k];
            if (flat(p.x, q.x)) xsRaw.push(p.x - LANE, p.x + LANE);
            else ysRaw.push(p.y - LANE, p.y + LANE);
          }
        }
      }
      // 隣り合う座標の間が広いときだけ、その中ほどにも通路を足す（狭い間の中ほどは使い道が無く、格子が大きくなるだけ）
      const withMid = (v: number[], lo: number, hi: number): number[] => {
        const s = axis(v.filter((x) => x >= lo && x <= hi));
        return axis([...s, ...s.slice(1).flatMap((x, i) => (x - s[i] >= MID_MIN ? [(x + s[i]) / 2] : []))]);
      };
      const xs = withMid(xsRaw, x0, x1);
      const ys = withMid(ysRaw, y0, y1);
      const grid = new CostGrid(xs, ys);
      for (const h of [...hard, aZone, bZone]) grid.addBox(h, Infinity);
      if (level.avoidAlong) {
        for (const c of containers) if (related.has(c.id) && c.id !== e.from && c.id !== e.to) grid.addAlong(c.box, BORDER_GAP, Infinity);
      }
      if (level.respectOthers) {
        for (const o of drawn) for (let k = 1; k < o.points.length; k++) grid.addOther(o.points[k - 1], o.points[k]);
      }
      // 要素や枠の辺のすぐ脇を沿って走る区間は少し重くする（通路の中ほどを通る経路を選ぶ）
      for (const n of nodes) if (n.id !== e.from && n.id !== e.to) grid.addAlong(n.box, NEAR, NEAR_COST);
      // 見出しは横切られても右へずらせるので、通れなくはしないが重くする
      for (const h of headerBoxes) grid.addBox(h, HEADER_COST);

      const { nx, ny } = grid;
      const xi = new Map(xs.map((x, i) => [x, i]));
      const yi = new Map(ys.map((y, i) => [y, i]));
      const indexOf = (p: Point): number | undefined => {
        const i = xi.get(p.x) ?? xs.findIndex((x) => flat(x, p.x));
        const j = yi.get(p.y) ?? ys.findIndex((y) => flat(y, p.y));
        return i < 0 || j < 0 ? undefined : j * nx + i;
      };
      // 残りの重みの見積もり：相手の要素までの距離（どの経路もそれより短くはならない）
      const remaining = (cell: number): number => {
        const x = xs[cell % nx];
        const y = ys[(cell / nx) | 0];
        return Math.max(b.x - x, 0, x - b.x - b.w) + Math.max(b.y - y, 0, y - b.y - b.h);
      };

      // 状態 = 格子点 × 向き。入口の外の点に着いたら、入口へまっすぐ入る（向きが違えば 1 回曲がる）
      const states = nx * ny * 4;
      const dist = new Float64Array(states).fill(Infinity);
      const prev = new Int32Array(states).fill(-1);
      const heap = new Heap();
      const startOf = new Map<number, Port>();
      for (const s of starts) {
        const cell = indexOf(s.out);
        if (cell === undefined) continue;
        const state = cell * 4 + s.dir;
        const cost = startLength + s.bias;
        if (cost < dist[state]) {
          dist[state] = cost;
          startOf.set(state, s);
          heap.push(cost + remaining(cell), state);
        }
      }
      const goalAt = new Map<number, Port[]>();
      const isGoal = new Uint8Array(nx * ny);
      for (const g of goals) {
        const cell = indexOf(g.out);
        if (cell === undefined) continue;
        goalAt.set(cell, [...(goalAt.get(cell) ?? []), g]);
        isGoal[cell] = 1;
      }
      const { h: hCost, v: vCost } = grid;
      let best: { cost: number; state: number; goal: Port } | undefined;
      while (heap.size > 0) {
        const state = heap.pop();
        const f = heap.key;
        const cell = state >> 2;
        const cost = dist[state];
        if (f > cost + remaining(cell) + 1e-6) continue;
        if (best && f >= best.cost) break;
        const d = state & 3;
        if (isGoal[cell]) {
          for (const g of goalAt.get(cell) ?? []) {
            if (d === g.dir) continue;
            const total = cost + endLength + g.bias + (d === (g.dir + 2) % 4 ? 0 : BEND);
            if (!best || total < best.cost) best = { cost: total, state, goal: g };
          }
        }
        const i = cell % nx;
        const j = (cell - i) / nx;
        for (const nd of DIRS) {
          if (nd === (d + 2) % 4) continue;
          const ni = i + DX[nd];
          const nj = j + DY[nd];
          if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
          const move = nd === 0 ? hCost[cell] : nd === 2 ? hCost[cell - 1] : nd === 1 ? vCost[cell] : vCost[cell - nx];
          if (move === Infinity) continue;
          const nextCell = nj * nx + ni;
          const next = nextCell * 4 + nd;
          const nc = cost + move + (nd === d ? 0 : BEND);
          if (nc < dist[next]) {
            dist[next] = nc;
            prev[next] = state;
            heap.push(nc + remaining(nextCell), next);
          }
        }
      }
      if (!best) return undefined;
      const cells: Point[] = [];
      let s = best.state;
      let first = s;
      while (s >= 0) {
        const cell = s >> 2;
        cells.unshift({ x: xs[cell % nx], y: ys[Math.floor(cell / nx)] });
        first = s;
        s = prev[s];
      }
      const start = startOf.get(first);
      if (!start) return undefined;
      return simplifyPolyline([start.edge, ...cells, best.goal.edge]);
    };

    let points = route(LEVELS[0]) ?? route(LEVELS[1]);
    if (!points) {
      failures.push({ edge: e.id, frame: shared[0] ?? null });
      points = route(LEVELS[2]);
      if (points) e.problem = '間隔が狭い';
    }
    if (!points) {
      // 道が無い（要素に囲まれている）。両端をまっすぐ結んで印を付け、機械チェックで指摘する
      const p = center(a);
      const q = center(b);
      points = [{ x: p.x, y: a.y + a.h }, { x: p.x, y: q.y }, { x: b.x, y: q.y }];
      e.problem = '経路が無い';
    }
    e.points = points;
  }

  // ラベルは、全部の線を引いてから置く（先に置いたラベルが、後から引く線の通り道をふさがないように）
  const placed = new Set<string>();
  for (const e of order) {
    if (!e.label) continue;
    const others = edges.filter((o) => o !== e && o.points.length >= 2);
    const spot = labelSpot(e.points, e.label.box, {
      boxes: [
        ...leaves.map((n) => grow(n.box, 4)),
        ...headerBoxes,
        ...extra,
        ...others.flatMap((o) => (o.label && (!pending.has(o.id) || placed.has(o.id)) ? [grow(o.label.box, 2)] : [])),
      ],
      paths: others.map((o) => o.points),
      containers: containers.map((c) => c.box),
    }, EDGE_THEME[e.cls].fat ? FAT_LABEL_GAP : undefined);
    // 置き場が無ければ、いちばん長い線分の脇に置く（機械チェックがかぶりとして指摘する）
    const [p, q] = e.points.slice(1).map((q2, k) => [e.points[k], q2] as const).sort(([a1, b1], [a2, b2]) => Math.abs(b2.x - a2.x) + Math.abs(b2.y - a2.y) - Math.abs(b1.x - a1.x) - Math.abs(b1.y - a1.y))[0];
    e.label = { ...e.label, box: spot ?? { ...e.label.box, x: (p.x + q.x) / 2 + 6, y: (p.y + q.y) / 2 - e.label.box.h / 2 } };
    placed.add(e.id);
  }
  return failures;
}
