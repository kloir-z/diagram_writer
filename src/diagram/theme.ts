// 意味 → 見た目の対応（色・線種・文字）を 1 か所で決める。図ごとに色を選ばせない。
import type { ContainerKind, EdgeClass, LeafKind, Tone } from './types.ts';

export const FONT_P = 'BIZ UDPGothic';
export const FONT_M = 'BIZ UDGothic';
export const FONT_SOURCE_P = 'https%3A%2F%2Ffonts.googleapis.com%2Fcss%3Ffamily%3DBIZ%2BUDPGothic';

export const TEXT = {
  title: { size: 20, bold: true, color: '#1a1a1a' },
  subtitle: { size: 12, bold: false, color: '#555555' },
  label: { size: 13, bold: true, color: '#1a1a1a' },
  sub: { size: 11, bold: false, color: '#555555' },
  spec: { size: 11, bold: false, color: '#333333' },
  header: { size: 13, bold: true, color: '#333333' },
  siteHeader: { size: 15, bold: true, color: '#1a1a1a' },
  edge: { size: 11, bold: false, color: '#333333' },
  note: { size: 11, bold: false, color: '#333333' },
  legend: { size: 11, bold: false, color: '#333333' },
} as const;

/** html ラベルの行の高さ（draw.io の既定 line-height 1.2） */
export const LINE_HEIGHT = 1.2;

interface Swatch {
  fill: string;
  stroke: string;
  /** 凡例での名前 */
  name: string;
}

const AI: Swatch = { fill: '#e1d5e7', stroke: '#9673a6', name: 'AI（GPU・LLM）' };
const AUTOMATION: Swatch = { fill: '#d5e8d4', stroke: '#82b366', name: '自動化・ツール' };
const COMPUTE: Swatch = { fill: '#dae8fc', stroke: '#6c8ebf', name: 'サーバー・仮想マシン' };
const NETWORK: Swatch = { fill: '#fff2cc', stroke: '#d6b656', name: 'ネットワーク機器' };
const SECURITY: Swatch = { fill: '#f8cecc', stroke: '#b85450', name: 'セキュリティ境界' };
const DATA: Swatch = { fill: '#ffe6cc', stroke: '#d79b00', name: 'データ・リポジトリ' };
const PEOPLE: Swatch = { fill: '#f5f5f5', stroke: '#666666', name: '利用者・端末' };
const EXTERNAL: Swatch = { fill: '#ffffff', stroke: '#999999', name: '外部のサービス' };
const OTHER: Swatch = { fill: '#ffffff', stroke: '#666666', name: 'その他' };

export const LEAF_SWATCH: Record<LeafKind, Swatch> = {
  person: PEOPLE,
  pc: PEOPLE,
  server: COMPUTE,
  vm: COMPUTE,
  storage: COMPUTE,
  gpu: AI,
  llm: AI,
  'ai-service': AI,
  tool: AUTOMATION,
  service: AUTOMATION,
  repo: DATA,
  data: DATA,
  switch: NETWORK,
  router: NETWORK,
  firewall: SECURITY,
  jump: SECURITY,
  cloud: EXTERNAL,
  other: OTHER,
};

export const NOTE_STYLE = { fill: '#fffbe6', stroke: '#d6b656' };

interface ContainerStyle {
  fill: string;
  stroke: string;
  dashed: boolean;
  strokeWidth: number;
}

const TONE_STROKE: Record<Tone, string> = {
  internal: '#6c8ebf',
  customer: '#d79b00',
  restricted: '#b85450',
  neutral: '#999999',
};

const TONE_FILL: Record<Tone, string> = {
  internal: '#f4f8fd',
  customer: '#fff8ef',
  restricted: '#fdf3f3',
  neutral: '#fafafa',
};

export function containerStyle(kind: ContainerKind, tone: Tone | undefined): ContainerStyle {
  switch (kind) {
    case 'site':
      return { fill: tone ? TONE_FILL[tone] : '#ffffff', stroke: tone ? TONE_STROKE[tone] : '#4d4d4d', dashed: false, strokeWidth: 2 };
    case 'zone':
      return { fill: TONE_FILL[tone ?? 'neutral'], stroke: TONE_STROKE[tone ?? 'neutral'], dashed: true, strokeWidth: 1.5 };
    case 'host':
      return { fill: '#ffffff', stroke: '#6c8ebf', dashed: false, strokeWidth: 1.5 };
    case 'rack':
      return { fill: '#f5f5f5', stroke: '#4d4d4d', dashed: false, strokeWidth: 1.5 };
    case 'cluster':
      return { fill: '#ffffff', stroke: '#999999', dashed: true, strokeWidth: 1 };
    case 'group':
      return { fill: '#ffffff', stroke: '#bbbbbb', dashed: true, strokeWidth: 1 };
  }
}

export interface EdgeTheme {
  color: string;
  width: number;
  dash: string | null;
  name: string;
  /** 矢じりの形（既定は塗りつぶしの三角） */
  arrow?: 'open';
  /** 線ではなく太い矢印で描く（時期・段階の移行など、通信や操作ではない関係） */
  fat?: boolean;
}

export const EDGE_THEME: Record<EdgeClass, EdgeTheme> = {
  user: { color: '#4d4d4d', width: 1.5, dash: null, name: '人の操作・やりとり' },
  flow: { color: '#8c8c8c', width: 1.5, dash: null, name: '処理の流れ（依頼・呼び出し）', arrow: 'open' },
  build: { color: '#455a64', width: 2.5, dash: '8 4', name: '開発・構築（作成・修正）' },
  llm: { color: '#9673a6', width: 2.5, dash: null, name: 'LLM API（推論）' },
  tool: { color: '#5a9a4a', width: 2.5, dash: null, name: 'ツール呼び出し' },
  device: { color: '#d79b00', width: 2.5, dash: null, name: '機器操作（SSH・API）' },
  vpn: { color: '#6c8ebf', width: 4, dash: '10 5', name: 'VPN・拠点間接続' },
  data: { color: '#6c8ebf', width: 1.5, dash: '5 4', name: 'データ・ログの流れ' },
  approval: { color: '#b85450', width: 2.5, dash: null, name: '承認' },
  blocked: { color: '#b85450', width: 1.5, dash: '3 4', name: '通信させない' },
  transition: { color: '#888888', width: 1.5, dash: null, name: '移行（時期・段階）', fat: true },
  note: { color: '#b3b3b3', width: 1, dash: '2 3', name: '補足' },
};

/** 区画（zone）の枠の色の意味（凡例での名前） */
export const ZONE_NAME: Record<Tone, string> = {
  internal: '自社の区画',
  customer: '顧客の区画',
  restricted: '制限区画（通信を絞る）',
  neutral: '外部・その他の区画',
};

export function isContainerKind(kind: string): kind is ContainerKind {
  return kind === 'site' || kind === 'zone' || kind === 'host' || kind === 'rack' || kind === 'cluster' || kind === 'group';
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

export function stepMark(step: number): string {
  return CIRCLED[step - 1] ?? `(${step})`;
}
