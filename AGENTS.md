# AGENTS.md

エンタープライズ物理 IT インフラ（仮想化基盤・コンテナ基盤・マルチコントローラーストレージ・Cisco ACI・冗長化 LB など）の詳細な構成図を、**構造化モデルから生成し、人間が draw.io で後から編集できる形**で出すツールを作るリポジトリ。

ツールは「Copilot キット」として、会社の M365 Copilot Chat のコード実行サンドボックスで動かす。実データ（設計書など）は Copilot 側でだけ扱い、このリポジトリには来ない。ここでは架空データでツールを作って試し、キット（`dist/kit/`）を出す。

公開リポジトリ（GitHub）。主な成果物はキットで、利用者向けの説明（入手・添付・プロンプト）は `README.md`。サンプルは架空のごく簡単なもの（`examples/patterns/`、`examples/basic/`）だけを格納し、大きなサンプルや依頼ごとの図は `work/`（.gitignore）に格納する。

## 現状

実装済み：
- 図の記述（座標なしの YAML）→ ELK と自前の配置・経路探索でレイアウト → `.drawio` と機械チェック（`schema/diagram.schema.json`、`src/diagram/`、`src/cli.ts build`）
- 作図の仕組み：依頼を受けてから納品までの手引き `kit/DIAGRAMS.md`（質問の仕方・設計メモ・パターンの選び方・語彙・指摘の修正方法・確認観点）、パターンのテンプレート `examples/patterns/`（全体像・工程・接続と境界・比較）、このリポジトリで図を作るときの skill `.claude/skills/diagram/`、1 コマンドの確認ループ `npm run preview`
- サンプル：`examples/patterns/`（パターンのテンプレート。テストで指摘 0 件を確認している）と `examples/basic/`（物理構成モデル）
- 物理構成モデル（機器・ポート・配線）のスキーマ・範囲記法・検証（`schema/model.schema.json`、`src/model/`、`src/cli.ts validate`）
- キット：`dw.js`（CLI を 1 ファイルにまとめたもの）、`run.py`（起動・環境検出・フォント導入・確認用 PNG）、`INSTRUCTIONS.md`（Copilot が最初に読む指示）、`DIAGRAMS.md`、`pattern-*.yaml`
- 確認用の PNG：開発では draw.io 公式の描画処理（`src/render.ts`）、キットではレイアウト結果から自前で書いた SVG（`src/diagram/svg.ts`）を Chromium で PNG にする

未実装：
- 物理構成モデルから図の記述への変換（ポート単位の配線図）、論理オブジェクト（VLAN、SVM/LIF、ACI テナント、LB の VIP など）

下記のうち未実装部分は設計方針。実装したらこのファイルを更新する。

## 図を作る依頼の流れ

利用者が「〜の図を作って」と資料を添付したら、AI（このリポジトリでは skill `diagram`、Copilot ではキットの `INSTRUCTIONS.md` → `DIAGRAMS.md`）が次の順に進める。手順の本文は `kit/DIAGRAMS.md`。

1. 資料を読み、理解したこと・作る図の案（1 枚 1 テーマ）・質問（答えで図が変わるものだけ、最大 5 つ、仮の前提つき）を返す
2. 設計メモ（読者・伝えたいこと・図の一覧とパターン・未確定事項）を書く
3. パターンのテンプレートを写して図の記述を書く
4. 生成する → 機械チェックの指摘を 0 件にする → PNG を見て修正する
5. `.drawio`・PNG・設計メモ・仮定した事項の一覧を納品する

図の出来は、ツール（配置・配線・チェック）と、手引き・テンプレート（AI が最初から良い記述を書けること）の両方で決まる。図の見た目の問題を見つけたら、サンプルの YAML をいじって隠さず、ツールか手引き・テンプレートのどちらを修正すべきかを考える。テンプレートと手引きの例はテスト（`test/examples.test.ts`）で指摘 0 件を保つ。

## 実行環境：Copilot Chat のサンドボックス

利用者が実際に確認した内容（2026-10 時点）：Python 3.12 前後、Microsoft の Linux（Azure Linux 系）、メモリ 4〜8 GB、ディスク約 40 GB、Node あり、Chromium あり、Pillow あり、日本語フォントは Noto Sans 系、インターネット接続なし、書き込めるフォルダあり、OneDrive へ書き出し可。

