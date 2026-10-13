import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { approximateMetrics } from '../src/diagram/font.ts';
import { layoutDiagram } from '../src/diagram/layout.ts';
import { parseDiagram } from '../src/diagram/parse.ts';
import { intersects, polylineHitsBox } from '../src/diagram/geometry.ts';
import { lintLayout } from '../src/diagram/lint.ts';
import { toDrawio } from '../src/diagram/drawio.ts';
import type { Box, LaidEdge, LaidNode, Point } from '../src/diagram/types.ts';

const FONTS = { regular: approximateMetrics, bold: approximateMetrics, mono: approximateMetrics };

const errorsOf = (text: string): string[] =>
  parseDiagram({ file: 'v.yaml', text }).diagnostics.filter((d) => d.level === 'error').map((d) => `${d.loc?.line} ${d.message}`);

describe('parseDiagram', () => {
  test('存在しない端点・包含関係にある要素同士の線・id の重複を行番号つきで報告する', () => {
    const errors = errorsOf(
      [
        'title: t',
        'nodes:',
        '  - id: dc',
        '    label: DC',
        '    children:',
        '      - { id: sv, label: サーバ }',
        '  - { id: x, label: X }',
        '  - { id: x, label: 重複 }',
        'edges:',
        '  - { from: sv, to: nowhere }',
        '  - { from: dc, to: sv }',
      ].join('\n'),
    );
    assert.deepEqual(errors, [
      '8 id "x" が重複',
      '10 to "nowhere" が nodes にない',
      '11 dc と sv は包含関係にある。入れ子で表せているので線は引かない',
    ]);
  });

  test('grid の誤り（長方形でない・子の過不足・grid で並べていない要素の grid・grid の枠への補足）を報告する', () => {
    const errors = errorsOf(
      [
        'title: t',
        'grid:',
        '  - [a, b, a]',
        'nodes:',
        '  - id: a',
        '    label: A',
        '    grid: [[a1, x]]',
        '    children:',
        '      - { id: a1, label: A1 }',
        '      - { id: a2, label: A2 }',
        '  - id: b',
        '    label: B',
        '    children:',
        '      - id: b1',
        '        label: B1',
        '        grid: [[b2]]',
        '        children:',
        '          - { id: b2, label: B2 }',
        '  - { id: c, label: C }',
        'notes:',
        '  - { to: a, text: 補足 }',
      ].join('\n'),
    );
    assert.deepEqual(errors, [
      '3 図 の grid: a が長方形になっていない。同じ id は隣り合うマスに長方形に並べる',
      '3 図 の grid に c がない。子要素はすべて grid のどこかに配置する',
      '7 a の grid: x は a の子ではない',
      '7 a の grid に a2 がない。子要素はすべて grid のどこかに配置する',
      '16 b1: grid は、grid で並べた要素にだけ書ける。親（最上位なら図）にも grid を書く',
      '21 a: grid で中を並べた枠には補足を付けられない。中の要素に付ける',
    ]);
  });
});

const onBorder = (p: Point, b: Box): boolean => {
  const near = (a: number, c: number): boolean => Math.abs(a - c) < 0.5;
  const inX = p.x >= b.x - 0.5 && p.x <= b.x + b.w + 0.5;
  const inY = p.y >= b.y - 0.5 && p.y <= b.y + b.h + 0.5;
  return (inX && (near(p.y, b.y) || near(p.y, b.y + b.h))) || (inY && (near(p.x, b.x) || near(p.x, b.x + b.w)));
};

