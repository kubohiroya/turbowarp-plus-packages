# Editor用機能拡張カタログ

関連Issue: [#36](https://github.com/kubohiroya/turbowarp-plus-packages/issues/36)、
カテゴリ見出しの追加: [#38](https://github.com/kubohiroya/turbowarp-plus-packages/issues/38)。
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
      "url": "https://cdn.jsdelivr.net/npm/@owner/example@1.0.0/dist/example.js",
      "category": "data",
      "description": "An example extension.",
      "descriptions": {"ja": "機能拡張の例です。"},
      "author": "Example Author",
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
| `id` / `name` | 公開JS先頭の宣言コメントのIDと表示名。IDは英数字で一意です。 |
| `version` / `package` | npm公開版の完全固定バージョンとパッケージ名。 |
| `repository` | 対象リポジトリのHTTPS URL。 |
| `url` | 完全固定npm版の読み込み用JSのHTTPS URL。 |
| `category` | `categories[].id` を参照するカテゴリID。新たに生成する全機能拡張に付与します。 |
| `description` / `descriptions` | 既定の説明とロケール別説明。宣言コメントを優先し、日本語がなければ同じnpm版の `README.ja.md` の要約を使用します。 |
| `author` / `license` | 宣言コメントの著者とライセンス。 |
| `banner` | 宣言コメントのHTTPSバナー。未指定なら同じnpm版の `assets/banner.svg`、`assets/banner.png`、`assets/block-icon.svg` の順で使用します。 |
| `unsandboxed` | `required` / `optional` / `not-needed` / `unknown`。宣言コメントの `true` / `false` は正規化し、未宣言や未知値は `unknown` にします。 |
| `dependencies` | 同カタログ内の機能拡張IDの配列。直接依存を列挙し、Editorが推移的にたどります。 |

説明・著者・ライセンス・バナーは取得元にない場合は省略します。
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
