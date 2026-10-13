# diagram_writer

IT インフラの資料から、diagrams.net（draw.io）で編集できる構成図（`.drawio`）を作成する、**M365 Copilot Chat 用のキット**です。

キットと資料を Copilot Chat に添付して依頼すると、Copilot は次の順に作業します。

1. 資料を読み、作成する図の案と質問を示す（この時点では図を作成しない）
2. 回答をもとに、図の記述（座標を含まない YAML）を書く
3. キットのツール（dw.js）で配置・配線して `.drawio` と確認用の PNG を出力し、機械チェック（重なり・線の貫通・見出しとの重なりなど）の指摘が無くなるまで修正する。PNG も Copilot が確認して修正する

座標・線の引き方・色はツールが決めるので、AI は「誰に、何を説明する図か」と図の内容に集中できます。

## 使い方

前提：Copilot Chat でコード実行（Python）が使えること。キットは内部で Node.js と Chromium を使います（2026 年 10 月時点の Copilot Chat のサンドボックスには入っていました）。キットは外部と通信しないので、資料は Copilot Chat の中だけで扱われます。

1. [Releases](https://github.com/kloir-z/diagram_writer/releases/latest) から `diagram_writer-kit.zip` をダウンロードして展開する（自分で作成する場合は「キットの作成」）。
2. 新しいチャットに、展開したファイルすべてと、元にする資料（設計書、パラメータシート、配線表など）を添付する。
3. 下のプロンプトの〇〇を書き換えて送信する。

### プロンプト

図を作成するときは、次のプロンプトを送ります。

```text
添付の INSTRUCTIONS.md に従って作業してください。
依頼：添付の資料をもとに、〇〇の図を作成してください。
読者と使う場面：〇〇（例：上長への説明、顧客との打ち合わせで投影）
```

最初の回答は、理解した内容・作成する図の案・質問です。質問に答えるか、「仮の前提で進めて」と返すと図を作成します。PNG を見て、修正したい箇所を伝えてください（例：「この線が迂回しているので短く」「補足を減らして」）。

機器・ポート・配線を整理する（物理構成モデルを作成する）ときは、次のプロンプトを送ります。

```text
添付の INSTRUCTIONS.md に従って、添付の資料から物理構成モデルを作成してください。
```

### 納品物

- `.drawio`（diagrams.net で開いて編集できる）と確認用の PNG
- 設計メモ（読者・伝えたいこと・図の一覧）
- 仮定した事項と未確定事項の一覧

### 注意

- サンドボックスはチャットごとに作り直されるので、キットは新しいチャットのたびに添付します。
- 確認用の PNG はキットが独自に描くもので、細部は draw.io で開いたときと少し違います。成果物の本体は `.drawio` です。
- 資料と図の内容が合っているかは、ツールでは確認できません。最後は人が確認してください。

## できること

- 図のパターン：全体像／工程（承認の前後など）／接続と境界（区画・FW・許可する通信）／比較（現状と目標など）。パターンごとのテンプレートは [`examples/patterns/`](examples/patterns/)
- 線の意味（人の操作、処理の流れ、開発・構築、VPN、許可しない通信など）で色と線種が決まり、凡例は自動で付く
- 物理構成モデル（機器・ポート・LAG・vPC/MLAG・配線）の検証。`Eth1/[1-48]` のような範囲記法で短く書ける（サンプルは [`examples/basic/`](examples/basic/)）

未対応：物理構成モデルからポート単位の配線図を描くこと、VLAN・SVM/LIF・ACI テナント・LB の VIP などの論理構成。

## キットの作成

Node.js 24 以上が必要です。

```sh
npm install
npm run fetch-vendor   # BIZ UD フォントと draw.io の描画用ファイルを取得（sha256 を検証）
npm run kit            # dist/kit/ にキット一式を出力
```

## このリポジトリで図を作成する

キットと同じツールを手元で実行できます。PNG の出力には Chrome か Edge が必要です（自動で検出します。`CHROME_PATH` で指定も可）。

```sh
npm run preview -- examples/patterns/overview.yaml
```

`examples/patterns/overview.drawio` と `out/examples/patterns/overview.png` が出力されます。Claude Code などでこのリポジトリを開いて「〜の図を作って」と依頼すると、skill（`.claude/skills/diagram/`）がキットと同じ手順で進めます。

- 書き方：[`kit/DIAGRAMS.md`](kit/DIAGRAMS.md)（キットに入る作図の手引きと同じもの）
- 形式：[`schema/diagram.schema.json`](schema/diagram.schema.json)、[`schema/model.schema.json`](schema/model.schema.json)
- 設計方針・描画の決まり・開発の手順：[`AGENTS.md`](AGENTS.md)

## ライセンス

[MIT](LICENSE)

キットには次のものも含まれます。

- BIZ UDGothic / BIZ UDPGothic（SIL Open Font License 1.1。ライセンス文は `OFL.txt`）
- `dw.js` にまとめた npm パッケージ（elkjs：EPL-2.0、ajv：MIT、yaml：ISC など）。ライセンス文は `dw.js` の末尾

開発用の PNG 出力では、draw.io の描画用ファイル（Apache License 2.0）を `npm run fetch-vendor` で取得して使います。リポジトリとキットには含めません。
