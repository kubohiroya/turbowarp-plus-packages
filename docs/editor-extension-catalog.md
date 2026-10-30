# Editor用機能拡張カタログ

関連Issue: [#36](https://github.com/kubohiroya/turbowarp-plus-packages/issues/36)、
カテゴリ見出しの追加: [#38](https://github.com/kubohiroya/turbowarp-plus-packages/issues/38)、
一覧名・アイコンの統一: [#45](https://github.com/kubohiroya/turbowarp-plus-packages/issues/45)。
EditorのPlus一覧は、Pagesで配信する次のJSONをHTTPSで取得します。

`https://kubohiroya.github.io/turbowarp-plus-packages/extensions-v1.json`

`npm run collect` のあと `npm run editor:catalog` を実行すると、
`data/dashboard.json` と公開済みnpm成果物から `site/extensions-v1.json` を生成します。
Pages workflowおよび `build` / `build:no-thumbnails` に組み込み、ダッシュボードと
同じ `site/` を配信します。生成物はコミットしません。

## JSON契約（v1）

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-10-28T00:00:00.000Z",
  "categories": [
    {"id": "data", "title": "Data & Documents", "titleJa": "データ・ドキュメント"}
  ],
  "extensions": [
    {
      "id": "example",
      "name": "Example",
      "version": "1.0.0",
      "package": "@owner/example",
      "repository": "https://github.com/owner/example",
      "docsURL": "https://owner.github.io/example/",
      "url": "https://cdn.jsdelivr.net/npm/@owner/example@1.0.0/dist/example.js",
      "category": "data",
      "description": "An example extension.",
      "descriptions": {"ja": "機能拡張の例です。"},
      "author": "Example Author",
      "authorURL": "https://author.example/",
      "license": "MPL-2.0",
      "banner": "https://cdn.jsdelivr.net/npm/@owner/example@1.0.0/assets/block-icon.svg",
      "unsandboxed": "required",
      "dependencies": []
    }
  ]
}
```

| フィールド | 意味 |
| --- | --- |
| `schemaVersion` | 数値の `1`。互換性のない変更は新しい版とURLに分けます。 |
| `generatedAt` | 元のdashboard収集日時（ISO 8601）。 |
| `categories` | `catalog.yaml` 由来のカテゴリ定義。`{id, title, titleJa?}` を収集結果の順序で保持します。説明文は含めません。 |
| `extensions` | 読み込み可能な機能拡張の配列。配列順は依存順を保証しません。 |
| `id` / `name` | `id` は公開JS先頭の宣言コメント由来で、英数字かつ一意です。`name` は同コメント由来の表示名を、下記のファミリー表示規則で整えます。 |
| `version` / `package` | npm公開版の完全固定バージョンとパッケージ名。`package` はnpmのパッケージページへのリンクにも使用できます。 |
| `repository` | 対象リポジトリのHTTPS URL。 |
| `docsURL` | Pages APIで確認した公開ドキュメントのHTTPS URL。`pages.enabled` / `pages.live` がtrueでHTTP 200を確認できた場合だけ付与します。 |
| `url` | 完全固定npm版の読み込み用JSのHTTPS URL。 |
| `category` | `categories[].id` を参照するカテゴリID。新たに生成する全機能拡張に付与します。 |
| `description` / `descriptions` | 既定の説明とロケール別説明。宣言コメントを優先し、日本語がなければ同じnpm版の `README.ja.md` の要約を使用します。 |
| `author` / `license` | 製作者名とライセンス。製作者名は公開manifestの `author.name`（または文字列の名前）を優先し、なければ宣言コメントを使用します。 |
| `authorURL` | 公開manifestのオブジェクト形式 `author.url` に明示された製作者のHTTP/HTTPS URL。未指定なら省略します。 |
| `banner` | 下記の管理対象はファミリーサイト上の一覧用SVG。それ以外は宣言コメントのHTTPSバナーを使い、未指定なら同じnpm版の `assets/banner.svg`、`assets/banner.png`、`assets/block-icon.svg` の順で使用します。 |
| `unsandboxed` | `required` / `optional` / `not-needed` / `unknown`。宣言コメントの `true` / `false` は正規化し、未宣言や未知値は `unknown` にします。 |
| `dependencies` | 同カタログ内の機能拡張IDの配列。直接依存を列挙し、Editorが推移的にたどります。 |

説明・著者・ライセンス・バナーは取得元にない場合は省略します。
`docsURL` はPages設定・HTTPS・疎通を確認できなければ省略します。リポジトリ名からURLを
推測したり、Pages以外のhomepageやCDN JS URLで代用したりしません。元の `url` は
機能拡張の読み込み専用として維持します。UIは説明行のリンクに `docsURL`、GitHubアイコンに
`repository`、npmアイコンに `package` のnpmページを使い分けられます。
製作者リンクは同じ公開版manifestのオブジェクト形式 `author.url` だけを使用します。
`author.name` があれば製作者名にも使い、なければJSヘッダーの `Author`、`By` の順で
表示名を補います。ヘッダーのURL・文字列形式authorに埋め込まれたURL・GitHubプロフィール
の推測URLは使いません。HTTP/HTTPS以外・相対URL・資格情報付きURLは出力しません。
リンクがなければ製作者名だけを表示できます。
要求モードが不明でもサンドボックス不要とは推定しません。読み込み時の権限確認は
Editorが引き続き行います。

`categories` と各機能拡張の `category` はv1への後方互換な追加です。
旧Editorは追加フィールドを無視して従来の一覧を表示できます。カテゴリ未対応の旧JSONも
引き続き利用できます。カテゴリ対応Editorは `categories` の配列順と見出しを使い、
日本語では `titleJa` があればそちらを表示します。空カテゴリをJSONに含めることは
ありますが、UIでは検索結果を含め表示対象の行があるカテゴリだけを表示します。
未分類の旧JSONには新しいカテゴリ情報を推測して付けません。

カテゴリIDは英数字で始まり、英数字・`_`・`-` のみを含められます。
生成処理はカテゴリIDの重複・不正ID・空見出し・指定された空の日本語見出し、
カテゴリ定義がある場合の未定義/欠落参照をエラーにします。
旧形式を組み立てるAPI呼出しはカテゴリ定義を省略できます。

## 収録と依存の規則

### ファミリーの一覧表示名

`@kubohiroya/turbowarp-*` の拡張だけ、一覧の表示名を `TurboWarp-*` 形式に揃えます。既存の `TurboWarp` 接頭辞を重ねず、単語間の空白と `/` をハイフンにします。大文字・小文字や製品固有の綴りは保持します。

| 公開JS内の名称 | 一覧の表示名 |
| --- | --- |
| Runtime Expression | TurboWarp-Runtime-Expression |
| WebUSB PaSoRi | TurboWarp-WebUSB-PaSoRi |
| jsQR | TurboWarp-jsQR |
| WebRTC Manual Pairing | TurboWarp-WebRTC-Manual-Pairing |
| TurboWarp YAML/JSON | TurboWarp-YAML-JSON |
| TurboWarp-A-Frame | TurboWarp-A-Frame |

既存の `Sesame`、`Pairing`、`jsQR`、`PaSoRi`、`A-Frame`、`UUID`、`AR`、`API` の表記は変更しません。他のownerや、この命名対象に属さないパッケージへ `TurboWarp` を付けることはありません。現時点で命名規則の例外はありません。将来、固有の製品名を保持すべき理由があれば、`EXTENSION_DISPLAY_NAME_EXCEPTIONS` に表示名と具体的な理由を記録します。理由が空の例外は生成エラーです。

これはカタログの表示名だけの整形です。拡張ID・npmパッケージ名・完全固定バージョン・JSの取得URL・依存関係・公開済みJSのバイト列は変更しません。

### 管理された一覧用アイコン

`scripts/lib/extension-branding.ts` の `CATALOG_ICON_REPOSITORIES` に列挙した拡張だけ、ファミリーサイトの `assets/extension-icons/<repository>.svg` を一覧画像として使用します。画像は各パッケージのブロックアイコンと同じSVGバイト列で管理します。対象外や他ownerのバナーは置き換えません。表示画像の更新はJSの固定版や読み込み許可を更新しません。

公開前の表示確認は、記録したカタログJSONから再現できます。

```sh
node --import tsx scripts/preview-editor-catalog.ts /absolute/path/catalog-before.json
```

このコマンドはネットワークを使わず、入力の生成日時・ID・npm版・JS URL・依存関係を保持して、名前と一覧画像だけを更新した `site/extensions-v1.json` を生成します。生成物はコミットしません。

`catalog.yaml` にあるパッケージのうち、収集結果に機能拡張宣言があり、npm公開済みで、
非推奨・アーカイブ・アプリ・ビルド用パッケージでないものを候補にします。
JSはnpmの完全固定版のファイル一覧から探し、`jsdelivr` / `unpkg` 指定を優先します。
`dist/` 直下のJS先頭に有効なIDと名称の宣言があるものだけを読み込み対象とします。
成果物のコードは実行しません。候補に有効なJSがない場合は生成を停止します。

依存は、同じ公開版の `package.json` の `dependencies`、`peerDependencies`、
`optionalDependencies` から取得します。このカタログの機能拡張への参照だけをIDへ
変換します。`devDependencies` と機能拡張でないライブラリは含めません。
optionalの機能拡張も一覧では自動選択の対象です。runtimeとpeerの両方に同じ名前が
あれば両方のレンジを検証し、IDは重複させません。

ID・パッケージ重複、公開manifestの名前/版不一致、既知だが収録されていない拡張への
依存、依存バージョン範囲外、循環、HTTPSでないメタデータURL、取得失敗があれば
ビルドを失敗させます。途中までのカタログをPagesへ公開しません。

## 検証と切戻し

```bash
npm run typecheck
node --import tsx --test test/extension-catalog.test.ts
npm run editor:catalog
```

公開後は上記HTTPS URLのHTTP応答とJSONの `schemaVersion`、IDの一意性、依存参照を
確認し、Editorからのクロスオリジン取得を確認します。ローカル生成だけでは新URLの
公開完了を確認できません。

カテゴリ追加の検証では、`catalog.yaml` と同じ順序・見出しが出力されること、全行の
カテゴリ参照が解決すること、カテゴリ追加前後で既存の収録拡張・URL・依存グラフが
変わらないことを確認します。

Editor側のPlusフラグをOFFにして再読み込みすると使用を停止できます。
生成処理の切戻しは、このIssueの生成スクリプト・npm scripts・Pages workflowの差分を
revertします。既存のダッシュボード表示・集計JSONは変更しません。
