// 型のひな形と作図の手引きの例は、Copilot がそのまま写して使う。
// どれも記述のエラーが無く、機械チェックの指摘が 0 件であることを確かめる（道具を直したときにひな形が崩れたら気づけるように）。
// 枠の大きさは文字幅で決まるので、描画と同じ BIZ UD の TTF（npm run fetch-vendor で fonts/ に取得）で組む。無ければ飛ばす。
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { loadFontMetrics } from '../src/diagram/font.ts';
import { layoutDiagram, type Fonts } from '../src/diagram/layout.ts';
import { lintLayout } from '../src/diagram/lint.ts';
import { parseDiagram } from '../src/diagram/parse.ts';

const root = resolve(import.meta.dirname, '..');
const fontPath = (name: string): string => join(root, 'fonts', name);
const fontFiles = ['BIZUDPGothic-Regular.ttf', 'BIZUDPGothic-Bold.ttf', 'BIZUDGothic-Regular.ttf'];
const haveFonts = fontFiles.every((f) => existsSync(fontPath(f)));
const fonts: Fonts | null = haveFonts
  ? {
      regular: loadFontMetrics(readFileSync(fontPath(fontFiles[0]))),
      bold: loadFontMetrics(readFileSync(fontPath(fontFiles[1]))),
      mono: loadFontMetrics(readFileSync(fontPath(fontFiles[2]))),
    }
  : null;
const skip = haveFonts ? false : 'fonts/ に BIZ UD の TTF が無い（npm run fetch-vendor）';

async function check(file: string, text: string): Promise<void> {
  assert.ok(fonts);
  const { spec, diagnostics } = parseDiagram({ file, text });
  assert.deepEqual(diagnostics.map((d) => `${d.loc?.line ?? ''} ${d.message}`), [], `${file} の記述にエラー・警告がある`);
  assert.ok(spec);
  const lint = lintLayout(await layoutDiagram(spec, fonts));
  assert.deepEqual(lint.findings, [], `${file} に機械チェックの指摘がある`);
}

describe('ひな形と手引き', () => {
  const dir = 'examples/patterns';
  for (const name of readdirSync(join(root, dir)).filter((n) => n.endsWith('.yaml')).sort()) {
    test(`${dir}/${name} は指摘 0 件`, { skip }, async () => {
      await check(`${dir}/${name}`, readFileSync(join(root, dir, name), 'utf8'));
    });
  }

  test('kit/DIAGRAMS.md の図の記述の例は、そのまま組めて指摘 0 件', { skip }, async () => {
    const guide = readFileSync(join(root, 'kit/DIAGRAMS.md'), 'utf8');
    const blocks = [...guide.matchAll(/```yaml\n(title:[\s\S]*?)```/g)].map((m) => m[1]);
    assert.ok(blocks.length > 0, '手引きに図の記述の例が無い');
    for (const [i, text] of blocks.entries()) await check(`kit/DIAGRAMS.md の例 ${i + 1}`, text);
  });
});
