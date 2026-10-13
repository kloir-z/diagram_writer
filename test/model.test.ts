import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseModel } from '../src/model/load.ts';
import { expandRange } from '../src/model/range.ts';

describe('expandRange', () => {
  test('両端の桁数が同じならゼロ埋め、違えば埋めない', () => {
    assert.deepEqual(expandRange('esx[08-10]'), ['esx08', 'esx09', 'esx10']);
    assert.deepEqual(expandRange('Eth1/[9-10]'), ['Eth1/9', 'Eth1/10']);
  });

  test('英字範囲とカンマ区切りを混ぜられる', () => {
    assert.deepEqual(expandRange('e0[a-b,M]'), ['e0a', 'e0b', 'e0M']);
    assert.deepEqual(expandRange('Eth1/[1,3-4]'), ['Eth1/1', 'Eth1/3', 'Eth1/4']);
  });

  test('複数の角括弧は左が外側のループ', () => {
    assert.deepEqual(expandRange('esx[1-2]:vmnic[0-1]'), ['esx1:vmnic0', 'esx1:vmnic1', 'esx2:vmnic0', 'esx2:vmnic1']);
  });

  test('角括弧のない名前とコロン入りの名前はそのまま', () => {
    assert.deepEqual(expandRange('et-0/0/0:1'), ['et-0/0/0:1']);
  });

  test('逆順・閉じ忘れ・入れ子・種類違いはエラー', () => {
    assert.throws(() => expandRange('p[5-1]'), /逆順/);
    assert.throws(() => expandRange('p[1-5'), /閉じていない/);
    assert.throws(() => expandRange('p1-5]'), /対応する \[ がない/);
    assert.throws(() => expandRange('p[[1-2]]'), /入れ子/);
    assert.throws(() => expandRange('p[1-a]'), /解釈できない/);
  });
});

const BASE = `
system: { id: t, name: テスト }
devices:
  - id: esx[01-02]
    kind: server
    ports: [{ name: "vmnic[0-1]" }]
  - id: leaf101
    kind: switch
    ports: [{ name: "Eth1/[1-20]" }]
    lags: [{ name: po1, members: "Eth1/[19-20]" }]
`;

function errorsOf(...texts: string[]): string[] {
  const { diagnostics } = parseModel(texts.map((text, i) => ({ file: `f${i}.yaml`, text })));
  return diagnostics.filter((d) => d.level === 'error').map((d) => `${d.loc?.file}:${d.loc?.line} ${d.message}`);
}

describe('parseModel', () => {
  test('範囲つきリンクは展開順に 1 対 1 で対応する', () => {
    const { model, diagnostics } = parseModel([
      { file: 'a.yaml', text: `${BASE}links:\n  - { a: "esx[01-02]:vmnic0", b: "leaf101:Eth1/[11-12]" }\n` },
    ]);
    assert.deepEqual(diagnostics, []);
    assert.deepEqual(
      model.links.map((l) => `${l.a.device}:${l.a.port}-${l.b.port}`),
      ['esx01:vmnic0-Eth1/11', 'esx02:vmnic0-Eth1/12'],
    );
  });

  test('展開数の不一致・ポートの二重使用・LAG への接続を行番号つきで報告する', () => {
    const errors = errorsOf(
      BASE,
      [
        'links:',
        '  - { a: "esx[01-02]:vmnic0", b: "leaf101:Eth1/[1-3]" }',
        '  - { a: esx01:vmnic1, b: leaf101:Eth1/5 }',
        '  - { a: esx02:vmnic1, b: leaf101:Eth1/5 }',
        '  - { a: esx02:vmnic0, b: leaf101:po1 }',
      ].join('\n'),
    );
    assert.deepEqual(errors, [
      'f1.yaml:2 a の展開数 2 と b の展開数 3 が違う（a: esx[01-02]:vmnic0, b: leaf101:Eth1/[1-3]）',
      'f1.yaml:4 leaf101:Eth1/5: 複数のリンクで使われている（最初: f1.yaml:3）',
      'f1.yaml:5 leaf101:po1: LAG にはつなげない。物理ポート（メンバー）同士のリンクとして書く',
    ]);
  });

  test('ファイルをまたいだ機器 id の重複を検出する', () => {
    const errors = errorsOf(BASE, 'devices:\n  - { id: esx02, kind: server }\n');
    assert.deepEqual(errors, ['f1.yaml:2 機器 id "esx02" が重複（最初: f0.yaml:4）']);
  });

  test('スキーマ違反は該当行で報告し、そのファイルは取り込まない', () => {
    const { model, diagnostics } = parseModel([
      { file: 'a.yaml', text: BASE },
      { file: 'b.yaml', text: 'devices:\n  - id: fw01\n    kind: firewal\n' },
    ]);
    assert.equal(model.devices.length, 3);
    assert.deepEqual(
      diagnostics.map((d) => `${d.loc?.file}:${d.loc?.line}`),
      ['b.yaml:3'],
    );
  });
});
