# TurboWarp Plus

[**ダッシュボード → kubohiroya.github.io/turbowarp-plus-packages**](https://kubohiroya.github.io/turbowarp-plus-packages/)

[TurboWarp](https://turbowarp.org/) に機能を足す拡張・ツールチェーン・アプリケーション・
ドキュメントサイト群「TurboWarp Plus」の索引です。

> **非公式。** TurboWarp プロジェクトおよび Scratch 財団とは提携しておらず、
> 承認も受けていません。本家を置き換えるものではなく、補完するものです。

[English](README.md) | 日本語

## ダッシュボードの見方

パッケージ 1 行、カテゴリ別。60 以上のリポジトリにまたがると見失いやすい項目を列にしています。

| 列 | 内容 |
| --- | --- |
| **Issues** / **PRs** | GitHub の未クローズ issue 数・PR 数。 |
| **Revision** | 既定ブランチの先頭にタグが付いているか。`released` は最新タグ＝先頭、`N ahead` は最新タグ以降に N コミット積まれている状態。 |
| **GitHub Pages** | Pages が設定されているか、実際にアクセスして応答したか、およびトップページのスクリーンショット。 |
| **npm** | 公開バージョン、最終公開からの経過、および最新 git タグと npm のバージョンが食い違う場合の `⚠️ tag ≠ npm`。 |
| **Upstream dependencies** | 宣言されている npm 依存とそのレンジ。💀 はローカルパス参照（`file:`, `link:`, `workspace:` など）、⚠️ はレンジが最新公開版を含まなくなった状態（stale）。 |

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

npm 名は既定で `@kubohiroya/<repo>` です。異なる場合は `npm:` で指定し、npm
パッケージではないリポジトリ（ドキュメントサイト、サンプル集、デプロイ済み
アプリ）は `npm: false` にします。既定のままのリポジトリは npm に出るまで
`unpublished` と表示されます。これは意図的で、見えているべき状態です。

## ローカルでの実行

```bash
npm install
npx playwright install chromium   # サムネイルとアイコン PNG の生成時のみ必要

npm run collect                   # GitHub + npm  -> data/dashboard.json
npm run thumbnails                # スクリーンショット -> site/thumbs/
npm run render                    # ダッシュボード  -> site/index.html
npm run serve                     # http://localhost:4180/
```

`npm run build` は collect → thumbnails → render を順に実行します。
`npm run build:no-thumbnails` は時間のかかる部分を飛ばします。

収集には GitHub トークンが必要です。`GITHUB_TOKEN` を読み、なければ
`gh auth token` にフォールバックします。未認証は 1 時間あたり 60 リクエストに
制限され、1 パッケージ分にも足りません。

## 公開の仕組み

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) が `main` への push、
1 日 1 回のスケジュール、および手動実行でパイプライン全体を回し、`site/` を
GitHub Pages にデプロイします。生成物はコミットしません。`data/`、
`site/index.html`、`site/thumbs/` は毎回作り直されます。

## ブランド素材

[`scripts/icons.mjs`](scripts/icons.mjs) がマーク・ファビコン・OG 画像の唯一の
生成元です。マークは「ハットブロック（Scratch 系エディタでスクリプトの先頭に
置くブロックの形）＋ ＋」で、そこで描き起こしています。TurboWarp のロゴや
Scratch キャットから字形・配色・図案を取っていません。

## ライセンス

GPL-3.0-only。[LICENSE](LICENSE) を参照してください。
