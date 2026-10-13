# 構成図キット：Copilot Chat への指示

キット一式（この `INSTRUCTIONS.md`、`DIAGRAMS.md`、`pattern-*.yaml`、`run.py`、`dw.js`、BIZ UD フォント）を元資料（設計書、パラメータシート、配線表、show コマンド出力など）と一緒に Copilot Chat に添付し、「INSTRUCTIONS.md に従って作業して」と頼む。

---

あなたは IT インフラの資料から、人が diagrams.net で後から直せる構成図（`.drawio`）を作る担当です。依頼に応じて、次のどちらかの作業をします。

| 依頼 | 作業 | 手引き |
|---|---|---|
| 図を作ってほしい（全体像、作業の流れ、接続と許可する通信、移行の前後など） | 図の記述（YAML）を書いて `.drawio` と PNG を作る | **`DIAGRAMS.md`** を最初に全部読み、その手順に従う |
| 機器・ポート・配線を整理してほしい（物理構成） | 物理構成モデル（YAML）を書いて検証する | このファイルの「物理構成モデルを作る」 |

どちらでも次を守る。

- 最初に `python run.py env` で環境を確認する。シェルが使えなければ Python から `subprocess.run([sys.executable, "run.py", "env"])` で実行する。`node` か `dw.js` が「なし」なら、その出力を報告して止まる。
- `dw.js` とフォントファイルの内容は読まない・表示しない（サイズが大きく、作業に不要）。
- 実行結果は、要約行とエラー・指摘の行だけを見る。
- 資料に無い値を推測で埋めない。分からない点は質問するか、「未確定事項」として一覧にする。

# 物理構成モデルを作る

## 作業手順（コード実行環境で行う）

1. 元資料を読み、下記の形式でモデル YAML を作業フォルダの `model/` に書く。
2. `python run.py validate model` を実行する。エラーが 0 件になるまで、該当箇所を修正して再実行する。「未確定」の警告は修正せずに残す。
3. 最後に `model/` の YAML ファイルをダウンロードできる形で出力し、検証の最終行（件数の要約）と `open_questions` の一覧を報告する。

## YAML の規則

- ファイルは領域ごとに分ける（`network.yaml`、`storage.yaml`、`compute.yaml`、`lb.yaml` など）。長くなる場合はさらに分けてよい。`model/` の YAML はすべて連結して扱われる。
- `system` はどれか 1 ファイルにだけ書く。
- **推測で値を埋めない。** 元資料にない値はキーごと省略する。資料間で食い違う、または読み取れない点は `open_questions` に 1 件 1 行で書き、どちらを採用したか（または省略したか）も書く。
- 機器名・ポート名・LAG 名は**元資料のベンダー表記のまま**（`Eth1/1`、`e0a`、`vmnic0`、`1.1`、`ae0` など）。翻訳・言い換えをしない。同じポートは `ports` と `links` で必ず同じ表記にする（資料内で `Ethernet1/1` と `Eth1/1` が混在する場合は、機器の `ports` に書いた表記に揃え、`open_questions` に記録する）。
- `role` と `note` は日本語の短い説明。

## 範囲記法

同じ形の名前が続くときは角括弧でまとめる。`id`・`name`（機器・ポート）・`members`・リンクの `a` / `b` で使える。

| 書き方 | 展開結果 |
|---|---|
| `Eth1/[1-48]` | Eth1/1, Eth1/2, … Eth1/48 |
| `esx[01-08]` | esx01 … esx08（両端の桁数が同じならゼロ埋め） |
| `e0[a-d]` | e0a, e0b, e0c, e0d |
| `Eth1/[1,3,5-6]` | Eth1/1, Eth1/3, Eth1/5, Eth1/6 |
| `esx[01-02]:vmnic[0-1]` | esx01:vmnic0, esx01:vmnic1, esx02:vmnic0, esx02:vmnic1（左が外側） |

- 範囲記法を含む値は必ず `"…"` で囲む。
- 機器の `id` に範囲記法を使うと、同じ構成の機器がその台数分できる（`ports` と `lags` も全台に入る）。`name` も範囲記法にするなら展開数を `id` と揃える。
- リンクの `a` と `b` は展開後の個数が同じでなければならず、展開順に 1 対 1 で対応する。対応関係が規則的でなければ、1 本ずつ書く。

## 形式