describe('layoutDiagram', () => {
  for (const direction of ['right', 'down'] as const) {
    test(`線の始点・終点は両端の要素の枠の上にある（入れ子をまたぐ線、direction: ${direction}）`, async () => {
      const { spec } = parseDiagram({
        file: 'v.yaml',
        text: [
          'title: t',
          `direction: ${direction}`,
          'nodes:',
          '  - { id: user, label: 利用者, kind: person }',
          '  - id: site',
          '    label: 拠点',
          '    kind: site',
          '    children:',
          '      - id: host',
          '        label: サーバ',
          '        children:',
          '          - { id: app, label: アプリ, kind: service }',
          '          - { id: db, label: DB, kind: data }',
          'edges:',
          '  - { from: user, to: app, label: 利用 }',
          '  - { from: app, to: db }',
          'notes:',
          '  - { to: db, text: 補足 }',
        ].join('\n'),
      });
      assert.ok(spec);
      const layout = await layoutDiagram(spec, FONTS);
      const boxes = new Map(layout.nodes.map((n) => [n.id, n.box]));
      assert.equal(layout.edges.length, 3);
      for (const e of layout.edges) {
        assert.ok(onBorder(e.points[0], boxes.get(e.from)!), `${e.id} の始点が ${e.from} の枠上にない`);
        assert.ok(onBorder(e.points[e.points.length - 1], boxes.get(e.to)!), `${e.id} の終点が ${e.to} の枠上にない`);
      }
      // 補足は対象の横（流れと直交する側）にあり、対象と重ならない。上流に置くと入ってくる線の通り道をふさぐ
      const note = layout.nodes.find((n) => n.kind === 'note')!.box;
      const db = boxes.get('db')!;
      if (direction === 'down') {
        assert.ok(note.x >= db.x + db.w && note.y < db.y + db.h && db.y < note.y + note.h, `補足が db の右にない: ${JSON.stringify({ note, db })}`);
      } else {
        assert.ok(note.y >= db.y + db.h && note.x < db.x + db.w && db.x < note.x + note.w, `補足が db の下にない: ${JSON.stringify({ note, db })}`);
      }
    });
  }

  test('凡例は空いている場所に置き、要素・線と重ねず、図の幅を広げない', async () => {
    // 上に 1 つ、下に横一列。右上が空くので、凡例はそこに入るはず（右に列を足すと、その下が丸ごと余白になる）
    const targets = ['b1', 'b2', 'b3', 'b4', 'b5'];
    const { spec } = parseDiagram({
      file: 'v.yaml',
      text: [
        'title: t',
        'direction: down',
        'nodes:',
        '  - { id: a, label: 起点, kind: server }',
        ...targets.map((t) => `  - { id: ${t}, label: 宛先 ${t}, kind: tool }`),
        'edges:',
        ...targets.map((t) => `  - { from: a, to: ${t}, class: tool }`),
      ].join('\n'),
    });
    assert.ok(spec);
    const layout = await layoutDiagram(spec, FONTS);
    const bare = await layoutDiagram({ ...spec, legend: false }, FONTS);
    const legend = layout.legend!.box;
    assert.deepEqual([layout.width, layout.height], [bare.width, bare.height], '凡例を付けると図が大きくなる');
    for (const n of layout.nodes) assert.ok(!intersects(legend, n.box), `凡例が ${n.id} に重なる`);
    for (const e of layout.edges) assert.ok(!polylineHitsBox(e.points, legend), `凡例が線 ${e.from}→${e.to} に重なる`);
  });

  test('凡例を右に足すときも、本文より幅の広いタイトル・副題には重ねない', async () => {
    const { spec } = parseDiagram({
      file: 'v.yaml',
      text: [
        'title: 短い図に長い副題',
        'subtitle: 副題が本文よりずっと長いと、右に足した凡例が副題の末尾にかぶることがあった。そうならないことを確かめる',
        'direction: right',
        'nodes:',
        '  - { id: a, label: A, kind: person }',
        '  - { id: b, label: B, kind: server }',
        'edges:',
        '  - { from: a, to: b, class: device }',
      ].join('\n'),
    });
    assert.ok(spec);
    const layout = await layoutDiagram(spec, FONTS);
    assert.ok(layout.legend, '凡例が無い');
    assert.ok(!intersects(layout.legend.box, layout.title.box), `凡例がタイトル・副題に重なる: ${JSON.stringify([layout.legend.box, layout.title.box])}`);
  });

  test('枠の中の要素へ入る矢印も、矢じりの手前に 20px 以上の直線がある', async () => {
    // 枠の外から、補足の付いた要素へ入る線（枠の中で間隔の設定が既定値に戻ると 10px で曲がっていた）
    const { spec } = parseDiagram({
      file: 'v.yaml',
      text: [
        'title: t',
        'direction: down',
        'nodes:',
        '  - { id: src, label: 送信元, kind: server }',
        '  - id: zone',
        '    label: 区画',
        '    kind: zone',
        '    children:',
        '      - { id: dst, label: 宛先, kind: gpu }',
        '      - { id: other, label: 別の要素, kind: server }',
        'edges:',
        '  - { from: src, to: dst, label: API }',
        '  - { from: src, to: other }',
        'notes:',
        '  - { to: dst, text: 受けるのは src からだけ }',
      ].join('\n'),
    });
    assert.ok(spec);
    const layout = await layoutDiagram(spec, FONTS);
    for (const e of layout.edges.filter((x) => x.cls !== 'note')) {
      const [a, b] = e.points.slice(-2);
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 20, `${e.from}→${e.to} の最後の直線が短い: ${JSON.stringify(e.points)}`);
    }
  });

  test('grid のとおりにマスへ並べて上端をそろえ、中身の少ない枠は広げず、マスをまたぐ線を両端の要素の枠までつなぐ', async () => {
    // 左・右の区画は 2 行にまたがり、真ん中の小さい区画は上の行だけ。右の区画の中は grid で横に並べる
    const { spec } = parseDiagram({
      file: 'v.yaml',
      text: [
        'title: t',
        'direction: down',
        'grid:',
        '  - [left, middle, right]',
        '  - [left, .,      right]',
        'nodes:',
        '  - id: left',
        '    label: 左',
        '    kind: site',
        '    children:',
        '      - { id: l1, label: 上, kind: pc }',
        '      - { id: l2, label: 下, kind: firewall }',
        '      - { id: l3, label: さらに下, kind: server }',
        '  - id: middle',
        '    label: 中',
        '    kind: zone',
        '    children:',
        '      - { id: m1, label: 外部, kind: cloud }',
        '  - id: right',
        '    label: 右',
        '    kind: site',
        '    grid: [[r1, r2]]',
        '    children:',
        '      - { id: r1, label: 入口, kind: firewall }',
        '      - { id: r2, label: 奥, kind: server }',
        'edges:',
        '  - { from: l1, to: l2 }',
        '  - { from: l2, to: l3 }',
        '  - { from: r1, to: r2 }',
        '  - { from: l3, to: r1, class: vpn, label: VPN }',
        '  - { from: l2, to: m1, class: blocked }',
      ].join('\n'),
    });
    assert.ok(spec);
    const layout = await layoutDiagram(spec, FONTS);
    const boxes = new Map(layout.nodes.map((n) => [n.id, n.box]));
    const [left, middle, right, r1, r2] = ['left', 'middle', 'right', 'r1', 'r2'].map((id) => boxes.get(id)!);
    assert.ok(left.x + left.w < middle.x && middle.x + middle.w < right.x, '区画が左から右に並んでいない');
    assert.deepEqual([left.y, middle.y], [right.y, right.y], '区画の上端がそろっていない');
    // 中身の少ない枠はマスいっぱいに広げない（右の区画は 2 行分のマスに対して低いまま、上端だけそろう）
    assert.ok(right.h < left.h * 0.75, '中身の少ない区画が、マスいっぱいに広げられて空白だらけになっている');
    assert.ok(middle.h < left.h, '上の行だけの区画が、空きマスの行の分まで伸びている');
    assert.ok(r1.x + r1.w < r2.x && Math.abs(r1.y - r2.y) < 0.5, '区画の中の grid で横に並んでいない');
    for (const e of layout.edges.filter((x) => x.cls !== 'note')) {
      assert.ok(onBorder(e.points[0], boxes.get(e.from)!), `${e.from}→${e.to} の始点が ${e.from} の枠上にない: ${JSON.stringify(e.points)}`);
      assert.ok(onBorder(e.points[e.points.length - 1], boxes.get(e.to)!), `${e.from}→${e.to} の終点が ${e.to} の枠上にない: ${JSON.stringify(e.points)}`);
      e.points.slice(1).forEach((q, k) => {
        const p = e.points[k];
        assert.ok(Math.abs(p.x - q.x) < 0.5 || Math.abs(p.y - q.y) < 0.5, `${e.from}→${e.to} に斜めの線分がある`);
      });
    }
    const vpn = layout.edges.find((e) => e.from === 'l3' && e.to === 'r1')!;
    assert.ok(!polylineHitsBox(vpn.points, middle), `離れた区画同士の線が間の区画を貫いている: ${JSON.stringify(vpn.points)}`);
    // 小さな図なので縦横比の指摘は出る。それ以外（重なり・貫通・ラベルのかぶり・矢じりの直前の曲がり）は出ない
    assert.deepEqual(lintLayout(layout).findings.filter((f) => !f.startsWith('横長すぎる')), []);
  });

  test('往復の線や、横にいる相手への線は大回りしない（入れ子をまたぐ戻りの線、横から出入りする近道）', async () => {
    const { spec } = parseDiagram({
      file: 'v.yaml',
      text: [
        'title: t',
        'direction: down',
        'nodes:',
        '  - id: site',
        '    label: 顧客環境',
        '    kind: site',
        '    children:',
        '      - { id: op, label: 運用担当, kind: person }',
        '      - id: sv',
        '        label: 運用サーバ',
        '        children:',
        '          - { id: ui, label: インターフェース, kind: service }',
        '          - { id: harness, label: ハーネス, kind: service }',
        '          - { id: tools, label: Ansible / Netmiko, kind: tool }',
        '          - { id: log, label: 実行記録, kind: repo }',
        '      - id: gpu',
        '        label: GPU サーバ',
        '        children:',
        '          - { id: llm, label: ローカル LLM, kind: llm }',
        '      - { id: sw, label: L3 スイッチ, kind: switch }',
        'edges:',
        '  - { from: op, to: ui, step: 1, label: 依頼 }',
        '  - { from: ui, to: harness }',
        '  - { from: harness, to: llm, class: llm, step: 2, label: 手順を計画, dir: both }',
        '  - { from: harness, to: tools, class: tool, step: 3, label: 現状を確認 }',
        '  - { from: ui, to: op, step: 4, label: 差分を提示 }',
        '  - { from: op, to: ui, class: approval, step: 5, label: 承認 }',
        '  - { from: tools, to: sw, class: device, step: 6, label: 変更を適用 }',
        '  - { from: harness, to: log, class: data, step: 7, label: 記録 }',
        'notes:',
        '  - { to: harness, text: 承認があるまで設定を変えるツールは呼べない }',
      ].join('\n'),
    });
    assert.ok(spec);
    const layout = await layoutDiagram(spec, FONTS);
    const box = (id: string): Box => layout.nodes.find((n) => n.id === id)!.box;
    // 戻りの線の折れ点が、両端の要素を囲む範囲（と曲がりの余裕）の外に出ない
    const a = box('ui');
    const b = box('op');
    const back = layout.edges.find((x) => x.from === 'ui' && x.to === 'op')!;
    assert.ok(
      back.points.every((p) => p.x >= Math.min(a.x, b.x) - 30 && p.x <= Math.max(a.x + a.w, b.x + b.w) + 30 && p.y >= b.y && p.y <= a.y + a.h),
      `戻りの線が大回りしている: ${JSON.stringify(back.points)}`,
    );
    // 曲がりの多い大回り（上下から出て、相手の脇へ回り込む）が残っていない
    for (const e of layout.edges) assert.ok(e.points.length - 2 <= 2, `${e.from}→${e.to} の曲がりが多い: ${JSON.stringify(e.points)}`);
    assert.deepEqual(lintLayout(layout).findings.filter((f) => !f.startsWith('横長すぎる') && !f.startsWith('縦長すぎる')), []);
  });

  test('grid の枠の中で線を通す隙間が無ければ、枠の余白を広げて、間の枠も端の要素も貫かずに通す', async () => {
    // A と B の間に、枠いっぱいの幅の枠 O がある。枠 F の余白（14px）だけでは O の脇を通れない
    const { spec } = parseDiagram({
      file: 'v.yaml',
      text: [
        'title: t',
        'legend: false',
        'grid: [[frame]]',
        'nodes:',
        '  - id: frame',
        '    label: F',
        '    grid: [[a], [obstacle], [b]]',
        '    children:',
        '      - { id: a, label: A }',
        '      - id: obstacle',
        '        label: O',
        '        grid: [[o1, o2]]',
        '        children:',
        '          - { id: o1, label: O1 }',
        '          - { id: o2, label: O2 }',
        '      - { id: b, label: B }',
        'edges:',
        '  - { from: a, to: b }',
      ].join('\n'),
    });
    assert.ok(spec);
    const layout = await layoutDiagram(spec, FONTS);
    const box = (id: string): Box => layout.nodes.find((n) => n.id === id)!.box;
    const e = layout.edges.find((x) => x.from === 'a' && x.to === 'b')!;
    assert.equal(e.problem, undefined, `通り道が無いとされた: ${e.problem}`);
    for (const id of ['obstacle', 'o1', 'o2', 'a', 'b']) {
      assert.ok(!polylineHitsBox(e.points, box(id)), `線が ${id} の中を通る: ${JSON.stringify(e.points)}`);
    }
    assert.deepEqual(lintLayout(layout).findings.filter((f) => !f.startsWith('縦長すぎる')), []);
  });

  test('中を grid で並べた枠も、見出しを線が横切るなら幅を広げて見出しをよける', async () => {
    const { spec } = parseDiagram({
      file: 'v.yaml',
      text: [
        'title: t',
        'legend: false',
        'direction: down',
        'grid: [[s], [a]]',
        'nodes:',
        '  - { id: s, label: Source }',
        '  - id: a',
        '    label: 長い見出しが入る枠です',
        '    grid: [[a1]]',
        '    children:',
        '      - { id: a1, label: A1 }',
        'edges:',
        '  - { from: s, to: a1 }',
      ].join('\n'),
    });
    assert.ok(spec);
    const layout = await layoutDiagram(spec, FONTS);
    const header = layout.nodes.find((n) => n.id === 'a')!.header!.box;
    for (const e of layout.edges) assert.ok(!polylineHitsBox(e.points, header), `線が見出しを横切る: ${JSON.stringify(e.points)}`);
    assert.deepEqual(lintLayout(layout).findings.filter((f) => !f.startsWith('縦長すぎる')), []);
  });

  test('線のラベルが要素の左や上にはみ出しても、図の大きさに含める（何も図の外に出ない）', async () => {
    const { spec } = parseDiagram({
      file: 'v.yaml',
      text: [
        'title: t',
        'legend: false',
        'grid: [[a], [b]]',
        'nodes:',
        '  - { id: a, label: A }',
        '  - { id: b, label: B }',
        'edges:',
        '  - { from: a, to: b, label: とても長いラベルが線の横に置かれることを確認する }',
      ].join('\n'),
    });
    assert.ok(spec);
    const layout = await layoutDiagram(spec, FONTS);
    const inside = (b: Box): boolean => b.x >= 0 && b.y >= 0 && b.x + b.w <= layout.width && b.y + b.h <= layout.height;
    for (const n of layout.nodes) assert.ok(inside(n.box), `${n.id} が図の外に出る`);
    for (const e of layout.edges) {
      if (e.label) assert.ok(inside(e.label.box), `${e.from}→${e.to} のラベルが図の外に出る: ${JSON.stringify(e.label.box)} / ${layout.width}×${layout.height}`);
      for (const p of e.points) assert.ok(inside({ ...p, w: 0, h: 0 }), `${e.from}→${e.to} の線が図の外に出る`);
    }
  });

  test('要素 40・線 60（目安の上限）で、大きさも接続もばらつく図でも、数秒で組める', async () => {
    const ids = Array.from({ length: 40 }, (_, i) => `n${i}`);
    const { spec } = parseDiagram({
      file: 'v.yaml',
      text: [
        'title: t',
        'legend: false',
        'grid:',
        ...Array.from({ length: 8 }, (_, r) => `  - [${ids.slice(r * 5, r * 5 + 5).join(', ')}]`),
        'nodes:',
        ...ids.map((id, i) => `  - { id: ${id}, label: 要素${'x'.repeat(i % 13)}, sub: [${Array.from({ length: i % 4 }, () => `補助${'q'.repeat(i % 7)}`).join(', ')}] }`),
        'edges:',
        ...Array.from({ length: 60 }, (_, i) => `  - { from: n${i % 40}, to: n${(i * 17 + 7) % 40}, label: 通信${i} }`),
      ].join('\n'),
    });
    assert.ok(spec);
    const started = Date.now();
    const layout = await layoutDiagram(spec, FONTS);
    const seconds = (Date.now() - started) / 1000;
    assert.equal(layout.edges.length, 60);
    // 以前は約 100 秒かかった（線分ごとに全障害物を調べていた）。サンドボックスの時間制限で試行錯誤ができなくなる
    assert.ok(seconds < 20, `${seconds.toFixed(1)} 秒かかった`);
  });
});

