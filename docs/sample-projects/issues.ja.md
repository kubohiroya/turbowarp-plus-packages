# サンプル配信のIssue草案

この文書はIssue本文作成に使用した草案の記録です。2026-10-27に公開承認を受領し、
担当者をkubohiroyaとして次のIssueを作成しました。最新の状態と運用ログはGitHubを参照してください。

- [Text Lines #41](https://github.com/kubohiroya/turbowarp-text-lines/issues/41)
- [Template #48](https://github.com/kubohiroya/turbowarp-extension-template/issues/48)
- [計画表 #25](https://github.com/kubohiroya/turbowarp-plus-packages/issues/25)

## kubohiroya/turbowarp-text-lines

タイトル: feat(samples): 3ブロックを試せるSB3をGitHub Pagesで配信する

- ブランチ: `feat/samples/lines-to-list`
- 状態: Done（ローカル実装・検証）、公開結果はGitHub Issueを参照。依存: なし。
- 対象: `samples/lines-to-list.sb3`、編集可能な元データ、再生成・差分検査、Pages配信、READMEと日英ガイドのEditorリンク。
- DoD:
  - [x] 緑の旗で3行を数え、2行目を読み、3項目のScratchリストを生成する。
  - [x] 実際のTurboWarp VMがSB3を読み込み、3ブロックの結果を確認できる。
  - [x] 再生成が決定的で、古い生成物を検出できる。
  - [x] Pages artifactにSB3と必要な拡張JSが含まれる。
  - [x] 公開後、READMEのEditorリンクから読み込みと権限確認を経て実行できる。
- 切戻し: README・ガイドのリンクとPagesへのサンプル追加をrevertする。既存の拡張の動作変更やフラグ追加はない。
- 運用ログ: 2026-10-27 start: 既存のローカル変更を保持し、独立した作業チェックアウトで着手。
- 運用ログ: 2026-10-27 blocked: 外部JS URLでは公式Editorのunsandboxed選択ができないことを確認。
- 運用ログ: 2026-10-27 done: 拡張JSのdata URL同梱へ修正し、通常の許可画面・緑の旗・再実行を確認。
- 運用ログ: 2026-10-27 blocked: 追加検証でnpmのPATH不足と依存参照先のキャッシュ書込制限を検出。
- 運用ログ: 2026-10-27 done: PATHと作業用キャッシュを分離し、repo:check・既存の10テストも通過。

## kubohiroya/turbowarp-extension-template

タイトル: feat(samples): 再現可能なSB3・Pages配信・Editorリンクを標準化する

- ブランチ: `feat/samples/editor-projects`
- 状態: Done（ローカル実装・検証）、公開結果はGitHub Issueを参照。依存: 上記Text Linesの実証は完了。
- 対象: `samples/hello-world.sb3`、共通生成・検査・配信スクリプト、Pages workflow、日英READMEとREADME雛形。
- DoD:
  - [x] `hello`ブロックの結果を表示する最小SB3を読み込み、実行できる。
  - [x] 新しい拡張で変更するID・JSパス・Pages URL・サンプル内容を文書化する。
  - [x] `samples:check`を既存CIに組み込み、Pages artifactへSB3とJSを含める。
  - [x] npm配布対象にサンプルと必要なスクリプトを含める。
  - [x] 公開後、READMEとREADME雛形の導線を確認する。
- 切戻し: サンプル関連の追加をrevertする。既存拡張API・ビルド成果物は変更しない。
- 運用ログ: 2026-10-27 start: Text Lines検証後、共通スクリプトとhello-worldを適用。
- 運用ログ: 2026-10-27 done: 公式Editorの実行・共通ツールの検査・repo:check・npm pack内容を確認。

## kubohiroya/turbowarp-plus-packages

タイトル: docs(samples): 機能拡張ごとの最小デモと実装順序を整理する

- ブランチ: `feat/samples/distribution-plan`
- 状態: Done（ローカル文書）、公開結果はGitHub Issueを参照。依存: 各パッケージのブロック定義の調査は完了。
- DoD: ブロックを提供する拡張ごとにファイル名・実行手順・期待結果・外部要件・実装順を一覧化し、支援ライブラリとの違いを明記する。
- 切戻し: 計画文書のみをrevertする。
- 運用ログ: 2026-10-27 done: Text Lines・template以外の41拡張を一覧化し、ブロック定義の棚卸しと全件対応を照合。
