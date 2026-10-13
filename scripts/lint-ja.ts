// npm run lint:ja：利用者とエージェントが読む文書を、AI が使いすぎる日本語の言葉と書き方で点検する。
// 言葉は Qiita の記事を生成 AI の前後で比べた計測にもとづく辞書（textlint-rule-preset-ai-words-ja と
// textlint/ai-words-extra.json）、書き方は @textlint-ja/textlint-rule-preset-ai-writing。設定は .textlintrc.json。
// 図の記述のテンプレート（YAML）はテキストとして点検する。指摘があれば終了コード 1。
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createLinter, loadTextlintrc } from 'textlint';

const root = resolve(import.meta.dirname, '..');
const files = [
  'README.md',
  'AGENTS.md',
  'kit/DIAGRAMS.md',
  'kit/INSTRUCTIONS.md',
  '.claude/skills/diagram/SKILL.md',
  ...readdirSync(join(root, 'examples/patterns'))
    .filter((n) => n.endsWith('.yaml'))
    .sort()
    .map((n) => `examples/patterns/${n}`),
];

const linter = createLinter({
  descriptor: await loadTextlintrc({ configFilePath: join(root, '.textlintrc.json'), node_modulesDir: join(root, 'node_modules') }),
});

let count = 0;
for (const file of files) {
  const text = readFileSync(join(root, file), 'utf8');
  // textlint は拡張子で読み方を決める。YAML 用の読み方は無いので、テキストとして渡す
  const result = await linter.lintText(text, join(root, file.endsWith('.yaml') ? `${file}.txt` : file));
  for (const m of result.messages) {
    count++;
    console.log(`${file}:${m.loc.start.line}:${m.loc.start.column} ${m.message}`);
  }
}
console.log(count === 0 ? `指摘 0 件（${files.length} ファイル）` : `指摘 ${count} 件（${files.length} ファイル）`);
process.exitCode = count === 0 ? 0 : 1;
