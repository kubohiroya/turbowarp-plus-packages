# TurboWarp-Plus-Editorの構成・責務・ライセンス

2026-11-01時点のturbowarp-plus-editor（main）、scratch-guiフォーク（develop）、関係するパッケージのorigin/mainを読んで作成しました。
「構成と責務」と「ライセンスの切り分け」は決定した方針です。「依存の向き」の再編案は提案で、採否は未決定です。

## 構成と責務

| リポジトリ | ライセンス | 責務 | 公開先 |
|---|---|---|---|
| turbowarp-plus-editor | GPL-3.0 | Editorのランチャー、Editor本体の組み立てと配信、アイコンとスニペット | npm（ランチャーだけ）、GitHub Pages |
| scratch-guiフォーク（kubohiroya/scratch-gui） | GPL-3.0（TurboWarp版から継承） | 本家scratch-guiへの最小限の差し込み口 | 公開しない |
| 独自拡張のパッケージ（turbowarp-plus family） | MPL-2.0 | 独自拡張の実装本体 | npm |

### turbowarp-plus-editor

- npmには、ランチャーとして最小の内容だけを公開します。アイコン、編集ボタンのCSS、EditorのURLと編集ボタンを作るスニペット、固定ソースの記録（`site/source.json`）です。
- Editor本体（GUIのビルド一式）はnpmに入れず、GitHub Pagesで配信します。
- アイコンとスニペットは、このリポジトリで保持・管理します。

### scratch-guiフォーク

- 本家scratch-guiをなるべく変えず、コードを増やさない方針とします。
- 単体ではnpmに公開しません。npmの`scratch-gui`はScratch財団が公開しているパッケージで、本家と同じ名前での公開を避けるためです。

### 独自拡張のパッケージ

本家scratch-guiに対して、TurboWarp-Plus-Editorとして最終的に実現する独自拡張は、実装本体をturbowarp-plus familyの別パッケージに置きます。ライセンスはMPL-2.0です。

## ライセンスの切り分け

独自拡張はMPL-2.0のまま他のプロジェクトでも使えるようにします。一方、GPL-3.0のGUIと組み合わせたEditor本体はGPL-3.0で配信します。

これが両立するのは、MPL-2.0がGPL-3.0を二次ライセンス（Secondary License）として認めているためです（MPL 2.0 第1.12項・第3.3項）。「Incompatible With Secondary Licenses」の表示がないMPLのファイルは、GPLの作品と組み合わせた大きな作品（Larger Work）に入れて、GPLで配布できます。MPLのファイル自体はMPLのまま残ります。

この切り分けを保つため、次の規則を守ります。

1. 独自拡張のパッケージは、GPLのコードを含まず、GPLのモジュールをimportしません。対象は、scratch-gui（フォーク・本家とも）と、GPLのfamilyパッケージです。MPL-2.0のscratch-vmや、permissiveなライセンスのライブラリには依存できます。
2. GUIとの接続口（port）の型と約束は、独自拡張の側（MPL）で定義します。GPLの側（フォークとplus-editor）が、それを呼び出したり、実装を差し込んだりします。逆向き、つまりMPLのコードがGUIの部品・CSS・内部モジュールを使う形にはしません。
   - Reactなどの共有ライブラリはpeerDependenciesにして、GUIと同じ実体を使います。
   - GUIの見た目（テーマなど）が必要なら、portを通じて値として受け取ります。
3. 独自拡張のパッケージには「Incompatible With Secondary Licenses」の表示を付けません。付けると、GPLのEditorに組み込めなくなります。
4. フォークのコードを独自拡張のパッケージへ移すとき、MPL-2.0にできるのは、本家のコードを含まない新規のファイルだけです。本家のファイルの改変部分と、本家のコンポーネントを写した部分は、GPL-3.0のままフォークに残します。移す前に、ファイルごとに由来を確かめます。著作権者がkubohiroyaだけであることも確かめます。外部の寄稿が含まれる場合は、その著作権者の同意が必要です。
5. Pagesで配信するEditor本体は、GPL-3.0の作品として配ります。同梱するMPLパッケージのライセンス文と、ソースの入手先（npmとGitHub）を記録します。plus-editorは文書エディター系のパッケージについて`notices/`を生成しているので、これをすべての独自拡張のパッケージに広げます。
6. plus-editorのnpmパッケージ（ランチャー）はGPL-3.0です。

## 依存の向き

### 現状

