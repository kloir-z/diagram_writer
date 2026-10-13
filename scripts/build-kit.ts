// Copilot Chat に添付するキットを dist/kit/ に作る。
//   dw.js          src/cli.ts を依存ごと 1 ファイルにまとめたもの（Node 16 以上で動くように変換）。末尾に、まとめた npm パッケージのライセンス文
//   run.py         起動スクリプト（kit/run.py）
//   INSTRUCTIONS.md Copilot への指示（kit/INSTRUCTIONS.md）。最初に読ませる
//   DIAGRAMS.md    作図の手引き（kit/DIAGRAMS.md）
//   pattern-*.yaml 型のひな形（examples/patterns/*.yaml）
//   *.ttf, OFL.txt BIZ UD フォント（fonts/、npm run fetch-vendor で取得済みのもの）
import { appendFile, copyFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'dist/kit');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const { metafile } = await build({
  absWorkingDir: root,
  entryPoints: [resolve(root, 'src/cli.ts')],
  outfile: join(out, 'dw.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node16',
  minify: true,
  legalComments: 'eof',
  metafile: true,
  banner: { js: `// diagram_writer kit (MIT License), built ${new Date().toISOString()}. Third-party licenses are at the end of this file.` },
  logLevel: 'warning',
});
const bundled = Object.values(metafile.outputs).flatMap((o) =>
  Object.entries(o.inputs)
    .filter(([, input]) => input.bytesInOutput > 0)
    .map(([path]) => path),
);
await appendFile(join(out, 'dw.js'), await thirdPartyNotices(bundled));

for (const name of ['run.py', 'INSTRUCTIONS.md', 'DIAGRAMS.md']) await copyFile(resolve(root, 'kit', name), join(out, name));

// 型のひな形（作図の手引きの 3 章）。リポジトリでは examples/patterns/ にあり、テストで指摘 0 件を確かめている。
// Copilot Chat にはフォルダごと添付できないので、名前に pattern- を付けて平らに置く
const patternsDir = resolve(root, 'examples/patterns');
for (const name of (await readdir(patternsDir)).filter((n) => n.endsWith('.yaml'))) await copyFile(join(patternsDir, name), join(out, `pattern-${name}`));

const fontsDir = resolve(root, 'fonts');
const fonts = (await readdir(fontsDir).catch(() => [])).filter((n) => n.endsWith('.ttf') || n === 'OFL.txt');
if (fonts.length === 0) console.warn('警告: fonts/ が空。npm run fetch-vendor を実行してからキットを作り直す。');
for (const name of fonts) await copyFile(join(fontsDir, name), join(out, name));

for (const name of (await readdir(out)).sort()) {
  const { size } = await stat(join(out, name));
  console.log(`${(size / 1024).toFixed(0).padStart(7)} KB  dist/kit/${name}`);
}

interface PackageJson {
  name: string;
  version: string;
  license?: string;
  repository?: string | { url?: string };
}

// dw.js にまとめた npm パッケージのライセンス文を、dw.js の末尾のコメントにする。MIT・ISC・BSD は配布物に
// ライセンス文を含めること、elkjs の EPL-2.0 はライセンス文とソースの入手先を示すことを求める。
// ライセンス文のファイルが無いパッケージがあれば、キットを作らずに止める（欠けた配布物を黙って作らない）。
async function thirdPartyNotices(inputs: string[]): Promise<string> {
  const dirs = new Set<string>();
  for (const input of inputs) {
    const m = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input);
    if (m) dirs.add(m[1]);
  }
  const parts: string[] = [];
  for (const dir of [...dirs].sort()) {
    const pkg = JSON.parse(await readFile(join(root, dir, 'package.json'), 'utf8')) as PackageJson;
    const file = (await readdir(join(root, dir))).sort().find((n) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(n));
    if (!file) throw new Error(`${pkg.name}: ライセンス文のファイルが ${dir} に無い`);
    const text = (await readFile(join(root, dir, file), 'utf8')).trim().replace(/\*\//g, '* /');
    parts.push(`${pkg.name} ${pkg.version} (${pkg.license ?? 'license not stated'})\nSource: ${sourceUrl(pkg)}\n\n${text}`);
  }
  return `\n/*\nThird-party software bundled in this file\n\n${parts.join(`\n\n${'='.repeat(72)}\n\n`)}\n*/\n`;
}

function sourceUrl(pkg: PackageJson): string {
  const raw = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  if (!raw) return `https://www.npmjs.com/package/${pkg.name}`;
  const short = /^(?:github:)?([\w.-]+\/[\w.-]+)$/.exec(raw);
  if (short) return `https://github.com/${short[1]}`;
  return raw.replace(/^git\+/, '').replace(/\.git$/, '');
}
