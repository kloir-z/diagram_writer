// 図の記述 → ELK（layered・直交配線・入れ子をまとめて配置）→ 絶対座標の幾何情報。
// 文字はすべて実測した幅で枠を作るので、はみ出しは起きない前提で組む。
//
// 流れは 3 段：
//   1. 部品の用意（文字の実測、ELK のノード・線・補足ラベル）
//   2. 配置。flow：全体を 1 回の ELK で組む。grid：マスに置いた要素ごとに組み、記述の grid のとおりに並べる
//      （別々のマスにまたがる線は、位置が決まった後で経路探索で引く）
//   3. 仕上げ（座標の確定、補足の点線、大回りの線の近道、枠の見出し、凡例）
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api.js';
import type { FontMetrics } from './font.ts';
import { grow, HEADER_CLEARANCE, inflate, intersects, polylineHitsBox } from './geometry.ts';
import { type Area, gridAreas } from './grid.ts';
import { routeEdges } from './route.ts';
import { shortenEdges } from './shortcut.ts';
import { EDGE_THEME, isContainerKind, LEAF_SWATCH, LINE_HEIGHT, stepMark, TEXT, ZONE_NAME } from './theme.ts';
import type {
  Box, ContainerKind, DiagramSpec, EdgeClass, LaidEdge, LaidNode, Layout, LeafKind, LegendItem, NodeSpec, Point, TextLine,
} from './types.ts';

export interface Fonts {
  regular: FontMetrics;
  bold: FontMetrics;
  mono: FontMetrics;
}

const LEAF_PAD_X = 14;
const LEAF_PAD_Y = 10;
const LEAF_MIN_W = 120;
const LEAF_MIN_H = 44;
/** 補足と対象のすき間 */
const NOTE_GAP = 16;
const CONTAINER_PAD = 14;
const CONTAINER_HEADER_GAP = 8;
const EDGE_LABEL_PAD = 6;
const MARGIN = 30;
const LEGEND_GAP = 40;
/** 足りなかった所を広げて組み直す回数の上限 */
const RELAYOUT_PASSES = 4;
/** タイトルと本文の間 */
const TITLE_GAP = 20;
/** 図の縦横比の目安（横長の資料 16:9） */
const TARGET_RATIO = 16 / 9;
/** grid のマスの間の通路の最小幅 */
const GRID_GAP = 40;
/** 通路を横切る線のラベルの左右に空ける幅 */
const GRID_LABEL_PAD = 16;
/** 通路で、線と線の間隔 */
const LANE = 14;
/** 枠をマスいっぱいに広げるのは、元の大きさがマスのこの割合以上のときだけ（中身の少ない枠を空白で膨らませない） */
const STRETCH_MIN = 0.75;
/**
 * 間隔の設定。elkjs は親の設定を入れ子の枠に引き継がないので、根とすべての枠に同じものを渡す。
 * 渡さないと枠の中は既定値（線と要素の間 10px）になり、矢じりの直前で曲がる線ができる。
 * 値は「一目で見える範囲を広く」を優先して詰めてある。線と要素の間（edgeNodeBetweenLayers）は
 * 矢じりの手前の直線の長さになるので、機械チェックの下限（20px）より小さくしない。
 */
const SPACING: Record<string, string> = {
  'elk.spacing.nodeNode': '24',
  'elk.layered.spacing.nodeNodeBetweenLayers': '36',
  'elk.spacing.edgeNode': '24',
  'elk.layered.spacing.edgeNodeBetweenLayers': '22',
  'elk.spacing.edgeEdge': '14',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '14',
  'elk.spacing.edgeLabel': '6',
  'elk.edgeLabels.placement': 'CENTER',
  'elk.layered.edgeLabels.sideSelection': 'SMART_DOWN',
  'elk.spacing.labelNode': String(NOTE_GAP),
};
/** 枠の見出しの位置（draw.io の spacingLeft/Right・spacingTop と合わせる） */
export const HEADER_INSET_X = 14;
export const HEADER_INSET_Y = 8;
/** 凡例の寸法（drawio 出力と共有） */
export const LEGEND = { rowH: 24, sampleW: 44, pad: 14, headerH: 26, title: '凡例' } as const;

type Style = { size: number; bold: boolean; color: string };

const toLines = (value: string | string[] | undefined): string[] =>
  value === undefined ? [] : (typeof value === 'string' ? [value] : value).flatMap((v) => v.split('\n'));

function line(text: string, style: Style, font: 'p' | 'm' = 'p'): TextLine {
  return { text, font, size: style.size, bold: style.bold, color: style.color };
}

export function measure(lines: TextLine[], fonts: Fonts): { w: number; h: number } {
  let w = 0;
  let h = 0;
  for (const l of lines) {
    const metrics = l.font === 'm' ? fonts.mono : l.bold ? fonts.bold : fonts.regular;
    w = Math.max(w, metrics.width(l.text, l.size));
    h += l.size * LINE_HEIGHT;
  }
  return { w: Math.ceil(w), h: Math.ceil(h) };
}

function nodeLines(spec: NodeSpec, container: boolean): TextLine[] {
  const labelStyle = container ? (spec.kind === 'site' ? TEXT.siteHeader : TEXT.header) : TEXT.label;
  return [
    ...toLines(spec.label).map((t) => line(t, labelStyle)),
    ...toLines(spec.sub).map((t) => line(t, TEXT.sub)),
    ...toLines(spec.specs).map((t) => line(t, TEXT.spec, 'm')),
  ];
}

