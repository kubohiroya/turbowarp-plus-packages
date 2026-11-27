# plus-family の更新からダッシュボードまで

上流を更新し、それを使うパッケージへ順に伝え、最後にダッシュボードへ反映する手順です。
全体は **収集 → 計画 → 確認 → 公開 → ダッシュボード** です。

たとえば A を B が使い、B を C が使う場合は、A → B → C の順です。
A の公開を確認してから B、B の公開を確認してから C へ進みます。
計画は深さ優先の後行順で作り、共通の依存は1回だけ処理します。

| コマンド | 用途 |
| --- | --- |
| `bump` | 指定したパッケージから上流をたどる |
| `bump:downstream` | 指定した上流から、それを使う側へ広げる |
| `release` | 保存した計画を実行する |

まず下の手順を読めば進められます。設定の詳細は後半にあります。

自動化については[別の案](release-automation.ja.md)があります。

- [作業手順](#作業手順)：収集から公開まで。
- [再開](#5-止まったら同じ条件で再開する)：失敗したとき。
- [ダッシュボード](#6-ダッシュボードを更新する)：公開後の反映。
- [詳細](#詳細)：設定や例外。

## 作業手順

### 1. 最新の情報を集める

このリポジトリで実行します。Node.js 22 以上と `gh` が必要です。
収集用の `GITHUB_TOKEN`（なければ `gh auth token`）と、実行用の `gh` の認証を用意します。
公開対象の Trusted Publisher は設定済みである必要があります。ローカルの npm ログインは不要です。
各対象の checkout は、例では `../<repo名>` に置きます。

```sh
npm ci
npm run collect
```

これで `data/dashboard.json` が更新されます。最初は収集だけでよく、画像生成は最後に行います。

### 2. 更新する範囲を選び、計画を保存する

**上流の変更を使う側へ伝える**場合は、次を使います。

```sh
npm run --silent bump:downstream -- sb3-toolchain --json > /tmp/release-plan.json
```

**特定のアプリとその上流をまとめて揃える**場合は、代わりに次を使います。

```sh
npm run --silent bump -- turbowarp-plus-editor --json > /tmp/release-plan.json
```

family 全体を扱うときは、対象が漏れていないか計画を確認します。この例だけでは全件を網羅しません。
下流の計画には複数の起点を指定できるので、共通の依存元を何度も公開せずに済みます。

```sh
npm run --silent bump:downstream -- vite-plugin-turbowarp-extension turbowarp-extension-data-editor \
  --json > /tmp/release-plan.json
```

計画の `ready` が `true` であること、各 `steps` の版・依存更新・警告を確認します。
通常は minor を1回上げますが、準備済みの版は再利用し、RC は同じ系列を保ちます。
API互換を検証した安定版の依存更新は、`bump`・`bump:downstream`・`release:chain`の`--patch`で同じ系列のpatch更新を選べます。採番指定は互換性レビューやRC正式化の承認を省略しません。
peer・Git 参照・RC は追加のレビューが必要です。`ready: true` だけでは公開に進めません。

GitHub と npm の不一致を新しい版で揃える場合だけ、`--reconcile` を追加します。
これは新しい版を発行するため、対象と番号を改めて確認します。

`catalog.yaml` に `releaseHold` がある repo（例：kamishibai-app）は、依存元として伝播しても計画に入れません。
版は持ち主がリリースごとに決め、依存の更新はその repo の次のリリースに含めます。
計画の `held` に保留した repo と理由が出ます。その repo だけを通じて届く依存元も計画に入りません。

### 3. 各パッケージの手順を確認する

テスト専用依存が循環を作る場合は、`testOnlyDependencies`で明示され、収集エラーがなく、
指定範囲に含まれる通常の公開版と公開版一覧が確認できる依存だけ、その公開版をテスト用に使います。
公開版一覧から指定範囲内の最新安定版を選ぶため、npmのlatestが範囲外へ進んでも既存の固定を維持できます。
この経路では公開予定版を伝播せず、計画に`test-only-cycle-baseline`の警告と採用版を残します。
依存図とテストは維持します。製品・peer・通常の開発依存による循環や、未公開・範囲外の版は引き続き停止します。

次は dry-run です。各 repo の `package.json` と workflow を読み、準備・検証の手順を解決します。

```sh
npm run --silent release -- --plan /tmp/release-plan.json --workspace /tmp/family-release \
  --discover --repos-dir .. > /tmp/release-preview.json
```

出力の `steps` と `effectiveConfig` を確認します。`digest` は、その内容を固定する識別子です。
不足している SHA は各 repo で fetch します。dry-run は自分で fetch しません。
peer・Git・RC がある場合は、[例外設定](#例外明示config移行)の `reviewedRepositories` にレビュー済みの repo を記載し、
`--config <例外ファイル>` を付けて dry-run を作り直します。
この段階では対象 repo や外部を変更しません。
GitHub・npm の現在の状態は実行時に再確認します。

### 4. 承認後に実行する

対象・差分・公開文面を確認して承認を得たら、`<digest>` を保存した値に置き換えます。

```sh
npm run release -- --plan /tmp/release-plan.json --workspace /tmp/family-release \
  --resolved /tmp/release-preview.json --execute --confirm <digest>
```

各パッケージの専用 checkout で次を行います。

1. 依存・version・lockfile・生成物を更新する。
2. 検証し、PR・CI・Squash Merge を進める。
3. タグ・Release・npm 公開と、公開結果の照合を行う。

依存先が完了するまで、使う側へ進みません。独立した対象は並列です。直列にするなら `--concurrency 1` を付けます。
公開は GitHub Actions Trusted Publisher（OIDC）と `release.yml` を使います。
CLI 公開や長期 token には切り替えません。
private などの `update-only` は merge までです。

### 5. 止まったら同じ条件で再開する

結果は `/tmp/family-release/state.json` に残ります。失敗箇所を直し、同じコマンドで再開します。
計画・preview・workspace・digest を保ってください。
未着手の main や設定が変わった場合は、収集から作り直して新しい workspace を使います。
古い記録も残し、PR・タグ・公開がどこまで済んだかを確認してから進めます。
詳細は[実行・再開・完了条件](#実行再開完了条件)にあります。

`/tmp` は一時的なので、長く続ける場合は最初から永続的な場所を使います。

### 6. ダッシュボードを更新する

各パッケージの公開が終わったら、この repo の Actions で
**Collect and publish the dashboard**（`pages.yml`）を起動します。

```sh
gh workflow run pages.yml --repo kubohiroya/turbowarp-plus-packages --ref main
```

ダッシュボードの更新も、承認された範囲に含めてから実行します。
workflow が収集 → カタログ → 画像 → HTML → Pages を行います。
main への push と毎日の定期実行でも動きます。

ローカルで確認する場合は、初回に `npx playwright install chromium`、続けて `npm run build` と `npm run serve` を使います。

### 完了の確認

- [ ] `state.json` で公開・取りやめ・失敗を確認した。
- [ ] 公開版・タグの照合が済んだ。
- [ ] Pages の build と deploy が成功した。
- [ ] [公開ダッシュボード](https://kubohiroya.github.io/turbowarp-plus-packages/)で版・依存の鮮度を確認した。
- [ ] 結果を Issue に記録した。

切戻しは未公開なら revert、公開済みなら別番号で修正します。公開済みの版やタグは上書きしません。

## 詳細

ここからは、必要なときに参照する内容です。

- [既存手順の解決](#既存手順の解決)
- [例外・明示config・移行](#例外明示config移行)
- [実行・再開・完了条件](#実行再開完了条件)
- [段階導入・切戻し](#段階導入切戻し)
- [本家追従](#本家追従turbowarp-plus-editor)

通常は中央 config 不要です。導入中なので `--discover` は明示します。
専用 checkout は partial clone（`--filter=blob:none`）で作り、ファイルの中身は必要になった分だけ取ります。
生成物を履歴に多く持つリポジトリ（kamishibai-samples の履歴は約 6GB）でも、clone は現在の木の分で済みます。
実行時に `--reference-dir ..` を付ければ、既存 checkout からオブジェクトを借りられます。
その場合は実行中に参照元で `git gc --prune=now` などを行わないでください。

dry-run は `git show <planのheadSha>:<file>` で固定したソースを読みます。
`release-preview.json` には全実効設定、参照 SHA と SHA256、操作順、digest が入ります。
`--resolved` は再解決せず、それを使います。計画や設定が変われば digest 検証は失敗します。

## 既存手順の解決

- 準備は既存の`release:prepare` / `prepare:release`があれば使用し、なければ既存の`docs` / `build` / `samples:build`をこの順で使用します。サンプルSB3はbuildした拡張を埋め込み、多くのrepoの検証（`samples:check`）が古いサンプルを拒むためです。これらの名前を新設する要求はありません。
- 検証は既存の`release:verify` → `verify:release` → `verify:full` → `check` → `verify`の順で選びます。まとめたコマンドがない場合は既存のtypecheck/lint/test/buildを使い、検証手順が不明ならverify例外を要求します。
- 公開は既存の`release.yml`を読み、起動条件、汎用のnpm publish job、id-token権限を確認します。タグ起動と手動起動が併存していても、過去版専用jobを除外して汎用jobを選びます。
- 手動起動の汎用jobが既定ブランチへのpushでも動く場合（`on.push.branches`）、その対象ブランチを`publish.pushBranches`に記録します。リリースPRのマージがそのpushで公開を始めるため、実行器は手動起動せず、マージコミットのpushで始まった実行を待ちます。手動起動を重ねると、同じ版の公開を競って遅れた側がE409で失敗するためです。
- npmの依存の準備は`install --package-lock-only --ignore-scripts`の後に`ci`を実行します。npmはlockfileだけの更新でもパッケージ自身の`prepare`を実行し、依存がないままビルドが走るためです。`prepare`は続く`ci`と準備手順で実行されます。
- 公開後の確認では、npmの`latest`が新しい版を指すことを確かめます。`next`は、そのパッケージにすでに`next`があるときだけ同じ版を待ちます。`next`を使わずに`latest`へ公開するパッケージでは、存在しない`next`を待ち続けないためです。
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
        "version": "{version}"
      }
    }
  }
}
```

- packageManagerで指定されたnpm/pnpmを使用します。packageManagerがなく既存workflowが`npm ci`を使っていればnpmを選びます。それ以外でinstall手順を確定できない場合はinstall例外を要求します。
- 準備スクリプトには`RELEASE_VERSION`と`RELEASE_PLAN_SHA`を渡します。版定数・文書・生成runtime・SB3のpin/凍結をrepo側で管理します。中断後に再実行でき、凍結済み成果物を勝手に再生成しない実装が必要です。
- 準備の前に、executorはREADME（`README*.md`）と`docs/`・`site/`の`.md`・`.html`にある`<パッケージ名>@<旧版>`を新しい版へ置き換えます。family共通の「版を固定した導入例」を、各repoの`check-repo`が版から照合しているためです。後ろに版の続き（`-rc.1`など）が付く表記、ほかのパッケージ、CHANGELOGは変えません。ソースコードの版定数などは、これまでどおりrepoの準備スクリプトで管理します。
- Git差分を使う生成物検証は、更新候補に対する検証としてrepo側で実装します。通常の開発用checkが古いHEADとの比較を要求する場合、そのままrelease:verifyへ流用しないでください。
- 推定または任意の`publish.job`が指すjobには直接の`npm publish`または`pnpm publish`、`id-token: write`が必要です。固定の過去版、dry-run専用、長期npm tokenを使うjobを除外します。workflow名が存在するだけでは対応済みとみなしません。
- workflowはjob単位ではなく全体が起動します。他の公開jobが選択イベントで必ずスキップされると確認できない場合は停止します。固定版jobを候補から除外しただけでは、そのworkflowを実行可能とは扱いません。
- dispatchの必須inputは契約で全て指定します。`{version}`と`{tag}`を実際の公開版・タグへ置換します。tarballのハッシュ（`{shasum}`）はworkflowへ渡しません。そのような契約は解決時に拒否します。
- タグ起動も`mode: tag-workflow`、`workflow: release.yml`、対象`job`で宣言できます。`v*`のpushタグ起動と汎用のnpm公開jobが必要です。
- executorはtarballを作らず、取得も比較もしません。公開後は、npmの`gitHead`がリリースのcommitと一致することを確かめます。`gitHead`がない公開では、npmが配信するprovenanceのパッケージ名・版・integrity・repository・workflowを照合して公開元commitを確認します。準備済みの版では入力SHAを使います。npm用のtarballはGitHub Releaseにも添付しません。
- private repoは既存の準備・検証手順だけを使用します。`update-only`ではタグ・Release・npm公開をしません。
- `artifacts`はcheckout内の追加Release添付物です。パス内の`{version}`を置換し、検証後のSHA256を記録します。checkout外参照や重複名を拒否します。

`release-contract/release.yml.example`は、リリースタグが指すcommitのcheckoutからOIDCで公開するdispatch用の草案です。tarballは扱いません。
repoへ適用する前に既存CI・Release添付物・初回公開・レジストリ反映待ち・再実行手順との整合を確認してください。
このファイルを作成しただけで、対象repoのworkflowを変更したことにはなりません。

npm側はowner/repository/workflow=`release.yml`、workflowと同じEnvironment、直接`npm publish`権限を設定します。
完了時はworkflowが`latest`を更新し、`next`がある場合は同じ版へ同期します。OIDCで同期するには`Allow npm dist-tag`も必要です。
executorは公開版・公開元commit（`gitHead`）・SLSA provenance・両タグを照合します。workflow完了後もレジストリが古いタグを返すことがあるため、両タグは最大5分待ちます。それでも揃わなければ停止し、ローカル認証で代行しません。

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
依存先の検証・PR/CI/Squash Merge・タグ/Release・公開・provenance/公開元commit/latest/next照合が完了するまで依存元へ進みません。
依存しあわない対象は並列に進みます。同時に進める数は`--concurrency <n>`で指定します（既定4、`1`で計画の順に直列）。1つが失敗すると新しい対象は始めず、進行中の対象を区切りまで進めてから停止します。並列数は実行結果を変えないので、digestには含めません。

不要な対象は取りやめます。依存の更新だけで計画に入った対象（`reasons`が`dependency-update`だけ）で、依存先がすべて取りやめになり、更新するものが残らないときは、push・PR・タグ・公開をせずにその対象を終えます。理由は`state.json`の`cancelled`に残り、再開しても取りやめたままです。

依存の更新だけで計画に入った対象は、準備と検証が終わったあと、成果物を公開済みの版と比べます。候補は`npm pack --ignore-scripts`で固め（ビルドは準備で済んでいるため）、公開済みの版は`npm pack <name>@<公開済みの版>`で取得して、展開した中身を比べます。同じなら、push・PR・タグ・公開をせずにその対象を取りやめます。違いは`state.json`の`artifactDifferences`に残ります。「同じ」の判定は次のとおりです（`scripts/lib/release-equivalence.ts`）。

- `package.json`は、`version`・`devDependencies`・`gitHead`を除いて比べます。`dependencies`・`peerDependencies`・`optionalDependencies`の範囲が変われば違いです。利用者がインストールするものが変わるからです。
- Markdownと`docs/`の下は比べません。公開の手続きそのものが書き換える文書（版の固定、CHANGELOG、依存先の版の表記）だからです。
- ほかのテキストファイルは、パッケージ自身の版の文字列と、pnpmの格納先のパス（`node_modules/.pnpm/<名前>@<版>…/node_modules/`）をそろえてから比べます。bundlerが入れる注釈に依存先の版が入るためです。
- バイナリはバイト単位で比べます。

2026-11-24に依存の更新だけで公開した35件にこの判定を当てると、上流の取りやめが依存元に伝わる分も含めて22件が取りやめになります。残る13件のうち8件は、`dependencies`の範囲が変わったものです。そのほかは、成果物に依存の範囲や版を埋め込んでいるもの（teachable-machine、rmc-appの`embedded-extensions.json`）と、中身が実際に変わったものです。

取りやめた対象への依存の更新は、依存元では、その対象の公開済みの版（`state.json`の`keptVersion`）に向け直します。依存元の今の指定がすでにその版に届いていれば外し、古い版を固定していればその版に上げます。取りやめた新しい版を待っていただけで、依存元が古い版に取り残されないようにするためです。完全固定・`^`・`~`以外の範囲は、これまでどおり外します。自分の変更がある対象（`commits-ahead`など）は取りやめません。
private更新はPR/CI/mergeまでです。既存タグや公開版を推測・上書きしません。

既存タグがある未公開版の補完は、このexecutorでは未対応です。公開開始前に停止するため、repo側の既存workflowで検証済み成果物の公開を完了してから再計画してください。自身の実行記録に保存したタグからの再開は、この制限には含みません。

準備後は専用checkout内で候補commitを固定し、その内容に対して検証します。生成物とGit差分を比較する既存checkも候補を基準に実行し、検証成功とcleanを確認してからpushします。マージ後は、mergeの直前に確かめたbaseの上にsquashされたか（merge commitの親が計画の入力SHAか）を見ます。そうであれば、PRのCIが同じツリーを検証済みなので、main CIを待たずにタグ・公開・完了へ進みます。マージ中にbaseが進んでいた場合だけ、main CIの成功を待ちます。

準備済みの版（計画の`prepared-version`）をすでにmainへmergeしてあり、準備しても差分が出ない場合は、入力SHAそのものを候補にします。
作業ブランチのpush・PR・mergeは行いません。入力SHAがbaseに含まれることと、そのcommitのmain CIの成功を確かめてから、入力SHAにタグを付けて公開へ進みます。
RC系列から安定版へ移す場合などに使います。mainの`version`を安定版にしてからcollectと計画をやり直してください。

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

## 本家追従（TurboWarp Plus Editor）

`upstream:sync` は、TurboWarp Plus Editor が固定するフォークと Packager を本家の最新へ追従させる候補を作り、CI と同じ順で検証して報告します。フォーク（`kubohiroya/scratch-gui`・`kubohiroya/scratch-vm`）にも plus-editor にもコードを足さない方針なので、手順はこのリポジトリが持ち、各リポジトリは `--repos-dir` の checkout から worktree を切って操作します。

```sh
# 候補を作って検証し、報告する。push も PR 作成もしない。
npm run upstream:sync -- --repos-dir ..

# 衝突を解決したあと・失敗を直したあとは、同じ id で続きから。
npm run upstream:sync -- --repos-dir .. --id 2026-11-15

# 検証が全件成功した候補を、1件ずつ確認しながら push して PR を作る。
npm run upstream:sync -- --repos-dir .. --id 2026-11-15 --publish
```

1回の実行で行うこと:

1. **取り込み**: scratch-vm → scratch-gui の順に、フォーク develop から `chore/upstream/merge-<id>` を切り、本家 develop を `--no-ff` でマージします。本家に遅れが無いフォークはマージしません。取得は URL から `refs/upstream-sync/*` へ行い、checkout のリモート設定は変えません。`<repos-dir>/<repo名>` に checkout が無いもの（scratch-vm など）は `<作業dir>/repos/` へ clone して使い回します。
2. **Packager**: 本家 `TurboWarp/packager` の master を候補にし、その SHA を `<作業dir>/<id>/packager` に浅く取得します。
3. **固定値**: plus-editor の main から `chore/upstream/sync-<id>` を切り、`site/source.json` の `guiRevision` / `vmRevision` / `vmBaseRevision` / `packagerRevision` を書き換えてローカルにコミットします。`vmRevision` は GUI の `package.json` が依存する scratch-vm、`vmBaseRevision` はその VM に含まれる本家 develop の最新コミット（merge-base）です。Packager の SHA は `scripts/site/build-plus-scaffolding.cts`・`build-plus-packager.cts`・`docs/extension-loader-integration.md` も直書きで照合しているので、追跡されているファイルの旧値を同じ新値に揃え、書き換えたファイルを報告の「注意」に出します。
4. **検証**: 各手順を1回だけ走らせ、ログを `<作業dir>/<id>/logs/` に残します。
   - scratch-vm（取り込んだときだけ）: `npm ci`、`npm test`
   - scratch-gui: `npm ci`、`scripts/prepublish.mjs`、`test:lint`、`test:unit`
   - plus-editor: `npm ci`、`typecheck`、`test`、`test:package`、`test:e2e:infrastructure`、GUI を `E2E_GUI_ROOT` に置いた `test:extension-host` / `test:gui-integration` / `test:script-transfer` / `test:project-tools`、`build:pages`（`TW_PLUS_PACKAGER_ROOT` 付き）
   - `--e2e` を付けたときだけ、ブラウザーを使う scratch-gui の `test:integration` と plus-editor の `test:e2e` も走らせます。実マウスを動かす E2E は走らせず、`TW_PLUS_NATIVE_INPUT` / `E2E_NATIVE` は各手順の環境から外します。
5. **報告**: `<作業dir>/<id>/report.md`（標準出力にも出す）に、取り込んだ範囲（遅れ・先行・本家側の変更ファイル数）、衝突したファイル、固定値の変更、各手順の成否と失敗した手順の出力末尾、次の手順をまとめます。`--json` で状態全体を出せます。

作業dirの既定は `<repos-dir>/.upstream-sync`、id の既定は実行日です。終了コードは、0 が「検証まで成功」または「追従するもの無し」、1 がエラー、2 が衝突・検証失敗・未完了です。

### 衝突と再開

マージが衝突したら、worktree（`<作業dir>/<id>/scratch-gui` など）を残して止まり、衝突したファイルを報告します。その worktree で解決して `git commit` したあと、同じ `--id` で再実行すると続きから進みます。検証の手順は「入力（各 worktree の先頭 SHA）が同じで前回成功したもの」を走らせ直しません。失敗を直してコミットすれば、入力が変わった手順だけが走ります。同じテストを回数で確かめることはしません。

`--merge-only` は取り込みと固定値の書き換えまでで止め、検証しません。本家の遅れと衝突の見通しだけを知りたいときに使います。

### push・PR・リリース

`--publish` は、検証が全件成功した候補だけを対象に、次の順で1件ずつ `[y/N]` の確認を取ります。断るとそこで止まり、再実行すると済んだ操作を飛ばして続きから進みます。

1. scratch-vm を取り込んだ場合: 追従ブランチを push し、PR を作ります。続けて scratch-gui の `package.json` / `package-lock.json` を push した VM に固定し直してコミットし、plus-editor の固定値を更新して、変わった入力の検証をやり直します。VM の SHA は push するまで GUI の lock に書けないので、この順になります。
2. scratch-gui の追従ブランチを push し、PR を作ります。
3. plus-editor の `chore/upstream/sync-<id>` を push し、報告を本文にした PR を作ります。

そのあとは手作業です。

- フォークの PR は **マージコミット**（`gh pr merge --merge`）で develop に入れます。squash や rebase では、固定した SHA が develop から辿れなくなります。
- plus-editor の PR の CI が通ったらマージします。CI は固定した SHA のフォークと Packager を取得して、同じ検証とビルドを行います。
- リリースは plus-editor の `package.json` の version を上げ、`v<version>` タグを push します。Release workflow が `scripts/ci/release-verification.ts` で、検証に成功したリビジョンだけを公開します。

ファミリーの npm パッケージの更新は、この手順に含めません。`bump` / `bump:downstream` で別に計画します。

## 関連文書

- [README](../README.ja.md)：コマンドの規則。
- [family の依存更新](release-chains/family-2026-11-08.ja.md)：過去の例。
- [Editor カタログ](editor-extension-catalog.md)：配信の詳細。
- [確認記録](release-contract/audit-2026-10-27.md)：元の確認。
- [Issue #19](https://github.com/kubohiroya/turbowarp-plus-packages/issues/19)：設計の記録。
