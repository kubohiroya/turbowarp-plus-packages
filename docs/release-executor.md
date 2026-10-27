# 依存順でのリリース実行

`bump` / `bump:downstream`は計画、`release`は保存した計画に従う実行コマンドです。
公開はGitHub Actions Trusted Publisher（OIDC）、workflowは`.github/workflows/release.yml`に統一します。
CLI公開・長期npm token・provenanceなしへフォールバックしません。

## 標準経路（Issue #19）

導入中の契約自動解決は既定OFFです。`--discover`で明示的に有効にします。
通常repoは中央config不要です。既存のpackage.jsonとworkflowから手順を解決します。新しい宣言やスクリプト名を各repoに追加する必要はありません。

```sh
pnpm build
pnpm --silent bump:downstream sb3-toolchain --reconcile --json > /tmp/release-plan.json

# ローカルrepo群から、計画の入力SHAにある契約を読み取る。ネットワーク・変更・公開なし。
pnpm --silent release --plan /tmp/release-plan.json --workspace /tmp/family-release \
  --discover --repos-dir .. > /tmp/release-preview.json

# 表示内容を確認したうえで、同じ実効設定を使って実行する。
# <digest>はrelease-preview.jsonのdigest。
pnpm release --plan /tmp/release-plan.json --workspace /tmp/family-release \
  --resolved /tmp/release-preview.json --execute --confirm <digest>
```

各repoは`--repos-dir/<repo名>`に配置します。dirtyな作業ファイルは読まず、`git show <planのheadSha>:<file>`で不変のソースを読みます。
必要なSHAがローカルにない場合は、利用者がそのrepoをfetchしてから再試行します。dry-run自身はfetchしません。
`release-preview.json`には全実効設定、package.json/workflowの参照SHAとSHA256、操作順、確認digestが入ります。
`--resolved`はその内容を再利用し、repoから再解決しません。planか設定が変わればdigest検証が失敗します。

`--reconcile`はGitHub/npmの公開基点が一致しない場合も新しい版を計画し、依存元へ版を伝播します。
既存タグを推測して復元する操作ではありません。通常版はminorを上げ、RC版は同じRC系列を維持するため、実行前に計画の対象と番号を確認してください。

## 既存手順の解決

- 準備は既存の`release:prepare` / `prepare:release`があれば使用し、なければ既存の`docs` / `build`を使用します。これらの名前を新設する要求はありません。
- 検証は既存の`release:verify` → `verify:release` → `verify:full` → `check` → `verify`の順で選びます。まとめたコマンドがない場合は既存のtypecheck/lint/test/buildを使い、検証手順が不明ならverify例外を要求します。
- 公開は既存の`release.yml`を読み、起動条件、汎用のnpm publish job、id-token権限を確認します。タグ起動と手動起動が併存していても、過去版専用jobを除外して汎用jobを選びます。
- private repoには公開workflowもnpm公開設定も要求しません。既存の準備・検証手順だけを解決します。
- ローカルに入力SHAがない場合は「GitHub側は未確認」と表示します。古い入力SHAにファイルがないことを、GitHub最新版にもない証拠として扱いません。

### 任意の追加指定

既存情報だけで解決できる場合は以下を追加する必要はありません。複数のjobや特殊な成果物を明示したい場合に限り、package.jsonの任意指定を利用できます。以下のスクリプト名も任意の例です。

```json
{
  "packageManager": "pnpm@11.11.0",
  "scripts": {
    "release:prepare": "node scripts/prepare-release.mjs",
    "release:verify": "pnpm run check"
  },
  "turbowarpRelease": {
    "schemaVersion": 1,
    "artifacts": [],
    "publish": {
      "mode": "dispatch-workflow",
      "workflow": "release.yml",
      "job": "publish",
      "inputs": {
        "version": "{version}",
        "shasum": "{shasum}"
      }
    }
  }
}
```

- packageManagerで指定されたnpm/pnpmを使用します。packageManagerがなく既存workflowが`npm ci`を使っていればnpmを選びます。それ以外でinstall手順を確定できない場合はinstall例外を要求します。
- 準備スクリプトには`RELEASE_VERSION`と`RELEASE_PLAN_SHA`を渡します。版定数・文書・生成runtime・SB3のpin/凍結をrepo側で管理します。中断後に再実行でき、凍結済み成果物を勝手に再生成しない実装が必要です。
- Git差分を使う生成物検証は、更新候補に対する検証としてrepo側で実装します。通常の開発用checkが古いHEADとの比較を要求する場合、そのままrelease:verifyへ流用しないでください。
- 推定または任意の`publish.job`が指すjobには直接の`npm publish`または`pnpm publish`、`id-token: write`が必要です。固定の過去版、dry-run専用、長期npm tokenを使うjobを除外します。workflow名が存在するだけでは対応済みとみなしません。
- workflowはjob単位ではなく全体が起動します。他の公開jobが選択イベントで必ずスキップされると確認できない場合は停止します。固定版jobを候補から除外しただけでは、そのworkflowを実行可能とは扱いません。
- dispatchの必須inputは契約で全て指定します。`{version}`、`{tag}`、`{shasum}`を実際の公開版・タグ・検証済みtarball SHA1へ置換します。
- タグ起動も`mode: tag-workflow`、`workflow: release.yml`、対象`job`で宣言できます。`v*`のpushタグ起動と汎用のnpm公開jobが必要です。
- private repoは既存の準備・検証手順だけを使用します。`update-only`ではタグ・Release・npm公開をしません。
- `artifacts`はcheckout内の追加Release添付物です。パス内の`{version}`を置換し、検証後のSHA256を記録します。checkout外参照や重複名を拒否します。