function rootOptions(direction: 'RIGHT' | 'DOWN'): Record<string, string> {
  return {
    'elk.algorithm': 'layered',
    'elk.direction': direction,
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.json.shapeCoords': 'ROOT',
    'elk.json.edgeCoords': 'ROOT',
    'elk.partitioning.activate': 'true',
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    ...SPACING,
  };
}

// elkjs は CommonJS。module.exports にも .default にも同じコンストラクタがあり、型は .default 側にだけ付いている
const runElk = (graph: ElkNode): Promise<ElkNode> => new ELK.default().layout(graph);

interface Info {
  spec: NodeSpec | null;
  parent: string | null;
  kind: LeafKind | ContainerKind | 'note';
  container: boolean;
  lines: TextLine[];
  text: { w: number; h: number };
}

interface EdgeMeta {
  cls: EdgeClass;
  dir: 'forward' | 'both' | 'none';
  emphasis: boolean;
  lines: TextLine[];
  from: string;
  to: string;
}

interface EdgeGeometry {
  points: Point[];
  label?: Box;
}

/** 配置の結果（図の枠内の座標。タイトルの分はまだずらしていない） */
interface Placement {
  width: number;
  height: number;
  /** ELK の結果の木と、その木の座標に足すずれ */
  trees: { node: ElkNode; dx: number; dy: number }[];
  edges: Map<string, EdgeGeometry>;
  /** grid で中を並べた枠の箱（ELK の木の外にある） */
  frames: { id: string; box: Box }[];
  /** 別々のマスにまたがり、配置の後で経路探索で引く線の id */
  pending: string[];
}

/**
 * 組んだ結果を見て、足りなかった所を広げて組み直す（変わらなくなるまで、最大 RELAYOUT_PASSES 回）。
 * - 見出しの置き場が無かった枠は、幅を広げる（線が枠の上辺から入ってくると、狭い枠では見出しを避けられないため）
 * - grid の枠の中で線を通す隙間が無かったら、その枠の余白を広げる（通路の分を、配置の側で空ける）
 * 広げると線の経路も変わり、別の枠で足りなくなることがあるので繰り返す。
 */
export async function layoutDiagram(spec: DiagramSpec, fonts: Fonts): Promise<Layout> {
  const room: Room = { widen: new Map(), corridor: new Map() };
  let result = await layoutOnce(spec, fonts, room);
  for (let pass = 0; pass < RELAYOUT_PASSES; pass++) {
    let changed = false;
    for (const [id, w] of result.crowded) {
      if (w <= (room.widen.get(id) ?? 0)) continue;
      room.widen.set(id, w);
      changed = true;
    }
    for (const [id, n] of result.cramped) {
      room.corridor.set(id, (room.corridor.get(id) ?? 0) + n * LANE);
      changed = true;
    }
    if (!changed) break;
    result = await layoutOnce(spec, fonts, room);
  }
  return result.layout;
}

/** 組み直すときに、枠に足す大きさ */
interface Room {
  /** 見出しのための枠の幅（最小値） */
  widen: Map<string, number>;
  /** 線を通すために grid の枠の余白に足す幅 */
  corridor: Map<string, number>;
}

