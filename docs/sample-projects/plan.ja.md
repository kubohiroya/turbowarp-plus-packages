# 機能拡張の最小デモ計画

2026-10-27時点の`catalog.yaml`と各ローカルチェックアウトのREADME・
`src/block-definitions.json`を基にした計画です。表のサンプルは提案であり、
実装済みとするのは下記のText Linesとテンプレートだけです。2026-10-27に承認を受け、Text Lines→テンプレートの順にPages公開・実配信確認を完了しました。

## 先行実装

| パッケージ | 配布ファイル | 実行結果 | 状態 |
|---|---|---|---|
| turbowarp-text-lines | `samples/lines-to-list.sb3` | 3ブロックで行数`3`、2行目`Banana`、リスト`Apple, Banana, Cherry`を表示 | [公開・実配信確認済み（PR #42）](https://github.com/kubohiroya/turbowarp-text-lines/pull/42) |
| turbowarp-extension-template | `samples/hello-world.sb3` | `hello`の結果を変数へ表示。英語では`Hello, world!` | [公開・実配信確認済み（PR #49）](https://github.com/kubohiroya/turbowarp-extension-template/pull/49)。生成・CI・Pages・日英README雛形を標準化 |

## 共通仕様

- 名前は内容を表す英小文字とハイフンにします。各リポジトリで
  `https://kubohiroya.github.io/<repo>/samples/<name>.sb3`を配信します。
- READMEには`https://turbowarp.org/editor?project_url=<SB3のURLをエンコード>`と
  直接ダウンロード、実行操作、期待結果、必要な関連拡張・機器・設定を載せます。
- 1サンプルは1つの到達点に絞り、自分の拡張ブロックを必ず使います。
  標準ブロックと自作SVG・小さな固定データを優先し、無関係な拡張を増やしません。
- 編集可能な`project.json`と素材を`samples/<name>/`へ置き、生成したSB3もコミットします。
  `samples:check`で元データ・拡張JSとの差分を検出し、Pagesは`_site/`を配信します。
- sandbox互換の拡張はPagesのJS URLをSB3へ記録します。unsandboxed拡張は
  検証対象のJSを`data:` URLとして同梱します。公式Editorはプロジェクト内の任意の
  HTTPS拡張URLをsandboxで読み込むため、同梱形式で通常のunsandboxed同意画面を使います。
  利用者の同意を自動化するコードは含めません。
- 複数拡張が必要なデモでは、必要な全IDとURL/同梱JSを記録する生成処理へ拡張する
  個別Issueを先に作ります。先行実装の生成ツールは単一拡張用です。
- 起動時固定・既定OFFの機能は、その既定値を変更しません。フラグが必要なデモは
  サンプル専用の明示的な起動設定を別途設計し、READMEに記載してから作成します。
- 成功状態を保存しただけのプロジェクトにせず、緑の旗や記載された操作で結果を作ります。
  停止・再実行でイベント登録・カメラ・通信を重複させず、資源を解放します。

URL・CORSについては[TurboWarp公式仕様](https://docs.turbowarp.org/url-parameters)、
同意画面の扱いは今回の公式Editorでの動作確認と、ローカルscratch-guiの
`src/containers/tw-security-manager.jsx`を根拠にしています。

## Text Lines以外の全41拡張の候補

優先度は、P1＝単独・固定データ中心、P2＝関連拡張／ブラウザAPI／起動設定あり、
P3＝機器／複数端末／外部サービスあり、保留＝目的のブロックが未実装、とします。
P1の「単独」は、このテンプレートの標準配信方式以外に特別な資源が要らない意味です。

| 優先 | パッケージ | `samples/`以下のファイル名案 | 最小デモと確認する結果 | 関連拡張・準備／実装上の注意 |
|---|---|---|---|---|
| P1 | turbowarp-uuid | `generate-and-check-uuid.sb3` | `generateV4`・`generateV7`を変数に保存し、`isUuid`が両方trueになることを表示 | 再実行で値が変わる。固定UUIDとの文字列一致を期待結果にしない |
| P1 | turbowarp-yaml-json | `yaml-json-roundtrip.sb3` | `parseText`で小さなYAMLを読み、`renderJson`・`renderYaml`の結果と解析成功を表示 | 外部データ不要。小さな不正入力の診断は第2サンプルに分離 |
| P1 | turbowarp-markdown | `build-markdown-card.sb3` | `heading`・`bold`・`paragraph`・`render`で短い紹介文を生成し、結果のMarkdown文字列を表示 | 描画エンジンを追加せず、文字列の生成自体を実証 |
| P1 | turbowarp-html | `build-html-card.sb3` | `h1`・`p`・`render`で小さなカードのHTML文字列を生成 | ブラウザにDOMを挿入するデモとは分離。エスケープも1例で確認 |
| P1 | turbowarp-structured-data | `edit-json-profile.sb3` | `parseJson`で名前と点数を登録し、`setJsonAtPath`で点数を更新、`getJsonAtPath`で表示 | JSON固定値だけを使用。schema付きは追加デモ |
| P1 | turbowarp-document-data | `replace-document-text.sb3` | `parseHtml`で短い文書を登録し、`replaceDocumentText`後の`getDocumentText`・`serializeDocument`を表示 | 実際のLOCATION指定形式は実装時に確定。外部HTMLを取得しない |
| P1 | turbowarp-binary-data | `utf8-byte-count.sb3` | `createUtf8`で`Hello`を登録し、`byteLength`が5、MIMEが指定値になることを表示 | `sha256`も表示する場合はWeb Crypto対応を確認 |
| P1 | turbowarp-kvs | `save-and-read-score.sb3` | デモ専用namespaceへ`setValue`し、`getValue`・`hasKey`・`deleteKey`を順に確認 | サンプル自身のキーだけを操作。保存の継続性は別の説明にする |
| P1 | turbowarp-runtime-expression | `condition-score-gate.sb3` | 点数を変え、`validateConditionSyntax`と`runtimeCondition`による合格判定を表示 | 利用できる式と変数参照の構文に合わせる。条件付きbroadcastは次の例 |
| P1 | turbowarp-named-functions | `call-greeting-function.sb3` | `defineFunction`で引数を受け、`functionArgument`・`returnValue`・`callFunction`で挨拶を返す | 最小の引数・戻り値schemaを添付。非同期並列呼び出しは追加例 |
| P1 | turbowarp-jotai-adapter | `atom-value-and-plan.sb3` | `defineAtom`・`setAtomValue`・`atomValueJson`で値を変更し、`planJson`を表示 | ブロックの宣言・計画生成を実証。React画面への反映は別の統合デモ |
| P1 | turbowarp-diagnostic-overlay | `show-and-clear-diagnostic.sb3` | `showDiagnostic`で1件表示し、キー操作で`clearDiagnosticOverlay`、可視状態を確認 | overlayの実行条件をREADMEへ記載。SVG生成だけの代替も検討 |
| P1 | turbowarp-svg-text | `style-hello-text.sb3` | `defineStyle`・`setText`でスプライトを文字へ変更し、色とサイズを確認 | 表示対象の小さなスプライトを同梱 |
| P1 | turbowarp-qr-display | `show-and-hide-qr.sb3` | `showQrCodeWithin`で固定文字列のQRを表示し、`qrCodeSize`・`isShowingQrCode`を確認、キーで消す | カメラ不要。QRの中身も画面に併記 |
| P1 | turbowarp-extended-notification | `wait-for-notification.sb3` | 並行スクリプトで待ち受けを開始してから`sendNotification`し、受信結果を表示 | 通知前に待ち受けを登録し、再実行で古い待機を残さない |
| P1 | turbowarp-cloudflare-worker | `generate-hello-worker.sb3` | `createHandlerIr`・`createWorkerIr`・`generateFilesJson`でGET /hello用ファイルを生成 | 出力までをデモ範囲とし、Cloudflareへのデプロイは行わない |
| P2 | turbowarp-title-menu | `choose-menu-action.sb3` | `addAppMenuAction`・`showMenu`と`whenAppMenuActionSelected`で選択した項目名を表示 | app-shellのホスト要件を確認。メニューを閉じて再表示できることを確認 |
| P2 | turbowarp-named-data | `registry-availability.sb3` | `isRegistryAvailable`でレジストリ有効化を確認 | 現在は起動時固定のMVPフラグが必要で、OFF時はブロック自体が非表示。サンプル専用起動方式の設計が先 |
| P2 | turbowarp-react-islands | `describe-counter-island.sb3` | `registerComponent`・`reactIslandHtml`で固定propsを持つカウンターの宣言HTMLを表示 | クリックできる実画面はbundle／HTTPホストが必要。単独デモでは宣言生成まで |
| P2 | turbowarp-bubble | `say-and-close-bubble.sb3` | `defineBubbleStyle`・`sayWithBubbleStyle`で1つの吹き出しを表示し、`closeBubble`で閉じる | svg-text等の実際の依存を確認し、必要な関連拡張だけ同梱 |
| P2 | turbowarp-asset-cache | `show-cached-svg.sb3` | `loadAsset`で自作SVGを登録し、`isLoaded`・`setThisSpriteSkin`で表示、削除後の状態を確認 | data URIで取得可能か確認。不可なら同一Pagesの小さなSVGを添付 |
| P2 | turbowarp-3d-scene-runtime | `apply-one-cube-scene.sb3` | `applyScene`へ固定YAMLを渡し、立方体1個と`sceneStatus`・`isSceneReady`を確認 | A-Frameの関連拡張が先。ARを含めず最小化 |
| P2 | turbowarp-aframe | `move-one-cube.sb3` | `createScene`・`createNode`・`setPosition`で立方体を作り、キー操作で移動 | WebGL対応が必要。モデル・VRM・アニメーション資産を使わない |
| P2 | turbowarp-ar | `manual-ar-target.sb3` | `createARScene`・`defineARTarget`・`setARTargetPosition`・`setARTargetVisible`で手動ターゲットを更新 | 自動カメラ認識があると誤認させない。描画に必要な関連拡張を明記 |
| P2 | turbowarp-async-input | `wait-for-space.sb3` | `listenForKeyAndBroadcast`でSpaceを待ち、受信でカウンターを増やし、停止で解除 | タブにフォーカスが必要。再実行でも1キーにつき1回だけ反応 |
| P2 | turbowarp-realtime-motion-capture | `pose-protocol-roundtrip.sb3` | 固定の小さな姿勢JSONを`protocolJsonValid`・`decodeProtocolJson`・`encodeProtocolJson`で検証 | 最初の例はカメラ・WebGPU・複数端末を不要にする。実時推定は後続 |
| P2 | turbowarp-web-speech | `speak-one-sentence.sb3` | `isSynthesisSupported`を確認し、クリック後に`speakAndWait`で短文を発話 | 初期デモは音声合成だけ。音声認識のマイク許可は別デモ |
| P3 | turbowarp-camera-source | `camera-preview-and-size.sb3` | 明示ボタンからカメラ開始、`showCameraPreview`と幅・高さを表示し、停止で解放 | HTTPS・カメラ権限・実機。拒否時は`cameraError`を表示 |
| P3 | turbowarp-camera-calibration | `capture-calibration-board.sb3` | `startCameraCalibration`・`addCameraCalibrationSample`で印刷ボードを複数回撮影し、進捗と解法結果を表示 | camera-source・印刷用ボード・実機。必要枚数・品質基準を記載 |
| P3 | turbowarp-teachable-machine | `recognize-two-labels.sb3` | 同梱または固定のモデルを`loadModel`し、`startRecognition`後のクラスとscoreを表示 | カメラとライセンス確認済みの小さなモデルを準備。モデルURLは差し替え可能にする |
| P3 | turbowarp-time-space-sync | `optical-pattern-observation.sb3` | 明示同意後`acknowledgePatternFlashing`・`showTimePattern`、別画面のデコーダーで観測数を確認 | 表示側・撮影側の2端末とcamera-source。点滅への同意前には表示しない |
| P3 | turbowarp-webrtc | `two-tab-ping.sb3` | タブ間でoffer／answerをコピーし、`sendEvent`と`nextMessage`でping/pongを表示 | 2タブ、同一LANから開始。ICE設定と接続失敗をREADMEへ記載 |
| P3 | turbowarp-webrtc-qrcode-pairing | `pair-two-devices.sb3` | offer／answer側を選び、QR分割片の読取で接続状態を表示 | WebRTC・カメラ／QR関連の能力が必要。2端末・欠片数・タイムアウトを表示 |
| P3 | turbowarp-http-server | `respond-hello-http.sb3` | `whenHttpRequestReceived`・`currentRequestPath`・`respondWithText`で/helloへ応答 | WebSocket/HTTPブリッジを事前起動。Pages単独ではHTTP待受できない |
| P3 | turbowarp-openai-realtime-api | `relay-text-reply.sb3` | `configureRelay`・`pairRelay`後、明示操作で接続し`sendText`への応答を表示、終了時disconnect | relay・利用者のAPI設定が必要。キーはSB3に含めず、接続前にサービス利用条件を説明 |
| P3 | turbowarp-voice-chat | `one-turn-voice-chat.sb3` | 利用者が開始操作し、1往復の発話と`aiReply`を表示して`endConversation` | relay・API設定・マイク・音声出力。最初のサンプルは継続会話しない |
| P3 | turbowarp-sesame | `read-device-status.sb3` | relayのペアリング後に`getStatusField`で施錠状態・電池残量を表示 | 利用者自身の機器とrelayが必要。最小デモでは施錠・解錠コマンドを送らない |
| P3 | turbowarp-jsqr | `read-one-qr.sb3` | `waitForQrTextSetRuntimeVar`で印刷した固定QRを読み、`lastQrTextReporter`を表示 | camera-sourceとカメラ権限。印刷可能なQR素材を同一Pagesへ添付 |
| P3 | turbowarp-webusb-pasori | `read-one-nfc-idm.sb3` | 明示クリックで`connectPasoriBlock`し、`waitForNfcIdmSetRuntimeVar`で自分のカードのIDmを表示 | WebUSB対応環境・PaSoRi・カード。配布SB3は空の初期値とし、読取値を保存しない |
| 保留 | turbowarp-photogrammetry | `hello-scaffold.sb3` → 将来`reconstruct-small-object.sb3` | 現在の実装は`hello`だけ。今は挨拶の動作確認と明記し、再構成デモは作成しない | 固定画像からの再構成ブロックと検証データの実装後に再計画 |
| 保留 | turbowarp-visual-tracking | `hello-scaffold.sb3` → 将来`track-one-marker.sb3` | 現在の実装は`hello`だけ。姿勢推定・追跡機能を実証したと表現しない | マーカー追跡ブロックの実装後、印刷マーカー＋カメラ1台の例を作成 |

## ブロックを提供しないパッケージ

これらには存在しない拡張ブロックを作らず、利用側のデモまたはツールのfixtureで検証します。

| パッケージ群 | サンプルの持たせ方 |
|---|---|
| sb3-toolchain、vite-plugin-turbowarp-extension、turbowarp-extension-manifest、turbowarp-sb3-source-builder、turbowarp-local-preview、turbowarp-live-reload-controller、turbowarp-extension-data-editor | templateのSB3をfixtureとしてビルド・manifest検査・プレビュー・ブロック編集を確認。sampleを開くためだけの新ブロックは追加しない |
| turbowarp-app-template、turbowarp-app-shell、turbowarp-runtime-adapter | templateのサンプルまたはtitle-menuのSB3をホストするアプリ例 |
| scratch-gui、turbowarp-extension-security-dialog | 今回のSB3を開いて権限確認から編集・実行までを確認するテスト |
| turbowarp-scene-graph | `apply-one-cube-scene.sb3`に添付する固定YAMLで検証 |
| turbowarp-3d-scene-dsl | 廃止済みでscene-graphへ統合。新規デモは作らず移行先を案内 |
| qrcode-structured-append | QRペアリングの分割・順序入替・復元fixtureとして検証 |
| アプリ・ドキュメント各リポジトリ | 拡張パッケージの対象から分離。完成アプリへのリンクと、そのアプリ固有のサンプルは各READMEで案内 |

## 実装順序と受け入れ条件

1. **直列**: Text Linesの公開検証 → テンプレート標準化の公開検証。
2. **独立して進行可能**: P1の各拡張。各リポジトリ1Issue・1つの小粒PRから始めます。
3. **依存順**: svg-text → bubble、A-Frame → scene-runtime／AR、
   camera-source → jsqr／camera-calibration、WebRTC＋QRの必要能力 → pairing。
4. **要件を先に確定**: named-dataの起動フラグ、複数拡張同梱、React描画ホスト、
   relay／機器を必要とするP2・P3。実装のない2拡張は機能追加後に着手します。

各Issueに、ファイル名・使用opcode・依存・必要権限・期待結果・チェックリストと
`start/done/blocked`ログを記録します。公開後のDoDは次のとおりです。

- [ ] PagesのSB3と必要なJS／モデル／素材を直接取得できる。
- [ ] 新しいEditorセッションでREADMEのリンクを開ける。
- [ ] 必要な同意とユーザー操作の後、画面で期待結果を確認できる。
- [ ] 停止・再実行で古いイベント・通信・カメラが残らない。
- [ ] 元データからの再生成・`samples:check`・変更範囲の検証が通る。
- [ ] 必要資源がない場合、READMEの説明に沿って状態・エラーを確認できる。

切戻しはサンプルとREADME／Pagesの追加をrevertします。拡張本体の既定動作や
既定OFFフラグには変更を加えません。
