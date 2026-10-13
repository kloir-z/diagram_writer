// レイアウト結果の機械チェック。AI が画像を見る前に、直すべき箇所を文章で示す。
import { HEADER_CLEARANCE, inflate, intersects, polylineHitsBox } from './geometry.ts';
import type { Layout } from './types.ts';

/** 矢じり（約 10px）の手前に必要な直線の長さ */
const MIN_ARROW_RUN = 20;
/** 平行に走る別々の線に必要な間隔 */
const MIN_PARALLEL_GAP = 6;

export interface LintResult {
  findings: string[];
  summary: string;
}

export function lintLayout(layout: Layout): LintResult {
  const findings: string[] = [];
  const leaves = layout.nodes.filter((n) => !n.container);
  const containers = layout.nodes.filter((n) => n.container);
  const name = (e: { from: string; to: string }): string => `${e.from}→${e.to}`;

  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      if (intersects(leaves[i].box, leaves[j].box)) findings.push(`重なり: ${leaves[i].id} と ${leaves[j].id}`);
    }
  }

  const parentOf = new Map(layout.nodes.map((n) => [n.id, n.parent]));
  const boxOf = new Map(layout.nodes.map((n) => [n.id, n.box]));
  const lineage = (id: string): Set<string> => {
    const out = new Set<string>();
    for (let cur: string | null | undefined = id; cur; cur = parentOf.get(cur)) out.add(cur);
    return out;
  };
  for (const e of layout.edges) {
    if (e.problem) findings.push(`配線の問題: ${name(e)} は${e.problem}。grid の並びを変える、要素を減らす、または図を分ける`);
    for (const n of leaves) {
      if (n.id !== e.from && n.id !== e.to && polylineHitsBox(e.points, n.box)) findings.push(`線が要素を貫通: ${name(e)} が ${n.id} を通る`);
    }
    for (const c of containers) {
      if (c.header && polylineHitsBox(e.points, inflate(c.header.box, HEADER_CLEARANCE / 2))) findings.push(`線が枠の見出しを横切る: ${name(e)} が ${c.id} の見出しを通る`);
    }
    if (e.cls !== 'note') {
      // 両端を含まない枠の中を通る線は、その枠の中の何かとつながっているように見える
      const related = new Set([...lineage(e.from), ...lineage(e.to)]);
      for (const c of containers) {
        if (!related.has(c.id) && polylineHitsBox(e.points, c.box)) findings.push(`線が関係のない枠を通る: ${name(e)} が ${c.id} の中を通る`);
      }
      // 端の要素の中を通る線は、要素の辺ではなく中から出入りしているように見える
      for (const id of new Set([e.from, e.to])) {
        const b = boxOf.get(id);
        if (b && polylineHitsBox(e.points, b)) findings.push(`線が端の要素の中を通る: ${name(e)} が ${id} の中を通る`);
      }
    }
    // 矢じりの手前には、まっすぐ入ってくる区間が要る。曲がり角のすぐ先に矢じりがあると、人はそう描かない
    const n = e.points.length;
    const run = (a: number, b: number): number => Math.hypot(e.points[a].x - e.points[b].x, e.points[a].y - e.points[b].y);
    if (n > 2 && e.cls !== 'note') {
      if (e.dir !== 'none' && run(n - 2, n - 1) < MIN_ARROW_RUN) findings.push(`矢じりの直前で曲がる: ${name(e)}（最後の直線 ${Math.round(run(n - 2, n - 1))}px）`);
      if (e.dir === 'both' && run(0, 1) < MIN_ARROW_RUN) findings.push(`矢じりの直後で曲がる: ${name(e)}（最初の直線 ${Math.round(run(0, 1))}px）`);
    }
  }

  const ratio = layout.width / layout.height;
  if (ratio > 2.5) findings.push(`横長すぎる（幅:高さ = ${ratio.toFixed(1)}:1）。grid の行を増やして並べ直す、direction を down にする、または図を分ける`);
  if (ratio < 0.4) findings.push(`縦長すぎる（幅:高さ = 1:${(1 / ratio).toFixed(1)}）。grid で大きな区画を横に並べる、direction を right にする、または図を分ける`);

  const labels = layout.edges.filter((e) => e.label);
  for (const e of labels) {
    const box = e.label!.box;
    for (const n of leaves) {
      if (intersects(box, n.box)) findings.push(`線のラベルが要素に重なる: ${name(e)} のラベルと ${n.id}`);
    }
    for (const c of containers) {
      if (c.header && intersects(box, c.header.box)) findings.push(`線のラベルが枠の見出しに重なる: ${name(e)} のラベルと ${c.id}`);
    }
    // ラベルの白い背景が線を隠すと、線がそこで途切れて見え、どこへつながるのか読めない
    const covered = { x: box.x + 1, y: box.y + 1, w: box.w - 2, h: box.h - 2 };
    for (const o of layout.edges) {
      if (o.cls !== 'note' && polylineHitsBox(o.points, covered)) findings.push(`線のラベルが線を隠す: ${name(e)} のラベルが ${o === e ? '自分の線' : name(o)} に重なる`);
    }
  }
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      if (intersects(labels[i].label!.box, labels[j].label!.box)) {
        findings.push(`線のラベル同士が重なる: ${name(labels[i])} と ${name(labels[j])}`);
      }
    }
  }

  let crossings = 0;
  const segments = layout.edges.flatMap((e, idx) => e.points.slice(1).map((q, k) => ({ idx, p: e.points[k], q })));
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const s = segments[i];
      const t = segments[j];
      if (s.idx === t.idx) continue;
      const flat = (a: number, b: number): boolean => Math.abs(a - b) < 0.5;
      const [h, v] = flat(s.p.y, s.q.y) && flat(t.p.x, t.q.x) ? [s, t] : flat(t.p.y, t.q.y) && flat(s.p.x, s.q.x) ? [t, s] : [null, null];
      if (!h || !v) continue;
      const inside = (value: number, a: number, b: number): boolean => value > Math.min(a, b) && value < Math.max(a, b);
      if (inside(v.p.x, h.p.x, h.q.x) && inside(h.p.y, v.p.y, v.q.y)) crossings++;
    }
  }

  // 別々の線が同じ所を重なって走ると、どれがどこへ行くのか読めない
  const overlapping = new Set<string>();
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const s = segments[i];
      const t = segments[j];
      if (s.idx === t.idx || layout.edges[s.idx].cls === 'note' || layout.edges[t.idx].cls === 'note') continue;
      const horizontal = (u: typeof s): boolean => Math.abs(u.p.y - u.q.y) < 0.5;
      const vertical = (u: typeof s): boolean => Math.abs(u.p.x - u.q.x) < 0.5;
      const run = (a0: number, a1: number, b0: number, b1: number): number =>
        Math.min(Math.max(a0, a1), Math.max(b0, b1)) - Math.max(Math.min(a0, a1), Math.min(b0, b1));
      const shared =
        horizontal(s) && horizontal(t) && Math.abs(s.p.y - t.p.y) < MIN_PARALLEL_GAP ? run(s.p.x, s.q.x, t.p.x, t.q.x)
        : vertical(s) && vertical(t) && Math.abs(s.p.x - t.p.x) < MIN_PARALLEL_GAP ? run(s.p.y, s.q.y, t.p.y, t.q.y)
        : 0;
      if (shared > MIN_PARALLEL_GAP) overlapping.add(`線どうしが重なる: ${name(layout.edges[s.idx])} と ${name(layout.edges[t.idx])}`);
    }
  }
  findings.push(...overlapping);

  // 要素・補足・線のラベル・凡例が図の面積に占める割合（占有率）。向きや分け方を変えた案を比べる目安
  const ink =
    leaves.reduce((s, n) => s + n.box.w * n.box.h, 0) +
    labels.reduce((s, e) => s + e.label!.box.w * e.label!.box.h, 0) +
    (layout.legend ? layout.legend.box.w * layout.legend.box.h : 0);
  const fill = Math.round((ink / (layout.width * layout.height)) * 100);

  const summary =
    `${Math.round(layout.width)}×${Math.round(layout.height)} px / 占有率 ${fill}% / 要素 ${leaves.length} / 枠 ${containers.length} / ` +
    `線 ${layout.edges.length} / 線の交差 ${crossings} / 指摘 ${findings.length}`;
  return { findings: [...new Set(findings)], summary };
}
