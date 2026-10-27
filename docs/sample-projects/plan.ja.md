# 機能拡張の最小デモ計画

2026-10-27のブロック定義調査を基に作成し、2026-10-28に公開実績を反映しました。
Text Linesとテンプレートに続き、P1の16件・P2の11件・P3の12件、計39拡張の
最小デモを各リポジトリでマージし、Pages公開後のEditor読み込みを確認済みです。
下表のSB3リンクはEditorを開き、PRリンクは実装・検証・要件の記録を示します。
機器・外部サービスが必要な成功経路まで検証済みという意味ではありません。
保留2件は、目的のブロックが未実装のため今回の配信対象に含めていません。

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
  `samples:check`またはREADME記載の直接nodeコマンドで元データ・拡張JSとの差分を検出し、
  Pagesは`_site/`を配信します。Teachable Machineは既存バンドルへのpackage.json埋め込みを
  変えないため、専用CI stepからサンプル検査を直接実行します。
- sandbox互換の拡張はPagesのJS URLをSB3へ記録します。unsandboxed拡張は
  検証対象のJSを`data:` URLとして同梱します。公式Editorはプロジェクト内の任意の
  HTTPS拡張URLをsandboxで読み込むため、同梱形式で通常のunsandboxed同意画面を使います。
  利用者の同意を自動化するコードは含めません。
- 複数拡張が必要なデモでは、必要な全IDとURL/同梱JSを記録する生成処理へ拡張する
  個別Issueを先に作ります。先行実装の生成ツールは単一拡張用です。
- 起動時固定・既定OFFの機能は、その既定値を変更しません。フラグが必要なデモは
  サンプル専用の明示的な起動設定を別途設計し、READMEに記載してから作成します。
- 成功状態を保存しただけのプロジェクトにせず、緑の旗や記載された操作で結果を作ります。
  停止・再実行の動作を検証し、既存ブロックで完全な中断・解放を保証できない場合は、
  タブを閉じるなどの終了方法と制約をREADMEへ明記します。
- 自動検証では音声・マイク・カメラ・USB chooser・画面点滅を開始しません。
  実機や課金サービスが必要な経路は、初期状態・取消・未接続時の検証と区別します。

