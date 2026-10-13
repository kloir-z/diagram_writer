// モデル YAML（複数ファイル）を、スキーマ検証 → 範囲記法の展開 → 連結 → 整合性チェックする。
// ファイル入出力はしない（Node でも、将来ブラウザ上でも同じコードを動かすため）。
import { Ajv } from 'ajv';
import schema from '../../schema/model.schema.json' with { type: 'json' };
import { formatLoc, parseYamlSource, type Diagnostic, type SourceFile, type SourceLoc } from '../source.ts';
import { expandRange } from './range.ts';
import type { Device, Endpoint, Group, Lag, Link, Mlag, Model, ModelFile, Port } from './types.ts';

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
const validateFile = ajv.compile<ModelFile>(schema);

export interface LoadResult {
  model: Model;
  diagnostics: Diagnostic[];
}

function parseEndpoint(text: string): Endpoint | null {
  const sep = text.indexOf(':');
  if (sep <= 0 || sep === text.length - 1) return null;
  return { device: text.slice(0, sep), port: text.slice(sep + 1) };
}

export function parseModel(sources: SourceFile[]): LoadResult {
  const diagnostics: Diagnostic[] = [];
  const error = (loc: SourceLoc, message: string): void => void diagnostics.push({ level: 'error', loc, message });
  const model: Model = { devices: [], groups: [], links: [], mlags: [] };
  let systemLoc: SourceLoc | undefined;

  for (const source of sources) {
    const parsed = parseYamlSource(source, validateFile, diagnostics);
    if (parsed === null) continue;
    const { data, at } = parsed;
    const expand = (pattern: string, loc: SourceLoc): string[] | null => {
      try {
        return expandRange(pattern);
      } catch (err) {
        error(loc, err instanceof Error ? err.message : String(err));
        return null;
      }
    };
    const expandAll = (patterns: string | string[], loc: SourceLoc): string[] | null => {
      const out: string[] = [];
      for (const pattern of typeof patterns === 'string' ? [patterns] : patterns) {
        const values = expand(pattern, loc);
        if (values === null) return null;
        out.push(...values);
      }
      return out;
    };

    if (data.system) {
      const loc = at(['system']);
      if (systemLoc) error(loc, `system が複数ある（最初: ${formatLoc(systemLoc)}）`);
      else {
        model.system = data.system;
        systemLoc = loc;
      }
    }

    data.devices?.forEach((input, i) => {
      const loc = at(['devices', i]);
      const ids = expand(input.id, loc);
      if (ids === null) return;
      let names = ids;
      if (input.name !== undefined) {
        const expanded = expand(input.name, loc);
        if (expanded === null) return;
        if (expanded.length !== ids.length) {
          error(loc, `name の展開数 ${expanded.length} が id の展開数 ${ids.length} と違う`);
          return;
        }
        names = expanded;
      }
      const ports: Port[] = [];
      for (const port of input.ports ?? []) {
        const portNames = expand(port.name, loc);
        if (portNames === null) return;
        for (const name of portNames) ports.push({ ...port, name, kind: port.kind ?? 'ethernet' });
      }
      const lags: Lag[] = [];
      for (const lag of input.lags ?? []) {
        const members = expandAll(lag.members, loc);
        if (members === null) return;
        lags.push({ ...lag, members });
      }
      ids.forEach((id, k) => {
        model.devices.push({
          ...input,
          id,
          name: names[k],
          ports: ports.map((p) => ({ ...p })),
          lags: lags.map((l) => ({ ...l, members: [...l.members] })),
          loc,
        });
      });
    });

    data.links?.forEach((input, i) => {
      const loc = at(['links', i]);
      const as = expand(input.a, loc);
      const bs = expand(input.b, loc);
      if (as === null || bs === null) return;
      if (as.length !== bs.length) {
        error(loc, `a の展開数 ${as.length} と b の展開数 ${bs.length} が違う（a: ${input.a}, b: ${input.b}）`);
        return;
      }
      as.forEach((aText, k) => {
        const a = parseEndpoint(aText);
        const b = parseEndpoint(bs[k]);
        if (a === null || b === null) {
          error(loc, `"機器ID:ポート名" の形式でない: ${a === null ? aText : bs[k]}`);
          return;
        }
        model.links.push({ ...input, a, b, tags: input.tags ?? [], loc });
      });
    });

    data.groups?.forEach((input, i) => {
      const loc = at(['groups', i]);
      if (input.id.includes('[')) {
        error(loc, `グループの id に範囲記法は使えない: ${input.id}`);
        return;
      }
      const members = expandAll(input.members, loc);
      if (members === null) return;
      model.groups.push({ ...input, name: input.name ?? input.id, members, loc });
    });

    data.mlags?.forEach((input, i) => {
      const loc = at(['mlags', i]);
      if (input.id.includes('[')) {
        error(loc, `mlag の id に範囲記法は使えない: ${input.id}`);
        return;
      }
      const texts = expandAll(input.members, loc);
      if (texts === null) return;
      const members: Endpoint[] = [];
      for (const text of texts) {
        const endpoint = parseEndpoint(text);
        if (endpoint === null) {
          error(loc, `"機器ID:LAG名" の形式でない: ${text}`);
          return;
        }
        members.push(endpoint);
      }
      model.mlags.push({ ...input, members, loc });
    });

    data.open_questions?.forEach((question, i) => {
      diagnostics.push({ level: 'warning', loc: at(['open_questions', i]), message: `未確定: ${question}` });
    });
  }

  if (!model.system) diagnostics.push({ level: 'warning', message: 'system（id と name）がどのファイルにもない' });
  diagnostics.push(...checkModel(model));
  diagnostics.sort(
    (x, y) => (x.loc?.file ?? '').localeCompare(y.loc?.file ?? '') || (x.loc?.line ?? 0) - (y.loc?.line ?? 0),
  );
  return { model, diagnostics };
}

