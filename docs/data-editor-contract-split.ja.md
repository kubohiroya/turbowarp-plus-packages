# data-editor の契約と実装の分離（設計案）

状態: 案（2026-11-24 改訂）。「決めること」1 は (a) に決めた（2026-11-24）。残りの未決定の事項は末尾にまとめる。

## 背景

`@kubohiroya/turbowarp-extension-data-editor`（以下 data-editor）の版が上がるたびに、family の依存元 41 件が更新の対象になる。2026-11-23〜24 は、0.11.4 と 0.11.5 の 2 回とも 40 件前後の連鎖になった。

ところが、0.11.4 と 0.11.5 の変更は主にエディタの実装だった。今の構成では、拡張機能が使う契約とエディタの実装が、1 つのパッケージ・1 つの版に入っている。そのため、実装を改良するたびに、契約しか使わない側まで更新の対象になる。

## 依存元の使い方（2026-11-24 の main で調査）

直接の依存元 34 件の import を、エントリポイントと記号ごとに数えた。「src」は公開物に入るコード、それ以外はテスト・スクリプトだけで使うもの。

| 区分 | 記号 | 使う件数（うち src） |
| --- | --- | --- |
| データの型 | `JsonValue`、`LiteralValue`、`JsonObject`、`BlockSnapshot`、`ArgumentSlot`、`LiteralArgumentChange`、`ValidationIssue` | 28（26） |
| 固定入力の型 | `FixedInputBinding`、`FixedInputEditorOptions`、`FixedBlockSnapshot`、`FixedInputDraft`、`FixedHostCommitRequest` | 28（28） |
| スキーマの型 | `SchemaBundle`、`SchemaDocument`、`SchemaJsonValue`、`SourceBinding`、`SourceEditorOptions`、`SyncOwnerValidator` ほか | 31（31） |
| 依存のない関数 | `parseFixedNumberInput`、`jsonValueSchemaBundle` | 15（15）、3（2） |
| 検証エンジン（ajv） | `compileSchemaBundle`、`validateSchemaInput` | 13（8）、10（8） |
| エディタの実装 | `EditorRegistry`、`createFixedInputEditor`、`sameFixedSnapshot`、`BlockEditorConflictError`、`createBlockEditorService` ほか | 28（**0**） |
| ホスト統合 | `/turbowarp`、`/plus`、`/react` の記号 | plus-editor、document-editor（src は `bindBlockEditorIcon` のみ）、bubble・svg-text（テストのみ） |

分かったこと:

1. 拡張機能が公開物の中で使うのは、型、依存のない関数 2 つ、ajv を使う検証エンジンだけである。
2. エディタの実装は、拡張機能ではテストでしか使われていない。実装を src で使うのは plus-editor と document-editor だけである。
3. 拡張機能は、プレビュー、セッション、レジストリ、ホストの型（`BlockPreviewDefinition`、`EditorViewContext`、`EditorDefinition`、`BlockEditorHost` ほか）を src で使っていない。
4. 公開された型定義（d.ts）が、data-editor の型を参照している。確認したのは asset-cache 0.10.1、time-space-sync 0.8.1、web-speech 0.6.1 である。一方で、data-editor は devDependencies にしか入っていない。そのため、型を使う側は data-editor を自分で入れないと型を解決できない（今の不具合）。

## 過去の版に当てはめると

0.10.0〜0.11.5 の各版で src の何が変わったかを調べた。そのうえで、下の案のとおりに分かれていたら、どこまで更新の対象になったかを当てはめた。

| 版 | 変わったもの | 今の構成 | 分けた後 |
| --- | --- | --- | --- |
| 0.10.0 | 固定入力の型と関数（`fixed-input-types.ts`、`types.ts`、`schema.ts` ほか 15 ファイル） | 依存元全体 | **依存元全体（契約の変更なので必要）** |
| 0.10.1 | Playwright（devDependencies）だけ | 依存元全体 | 実装だけ。テスト専用の規則があれば公開も不要 |
| 0.11.0 | test-runtime 0.2.0 → 0.3.0（devDependencies）だけ | 依存元全体 | 同上 |
| 0.11.1 | ajv-formats 2 → 3、fast-uri 3 → 4、test-runtime | 依存元全体 | **検証を bundle する 8 件とその下流**。型だけを使う約 20 件は対象外 |
| 0.11.2 | test-runtime（devDependencies）だけ | 依存元全体 | 0.10.1 と同じ |
| 0.11.3 | `plus.ts`、`plus.css` | 依存元全体 | document-editor → plus-editor だけ |
| 0.11.4 | `preview.ts` | 依存元全体 | 同上 |
| 0.11.5 | 実装と、`types.ts` の `BlockPreviewDefinition.mount` への省略可能な引数の追加 | 依存元全体 | 同上（`BlockPreviewDefinition` を実装の側に置く場合） |

