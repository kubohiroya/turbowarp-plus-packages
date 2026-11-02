# TurboWarp-Plus-Editorの移行計画（段階4〜6）

[TurboWarp-Plus-Editorの構成・責務・ライセンス](editor-architecture.ja.md)の「移行の進め方」のうち、段階4〜6の進め方を具体的に定めます。あわせて、「ライセンスの切り分け」の規則4に従い、フォークのファイルごとに由来を確かめた結果を記録します。

この文書は計画です。決定事項は正本（editor-architecture.ja.md）に書き、ここには書きません。ここで「案」と書いたものは、まだ決めていません。

## 読んだもの（2026-11-03）

| 対象 | 版 |
|---|---|
| scratch-guiフォーク | `origin/develop` の `b0e4eb7`（#119、2026-11-03） |
| 本家TurboWarp/scratch-gui | 分岐点 `06b2edf`（2026-10-15）、`develop` の `54043cc`（2026-10-31） |
| turbowarp-plus-editor | `origin/main` の `845459d`（#70） |
| security-dialog | 0.7.0（`d840c3c`、MPL-2.0） |
| extension-loader | 0.6.0（MPL-2.0） |
| data-editor | 0.7.0（MPL-2.0） |
| scratch-vmフォーク | `cb04ce7`（MPL-2.0。`getExtensionServicePort()` を含む） |