describe('toDrawio', () => {
  test('記述の id が道具の作るセルの id（補足・線・タイトル・凡例・レイヤー）と似ていても、要素も線も失われない', async () => {
    const ids = ['note-1', 'edge-1', 'title', 'legend', '0', '1'];
    const { spec } = parseDiagram({
      file: 'v.yaml',
      text: [
        'title: t',
        'grid: [[note-1, edge-1, title], [legend, "0", "1"]]',
        'nodes:',
        ...ids.map((id) => `  - { id: "${id}", label: "要素 ${id}" }`),
        'notes:',
        '  - { to: edge-1, text: 補足その一 }',
        '  - { to: edge-1, text: 補足その二 }',
        'edges:',
        '  - { from: note-1, to: edge-1 }',
        '  - { from: note-1, to: edge-1, class: data }',
        '  - { from: legend, to: "1" }',
      ].join('\n'),
    });
    assert.ok(spec);
    const xml = toDrawio(await layoutDiagram(spec, FONTS), 'p');
    const cells = [...xml.matchAll(/<mxCell id="([^"]*)"(?: value="([^"]*)")?/g)].map((m) => ({ id: m[1], value: m[2] ?? '' }));
    const cellIds = cells.map((c) => c.id);
    assert.deepEqual(cellIds.filter((id, i) => cellIds.indexOf(id) !== i), [], 'セルの id が重複している');
    for (const id of ids) {
      const cell = cells.find((c) => c.id === id);
      assert.ok(cell?.value.includes(`要素 ${id}`), `要素 ${id} が別のものに置き換わっている: ${cell?.value}`);
    }
    const edgeCells = [...xml.matchAll(/edge="1" parent="[^"]*" source="([^"]*)" target="([^"]*)"/g)].map((m) => `${m[1]}→${m[2]}`);
    assert.deepEqual(edgeCells.filter((e) => !e.includes('note:')).sort(), ['legend→1', 'note-1→edge-1', 'note-1→edge-1'].sort());
    assert.equal(edgeCells.filter((e) => e.startsWith('note:')).length, 2, '補足の点線が 2 本ない');
  });
});

