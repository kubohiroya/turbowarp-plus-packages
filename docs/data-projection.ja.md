# データ・ドキュメント系パッケージの投影と供給

2026-10-31時点の各リポジトリのorigin/mainを読んで作成した設計案です。まだどのパッケージにも実装していません。
「データ・ドキュメント」カテゴリのパッケージを、内部構造の反復とHTML/MarkdownのASTについてどう組み合わせるかを定めます。

## 位置付け

- **turbowarp-structured-data**: JSON値に対するpath操作と反復の担当。他のパッケージの内部構造は、structured-dataの名前付きの値として取り込んで反復します。
- **turbowarp-document-data**: 解析済みのHTML/Markdownの木（AST）の担当。解析した時点の原文での位置も持ちます。指定した部分の木を、文字列を経由せずにstructured-dataへ渡します。
- **turbowarp-markdown・turbowarp-html**: 断片を組み立てるbuilder。描画した文字列をdocument-dataへ渡して（供給）、解析・反復します。
- **turbowarp-text-lines・turbowarp-kvs**: 行の並びやキーの一覧をJSON文字列として取り出します（投影）。

「structured-data / document-data が定める規約を、他のパッケージが実装する」という形は取りません。理由は次のとおりです。

- どちらにも、他のパッケージが実装できる公開インターフェースがありません。structured-dataの反復は自身の名前付きJSON値にだけ働き、document-dataの木の型は内部の型です。
- 実行時の規約を実装させると、サンドボックス内で動くmarkdown/htmlがサンドボックス外を必要とし、yaml・parse5・mdastなどの依存も抱えます。

受け渡しの方法は、両側の動作環境で分けます。

- サンドボックス内の拡張が関わる受け渡し（markdown/htmlからdocument-dataへ）は、ブロックを通る文字列で行います。
- サンドボックス外どうしの受け渡し（document-dataからstructured-dataへ）は、ページ内で共有するregistryを通じてメモリ上で直接行います。木をJSON文字列にすると、structured-dataの`parse JSON`の入力上限256 KiBに、位置付きでは31〜47 KiB程度の原文で達してしまうためです（下の確認結果を参照）。

新しいnpm依存は増えません。structured-dataは既にdocument-dataへ依存しており（`./composition`の原文registryを使う「原文からの投影」）、今回の受け渡しも同じ依存の上に作ります。package.jsonの依存なので、この関係はダッシュボードの相関図の対象です。
markdown/html・text-lines・kvsとの関係は依存を伴わないため相関図には現れず、この文書と`catalog.yaml`のカテゴリ説明で示します。

## データの流れ

```text
turbowarp-markdown ─ render Markdown ─┐
turbowarp-html     ─ render HTML ─────┴→ turbowarp-document-data ─ 部分木をメモリ上でコピー ─┐
                                          （parse・位置情報）                                 │
turbowarp-text-lines ─ 行のJSON配列（文字列） ───────────────────────────────────────────────┼→ turbowarp-structured-data
turbowarp-kvs        ─ キーのJSON配列（文字列・既存） ────────────────────────────────────────┘   （名前付きの値 → for each）
```

## 受け渡しの共通規則

1. structured-dataに取り込んだ値は、どの経路でも共通codec（`@kubohiroya/turbowarp-yaml-json/codec`の`PARSE_LIMITS`）の深さ64・50,000値に収める。JSON文字列で渡す場合は、さらに入力256 KiBの上限がかかる。超える場合は途中までの値を作らずに失敗する。
2. JSON文字列で渡す投影はreporterブロックが返し、structured-dataの`parse JSON [TEXT] as [NAME]`へそのまま渡せる。
3. 配列の順序は決定的にする。objectのkey順は問わない（structured-dataが正規化する）。
4. 既存ブロックと意味を揃える。例：text-linesの行数ブロックの結果と投影した配列の長さは常に一致する。
5. 取り込んだ値は読み取り専用のスナップショット。structured-dataで書き換えても元のデータは変わらず、元のデータの変更も自動では反映されない（取り直すには再実行する）。
6. 渡す値の形は各パッケージのREADMEで公開する。保存済みの作品がpathで参照するため、変更は項目の追加に限り、既存項目の改名・削除・構造変更は破壊的変更として扱う。
7. 反復はstructured-dataの`for each … max N`で行い、1回のloopは最大1000件（`ITERATION_LIMIT_EXCEEDED`）。