async function layoutOnce(
  spec: DiagramSpec,
  fonts: Fonts,
  room: Room,
): Promise<{ layout: Layout; crowded: Map<string, number>; cramped: Map<string, number> }> {
  const { widen } = room;
  // 1. 部品の用意
  const info = new Map<string, Info>();
  const parentOf = new Map<string, string | null>();
  const elkNodes = new Map<string, ElkNode>();
  const direction = spec.direction === 'down' ? 'DOWN' : 'RIGHT';

  const build = (n: NodeSpec, parent: string | null): ElkNode => {
    const container = (n.children ?? []).length > 0;
    const kind: LeafKind | ContainerKind = container
      ? n.kind !== undefined && isContainerKind(n.kind) ? n.kind : 'host'
      : n.kind !== undefined && !isContainerKind(n.kind) ? n.kind : 'other';
    const lines = nodeLines(n, container);
    const size = measure(lines, fonts);
    info.set(n.id, { spec: n, parent, kind, container, lines, text: size });
    parentOf.set(n.id, parent);
    const layoutOptions: Record<string, string> = {};
    if (n.layer !== undefined) layoutOptions['elk.partitioning.partition'] = String(n.layer);
    if (!container) {
      const node: ElkNode = {
        id: n.id,
        width: Math.max(LEAF_MIN_W, size.w + LEAF_PAD_X * 2),
        height: Math.max(LEAF_MIN_H, size.h + LEAF_PAD_Y * 2),
        layoutOptions,
      };
      elkNodes.set(n.id, node);
      return node;
    }
    const top = size.h + CONTAINER_HEADER_GAP + 8;
    layoutOptions['elk.padding'] = `[top=${top},left=${CONTAINER_PAD},bottom=${CONTAINER_PAD},right=${CONTAINER_PAD}]`;
    layoutOptions['elk.nodeSize.constraints'] = 'MINIMUM_SIZE';
    const minWidth = Math.max(size.w + CONTAINER_PAD * 2 + 8, widen.get(n.id) ?? 0);
    const minHeight = top + 40;
    // INCLUDE_CHILDREN + DOWN のとき、elkjs は nodeSize.minimum の幅と高さを入れ替えて扱う（実測で確認）
    layoutOptions['elk.nodeSize.minimum'] = direction === 'DOWN' ? `(${minHeight},${minWidth})` : `(${minWidth},${minHeight})`;
    if (widen.has(n.id)) layoutOptions['elk.contentAlignment'] = 'V_TOP H_LEFT';
    const node: ElkNode = { id: n.id, layoutOptions: { ...SPACING, ...layoutOptions }, children: (n.children ?? []).map((c) => build(c, n.id)) };
    elkNodes.set(n.id, node);
    return node;
  };
  const roots = spec.nodes.map((n) => build(n, null));

  // 内部で作る要素（補足・線）の id には、記述の id に使えない「:」を入れる。記述の id とは決して重ならない
  const used = new Map<string, number>();
  const uniqueId = (base: string): string => {
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}:${n}`;
  };

  // 補足は対象の横（流れと直交する側）に、対象の外側のラベルとして置く。
  // ELK がその分の場所を空けるので、対象へ入る線の通り道をふさがない（上流に置くと線が補足を避けて回り込む）
  const notePlacement = direction === 'DOWN' ? 'OUTSIDE V_CENTER H_RIGHT' : 'OUTSIDE V_BOTTOM H_CENTER';
  const noteTarget = new Map<string, string>();
  (spec.notes ?? []).forEach((note) => {
    const id = uniqueId(`note:${note.to}`);
    const target = elkNodes.get(note.to);
    if (!target) throw new Error(`補足の対象が見つからない: ${note.to}`);
    const lines = toLines(note.text).map((t) => line(t, TEXT.note));
    const size = measure(lines, fonts);
    info.set(id, { spec: null, parent: parentOf.get(note.to) ?? null, kind: 'note', container: false, lines, text: size });
    noteTarget.set(id, note.to);
    // 置き場所は親の枠の elk.spacing.labelNode（SPACING）で決まる。text が空のラベルは ELK に無視されるので、本文を入れる
    target.layoutOptions = { ...target.layoutOptions, 'elk.nodeLabels.placement': notePlacement };
    target.labels = [...(target.labels ?? []), { id, text: note.text, width: size.w + 24, height: size.h + 16 }];
  });

  const edgeMeta = new Map<string, EdgeMeta>();
  // 往復の線（A→B と B→A）の戻りは、ELK には行きと同じ向きで渡す。逆向きのまま渡すと、
  // 入れ子をまたぐ戻りの線が図の外周を大回りする。経路は後で反転して向きを戻す
  const pairFrom = new Map<string, string>();
  const reversed = new Set<string>();
  const edges: ElkExtendedEdge[] = (spec.edges ?? []).map((e) => {
    const id = uniqueId(`edge:${e.from}:${e.to}`);
    const text = [e.step !== undefined ? stepMark(e.step) : '', e.label ?? ''].filter(Boolean).join(' ');
    const lines = text === '' ? [] : text.split('\n').map((t) => line(t, e.emphasis ? { ...TEXT.edge, bold: true } : TEXT.edge));
    edgeMeta.set(id, { cls: e.class ?? 'user', dir: e.dir ?? 'forward', emphasis: e.emphasis ?? false, lines, from: e.from, to: e.to });
    const size = measure(lines, fonts);
    const pair = [e.from, e.to].sort().join('\n');
    const back = (pairFrom.get(pair) ?? e.from) !== e.from;
    if (!pairFrom.has(pair)) pairFrom.set(pair, e.from);
    if (back) reversed.add(id);
    return {
      id,
      sources: [back ? e.to : e.from],
      targets: [back ? e.from : e.to],
      labels: lines.length === 0 ? [] : [{ id: `${id}:label`, text, width: size.w + EDGE_LABEL_PAD * 2, height: size.h + 4 }],
      // 太い矢印は幅があるので、ラベルを矢印の中心線から離す
      ...(EDGE_THEME[e.class ?? 'user'].fat ? { layoutOptions: { 'elk.spacing.edgeLabel': '14' } } : {}),
    };
  });

  // 2. 配置
  const placement = spec.grid
    ? await placeGrid({ spec, elkNodes, info, parentOf, direction, room }, edges)
    : await placeFlow(roots, edges, direction);

  // 3. 仕上げ：タイトルの下へずらして絶対座標にする
  const titleLines = [line(spec.title, TEXT.title), ...toLines(spec.subtitle).map((t) => line(t, TEXT.subtitle))];
  const titleSize = measure(titleLines, fonts);
  const ox = MARGIN;
  const oy = MARGIN + titleSize.h + TITLE_GAP;

  const nodes: LaidNode[] = [];
  const notes: LaidNode[] = [];
  const walk = (n: ElkNode, dx: number, dy: number): void => {
    for (const c of n.children ?? []) {
      const meta = info.get(c.id);
      if (!meta) throw new Error(`未知のノード: ${c.id}`);
      nodes.push({
        id: c.id,
        parent: meta.parent,
        kind: meta.kind,
        container: meta.container,
        tone: meta.spec?.tone,
        emphasis: meta.spec?.emphasis ?? false,
        box: { x: (c.x ?? 0) + dx, y: (c.y ?? 0) + dy, w: c.width ?? 0, h: c.height ?? 0 },
        lines: meta.lines,
      });
      for (const label of c.labels ?? []) {
        const note = info.get(label.id ?? '');
        if (!note || note.kind !== 'note') continue;
        notes.push({
          id: label.id ?? '',
          parent: note.parent,
          kind: 'note',
          container: false,
          emphasis: false,
          box: { x: (label.x ?? 0) + dx, y: (label.y ?? 0) + dy, w: label.width ?? 0, h: label.height ?? 0 },
          lines: note.lines,
        });
      }
      walk(c, dx, dy);
    }
  };
  // grid で中を並べた枠（外側の枠から順に。draw.io では親のセルを先に書く）
  for (const f of placement.frames) {
    const meta = info.get(f.id);
    if (!meta) throw new Error(`未知のノード: ${f.id}`);
    nodes.push({
      id: f.id,
      parent: meta.parent,
      kind: meta.kind,
      container: true,
      tone: meta.spec?.tone,
      emphasis: meta.spec?.emphasis ?? false,
      box: { x: f.box.x + ox, y: f.box.y + oy, w: f.box.w, h: f.box.h },
      lines: meta.lines,
    });
  }
  for (const t of placement.trees) walk(t.node, t.dx + ox, t.dy + oy);
  nodes.push(...notes);

  const shift = (p: Point): Point => ({ x: p.x + ox, y: p.y + oy });
  const laidEdges: LaidEdge[] = [];
  const pending = new Set(placement.pending);
  for (const e of edges) {
    const meta = edgeMeta.get(e.id);
    if (!meta) continue;
    const common = { id: e.id, from: meta.from, to: meta.to, cls: meta.cls, dir: meta.dir, emphasis: meta.emphasis };
    if (pending.has(e.id)) {
      // 経路とラベルの位置は、補足の点線まで揃ってから経路探索で決める
      const size = e.labels?.[0];
      laidEdges.push({ ...common, points: [], label: size && meta.lines.length > 0 ? { lines: meta.lines, box: { x: 0, y: 0, w: size.width ?? 0, h: size.height ?? 0 } } : undefined });
      continue;
    }
    const geo = placement.edges.get(e.id);
    if (!geo) continue;
    const points = geo.points.map(shift);
    laidEdges.push({
      ...common,
      points: reversed.has(e.id) ? points.reverse() : points,
      label: geo.label && meta.lines.length > 0 ? { lines: meta.lines, box: { ...geo.label, ...shift(geo.label) } } : undefined,
    });
  }

  // 補足と対象を短い点線で結ぶ（人が補足を動かしても、どの要素の補足か分かるように）
  const boxOf = new Map(nodes.map((n) => [n.id, n.box]));
  for (const note of notes) {
    const targetId = noteTarget.get(note.id) ?? '';
    const t = boxOf.get(targetId);
    if (!t) continue;
    const b = note.box;
    const mid = (a0: number, a1: number, b0: number, b1: number): number => (Math.max(a0, b0) + Math.min(a1, b1)) / 2;
    const points = direction === 'DOWN'
      ? [{ x: b.x, y: mid(b.y, b.y + b.h, t.y, t.y + t.h) }, { x: t.x + t.w, y: mid(b.y, b.y + b.h, t.y, t.y + t.h) }]
      : [{ x: mid(b.x, b.x + b.w, t.x, t.x + t.w), y: b.y }, { x: mid(b.x, b.x + b.w, t.x, t.x + t.w), y: t.y + t.h }];
    laidEdges.push({ id: `${note.id}:link`, from: note.id, to: targetId, cls: 'note', dir: 'none', emphasis: false, points });
  }

  // grid の別々のマスにまたがる線を引く（見出しは既定の左上の位置、タイトルも避ける）。
  // 通常の間隔で通せなかった線は、両端を含む grid の枠ごとに数え、組み直すときにその枠の余白を広げる
  const cramped = new Map<string, number>();
  if (placement.pending.length > 0) {
    const headers = nodes.filter((n) => n.container).map((n) => {
      const text = info.get(n.id)?.text ?? { w: 0, h: 0 };
      return { x: n.box.x + HEADER_INSET_X, y: n.box.y + HEADER_INSET_Y, w: text.w, h: text.h };
    });
    const failures = routeEdges(nodes, laidEdges, new Set(placement.pending), headers, [grow({ x: MARGIN, y: MARGIN, w: titleSize.w, h: titleSize.h }, 8)]);
    const gridFrames = new Set(placement.frames.map((f) => f.id));
    for (const f of failures) if (f.frame !== null && gridFrames.has(f.frame)) cramped.set(f.frame, (cramped.get(f.frame) ?? 0) + 1);
  }

  // 枠の見出しは左上に置く。線が見出しを横切るなら、横切る線の右側へ順にずらして空きを探す
  const headerSpot = (id: string, paths: Point[][]): Box | undefined => {
    const n = nodes.find((m) => m.id === id);
    if (!n) return undefined;
    const text = info.get(n.id)?.text ?? { w: 0, h: 0 };
    const at = (x: number): Box => ({ x, y: n.box.y + HEADER_INSET_Y, w: text.w, h: text.h });
    const blocked = (b: Box): boolean => paths.some((p) => polylineHitsBox(p, inflate(b, HEADER_CLEARANCE)));
    const crossingX = paths.flatMap((p) =>
      p.slice(1).flatMap((q, k) => (Math.abs(p[k].x - q.x) < 0.5 && polylineHitsBox([p[k], q], { ...at(n.box.x), w: n.box.w }) ? [q.x] : [])),
    );
    const candidates = [n.box.x + HEADER_INSET_X, ...crossingX.map((x) => x + HEADER_CLEARANCE + 4).sort((a, b) => a - b)];
    const fits = (x: number): boolean => x + text.w <= n.box.x + n.box.w - HEADER_INSET_X;
    const x = candidates.find((c) => fits(c) && !blocked(at(c)));
    return x === undefined ? undefined : at(x);
  };

  // 大回りしている線を、横から出入りする短い経路に置き換える（見出しの置き場を奪わない範囲で）
  shortenEdges(nodes, laidEdges, headerSpot);

  const crowded = new Map<string, number>();
  const paths = laidEdges.map((e) => e.points);
  for (const n of nodes) {
    if (!n.container) continue;
    const spot = headerSpot(n.id, paths);
    const text = info.get(n.id)?.text ?? { w: 0, h: 0 };
    if (!spot) {
      // 中身は左寄せのまま、見出しの高さを縦に横切る線のうち、いちばん右の線の右に見出しが収まる分だけ広げる
      const band = { x: n.box.x, y: n.box.y + HEADER_INSET_Y, w: n.box.w, h: text.h };
      const crossing = paths.flatMap((p) => p.slice(1).flatMap((q, k) => (Math.abs(p[k].x - q.x) < 0.5 && polylineHitsBox([p[k], q], band) ? [q.x] : [])));
      const start = crossing.length > 0 ? Math.max(...crossing) - n.box.x + HEADER_CLEARANCE + 4 : n.box.w;
      crowded.set(n.id, Math.max(start + text.w + HEADER_INSET_X + 2, n.box.w + HEADER_CLEARANCE * 2));
    }
    n.header = { box: spot ?? { x: n.box.x + HEADER_INSET_X, y: n.box.y + HEADER_INSET_Y, w: text.w, h: text.h } };
  }

  // 線とラベルは、要素の外周の外（左や上も）に出ることがある。中身全体が余白の内側に収まるようにずらし、図の大きさに含める
  const parts = [
    ...nodes.flatMap((n) => [n.box, ...(n.header ? [n.header.box] : [])]),
    ...laidEdges.flatMap((e) => [...e.points.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })), ...(e.label ? [e.label.box] : [])]),
  ];
  const dx = Math.max(0, ox - Math.min(...parts.map((b) => b.x)));
  const dy = Math.max(0, oy - Math.min(...parts.map((b) => b.y)));
  const contentRight = Math.max(...parts.map((b) => b.x + b.w)) + dx;
  const contentBottom = Math.max(...parts.map((b) => b.y + b.h)) + dy;
  if (dx > 0 || dy > 0) {
    const move = (b: Box): Box => ({ x: b.x + dx, y: b.y + dy, w: b.w, h: b.h });
    for (const n of nodes) {
      n.box = move(n.box);
      if (n.header) n.header = { box: move(n.header.box) };
    }
    for (const e of laidEdges) {
      e.points = e.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      if (e.label) e.label = { ...e.label, box: move(e.label.box) };
    }
  }
  const layout: Layout = {
    width: Math.max(contentRight, MARGIN + titleSize.w) + MARGIN,
    height: contentBottom + MARGIN,
    title: { lines: titleLines, box: { x: MARGIN, y: MARGIN, w: titleSize.w, h: titleSize.h } },
    nodes,
    edges: laidEdges,
  };
  if (spec.legend !== false) addLegend(layout, spec, info, fonts, { x: MARGIN, y: MARGIN, w: contentRight - MARGIN, h: contentBottom - MARGIN });
  return { layout, crowded, cramped };
}

/** ELK の結果の木から、線の経路とラベルの位置を集める（ずれ dx, dy を足す） */
function collectEdges(tree: ElkNode, dx: number, dy: number, into: Map<string, EdgeGeometry>): void {
  for (const e of tree.edges ?? []) {
    const section = e.sections?.[0];
    if (!section) continue;
    const label = e.labels?.[0];
    into.set(e.id, {
      points: [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p) => ({ x: p.x + dx, y: p.y + dy })),
      label: label ? { x: (label.x ?? 0) + dx, y: (label.y ?? 0) + dy, w: label.width ?? 0, h: label.height ?? 0 } : undefined,
    });
  }
  for (const c of tree.children ?? []) collectEdges(c, dx, dy, into);
}

/** flow：全体を 1 回の ELK で組む（つながった要素は流れの向きに並ぶ） */
async function placeFlow(roots: ElkNode[], edges: ElkExtendedEdge[], direction: 'RIGHT' | 'DOWN'): Promise<Placement> {
  const laid = await runElk({ id: 'dw:root', layoutOptions: rootOptions(direction), children: roots, edges });
  const geometry = new Map<string, EdgeGeometry>();
  collectEdges(laid, 0, 0, geometry);
  return { width: laid.width ?? 0, height: laid.height ?? 0, trees: [{ node: laid, dx: 0, dy: 0 }], edges: geometry, frames: [], pending: [] };
}

function boxOfElk(n: ElkNode): Box {
  return { x: n.x ?? 0, y: n.y ?? 0, w: n.width ?? 0, h: n.height ?? 0 };
}

/** grid で並べた塊（マスに置く要素）。座標は塊の左上を原点とする */
interface Block {
  w: number;
  h: number;
  trees: Placement['trees'];
  frames: { id: string; box: Box }[];
  /** マスいっぱいに広げる（枠だけ。中身は左上に置いたまま） */
  stretch?: (w: number, h: number) => void;
}

function moveBlock(b: Block, dx: number, dy: number): void {
  for (const t of b.trees) {
    t.dx += dx;
    t.dy += dy;
  }
  for (const f of b.frames) {
    f.box.x += dx;
    f.box.y += dy;
  }
}

interface GridContext {
  spec: DiagramSpec;
  elkNodes: Map<string, ElkNode>;
  info: Map<string, Info>;
  parentOf: Map<string, string | null>;
  direction: 'RIGHT' | 'DOWN';
  room: Room;
}

/**
 * grid：記述の grid のとおりにマスへ並べる。マスに置いた要素の中は、要素ごとに ELK で direction の向きに組む
 * （中に grid がある枠は、その grid で並べる）。同じ行は高さを、同じ列は幅をそろえ、枠はマスいっぱいに広げる。
 * 別々のマスにまたがる線はここでは引かず pending として返し、位置が決まった後で経路探索（route.ts）で引く。
 */
async function placeGrid(ctx: GridContext, edges: ElkExtendedEdge[]): Promise<Placement> {
  const { spec, elkNodes, info, parentOf, direction, room } = ctx;
  const gridded = new Set<string>();
  const collect = (nodes: NodeSpec[]): void => {
    for (const n of nodes) {
      if (n.grid) gridded.add(n.id);
      collect(n.children ?? []);
    }
  };
  collect(spec.nodes);
  // 線の端が属する「ELK で組む塊」（マスに置いた要素のうち、中を grid で並べないもの）。grid の枠そのものなら null
  const unitOf = (id: string): string | null => {
    if (gridded.has(id)) return null;
    let cur = id;
    for (let p = parentOf.get(cur) ?? null; p !== null && !gridded.has(p); p = parentOf.get(p) ?? null) cur = p;
    return cur;
  };
  const intra = new Map<string, ElkExtendedEdge[]>();
  const pending: ElkExtendedEdge[] = [];
  for (const e of edges) {
    const a = unitOf(e.sources[0]);
    if (a !== null && a === unitOf(e.targets[0])) intra.set(a, [...(intra.get(a) ?? []), e]);
    else pending.push(e);
  }

  const layoutUnit = async (n: NodeSpec): Promise<Block> => {
    const elk = elkNodes.get(n.id);
    if (!elk) throw new Error(`未知のノード: ${n.id}`);
    const laid = await runElk({ id: `dw:unit:${n.id}`, layoutOptions: rootOptions(direction), children: [elk], edges: intra.get(n.id) ?? [] });
    const node = laid.children?.[0];
    if (!node) throw new Error(`ELK の結果に ${n.id} がない`);
    const box = boxOfElk(node);
    // 外形は要素と、その外側に置いた補足
    const labels = (node.labels ?? []).map((label) => ({ label, box: { x: label.x ?? 0, y: label.y ?? 0, w: label.width ?? 0, h: label.height ?? 0 } }));
    const parts = [box, ...labels.map((l) => l.box)];
    const x0 = Math.min(...parts.map((b) => b.x));
    const y0 = Math.min(...parts.map((b) => b.y));
    const block: Block = {
      w: Math.max(...parts.map((b) => b.x + b.w)) - x0,
      h: Math.max(...parts.map((b) => b.y + b.h)) - y0,
      trees: [{ node: laid, dx: -x0, dy: -y0 }],
      frames: [],
    };
    if (info.get(n.id)?.container) {
      block.stretch = (w, h) => {
        const dw = Math.max(0, w - block.w);
        const dh = Math.max(0, h - block.h);
        node.width = box.w + dw;
        node.height = box.h + dh;
        // 中身は左右の中央に寄せる（見出しは左上のまま）。ELK の座標は根を原点とするので、子孫と線をすべてずらす
        shiftElk(node, laid, dw / 2);
        // 右（下）の外側に置いた補足は、広げた分だけずらす
        for (const l of labels) {
          if (l.box.x >= box.x + box.w - 0.5) l.label.x = l.box.x + dw;
          if (l.box.y >= box.y + box.h - 0.5) l.label.y = l.box.y + dh;
        }
        block.w += dw;
        block.h += dh;
      };
    }
    return block;
  };

  const layoutFrame = async (n: NodeSpec, grid: string[][]): Promise<Block> => {
    const inner = await layoutLevel(n.children ?? [], grid, n.id);
    const text = info.get(n.id)?.text ?? { w: 0, h: 0 };
    // 余白：線を通す通路が要るときは広げる（room.corridor）。幅：見出しの置き場が要るときは広げる（room.widen）。中身は左上のまま
    const pad = CONTAINER_PAD + (room.corridor.get(n.id) ?? 0);
    const top = text.h + CONTAINER_HEADER_GAP + 8 + (room.corridor.get(n.id) ?? 0);
    const box: Box = {
      x: 0,
      y: 0,
      w: Math.max(inner.w + pad * 2, text.w + CONTAINER_PAD * 2 + 8, room.widen.get(n.id) ?? 0),
      h: top + inner.h + pad,
    };
    moveBlock(inner, pad, top);
    const block: Block = { w: box.w, h: box.h, trees: inner.trees, frames: [{ id: n.id, box }, ...inner.frames] };
    block.stretch = (w, h) => {
      // 中身は左右の中央に寄せる（見出しは左上のまま）
      moveBlock(inner, Math.max(0, w - box.w) / 2, 0);
      box.w = Math.max(box.w, w);
      box.h = Math.max(box.h, h);
      block.w = box.w;
      block.h = box.h;
    };
    return block;
  };

  /** 塊の要素 node の子孫と、木 laid の中の線を横に dx ずらす（node 自身と、node の外側の補足は動かさない） */
  const shiftElk = (node: ElkNode, laid: ElkNode, dx: number): void => {
    if (dx === 0) return;
    const nodes = (n: ElkNode): void => {
      for (const c of n.children ?? []) {
        c.x = (c.x ?? 0) + dx;
        for (const l of c.labels ?? []) l.x = (l.x ?? 0) + dx;
        nodes(c);
      }
    };
    nodes(node);
    const edges = (n: ElkNode): void => {
      for (const e of n.edges ?? []) {
        for (const s of e.sections ?? []) {
          s.startPoint.x += dx;
          s.endPoint.x += dx;
          for (const b of s.bendPoints ?? []) b.x += dx;
        }
        for (const l of e.labels ?? []) l.x = (l.x ?? 0) + dx;
      }
      for (const c of n.children ?? []) edges(c);
    };
    edges(laid);
  };

  const layoutLevel = async (children: NodeSpec[], grid: string[][], owner: string | null): Promise<Block> => {
    const { rows, cols, areas } = gridAreas(grid);
    const blocks = new Map<string, Block>();
    for (const c of children) blocks.set(c.id, c.grid ? await layoutFrame(c, c.grid) : await layoutUnit(c));
    const area = (id: string): Area => {
      const a = areas.get(id);
      if (!a) throw new Error(`grid に ${id} がない`);
      return a;
    };
    const blockOf = (id: string): Block => {
      const b = blocks.get(id);
      if (!b) throw new Error(`grid の ${id} が子にない`);
      return b;
    };

    // 通路の幅：その通路を横切る線の数と、ラベルの大きさから決める
    const itemOf = (id: string): string | undefined => {
      let cur = id;
      for (let p = parentOf.get(cur) ?? null; p !== owner; p = parentOf.get(p) ?? null) {
        if (p === null) return undefined;
        cur = p;
      }
      return areas.has(cur) ? cur : undefined;
    };
    const colCross = new Array<number>(Math.max(0, cols - 1)).fill(0);
    const colLabel = new Array<number>(Math.max(0, cols - 1)).fill(0);
    const rowCross = new Array<number>(Math.max(0, rows - 1)).fill(0);
    const rowLabel = new Array<number>(Math.max(0, rows - 1)).fill(0);
    for (const e of pending) {
      const ia = itemOf(e.sources[0]);
      const ib = itemOf(e.targets[0]);
      if (ia === undefined || ib === undefined || ia === ib) continue;
      const a = area(ia);
      const b = area(ib);
      const label = e.labels?.[0];
      const [c0, c1] = a.c1 < b.c0 ? [a.c1, b.c0] : b.c1 < a.c0 ? [b.c1, a.c0] : [0, 0];
      for (let g = c0; g < c1; g++) {
        colCross[g]++;
        colLabel[g] = Math.max(colLabel[g], label?.width ?? 0);
      }
      const [r0, r1] = a.r1 < b.r0 ? [a.r1, b.r0] : b.r1 < a.r0 ? [b.r1, a.r0] : [0, 0];
      for (let g = r0; g < r1; g++) {
        rowCross[g]++;
        rowLabel[g] = Math.max(rowLabel[g], label?.height ?? 0);
      }
    }
    const gapOf = (cross: number, label: number): number => Math.max(GRID_GAP, label > 0 ? label + GRID_LABEL_PAD * 2 : 0, (cross + 1) * LANE + GRID_LABEL_PAD);
    const colGap = colCross.map((n, g) => gapOf(n, colLabel[g]));
    const rowGap = rowCross.map((n, g) => gapOf(n, rowLabel[g]));

    // 列の幅・行の高さ：1 マスの要素で決め、またがる要素で足りない分は、またがる列（行）に足す。
    // 足す先は、1 マスの要素が無い列（行）を優先する（空きマスの行が伸び、他の行の要素は間延びしない）
    const colW = new Array<number>(cols).fill(0);
    const rowH = new Array<number>(rows).fill(0);
    const colFixed = new Array<boolean>(cols).fill(false);
    const rowFixed = new Array<boolean>(rows).fill(false);
    const span = (sizes: number[], gaps: number[], a0: number, a1: number): number =>
      sizes.slice(a0, a1 + 1).reduce((s, v) => s + v, 0) + gaps.slice(a0, a1).reduce((s, v) => s + v, 0);
    for (const [id, a] of areas) {
      const b = blockOf(id);
      if (a.c0 === a.c1) {
        colW[a.c0] = Math.max(colW[a.c0], b.w);
        colFixed[a.c0] = true;
      }
      if (a.r0 === a.r1) {
        rowH[a.r0] = Math.max(rowH[a.r0], b.h);
        rowFixed[a.r0] = true;
      }
    }
    const spread = (sizes: number[], fixed: boolean[], a0: number, a1: number, need: number): void => {
      if (need <= 0) return;
      const all = Array.from({ length: a1 - a0 + 1 }, (_, k) => a0 + k);
      const flexible = all.filter((t) => !fixed[t]);
      const targets = flexible.length > 0 ? flexible : all;
      for (const t of targets) sizes[t] += need / targets.length;
    };
    for (const [id, a] of areas) {
      const b = blockOf(id);
      spread(colW, colFixed, a.c0, a.c1, b.w - span(colW, colGap, a.c0, a.c1));
      spread(rowH, rowFixed, a.r0, a.r1, b.h - span(rowH, rowGap, a.r0, a.r1));
    }
    const xs = colW.map((_, c) => span(colW, colGap, 0, c) - colW[c]);
    const ys = rowH.map((_, r) => span(rowH, rowGap, 0, r) - rowH[r]);

    // 枠はマスに合わせて広げて上端をそろえ、それ以外はマスの中央に置く
    const out: Block = { w: span(colW, colGap, 0, cols - 1), h: span(rowH, rowGap, 0, rows - 1), trees: [], frames: [] };
    for (const c of children) {
      const a = area(c.id);
      const b = blockOf(c.id);
      const w = span(colW, colGap, a.c0, a.c1);
      const h = span(rowH, rowGap, a.r0, a.r1);
      if (b.stretch) {
        // 中身の少ない枠をマスいっぱいに広げると、枠の中が空白だらけになる。足りない分が小さいときだけ広げる。
        // 広げない枠は元の大きさのまま、上端は同じ行の枠とそろえ、左右はマスの中央に置く（両側から来る線が短くなる）
        b.stretch(b.w >= w * STRETCH_MIN ? w : b.w, b.h >= h * STRETCH_MIN ? h : b.h);
        moveBlock(b, xs[a.c0] + (w - b.w) / 2, ys[a.r0]);
      } else moveBlock(b, xs[a.c0] + (w - b.w) / 2, ys[a.r0] + (h - b.h) / 2);
      out.trees.push(...b.trees);
      out.frames.push(...b.frames);
    }
    return out;
  };

  const root = await layoutLevel(spec.nodes, spec.grid ?? [spec.nodes.map((n) => n.id)], null);
  const geometry = new Map<string, EdgeGeometry>();
  for (const t of root.trees) collectEdges(t.node, t.dx, t.dy, geometry);
  return { width: root.w, height: root.h, trees: root.trees, frames: root.frames, pending: pending.map((e) => e.id), edges: geometry };
}

/** 凡例のまわりに空ける余白 */
const LEGEND_CLEARANCE = 16;

/**
 * 凡例は、まず図の中の空いている場所（右端・下端に沿って）に置く。どこにも収まらなければ右に列を足す。
 * 右に列を足すと、その列の下が丸ごと余白になるため。
 */
function addLegend(layout: Layout, spec: DiagramSpec, info: Map<string, Info>, fonts: Fonts, content: Box): void {
  const items: LegendItem[] = [];
  const seen = new Set<string>();
  for (const meta of info.values()) {
    if (meta.container || meta.kind === 'note' || isContainerKind(meta.kind)) continue;
    const swatch = LEAF_SWATCH[meta.kind];
    if (seen.has(swatch.name)) continue;
    seen.add(swatch.name);
    items.push({ type: 'node', key: meta.kind, label: swatch.name });
  }
  // 区画（zone）の枠の色。色の近い要素（ネットワーク機器の黄色と顧客の区画の黄色など）と取り違えないよう、意味を載せる
  for (const meta of info.values()) {
    if (meta.kind !== 'zone') continue;
    const tone = meta.spec?.tone ?? 'neutral';
    if (seen.has(`zone:${tone}`)) continue;
    seen.add(`zone:${tone}`);
    items.push({ type: 'zone', key: tone, label: ZONE_NAME[tone] });
  }
  for (const e of spec.edges ?? []) {
    const cls = e.class ?? 'user';
    if (seen.has(`edge:${cls}`)) continue;
    seen.add(`edge:${cls}`);
    items.push({ type: 'edge', key: cls, label: EDGE_THEME[cls].name });
  }
  if (items.length === 0) return;

  const { rowH, sampleW, pad, headerH } = LEGEND;
  const itemW = sampleW + 10 + Math.max(...items.map((i) => measure([line(i.label, TEXT.legend)], fonts).w));
  const colGap = 20;
  const shape = (cols: number): { w: number; h: number } => {
    const rows = Math.ceil(items.length / cols);
    return { w: pad * 2 + cols * itemW + (cols - 1) * colGap, h: headerH + pad + rows * rowH };
  };

  const obstacles = [layout.title.box, ...layout.nodes.map((n) => n.box), ...layout.edges.flatMap((e) => (e.label ? [e.label.box] : []))];
  const free = (b: Box): boolean => {
    const around = inflate(b, LEGEND_CLEARANCE);
    return !obstacles.some((o) => intersects(around, o)) && !layout.edges.some((e) => polylineHitsBox(e.points, around));
  };
  const right = content.x + content.w;
  const bottom = content.y + content.h;
  let placed: { box: Box; cols: number } | null = null;
  for (const cols of [1, 2]) {
    const { w, h } = shape(cols);
    if (w > content.w || h > content.h) continue;
    const step = 8;
    for (let y = content.y; y + h <= bottom && !placed; y += step) {
      const b = { x: right - w, y, w, h };
      if (free(b)) placed = { box: b, cols };
    }
    for (let x = right - w; x >= content.x && !placed; x -= step) {
      const b = { x, y: bottom - h, w, h };
      if (free(b)) placed = { box: b, cols };
    }
    if (placed) break;
  }
  if (!placed) {
    // 図の中に空きが無ければ、右に列を足すか、下に段を足す。足した後の縦横比が横長の資料（16:9）に近い方を選ぶ。
    // 右に足す列は、上端を本文の上端（タイトルの下）にそろえる。タイトルの方が本文より幅が広いと、タイトルの上に重なるため
    const top = Math.max(content.y, layout.title.box.y + layout.title.box.h + TITLE_GAP);
    const column = { box: { x: right + LEGEND_GAP, y: top, ...shape(1) }, cols: 1 };
    const fitCols = Math.max(1, Math.min(items.length, Math.floor((content.w - pad * 2 + colGap) / (itemW + colGap))));
    const row = { box: { x: content.x, y: bottom + LEGEND_GAP, ...shape(fitCols) }, cols: fitCols };
    const ratio = (c: { box: Box }): number => {
      const w = Math.max(layout.width, c.box.x + c.box.w + MARGIN);
      const h = Math.max(layout.height, c.box.y + c.box.h + MARGIN);
      return Math.abs(Math.log(w / h / TARGET_RATIO));
    };
    placed = ratio(row) < ratio(column) ? row : column;
  }

  const { box, cols } = placed;
  const rows = Math.ceil(items.length / cols);
  layout.legend = {
    box,
    items: items.map((item, i) => ({
      item,
      box: { x: box.x + pad + Math.floor(i / rows) * (itemW + colGap), y: box.y + headerH + 6 + (i % rows) * rowH, w: itemW, h: rowH - 6 },
    })),
  };
  layout.width = Math.max(layout.width, box.x + box.w + MARGIN);
  layout.height = Math.max(layout.height, box.y + box.h + MARGIN);
}