describe('lintLayout', () => {
  test('矢じりの直前で曲がる線を指摘する', () => {
    const box = (x: number, y: number): Box => ({ x, y, w: 100, h: 40 });
    const findings = lintLayout({
      width: 400,
      height: 300,
      title: { lines: [], box: box(0, 0) },
      nodes: [
        { id: 'a', parent: null, kind: 'server', container: false, emphasis: false, box: box(0, 0), lines: [] },
        { id: 'b', parent: null, kind: 'server', container: false, emphasis: false, box: box(200, 200), lines: [] },
      ],
      edges: [{
        id: 'edge-1', from: 'a', to: 'b', cls: 'llm', dir: 'forward', emphasis: false,
        points: [{ x: 50, y: 40 }, { x: 50, y: 190 }, { x: 250, y: 190 }, { x: 250, y: 200 }],
      }],
    }).findings;
    assert.deepEqual(findings, ['矢じりの直前で曲がる: a→b（最後の直線 10px）']);
  });

  test('別々の線が同じ所を重なって走ると指摘し、間隔があれば指摘しない', () => {
    const box = (x: number, y: number): Box => ({ x, y, w: 100, h: 40 });
    const run = (y: number): string[] =>
      lintLayout({
        width: 400,
        height: 300,
        title: { lines: [], box: box(0, 0) },
        nodes: [
          { id: 'a', parent: null, kind: 'server', container: false, emphasis: false, box: box(0, 0), lines: [] },
          { id: 'b', parent: null, kind: 'server', container: false, emphasis: false, box: box(300, 200), lines: [] },
          { id: 'c', parent: null, kind: 'server', container: false, emphasis: false, box: box(150, 250), lines: [] },
        ],
        edges: [
          {
            id: 'edge-1', from: 'a', to: 'b', cls: 'tool', dir: 'forward', emphasis: false,
            points: [{ x: 50, y: 40 }, { x: 50, y: 100 }, { x: 350, y: 100 }, { x: 350, y: 200 }],
          },
          {
            id: 'edge-2', from: 'a', to: 'c', cls: 'tool', dir: 'forward', emphasis: false,
            points: [{ x: 60, y: 40 }, { x: 60, y }, { x: 200, y }, { x: 200, y: 250 }],
          },
        ],
      }).findings;
    // ELK の座標に混ざる誤差があっても同じ高さとみなす
    assert.deepEqual(run(100.00000000000006), ['線どうしが重なる: a→b と a→c']);
    assert.deepEqual(run(114), []);
  });

  test('関係のない枠や端の要素の中を通る線、線を隠すラベル、通り道の無い線を指摘する', () => {
    const leaf = (id: string, x: number, y: number, parent: string | null = null): LaidNode => ({
      id, parent, kind: 'server', container: false, emphasis: false, box: { x, y, w: 100, h: 40 }, lines: [],
    });
    const edge = (from: string, to: string, points: Point[], extra: Partial<LaidEdge> = {}): LaidEdge => ({
      id: `${from}-${to}`, from, to, cls: 'tool', dir: 'forward', emphasis: false, points, ...extra,
    });
    const findings = lintLayout({
      width: 600,
      height: 400,
      title: { lines: [], box: { x: 0, y: 0, w: 10, h: 10 } },
      nodes: [
        leaf('a', 0, 0),
        leaf('b', 0, 300),
        { id: 'frame', parent: null, kind: 'zone', container: true, emphasis: false, box: { x: 200, y: 100, w: 200, h: 150 }, lines: [] },
        leaf('inner', 250, 180, 'frame'),
        leaf('c', 450, 0),
        leaf('d', 450, 300),
      ],
      edges: [
        // a→b は b の上辺から入らず、b の中を通って左辺に着く
        edge('a', 'b', [{ x: 50, y: 40 }, { x: 50, y: 320 }, { x: 0, y: 320 }]),
        // c→a は枠 frame の中（inner の上）を横切る
        edge('c', 'a', [{ x: 450, y: 20 }, { x: 420, y: 20 }, { x: 420, y: 140 }, { x: 150, y: 140 }, { x: 150, y: 20 }, { x: 100, y: 20 }]),
        // c→d のラベルは、別の線 a→b の上に置かれている
        edge('c', 'd', [{ x: 500, y: 40 }, { x: 500, y: 300 }], { label: { lines: [], box: { x: 30, y: 200, w: 60, h: 18 } } }),
        edge('d', 'b', [{ x: 450, y: 330 }, { x: 100, y: 330 }], { problem: '経路が無い' }),
      ],
    }).findings;
    assert.ok(findings.includes('線が端の要素の中を通る: a→b が b の中を通る'), findings.join('\n'));
    assert.ok(findings.includes('線が関係のない枠を通る: c→a が frame の中を通る'), findings.join('\n'));
    assert.ok(findings.includes('線のラベルが線を隠す: c→d のラベルが a→b に重なる'), findings.join('\n'));
    assert.ok(findings.some((f) => f.startsWith('配線の問題: d→b は経路が無い')), findings.join('\n'));
  });
});