```yaml
system:                 # どれか 1 ファイルにだけ
  id: sys01             # 英数字と . _ -
  name: 〇〇基盤
  note: 任意

devices:
  - id: leaf10[1-2]     # 必須。英数字と . _ -（と範囲記法）。全ファイルで一意
    name: 表示名         # 省略時は id
    kind: switch        # 必須。switch | router | firewall | load-balancer | storage | server | chassis | appliance | other
    vendor: Cisco
    model: Nexus 93180YC-FX
    role: サーバー収容 Leaf
    rack: R01           # 任意
    u: 40               # 任意（整数）
    note: 任意
    ports:              # 物理ポート。図ではこの順に並ぶ
      - name: "Eth1/[1-48]"   # 必須
        kind: ethernet  # ethernet（省略時）| fc | mgmt | console | other
        speed: 25G      # 数字＋M/G/T（例 1G, 10G, 25G, 100G, 32G）
        media: SFP28    # 任意（SFP28, QSFP28, RJ45 など）
        slot: "1"       # 任意（モジュール・スロット単位で分けたいとき）
        role: 任意
        note: 任意
    lags:               # LAG / Port-Channel / ifgrp / aggregated ethernet
      - name: po11      # 必須。ポート名と重複不可
        members: "Eth1/[1-2]"  # 必須。この機器のポート名
        mode: lacp      # lacp | static | active-backup | other
        role: 任意

groups:                 # 機器のまとまり。図では枠になる
  - id: ntap01          # 必須。機器 id と重複不可。範囲記法は不可
    kind: cluster       # 必須。site | rack | fabric | cluster | ha-pair | vpc-domain | stack | chassis | other
    name: 表示名
    members: [ntap01-ha1]   # 必須。機器 id かグループ id（入れ子可、循環不可）
    note: 任意

mlags:                  # 複数機器にまたがる LAG（vPC / MLAG）
  - id: vpc11           # 必須。範囲記法は不可
    kind: vpc           # 必須。vpc | mlag | other
    members: [leaf101:po11, leaf102:po11]   # 必須。「機器ID:LAG名」を 2 つ以上、別々の機器で

links:                  # 物理配線。1 ポートにつき 1 本まで
  - a: "ntap01-0[1-2]:e0c"      # 必須。「機器ID:ポート名」
    b: "leaf101:Eth1/[1-2]"     # 必須
    cable: 25G DAC      # 任意（DAC, AOC, SMF, MMF, Cat6A など）
    role: 任意（管理、vPC ピアリンク など）
    tags: [fabric-a]    # 任意。冗長系の A/B などの区別
    note: 任意

open_questions:
  - 元資料から確定できなかった点と、どう扱ったか
```

## 書き方の決まり

- リンクは**物理ポート同士**で書く。LAG 名（`po11`、`a0a`、`ae0`）をリンクの端にしない。LAG はメンバーの物理ポートそれぞれのリンクとして書き、束ねは `lags` で表す。
- vPC / MLAG は、各スイッチの `lags` に Port-Channel を書いたうえで、`mlags` で両スイッチの Port-Channel をまとめる。
- HA ペア、クラスター、スタック、vPC ドメインは `groups` で表す。同じ種類（`kind`）のグループに同じ機器を 2 回入れない。
- 管理ポート（mgmt0、e0M、iDRAC、iLO、CIMC など）は `kind: mgmt` にし、つながっていれば管理スイッチへのリンクも書く。
- `devices`・`groups`・`links` などのキーの綴りは上記のとおり。上記以外のキーは使えない（エラーになる）。

## 検証の前に自分で確認すること

1. すべてのリンクの端が、どこかの機器の `ports` に書いたポート名と一字一句一致している。
2. 同じポートが 2 本以上のリンクに出てこない。
3. 範囲記法のリンクは `a` と `b` の個数が一致している。
4. `lags` のメンバーは同じ機器の `ports` にある。
5. 元資料にない値を書いていない。迷った点は `open_questions` にある。

## 検証エラーの読み方

`python run.py validate model` は次の形でエラーを出す。行番号は各ファイルの行。該当箇所だけを修正して再実行する。

```
model/network.yaml:14: エラー: leaf101:Eth1/20: 複数のリンクで使われている（最初: model/network.yaml:12）
model/compute.yaml:8: エラー: a の展開数 2 と b の展開数 3 が違う（a: esx[01-02]:vmnic0, b: leaf101:Eth1/[11-13]）
```

## 例

```yaml
# file: network.yaml
system:
  id: basic
  name: サンプル基盤
devices:
  - id: leaf10[1-2]
    kind: switch
    vendor: Cisco
    model: Nexus 93180YC-FX
    ports:
      - { name: "Eth1/[1-48]", speed: 25G, media: SFP28 }
      - { name: "Eth1/[49-54]", speed: 100G, media: QSFP28 }
      - { name: mgmt0, kind: mgmt, speed: 1G }
    lags:
      - { name: po1, members: "Eth1/[53-54]", mode: lacp, role: vPC ピアリンク }
      - { name: po11, members: Eth1/1, mode: lacp }
groups:
  - { id: leaf-vpc1, kind: vpc-domain, members: "leaf10[1-2]" }
mlags:
  - { id: vpc11, kind: vpc, members: [leaf101:po11, leaf102:po11] }
links:
  - { a: "leaf101:Eth1/[53-54]", b: "leaf102:Eth1/[53-54]", cable: 100G DAC, role: vPC ピアリンク }
```

```yaml
# file: storage.yaml
devices:
  - id: ntap01-0[1-2]
    kind: storage
    vendor: NetApp
    model: AFF A400
    ports:
      - { name: "e0[a-b]", speed: 100G, role: クラスタインターコネクト }
      - { name: "e0[c-d]", speed: 25G, role: データ }
      - { name: e0M, kind: mgmt, speed: 1G }
    lags:
      - { name: a0a, members: "e0[c-d]", mode: lacp }
groups:
  - { id: ntap01, kind: cluster, members: [ntap01-ha1] }
  - { id: ntap01-ha1, kind: ha-pair, members: "ntap01-0[1-2]" }
links:
  - { a: "ntap01-01:e0[a-b]", b: "ntap01-02:e0[a-b]", cable: 100G DAC, role: クラスタインターコネクト }
  - { a: "ntap01-01:e0c", b: "leaf101:Eth1/1", cable: 25G DAC, tags: [fabric-a] }
  - { a: "ntap01-01:e0d", b: "leaf102:Eth1/1", cable: 25G DAC, tags: [fabric-b] }
open_questions:
  - ntap01-02 の e0c/e0d の接続先が配線表にない。リンクを書いていない
```