function checkModel(model: Model): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const error = (loc: SourceLoc, message: string): void => void diagnostics.push({ level: 'error', loc, message });

  const devices = new Map<string, Device>();
  for (const device of model.devices) {
    const first = devices.get(device.id);
    if (first) {
      error(device.loc, `機器 id "${device.id}" が重複（最初: ${formatLoc(first.loc)}）`);
      continue;
    }
    devices.set(device.id, device);

    const ports = new Set<string>();
    for (const port of device.ports) {
      if (ports.has(port.name)) error(device.loc, `${device.id}: ポート "${port.name}" が重複`);
      ports.add(port.name);
    }
    const lagNames = new Set<string>();
    const lagOfPort = new Map<string, string>();
    for (const lag of device.lags) {
      if (lagNames.has(lag.name)) error(device.loc, `${device.id}: LAG "${lag.name}" が重複`);
      if (ports.has(lag.name)) error(device.loc, `${device.id}: LAG "${lag.name}" がポート名と同じ`);
      lagNames.add(lag.name);
      for (const member of lag.members) {
        if (!ports.has(member)) error(device.loc, `${device.id}: LAG "${lag.name}" のメンバー "${member}" が ports にない`);
        const other = lagOfPort.get(member);
        if (other !== undefined) error(device.loc, `${device.id}: ポート "${member}" が LAG "${other}" と "${lag.name}" の両方に入っている`);
        lagOfPort.set(member, lag.name);
      }
    }
  }

  const usedPorts = new Map<string, SourceLoc>();
  const checkEndpoint = (endpoint: Endpoint, link: Link): boolean => {
    const device = devices.get(endpoint.device);
    const key = `${endpoint.device}:${endpoint.port}`;
    if (!device) {
      error(link.loc, `${key}: 機器 "${endpoint.device}" が devices にない`);
      return false;
    }
    if (!device.ports.some((p) => p.name === endpoint.port)) {
      if (device.lags.some((l) => l.name === endpoint.port)) {
        error(link.loc, `${key}: LAG にはつなげない。物理ポート（メンバー）同士のリンクとして書く`);
      } else {
        error(link.loc, `${key}: ${endpoint.device} にポート "${endpoint.port}" がない`);
      }
      return false;
    }
    const first = usedPorts.get(key);
    if (first) {
      error(link.loc, `${key}: 複数のリンクで使われている（最初: ${formatLoc(first)}）`);
      return false;
    }
    usedPorts.set(key, link.loc);
    return true;
  };
  for (const link of model.links) {
    if (link.a.device === link.b.device && link.a.port === link.b.port) {
      error(link.loc, `${link.a.device}:${link.a.port}: 自分自身へのリンク`);
      continue;
    }
    checkEndpoint(link.a, link);
    checkEndpoint(link.b, link);
  }

  const mlagIds = new Set<string>();
  for (const mlag of model.mlags) {
    if (mlagIds.has(mlag.id)) error(mlag.loc, `mlag id "${mlag.id}" が重複`);
    mlagIds.add(mlag.id);
    for (const member of mlag.members) {
      const device = devices.get(member.device);
      if (!device) error(mlag.loc, `${mlag.id}: 機器 "${member.device}" が devices にない`);
      else if (!device.lags.some((l) => l.name === member.port)) {
        error(mlag.loc, `${mlag.id}: ${member.device} に LAG "${member.port}" がない`);
      }
    }
    if (new Set(mlag.members.map((m) => m.device)).size < 2) error(mlag.loc, `${mlag.id}: メンバーが 2 台以上の機器にまたがっていない`);
  }

  const groups = new Map<string, Group>();
  for (const group of model.groups) {
    if (groups.has(group.id)) error(group.loc, `グループ id "${group.id}" が重複`);
    else if (devices.has(group.id)) error(group.loc, `グループ id "${group.id}" が機器 id と同じ`);
    else groups.set(group.id, group);
  }
  const groupOfDevice = new Map<string, Group>();
  for (const group of groups.values()) {
    const seen = new Set<string>();
    for (const member of group.members) {
      if (seen.has(member)) error(group.loc, `${group.id}: メンバー "${member}" が重複`);
      seen.add(member);
      if (devices.has(member)) {
        const key = `${group.kind}/${member}`;
        const other = groupOfDevice.get(key);
        if (other && group.kind !== 'other') {
          error(group.loc, `${member} が同じ種類（${group.kind}）のグループ "${other.id}" と "${group.id}" の両方に入っている`);
        }
        groupOfDevice.set(key, group);
      } else if (!groups.has(member)) {
        error(group.loc, `${group.id}: メンバー "${member}" が devices にも groups にもない`);
      }
    }
  }
  // グループの入れ子に循環がないか（白=未訪問、灰=探索中、黒=完了）
  const state = new Map<string, 'gray' | 'black'>();
  const visit = (group: Group): void => {
    state.set(group.id, 'gray');
    for (const member of group.members) {
      const child = groups.get(member);
      if (!child) continue;
      const s = state.get(child.id);
      if (s === 'gray') error(group.loc, `グループの入れ子が循環している: ${group.id} → ${child.id}`);
      else if (s === undefined) visit(child);
    }
    state.set(group.id, 'black');
  };
  for (const group of groups.values()) if (!state.has(group.id)) visit(group);

  return diagnostics;
}