8 版のうち、依存元の多数への波及が本当に必要だったのは 0.10.0 と、0.11.1 の検証を bundle する 8 件だけである。

## 案: 3 つのパッケージに分ける

```
contract（契約）      拡張機能が使う型 + 依存のない関数        依存: なし
validation（検証）    SchemaBundle のコンパイルと入力検証       依存: contract、ajv、ajv-formats、fast-uri
data-editor（実装）   registry、session、rjsf、react、plus、turbowarp   依存: contract、validation、RJSF、React
```

### 境界は「誰が使うか」で引く

「型かコードか」では分けない。0.11.5 の `BlockPreviewDefinition` は型だが、使うのはホストとエディタの側である。これを契約に入れると、エディタの改良のたびに契約の版が上がり、分けた意味がなくなる。

今の型のファイルには、拡張機能の型とホストの型が混ざっている。例を挙げる。

- `types.ts`: 拡張機能の型（`JsonValue`、`BlockSnapshot` など）と、ホストの型（`BlockEditorHost`、`EditorDefinition`、`EditorViewContext`、`BlockPreviewDefinition`）が同じファイルにある。
- `fixed-input-types.ts`: 拡張機能の型（`FixedBlockSnapshot`、`FixedInputControl`、`FixedInputDeclaration` など）と、`FixedInputEditorDefinition extends EditorDefinition` が同じファイルにある。`BlockEditorHost` も import している。
- `fixed-input-editor.ts`: 拡張機能の型（`FixedInputBinding`、`FixedInputEditorOptions`、`FixedInputBranchPolicy`）が、実装のファイルに定義されている。

そのため、ファイルを丸ごと移すのではなく、拡張機能の型を契約のファイルへ切り出す作業になる。

### contract

依存のないパッケージ。版を上げるのは、拡張機能が使う型・関数の意味が変わるときだけにする。

- データの型: `JsonValue`、`JsonObject`、`LiteralValue`、`BlockReference`、`BlockSnapshot`、`ArgumentSlot`、`LiteralArgumentChange`、`CommitRequest`、`ValidationIssue`
- 固定入力の型: `FixedBlockSnapshot`、`FixedInputControl`、`FixedInputDeclaration`、`FixedInputDraft`、`FixedHostCommitRequest`、`FixedInputBinding`、`FixedInputEditorOptions`、`FixedInputBranchPolicy`
- スキーマの型: `schema-types.ts`、`source-types.ts` のうち、拡張機能が使うもの
- 関数: `parseFixedNumberInput`（24 行）、`jsonValueSchemaBundle`（14 行）。どちらも依存がない。

公開した d.ts が参照するので、利用側の `dependencies` に入れる。今の devDependencies の不具合も、これで解消する。

契約に入れないもの: `EditorDefinition`、`EditorViewContext`、`BlockPreviewDefinition`、`BlockEditorHost`、`FixedInputEditorDefinition`、セッションと子孫ブロック（`descendant-types.ts`）の型。拡張機能がテストで使う `BlockEditorHost` などは、テストが data-editor から読む。

### validation

`compileSchemaBundle`、`validateSchemaInput` と、その下の `schema-engine.ts`、`schema-compose.ts`、`schema-json.ts`。

contract とは別のパッケージにする。0.11.1 のように ajv まわりを更新すると、検証を bundle する 8 件は作り直しが必要になる。同じパッケージにすると、契約の版も上がり、型だけを使う約 20 件まで巻き込む。

### data-editor（実装）

残りのすべて。contract と validation に依存する。

- 互換のため、今の root、`/schema`、`/rjsf` から contract と validation の記号を再 export する。分離した版で、既存の利用側が壊れないようにするためである。
- 再 export をやめるのは、利用側の移行が終わった後の 0.12 系以降にする。