## パッケージごとの対応

| パッケージ | 役割 | 追加するもの（案） | 優先度 |
|---|---|---|---|
| turbowarp-structured-data | 反復の担当 | `getTextAtPath`・`currentJsonAtPath`・`currentTextAtPath` | 1（他の前提） |
| turbowarp-structured-data | 部分木の取り込み | `copyDocumentTree` | 2 |
| turbowarp-document-data | 部分木の受け渡しと位置情報 | `./composition`の木のregistry、解析時の位置の保持（ブロックは追加しない） | 2（`copyDocumentTree`と同時） |
| turbowarp-markdown | document-dataへの供給 | なし（README追記のみ） | 3 |
| turbowarp-html | document-dataへの供給 | なし（README追記のみ） | 3 |
| turbowarp-text-lines | 行の投影 | `linesJson` | 4 |
| turbowarp-kvs | キー一覧の投影 | なし（既存の`listKeys`で足りる） | ― |

## turbowarp-structured-data：取り込んだ値を読むための追加

現在の`get JSON … at path`と`current value JSON`は常にJSON表記を返すため、文字列は引用符付き（`"Apple"`）になります。
このままでは、キー一覧を回して`value of (current value JSON) in [NAMESPACE]`と書いても引用符付きのキーを探してしまい、`$.type`を`heading`と比較することもできません。
また、反復中の要素の一部を読むには、要素を別の名前でparseし直す必要があります。次の3ブロックを追加します。

| opcode | 表示（案） | 戻り値 |
|---|---|---|
| `getTextAtPath` | `text from [NAME] at path [PATH]` | pathの値を文字列で |
| `currentJsonAtPath` | `current value at path [PATH]` | 反復中の要素から見たpathの値をJSONで（`$`なら`current value JSON`と同じ） |
| `currentTextAtPath` | `current text at path [PATH]` | 反復中の要素から見たpathの値を文字列で |

文字列への変換規則：stringはそのまま、numberとbooleanはJSON表記（`3`、`true`）。null・array・objectは`TYPE_MISMATCH`で失敗します（空文字列などへ黙って変換しない）。
反復の外で`current…`を使うと、既存と同じく`ITERATION_CONTEXT_REQUIRED`で失敗します。

既存ブロックと同じく`STRUCTURED_DATA_MVP`が有効なときだけ公開します。
server compiler契約（`dist/extension-manifest.json` format version 3）のIR operation、型、errorと、semantic parity fixtureにも追加が必要です。

## turbowarp-structured-data：document-dataからの部分木の取り込み

| opcode | 表示（案） | 動作 |
|---|---|---|
| `copyDocumentTree` | `copy document [DOCUMENT] at [LOCATION] [POSITIONS] as [NAME]` | document-dataの名前付きdocumentのうち`LOCATION`の部分木を、名前付きの値`NAME`としてコピーする |

- `DOCUMENT`と`LOCATION`はdocument-dataの既存ブロックと同じ指定です。`LOCATION`は`$`、`$[0][1]`形式、単純なHTML selector（tag、`#id`、`.class`。最初に一致した要素）を受け付けます。
- `POSITIONS`はmenuで、`without positions`（既定）と`with positions`から選びます。
- JSON文字列を経由しません。document-dataの木をメモリ上でコピーするので、入力256 KiBの上限はかかりません。深さ64・50,000値の上限は`parse JSON`と同じくかかり、深さはコピーする部分木の根から数えます。木の1段ごとにobjectと`children`配列で値が2段深くなるため、部分木の根から約31段より深い木はコピーできません。
- 上限を超えると`PARSE_LIMIT_EXCEEDED`で失敗し、既存の値を置き換えません。大きな文書や深い木は、`LOCATION`で一部分ずつコピーします。
- 読み取るのは、ブロックを実行したtargetの名前付きdocumentです。コピー先の名前も`parse JSON`と同じくtarget単位で、同名なら置き換え、project停止時に破棄します。
- error codeは既存のものを使います。document-dataが読み込まれていない、またはdocumentがない場合は`DATA_NOT_FOUND`、`LOCATION`の書式が不正なら`INVALID_PATH`、該当する要素がなければ`PATH_NOT_FOUND`です。
- document-dataのregistryはブロックの実行時に探すので、2つの拡張の読み込み順は問いません。
- `STRUCTURED_DATA_MVP`と、新しい起動時フラグ`STRUCTURED_DOCUMENT_TREE`（既定OFF）の両方がONのときだけ公開します。既存の`STRUCTURED_DOCUMENT_SOURCE`と同じ扱いです。
- サーバー側にはdocument-dataがないため、server compiler契約では対象外として宣言します（manifestでの表し方はstructured-data側で決めます）。

