# TurboWarp Plus

リリース実行: [dry-run・依存順の更新と公開](docs/release-executor.md)。

実行できるサンプル: [配信方式と全機能拡張のデモ計画一覧](docs/sample-projects/plan.ja.md)。

Editor向け: [機能拡張メタデータJSONと依存関係の契約](docs/editor-extension-catalog.md)。

データ・ドキュメント: [内部構造の投影と、反復・ASTの組み合わせ方（設計案）](docs/data-projection.ja.md)。

[**ダッシュボード → kubohiroya.github.io/turbowarp-plus-packages**](https://kubohiroya.github.io/turbowarp-plus-packages/)

[TurboWarp](https://turbowarp.org/) に機能を足す拡張・ツールチェーン・アプリケーション・
ドキュメントサイト群「TurboWarp Plus」の索引です。

> **非公式。** TurboWarp プロジェクトおよび Scratch 財団とは提携しておらず、
> 承認も受けていません。本家を置き換えるものではなく、補完するものです。

[English](README.md) | 日本語

## ダッシュボードの見方

ダッシュボードは「**パッケージ一覧**」のみを表示します。
集計カード・検索・状態フィルタ・「他社依存も表示」は一覧とともに表示し、
タブ状の画面切り替えUIは設けません。各カテゴリの見出しのすぐ右にあるグラフアイコンを押すと、
そのカテゴリの相関図をダイアログで表示します。一覧の絞り込み条件とスクロール位置は維持し、
相関図には絞り込みにかかわらずカテゴリ全体を表示します。
閉じるボタン・Escape・背景のクリックで閉じると、開いたアイコンにフォーカスが戻ります。
ダイアログ表示中はキーボードフォーカスをダイアログ内に保ちます。

矢印は「利用側 → 依存先」です。通常は実行時・ホスト側・任意依存と、検証済みの固定GUIのビルド関係を表示します。
開発時の依存はチェックで追加し、主要構成と区別します。固定GUIはsite/source.jsonとreadPins・verifyHost・buildPagesの契約を、コードを実行せず照合します。
固定SHAと収集時のHEADは別に保持します。欠落・未対応の情報はエラーとして示し、矢印を推測しません。
カテゴリ内の実際の関係は実線です。左右の半透明の枠には接続するカテゴリ名だけを表示します。
左は中央のパッケージを使うカテゴリ、右は中央のパッケージが使うカテゴリで、矢印はすべて左から右へ向かいます。
カテゴリ間の依存は循環させません。収集したデータに循環が含まれる場合は、該当カテゴリを左右の両方に表示し、
一覧と該当カテゴリのダイアログに警告を出します。
破線は外部カテゴリと中央の実際の依存元・依存先を結び、数字はカテゴリ・中央のパッケージ・
方向ごとに重複を除いたパッケージの組数です。
拡張共通の契約の図では、`turbowarp-extension-data-editor`に「データ編集の契約・API」を併記し、
機能拡張から同契約への依存先が分かるようにします。中央のパッケージ間の依存関係は維持します。
正確な関係と種類は詳細を展開して確認でき、狭い画面では図を横スクロールできます。
カタログ未登録の自前依存は、カテゴリを推測せず詳細に明記します。
ダイアログでは図を先に表示し、詳しい関係と取得元は図の下で必要なときだけ展開します。
取得時点は表示し、古いデータ・カテゴリ不一致・収集エラーは警告します。

パッケージ1行、カテゴリ別。60以上のリポジトリにまたがると見失いやすい項目を列にしています。

| 列 | 内容 |
| --- | --- |
| **Package** | 拡張名の下にサンドボックスなしの要求を表示します。🔓 必須、◐ 任意、🛡 不要、? 不明。 |
| **Demo** | 再生マーク付きの小サイズ版「デモ」を押すと、そのパッケージの公開済みSB3を新しいタブで開きます。取得可能なデモがなければ `—` を表示します。 |
| **Issues** / **PRs** | GitHub の未クローズ issue 数・PR 数。 |
| **Revision** | 既定ブランチの先頭にタグが付いているか。`released` は最新タグ＝先頭、`N ahead` は最新タグ以降に N コミット積まれている状態。 |
| **GitHub Pages** | Pages が設定されているか、実際にアクセスして応答したか、およびダッシュボードと同じ配色で撮ったトップページのスクリーンショット。 |
| **npm** | 公開バージョン、最終公開からの経過、および最新 git タグと npm のバージョンが食い違う場合の `⚠️ tag ≠ npm`。 |
| **Upstream dependencies** | 宣言されている npm 依存とそのレンジ。💀 はローカルパス参照（`file:`, `link:`, `workspace:` など）、⚠️ はレンジが最新公開版を含まなくなった状態（stale）。 |

サンドボックスなしの要求は各リポジトリの既定ブランチから収集します。
`vite.config.ts` の `turboWarpExtension({ unsandboxed: ... })` の明示指定を優先し、
指定がなければ `src/config.ts` の `extensionConfig.unsandboxed` を読みます。
`required` / `true` は必須、`optional` は任意、`not-needed` / `false` は不要です。
拡張の宣言があっても値が未設定・動的・解析不能なら不明とし、不要とはみなしません。
これは宣言値の表示で、実行による互換性の検証結果ではありません。
アプリケーションと機能拡張は、直接・間接の依存先に「必須」の拡張があれば同じ「必須」を表示します。
拡張自身の宣言が「不要」「任意」「不明」でも、依存先の「必須」を表示に優先します。
SB3へ同梱する拡張をビルド用依存に置く構成もあるため、アプリの
prod / peer / optional / dev依存をたどります。アプリ以外の中間パッケージでは
prod / peer / optionalのみを対象にし、そのパッケージの開発専用依存は継承しません。
根拠となる拡張のrepo名はラベルの
ツールチップと収集JSONの `unsandboxedRequiredBy` に記録します。必須と確認できない場合は
アプリを「不要」とは推定しません。収集した拡張自身の宣言は変更しません。
宣言も継承元も確認できないパッケージや、この項目を収集していない旧JSONには表示しません。
宣言の変更は次回の収集で反映されます。コードを実行せずTypeScriptの構文として解析します。

各リポジトリの `samples/manifest.json` にある `samples` の `name` と任意の `title` を読み、
Pages上の `samples/<name>.sb3` を確認します。公開CORSとZIPの先頭シグネチャを確認できた
最初のデモに再生マーク付きの小サイズ版「デモ」ボタンを表示します。
ホバー時は「TurboWarp-Plus-Editorでデモを開く」のツールチップを表示し、言語切替にも追従します。パッケージのサンプル作品を開くための入口です。
ボタンはページと同じ配色で、通常・ホバー・キーボードフォーカスに対応します。
テーマは既定でOS設定に追従（auto）し、`<html data-theme="light">` / `dark` で固定、`auto` または属性の削除で自動へ戻せます。
反映は次回のデータ収集時です。
起動先は `catalog.yaml` の `site.demoEditorUrl`、読み込むSB3は `project_url` で渡します。
既定の起動先は [TurboWarp-Plus-Editor](https://kubohiroya.github.io/turbowarp-plus-editor/) です。
機能拡張の読み込みに必要な権限確認はTurboWarp-Plus-Editor側で行います。

各パッケージの説明文はページの言語に追従します。英語は GitHub のリポジトリ
description、無ければ `README.md` の冒頭段落から取ります。日本語は各リポジトリの
`README.ja.md` の、冒頭見出し直下の最初の段落です。その上にあるバッジ行や
`English | 日本語` の切り替え行は読み飛ばし、先頭の `@scope/名前 は、` は
行見出しと重複するため落とします。`README.ja.md` が無いリポジトリは、両言語とも
英語の説明を表示します。日本語の説明を与える正攻法はそのリポジトリの README を
書くことで、そうすればリポジトリを読む人にも役立ちます。`catalog.yaml` の
`descriptionJa` は、その文章が表のセルに向かない場合の逃げ道です。

ページは日英両対応です。ブラウザが日本語を要求すれば日本語で開き、そうでなければ
英語で開きます。右上のスイッチで切り替わり、選択は記憶されます。両言語は同じ HTML
に入っていて、切り替えは `<html lang>` を書き換えるだけ、該当する語句だけを
スタイルシートが表示します。別ページを並行保守する必要も、再読み込みもありません。
カテゴリと冒頭文の日本語は `catalog.yaml` に英語と並べて置いてあります。

同じファミリ内のパッケージへの依存は常に表示します。サードパーティ依存は
stale かローカルの場合のみ表示し、残りは **show external deps** で出します。
devDependencies は自前パッケージのときだけ表示します。ビルドツールチェーンが
各拡張の上流として現れるのはこの経路です。

## パッケージの追加・移動

手で保守するのは [`catalog.yaml`](catalog.yaml) だけです。カテゴリと、どのリポジトリが
どこに属するかを書きます。それ以外はすべて API から収集します。

```yaml
categories:
  - id: sensing
    title: Sensing & Input
    packages:
      - turbowarp-your-new-package
```

カテゴリ間の依存は、開発時の依存も含めて循環させません。カテゴリAのいずれかの
パッケージがカテゴリBを使うなら、Bのパッケージは直接にも他のカテゴリ経由でもAを
使えません。循環する場合は、下位のパッケージを移動するか、独立したカテゴリに分けます。
現在の分け方の基準は `catalog.yaml` に書いてあり、収集したデータに循環があると
ダッシュボードが警告します。

npm 名は既定で `@kubohiroya/<repo>` です。異なる場合は `npm:` で指定し、npm
パッケージではないリポジトリ（ドキュメントサイト、サンプル集、デプロイ済み
アプリ）は `npm: false` にします。既定のままのリポジトリは npm に出るまで
`unpublished` と表示されます。これは意図的で、見えているべき状態です。

## ローカルでの実行

Node.js 22 以上を使用します。更新スクリプトは TypeScript で記述し、
npm コマンドから `tsx` を読み込んで実行します。事前の JavaScript 生成は不要です。

```bash
npm install
npx playwright install chromium   # サムネイルとアイコン PNG の生成時のみ必要

npm run typecheck                 # スクリプトとテストの strict 型チェック
npm test                          # 依存レンジと説明文抽出のテスト
npm run icons                     # ブランド素材 -> site/assets/
npm run collect                   # GitHub + npm  -> data/dashboard.json
npm run editor:catalog            # 公開npm成果物 -> site/extensions-v1.json
npm run thumbnails                # スクリーンショット -> site/thumbs/
npm run render                    # ダッシュボード  -> site/index.html
npm run serve                     # http://localhost:4180/
```

各サイトは `prefers-color-scheme` のライトとダークで2回撮ります。ダッシュボード自身が
その設定に追従するためで、暗いページに明るいスクリーンショットが並ぶと表に穴が空いたように
見えるからです。ダークに対応していないサイトは2枚が同一になるのでダーク側を捨て、
`<picture>` がライト側にフォールバックします。実際に見た目が変わるサイトだけが2枚目を持ちます。

`npm run build` は collect → editor:catalog → thumbnails → render を順に実行します。
`npm run build:no-thumbnails` は時間のかかる部分を飛ばします。

サムネイルは前回の画像と版情報を `site/thumbs/` に保存し、package.jsonの版・Gitタグ・
npm配布タグが変わったサイトだけ再撮影します。privateパッケージ、npm公開の対象外のサイト、
版情報がないサイトではHEADのSHAも判定に使い、版を上げずに更新したDocs等も再撮影します。
初回、URL変更、画像欠落時も撮影し、失敗した更新は前の画像を保持して次回再試行します。
GitHub Actionsではこのディレクトリをキャッシュして再利用します。
キャッシュがない場合や旧形式からの初回移行時は全対象を撮影します。

収集には GitHub トークンが必要です。`GITHUB_TOKEN` を読み、なければ
`gh auth token` にフォールバックします。未認証は 1 時間あたり 60 リクエストに
制限され、1 パッケージ分にも足りません。

## 再帰的リリースの計画

既存の解析結果から、指定パッケージとその上流だけの処理順・依存更新・バージョン変更・
公開対象を確認できます。入力は既定で `data/dashboard.json` です。ローカルにない場合は、
Pages workflow の `dashboard-data` artifact にある JSON を配置するか、`--data` で指定します。

```bash
npm run bump -- @kubohiroya/turbowarp-title-menu
npm run bump -- turbowarp-title-menu --data /path/to/dashboard.json
npm run --silent bump -- turbowarp-title-menu --json > /tmp/release-plan.json
```

このコマンドは計画の標準出力だけを行います。解析JSON・対象repo・package.json・lockfileを
変更せず、ネットワークアクセス、Git操作、タグ・Release作成、npm公開も行いません。
`--apply` などの実行オプションはありません。

- `family: true` の prod・dev・peer・optional 依存を深さ優先の後行順で探索します。
  共有上流は1回だけ処理し、循環や解析結果に存在しない上流は入力エラーとして停止します。
- 上流の予定公開版、予定がなければ解析済みnpm公開版を依存元へ伝播します。通常依存の
  完全固定・`^`・`~` は記法を保って下限を更新します。新しい依存指定を古い版へ下げません。
  複雑な通常依存レンジは対象版を含む場合に維持し、未対応のレンジ・workspace・aliasは保留します。
- peerは対象版を許容する場合に維持し、許容しない場合は完全固定・`^`・`~` の記法を保って
  対象版へ更新する案を出します。複雑なpeerレンジは `|| <対象版>` を追加する案です。
  ファミリーの記録済みGitHub repoへのGit参照は、すでにnpm公開済みならnpmの完全固定版へ
  置換する案を出します。peer互換性・Git/npm配布内容の同等性は未検証として
  `requiresReview: true` の警告を付けます。privateやnpm対象外のrepoは公開対象に入りません。
- 先行コミットまたは依存更新があればminorを1回上げます。package.jsonとnpm公開版の大きい方を
  基準に、使用済みの番号を避けます。すでに用意された未公開版は再bumpせず、初回公開も
  現在の番号を使います。RC等のプレリリースも準備済み版を再利用し、必要なら同じ系列の
  次番号へ進めて使用済み番号を避けます。暗黙に通常版へ昇格せず、配布先dist-tagの確認を
  必須とします。private等のバージョン付きrepoの変更は `update-only` として表示します。
- 各stepの `sourceChanges` は `none`（基準タグとHEADが一致）、`ahead`（npm公開版に対応する
  タグから先行）、`unknown`（未判定）です。タグ不足・npm版との不一致・先行数不明は警告として
  表示し、それだけを理由にminorを上げません。既存npm版への依存更新や準備済み版の公開計画は
  作成できます。未判定は「ソース変更なし」の確認ではありません。
- 収集漏れ・収集エラー・不正バージョン・未対応レンジ・循環等の停止条件は維持します。
  `steps` には保留中の仮の変更も含み、`publishTargets` はレビューが必要な案も含む公開予定です。
  `ready` は阻害事項がなく計画を生成できたこと、`applyReady` はさらに要レビュー警告がなく
  ローカル適用に進めることを表します。peer・Git参照・RC版は変更先を確定して計画を完了できても、
  レビュー前の自動適用を停止します。`ready: true` は互換性や全repoの公開要否の確定を
  意味しません。警告と `sourceChanges` を併せて確認してください。

計画には解析日時・JSON全体のSHA-256（JSON再シリアライズ後）・各repoのHEAD SHAを含みます。
現在のGitHub/npm状態や互換性を確認したものではなく、記録されたスナップショットに基づく
計画です。終了コードは `0` が生成成功、`1` が引数/入力エラー、`2` が未解決事項ありです。
公開機能を導入する際は、現状の再確認・検証・承認を別途必要とします。

## 依存元へのbump

上流パッケージを指定し、それに直接・間接に依存するパッケージの更新を、依存関係の順に
計画・適用できます。開発依存も対象なので、拡張ビルド用プラグインの変更を伝播できます。

```bash
# 既定は計画のみ。入力は既存のdata/dashboard.json
npm run bump:downstream -- vite-plugin-turbowarp-extension
npm run --silent bump:downstream -- @kubohiroya/vite-plugin-turbowarp-extension --json

# <親dir>/<repo名>に各repoの独立したcheckoutがある場合にローカル適用
npm run bump:downstream -- vite-plugin-turbowarp-extension \
  --data /path/to/dashboard.json --apply --repos-dir /path/to/checkouts
```

- 起点自身とその依存元を列挙し、上流を先に処理します。共有依存は1回だけ処理します。
  直接・間接の依存元を特定するには、入力JSONに依存元のrepoがすべて収録され、各repoの
  依存一覧が必要です。未収録repoは発見できません。
- 起点が公開済みならそのnpm版を利用し、準備済みの未公開版があれば再bumpせず使います。
  依存指定の更新とminor bumpの規則は`bump`と共通です。すでに更新済みなら再bumpせず、
  互換範囲内のpeer・複雑なレンジは維持します。
- 対象外の上流は公開済み版と収集結果を参照するだけです。その上流の未公開変更・
  準備済み版や、対象外への古い依存指定を根拠としたbumpは行いません。
- `--apply`は既定OFFです。`--repos-dir`と同時に指定すると、全対象checkoutのHEAD SHA・
  作業ツリー・manifestのname/version・変更対象の依存指定を事前確認します。
  SHA不一致、未コミット変更、未追跡ファイル、checkout不足、計画の阻害事項や要レビューの案があれば、
  全体を変更前に停止します。起点が変更不要でもcheckoutは必要です。
- 適用するのは`package.json`の依存指定とversionだけです。lockfile更新・再ビルド・検証・
  commit・push・タグ・Release・npm公開は別途行ってください。予定上流版がまだnpmに
  存在しない場合、下流のlockfile生成には上流の公開が必要になります。
- 後続ファイルの書き込みに失敗した場合、適用済みファイルを元の内容へ復元します。
  同時編集等で復元できないファイルがあればそのパスを報告します。成功後の取り消しは、
  表示された変更ファイルをdiffで確認したうえでGitから復元してください。

出力JSONは`direction: "downstream"`を持ちます。適用成功時は
`{ "mode": "apply", "plan": ..., "files": [...] }`を返します。
終了コードは`0`が成功、`1`が引数・入力・適用エラー、`2`が計画の未解決事項、または
`--apply`時のレビュー必要です。計画のみなら`ready: true`・`applyReady: false`でも`0`です。
スナップショットの警告と実際の互換性を確認してから適用してください。

## 公開の仕組み

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) が `main` への push、
1 日 1 回のスケジュール、および手動実行でパイプライン全体を回し、`site/` を
GitHub Pages にデプロイします。生成物はコミットしません。`data/`、
`site/index.html`、`site/thumbs/` は毎回作り直されます。

## ブランド素材

[`scripts/icons.ts`](scripts/icons.ts) がマーク・ファビコン・OG 画像の唯一の
生成元です。マークは「ハットブロック（Scratch 系エディタでスクリプトの先頭に
置くブロックの形）＋ ＋」で、そこで描き起こしています。TurboWarp のロゴや
Scratch キャットから字形・配色・図案を取っていません。

## ライセンス

GPL-3.0-only。[LICENSE](LICENSE) を参照してください。
