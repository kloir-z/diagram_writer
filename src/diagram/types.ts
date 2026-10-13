// 図の記述（schema/diagram.schema.json）と、レイアウト後の幾何情報。
// 記述には座標を書かない。何が何を含み、何と何がどう関係し、どちら向きに流し、ざっくりどこに置くかだけを書く。

export type LeafKind =
  | 'person' | 'pc' | 'server' | 'vm' | 'storage' | 'gpu' | 'llm' | 'ai-service'
  | 'tool' | 'service' | 'repo' | 'data' | 'switch' | 'router' | 'firewall' | 'jump' | 'cloud' | 'other';
export type ContainerKind = 'site' | 'zone' | 'host' | 'rack' | 'cluster' | 'group';
export type Tone = 'internal' | 'customer' | 'restricted' | 'neutral';
export type EdgeClass =
  | 'user' | 'flow' | 'build' | 'llm' | 'tool' | 'device' | 'vpn' | 'data' | 'approval' | 'blocked' | 'transition' | 'note';
export type Direction = 'right' | 'down';

export interface NodeSpec {
  id: string;
  label: string;
  kind?: LeafKind | ContainerKind;
  /** 補足の行（プロポーショナル） */
  sub?: string | string[];
  /** 識別子の行（IP、型番、ポートなど。等幅） */
  specs?: string | string[];
  /** 区画（zone）の色分け */
  tone?: Tone;
  /** レイヤー方向の段（0 始まり）。同じ値の要素は同じ段に並ぶ */
  layer?: number;
  emphasis?: boolean;
  children?: NodeSpec[];
  /** 子のざっくりした配置（DiagramSpec.grid と同じ書き方）。grid で並べた要素にだけ書ける */
  grid?: string[][];
}

export interface EdgeSpec {
  from: string;
  to: string;
  label?: string;
  class?: EdgeClass;
  /** 手順番号（1〜20）。ラベルの先頭に ① などを付ける */
  step?: number;
  dir?: 'forward' | 'both' | 'none';
  emphasis?: boolean;
}

export interface NoteSpec {
  to: string;
  text: string;
}

export interface DiagramSpec {
  title: string;
  subtitle?: string;
  /** 流れの向き（grid のマスに置いた要素の中、または図全体） */
  direction?: Direction;
  /**
   * ざっくりした配置。行ごとに最上位の要素の id を並べる（"." は空き、同じ id を隣り合うマスに書くとまたがる）。
   * 無ければ、つながりに沿って全体を 1 回で並べる
   */
  grid?: string[][];
  legend?: boolean;
  nodes: NodeSpec[];
  edges?: EdgeSpec[];
  notes?: NoteSpec[];
}

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextLine {
  text: string;
  font: 'p' | 'm';
  size: number;
  bold: boolean;
  color: string;
}

export interface LaidNode {
  id: string;
  parent: string | null;
  kind: LeafKind | ContainerKind | 'note';
  container: boolean;
  tone?: Tone;
  emphasis: boolean;
  /** 絶対座標 */
  box: Box;
  lines: TextLine[];
  /** 枠の見出しの位置（枠のみ） */
  header?: { box: Box };
}

export interface LaidEdge {
  id: string;
  from: string;
  to: string;
  cls: EdgeClass;
  dir: 'forward' | 'both' | 'none';
  emphasis: boolean;
  /** 始点〜終点（絶対座標、直交） */
  points: Point[];
  label?: { lines: TextLine[]; box: Box };
  /** 経路探索がうまくいかなかったときの内容（機械チェックが指摘する） */
  problem?: string;
}

export interface LegendItem {
  /** node：要素の色、zone：区画の枠の色（key は tone）、edge：線の種類 */
  type: 'node' | 'zone' | 'edge';
  key: string;
  label: string;
}

export interface Layout {
  width: number;
  height: number;
  title: { lines: TextLine[]; box: Box };
  nodes: LaidNode[];
  edges: LaidEdge[];
  legend?: { box: Box; items: { item: LegendItem; box: Box }[] };
}