位置の対応：`LOCATION`に`$`または`$[…]`形式の`L`を指定した場合、コピーした値の`$.children[i].children[j]`はdocument-dataのlocation `L[i][j]`に対応します（`L`が`$`なら`$[i][j]`）。反復で見つけた要素を、そのまま`text in document … at …`や`replace text in document … at …`へ渡せます。HTML selectorでコピーした場合はこの対応が取れないため、元の文書へ戻したいときは`$[…]`形式で指定します。

使用例：

```text
parse Markdown (render Markdown (fragment)) as document [doc]
copy document [doc] at [$] [with positions] as [tree]
for each in [tree] at path [$.children] max [100]
  if <(current text at path [$.type]) = [heading]> then
    say (join (current text at path [$.position.start.line]) (join ": " (text in document [doc] at (join "$[" (join (current index) "]")))))
```

## turbowarp-document-data：木のregistryと位置情報

document-dataにはブロックを追加しません。`./composition`（parserに依存しない入口）に、名前付きdocumentの木を読み取る共有registryを加えます。既存の原文registry（`getSourceDocumentRegistry`）と同じ作りです。

- `getDocumentTreeRegistry(scope)`：ページ内で共有するregistryを返します。`Symbol.for`の固定キーで取得するので、別々にbundleされた拡張から同じregistryに届きます。
- document-dataの拡張は、生成時に自身の木の保管場所をregistryへ登録し、`dispose()`で解除します。
- `capture(target, name, {location, positions, limits})`：targetの名前付きdocumentから、`location`の部分木の深いコピーを返します。結果は`{kind, revision, root}`です。`limits`（深さ・値数）を超えた時点でコピーを打ち切って失敗するので、上限を超える大きな木を丸ごと複製しません。
- registryは木やコピーを保持しません。返したコピーを書き換えても、document-dataの木は変わりません。
- 返す木の形：
  - HTML：文書全体では`{"type":"root","children":[…]}`、部分木では指定したノード。ノードは`element`（`tagName`・`attributes`・`children`）、`text`（`value`）、`comment`（`value`）で、parse済みの木と同じ形です。
  - Markdown：mdast（mdast-util-from-markdown v2の出力）のノード。mdastのmajor更新は破壊的変更として扱います。
  - `positions`が真のときだけ、各ノードに下記の`position`が付きます。偽のときは`position`を含めません。
- 既存と同じく`DOCUMENT_DATA_MVP`が有効なときだけregistryへ登録します。

### 位置情報

解析した時点の原文での位置だけを持ちます。編集した木の位置は保ちません。

- **保持**：解析時に位置を保持します。Markdownはmdastの`position`を取り除かずに保持します。HTMLはparse5を`sourceCodeLocationInfo: true`で呼び、各ノードと根に同じ形の`position`を付けます。
- **形**：`position: {start: {line, column, offset}, end: {line, column, offset}}`（mdast・unistと同じ形）。lineとcolumnは1から、offsetは0から数え、`end`は範囲の直後を指します。
- **単位**：columnとoffsetはUTF-16単位です。JSの文字列の添字やScratchの`letter (n) of`と同じ数え方で、絵文字1文字は2と数えます。
- **基準**：parseに渡した文字列そのものでの位置です。`\r\n`のCRもoffsetに数えます（行の区切りとしては1つ）。markdown/htmlのbuilderから渡した文書では、描画した文字列での位置になります。
- **位置のないノード**：parse5が補った、原文にないノード（`tbody`など）は`position`を持ちません。終了タグを省いた要素の`end`は、暗黙に閉じた位置（次の要素の開始位置）になります。
- **編集**：`replace text in document`は、結果の木のすべてのノード（根を含む）から`position`を取り除きます。編集で挿入したノードにも付けません。木の位置は常に「解析した原文で正しい」か「ない」のどちらかです。
- **判定**：文書の根に`position`があれば、その木の位置はすべて解析した原文で有効です。編集後に位置付きでコピーしても失敗せず、`position`のない木を返します。
- **原文**：原文そのものは保持しません。位置から原文の該当部分を取り出したい場合は、利用者が原文を別に持っておきます。
- **既存の出力**：`serialize document`とNamed Data providerの出力は変わりません。mdast-util-to-markdownの出力は位置の有無にかかわらず同じです。既存のテスト「position-free Markdown AST」は、内部の木ではなく位置なしで返す木を検査する形に改めます。
- **大きさ**：位置を含めると、値の数はおよそ4倍になります。確認した3つのMarkdown文書の比率で50,000値の上限から逆算すると、文書全体を位置付きでコピーできる原文は76〜121 KiB程度です。位置なしなら、確認した比率ではdocument-dataが受け付ける原文（256 KiBまで）の全体をコピーできます。それより大きい場合は、`LOCATION`で一部分ずつコピーします。内部の木のメモリも位置の分だけ増えます。

