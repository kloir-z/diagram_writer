// YAML ソースの読み込み・スキーマ検証と、行番号付きの診断（モデルと図の記述で共通）。
// 診断は「ファイル:行: メッセージ」で返す。生成元（Copilot）がそのまま読んで直せる形にする。
import type { ErrorObject, ValidateFunction } from 'ajv';
import { isNode, LineCounter, parseDocument, type Document } from 'yaml';

export interface SourceFile {
  /** 診断に出す名前 */
  file: string;
  text: string;
}

export interface SourceLoc {
  file: string;
  line: number;
}

export interface Diagnostic {
  level: 'error' | 'warning';
  loc?: SourceLoc;
  message: string;
}

export interface ParsedSource<T> {
  data: T;
  /** YAML 上のパス（例 ['nodes', 2, 'label']）の行 */
  at: (path: (string | number)[]) => SourceLoc;
}

export function formatLoc(loc: SourceLoc): string {
  return `${loc.file}:${loc.line}`;
}

function formatAjvError(err: ErrorObject): string {
  const where = err.instancePath === '' ? '(ファイル直下)' : err.instancePath;
  switch (err.keyword) {
    case 'additionalProperties':
      return `${where}: 未知のキー "${err.params.additionalProperty}"`;
    case 'required':
      return `${where}: 必須キー "${err.params.missingProperty}" がない`;
    case 'enum':
      return `${where}: 値は ${err.params.allowedValues.join(' | ')} のどれか`;
    case 'pattern':
      return `${where}: 形式が違う（正規表現 ${err.params.pattern}）`;
    case 'type':
      return `${where}: 型は ${err.params.type}`;
    default:
      return `${where}: ${err.message ?? err.keyword}`;
  }
}

/** YAML 上のパスに対応する行。パスの先が無ければ親へさかのぼる。 */
function lineAt(doc: Document, counter: LineCounter, path: (string | number)[]): number {
  for (let len = path.length; len >= 0; len--) {
    const node = doc.getIn(path.slice(0, len), true);
    if (isNode(node) && node.range) return counter.linePos(node.range[0]).line;
  }
  return 1;
}

/** 構文エラー・スキーマ違反は diagnostics に積んで null を返す。空のファイルも null。 */
export function parseYamlSource<T>(
  { file, text }: SourceFile,
  validate: ValidateFunction<T>,
  diagnostics: Diagnostic[],
): ParsedSource<T> | null {
  const counter = new LineCounter();
  const doc = parseDocument(text, { lineCounter: counter, prettyErrors: false });
  if (doc.errors.length > 0) {
    for (const err of doc.errors) {
      diagnostics.push({ level: 'error', loc: { file, line: counter.linePos(err.pos[0]).line }, message: `YAML 構文エラー: ${err.message}` });
    }
    return null;
  }
  const data: unknown = doc.toJS();
  if (data === null || data === undefined) return null;
  if (!validate(data)) {
    for (const err of validate.errors ?? []) {
      const path = err.instancePath.split('/').slice(1).map((s) => (/^\d+$/.test(s) ? Number(s) : s));
      diagnostics.push({ level: 'error', loc: { file, line: lineAt(doc, counter, path) }, message: formatAjvError(err) });
    }
    return null;
  }
  return { data, at: (path) => ({ file, line: lineAt(doc, counter, path) }) };
}
