# Editor の画面文言の移設（2026-11-22）

これは過去の記録です。新しく始めるときは[手順書](../release-executor.md)を使ってください。

Editor の `site/` にあった画面と文言を各パッケージへ移しました。
Editor 側は結線だけにしました（kubohiroya/turbowarp-plus-editor#742）。
移した先のパッケージを公開し、依存の順に伝えた連鎖の記録です。
例外設定は [editor-ui-text-2026-11-22.exceptions.json](editor-ui-text-2026-11-22.exceptions.json) です。

## 起点と計画

```sh
npm run --silent bump:downstream -- turbowarp-plus-editor-workbench turbowarp-plus-editor-git \
  turbowarp-plus-editor-project-folder turbowarp-extension-loader --json > plan.json
npm run --silent release -- --plan plan.json --workspace <ws> --discover --repos-dir <repos> \
  --config docs/release-chains/editor-ui-text-2026-11-22.exceptions.json > preview.json
npm run release -- --plan plan.json --workspace <ws> --resolved preview.json \
  --execute --confirm <digest> --concurrency 1 --reference-dir <repos>
```

## 公開した版

- extension-loader 0.13.0
- extension-security-dialog 0.13.0
- plus-editor-code-views 0.24.0
- plus-editor-git 0.27.0
- plus-editor-project-folder 0.22.0
- sb3-save-format 0.5.0
- title-menu 0.7.0
- plus-editor-workbench 0.33.0

samples、plus-desktop、plus-editor は、同時に進んでいた family 全体の依存更新（[family-2026-11-22.exceptions.json](family-2026-11-22.exceptions.json)、#145）が上げました。
その時点でこの連鎖に残る分はなくなりました。
#742 は、その版に揃えたうえでマージしました。

## 途中で起きたこと

- **計画のやり直し。** kamishibai-app の main が実行中に 4.0.1、続いて 4.0.2 へ進み、そのたびに「main が解析時から変わりました」で止まりました。
  毎回、新しい workspace で計画し直しました。
- **Playwright のキャッシュの競合。** plus-desktop の install が並列実行で `ELOCKED` になったため、`--concurrency 1` にしました。
- **samples の固定。** samples の検証は、`app-release.json` が示す commit の App のcheckout（`build:lib` 済み）を必要とします。
  そのため `TURBOWARP_KAMISHIBAI_BLOCK_AUTHORING_ROOT` でその場所を渡しました。
- **紙芝居の版の採番。** executor が kamishibai-app を 4.0.2 → 4.1.0 に採番し、`sb3:check` が「SB3 release source changed」で止めました。
  紙芝居は当面 4.0.x で進めます。4.1 には組織上の意味があり、DSL にも版番号が書き込まれます。
  そのため、依存の更新で版を上げてはいけません。4.1 は npm・タグ・Release・PR のどこにも出ていません。
  この再発を防ぐため、`catalog.yaml` に `releaseHold` を設けました（#143）。
  保留した repo は計画に入らず、計画の `held` に理由とともに出ます。
  例外設定の kamishibai-app の `prepare` は、その前の試行のものです。
- **重い clone。** samples の履歴には生成した SB3 が数 GB あり、clone に時間がかかりました。
  そこで executor の clone を partial clone（`--filter=blob:none`）にしました（#142、#143 に含めてマージ）。
  あわせて samples は SB3 を git から外し、GitHub Releases に置くようにしました（kubohiroya/turbowarp-kamishibai-samples#295）。

## 持ち越し

- kamishibai-app の依存更新（loader 0.13 系、sb3-save-format 0.5 系）は、持ち主が次の 4.0.x のリリースに含めます。
- Editor のテストを上流のパッケージへ移す作業は kubohiroya/turbowarp-plus-editor#741 で追います。