例：反復中に`current text at path [$.position.start.line]`を読めば、その要素が原文の何行目から始まるかが分かります。

## turbowarp-markdown・turbowarp-html：document-dataへの供給

`render Markdown [FRAGMENT]` / `render HTML [FRAGMENT]` の結果を、document-dataの`parse Markdown … as document …` / `parse HTML … as document …`へ渡します。コードの変更は不要で、READMEに「解析・反復したいときはdocument-dataへ渡す」ことを追記します。

builderの断片そのものを投影するブロックは設けません。

- 断片は組み立て途中の形です。HTMLでは`ul`の子が1つの`sequence`にまとまったまま保持されるため（下の確認結果では`ul`の子が1件）、そのまま回すと項目単位で反復できません。Markdownも、段落の中身が1つなら単体、複数なら`sequence`と形が変わります。
- 解析済みの木なら、子は常に`children`配列に平らに並びます。HTMLの場合、builderの断片の`sequence`を平らにし、`kind`を`type`と読み替えた形と同じです。
- 保存済み作品に含まれる`turbowarp-markdown:v1:` / `turbowarp-html:v1:`の文字列形式は変更しません。
- markdown/htmlはサンドボックス内のままでかまいません。文字列はブロックを通して渡ります（document-dataとstructured-dataはサンドボックス外で動かします）。

## turbowarp-text-lines・turbowarp-kvs

| opcode | 表示（案） | 戻り値 |
|---|---|---|
| `linesJson`（text-lines） | `lines of [TEXT] as JSON` | 行の文字列配列 |

- 分割規則は既存と同じ`\r\n`・`\n`・`\r`です。空文字列は`[""]`、末尾の改行は末尾の`""`になり、`number of lines in [TEXT]`と配列の長さは常に一致します。
- 1000行を超えると1回のloopでは回せません。Scratchのリストへ書き出す既存の`put lines of [TEXT] into list [LIST]`の方が適する場面が多いため、優先度は低くします。
- kvsは既存の`keys in [NAMESPACE] as JSON`がそのまま投影です（並べ替え済みの文字列配列）。structured-dataの`current text at path [$]`が入れば、`value of (current text at path [$]) in [NAMESPACE]`で値まで読めます。値も含めた投影は、必要になった時点で検討します。

## 範囲外

- structured-dataの値から元のデータへの書き戻し（値から断片やdocumentを作る）。
- 原文を正本として保持し、編集を「原文の該当範囲の書き換え＋再解析」で行うこと。書式を保った編集や、編集後も位置を保つことが必要になった時点で検討する。`replace text`の意味と、差し込む文字列のエスケープ規則が変わるため、既存作品との互換性の検討が要る。
- named-dataを介した受け渡し。named-dataの本文はバイト列（`Uint8Array`かstream）なので、JSONへの直列化と再解析を避けられない。
- 木をJSON文字列として取り出すブロック。structured-data以外（HTTPの本文など）へ木を渡す必要が出た時点で検討する。
- builderの断片の形をdocument-dataの木の形へ統一すること。
- 名前を付けずに反復中の要素の子を反復すること（入れ子の`for each`は、pathを組み立てて元の名前に対して行う）。

