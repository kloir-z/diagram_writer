// diagram_writer の CLI。リポジトリでは `node src/cli.ts`、Copilot キットでは bundle した `node dw.js` として動く。
// キットは Node のバージョンが分からない環境で動かすので、Node 16 にある API だけを使う。
//   validate <モデルのディレクトリ>...          物理構成モデルの検証
//   build <図の記述.yaml>... [--out-dir DIR] [--svg]    図の記述 → .drawio（と機械チェックの結果。--svg で確認用の SVG も）
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { toDrawio } from './diagram/drawio.ts';
import { toSvg } from './diagram/svg.ts';
import { approximateMetrics, loadFontMetrics, type FontMetrics } from './diagram/font.ts';
import { layoutDiagram, type Fonts } from './diagram/layout.ts';
import { lintLayout } from './diagram/lint.ts';
import { parseDiagram } from './diagram/parse.ts';
import { parseModel } from './model/load.ts';
import { formatLoc, type Diagnostic } from './source.ts';

const USAGE = [
  '使い方:',
  '  node dw.js validate <モデルのディレクトリ>...',
  '  node dw.js build <図の記述.yaml>... [--out-dir DIR] [--svg]',
].join('\n');

function displayPath(path: string): string {
  const rel = relative(process.cwd(), path);
  return rel === '' ? '.' : rel.startsWith('..') || isAbsolute(rel) ? path : rel;
}

function printDiagnostics(diagnostics: Diagnostic[]): number {
  for (const d of diagnostics) {
    const where = d.loc ? `${formatLoc(d.loc)}: ` : '';
    console.log(`${where}${d.level === 'error' ? 'エラー' : '警告'}: ${d.message}`);
  }
  return diagnostics.filter((d) => d.level === 'error').length;
}

function validate(dirs: string[]): number {
  let errors = 0;
  for (const arg of dirs) {
    const dir = resolve(arg);
    const display = displayPath(dir);
    const names = readdirSync(dir).filter((n) => /\.ya?ml$/.test(n)).sort();
    const sources = names.map((name) => ({ file: join(display, name), text: readFileSync(join(dir, name), 'utf8') }));
    const { model, diagnostics } = parseModel(sources);
    const errorCount = printDiagnostics(diagnostics);
    const ports = model.devices.reduce((n, d) => n + d.ports.length, 0);
    const lags = model.devices.reduce((n, d) => n + d.lags.length, 0);
    console.log(
      `${display}: ファイル ${names.length} / 機器 ${model.devices.length} / ポート ${ports} / LAG ${lags} / mlag ${model.mlags.length} / ` +
        `リンク ${model.links.length} / グループ ${model.groups.length} / エラー ${errorCount}、警告 ${diagnostics.length - errorCount}`,
    );
    errors += errorCount;
  }
  return errors > 0 ? 1 : 0;
}

/** BIZ UD の TTF を探す。キットでは dw.js と同じ場所、リポジトリでは fonts/。 */
function loadFonts(): { fonts: Fonts; found: boolean } {
  const scriptDir = dirname(resolve(process.argv[1] ?? '.'));
  const dirs = [
    process.env.DW_FONT_DIR ?? '',
    scriptDir,
    join(scriptDir, '..', 'fonts'),
    join(process.cwd(), 'fonts'),
    process.cwd(),
    join(homedir(), '.local', 'share', 'fonts', 'diagram_writer'),
  ].filter(Boolean);
  const find = (file: string): FontMetrics | null => {
    for (const dir of dirs) {
      const path = join(dir, file);
      if (existsSync(path)) return loadFontMetrics(readFileSync(path));
    }
    return null;
  };
  const regular = find('BIZUDPGothic-Regular.ttf');
  const bold = find('BIZUDPGothic-Bold.ttf');
  const mono = find('BIZUDGothic-Regular.ttf');
  return {
    fonts: { regular: regular ?? approximateMetrics, bold: bold ?? regular ?? approximateMetrics, mono: mono ?? approximateMetrics },
    found: regular !== null && mono !== null,
  };
}

async function build(args: string[]): Promise<number> {
  const svg = args.includes('--svg');
  const rest = args.filter((a) => a !== '--svg');
  const outIndex = rest.indexOf('--out-dir');
  const outDir = outIndex >= 0 ? rest[outIndex + 1] : undefined;
  const files = outIndex >= 0 ? [...rest.slice(0, outIndex), ...rest.slice(outIndex + 2)] : rest;
  if (files.length === 0 || (outIndex >= 0 && outDir === undefined)) {
    console.error(USAGE);
    return 2;
  }
  const { fonts, found } = loadFonts();
  if (!found) console.log('警告: BIZ UD の TTF が見つからない。文字幅を概算で決めるので、枠の大きさがずれる');
  let errors = 0;
  for (const arg of files) {
    const path = resolve(arg);
    const { spec, diagnostics } = parseDiagram({ file: displayPath(path), text: readFileSync(path, 'utf8') });
    errors += printDiagnostics(diagnostics);
    if (spec === null) continue;
    const layout = await layoutDiagram(spec, fonts);
    const name = basename(path).replace(/\.ya?ml$/, '');
    const out = join(outDir ? resolve(outDir) : dirname(path), `${name}.drawio`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, toDrawio(layout, spec.title));
    // 確認用の SVG（キットではこれを Chromium で PNG にする。正は .drawio）
    if (svg) writeFileSync(out.replace(/\.drawio$/, '.svg'), toSvg(layout));
    const lint = lintLayout(layout);
    console.log(`${displayPath(out)}: ${lint.summary}`);
    for (const f of lint.findings) console.log(`  チェック: ${f}`);
  }
  return errors > 0 ? 1 : 0;
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'validate' && args.length > 0) return validate(args);
  if (command === 'build' && args.length > 0) return build(args);
  console.error(USAGE);
  return 2;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  },
);
