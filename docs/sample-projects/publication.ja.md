# 公開承認の対象

以下は2026-10-27にユーザーから承認された最終文面と操作範囲の記録です。
承認後の実施結果は[検証記録](verification.ja.md)と各GitHub Issueへ記載します。
リポジトリはいずれも`kubohiroya`所有、PRのbaseは`main`とします。
公開直前にremote・branch・status・対象diffを再確認しました。
Text LinesはPR #42、templateはPR #49で公開済みです。公開後の動作確認も完了しています。
計画表は[Issue #25](https://github.com/kubohiroya/turbowarp-plus-packages/issues/25)で追跡します。

操作案は、各リポジトリのIssue作成（担当kubohiroya）、記載したブランチへのpush、
記載したtitle/bodyでのPR作成です。Pages公開まで承認された場合は、変更範囲のCIを
確認してSquash & Mergeし、Text Lines → templateの順でPagesの実配信を検証します。
Issueには実際のPRと結果を記録します。npm publish・release・追加拡張の実装は対象外です。

## 1. kubohiroya/turbowarp-text-lines

- remote: `https://github.com/kubohiroya/turbowarp-text-lines.git`
- head: `feat/samples/lines-to-list`
- base: `main`
- Issue: [Issue草案のText Lines節](issues.ja.md)
- PR title: `feat(samples): Text Linesの3ブロックを試せるSB3を配信する`
- PR body:

```markdown
Text Linesの動作をEditorで直接試せるよう、3行のテキストを数え、2行目を読み、
Scratchリストへ入れるsamples/lines-to-list.sb3を追加します。
READMEと日英PagesガイドにEditor起動・ダウンロード・期待結果のリンクを掲載します。

編集可能なproject.jsonとSVGからSB3を決定的に生成し、samples:checkをCIへ追加します。
Pagesはdocs・dist・SB3を_site/へ集約して配信します。公式Editorの通常の同意画面で
サンドボックスなしを選べるよう、検証対象の拡張JSをSB3へ同梱します。

検証: 公式TurboWarp Editorで通常の権限確認と緑の旗から実行し、compiler ON/OFF・
再実行の4条件で行数3／Banana／3項目のリストを確認。生成・検査ツール6テスト、
既存の拡張10テスト、repo:check、ZIP/CRC、Pages artifactの整合性を確認しました。
公開Editorの検証では、公開予定のSB3/JSリクエストだけをローカル配信物へ差し替えています。

切戻し: この変更をrevertします。拡張本体の既定動作は変更しません。
```

## 2. kubohiroya/turbowarp-extension-template

- remote: `https://github.com/kubohiroya/turbowarp-extension-template.git`
- head: `feat/samples/editor-projects`
- base: `main`
- Issue: [Issue草案のtemplate節](issues.ja.md)
- PR title: `feat(samples): SB3デモとPages配信をテンプレートの標準にする`
- PR body:

```markdown
新しい拡張をREADMEからEditorで試せるよう、helloブロックの結果を表示する
samples/hello-world.sb3と、元データ・生成・検査・Pages配信の仕組みを追加します。
日英README・README雛形・移行チェックリストにサンプルの作り方を標準化します。

Text Linesで実証した共通スクリプトを使います。sandbox互換の拡張はPagesのJSを参照し、
unsandboxed拡張は検証対象JSを同梱して通常の同意画面を表示します。
samples:checkを既存checkへ組み込み、Pages artifactとnpm配布対象も更新します。

検証: 公式TurboWarp Editorで通常の許可と緑の旗から実行し、compiler ON/OFF・再実行の
4条件でHello, world!を確認。生成・検査ツール6テスト、ESLint、repo:check、
ZIP/CRC、Pages artifact、npm pack内容を確認しました。
公開Editorの検証では、公開予定のSB3/JSリクエストだけをローカル配信物へ差し替えています。

切戻し: サンプル関連の追加をrevertします。既存拡張APIとJSバンドルは変更しません。
```

## 3. kubohiroya/turbowarp-plus-packages

- remote: `https://github.com/kubohiroya/turbowarp-plus-packages.git`
- head: `feat/samples/distribution-plan`
- base: `main`
- Issue: [Issue草案の計画節](issues.ja.md)
- PR title: `docs(samples): 機能拡張41件の最小デモ計画を整理する`
- PR body:

```markdown
Text Linesとtemplateの先行デモに続く41拡張について、サンプルのファイル名・使用ブロック・
期待結果・依存・必要資源・実装順を一覧化します。ブロックを持たない支援ライブラリと、
helloのみ実装された2拡張の扱いも明記します。

日英READMEから計画表へリンクし、先行実装の検証結果と公開手順を記録します。
カタログとローカルのブロック定義を照合し、対象41拡張すべてが表にあることを確認しました。
既存のscripts/render.tsのローカル変更は含めません。

切戻し: 計画文書とREADMEリンクをrevertします。
```