公式資料で分かること：Python を実行する隔離 VM がセッションごとに新しく作られ、終わると破棄される。外部との通信はできない。時間・CPU・メモリ・ディスクに上限がある（数値は非公開）。添付できる形式は `.js` `.py` `.md` `.json` `.yaml` など（[file formats](https://support.microsoft.com/en-us/microsoft-365-copilot/file-formats-supported-by-microsoft-365-copilot)）。

**版は変わる前提で作る。** 入っているツールの種類はあまり変わらないが、版は予告なく変わる。

- `run.py` は標準ライブラリだけ・Python 3.8 の文法で書く。Node・Chromium・フォントの場所は毎回探す（PATH、Playwright のブラウザ格納場所、`CHROME_PATH`）。特定のパスや版を決め打ちしない。
- `dw.js` は esbuild で Node 16 向けにまとめる。`src/cli.ts` は Node 16 にある API だけを使う。サンドボックスで `npm install` はできない（通信不可）ので、依存はすべて `dw.js` に入れる。
- 中核（`src/model/` など、今後の layout/emit/check も）はファイル入出力をしない純粋な関数にする。Node が無くなっても、同じコードを Chromium の中で動かせるようにしておくため。
- Chromium はコマンドラインの `--headless --screenshot` だけで使う（puppeteer などは入れない）。古い版でも新しい版でも通るフラグに限る。
- 図のプレビューは、レイアウト結果から自前で出す SVG を Chromium で PNG にする。draw.io 本体（`app.min.js` 10 MB）はキットに入れない。`.drawio` が draw.io でも同じ見た目になるかは、このリポジトリで `src/render.ts`（draw.io 公式の描画処理）を使って架空データで確認する。
- フォントは BIZ UD の TTF をキットに同梱して添付する。`run.py` が `~/.local/share/fonts/` に入れて `fc-cache` する。無ければ代替フォントで続行し、その旨を出す。
- キットは添付するので小さく保つ。Copilot に `dw.js` やフォントを読ませない（指示書に明記済み）。

## 基本方針

- **AI が図を設計し、ツールが作図する**。目的は決まったパターンの図ではなく、入力（物理・論理・概念・コンポーネント間の関係など）に合わせて、優れたモデル（Copilot の Opus 5.5 など）が読者と伝えたいことを決め、図の切り口・まとめ方・強調点を設計すること。ツールは文字幅の計測・配置・配線・`.drawio` 出力・機械チェックを担当する。
- **座標を AI に書かせない**。AI が書くのは設計メモと図の記述（包含・関係・流れの向き・強調・補足）だけ。座標・寸法・配線経路はプログラムが決める。
- **1 枚 1 テーマ**。読者と目的ごとに 1 枚ずつ作る。詰め込むより分割する（目安は要素 40・線 60 まで。超えると検証が警告する）。
- **余白は詰める**。一目で見える範囲を広くすることを、崩れにくさや後から要素を足す余地より優先する。後から足すときは再生成すればよい。
- **成果物は `.drawio`**。人間は diagrams.net（Web）で開いて修正できる。PNG は確認用の派生物。
- **レイアウトは ELK（elkjs）**。入れ子のコンテナと直交配線をまとめて扱えるため。Graphviz は `splines=ortho` でポートとエッジラベルを扱えず、D2/Mermaid は細かな制御と GUI 編集に向かない。
- **フォントは BIZ UDPGothic / BIZ UDGothic**。
- **文章の言葉づかい**。利用者が読む文章（キット・README・図・ツールのメッセージ）は、IT の設計書で普通に使う言葉で書く。英語の直訳や比喩、AI が使いすぎる言葉と書き方は避ける。Qiita の記事を生成 AI の前後で比べた計測にもとづく辞書で `npm run lint:ja` が点検する。キットの中では使えないので、同じ一覧を `kit/DIAGRAMS.md` の「言葉づかい」に載せる。

## 技術スタック

- Node.js 24（開発時。`.ts` を型ストリッピングでそのまま実行。enum・namespace など非消去型構文は使わない）。キットは esbuild で Node 16 向けの `dw.js` にまとめる。
- `elkjs`：レイアウト（`layered`、`elk.edgeRouting=ORTHOGONAL`、`elk.hierarchyHandling=INCLUDE_CHILDREN`）
- `opentype.js` か `fontkit`：BIZ UD の TTF（描画と同じもの）で文字幅を測ってノード・ポートの寸法を決める
- `yaml` + JSON Schema（`ajv`）：モデルの検証
- 開発用の PNG 書き出し：draw.io 公式の書き出し処理（`export3.html` が使う `js/export.js` の `render()`）を `vendor/drawio/` に格納し、`puppeteer-core` でこの PC の Chrome/Edge をヘッドレス起動して動かす。

## ディレクトリ構成

```
README.md                 利用者向けの説明（キットの入手・使い方・プロンプト）
LICENSE                   MIT
kit/run.py                サンドボックス用の起動スクリプト（そのままキットに入る）
kit/INSTRUCTIONS.md       Copilot への指示の入口（作業の振り分け・物理構成モデルの書き方）
kit/DIAGRAMS.md           作図の手引き（依頼を受けてから納品まで。キットとこのリポジトリの skill で共通）
dist/kit/                 npm run kit の出力。Copilot Chat に添付する一式（.gitignore）
schema/diagram.schema.json 図の記述（1 ファイル = 1 枚）の JSON Schema
schema/model.schema.json  物理構成モデル（1 ファイル分）の JSON Schema
src/
  cli.ts                  CLI（キットでは dw.js になる）。build / validate
  source.ts               YAML 読み込み・スキーマ検証・行番号付き診断（共通）
  diagram/                図の記述 → レイアウト → .drawio・機械チェック（純粋関数）
    parse.ts              記述の検証（id 重複、端点、包含関係にある線、grid の過不足、詰め込みすぎ）
    font.ts               TTF から文字送り幅を読む（BIZ UD で枠の大きさを実測）
    theme.ts              意味 → 色・線種・文字の対応（図ごとに色を選ばせない）
    grid.ts               grid（ざっくりした配置）の読み取り：マスの範囲・長方形でない id
    layout.ts             ELK で配置・配線（grid なし：全体を 1 回で / grid：マスに配置した要素ごとにレイアウトして並べる）。枠の見出しを線が横切らない位置に配置する
    route.ts              grid の別々のマスにまたがる線の経路探索（直交、障害物よけ、四辺どこからでも出入り）
    shortcut.ts           配置の後で、迂回している線を横から出入りする短い経路に置き換える
    drawio.ts             mxfile 出力（入れ子＝コンテナ、線＝要素に接続、折れ点＝waypoint）
    svg.ts                確認用の SVG（キットで Chromium を使って PNG にする。正は .drawio）
    lint.ts               重なり・貫通・関係のない枠や端の要素の中を通る線・見出しやラベルとの重なり・ラベルが線を隠す・矢じりの直前の曲がり・線どうしの重なり・経路の無い線・交差数・縦横比・占有率
  model/                  物理構成モデル：範囲記法の展開・読み込み・整合性チェック（純粋関数）
  render.ts               開発用：.drawio → PNG（draw.io 公式の描画処理）
scripts/build-kit.ts      キットを作る
scripts/preview.ts        npm run preview：図の記述 → .drawio と機械チェック → PNG（確認ループを 1 コマンドで）
scripts/lint-ja.ts        npm run lint:ja：文書の言葉づかいの点検（設定は .textlintrc.json、追加の語は textlint/ai-words-extra.json）
scripts/fetch-vendor.ts   vendor/ と fonts/ の取得・検証
vendor.lock.json          取得元 URL（タグ/コミット固定）と sha256
vendor/drawio/            draw.io の描画用ファイル（開発用、.gitignore）
fonts/                    BIZ UD の TTF と OFL.txt（.gitignore）
examples/                 架空のごく簡単なデータ。patterns/ はパターンのテンプレート（全体像・工程・接続と境界・比較。キットに pattern-*.yaml として入る）、basic/ は物理構成モデルのサンプル、render-smoke.drawio は描画系の確認用（アイコンの縦横比崩れと文字のはみ出しを含む）
work/                     このリポジトリで依頼を受けて図を作るときの作業場所（依頼ごとにフォルダ。.gitignore）
.claude/skills/diagram/   図を作る依頼を受けたときの skill（手順の本体は kit/DIAGRAMS.md）
test/                     node:test のテスト
out/                      開発用 PNG（.gitignore）
```

## 図の記述

形式の定義は `schema/diagram.schema.json`、型は `src/diagram/types.ts`、AI 向けの書き方の説明は `kit/DIAGRAMS.md`（語彙の表・パターン・書き方の決まり）、サンプルは `examples/patterns/`。1 ファイル = 1 枚。

- `nodes` の入れ子が包含関係（拠点 → 区画 → サーバ → サービスなど）。子要素のある要素は枠になる。`kind` は意味（`gpu`、`llm`、`tool`、`firewall`、`site`、`zone` など）で、色は `theme.ts` が決める。クラウドの LLM も `llm`（配置場所は枠で示す）、LLM 以外の外部サービスは `cloud`。
- `edges` は関係。`class` で色と線種が決まり、凡例は使ったものだけ自動で付く。人の操作は `user`、仕組みどうしの依頼・工程の順番は `flow`（灰・開いた矢じり）、開発・構築は `build`（破線）、時期・段階の移行は `transition`（太い矢印）。ほかに `llm`、`tool`、`device`、`vpn`、`data`、`approval`、`blocked`。`step` で ①〜⑳ を付けて手順を表す。`emphasis` で太くする。
- 区画（`zone`）の枠の色（`tone`）の意味は凡例に載る（自社・顧客・制限区画・外部）。ネットワーク機器の黄色と顧客の区画の黄色のように、色の近いものを混同しないため。
- `direction`（`right` / `down`）が流れの向き。`layer` で段を揃えられる。`notes` は補足で、対象の横（流れと直交する側：`down` なら右、`right` なら下）に配置され、短い点線で対象と結ばれる。
- `grid` はざっくりした配置。行ごとに要素の id を並べ（`.` は空き）、同じ id を隣り合うマスに書くと、その範囲にまたがる（長方形に限る）。図の `grid` には最上位の要素を、枠の `grid` にはその枠の子を、すべて配置する。枠の `grid` は、grid で並べた要素にだけ書ける。マスに配置した要素の中は `direction` でレイアウトする。同じ行・列の枠は上端・左端をそろえ、大きさが近い枠（マスの 3/4 以上）はマスいっぱいに広げて高さ・幅もそろえる。要素の少ない枠は広げない（空白だらけの枠にしない）。空きマスだけの行（列）があると、またがる要素の分はそこが伸びる（例：`[[customer, internet], [customer, .]]` なら、インターネットの枠は上の行の高さのまま）。`grid` が無ければ、つながりに沿って全体を 1 回で並べる（`flow`）。横長の資料（16:9 など）は、まず「どこに何を配置するか」を `grid` で決め、図で追う流れ（依頼や通信の流れ）が一方向に読めるように並べる。
- 包含関係にある要素同士は線でつながない（入れ子で表せている）。
- `build` の機械チェックの指摘（重なり・貫通・見出しとの重なり・縦横比など）は、記述を修正して解消する（向きを変える、見出しを短くする、補足を足して枠を広げる、図を分けるなど）。

## 物理構成モデル

形式の定義は `schema/model.schema.json`、書き方の説明と例は `kit/INSTRUCTIONS.md`、動くサンプルは `examples/basic/`。現在は物理層だけ（機器・ポート・LAG・vPC/MLAG・グループ・配線）。

- 機器 id・ポート名で参照する。リンクの端は「機器ID:ポート名」（機器 id に `:` は使えないので最初の `:` で分ける。Juniper の `et-0/0/0:1` のようなポート名も通る）。
- 範囲記法（`Eth1/[1-48]`、`esx[01-08]`、`e0[a-d]`、`[1,3,5-6]`）で同じ形の機器・ポート・配線をまとめて書く。Copilot の出力量と読み込み量が減る。
- リンクは物理ポート同士だけ。LAG はメンバーの各リンク＋`lags`、vPC/MLAG は両側の LAG＋`mlags` で表す。
- 元資料で確定できない点は値を推測で埋めず `open_questions` に書く（検証で警告として出る）。
- 機器固有の名前（`e0a`、`Eth1/49`、`vmnic0`、`a0a-110`、EPG 名）は**ベンダー表記のまま**。翻訳・正規化しない。説明的なラベル（`role`、`note`）は日本語。
- 実在の顧客データ（実 IP、実ホスト名、シリアル、WWPN、秘密情報）はこのリポジトリに格納しない。サンプルは架空名と RFC 5737（`192.0.2.0/24` 等）/ RFC 3849 のアドレスを使う。
- スキーマを変えたら `kit/INSTRUCTIONS.md`、`examples/basic/`、`src/model/types.ts`、テストを同じ変更で揃える。`kit/INSTRUCTIONS.md` の例は検証が通る状態に保つ。

## Copilot での作業の流れ

1. 人間が `dist/kit/` の一式と元資料を Copilot Chat に添付し、「INSTRUCTIONS.md に従って作業して」と頼む。
2. Copilot が `python run.py env` で環境を確認し、元資料からモデル YAML を書き、`python run.py validate model` のエラーが 0 件になるまで自分で修正する。
3. 図を頼まれたら、`DIAGRAMS.md` の手順（質問 → 設計メモ → テンプレートから記述 → `python run.py preview` で生成して PNG を見る → 修正する）で `.drawio` と PNG を出力する。
4. `open_questions` は人間が判断する。

検証が保証するのは形式と整合性（参照先の存在、ポートの二重使用、範囲の展開数など）だけ。元資料との一致は保証しないので、図にした後に人間が確認する。

## ドメイン別に描き分けるビュー

1 ビュー＝1 つのテーマを示す図。詰め込むより分割する。

| ドメイン | 主なビュー | 必ず表現するもの |
|---|---|---|
| 共通 | 物理配線図 | 機器・ポート・ケーブル（速度、媒体）、LAG/vPC/MLAG、管理系の分離 |
| 仮想化（vSphere 等） | ホスト・ネットワーク図 | クラスター、ホスト、vmnic → vDS/uplink → ポートグループ（VLAN）、VMkernel（管理/vMotion/vSAN/NFS/iSCSI）、上位スイッチのポート |
| コンテナ（Kubernetes/OpenShift） | クラスター構成図 | ノード種別、ノードプール、CNI/オーバーレイ、Ingress/Egress、外部 LB 連携、CSI とストレージ |
| ストレージ（ONTAP 等） | 物理・論理ネットワーク図 | クラスター/HA ペア/ノード、物理ポート → ifgrp → VLAN ポート → ブロードキャストドメイン/IPspace → LIF → SVM、FC は A/B ファブリックとゾーニング |
| Cisco ACI | ファブリック図 / アクセスポリシー図 / テナント論理図 | APIC、Spine/Leaf、vPC ペア、Border Leaf / VLAN プール → ドメイン → AAEP → IPG → インターフェースプロファイル / Tenant → VRF → BD（サブネット）→ EPG、コントラクト、L3Out |
| LB（BIG-IP / ADC 等） | HA・内部分割図 / サービス図 | Active/Standby、トラフィックグループ、フローティング IP、vCMP ホスト/ゲスト・SDX インスタンス、パーティション、ルートドメイン / VIP → プール → メンバー、SNAT |

## 描画規約

- フォント：名前・説明は `BIZ UDPGothic`、識別子（ポート名、IP、VLAN ID、WWPN）は `BIZ UDGothic`（等幅で桁が揃う）。draw.io のスタイルには `fontFamily` に加えて Google Fonts の `fontSource` を付け、フォント未導入の環境でも同じ字形で開けるようにする。
- ポート：機器ボックスの子セルとして辺に並べる（ELK の `elk.portConstraints=FIXED_ORDER` と `elk.port.side`）。エッジは機器ではなく**ポートセル**に接続する。人間が機器を動かしても配線が外れないため。
- セル ID：モデルのパスから決定的に作る（例：`ntap01-01/port/e0a`）。再生成で ID が変わると、人間の編集との対応が取れなくなる。
- 線の親：線のセルは最上位（レイヤー `1`）に配置し、ELK の折れ点を絶対座標の waypoint、始点・終点を `exitX/entryX` で書く。ラベルは折れ線の長さの中点からのずれ（`offset`）で ELK の位置に合わせる。
- 色と線種：意味ごとに 1 箇所（`src/diagram/theme.ts`）で定義する。色だけに頼らず線種も変える（例：通信させない経路は赤い点線と ×）。凡例は使ったものだけ自動で付ける。
- 矢印の入り方：矢じりの手前には、まっすぐ入ってくる区間を 20px 以上取る。曲がり角のすぐ先に矢じりを付けない（人はそう描かない）。機械チェックが「矢じりの直前で曲がる」として指摘する。
- 線どうしの間隔：別々の線を同じ所に重ねて引かない（平行なら 6px 以上離す）。同じ要素から隙間へ出る複数の線は、深さを `LANE` ずつずらす。機械チェックが「線どうしが重なる」として指摘する。
- 座標の誤差：ELK の座標には `342.00000000000006` のような誤差が含まれる。縦・横の判定を `===` でしない（0.5px 未満の差は同じとみなす）。
- 線の出入りの辺：ELK（layered）の線は流れの向きの辺（`down` なら上下）からしか出入りしない。そのため、横にいる相手へも上下から出て迂回することがある。配置の後で `shortcut.ts` が線ごとに「まっすぐ」か「1 回だけ曲がる」経路（横から出る・横から入るを含む）を試す。要素・関係のない枠・見出しの配置場所・他の線に重ならず、交差を増やさず、重み（長さ＋曲がり 1 回 40px）が 3/4 未満になるときだけ置き換える。横切られる他の線のラベルは、再配置できる場合に限って動かす。
- 往復の線：A→B と B→A がある図では、後に書いた逆向きの線を ELK に行きと同じ向きで渡し、経路を反転して戻す。逆向きのまま渡すと、入れ子をまたぐ戻りの線が図の外周を迂回する。
- 補足の位置：補足は対象の上流（線が入ってくる側）に配置しない。配置すると、対象へ入る線が補足を避けて回り込む。ELK には対象の外側のラベル（`elk.nodeLabels.placement`）として渡し、場所を空けさせる。
- ELK の設定の引き継ぎ：elkjs は親の設定を入れ子の枠に引き継がない。間隔などの設定（`layout.ts` の `SPACING`）は根とすべての枠に渡す。渡さないと枠の中だけ既定値（線と要素の間 10px）で配線され、矢じりの直前で曲がる線ができる。内容が空のラベルは ELK に無視される。
- grid のレイアウト方法：elkjs は 1 回の配置の中で向きを混ぜられない（入れ子の枠に `elk.direction` を書いても無視され、向きの違う子をまたぐ線は捨てられる）。そこで grid では、マスに配置した要素ごとに ELK でレイアウトし（`layout.ts` の `placeGrid`）、マスの寸法を「1 マスの要素で決め、またがる要素の不足分は 1 マスの要素が無い行・列に足す」で決める。枠は、元の大きさがマスの 3/4 以上ある向きだけマスいっぱいに広げ（`STRETCH_MIN`。要素の少ない枠を空白で膨らませない）、マスの左上に配置する。広げた枠の子要素は左右の中央に寄せる。マスの間の通路の幅は、横切る線の数とラベルの大きさから決める。別々のマスにまたがる線は、位置が決まった後で `route.ts` が引く：要素・関係のない枠・ラベルの辺とその間の通路の中心線で格子を作り、「長さ＋曲がり 40px＋交差 120px＋辺に沿う区間＋見出しの横切り」が最小の経路をダイクストラ法で探す。線が出入りする位置は四辺のどこでもよく、相手の辺にそろえた位置も候補にする（向かい合う要素をまっすぐ結ぶため）。両端をともに含む枠の外には出ない。先に引いた線と 10px 未満で平行に重なる経路は取らない。近い線から順に引く。
- elkjs 0.12 の既知の不具合：枠の辺にポートがあると、`elk.layered.nodePlacement.strategy: NETWORK_SIMPLEX` は内部で異常終了する。ポートを付けてレイアウトするときは `BRANDES_KOEPF` にする（今はポートを使っていない。ポート単位の配線図で使うときの注意）。
- 余白：間隔（`SPACING`）と枠の余白（`CONTAINER_PAD` など）は詰めた値にしてある。ただし線と要素の間（`edgeNodeBetweenLayers`）は矢じりの手前の直線の長さになるので 20px 未満にしない。見出しのために枠を広げるときは、子要素を左寄せのまま必要な分だけ広げる。
- 凡例：まず図の中の空き（右端・下端に沿って、要素・線・ラベルから 16px 離れた場所）に 1 列、次に 2 列で配置する。どこにも入らないときは、右に列を足すか下に段を足すかを、足した後の縦横比が 16:9 に近い方で選ぶ（右に足すと、その列の下が丸ごと余白になりやすい）。右に足す列はタイトルの下から始める（タイトルが本文より広いとき、重ねないため）。
- 内部の id：線・補足・凡例・タイトル・レイヤーのセル id、ELK の内部ノードの id には、記述の id に使えない「:」を入れる（`edge:a:b`、`note:a`、`dw:legend` など）。記述の id と決して重ならない。線の id は両端の id から作るので、再生成しても変わりにくい。
- 経路が取れないとき：grid の枠の中で通常の間隔では線を通せなかったら（`route.ts` が `RouteFailure` を返す）、その枠の余白を広げて再レイアウトする（`layoutDiagram` の再レイアウトは最大 4 回。見出しのための幅と同じ仕組み）。それでも無理なら間隔を詰めて通し、経路が無ければ両端を結んで `problem` を付け、機械チェックが指摘する。障害物を無視した線を、指摘なしで出力しない。
- 線のラベルの配置方法：経路探索で引く線のラベルは、全部の線を引いてから配置する（先に配置したラベルが、あとで引く線の経路をふさがないように）。配置場所はまず枠の辺をまたがない所、無ければまたいでよい所。どうしても無ければ機械チェックが指摘する。太い矢印のラベルは矢印の幅の分だけ離す。
- 占有率：機械チェックの要約に「占有率」（要素・補足・線のラベル・凡例の面積 ÷ 図の面積）を出す。向きや分け方を変えた案を比べる目安にする。
- ベンダーアイコン：使わないか、機器ボックスの隅に小さく。アイコンはポートの配置面を奪う。使うならアイコン本来の縦横比を保つ。
- 最小サイズ：機器名 12px 以上、ポート・識別子 9px 以上。収まらなければビューを分割する。
- 寸法：ノード幅・ポート間隔は測った文字幅から決める。固定値で決め打ちしない（日本語と英数字で幅が大きく違う）。

## 人間の編集との関係

- 生成した `.drawio` は、通常は再生成で上書きしてよい生成物。修正はモデルかビュー定義に入れて再生成する。
- 手作業での仕上げが要るビューは、ビュー定義で `managed: manual` にする。以後そのファイルは人間が GUI で直接編集し、生成器は上書きしない。モデルとの整合（全リンク・全ポートが図にあるか、図にしかない要素がないか）は `check` が ID で比較して報告する。
- `managed: manual` の図を編集するときは既存セル ID を維持し、追加セルにもモデル由来の ID を付ける。

## 確認ループ（このリポジトリでの開発）

生成・チェックの処理を変えたら、`examples/` の架空データで次を通してから完了とする。

1. 生成。
2. 機械チェック：スキーマ検証、参照切れ、ノード同士の重なり、ラベルのはみ出し（測った文字幅 > 枠幅）、エッジがノードを貫通していないか、モデルの全リンクが図にあるか、`fontFamily` が BIZ UD 以外になっていないか。
3. プレビュー PNG と、`npm run render -- <file.drawio>`（draw.io 公式の描画）の PNG の両方を**実際に見る**。確認観点：交差の多さ、ラベルの重なり、冗長構成（A/B、HA ペア、vPC ペア）が対称に見えるか、凡例と色の対応、日本語の豆腐（□）や代替フォント落ち、両 PNG の食い違い。
4. 問題があればビュー定義（方向、グルーピング、ポートの辺/順序、ELK オプション）や生成処理を修正して 1 に戻る。座標を手で足して誤魔化さない。
5. `npm run kit` でキットを作り、別フォルダに `dist/kit/` とサンプルモデルを格納して `python run.py env` / `selftest` / `validate` などを通す（サンドボックスの模擬）。

文書（README・AGENTS・`kit/*.md`・skill・テンプレート）を変えたら、`npm run lint:ja` の指摘を 0 件にする。

`src/render.ts` はシステムにフォントを入れなくても `fonts/` の TTF を使う（`@font-face` で読み込み、`fontSource` の Google Fonts 要求も `fonts/` の TTF に差し替える）。`fontFamily` を指定しないセルや BIZ UD 以外のフォントは、システムのフォントで表示される。

## コマンド

前提：Node.js 24 以上、Chrome か Edge（`/usr/bin/google-chrome-stable` などを自動検出、`CHROME_PATH` で指定可）。

- `npm install`
- `npm run fetch-vendor`：`vendor.lock.json` のファイルを取得し sha256 を検証する（既にあって一致すれば何もしない）。draw.io やフォントを上げるときは lock の URL のタグ/コミットを書き換えて `node scripts/fetch-vendor.ts --update`（sha256 を書き直す）、`npm run render -- examples/render-smoke.drawio` で描画を確認する。
- `npm run validate -- <モデルのディレクトリ>...`：スキーマ検証・範囲記法の展開・整合性チェック。エラーがあれば終了コード 1。最後の行に件数の要約。
- `npm run kit`：`dist/kit/` にキット（`dw.js`、`run.py`、`INSTRUCTIONS.md`、`DIAGRAMS.md`、`pattern-*.yaml`、BIZ UD フォント、`OFL.txt`）を作る。フォントは先に `npm run fetch-vendor` で取得しておく。`dw.js` の末尾には、まとめた npm パッケージのライセンス文を付ける（ライセンス文のファイルが無いパッケージがあれば止まる）。キットには Copilot に添付できる形式のファイルだけを入れる（`LICENSE` のような拡張子の無いファイルは入れない）。
- リリース（キットの配布）：`npm run kit` の後、`python3 -m zipfile -c dist/diagram_writer-kit.zip dist/kit/*` で zip にし、`gh release create v<版> dist/diagram_writer-kit.zip`。README の入手の案内は、この名前を前提にしている。
- `npm run preview -- <図の記述.yaml>...`：レイアウトして `.drawio`（記述の隣）と機械チェックの結果を出し、続けて draw.io 公式の描画で PNG（`out/` の下）にする。図を作るときの確認ループはこれ 1 つで繰り返す。
- `npm run render -- [--scale 2] [--border 10] [--out-dir out] <file.drawio>...`：`out/<リポジトリからの相対パス>.png` に書く。複数ページは `.p1.png`, `.p2.png`…。外部通信はせず、外部 URL の画像などはブロックして警告を出す。描画エラー・フォント読み込み失敗は終了コード 1。
- `npm test`：`node --test`（`test/*.test.ts`）。`test/examples.test.ts` はテンプレートと手引きの例が指摘 0 件であることを確認する（`fonts/` が無ければ飛ばす）。
- `npm run typecheck`：`tsc`（出力なし）。
- `npm run lint:ja`：利用者とエージェントが読む文書（README・AGENTS・キットの手引き・skill・テンプレート）を、AI が使いすぎる日本語の言葉と書き方で点検する（textlint。設定は `.textlintrc.json`、追加の語は `textlint/ai-words-extra.json`）。指摘があれば終了コード 1。言葉の一覧を載せる箇所は `<!-- textlint-disable ai-words-ja/no-ai-words -->` で囲む。
- `node src/cli.ts build <図の記述.yaml>... [--out-dir DIR] [--svg]`：`.drawio` を書き、機械チェックの要約と指摘を出す。`--svg` で確認用の SVG も書く。

キット内（サンドボックス）：`python run.py env`（環境の確認とフォント導入）、`python run.py selftest [出力.png]`（日本語の SVG を Chromium で PNG にして描画経路を確認）、`python run.py build <図.yaml>... [--out-dir DIR]`、`python run.py preview <図.yaml>... [--out-dir DIR]`（build に加えて確認用の PNG）、`python run.py validate <ディレクトリ>...`。