URL・CORSについては[TurboWarp公式仕様](https://docs.turbowarp.org/url-parameters)、
同意画面の扱いは今回の公式Editorでの動作確認と、ローカルscratch-guiの
`src/containers/tw-security-manager.jsx`を根拠にしています。

## Text Lines以外の全41拡張の計画と公開実績

優先度は、P1＝単独・固定データ中心、P2＝関連拡張／ブラウザAPI／起動設定あり、
P3＝機器／複数端末／外部サービスあり、保留＝目的のブロックが未実装、とします。
P1の「単独」は、このテンプレートの標準配信方式以外に特別な資源が要らない意味です。

| 優先 | パッケージ | 公開デモ（Editor）／ファイル名案 | 最小デモと確認する結果 | 関連拡張・準備／実装上の注意 | 公開・検証記録 |
|---|---|---|---|---|---|
| P1 | turbowarp-uuid | [`generate-and-check-uuid.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-uuid%2Fsamples%2Fgenerate-and-check-uuid.sb3) | `generateV4`・`generateV7`を変数に保存し、`isUuid`が両方trueになることを表示 | 再実行で値が変わる。固定UUIDとの文字列一致を期待結果にしない | [公開済み・PR #9](https://github.com/kubohiroya/turbowarp-uuid/pull/9) |
| P1 | turbowarp-yaml-json | [`yaml-json-roundtrip.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-yaml-json%2Fsamples%2Fyaml-json-roundtrip.sb3) | `parseText`で小さなYAMLを読み、`renderJson`・`renderYaml`の結果と解析成功を表示 | 外部データ不要。小さな不正入力の診断は第2サンプルに分離 | [公開済み・PR #22](https://github.com/kubohiroya/turbowarp-yaml-json/pull/22) |
| P1 | turbowarp-markdown | [`build-markdown-card.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-markdown%2Fsamples%2Fbuild-markdown-card.sb3) | `heading`・`bold`・`paragraph`・`render`で短い紹介文を生成し、結果のMarkdown文字列を表示 | 描画エンジンを追加せず、文字列の生成自体を実証 | [公開済み・PR #20](https://github.com/kubohiroya/turbowarp-markdown/pull/20) |
| P1 | turbowarp-html | [`build-html-card.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-html%2Fsamples%2Fbuild-html-card.sb3) | `h1`・`p`・`render`で小さなカードのHTML文字列を生成 | ブラウザにDOMを挿入するデモとは分離。エスケープも1例で確認 | [公開済み・PR #21](https://github.com/kubohiroya/turbowarp-html/pull/21) |
| P1 | turbowarp-structured-data | [`edit-json-profile.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-structured-data%2Fsamples%2Fedit-json-profile.sb3) | `parseJson`で名前と点数を登録し、`setJsonAtPath`で点数を更新、`getJsonAtPath`で表示 | JSON固定値だけを使用。schema付きは追加デモ | [公開済み・PR #27](https://github.com/kubohiroya/turbowarp-structured-data/pull/27) |
| P1 | turbowarp-document-data | [`replace-document-text.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-document-data%2Fsamples%2Freplace-document-text.sb3) | `parseHtml`で短い文書を登録し、`replaceDocumentText`後の`getDocumentText`・`serializeDocument`を表示 | 実際のLOCATION指定形式は実装時に確定。外部HTMLを取得しない | [公開済み・PR #17](https://github.com/kubohiroya/turbowarp-document-data/pull/17) |
| P1 | turbowarp-binary-data | [`utf8-byte-count.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-binary-data%2Fsamples%2Futf8-byte-count.sb3) | `createUtf8`で`Hello`を登録し、`byteLength`が5、MIMEが指定値になることを表示 | `sha256`も表示する場合はWeb Crypto対応を確認 | [公開済み・PR #15](https://github.com/kubohiroya/turbowarp-binary-data/pull/15) |
| P1 | turbowarp-kvs | [`save-and-read-score.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-kvs%2Fsamples%2Fsave-and-read-score.sb3) | デモ専用namespaceへ`setValue`し、`getValue`・`hasKey`・`deleteKey`を順に確認 | サンプル自身のキーだけを操作。保存の継続性は別の説明にする | [公開済み・PR #19](https://github.com/kubohiroya/turbowarp-kvs/pull/19) |
| P1 | turbowarp-runtime-expression | [`condition-score-gate.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-runtime-expression%2Fsamples%2Fcondition-score-gate.sb3) | 点数を変え、`validateConditionSyntax`と`runtimeCondition`による合格判定を表示 | 利用できる式と変数参照の構文に合わせる。条件付きbroadcastは次の例 | [公開済み・PR #51](https://github.com/kubohiroya/turbowarp-runtime-expression/pull/51) |
| P1 | turbowarp-named-functions | [`call-greeting-function.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-named-functions%2Fsamples%2Fcall-greeting-function.sb3) | `defineFunction`で引数を受け、`functionArgument`・`returnValue`・`callFunction`で挨拶を返す | 最小の引数・戻り値schemaを添付。非同期並列呼び出しは追加例 | [公開済み・PR #21](https://github.com/kubohiroya/turbowarp-named-functions/pull/21) |
| P1 | turbowarp-jotai-adapter | [`atom-value-and-plan.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-jotai-adapter%2Fsamples%2Fatom-value-and-plan.sb3) | `defineAtom`・`setAtomValue`・`atomValueJson`で値を変更し、`planJson`を表示 | ブロックの宣言・計画生成を実証。React画面への反映は別の統合デモ | [公開済み・PR #24](https://github.com/kubohiroya/turbowarp-jotai-adapter/pull/24) |
| P1 | turbowarp-diagnostic-overlay | [`show-and-clear-diagnostic.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-diagnostic-overlay%2Fsamples%2Fshow-and-clear-diagnostic.sb3) | `showDiagnostic`で1件表示し、キー操作で`clearDiagnosticOverlay`、可視状態を確認 | overlayの実行条件をREADMEへ記載。SVG生成だけの代替も検討 | [公開済み・PR #32](https://github.com/kubohiroya/turbowarp-diagnostic-overlay/pull/32) |
| P1 | turbowarp-svg-text | [`style-hello-text.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-svg-text%2Fsamples%2Fstyle-hello-text.sb3) | `defineStyle`・`setText`でスプライトを文字へ変更し、色とサイズを確認 | 表示対象の小さなスプライトを同梱 | [公開済み・PR #55](https://github.com/kubohiroya/turbowarp-svg-text/pull/55) |
| P1 | turbowarp-qr-display | [`show-and-hide-qr.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-qr-display%2Fsamples%2Fshow-and-hide-qr.sb3) | `showQrCodeWithin`で固定文字列のQRを表示し、`qrCodeSize`・`isShowingQrCode`を確認、キーで消す | カメラ不要。QRの中身も画面に併記 | [公開済み・PR #15](https://github.com/kubohiroya/turbowarp-qr-display/pull/15) |
| P1 | turbowarp-extended-notification | [`wait-for-notification.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-extended-notification%2Fsamples%2Fwait-for-notification.sb3) | 並行スクリプトで待ち受けを開始してから`sendNotification`し、受信結果を表示 | 通知前に待ち受けを登録し、再実行で古い待機を残さない | [公開済み・PR #44](https://github.com/kubohiroya/turbowarp-extended-notification/pull/44) |
| P1 | turbowarp-cloudflare-worker | [`generate-hello-worker.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-cloudflare-worker%2Fsamples%2Fgenerate-hello-worker.sb3) | `createHandlerIr`・`createWorkerIr`・`generateFilesJson`でGET /hello用ファイルを生成 | 出力までをデモ範囲とし、Cloudflareへのデプロイは行わない | [公開済み・PR #22](https://github.com/kubohiroya/turbowarp-cloudflare-worker/pull/22) |
| P2 | turbowarp-title-menu | [`choose-menu-action.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-title-menu%2Fsamples%2Fchoose-menu-action.sb3) | `addAppMenuAction`・`showMenu`と`whenAppMenuActionSelected`で選択した項目名を表示 | app-shellのホスト要件を確認。メニューを閉じて再表示できることを確認 | [公開済み・PR #19](https://github.com/kubohiroya/turbowarp-title-menu/pull/19) |
| P2 | turbowarp-named-data | [`registry-availability.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-named-data%2Fsamples%2Fregistry-availability.sb3) | `isRegistryAvailable`でレジストリ有効化を確認 | 現在は起動時固定のMVPフラグが必要で、OFF時はブロック自体が非表示。サンプル専用起動方式の設計が先 | [公開済み・PR #24](https://github.com/kubohiroya/turbowarp-named-data/pull/24) |
| P2 | turbowarp-react-islands | [`describe-counter-island.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-react-islands%2Fsamples%2Fdescribe-counter-island.sb3) | `registerComponent`・`reactIslandHtml`で固定propsを持つカウンターの宣言HTMLを表示 | クリックできる実画面はbundle／HTTPホストが必要。単独デモでは宣言生成まで | [公開済み・PR #19](https://github.com/kubohiroya/turbowarp-react-islands/pull/19) |
| P2 | turbowarp-bubble | [`say-and-close-bubble.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-bubble%2Fsamples%2Fsay-and-close-bubble.sb3) | `defineBubbleStyle`・`sayWithBubbleStyle`で1つの吹き出しを表示し、`closeBubble`で閉じる | svg-text等の実際の依存を確認し、必要な関連拡張だけ同梱 | [公開済み・PR #109](https://github.com/kubohiroya/turbowarp-bubble/pull/109) |
| P2 | turbowarp-asset-cache | [`show-cached-svg.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-asset-cache%2Fsamples%2Fshow-cached-svg.sb3) | `loadAsset`で自作SVGを登録し、`isLoaded`・`setThisSpriteSkin`で表示、削除後の状態を確認 | data URIで取得可能か確認。不可なら同一Pagesの小さなSVGを添付 | [公開済み・PR #29](https://github.com/kubohiroya/turbowarp-asset-cache/pull/29) |
| P2 | turbowarp-3d-scene-runtime | [`apply-one-cube-scene.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-3d-scene-runtime%2Fsamples%2Fapply-one-cube-scene.sb3) | `applyScene`へ固定YAMLを渡し、立方体1個と`sceneStatus`・`isSceneReady`を確認 | A-Frameの関連拡張が先。ARを含めず最小化 | [公開済み・PR #21](https://github.com/kubohiroya/turbowarp-3d-scene-runtime/pull/21) |
| P2 | turbowarp-aframe | [`move-one-cube.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-aframe%2Fsamples%2Fmove-one-cube.sb3) | `createScene`・`createNode`・`setPosition`で立方体を作り、キー操作で移動 | WebGL対応が必要。モデル・VRM・アニメーション資産を使わない | [公開済み・PR #35](https://github.com/kubohiroya/turbowarp-aframe/pull/35) |
| P2 | turbowarp-ar | [`manual-ar-target.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-ar%2Fsamples%2Fmanual-ar-target.sb3) | `createARScene`・`defineARTarget`・`setARTargetPosition`・`setARTargetVisible`で手動ターゲットを更新 | 自動カメラ認識があると誤認させない。描画に必要な関連拡張を明記 | [公開済み・PR #23](https://github.com/kubohiroya/turbowarp-ar/pull/23) |
| P2 | turbowarp-async-input | [`wait-for-space.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-async-input%2Fsamples%2Fwait-for-space.sb3) | `listenForKeyAndBroadcast`でSpaceを待ち、受信でカウンターを増やし、停止で解除 | タブにフォーカスが必要。再実行でも1キーにつき1回だけ反応 | [公開済み・PR #71](https://github.com/kubohiroya/turbowarp-async-input/pull/71) |
| P2 | turbowarp-realtime-motion-capture | [`pose-protocol-roundtrip.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-realtime-motion-capture%2Fsamples%2Fpose-protocol-roundtrip.sb3) | 固定の小さな姿勢JSONを`protocolJsonValid`・`decodeProtocolJson`・`encodeProtocolJson`で検証 | 最初の例はカメラ・WebGPU・複数端末を不要にする。実時推定は後続 | [公開済み・PR #55](https://github.com/kubohiroya/turbowarp-realtime-motion-capture/pull/55) |
| P2 | turbowarp-web-speech | [`speak-one-sentence.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-web-speech%2Fsamples%2Fspeak-one-sentence.sb3) | `isSynthesisSupported`を確認し、クリック後に`speakAndWait`で短文を発話 | 日本語のKyokoを指定しrate/pitchは1。開始クリック時のみ発話。自動検証では発話しない。音声一覧はOS・ブラウザに依存 | [公開済み・PR #13](https://github.com/kubohiroya/turbowarp-web-speech/pull/13) |
| P3 | turbowarp-camera-source | [`camera-preview-and-size.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-camera-source%2Fsamples%2Fcamera-preview-and-size.sb3) | 明示ボタンからカメラ開始、`showCameraPreview`と幅・高さを表示し、停止で解放 | HTTPS・カメラ権限・実機。拒否時は`cameraError`を表示 | [公開済み・PR #95](https://github.com/kubohiroya/turbowarp-camera-source/pull/95) |
| P3 | turbowarp-camera-calibration | [`capture-calibration-board.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-camera-calibration%2Fsamples%2Fcapture-calibration-board.sb3) | `startCameraCalibration`・`addCameraCalibrationSample`で印刷ボードを複数回撮影し、進捗と解法結果を表示 | camera-source・印刷用ボード・実機。必要枚数・品質基準を記載 | [公開済み・PR #61](https://github.com/kubohiroya/turbowarp-camera-calibration/pull/61) |
| P3 | turbowarp-teachable-machine | [`recognize-two-labels.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-teachable-machine%2Fsamples%2Frecognize-two-labels.sb3) | 自作の解析的Dark/Light明度モデルを`loadModel`し、明示開始後のラベルとscoreを表示 | 自作MPLモデルを同梱。Lはモデル読込のみ、Startはカメラ認識、Sで停止。一般画像分類の学習済みモデルではない | [公開済み・PR #127](https://github.com/kubohiroya/turbowarp-teachable-machine/pull/127) |
| P3 | turbowarp-time-space-sync | [`optical-pattern-observation.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-time-space-sync%2Fsamples%2Foptical-pattern-observation.sb3) | 明示同意後`acknowledgePatternFlashing`・`showTimePattern`、別画面のデコーダーで観測数を確認 | 表示側・撮影側の2端末とcamera-source。点滅への同意前には表示しない | [公開済み・PR #43](https://github.com/kubohiroya/turbowarp-time-space-sync/pull/43) |
| P3 | turbowarp-webrtc | [`two-tab-ping.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-webrtc%2Fsamples%2Ftwo-tab-ping.sb3) | タブ間でoffer／answerをコピーし、`sendEvent`と`nextMessage`でping/pongを表示 | 2タブ、同一LANから開始。ICE設定と接続失敗をREADMEへ記載 | [公開済み・PR #37](https://github.com/kubohiroya/turbowarp-webrtc/pull/37) |
| P3 | turbowarp-webrtc-qrcode-pairing | [`pair-two-devices.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-webrtc-qrcode-pairing%2Fsamples%2Fpair-two-devices.sb3) | offer／answer側を選び、QR分割片の読取で接続状態を表示 | WebRTC・カメラ／QR関連の能力が必要。2端末・欠片数・タイムアウトを表示 | [公開済み・PR #35](https://github.com/kubohiroya/turbowarp-webrtc-qrcode-pairing/pull/35) |
| P3 | turbowarp-http-server | [`respond-hello-http.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-http-server%2Fsamples%2Frespond-hello-http.sb3) | `currentRequestId`をポーリングし`respondWithText`でHelloを応答 | Node.js 24以上のCLI bridgeをloopbackで起動。既存request hatの制約をREADMEへ記載。Pages単独ではHTTP待受できない | [公開済み・PR #51](https://github.com/kubohiroya/turbowarp-http-server/pull/51) |
| P3 | turbowarp-openai-realtime-api | [`relay-text-reply.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-openai-realtime-api%2Fsamples%2Frelay-text-reply.sb3) | `configureRelay`・`pairRelay`後、明示操作で接続し`sendText`への応答を表示、終了時disconnect | relay・利用者のAPI設定が必要。キーはSB3に含めず、接続前にサービス利用条件を説明 | [公開済み・PR #11](https://github.com/kubohiroya/turbowarp-openai-realtime-api/pull/11) |
| P3 | turbowarp-voice-chat | [`one-turn-voice-chat.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-voice-chat%2Fsamples%2Fone-turn-voice-chat.sb3) | 利用者が開始操作し、1往復の発話と`aiReply`を表示して`endConversation` | relay・API設定・マイクが必要。初期設定の応答はテキストで自動読み上げなし。実サービスは未検証 | [公開済み・PR #11](https://github.com/kubohiroya/turbowarp-voice-chat/pull/11) |
| P3 | turbowarp-sesame | [`read-device-status.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-sesame%2Fsamples%2Fread-device-status.sb3) | relayのペアリング後に`getStatusField`で施錠状態・電池残量を表示 | 利用者自身の機器とrelayが必要。最小デモでは施錠・解錠コマンドを送らない | [公開済み・PR #28](https://github.com/kubohiroya/turbowarp-sesame/pull/28) |
| P3 | turbowarp-jsqr | [`read-one-qr.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-jsqr%2Fsamples%2Fread-one-qr.sb3) | `waitForQrTextSetRuntimeVar`で印刷した固定QRを読み、`lastQrTextReporter`を表示 | camera-sourceとカメラ権限。印刷可能なQR素材を同一Pagesへ添付 | [公開済み・PR #30](https://github.com/kubohiroya/turbowarp-jsqr/pull/30) |
| P3 | turbowarp-webusb-pasori | [`read-one-nfc-idm.sb3`](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-webusb-pasori%2Fsamples%2Fread-one-nfc-idm.sb3) | 明示クリックで`connectPasoriBlock`し、`waitForNfcIdmSetRuntimeVar`で自分のカードのIDmを表示 | WebUSB対応環境・PaSoRi・カード。配布SB3は空の初期値とし、読取値を保存しない | [公開済み・PR #22](https://github.com/kubohiroya/turbowarp-webusb-pasori/pull/22) |
| 保留 | turbowarp-photogrammetry | `hello-scaffold.sb3` → 将来`reconstruct-small-object.sb3` | 現在の実装は`hello`だけ。今は挨拶の動作確認と明記し、再構成デモは作成しない | 固定画像からの再構成ブロックと検証データの実装後に再計画 | 目的ブロック実装後に再計画 |
| 保留 | turbowarp-visual-tracking | `hello-scaffold.sb3` → 将来`track-one-marker.sb3` | 現在の実装は`hello`だけ。姿勢推定・追跡機能を実証したと表現しない | マーカー追跡ブロックの実装後、印刷マーカー＋カメラ1台の例を作成 | 目的ブロック実装後に再計画 |

## 公開後の確認範囲と未検証

P1・P2・P3の39件はいずれもPRをマージし、Pages配信後の実URLで読み込みを確認しました。
各READMEに操作・期待結果・必要権限・依存・終了方法を記載しています。
P3はコンパイラOFF/ON各2回、安全な初期状態・取消・未接続経路と、
SB3・JS・素材のHTTP200/CORS/配信バイト一致を確認しました。音声は出していません。

| 対象 | 確認済み | 要件と未検証範囲 |
|---|---|---|
| WebRTC | 同一ブラウザの実2EditorタブでDataChannel送受信・切断 | 実2端末、別ネットワーク、NAT/Firewall、長時間接続は未検証 |
| HTTP Server | 実CLI bridgeで未接続503→接続→200 Hello→切断 | Node.js 24以上。外部ホスト、TLS/wss、本番公開、各ブラウザのローカルネットワーク許可は未検証 |
| jsQR | 固定SVGを実decoderで復号 | 実カメラ・印刷物の読取と機器相性は未検証。待機の完全中断には再読み込みが必要 |
| Teachable Machine | 本物のruntimeでモデル読込、固定黒/白テンソルのDark/Light推論 | 実カメラ認識・照明条件の精度は未検証。Sでカメラ停止後にStop、またはタブを閉じる |
| Camera Source／Calibration | 未開始・停止・再実行、依存の読込、校正板の配信 | 実カメラ取得・権限拒否復旧・校正solve/精度は未検証。校正には印刷板と所定の枚数・品質条件が必要 |
| Time Space Sync／QR Pairing | 未開始・取消・再実行、起動フラグの復元 | 画面・カメラ付き2端末が必要。実画面点滅・光学読取・時刻精度・QR接続完了は未検証 |
| OpenAI Realtime API／Voice Chat | 未ペアリング・空設定時の拒否、停止・設定消去 | 利用者のrelay・API設定、Voice Chatはマイクが必要。実ペアリング・課金通信・会話は未検証。初期設定は音声出力なし |
| Sesame | 未ペアリング・空設定時の拒否、停止・設定消去 | 利用者の機器・keybroker・認証設定が必要。実APIと機器状態の取得は未検証。施錠・解錠はサンプル対象外 |
| WebUSB PaSoRi | 接続数0、未接続でのRead拒否、表示消去、再実行 | WebUSB対応環境・PaSoRi・カードが必要。USB選択・実読取・実機解放は未検証。Stopだけでは待機・USBを完全解放せず、タブを閉じる |

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
