# 依存の更新と配布方式の判断

更新は依存先から利用側への深さ優先・後行順で進める。通常依存とlockだけでなく、peer、Git固定、ビルド用ソース参照も確認する。共通の依存先は一度だけ扱う。

## 現行GUIとの互換性

現行GUIのReact 16互換を維持する。新しいメジャー版があるという理由だけでpeerの範囲を広げない。対応確認前の範囲拡張は、インストールできても実行時には動かない状態を作る。

| 対象 | 維持する契約と理由 |
| --- | --- |
| scratch-gui・Desktop | GUIが使うReact 16とReact DOM 16を維持する。アプリをReact 19へ移す作業は今回の互換更新に含めない。 |
| extension-data-editor | React 16対応のRJSF 5を維持する。RJSF 6はReact 18未満を公式サポート外としている。AJV・URIなどは現行契約の検証を通したものを更新する。 |
| editor-project-folder・editor-git | 公開peer契約のReact 16.14〜18を維持する。19への対応は別途検証してから範囲を変更する。 |
| scratch-vm・scratch-render・scratch-audio | 上流TurboWarpの依存構成とGUIでの利用契約を維持する。個々のnpmメジャー更新を独立適用せず、VM・描画・音声とGUIの統合検証を前提にする。 |

外部依存の警告は隠さない。ここで理由を示した固定と、更新の取り残しを区別して判断する。更新可能な依存は上流から検証し、再現性・API・対応環境を維持できたものだけを公開する。

RJSFの根拠: [公式6.x移行ガイド](https://rjsf-team.github.io/react-jsonschema-form/docs/migration-guides/v6.x%20upgrade%20guide/)。現在の判断と検証記録は [Issue #130](https://github.com/kubohiroya/turbowarp-plus-packages/issues/130) に残す。

## フォークの先行数

フォークの上流由来タグからのコミット数は、独自変更の未公開件数を意味しない。フォークは現在の上流default branchとの先行・遅れを別に表示する。上流の取得に失敗したときも、古いタグの数値へ置き換えない。

npmパッケージの公開タグと、EditorがビルドするGitソースの固定SHAは別の契約である。Git固定は利用側のビルドでSHAを照合し、公開した配布物の生成元を確認する。

## npmの公開状態

- npmの版がGitHubのタグより新しい場合は、npm側provenanceのpackage名・版・integrity・repository・workflow・commitを照合する。正しい公開元が分かってから登録を修正し、既存npm版を再公開しない。
- タグがnpmより新しい場合は、CI・公開失敗の有無・未使用の版を確認してから再開する。タグを移動して整合したことにはしない。
- npm対象外には、英日で具体的な理由を設定する。デスクトップのインストーラー、Webサイト、文書、SB3配布、Gitソースという別の配布方式を、npmの非公開ライブラリと混同しない。
- 再利用するlibraryやCLIは、npm配布の内容・実行入口・検証・公開契約を用意する。単にprivateをfalseへ変えるだけでは完了しない。

## バージョン比較の注意

外部パッケージには、`4.12.0-release.1`のような名前を正式な配布物に使うものがある。指定範囲で選ばれる版が比較対象のstable版より新しい場合、古いstable版への変更を「更新」として案内しない。さらに新しいstable版が公開された場合は通常の範囲判定を行う。

## 切戻し

公開前の差分はrevertできる。公開済みnpm版・タグは移動・削除・上書きせず、別番号で修正する。GUI基盤の移行時は互換性・回帰・切戻しを先に文書化する。