## 依存元の側の変更

| 依存元 | 変更 |
| --- | --- |
| 型と関数だけを使う拡張機能（約 20 件） | src の import を contract に替え、`dependencies` に入れる。 |
| 検証も使う拡張機能（8 件） | 上に加えて、validation も `dependencies` に入れる。 |
| 拡張機能のテスト | `EditorRegistry`、`createBlockEditorService` などのために、data-editor は devDependencies に残す（テスト専用）。 |
| document-editor | `/turbowarp` の `bindBlockEditorIcon` を使うので、data-editor に依存し続ける。 |
| plus-editor | ホストなので、data-editor（実装）に依存し続ける。 |

## 計画の規則も変える必要がある

分けただけでは連鎖は減らない。拡張機能のテストが data-editor（実装）を devDependencies に持ち続けるからである。今の計画（`scripts/lib/release-plan.ts`）は、devDependencies の caret の下限も上げる（`^0.11.4` → `^0.11.5`）。その結果、その拡張機能の公開と、さらにその下流の更新につながる。

そこで、次のどちらかを足す。**(a) に決めた**（2026-11-24、#154 で実装）。

- (a) テスト専用の依存を宣言できるようにする。例: package.json の `turbowarpPlus.testOnlyDependencies`、または catalog.yaml。計画は、その依存の更新を公開の理由にしない。下限の引き上げは、別の理由で公開するときに一緒に行う。
- (b) devDependencies の範囲がすでに新しい版を含むとき、計画は下限を上げない。

(b) は、ビルドに使い bundle に入る依存まで止めてしまうので採らない。

宣言は package.json の `turbowarpPlus.testOnlyDependencies`（devDependencies の名前の配列）に置く。devDependencies にない名前や、通常依存・peer と重なる名前は、collect がエラーとして報告する。

(a) は data-editor 自身にも効く。0.10.1、0.11.0、0.11.2 は、data-editor 自身のテスト用の依存（Playwright、test-runtime）が変わっただけで、版を上げて公開していた。

## 避けられない波及

次の場合は、分けた後も依存元の多数が更新の対象になる。どれも正当な波及である。

- **契約の意味が変わる**（0.10.0 の固定入力のような機能追加）。拡張機能が新しい型・関数を使うには、更新が必要である。
- **拡張機能に bundle されるコードが変わる**。たとえば `parseFixedNumberInput` の不具合を直すと、bundle している 15 件は作り直しが必要である。検証エンジンや ajv を更新すると、8 件は作り直しが必要である。

契約が後方互換な追加（新しい型を足すだけ）の場合でも、今の計画は依存元の範囲の下限を上げ、全件を更新の対象にする。これを避けるかどうかは、深さ優先の方針（依存先が上がれば依存元も上げる）をどこまで適用するかという、別の判断である（「決めること」4）。

## family 全体で連鎖をさらに狭める

data-editor の分離だけでは、連鎖の大部分は残る。family 全体を調べると、data-editor より下流の多い上流があり、再公開した版の中身もほとんど変わっていなかった。

### 実測: 再公開した 35 件の中身

2026-11-24 の連鎖では、依存の更新を理由に 35 件の新しい版を公開した。前の版とファイルのハッシュを比べた（jsDelivr の一覧で、package.json を除く）。

- 22 件は、実行時に読み込むファイルが 1 バイトも変わっていなかった。
- 残る 13 件について、変わったファイルの差分を見た。機能に関わる違いは 1 件もなかった。違いは次のものだけである。
  - パッケージ自身の版の文字列
  - bundler が入れる注釈（`//#region node_modules/.pnpm/@kubohiroya+turbowarp-extension-data-editor@0.11.4…`）。依存先のパスと版を含む。
  - dist に埋め込んだ依存の範囲（teachable-machine の `"@kubohiroya/turbowarp-camera-source": "^0.25.1"`）、rmc-app の `embedded-extensions.json` の版
  - http-server の許可リストへの 0.12.2 の追加。連鎖を通すために、例外設定のフックで足したもの。

つまり、35 件の公開はどれも、利用者にとって中身が同じ版を出し直していた。

### 連鎖の大きな上流

下流の件数（推移的に依存する数）が多い上流は次のとおり。今の構成で、起点に 1 つ変更があったときに更新の対象になる件数を、計画で試算した（依存の範囲がすべて最新にそろっている状態を仮定）。

