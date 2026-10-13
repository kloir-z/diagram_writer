// 図の記述（YAML 1 ファイル = 1 枚）のスキーマ検証と整合性チェック。
import { Ajv } from 'ajv';
import schema from '../../schema/diagram.schema.json' with { type: 'json' };
import { parseYamlSource, type Diagnostic, type SourceFile, type SourceLoc } from '../source.ts';
import { gridAreas } from './grid.ts';
import { isContainerKind } from './theme.ts';
import type { DiagramSpec, NodeSpec } from './types.ts';

const validate = new Ajv({ allErrors: true, allowUnionTypes: true }).compile<DiagramSpec>(schema);

/** 1 枚に載せる量の目安。超えたら分割かまとめを促す */
const MAX_LEAVES = 40;
const MAX_EDGES = 60;
const MAX_LINE_CHARS = 30;

export function parseDiagram(source: SourceFile): { spec: DiagramSpec | null; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const parsed = parseYamlSource(source, validate, diagnostics);
  if (parsed === null) return { spec: null, diagnostics };
  const { data: spec, at } = parsed;
  const error = (loc: SourceLoc, message: string): void => void diagnostics.push({ level: 'error', loc, message });
  const warn = (loc: SourceLoc, message: string): void => void diagnostics.push({ level: 'warning', loc, message });

  const ancestors = new Map<string, string[]>();
  let leaves = 0;
  const walk = (nodes: NodeSpec[], path: (string | number)[], chain: string[]): void => {
    nodes.forEach((n, i) => {
      const p = [...path, i];
      if (ancestors.has(n.id)) error(at([...p, 'id']), `id "${n.id}" が重複`);
      ancestors.set(n.id, chain);
      const children = n.children ?? [];
      if (children.length === 0) leaves++;
      if (children.length === 0 && n.kind !== undefined && isContainerKind(n.kind)) {
        warn(at(p), `${n.id}: kind ${n.kind} は子要素（children）があるときに使う`);
      }
      for (const text of [n.label, ...[n.sub ?? []].flat(), ...[n.specs ?? []].flat()]) {
        for (const l of text.split('\n')) {
          if ([...l].length > MAX_LINE_CHARS) warn(at(p), `${n.id}: 1 行が長い（${[...l].length} 文字）。改行するか短くする: ${l}`);
        }
      }
      walk(children, [...p, 'children'], [...chain, n.id]);
    });
  };
  walk(spec.nodes, ['nodes'], []);

  (spec.edges ?? []).forEach((e, i) => {
    const loc = at(['edges', i]);
    const from = ancestors.get(e.from);
    const to = ancestors.get(e.to);
    if (from === undefined) error(loc, `from "${e.from}" が nodes にない`);
    if (to === undefined) error(loc, `to "${e.to}" が nodes にない`);
    if (from === undefined || to === undefined) return;
    if (e.from === e.to) error(loc, `${e.from}: 自分自身への線`);
    else if (to.includes(e.from) || from.includes(e.to)) {
      error(loc, `${e.from} と ${e.to} は包含関係にある。入れ子で表せているので線は引かない`);
    }
  });
  // grid：並べる要素はちょうどその階層の子。grid は、grid で並べた要素（と図全体）にだけ書ける
  const gridFrames = new Set<string>();
  const checkGrid = (grid: string[][], children: NodeSpec[], path: (string | number)[], owner: string): void => {
    const { areas, errors } = gridAreas(grid);
    for (const message of errors) error(at(path), `${owner} の grid: ${message}`);
    const ids = new Set(children.map((c) => c.id));
    for (const id of areas.keys()) if (!ids.has(id)) error(at(path), `${owner} の grid: ${id} は${owner === '図' ? '最上位の要素' : ` ${owner} の子`}ではない`);
    for (const id of ids) if (!areas.has(id)) error(at(path), `${owner} の grid に ${id} がない。子要素はすべて grid のどこかに配置する`);
  };
  const walkGrid = (nodes: NodeSpec[], path: (string | number)[], placed: boolean): void => {
    nodes.forEach((n, i) => {
      const p = [...path, i];
      if (n.grid !== undefined) {
        if ((n.children ?? []).length === 0) error(at([...p, 'grid']), `${n.id}: grid は子要素（children）があるときに使う`);
        else if (!placed) error(at([...p, 'grid']), `${n.id}: grid は、grid で並べた要素にだけ書ける。親（最上位なら図）にも grid を書く`);
        else {
          gridFrames.add(n.id);
          checkGrid(n.grid, n.children ?? [], [...p, 'grid'], n.id);
        }
      }
      walkGrid(n.children ?? [], [...p, 'children'], gridFrames.has(n.id));
    });
  };
  if (spec.grid !== undefined) checkGrid(spec.grid, spec.nodes, ['grid'], '図');
  walkGrid(spec.nodes, ['nodes'], spec.grid !== undefined);
  (spec.notes ?? []).forEach((n, i) => {
    if (!ancestors.has(n.to)) error(at(['notes', i]), `to "${n.to}" が nodes にない`);
    else if (gridFrames.has(n.to)) error(at(['notes', i]), `${n.to}: grid で中を並べた枠には補足を付けられない。中の要素に付ける`);
  });

  if (leaves > MAX_LEAVES) warn(at(['nodes']), `要素が ${leaves} 個ある（目安 ${MAX_LEAVES} 個まで）。図を分けるか、同種をまとめる`);
  const edgeCount = (spec.edges ?? []).length;
  if (edgeCount > MAX_EDGES) warn(at(['edges']), `線が ${edgeCount} 本ある（目安 ${MAX_EDGES} 本まで）。図を分けるか、並行する線をまとめる`);

  return { spec: diagnostics.some((d) => d.level === 'error') ? null : spec, diagnostics };
}