- フォークが独自拡張のパッケージに依存し、GUIのソースから直接importしています。依存しているのは、data-editor `^0.5.0`、security-dialog `0.5.0`、extension-loader（Git `5336f13`）、document-editor `0.1.0-rc.1`、scratch-vmフォーク（Git `cb04ce7`）です。
- 一方で、plus-editorも同じパッケージの版を固定しています（`site/source.json`）。data-editorについては、plus-editorが自分のlockで入れた0.7.0を、GUIの`node_modules`へコピーして差し替えます（`scripts/site/prepare-core.ts`）。フォークの宣言（`^0.5.0`）と、実際に配信される版（0.7.0）が異なり、版の管理が二か所に分かれています。

### 再編案：plus-editorが独自拡張のパッケージに依存する

フォークは、独自拡張のパッケージに依存しないようにします。代わりにplus-editorが依存し、ビルドのときにフォークへ差し込みます。

```text
現状:   plus-editor ──固定・コピー──▶ scratch-guiフォーク ──import──▶ 独自拡張のパッケージ（MPL）

再編後: plus-editor ──依存──▶ 独自拡張のパッケージ（MPL）
            │
            └─ ビルド時に差し込む ──▶ scratch-guiフォーク（差し込み口だけ。familyへの依存なし）
```

差し込みは次のように行います。

- フォークは、差し込み口のモジュール（例：`src/lib/tw-plus-host.js`）を1つだけ持ちます。既定の実装は何もしないので、フォーク単体では本家相当として動きます。
- plus-editorのwebpack設定で、このモジュールをplus-editorの結合モジュールに差し替えます。今の設定もGUIの設定を読み込んで項目を足しているので、同じ場所で行えます。
- 結合モジュールは独自拡張のパッケージを読み込み、portに合わせて渡します。結合モジュールはPagesのビルド専用で、npmのランチャーには含めません。
- 本家のファイルの改変は、差し込み口を呼ぶ数行のフックだけにします。

再編で得られるものは次のとおりです。

1. **本家への追従が楽になります。** フォークのpackage.jsonとpackage-lock.jsonから、familyへの依存が消えます。この2つは本家とフォークの両方が変更しているファイルで、本家を取り込むたびに衝突します。
2. **版の固定が一か所になります。** plus-editorのlockだけで決まるので、`prepare-core.ts`のコピーや、GUIのmanifestとの照合（`verifyHost`）が要らなくなります。
3. **連鎖リリースが素直になります。** フォークがnpmの依存関係から外れ、「npmには出さず版だけ上げる」repoがなくなります。上流への追従は、release.ymlを持つplus-editorに集まります。
4. **ライセンスの境界がはっきりします。** GPLとMPLを組み合わせる場所が、配布する側のplus-editorに集まります。

注意すべき点は次のとおりです。

- **同じ実体を使う：** React、scratch-vm、central-dispatchなどは、GUIと同じ実体でなければ動きません。plus-editorのビルドで、これらをGUIの実体へ解決させます。拡張登録の`tw-plus-extension-registrar.js`は今、VMの内部モジュール（`scratch-vm/src/...`）を直接importしています。これは、scratch-vmフォークの`getExtensionServicePort()`のようなportに置き換えます。
- **ランチャーを最小に保つ：** plus-editorは、独自拡張のパッケージを開発依存（devDependencies）として持ち、npmのランチャーには入れません。連鎖リリースのしくみは開発依存も追従するので、独自拡張のパッケージが出るたびにplus-editorの版も上がります。データ系のパッケージについては、今も同じことが起きています。
- **フォークの確認：** フォーク単体での開発・確認には、plus-editor側のプレビュー（ローカルカタログなど）を使います。

## 現状との差（2026-11-01）

### scratch-guiフォーク

本家TurboWarp/scratch-guiの`06b2edf`（2026-10-15）からの差分です。

| 区分 | 規模 |
|---|---|
| 本家のファイルの改変 | 34ファイル、+793 / −64行 |
| フォーク独自の新規ファイル（`src`など） | 38ファイル、2,835行 |
| フォーク独自のテスト | 37ファイル、3,901行 |

本家の18コミット（`54043ccb`、10/31まで）を取り込んでいません。その中には、プロジェクトを閉じたときに権限を戻す修正と、scratch-vmの更新3回が含まれます。本家とフォークの両方が変更したファイルは、package.json、package-lock.json、`src/addons/api.js`、`src/containers/tw-security-manager.jsx`、`test/unit/components/controls.test.jsx`、webpack.config.jsの6つです。