`release-contract/release.yml.example`は検証済みRelease tarballをOIDCで公開するdispatch用の草案です。
repoへ適用する前に既存CI・Release添付物・初回公開・レジストリ反映待ち・再実行手順との整合を確認してください。
このファイルを作成しただけで、対象repoのworkflowを変更したことにはなりません。

npm側はowner/repository/workflow=`release.yml`、workflowと同じEnvironment、直接`npm publish`権限を設定します。
完了時はworkflowが`latest`と`next`を同じ版へ同期します。OIDCで同期するには`Allow npm dist-tag`も必要です。
executorは公開版・tarballハッシュ・SLSA provenance・両タグを照合します。同期不足なら停止し、ローカル認証で代行しません。

## 例外・明示config・移行

`--discover --config exceptions.json`で、準備・検証・成果物生成だけをrepo単位で上書きできます。
フィールド単位で明示設定が標準値を置き換え、コマンド配列を結合しません。公開mode/workflow/inputsはrepoの契約と一致する必要があります。
既存の手順だけでは判断できないprepare/verifyを例外で明示できます。汎用OIDC公開jobがない場合、それをconfigだけで存在することにはしません。

```json
{
  "repositories": {
    "kubohiroya/example": {
      "verify": [["corepack", "pnpm", "run", "verify:full"]]
    }
  },
  "reviewedRepositories": []
}
```

peer/Git/RC変更は従来どおり明示レビューが必要です。レビュー済みrepoのみ`reviewedRepositories`へ指定します。
例外も参照元SHAも承認digestへ含まれます。絶対パスを使う中央補助処理を標準契約に埋め込む必要はありません。

既存の`--config full-config.json`経路も残します。ただし公開設定はTrusted Publisher・`release.yml`必須で、実行直前にrepo側の既存workflowを確認します。新しい宣言の追加は求めません。
以前作ったローカル`release-config.json`にはCLI公開が含まれるため、現在は移行エラーになります。自動でOIDC対応済みに書き換えません。
未対応repoは必要な契約やSHAの不足をrepo名付きで表示し、全対象の解決が成功するまで公開を開始しません。

## 実行・再開・完了条件

全対象のmain SHA、契約、npm、Node engine、workflowをpreflightします。
依存先の検証・PR/CI/Squash Merge・タグ/Release・公開・provenance/ハッシュ/latest/next照合が完了するまで依存元へ進みません。
private更新はPR/CI/mergeまでです。既存タグや公開版を推測・上書きしません。

既存タグがある未公開版の補完は、このexecutorでは未対応です。公開開始前に停止するため、repo側の既存workflowで検証済み成果物の公開を完了してから再計画してください。自身の実行記録に保存したタグからの再開は、この制限には含みません。

準備後は専用checkout内で候補commitを固定し、その内容に対して検証します。生成物とGit差分を比較する既存checkも候補を基準に実行し、検証成功とcleanを確認してからpushします。マージ後のmain CIも確認してからタグ・公開・完了へ進みます。

workspaceのstate.jsonにはdigest、実効設定、phase、commit、PR、merge、成果物、workflow run、エラーを保存します。
途中失敗後も同じplan、preview、workspace、digestで再開します。完了済み上流を再照合し、同じworkflowを再dispatchしません。
通常エラーではlockを解放します。強制終了でlockが残った場合は元プロセス停止を確認してからlockだけを削除します。
workflow失敗時は原因を修正し、記録したrunの失敗jobを再実行してからresumeします。

## 段階導入・切戻し

2026-10-27に全67repoを固定SHAで確認しました。公開対象58repoとprivate 7repoは既存手順から設定を解決でき、対象外2repoを区別しています。確認SHA・範囲と限界・既定ON化の条件は[確認記録](release-contract/audit-2026-10-27.md)を参照してください。npm側の権限や実公開の成功を静的確認だけで断定しません。

自動解決は`--discover`を外すことでOFFへ戻せます。統一済みの明示configを使い、CLI公開やprovenanceなしへは戻しません。
既定ONへの変更は、実repoの契約移行と回帰・対応環境検証を終えてから別途行います。
未公開差分はrevert、公開済み版は別番号で修正します。ユーザーのdirtyな元checkoutは変更しません。

テストは標準/例外/未対応契約、SHA固定、変更検知、offline dry-run、再開、依存順、二重公開防止、CI失敗、ハッシュ照合を対象とします。
テスト中は実レジストリに公開しません。