| 起点 | 依存元の使い方 | 今 | test-runtime をテスト専用に | 開発用の依存もすべて除く |
| --- | --- | --- | --- | --- |
| plus-editor-host | → test-runtime-blocks → test-runtime → 7 件の devDependencies | 50 | **3** | 3 |
| plus-editor-test-runtime | 7 件すべてテストだけ（`test/runtime/*.browser.ts` など） | 49 | **1** | 1 |
| vite-plugin-turbowarp-extension | 46 件すべて `vite.config.ts` だけ（ビルド専用） | 50 | 50 | **1** |
| extension-manifest | 38 件が devDependencies で、テストとビルド設定だけ。src で使うのは asset-cache と security-dialog | 48 | 48 | **5** |
| extension-data-editor | 25 件が devDependencies、9 件が dependencies | 38 | 38 | **13** |
| sb3-toolchain | 12 件が devDependencies（ビルド専用） | 14 | 14 | **4** |
| app-shell | 8 件が dependencies | 18 | 18 | 18 |
| camera-source | 実行時の依存と peer | 12 | 12 | 12 |
| named-data | 実行時の依存と peer | 10 | 10 | 10 |

「開発用の依存もすべて除く」は、test-runtime、data-editor、extension-manifest、vite-plugin、sb3-toolchain の devDependencies を、すべて公開の理由にしないと仮定した場合である。

### 方策 1: テスト専用の依存を宣言する（すぐできる）

plus-editor-test-runtime は、依存元 7 件のすべてでテストだけに使われている。7 件の package.json に `turbowarpPlus.testOnlyDependencies` を書けば、plus-editor-host の変更による連鎖は 50 件から 3 件になる（#154 の規則）。

data-editor も、契約を分けた後は、拡張機能の側ではテスト専用になる。

### 方策 2: ビルド専用の依存は、成果物が変わったときだけ公開する

vite-plugin、extension-manifest、sb3-toolchain は、ビルドに使う依存である。テスト専用と違い、更新すると成果物が変わることがある。そのため、宣言だけでは公開をやめられない。

ただ、上の実測のとおり、ビルドし直しても成果物はほとんど変わらない。そこで、executor に次を足す。

1. 依存の更新だけで計画に入った対象は、prepare でビルドしたあと、`npm pack` の結果を公開済みの版の tarball と比べる。
2. 比べるときは、パッケージ自身の版の文字列と、package.json の devDependencies の範囲を除く。
3. 同じなら、その対象を取りやめる（push、PR、タグ、公開をしない）。今の「不要な対象の取りやめ」と同じ扱いにするので、その依存元も、ほかに理由がなければ取りやめになる。

この比較が実際に効くには、成果物に依存先の版が入らないようにする必要がある。

- bundler の `//#region node_modules/.pnpm/…@版…` という注釈を出さない設定にする。または、比べる前にその注釈を取り除く。
- dist に依存の範囲や版を埋め込まない（teachable-machine、rmc-app の `embedded-extensions.json`）。埋め込む必要があるなら、比べる対象から外す。

試算では、vite-plugin の変更による連鎖は 50 件から 1 件、extension-manifest は 48 件から 5 件、sb3-toolchain は 14 件から 4 件になる。

この比較は、ビルド専用の依存に限らず効く。依存の更新だけで公開しようとしている対象なら、どれでも成果物が同じかどうかで判定できる。2026-11-24 の 35 件は、すべて取りやめになっていたはずである。

### 方策 3: data-editor を契約と実装に分ける

この文書の前半の案である。依存元の 25 件が data-editor をテスト専用にでき、9 件は dependencies を contract と validation に替えられる。試算の 38 件（方策 1・2 の後は 13 件）が、document-editor → plus-editor（→ plus-desktop）の 3 件前後になる。

方策 2 があれば、分けなくても成果物は同じになるので連鎖は止まる。ただし、テストが古い実装に対して通ったままになることと、d.ts の参照の不具合は残る。分ける意味は、境界をはっきりさせ、その 2 つを解消することにある。

### 方策 4: テストを分ける

拡張機能のテストは、拡張機能の固定入力の定義（`FixedInputEditorOptions`）を data-editor の実装に通して動かしている（`createFixedInputEditor`、`EditorRegistry`、`createBlockEditorService`）。読み書き、検証、競合の扱い、ホストへの登録を確かめる、実装との結合テストである。