フォークの中にある独自拡張の実装本体で、パッケージへ移す候補は次のとおりです。

| 機能 | 規模 |
|---|---|
| 拡張ローダーのGUI接続（登録・追加画面・権限画面・カタログ） | 約1,270行 |
| カメラ・ステージ操作 | 約500行（本家のファイルの改変 約90行を含む） |
| Plusライブラリの一覧画面 | 約260行（ほかに`library.jsx`などの改変が約50行） |
| プレビューの再読み込み画面 | 約300行 |

ブロック編集・文書編集・セキュリティ確認をGUIにつなぐ部分は、差し込み口のフックへ縮める対象です。

### turbowarp-plus-editor

- 独自のコードは約1,400行で、ビルド、固定ソースの検証、CIのチェック、案内ページです。YAML編集ツールは、document-editorを呼ぶ1〜9行の受け渡しになっています。
- npmパッケージに、ランチャー以外のものが入っています。
  - 拡張ローダーの起動API（`./extension-loader`の`bootstrapExtensionLoader`）
  - YAML編集のコマンド（`turbowarp-plus-editor-yaml`）と、そのための実行時依存（document-data、document-editor）
- 開発依存に、データ系のパッケージ（structured-data、named-data、yaml-json、document-source）があります。YAMLと文書のブラウザーテストに使っており、plus-editorが依存の連鎖のいちばん下になる原因です。

### ライセンス

| パッケージ | 現在 | 方針との関係 |
|---|---|---|
| turbowarp-plus-editor | GPL-3.0-or-later | 合っている |
| scratch-guiフォーク | GPL-3.0 | 合っている |
| turbowarp-document-editor | MPL-2.0 | 合っている |
| scratch-vmフォーク | MPL-2.0 | 本家（TurboWarp/scratch-vm）から継承。独自拡張から使える |
| turbowarp-extension-security-dialog | GPL-3.0-only | 合っていない。NOTICEのアイコンの帰属表示が本家と同じで、本家のセキュリティ画面に由来する可能性がある |
| turbowarp-extension-data-editor | 宣言なし（LICENSEファイルもない） | 合っていない |
| turbowarp-extension-loader | UNLICENSED・private（npm未公開、Git参照） | 合っていない |

## 移行の進め方

1. **ライセンスを揃えます。** data-editorとextension-loaderにMPL-2.0を宣言し、extension-loaderはnpmにも公開します。security-dialogは由来を確かめます。
2. **差し込みの仕組みを作ります。** フォークに差し込み口を作り、plus-editorのwebpack設定で差し替えます。中身はまだ移さず、plus-editorの統合E2Eで動作が変わらないことを確かめます。
3. **機能を1つずつ移します。** 本家のファイルの改変が少ないものから、独自拡張のパッケージへ移します。段階ごとに、plus-editorの統合E2Eで確かめます。
4. **フォークからfamilyへの依存を外します。** plus-editorの`prepare-core.ts`のコピーと`verifyHost`の照合は、plus-editorのlockを基準にした確認へ置き換えます。

本家の取り込みは、各段階と並行して続けます。未取り込みのうち、権限を戻す修正は早めに取り込みます。

## 未決事項

1. 依存の向きの再編を採用するか（この文書の提案）。
2. **スニペットのライセンス：** 編集ボタンを作る関数を、他のサイトのJavaScriptからimportすると、そのJavaScriptにGPL-3.0の義務がかかります。生成したHTMLを貼り付ける使い方なら影響しません。familyのDocsやSamplesのサイトでの使い方に合わせて、スニペットの部分だけを別のライセンス（MPL-2.0など）にするか決めます。
3. **ランチャーの範囲：** plus-editorのnpmパッケージから、拡張ローダーの起動APIとYAML編集のコマンドを外すか決めます。
4. **security-dialogのライセンス：** MPL-2.0にするか決めます。本家のコードに由来する部分があれば、書き直しが必要です。

## 関連文書

- [turbowarp-plus-editor: 責務と配信](https://github.com/kubohiroya/turbowarp-plus-editor/blob/main/docs/architecture.md)
- [turbowarp-plus-editor: 拡張ローダーの接続仕様](https://github.com/kubohiroya/turbowarp-plus-editor/blob/main/docs/extension-loader-integration.md)
- [依存順でのリリース実行](release-executor.md)
