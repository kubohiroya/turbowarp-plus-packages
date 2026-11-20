# Project Folder Starterへの改名

## 位置付け

ScratchのURLまたはSB3から、sb3-toolchainの作品フォルダと、Gitで開発するリポジトリを準備するツールです。Editor専用の機能パッケージと区別するため、名前から`editor`を外し、生成する作品フォルダを表す`project-folder`を入れます。

| 対象 | 旧名 | 新名 |
| --- | --- | --- |
| GitHubリポジトリ | `kubohiroya/turbowarp-plus-editor-project-starter` | `kubohiroya/turbowarp-plus-project-folder-starter` |
| npm | `@kubohiroya/turbowarp-plus-editor-project-starter` | `@kubohiroya/turbowarp-plus-project-folder-starter` |
| CLI | `turbowarp-plus-editor-project-starter` | `turbowarp-plus-project-folder-starter` |

新名の初版は`0.4.0`として準備します。公開API、コマンドの動作、作品フォルダの形式は維持します。カタログの分類は引き続き「ツールチェーン・テンプレート」です。`turbowarp-plus-editor-project-folder`はEditor内の読み書きを担う別パッケージで、今回の改名対象には含めません。

## タスクと依存

各Issueの担当は`kubohiroya`、ブランチは`chore/toolchain/rename-project-folder-starter`、PRのbaseは`main`とします。Issue・PRの投稿とGitHub上の改名・公開は、対象操作の承認後に行います。

| 状態 | 対象 | 作業 | 依存 |
| --- | --- | --- | --- |
| Doing | Starter | 名前・メタデータ・CLI・生成するActions・説明文を変更し、移行手順を追加 | ローカル準備は独立して実行可能 |
| Doing | Packages | カタログを新名に変更し、分類と移行手順を明記 | 反映はGitHub改名・新名npm公開後 |
| ToDo | Editor | npm依存、lockfile、webpackの`/seed`参照、日英の案内を変更 | 新名npm公開後。ローカルではlockfileを除く差分を準備 |

## 外部反映の順序

1. 各対象リポジトリにIssueを作成し、担当・依存・受け入れ基準・ロールバックを記録します。
2. StarterのGitHubリポジトリを新名へ変更し、GitHubのdescriptionを新しい役割の説明へ更新します。作業checkoutの`origin`も新URLへ合わせます。旧URLの転送を妨げないため、旧名のリポジトリを新しく作りません。
3. Starterの変更をレビューして取り込みます。新名npmの公開権限と、Trusted Publisherのrepository=`turbowarp-plus-project-folder-starter`・workflow=`release.yml`を確認・設定します。新パッケージの初回公開方法を確定してから、承認された方法で`0.4.0`を公開します。タグのpushでRelease workflowが起動するため、通常のブランチpushと区別します。
4. npm registryが新名の`0.4.0`を配信していることを確認します。旧名パッケージの削除・非推奨化は今回の操作に含めません。
5. Editorの切替差分を適用し、`npm install --package-lock-only --ignore-scripts --no-audit --no-fund`でlockfileを生成します。新名の依存・解決URL・integrityを確認し、`npm ci`と`/seed`の解決確認を行います。未公開版のURLやintegrityは手作りしません。
6. Editorとカタログの変更を取り込みます。カタログを再収集し、新リポジトリ・新npmパッケージ・Editorからの依存が一致することを確認します。

merge・タグpush・npm公開は、Issue作成や通常のpush・PR作成とは別の外部操作です。それぞれ承認された操作列の範囲内で実施します。

## 受け入れ基準

- Starterのリポジトリ・npm・CLI・生成する再取り込みActionsが新名で一致する。
- ビルドとStarterの既存テストが通り、npm packした成果物からルートAPI・`/seed`・CLIが利用できる。
- Editorの依存とlockfileが同時に切り替わり、ブラウザー用の`/seed`を解決できる。
- 日英の利用例と移行案内が新名の`0.4.0`を指す。過去の版を説明する記述は履歴として保持する。
- カタログが新リポジトリと新npm名を「ツールチェーン・テンプレート」に掲載する。
- 既存の作品リポジトリは作品ファイルを移動せず利用できる。

## ロールバック

Editorの依存・lockfile・webpack参照・利用例を旧名の`0.3.1`へ戻します。既存作品の再取り込みActionsも同じ旧名・版へ戻せます。作品ファイルの変換は不要です。

GitHubを新名のまま維持する場合、カタログの新名エントリに`npm: '@kubohiroya/turbowarp-plus-editor-project-starter'`のoverrideを加えて旧npmを参照できます。GitHub名自体を戻す場合は、旧名が再利用されていないことを確認し、承認後に改名とTrusted Publisher設定を戻します。公開済みnpm版は削除・上書きせず、必要なら別バージョンで修正します。
