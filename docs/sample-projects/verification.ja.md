# サンプル配信の検証記録

実施日: 2026-10-27。初回検証はNode.js 24.19.0、公開前の再検証は26.7.0。
公開前に両拡張の最新mainへ載せ直し、`.nvmrc`指定のNode.js 26へPagesも合わせました。
追加依存はありません。Text LinesのJS同梱SB3は現在のバンドルで再生成しました。

## 公開前の公式TurboWarp Editor検証

`https://turbowarp.org/editor?project_url=...`を新しいChromiumセッションで開き、
公開予定のSB3／JSに対するリクエストだけをローカルの`_site/`へ差し替えて検証しました。
Editor・VM・ブロック表示・許可画面は実際の公開Editorです。
GitHub Pagesへの公開や、公開済みURLへのHTTP 200確認を行ったという意味ではありません。

| 対象 | 許可画面 | 検証内容 | 結果 |
|---|---|---|---|
| Text Lines | 同梱JSの確認でRun without sandboxを選びAllow | 緑の旗のクリック、行数3、2行目Banana、3項目のリスト | 成功 |
| Text Lines | 同上 | 再実行でリストが3項目のまま。compiler ON/OFFの両方 | 計4条件で成功 |
| Template | Pages JSの確認でAllow | 緑の旗のクリック、Greeting = Hello, world! | 成功 |
| Template | 同上 | 再実行、compiler ON/OFFの両方 | 計4条件で成功 |

確認の前に結果変数・リストを初期化しており、前の実行結果を見て成功とすることを防いでいます。
スクリーンショットでコード、モニター、背景の重なり、リストメニュー表示も確認しました。

## 自動検査

共通スクリプトは両リポジトリで同一内容です。各6件、合計12件を通過しました。

1. コミット対象のSB3が最新であり、再生成しても同一バイト列になる。
2. 元のSVGを変更すると古いSB3を検出し、check時はSB3を書き換えない。
3. 定義から消えた拡張opcodeを拒否する。
4. 存在しないブロックへの参照を拒否する。
5. 拡張JSのIDとmanifestの不一致を拒否する。
6. Pages artifactのSB3とJSが元と一致し、編集用project.jsonは配信されない。

加えて次を確認しました。

- Python標準`zipfile`による両SB3の読み取り・CRC・素材ファイルの整合性。
- 変更した共通スクリプトのESLint。
- 両リポジトリの`repo:check`。
- Text Linesの既存`tests/extension.test.ts`、10テスト。
- Templateの`npm pack --dry-run --ignore-scripts`でSB3・元データ・必要なスクリプトを収録。
- 3リポジトリの`git diff --check`。
- 計画表の41行と、Text Lines／templateを除いたブロック提供拡張41件の一致。

拡張本体のTypeScript・生成済みJS・依存バージョンは変更していないため、
全パッケージのビルドやリリース時のフル検証は実施していません。

## 公開後の実配信確認

承認に基づき、Text Lines→templateの順にSquash & Merge・Pages公開・動作確認を完了しました。
新しいChromiumセッションで、GitHub上のmainのREADMEから実際のEditorリンクを取得して開きました。
リクエストの差し替え・ローカル配信・セキュリティ設定の書き換えは使用していません。

| 対象 | PR / merge commit | Pages workflow | 結果 |
|---|---|---|---|
| Text Lines | [#42](https://github.com/kubohiroya/turbowarp-text-lines/pull/42) / `0f946b82d6c828faafb14a44707baf513b50831a` | [成功したrun](https://github.com/kubohiroya/turbowarp-text-lines/actions/runs/40513001099) | 同意画面・緑の旗・再実行・compiler ON/OFFの4条件が成功 |
| Template | [#49](https://github.com/kubohiroya/turbowarp-extension-template/pull/49) / `23dbe112544ed31fb6ba95c4c810b1acb5b90389` | [成功したrun](https://github.com/kubohiroya/turbowarp-extension-template/actions/runs/40513495471) | 許可画面・緑の旗・再実行・compiler ON/OFFの4条件が成功 |

- [Text LinesのSB3](https://kubohiroya.github.io/turbowarp-text-lines/samples/lines-to-list.sb3)・[拡張JS](https://kubohiroya.github.io/turbowarp-text-lines/dist/text-lines.js)
- [TemplateのSB3](https://kubohiroya.github.io/turbowarp-extension-template/samples/hello-world.sb3)・[拡張JS](https://kubohiroya.github.io/turbowarp-extension-template/dist/example-extension.js)

両サイトのHTML・SB3・JSはいずれもHTTP 200と`Access-Control-Allow-Origin: *`を確認し、
SB3とJSはマージ対象のローカル成果物とバイト単位で一致しました。
Text Linesは行数3・Banana・3項目のリスト、templateはHello, world!を表示しました。
各Issueの公開後DoDと運用ログを更新して完了としています。

元のチェックアウトにあった変更は保持し、作業は独立したローカルcloneで行っています。
この計画PRに既存のdashboard実装・Demo列・scripts/render.tsの変更は含めません。