plus-editorの[フォークに残す差し込み口の設計](https://github.com/kubohiroya/turbowarp-plus-editor/blob/main/docs/plus-integration-sockets.md)（以下「差し込み口の設計」）は、差し込み口を開ける順序を独自の段階番号（3〜11）で決めています。この文書の段階4〜6は正本の番号です。対応は、正本の段階5が差し込み口の設計の段階4・6〜10に、正本の段階6が同じく段階11に当たります。正本の段階4（開くときの許可）は、差し込み口の設計にはまだ段階として載っていません。

## 段階1〜3の到達点

計画の前提として、段階3までに済んだことを確かめました。

| 段階 | 状態 | 根拠 |
|---|---|---|
| 1 カスタム拡張画面からローダーとの接続を外す | 済 | フォーク #100（`48e659f`）。本家の4ファイルは分岐点と差分なし |
| 2 ライセンスを揃える | ほぼ済 | security-dialog 0.7.0・extension-loader 0.6.0・data-editor 0.7.0はMPL-2.0。security-dialogは#52でMPL-2.0として書き直した。plus-editorのスニペット分離は別作業 |
| 3 差し込みの仕組み | 済 | フォーク #111（`src/lib/tw-plus-integration.js`）、plus-editor #57（webpackで `site/plus-integration.js` に差し替え） |

段階3の後、正本の段階5にあたる移送がすでに始まっています。

| 移したもの | フォーク | plus-editor |
|---|---|---|
| 6つの口（`modals`・`securityModals`・`themeTokens`・`translations`・`registerBlockShapes`・`shouldIgnoreKeyEvent`）を開けた | #112 | — |
| 文書エディターの結線（`attachToWorkspace`） | #113 | #61 |
| 読み込み取消の答え（`createCancelSecurityLoad`） | #114 | — |
| 拡張が登録するステージ操作（`stageControls`） | #115 | #65 |
| 起動を待つアドオンの指名（`awaitStartupAddons`） | #116 | #66 |
| カメラのUIをやめ、操作バーにパネルの受け皿を足す | #117 | #69（ドック） |
| 拡張カタログの出所（`extensionCatalog`） | #118 | #70 |
| 何を信頼するか（`trustedExtensions`） | #119 | #72（作業中） |

6つの口は開いていますが、中身の多くはまだフォークにあります。たとえば `src/lib/blocks.js` は、`registerHostBlockShapes` を呼びながら、文書エディターのハット形状も自分でimportしています。

正本の「現状との差」の表（2026-11-01）のうち、カメラ・ステージ操作はもうフォークにありません。カメラのUIは#117で廃止し、ステージ操作の実装（旧 `tw-stage-controls.js`）は#65でplus-editorの `site/stage-controls.js` に移りました。フォークに残っているのは、受け取ったサービスを描く `controls.jsx` の2件だけです。

## 由来の監査（規則4）

### 方法

1. 分岐点 `06b2edf` と `origin/develop` の差分から、ファイルを「フォーク独自の新規」と「本家のファイルの改変」に分けた。
2. 新規のファイルごとに `git log --follow --format='%an <%ae>' 06b2edf..origin/develop` で作者を集めた。コミットの `Co-authored-by` も集めた。
3. 写しを2通りで探した。
   - ファイル単位：`git diff -C30% --find-copies-harder` で、分岐点の本家ファイルからの複製・改名を探した。
   - 行単位：空白を除いて30文字以上の行が、分岐点の本家の `src`・`test` のどこかに同じ形であるかを数えた。CSSは `.css`、JSは `.js`・`.jsx`・`.mjs`・`.cjs` を対象にした。
4. VMの内部を扱うファイルは、scratch-vmフォーク `cb04ce7` の `src/extension-support` とも同じ方法で比べた。

### 結果の要約

- 差分は114ファイル、+9,916 / −124行（`package-lock.json` の+1,883を含む）。コミットは81件。
- **すべてのファイル、すべてのコミットの作者は `Hiroya Kubo <hiroya@cuc.ac.jp>` だけでした。** 外部の寄稿はありません。
- 81件のうち19件に `Co-authored-by: Claude Opus 5 / 5.5 <noreply@anthropic.com>` があります。AIの補助の記録で、別の著作権者ではありません。
- ファイル単位の複製・改名は、30%の類似度でも見つかりませんでした。
- 行単位で本家と一致した行は、どれも定型でした。`@import "../../css/colors.css"` のようなimport、`import PropTypes from 'prop-types'`、`border: 1px solid $ui-black-transparent;` のような宣言です。本家のコンポーネントやCSSの塊を写したファイルはありません。テスト35ファイルにも、本家と3行以上一致するものはありません。
- 例外は1つです。`src/lib/tw-plus-extension-registrar.js` の13行が、scratch-vmの `tw-unsandboxed-extension-runner.js`（11行）と `extension-manager.js`（2行）に一致します。`Scratch.canFetch` から `Scratch.translate` までの、非サンドボックス拡張に渡すAPIの組み立てです。scratch-vmはMPL-2.0なのでMPLのパッケージに入れられますが、TurboWarpの作者の著作物を含むので、移すときに出所の表示を残します。

ただし、作者が1人であることと、パッケージへ移してよいことは別です。新規のファイルでも、GUIの内部モジュール（`log`、`Modal`、reducer、GUIのCSS変数）をimportしているものは、規則1・2により、portへ置き換えてから移します。

### 新規ファイル（ソースと補助スクリプト）

行数は `origin/develop` での行数です。「初出」はそのファイルを追加したコミットです。

| ファイル | 行 | 初出 | GUIの内部への依存 | MPL | 行き先（案） |
|---|---:|---|---|---|---|
| `src/lib/tw-plus-integration.js` | 20 | `baa016b` | なし | — | **フォークに残す**（差し込み口） |
| `src/lib/tw-plus-integration-points.js` | 192 | `d6ebc58` | なし | — | **フォークに残す**（口を読む補助） |
| `src/containers/tw-plus-workspace-attachment.jsx` | 60 | `4882ebe` | `log`、`tw-lazy-scratch-blocks`、redux | — | **フォークに残す**（フック） |
| `src/lib/tw-extension-security-cancel.js` | 35 | `481f29a` | reducer 6つ | — | **フォークに残す**。取消のあとの画面遷移で、GUIの内部そのもの |
| `src/lib/tw-plus-extension-host.js` | 114 | `7a5be8a` | なし | 可 | extension-loader（新しいサブパス、下記） |
| `src/lib/tw-plus-extension-registrar.js` | 371 | `7a5be8a` | なし（scratch-vmの `src/` を直接import） | 可（scratch-vm由来の13行に出所を表示） | extension-loader。VMの内部は `getExtensionServicePort()` へ |
| `src/lib/tw-plus-project-loader.js` | 202 | `7a5be8a` | なし | 可 | extension-loader |
| `src/lib/tw-plus-extension-load-failure.js` | 44 | `d341915` | なし | 可 | extension-loader |
| `src/lib/tw-plus-extension-authoring.js` | 162 | `7acb489` | なし | 可 | extension-loader（`./project-catalog` の隣） |
| `src/lib/tw-plus-catalog-authoring.js` | 57 | `7acb489` | なし（VMの `_loadedExtensions` を読む） | 可 | extension-loader |
| `src/config/extension-project-limits.js` | 6 | `c55c0dd` | なし | 可 | extension-loader（既定値として） |
| `src/config/extension-loader-flag.js` | 9 | `c55c0dd` | なし | 可 | 廃止。plus-editorの `bootstrapExtensionLoader` が同じフラグを読む |
| `src/lib/tw-plus-packager.js` | 91 | `7a5be8a` | なし | 可 | extension-loader（`./packager` の隣） |
| `src/playground/plus-packager.js` | 108 | `7a5be8a` | なし | 可 | plus-editor（Packager組み立て画面の入口）。中身はloaderとsecurity-dialogを呼ぶだけにする |
| `src/lib/tw-plus-permission-ui.js` | 139 | `7a5be8a` | なし | — | **廃止**（段階4） |
| `src/containers/tw-plus-library.jsx` | 200 | `ba784d8` | `log`、`plus-library.css` | 可（書き直し要） | security-dialog 0.7の `ExtensionReview mode="add"` と、plus-editorの結合モジュールに分けて書き直す |
| `src/lib/tw-plus-extension-loader.js` | 54 | `ba784d8` | なし | 可 | ローダーOFFのときの旧経路。残すかどうかは「判断が必要なこと」1 |
| `src/lib/tw-plus-extension-permissions.js` | 23 | `ba784d8` | なし | 可 | 同上 |
| `src/config/feature-flags.js` | 8 | `ba784d8` | なし | 可 | 廃止。旧フラグ `twPlusExtensions` は同上 |
| `src/components/tw-plus-library/plus-library.css` | 57 | `ba784d8` | なし | 可 | security-dialog |
| `src/components/tw-plus-library/icon.svg` | 26 | `ba784d8` | なし | 可 | plus-editor（アイコンはplus-editorが持つ） |
| `src/css/extension-security-dialog.css` | 14 | `c55c0dd` | GUIのCSS変数を `var()` で参照 | 可 | security-dialog。色はportで値として受け取る |
| `src/lib/tw-block-editor-service.js` | 50 | `7f58e36` | なし（`intl` を引数で受け取る） | 可 | data-editor（`./turbowarp`） |
| `src/lib/tw-block-editor-capabilities.js` | 14 | `1caa902` | なし | 可 | data-editor |
| `src/lib/tw-block-editor-startup.js` | 19 | `6e0ce88` | なし | 可 | data-editor |
| `src/containers/tw-block-editor-modal.jsx` | 77 | `7f58e36` | `Modal`、`log`、`block-editor.css` | 可（書き直し要） | data-editor（`./react`）。枠は `DialogFrame` としてGUIから受け取る |
| `src/components/block-editor/block-editor.css` | 27 | `7f58e36` | GUIのSCSS変数（`$ui-modal-background` など6つ） | 可（書き直し要） | data-editor。色は `themeTokens` の口で値として渡す |
| `src/lib/tw-translations/block-editor.json` | 40 | `dabdbd9` | なし | 可 | data-editor。`translations` の口で渡す |
| `src/lib/tw-preview-vm.js` | 42 | `9868fa1` | なし（scratch-vmの `central-dispatch` を直接import） | 可 | scratch-vmフォーク（MPL）のメソッドにする案。下記5f |
| `src/components/stage/preview-reload.css` | 259 | `699967a` | GUIのSCSS変数（33か所）、`.stage` のクラス | 可（書き直し要） | 紙芝居のオーバーレイ（turbowarp-kamishibai-app、MPL）が自分で持つ。下記5g |
| `src/examples/extensions/block-editor.js` | 49 | `7f58e36` | なし | 可 | data-editorの例 |
| `src/examples/extensions/block-editor-descendants.js` | 45 | `9d84c28` | なし | 可 | data-editorの例 |
| `scripts/local-security-preview.cjs` | 273 | `8baae0a` | なし | 可 | security-dialog、またはplus-editorのローカルカタログのプレビュー |
| `scripts/local-plus-preview.cjs` | 47 | `ba784d8` | なし | 可 | 同上 |

このほか、フォークの `docs/` に新規の文書が11本（413行）あります。どれも作者は同じです。`extension-camera-controls.md`・`extension-stage-controls.md` は、#115・#117の後は実装と合わなくなっているので、段階5の該当する移送と一緒にplus-editorへ移すか削除します。

### 本家のファイルの改変

本家のファイルの改変は、GPL-3.0のままフォークに残します。中身をパッケージへ移すときは、改変を差し込み口を呼ぶ数行へ縮め、移るのはkubohiroyaが書いた新規のコードと値だけです。

| ファイル | 差分 | 今の中身 | 最終形（案） |
|---|---|---|---|
| `src/containers/tw-security-manager.jsx` | +80 −5 | security-dialog 0.5.2の一括確認、Plusホストの起動、Plus一覧の審査モード | 口を呼ぶ数行（段階4） |
| `src/containers/blocks.jsx` | +66 −3 | ブロック編集の結線とモーダル | 口を呼ぶ数行（5e） |
| `src/lib/tw-packager-integration-hoc.jsx` | +51 −4 | Plus作品をPackager組み立て画面へ回す | 口を呼ぶ数行（5c） |
| `src/containers/extension-library.jsx` | +40 −2 | 「TurboWarp-Plus」の枠 | 口を呼ぶ数行（5d） |
| `src/components/controls/controls.jsx` | +36 | 受け取ったステージ操作を描く | 残す（済） |
| `src/components/controls/controls.css` | +40 | 同上のクラス | 残す（済） |
| `src/components/library/library.jsx` | +27 −10 | `busy`・`customTag`・`renderCustomContent` | 汎用の変更として残す。本家へ送る候補 |
| `src/components/library/library.css` | +24 | 同上のクラス | 同上 |
| `src/containers/controls.jsx` | +26 | `stageControls` の口 | 残す（済） |
| `src/lib/sb-file-uploader-hoc.jsx` | +23 −3 | 取消・読み込み失敗の見分け | 口を呼ぶ数行（5c） |
| `src/reducers/modals.js` | +23 −1 | ホストのモーダル、`blockEditorModal` | `blockEditorModal` を外す（5e） |
| `src/addons/api.js`・`entry.js`・`hooks.js` | +25 −4 | 起動を待つアドオン | 残す（済） |
| `src/lib/vm-manager-hoc.jsx` | +13 −1 | 取消・読み込み失敗の見分け | 口を呼ぶ数行（5c） |
| `src/lib/themes/gui/light.js`・`dark.js` | +18 −2 | `block-editor-*` の3色と `themeTokens` の口 | 3色を外す（5e） |
| `src/lib/tw-extension-gui-api.js` | +9 | `stageControls`・`blockEditors`・`createPreviewVm` | `extensionGuiApi` の口に縮める（5e・5f） |
| `src/reducers/project-state.js` | +7 | `createCancelSecurityLoad` の口 | 残す（済） |
| `src/lib/tw-security-manager-constants.js` | +5 −2 | `LoadExtensions` と `securityModals` の口 | `LoadExtensions` を外す（段階4） |
| `src/lib/tw-translations/index.js` | +4 | `block-editor.json` と `translations` の口 | `block-editor.json` を外す（5e） |
| `src/lib/blocks.js` | +4 | 文書エディターのハット形状と `registerBlockShapes` の口 | import を外す（5a） |
| `src/lib/vm-listener-hoc.jsx` | +4 | `.twextsec-modal` の判定と `shouldIgnoreKeyEvent` の口 | 判定を外す（5a） |
| `src/components/modal/modal.jsx`・`.css` | +8 −4 | `hideCloseButton`、モバイルでの重なり | 汎用の変更として残す。本家へ送る候補 |
| `src/components/gui/gui.jsx` | +2 | `TWPlusWorkspaceAttachment` | 残す（済） |
| `src/components/stage/stage.css` | +1 | `preview-reload.css` のimport | 外す（5g） |
| `src/components/tw-security-manager-modal/data-url.css` | +1 −1 | 入力欄の高さ | 汎用の変更として残す |
| `package.json`・`package-lock.json` | +14 −2・+1,883 −76 | familyの4依存ほか | 段階6で外す |
| `webpack.config.js` | +8 −3 | familyの3つのwebpack設定 | 段階6で外す |
| `.github/workflows/node.js.yml`・`README.md`・`.gitignore` | +34 −1 | CI、説明 | 残す。テストの行は移送に合わせて減らす |
| `test/unit/components/controls.test.jsx` | +23 | ステージ操作 | 残す（済） |

## フォークに残すフック

正本の「フォークに残すフック」の5か所を、口の名前に対応させます。「既存」は開いている口、「新設（案）」はこれから開ける口です。

| 正本のフック | 口 | 本家のファイル | 状態 |
|---|---|---|---|
| 拡張機能の一覧の「TurboWarp-Plus」の枠 | `extensionLibrary` | `extension-library.jsx` | 新設（案） |
| 作品を開くときの確認 | `installExtensionHost`、`securityModals`、`projectReview` | `tw-security-manager.jsx` | 前の2つは既存、`projectReview` は新設（案） |
| SB3の読み込みと保存 | `installExtensionHost`（VMを包む）、`classifyProjectLoadError`、`createCancelSecurityLoad` | `sb-file-uploader-hoc.jsx`、`vm-manager-hoc.jsx`、`project-state.js` | `classifyProjectLoadError` は新設（案） |
| ブロック編集と文書編集の呼び出し | `attachToWorkspace`、`blocksWorkspace`、`modals`、`themeTokens`、`translations`、`registerBlockShapes`、`extensionGuiApi` | `tw-plus-workspace-attachment.jsx`、`blocks.jsx`、`modals.js`、テーマ、翻訳、`blocks.js`、`tw-extension-gui-api.js` | `blocksWorkspace` と `extensionGuiApi` は新設（案） |
| コントロールの枠（カメラ・ステージ操作） | `stageControls` | `controls.jsx` | 済 |

正本の5か所に入らない口が2つ要ります。

- `packager`：Plus作品をPackager組み立て画面へ回す（`tw-packager-integration-hoc.jsx`）。SB3の保存の一部として扱う案です。
- `shouldIgnoreKeyEvent`・`awaitStartupAddons`：既存。キー入力とアドオンの起動順で、上のどれにも付随します。

正本の「フォークに残すフック」の箇条書きに、この2つを足すかどうかは、PR #75以降の正本の更新で決めます。

## 段階4 開くときの許可を共通の選択画面にまとめる

目的：作品を開くとき、通常のカスタム拡張とPlus拡張を、security-dialogの1つの画面（`ExtensionReview mode="open"`）で尋ねます。フォーク独自の許可画面「拡張機能の実行を許可しますか？」と、右上の「拡張の検証・許可」をなくします。

### 今の形

- `tw-security-manager.jsx` が、security-dialog 0.5.2の `installBatchExtensionLoader` で通常のカスタム拡張をまとめて尋ね、`ExtensionSecurityDialog` を描きます。
- 続けて `startupPlusExtensionHost` がPlusホストを起動します。Plus拡張は、ローダーが取得・照合した後、1つずつ `tw-plus-permission-ui.js` の画面で尋ねます。
- security-dialog 0.7.0では `ExtensionSecurityDialog` と `ExtensionSelectionList` がなくなり、`ExtensionReview` に置き換わりました。0.7.0の `installBatchExtensionLoader` は、ホストが `collectEntries`・`applyDecisions`・`identify` を渡せば、Plus拡張も同じ画面に並べます。

### 手順

| # | リポジトリ | 内容 | 本家のファイルの変化 |
|---|---|---|---|
| 4-1 | フォーク | `projectReview` の口を開ける。`tw-security-manager.jsx` は、ホストが渡したら `installBatchExtensionLoader` の代わりにそれを呼び、`securityModals` で宣言された種類の画面を、ホストが渡す描画関数に `Modal` を `DialogFrame` として渡して描く。渡さなければ今の動作 | `tw-security-manager.jsx` が+数行 |
| 4-2 | plus-editor | security-dialog 0.7系とextension-loader 0.6系を開発依存に加える。結合モジュールで `projectReview` を実装する。`collectEntries` はローダーの `projectIO.prepare` で読んだManifestからPlus拡張の行を作る。`applyDecisions` は、決まった実行の可否をローダーの許可に、`remote-cacheable` の控えの辞退を `declineCaching` に渡す。`identify` は `Manifest.uri` を返す | なし |
| 4-3 | plus-editor | `installExtensionHost` の口を埋める。ローダーの `requestApproval` は、4-2で決まった答えを引くだけにして、画面を出さない。取得の再試行は security-dialog の `createExtensionWaitDialog` で示す。照合の失敗と読み込みの失敗は、共通の選択画面とTurboWarp-Plus一覧に示す | なし |
| 4-4 | フォーク | `tw-plus-permission-ui.js`（139行）とそのテスト（122行）を削除する。`tw-plus-extension-host.js` と `playground/plus-packager.js` からの呼び出しも外す。`tw-security-manager.jsx` から security-dialog 0.5.2の画面を外し、`SecurityModals.LoadExtensions` を `securityModals` の口へ移す | `tw-security-manager.jsx`・`tw-security-manager-constants.js` が減る |

4-1と4-2・4-3は別のリポジトリなので並行して作れます。plus-editorがフォークの4-1の版を固定してから、4-2・4-3を有効にします。4-4は4-3がPagesに出てからです。

### 気をつけること

- **同じ画面の部品が2つの版で入る期間がある。** 4-2から4-4までは、フォークが0.5.2、plus-editorが0.7系を持ちます。両方が `.twextsec-*` のクラスを定義するので、4-2のPRで、開くときの画面がどちらの版で描かれているかをE2Eで確かめます。期間を短くするため、4-4は4-3のすぐ後に行います。
- **単一HTMLを受け取った人への確認。** 今は、単一HTMLのランタイム（plus-editorの `build-extension-runtime.cts` がフォークの `tw-plus-extension-host.js` から作る束）も `tw-plus-permission-ui.js` で尋ねます。カタログにある拡張は#105から確認なしで動きますが、カタログにない拡張には画面が要ります。security-dialogの画面はReactとCSSを要るので、JavaScriptだけの束に入れるかどうかを決める必要があります（「判断が必要なこと」2）。
- **Packager組み立て画面**（`plus-packager.js`）も同じ画面を使っています。plus-editorの `site/plus-integration.packager.js` に、4-3と同じ答えの引き方を渡します。

### E2Eで確かめること

plus-editorの統合E2E（turbowarp・extension-loaderの2つのsuite）で、次を確かめます。

- 通常のカスタム拡張とPlus拡張を両方持つ作品を開くと、画面が1回だけ出て、両方の行が並ぶ。
- 「拡張の検証・許可」（`data-testid="tw-plus-extension-status"`）が出ない。
- 拒否すると既定の作品に戻る（`createCancelSecurityLoad`）。
- `remote-cacheable` の控えを断ると、その拡張についてキャッシュの読み書きが起きない。
- 単一HTMLとPackager組み立て画面で、カタログにある拡張は確認なしで動く。

今のE2Eは `tw-plus-allow`・`tw-plus-extension-status` などを、6つのファイルで37か所参照しています（`editor.spec.cts` 13、`packaged.spec.cts` 8、`packager-builder.spec.cts` 7、`catalog-authoring.spec.cts` 3、`desktop.cts` 3、`turbowarp/editor.spec.cts` 3）。この段階ではテスト自体を書き換えるので、「件数が変わらない」ことは基準になりません。書き換えたテストと、そのテストが前に確かめていたことの対応表をPRに付けます。

## 段階5 機能を1つずつ移す

本家のファイルの改変が少ない順に並べます。各手順は「口を開ける（フォーク）」「その口に実装を載せる（plus-editor・パッケージ）」「フォークの写しを消す（フォーク）」の3つのPRで閉じます。差し込み口の設計に従い、口を開ける前に、その口が運ぶコードがGUIの内部の何に触れているかを読みます。

| # | 移すもの | 本家のファイルの変化 | 行き先（案） | 前提 |
|---|---|---|---|---|
| 5a | 開いている口に中身を載せる：文書エディターのハット形状、`.twextsec-modal` のキー判定 | `blocks.js` −2行、`vm-listener-hoc.jsx` −2行 | document-editor（既存の `registerDocumentSourceRootHatShape`）、security-dialog（判定の関数を公開する） | なし |
| 5b | 単一HTMLのランタイムとPackager組み立て画面の入口 | なし | extension-loader、plus-editor | 段階4 |
| 5c | ローダーのVM側（登録・作品の読み書き・失敗の印・追加の制御・Packagerへの回送） | `sb-file-uploader-hoc.jsx`・`vm-manager-hoc.jsx`・`tw-packager-integration-hoc.jsx` が数行ずつに縮む | extension-loader | 段階4、5b |
| 5d | Plus一覧の枠 | `extension-library.jsx` が数行に縮む | security-dialog、plus-editor | 段階4、5c |
| 5e | ブロック編集の呼び出し | `blocks.jsx`・`modals.js`・テーマ2つ・翻訳・`tw-extension-gui-api.js` が縮む | data-editor | なし |
| 5f | プレビュー用VM | `tw-extension-gui-api.js` −2行 | scratch-vmフォーク | 5eの `extensionGuiApi` の口 |
| 5g | プレビューの再読み込み画面の位置 | `stage.css` −1行 | turbowarp-kamishibai-app | なし |
| 5h | 補助スクリプトと文書 | `package.json` のscriptsが減る | security-dialog、plus-editor | 5d |

### 5a 開いている口に中身を載せる

- plus-editorの結合モジュールの `registerBlockShapes` で、document-editorの `registerDocumentSourceRootHatShape` を呼ぶ。フォークの `src/lib/blocks.js` から、そのimportと呼び出しを外す。
- security-dialogが、要素が自分の画面の中にあるかを答える関数を公開する（例：`isReviewKeyEvent(event)`）。plus-editorが `shouldIgnoreKeyEvent` に渡し、フォークの `vm-listener-hoc.jsx` から `.twextsec-modal` の判定を外す。
- E2E：文書ソースのハット形状が描かれること（turbowarp suite）、確認画面でキーボードの操作が効き、ステージにキーが届かないこと（`extension-security.spec.cts`）。

### 5b 単一HTMLのランタイムとPackager組み立て画面

- 今、plus-editorの `build-extension-runtime.cts` はフォークの `src/lib/tw-plus-extension-host.js` を、`build-plus-packager.cts` は `src/playground/plus-packager.js` を入口にしています。本家のファイルは関わりません。
- `installPlusExtensionHost` をextension-loaderの新しいサブパス（案：`./scratch-vm`）へ、`tw-plus-packager.js` を `./packager` の隣へ移す。単一HTMLの照合（埋め込んだdigestとの照合、plus-editor #72の説明にある「照合するのはあちら」）も一緒に移る。照合の場所はフォークからloaderへ変わるが、「どのdigestを埋め込むかはplus-editor、照合は束の中」という分担は変わらない。
- plus-editorの2つのビルドスクリプトの入口を、plus-editorの `site/` のファイルに変える。
- E2E：extension-loader suiteの `packaged.spec.cts` と `packager-builder.spec.cts`。生成したHTMLの中のローダーの版が、plus-editorのlockの版と一致すること。

### 5c ローダーのVM側

- 移すもの：`tw-plus-extension-registrar.js`、`tw-plus-project-loader.js`、`tw-plus-extension-load-failure.js`、`tw-plus-extension-authoring.js`、`tw-plus-catalog-authoring.js`、`extension-project-limits.js`。行き先はextension-loaderの `./scratch-vm`（案）です。
- 登録は、scratch-vmの `src/` を直接importする代わりに、`getExtensionServicePort()` を通します。`Scratch` に渡すAPIの組み立て（scratch-vm由来の13行）は、ファイルの先頭に出所（TurboWarp/scratch-vmの `tw-unsandboxed-extension-runner.js`、MPL-2.0）を書いて残します。`tw-l10n.js`・`tw-static-fetch.js`・`tw-extension-api-common.js` を使う部分は、scratch-vmフォークがportとして公開するか、loaderが受け取る引数にします。
- 新しい口 `classifyProjectLoadError(error)`：`'cancelled'`・`'failed'`・`null` を返す。`sb-file-uploader-hoc.jsx` と `vm-manager-hoc.jsx` は、security-dialogとPlusホストからのimportの代わりにこれを使う。返したあとの画面遷移は、今の `tw-extension-security-cancel.js` のままフォークに残す。
- 新しい口 `packager`：`prepare(buffer)` が組み立て画面のURLか `null` を返す。`tw-packager-integration-hoc.jsx` からloaderのimportを外す。
- 作品の4つの形式を扱う部分（`tw-plus-catalog-authoring.js` は今も古い綴り `remote` を使う）は、移すときにloader 0.5.0以降の綴りに揃えます。旧ローダーの綴りで保存した作品の後方互換性は保証しない、という正本の決定に従います。
- E2E：extension-loader suite全体と、turbowarp suiteの作品の読み込み・保存。Manifestと `embedded` の中身が、保存と読み込みの往復で残ること。

### 5d Plus一覧の枠

- 新しい口 `extensionLibrary`：`{tag, label, icon, renderContent({filterQuery, locale, vm, onBusyChange, onRequestClose, onCategorySelected})}`。`extension-library.jsx` は、口があればタグを足し、`library.jsx` の `renderCustomContent` へつなぐだけにする。
- `tw-plus-library.jsx` は、security-dialog 0.7の `ExtensionReview mode="add"` と、plus-editorの結合モジュール（カタログの読み込み、5cのauthoringの呼び出し）に分けて書き直す。`plus-library.css` と `extension-security-dialog.css` はsecurity-dialogへ、`icon.svg` はplus-editorへ移す。GUIの色は `themeTokens` の口で値として渡す。
- `tw-security-manager.jsx` の `getPlusReviewedMode`（一覧で選んだ実行の可否を、VMの確認に答える部分）は、loaderのauthoringが許可を直接持つ形に変えて外す。
- E2E：`catalog-authoring.spec.cts`、`turbowarp/editor.spec.cts` の一覧の操作。4つの形式から選べて、既定が `remote-cacheable` であること。

### 5e ブロック編集の呼び出し

- 新しい口 `blocksWorkspace`：`blocks.jsx` がワークスペースを作った後、`{workspace, ScratchBlocks, vm, locale, formatMessage, canOpen, ready}` を渡して呼び、返ったものを破棄のときに `dispose()` する。`ready` は `AddonHooks.startupAwaitedAddonsReady` です。
- ブロック編集のモーダルは、`modals` の口でホストが宣言した名前で開閉する。今の `blockEditorModal`（`modals.js`）は外す。描く場所は、差し込み口の設計で予定していてまだ開いていない `alwaysMountedModals` の口を開けるか、`blocksWorkspace` が返すものをホストが描くかのどちらかで、口を開けるPRで決める。
- 新しい口 `extensionGuiApi`：`Scratch.gui` に足すものをホストが返す。`blockEditors` と `stageControls` はここから渡す。
- data-editorの `./turbowarp` に `tw-block-editor-service.js`・`-capabilities.js`・`-startup.js` を、`./react` に `tw-block-editor-modal.jsx` と `block-editor.css` を移す。`block-editor.json` は `translations` の口、テーマの3色（light・darkそれぞれ）は `themeTokens` の口で渡す。例の2つの拡張はdata-editorの例にする。
- E2E：turbowarp suiteの `block-icon-preview.spec.cts`・`fixed-inputs.spec.cts`、ブロック編集を開いて保存できること。
- 5c・5dとは触るファイルが重ならないので、並行して進められます。

### 5f プレビュー用VM

- `tw-preview-vm.js` は、編集中のVMと共有している `central-dispatch` の `runtime`・`extensions` を一時的に外して、別のVMを作ります。VMの内部の約束に依存しているので、GUIではなくscratch-vmフォークのメソッドにする案です（例：`VirtualMachine.createPreviewVM()`）。scratch-vmフォークはMPL-2.0なので、規則1に反しません。
- `Scratch.gui.createPreviewVm` は5eの `extensionGuiApi` の口から渡す。
- E2E：`block-icon-preview.spec.cts`。プレビュー用VMを作っても、編集中のVMの拡張が登録し直されないこと。

### 5g プレビューの再読み込み画面

- `preview-reload.css`（259行）は、紙芝居のランタイムが作る `#dsl4-preview-reload-*` の要素の位置を、GUIのメニューと操作バーに合わせる指定です。要素の持ち主はturbowarp-kamishibai-app（MPL-2.0）の `src/builder/dsl4-preview-reload-overlay.ts` で、そちらには既に、ボタンをステージ操作の枠へ置く `stageControls.addButton` があります。
- 紙芝居の公開版がEditorの操作バー（plus-editor #69のドック）を使うことを確かめたうえで、フォークの `preview-reload.css` と `stage.css` のimportを削除する。使わない間は、位置の指定を紙芝居の側へ移す。GUIのCSSモジュールのクラス（`.stage`）はビルド時にハッシュされるので、plus-editorの全域スタイルシートからは狙えません（差し込み口の設計の「CSSに口を作らない理由」）。
- E2E：紙芝居の公開版を開き、状態ボタンが操作バーの中に出て、メニューと重ならないこと。今のplus-editorのE2Eにはこの確認がないので、足すかどうかをPRで決める。

### 5h 補助スクリプトと文書

- `scripts/local-security-preview.cjs`・`local-plus-preview.cjs` は、security-dialogの手元確認か、plus-editorのローカルカタログのプレビューに統合する。`package.json` の `preview:security` を外す。
- フォークの `docs/` の11本は、移った実装と一緒に移すか、古くなったものを削除する。

### 並行して進められる組み合わせ

| 組み合わせ | 並行できるか | 理由 |
|---|---|---|
| 段階4 と 5a・5e・5g | できる | 触る本家のファイルが重ならない |
| 5c と 5e | できる | 5cはHOC2つとPackagerのHOC、5eは `blocks.jsx` ほか |
| 5e と 5f | できない | どちらも `tw-extension-gui-api.js` を触る。`extensionGuiApi` の口を先に1つのPRで開ければ、その後は並行できる |
| 5c と 5d | できない | 5dは5cのauthoringを使う |
| 5b と 5c | できない | どちらも `tw-plus-extension-host.js` を動かす |
| 段階4 と 5b・5c・5d | できない | どれも `tw-security-manager.jsx` か `tw-plus-extension-host.js` を触る |

plus-editor側は、どの手順も `site/plus-integration.js` を触ります。並行するときは、口ごとに別のファイルに分けてから `plus-integration.js` で組み合わせると、衝突が小さくなります（`stage-controls.js`・`plus-catalog.js` と同じ形）。

## 段階6 フォークからfamilyへの依存を外す

5a〜5hが済むと、フォークのソースはfamilyのパッケージをimportしなくなります。そのうえで次を行います。

### フォーク

| ファイル | 外すもの |
|---|---|
| `package.json`（dependencies） | `@kubohiroya/turbowarp-document-editor`（0.1.0-rc.1）、`@kubohiroya/turbowarp-extension-data-editor`（^0.5.0）、`@kubohiroya/turbowarp-extension-loader`（0.3.1）、`@kubohiroya/turbowarp-extension-security-dialog`（0.5.2） |
| `package.json`（devDependencies） | `@turbowarp/packager`（`plus-packager.js` のため）、`jsdom`（移ったテストのため）。どちらも移送後に使う箇所が残らないことを確かめてから |
| `package.json`（scripts） | `test:block-editor`・`test:extension-security`・`test:plus-extension-loader`・`test:document-editor`。`test:plus-integration` は口のテストなので残す |
| `package-lock.json` | 上に伴う変化 |
| `webpack.config.js` | `withExtensionLoaderWebpack4`・`withDocumentEditorWebpack4`・`withBlockEditorWebpack4` の3つ。`resolve` に足した `config` の行も、`src/config` が空になれば外す |
| `.github/workflows/node.js.yml` | 移ったテストの実行 |

残る依存はscratch-vmフォーク（`git+https://github.com/kubohiroya/scratch-vm.git#…`）だけです。本家との差は `package.json` のこの1行と、`package-lock.json` の対応する部分だけになります。

### plus-editor

- **`prepare-core.ts` のコピーをやめる。** 今は、plus-editorのlockで入れたdata-editor 0.7.0を、GUIの `node_modules` へコピーして差し替えています。GUIがdata-editorに依存しなくなれば、結合モジュールがplus-editorの `node_modules` から直接importするので、コピーは要りません。`prepare-core.ts` は、GUIのrevisionが固定と一致することを確かめるだけになるので、`verifyHost` の後継に吸収します。
- **`verifyHost` を、plus-editorのlockを基準にした確認に置き換える。**
  1. GUIのrevisionが `site/source.json` の `guiRevision` と一致する（今と同じ）。
  2. GUIの `package.json` と `package-lock.json` に、scratch-vmフォーク以外の `@kubohiroya/*` がない。依存が戻ってきたら止めるための確認です。
  3. scratch-vmフォークが `vmRevision` に固定されている（今と同じ）。
  4. familyのパッケージは、plus-editor自身の `package.json` に正確な版で宣言され、`package-lock.json` がnpmの公開tarballと `integrity` に解決している。今の `verifyNpmLoader` と `verifyDocumentEditorDependency` を、パッケージ名の一覧で回す1つの関数にまとめる。
  5. React・scratch-vm・central-dispatchが、束の中で1つの実体に解決している。Reactは今の `webpack.config.cts` のaliasでGUIの実体へ解決させている。scratch-vmとcentral-dispatchも同じ形で解決させ、`check-artifact.ts` で確かめる。
- **`site/source.json` と `site/extension-source.json` から外す項目**：`coreRepository`・`coreRevision`・`coreVersion`、`securityPackage`・`securityVersion`、`loaderRepository`・`loaderRevision`・`loaderVersion`・`loaderSource`・`loaderIntegrity`、`documentEditor*`。版はlockが決めます。残すのは `guiRepository`・`guiRevision`、`vmRepository`・`vmRevision`・`vmBaseRevision`、`packagerRepository`・`packagerRevision` です。
- **開発依存に加えるもの**：security-dialog、extension-loader（段階4で加える）。data-editorは既にあり、document-editorは実行時依存のまま（YAML編集のコマンドのため）。
- `build-info.json.extensionIntegration` に記録する依存のSHAも、lockから取るように変える。
- E2E：turbowarp・extension-loaderの2つのsuiteが、段階6の直前のコミットと同じ件数で通ること。

### 連鎖リリース

フォークがfamilyのnpm依存から外れるので、plus-packagesの `bump:downstream` の連鎖からフォークがなくなります。上流への追従はplus-editorの `release.yml` に集まります（正本の「再編で得られるもの」3）。連鎖の定義からフォークを外す変更は、段階6のPRと同時に行います。

## 本家の取り込みとの関係

本家の未取り込みは18コミット（`54043cc` まで）です。本家とフォークの両方が変更したファイルは、`package.json`、`package-lock.json`、`src/addons/api.js`、`src/containers/tw-security-manager.jsx`、`test/unit/components/controls.test.jsx`、`webpack.config.js` の6つで、正本の記載と変わっていません。

- 段階4は `tw-security-manager.jsx` を触ります。本家の取り込み（プロジェクトを閉じたときに権限を戻す修正を含む）とこのファイルで衝突するので、取り込みを先に終えてから4-1・4-4を始めます。
- 段階6で `package.json`・`package-lock.json`・`webpack.config.js` からfamilyが消えると、6つのうち3つで衝突の原因がなくなります。

## 判断が必要なこと

1. **ローダーをOFFにしたときの旧経路を残すか。** 起動URLの `twPlusExtensionLoader=0` でローダーを切ると、Plus一覧は `tw-plus-extension-loader.js` と `tw-plus-extension-permissions.js` でVMに直接読み込みます。旧フラグ `twPlusExtensions=1` も同じ経路です。正本は「ローダーが扱う拡張の入口は一覧だけ」と決めていますが、ローダーを切った場合の扱いは書いていません。残すなら5dでsecurity-dialog側に移し、残さないなら5dで削除します。
2. **単一HTMLを受け取った人に、カタログにない拡張をどう尋ねるか。** security-dialogの画面をランタイムの束に入れる（ReactとCSSが要る）か、その束では今の簡単な画面に相当するものをsecurity-dialogから出すか。段階4-4の前に決めます。
3. **著作権者の確認。** コミットの作者はすべて `Hiroya Kubo <hiroya@cuc.ac.jp>` で、kubohiroyaのアカウントと同じ人と見ています。所属先のメールアドレスで書かれているので、所属先の規程上、著作権がkubohiroya個人にあることを、MPL-2.0で公開する前に本人が確かめてください。