## 確認した内容

2026-10-31に、次のorigin/mainのソースを読み、一部はtsxで直接読み込んで確認しました。TurboWarp上での確認ではありません。

| パッケージ | version | commit |
|---|---|---|
| turbowarp-structured-data | 0.11.0-rc.0 | 7e9e646 |
| turbowarp-document-data | 0.5.0-rc.1 | 6af9051 |
| turbowarp-named-data | 0.8.0-rc.0 | 6c66687 |
| turbowarp-markdown | 0.5.0 | 9297773 |
| turbowarp-html | 0.5.0 | b8461f4 |
| turbowarp-text-lines | 0.5.0 | 37aef94 |
| turbowarp-kvs | 0.5.1 | 07a9501 |

- 見出し・段落・強調・箇条書きの断片を描画し、document-dataでparseしてserializeしました。HTMLは描画結果と完全に一致し、Markdownは末尾の改行1つだけが異なりました（document-dataのserializerが末尾に改行を付けるため）。
- `h1`と3項目の`ul`を組み立てたHTMLで、builderの断片の`$.children[1].children`は1件（`sequence`）、parse後の木では3件でした。
- parse後の木で、location `$[1][2]` のtextと木の`$.children[1].children[2]`の要素は、どちらも`Cherry`でした。
- 上の木のJSONの深さは7、Markdownの見出し・段落・箇条書きのmdastは9でした。
- structured-dataで`["apple","banana"]`を反復すると、`current value JSON`は`"apple"`（引用符付き）を返しました。
- named-dataの契約（`src/contract.ts`）では、providerが返す本文は`Uint8Array`か`ReadableStream<Uint8Array>`だけです。
- structured-dataは既に`@kubohiroya/turbowarp-document-data`へ依存し、`./document-source`で原文registry（`getSourceDocumentRegistry`）から原文を読み取っています。
- 位置の有無による木のJSONの大きさ：

  | 文書 | 位置なし（現状） | 位置付き |
  |---|---|---|
  | structured-dataの`README.md`（Markdown 19.2 KiB） | 40.8 KiB・2,266値・深さ9 | 115.1 KiB・8,800値・深さ11 |
  | document-dataの`docs/index.html`（HTML 10.5 KiB） | 31.9 KiB・2,226値・深さ23 | 84.9 KiB・6,861値・深さ25 |

  HTMLの位置付きは、parse5の`sourceCodeLocation`をmdastと同じ形に変換して測りました。依存はdocument-dataのlockfileと同じparse5 8.0.1、mdast-util-from-markdown 2.0.3、mdast-util-to-markdown 2.1.2です。
- Markdown文書ごとの、位置付きの木を渡せる原文の大きさ。JSON文字列は256 KiB、メモリ上のコピーは50,000値の上限から逆算しました：

  | 文書 | 原文 | 位置付きのJSON | 位置付きの値の数 | JSON文字列で渡せる原文 | コピーで渡せる原文 |
  |---|---|---|---|---|---|
  | structured-dataの`README.md` | 19.2 KiB | 115.1 KiB（6.0倍） | 8,800 | 約43 KiB | 約109 KiB |
  | named-functionsの`README.ja.md` | 20.3 KiB | 111.8 KiB（5.5倍） | 8,421 | 約47 KiB | 約121 KiB |
  | htmlの`README.md` | 13.5 KiB | 109.7 KiB（8.1倍） | 8,849 | 約31 KiB | 約76 KiB |

  位置なしの値の数は2,184〜2,288で、50,000値から逆算すると295〜465 KiBとなり、いずれもdocument-dataの原文上限256 KiBを上回ります。
- 上のMarkdownをmdast-util-to-markdown（document-dataと同じoption）で出力すると、位置の有無にかかわらず結果は同じでした。
- `# A\r\n\r\n😀 b\r\n`の段落の位置は3行1列〜3行5列、offset 7〜11でした（CRを数え、絵文字は2単位）。空文字列のmdastの根にも`position`（1行1列、offset 0）が付きます。
- parse5で`<table><tr><td>😀a</td></tr></table>`を解析すると、補われた`tbody`には位置がなく、`td`内のtextはoffset 15〜18（3単位）でした。`<p>a<p>b`では、最初の`p`の`end`は次の`p`の開始と同じoffset 4でした。
