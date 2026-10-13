// 作図の確認ループを 1 コマンドで回す：図の記述を組んで .drawio を書き（機械チェックの結果も出る）、
// draw.io 公式の描画処理で PNG にする。
//
// 使い方: npm run preview -- <図の記述.yaml>...
//   .drawio は記述と同じフォルダに、PNG は out/<リポジトリからの相対パス>.png に書く。
//   記述にエラーがあれば PNG は作らず、終了コード 1。
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('使い方: npm run preview -- <図の記述.yaml>...');
  process.exit(2);
}

const run = (script: string, args: string[]): number =>
  spawnSync(process.execPath, [resolve(root, script), ...args], { stdio: 'inherit' }).status ?? 1;

const built = run('src/cli.ts', ['build', ...files]);
const drawios = files.map((f) => resolve(f).replace(/\.ya?ml$/, '.drawio')).filter((f) => existsSync(f));
if (built !== 0 || drawios.length === 0) process.exit(built === 0 ? 1 : built);
process.exit(run('src/render.ts', drawios));
