# data-editor 0.8.0 の連鎖リリース

2026-11-03 に計画と dry-run まで進め、実行の直前で取りやめました。
この文書は、そのとき作った計画・必要だった判断・実行の手順を残し、あとで同じ連鎖を実行し直すための記録です。
進み具合は [#92](https://github.com/kubohiroya/turbowarp-plus-packages/issues/92) で追います。

## 目的

- `@kubohiroya/turbowarp-extension-data-editor` を 0.8.0 として公開する。
  npm の 0.7.0 は、MPL-2.0 を宣言した data-editor#96 より前のコミット（`d96532a`）から公開されたものです。
  そのため `license` フィールドも `LICENSE` も入っていません。
  また、`dist/webpack4` が同梱する 23 の第三者パッケージのライセンス表記もありません。
  これらは data-editor#97（`a1396e1`）で直りましたが、まだ npm には出ていません。
- data-editor に依存する family の各パッケージに、新しい版の範囲を依存の順で伝える。

## 計画の作り方

[release-executor.md](../release-executor.md) の標準経路に従います。

```sh
pnpm --silent bump:downstream turbowarp-extension-data-editor --reconcile --json > plan.json
pnpm --silent release --plan plan.json --workspace <ws> --discover --repos-dir <repos> \
  --config exceptions.json > preview.json
pnpm release --plan plan.json --workspace <ws> --resolved preview.json \
  --execute --confirm <digest> --concurrency 4
```

- `--repos-dir` には、計画の 40 リポジトリを blobless clone して置きました。
  並列に clone すると GitHub との接続が切れることがあったので、fetch は 1 件ずつ行いました。
- `--concurrency 4`（#82）は、依存の段ごとに並列で進めます。
  どれかが失敗すると新しい対象は始めず、動いている対象が終わるのを待って止まります。
- 依存の更新だけで計画に入った対象は、不要なら取りやめます（#83）。
  - 上流の対象がすべて取りやめになり、適用する更新が残らない場合。
  - 作った公開物を npm に出ている版と比べ、中身が同じ場合。`version` と `devDependencies` は比べません。

  取りやめた対象には PR もタグも作らず、公開もしません。

## 計画の内容

全部で 40 件あります。依存の段ごとの件数は、1 段目から順に 1 / 19 / 7 / 8 / 4 / 1 です。

- **publish：** 38 件。
- **update-only：** 2 件（scratch-gui、camera-calibration-app）。npm には公開せず、依存の更新だけを PR にします。
  #81 からは、update-only の対象に `release.yml` を要求しません。

「上流」の列には、計画に入っている上流のうち data-editor を除いたものを載せます。
data-editor は、ほとんどすべての対象の上流です。

| 段 | リポジトリ | 操作 | 版 | 理由 | 上流（計画内） | レビュー |
|---|---|---|---|---|---|---|
| 1 | turbowarp-extension-data-editor | publish | 0.7.0 → 0.8.0 | commits-ahead | — | — |
| 2 | scratch-gui | update-only | 3.2.37 → 3.3.0 | dependency-update, commits-ahead | — | — |
| 2 | turbowarp-camera-source | publish | 0.22.1 → 0.23.0 | dependency-update | — | — |
| 2 | turbowarp-aframe | publish | 0.11.0 → 0.12.0 | dependency-update | — | — |
| 2 | turbowarp-asset-cache | publish | 0.6.1 → 0.7.0 | dependency-update | — | — |
| 2 | turbowarp-runtime-expression | publish | 0.9.0 → 0.10.0 | dependency-update | — | — |
| 2 | turbowarp-svg-text | publish | 0.13.0 → 0.14.0 | dependency-update | — | — |
| 2 | turbowarp-qr-display | publish | 0.5.0 → 0.6.0 | dependency-update | — | — |
| 2 | turbowarp-cloudflare-worker | publish | 0.6.0 → 0.7.0 | dependency-update | — | — |
| 2 | turbowarp-diagnostic-overlay | publish | 0.8.0 → 0.9.0 | dependency-update | — | — |
| 2 | turbowarp-yaml-json | publish | 0.8.0-rc.0 → 0.8.0-rc.1 | dependency-update | — | prerelease-channel |
| 2 | turbowarp-extended-notification | publish | 0.5.0 → 0.6.0 | dependency-update | — | — |
| 2 | turbowarp-named-functions | publish | 0.4.1-rc.1 → 0.4.1-rc.2 | dependency-update | — | prerelease-channel |
| 2 | turbowarp-jotai-adapter | publish | 0.6.0 → 0.7.0 | dependency-update | — | — |
| 2 | turbowarp-markdown | publish | 0.5.0 → 0.6.0 | dependency-update, commits-ahead | — | — |
| 2 | turbowarp-react-islands | publish | 0.6.0 → 0.7.0 | dependency-update | — | — |
| 2 | turbowarp-webrtc | publish | 0.7.1 → 0.8.0 | dependency-update | — | — |
| 2 | turbowarp-sesame | publish | 0.4.1 → 0.5.0 | dependency-update | — | — |
| 2 | turbowarp-text-lines | publish | 0.6.0 → 0.7.0 | dependency-update | — | — |
| 2 | turbowarp-web-speech | publish | 0.4.1 → 0.5.0 | dependency-update | — | — |
| 3 | turbowarp-ar | publish | 0.7.0 → 0.8.0 | dependency-update | camera-source | — |
| 3 | turbowarp-jsqr | publish | 0.7.1 → 0.8.0 | dependency-update | camera-source | peer-compatibility |
| 3 | turbowarp-camera-calibration | publish | 0.18.0 → 0.19.0 | dependency-update | camera-source | — |
| 3 | turbowarp-document-data | publish | 0.5.0-rc.2 → 0.5.0-rc.3 | dependency-update | yaml-json | prerelease-channel |
| 3 | turbowarp-teachable-machine | publish | 4.1.0 → 4.2.0 | dependency-update | camera-source | — |
| 3 | turbowarp-openai-realtime-api | publish | 0.4.0 → 0.5.0 | dependency-update | named-functions | — |
| 3 | turbowarp-time-space-sync | publish | 0.6.0 → 0.7.0 | dependency-update | camera-source | — |
| 4 | turbowarp-scene-graph | publish | 0.5.0 → 0.6.0 | dependency-update | ar | — |
| 4 | turbowarp-async-input | publish | 0.11.0 → 0.12.0 | dependency-update | jsqr | peer-compatibility |
| 4 | turbowarp-camera-calibration-app | update-only | 0.4.0 → 0.5.0 | dependency-update | camera-calibration, camera-source, qr-display | — |
| 4 | turbowarp-document-source | publish | 0.1.0-rc.0 → 0.1.0-rc.1 | github-registration, dependency-update | document-data, yaml-json | prerelease-channel |
| 4 | turbowarp-structured-data | publish | 0.11.0-rc.1 → 0.11.0-rc.2 | dependency-update, commits-ahead | yaml-json, document-data, named-functions | prerelease-channel |
| 4 | turbowarp-realtime-motion-capture | publish | 0.11.0 → 0.12.0 | dependency-update | camera-source, time-space-sync, aframe, jsqr, webrtc | peer-compatibility |
| 4 | turbowarp-voice-chat | publish | 0.4.0 → 0.5.0 | dependency-update | named-functions, openai-realtime-api, web-speech | — |
| 4 | turbowarp-webrtc-qrcode-pairing | publish | 0.5.0 → 0.6.0 | dependency-update | camera-source, jsqr, webrtc | peer-compatibility |
| 5 | turbowarp-3d-scene-runtime | publish | 0.6.0 → 0.7.0 | dependency-update | scene-graph | — |
| 5 | turbowarp-bubble | publish | 0.16.0 → 0.17.0 | dependency-update | svg-text, asset-cache, async-input, runtime-expression | peer-compatibility |
| 5 | turbowarp-http-server | publish | 0.5.0 → 0.6.0 | dependency-update, commits-ahead | structured-data | — |
| 5 | turbowarp-plus-editor | publish | 0.2.0-rc.3 → 0.2.0-rc.4 | dependency-update, commits-ahead | document-data, document-source, structured-data, yaml-json | prerelease-channel |
| 6 | turbowarp-kamishibai-app | publish | 4.0.0-rc.81 → 4.0.0-rc.81 | dependency-update, commits-ahead, prepared-version | asset-cache, async-input, bubble, camera-source, runtime-expression, svg-text, teachable-machine, document-source, document-data, yaml-json | prerelease-channel |

## 実行の前に必要だった判断

### 例外の指定（`exceptions.json`）

- scratch-gui は、install と検証の手順を推測できません。そこで、次のように指定しました。
  - install：`npm install --package-lock-only` → `npm ci`
  - 検証：CI と同じ 7 つの test script（`test:unit`、`test:document-editor`、`test:plus-integration`、`test:block-editor`、`test:extension-security`、`test:plus-extension-loader`、`test:components`）
  - lint は、ESLint が `eslint-module-utils` 2.14.0 で落ちる問題が残っているため外しました。
- レビュー済み（`reviewedRepositories`）として、次の 12 件をユーザーが承認しました。
  - peer の互換性：jsqr、async-input、bubble、realtime-motion-capture、webrtc-qrcode-pairing
  - RC の系列：yaml-json、document-data、document-source、named-functions、structured-data、kamishibai-app、plus-editor

この指定は手作りのファイルで、リポジトリには置いていません。実行し直すときは作り直す必要があります。

### 確認用の digest

最後の dry-run の digest は `fa6fffc47aa78d9b2b353d76be98d315a3740b0255eb89f2a8b5e5368fb12237` でした。
この digest は、計画の元になった状況の記録（2026-11-02T21:36:45Z、`f8ad8317…`）に結びついています。

## いまの状態

- 実行（`--execute`）は一度も完了していません。
  1 回目は preflight の途中で止めたので、何も変わっていません。
  2 回目は、digest を確認した段階で取りやめました。
- その後、main と npm が進んでいます。
  たとえば document-source の責務の分離（#89）で、document-source、yaml-json、document-data などの新しい RC が出ています。
  この計画と digest はもう使えません。実行するときは、collect から作り直します。

## 実行し直すときの手順

1. 状況を集め直し、`bump:downstream turbowarp-extension-data-editor --reconcile --json` で計画を作る。
2. 40 件前後の clone を最新にする（fetch は 1 件ずつ）。
3. 例外の指定を作り直し、レビューが必要な対象をまとめて確認してもらう。
4. dry-run の digest を確認してもらってから、`--execute --concurrency 4` を 1 回だけ起動する。
   途中で止まったら、同じコマンドでそのまま再開する。
5. 終わったら、ワークスペースの `state.json` から、公開・取りやめ・失敗の件数を報告する。
6. plus-editor の `site/source.json` に記録した GUI のコミットを、新しい scratch-gui に合わせて更新する。
   これは、いまの executor が扱わない別の作業です。

## 残っている改善

手作業が多かった準備を、スクリプトにしたいと考えています。

- **`release:chain` コマンド：** collect → plan → clone/fetch → dry-run を、1 つのコマンドにまとめる。
- **例外とレビュー：** 例外の指定をリポジトリに置き、レビューが必要な対象をまとめて報告する。
- **契約の読み取り：** ローカルの clone を使わず、GitHub API から契約を読む。
- **GUI の pin：** plus-editor の GUI の pin の更新を、自動化に含める。
- **patch 版：** patch 版を使えるようにし、不要な連鎖が起きないようにする。
- **CI の待ち時間：** PR の CI の結果を使い回し、main の CI を二重に待たないようにする。
