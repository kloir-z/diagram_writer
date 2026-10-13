// schema/model.schema.json の 1 ファイル分（入力）と、範囲記法を展開・連結した後のモデル（出力）。

import type { SourceLoc } from '../source.ts';

export type DeviceKind = 'switch' | 'router' | 'firewall' | 'load-balancer' | 'storage' | 'server' | 'chassis' | 'appliance' | 'other';
export type PortKind = 'ethernet' | 'fc' | 'mgmt' | 'console' | 'other';
export type LagMode = 'lacp' | 'static' | 'active-backup' | 'other';
export type GroupKind = 'site' | 'rack' | 'fabric' | 'cluster' | 'ha-pair' | 'vpc-domain' | 'stack' | 'chassis' | 'other';
export type MlagKind = 'vpc' | 'mlag' | 'other';

interface PortInput {
  name: string;
  kind?: PortKind;
  speed?: string;
  media?: string;
  slot?: string;
  role?: string;
  note?: string;
}

interface LagInput {
  name: string;
  members: string | string[];
  mode?: LagMode;
  role?: string;
  note?: string;
}

interface DeviceInput {
  id: string;
  name?: string;
  kind: DeviceKind;
  vendor?: string;
  model?: string;
  role?: string;
  rack?: string;
  u?: number;
  note?: string;
  ports?: PortInput[];
  lags?: LagInput[];
}

interface GroupInput {
  id: string;
  kind: GroupKind;
  name?: string;
  members: string | string[];
  note?: string;
}

interface LinkInput {
  a: string;
  b: string;
  cable?: string;
  role?: string;
  tags?: string[];
  note?: string;
}

interface MlagInput {
  id: string;
  kind: MlagKind;
  members: string[];
  note?: string;
}

export interface SystemInfo {
  id: string;
  name: string;
  note?: string;
}

export interface ModelFile {
  system?: SystemInfo;
  devices?: DeviceInput[];
  groups?: GroupInput[];
  links?: LinkInput[];
  mlags?: MlagInput[];
  open_questions?: string[];
}

export interface Port {
  name: string;
  kind: PortKind;
  speed?: string;
  media?: string;
  slot?: string;
  role?: string;
  note?: string;
}

export interface Lag {
  name: string;
  members: string[];
  mode?: LagMode;
  role?: string;
  note?: string;
}

export interface Device {
  id: string;
  name: string;
  kind: DeviceKind;
  vendor?: string;
  model?: string;
  role?: string;
  rack?: string;
  u?: number;
  note?: string;
  ports: Port[];
  lags: Lag[];
  loc: SourceLoc;
}

/** 「機器 ID:ポート名」。機器 ID は ':' を含まないので最初の ':' で分ける。 */
export interface Endpoint {
  device: string;
  port: string;
}

export interface Link {
  a: Endpoint;
  b: Endpoint;
  cable?: string;
  role?: string;
  tags: string[];
  note?: string;
  loc: SourceLoc;
}

export interface Group {
  id: string;
  kind: GroupKind;
  name: string;
  members: string[];
  note?: string;
  loc: SourceLoc;
}

export interface Mlag {
  id: string;
  kind: MlagKind;
  /** device = 機器 ID、port = その機器の LAG 名 */
  members: Endpoint[];
  note?: string;
  loc: SourceLoc;
}

export interface Model {
  system?: SystemInfo;
  devices: Device[];
  groups: Group[];
  links: Link[];
  mlags: Mlag[];
}