テスト専用の宣言をすると、このテストは依存元が次に公開されるまで、古い実装に対して通ったままになる。実装が拡張機能を壊しても、拡張機能の側では気付かない。そこで、テストを 2 つに分ける。

- **拡張機能の側の単体テスト。** contract と validation だけで書ける部分（`read`、`encode`、`validateCandidate` を直接呼ぶ）に寄せる。ホストへの登録は、契約の型に沿った小さな偽のホストで確かめる。偽のホストは contract のパッケージで用意する（テスト用の subpath）。
- **data-editor の側の結合テスト。** 拡張機能が公開した定義（`editor-schema` などの export）を data-editor の CI で読み込み、今の実装に通す。実装の変更が拡張機能を壊すことを、data-editor を公開する前に見つけられる。壊したときに直すのは data-editor の側であり、拡張機能を出し直す必要はない。

### 方策 5: 実行時の依存（app-shell、camera-source、named-data、yaml-json）

これらは実行時の依存なので、宣言では外せない。ただし、bundle される依存なら、方策 2 の比較で、コードが変わらない更新は止まる。bundle されない依存（`editor-schema` が実行時に import する data-editor の `/schema` など）は、依存元の範囲がすでに新しい版を含むので、本来は出し直す必要がない。今の計画は下限を上げるので出し直すことになる。これを止めるかどうかは「決めること」4 で判断する。

### 効果の見込み

方策 1・2 だけで、今日の 2 回の連鎖（35 件と 41 件）は、ほぼすべて取りやめになる。方策 3・4 は、契約の境界とテストの正しさを保つためのもので、連鎖の件数を減らすことはその結果である。

## 進め方

family 全体の方策（上の 1〜5）は、効果が大きく手間の少ない順に進める。

1. **方策 1：** test-runtime の依存元 7 件に、テスト専用の宣言を書く。
2. **方策 2：** executor に、成果物が同じなら取りやめる判定を足す。あわせて、成果物に依存先の版が入らないようにする。
3. **方策 3・4：** data-editor を分ける（下の手順）。

data-editor の分離の手順は次のとおり。

1. **境界を作る。** data-editor のリポジトリの中で、拡張機能の型をホストの型から切り出し、contract と validation にあたるファイルへ分ける。公開物には変化がない。
2. **contract と validation を作る。** 新しいパッケージとして公開し、data-editor はそれに依存して再 export する。data-editor の利用側には変化がない。
3. **計画の規則を足す。** (a) を `release-plan.ts` に足した（#154）。依存元は、data-editor をテスト専用にした時点で package.json に宣言する。
4. **依存元を移す。** 拡張機能の src の import を contract と validation に替える。依存元すべてに触れることになるので、次に全体を更新する連鎖と同じ機会に行う。連鎖の例外設定に、import を書き換えるフックを足す。
5. **再 export をやめる。** 0.12 系以降で、data-editor の root と `/schema` から contract と validation の記号を外す。

手順 1〜3 の間も連鎖は今のままである。data-editor の改良が続く間は、依存元の更新を改良の頻度に合わせないのが現実的である。たとえば、まとまった時点で 1 回だけ更新する。

## 決めること

1. ~~計画の規則を (a) テスト専用の宣言にするか、(b) devDependencies の下限を上げないことにするか。~~ (a) に決めた。
2. contract と validation のパッケージ名と置き場所。
   - 名前の案: `@kubohiroya/turbowarp-extension-data-editor-contract`、`@kubohiroya/turbowarp-extension-data-editor-validation`。
   - 置き場所: 新しいリポジトリにするか、data-editor のリポジトリから複数のパッケージを出すか。executor は 1 リポジトリ = 1 パッケージを前提にしているので、新しいリポジトリのほうが手間が少ない。
3. 最初の版。0.1.0 から始めるか、data-editor の 0.11 にそろえるか。
4. 契約が後方互換な追加だけのとき、依存元の下限を上げるか。bundle されない実行時の依存（方策 5）も同じ判断になる。
5. 方策 2 の比較で、何を除いて「同じ」とみなすか。パッケージ自身の版の文字列、devDependencies の範囲、bundler の注釈のほかに、d.ts の変化をどう扱うか（型が変われば利用者に影響する）。
