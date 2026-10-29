# Twitch 遅延軽減の実現性調査

調査日: 2026-10-29（JST）。Windows Edge の DevTools に接続し、未ログインで
https://www.twitch.tv/stylishnoob4 のライブを観測した。チャンネルは調査時に
トップページでライブ中と確認したもの。単一チャンネル・短時間の結果であり、
他のチャンネルやブラウザーへの一般化は未検証。

## 結論

遅延とバッファの取得は可能。速度変更も可能だが、標準の追いつき制御に上書きされた。
YouTube版の制御ループをそのまま移植して成立するとはいえない。
追加調査でも、標準制御の速度・遅延上限を変更できたとは確認できなかった。
一方、追加の別方式として、バッファ内の前方シークで約25秒分の再生遅れを
一度に縮められることを実測した。自動追いつき拡張はまだ実装していない。

## 実プレイヤーで確認できたこと

video 要素から React Fiber の親をたどると、memoizedProps.mediaPlayerInstance が見つかる。
このオブジェクトには以下のメソッドがあった。

- getLiveLatency(): 配信者からの遅延（秒）
- getBufferDuration(): バッファ量（秒）
- getPlaybackRate(), setPlaybackRate(rate)
- getState(), isPaused(), isLiveLowLatency()
- setLiveSpeedUpRate(rate), setLiveMaxLatency(value), setRebufferToLive(value)

初回調査では後ろ3つは存在のみ確認。続く追加調査で setLiveSpeedUpRate と
setLiveMaxLatency を呼び出した結果は後述。setRebufferToLive は未検証。
いずれも通常の視聴ページにおける非公開実装であり、互換性保証はない。

低遅延モードは true。広告終了後に標準制御で約1.03倍の再生を観測した。
video.seekable は [0, 1073741824] で、末尾をライブ位置として使えなかった。
video.buffered は有限の範囲を返し、末尾と currentTime の差は内部のバッファ量と整合した。
ただしバッファ量と配信者からの総遅延は同一ではない。

## 速度変更実験

どちらも12秒間、2秒ごとに計測し、finally で変更前の再生速度に復元した。
広告ラベルが消え、ライブ映像が再生中の状態で実施。

| 操作 | 変更前の遅延 / バッファ | 速度の結果 | 12秒後の遅延 / バッファ |
| --- | --- | --- | --- |
| video.playbackRate = 1.1 | 5.768秒 / 5.499秒 | 2秒後には約1.03倍 | 5.446秒 / 5.007秒 |
| 内部プレイヤーの setPlaybackRate(1.1) | 5.171秒 / 4.809秒 | 直後は1.1倍、2秒後には約1.03倍 | 4.869秒 / 4.459秒 |

速度が戻る挙動は標準の追いつき制御との競合を示唆するが、書き戻し元のコードは追跡していない。
遅延の減少を今回の1.1倍指定の効果とは評価できない。
その後の読み取り専用測定では遅延約2.9〜3.1秒、バッファ約2.46秒、速度1.0倍となり、
標準制御が通常速度へ戻ることも確認した。

## 再測定

scripts/probe.js を Twitch のチャンネルページの DevTools コンソールに貼り付ける。

```js
twitchLatencyProbe.snapshot();
await twitchLatencyProbe.sample(15);
```

スクリプトは読み取り専用。通信・設定変更・自動再生速度変更はしない。
チャンネル移動やプレイヤー交換後は再実行する。
広告ラベル検出は補助情報であり、ラベルがないことだけで広告中でないとは判定できない。

検証: node --check scripts/probe.js に加え、上記の実プレイヤーでスクリプトを実行し、
遅延・バッファ・速度・再生状態を取得できることを確認した。

## 追加調査: 標準の追いつき制御の調整

同日の同じチャンネルで実施。各実験後にページを再読み込みし、プレイヤーを作り直した。
Cookie・localStorage・アカウント設定は変更していない。

### setLiveSpeedUpRate(1.1)

最初は6秒一時停止したが、復帰時に再生時間がリセットされ、バッファ約1.1秒の
ライブ位置へ戻った。遅れを作る手段として使えず、この試行だけでは効果判定できない。

次に、実際の buffered 内で video.currentTime を4秒戻して追いつき状態を作った。
変更前6秒間で標準の約1.03倍を確認してから setLiveSpeedUpRate(1.1) を1回呼んだ。
以後20秒間、全サンプルで約1.03倍のまま。遅延は5.565→4.940秒、
バッファは5.448→4.650秒。約1.03倍の挙動と整合し、1.1倍への調整効果は確認できない。

速度APIからの同期例外はなく、後の専用試行でも PlayerWorkerError は発生しなかった。
「受け付けたが無視された」「条件や単位が異なる」「別設定に上書きされた」などの
原因は区別できていない。メソッド名だけから契約を断定しない。

### setLiveMaxLatency(3)

呼び出し元には例外が戻らないが、PlayerWorkerError イベントを購読すると以下のエラーを取得した。

```text
Cannot call MediaPlayer.setLiveMaxLatency due to unbound types: N6twitch9MediaTimeE
```

このビルドでは必要な C++ の MediaTime 型のバインディングが未登録。
単に秒数を渡す方法は利用できなかった。呼び出しが返ることは成功を意味しない。
Worker の error イベントだけではこのエラーを捕捉できなかったため、
PlayerWorkerError の購読が必要だった。

### configManager の有効フラグ

内部 core.configManager.getConfigSnapshot().bufferControl に以下があった。

```json
{
  "liveCatchUpSpeedUpEnabled": true,
  "maxBufferSeconds": 30,
  "lowLatency": {"minBufferSeconds": 1, "rebufferPenaltySeconds": 1, "minBufferCeilingSeconds": 6},
  "normalLatency": {"minBufferSeconds": 2, "rebufferPenaltySeconds": 2, "minBufferCeilingSeconds": 10}
}
```

updateLoadConfig({bufferControl: {liveCatchUpSpeedUpEnabled: false}}) を実行すると
設定スナップショット上は false になった。しかし5秒間、約1.03倍のままだった。
その状態で setPlaybackRate(1.1) を呼んでも、続く8秒間すべて約1.03倍だった。
元の bufferControl を復元し、さらにページを再読み込みした。

読み込まれたプレイヤーのJavaScriptでは、設定変更時に
updatePlayerConfiguration メッセージをWorkerへ送る経路を確認できた。
ただし、このフラグの実行中の有効性までは確認できない。
初期ロード時のみ有効なのか、別の制御なのかも未確定。

### 測定データと再現用スクリプト

- [一時停止後の試行](measurements/pause-speed-up.json)（遅れの作成に失敗）
- [4秒戻した後の速度調整](measurements/rewind-speed-up.json)
- [有効フラグの変更](measurements/enabled-flag.json)
- [Workerエラーの確認](measurements/worker-errors.json)
- [保存した実験スクリプトでの再現](measurements/reproduction.json)

scripts/experiment-native-control.js をDevToolsに貼り付けると、以下を個別に実行できる。
これは設定変更を伴う実験用で、日常使用向けの拡張ではない。
実行後に結果を出力し、3秒後にページを再読み込みしてプレイヤーを復元する。
DevToolsのログ保持を有効にすると結果を確認しやすい。

```js
await twitchNativeControlExperiment.run({mode: "speedUp", rewindSeconds: 4});
// ページ再読み込み後、スクリプトを再度貼り付けて個別に実行
await twitchNativeControlExperiment.run({mode: "maxLatency"});
await twitchNativeControlExperiment.run({mode: "enabledFlag", rewindSeconds: 4});
```

保存したスクリプトの maxLatency モードも実プレイヤーで実行し、同じWorkerエラーを再現した。
構文チェックと git diff --check も通過。

有効フラグは取得した値を復元し、取得用APIがない設定は再読み込みで破棄する。
バッファ不足や広告ラベル出現時は中止するが、広告検出は完全ではない。
対象が変わると非公開APIの探索も失敗しうる。

## 今後の判断

標準制御の調整だけで改善できる、という実証には至らなかった。
この経路を続ける場合は初期ロード設定の反映条件と速度APIの意味の特定が必要。
複数チャンネル・画質変更・回線停止からの復帰は未検証。
現時点でこれらのメソッドを自動実行する常用拡張にはしない。

seekable.end() を使った自動シークは実装しない。
後述のバッファ内シークは、実際の buffered の範囲だけを使用する。

## 参考

- YouTube版: https://github.com/yudai-tiny-developer/live-catch-up/blob/main/inject.js
  - YouTube固有の統計・進行状態APIで判断し、video.playbackRate を変更する。
  - コードはコピーしていない。
- Twitch公式の低遅延説明: https://help.twitch.tv/s/article/low-latency-video?language=en_US
- Twitch埋め込みAPI: https://dev.twitch.tv/docs/embed/video-and-clips/
  - getPlaybackStats() の hlsLatencyBroadcaster / bufferSize を公開。
  - これは埋め込み用の公開APIであり、通常ページの内部APIとは区別する。
  - 同APIの playbackRate は速度倍率ではなくビットレートなので混同しない。


## 別方式: バッファ内を前方シークする

2026-10-29、同じ実プレイヤーで scripts/catch-up.js を検証した。
video.buffered のうち現在位置を含む連続範囲の末尾から2秒を残してシークする。
既に取得済みの映像を一部飛ばす方法であり、速度設定や非公開の遅延上限APIは変更しない。

### 実測

実際の buffered 内で25秒戻して遅れを作り、4秒後に測定した。
バッファ末尾まで27.039秒あり、2秒を残す位置へ25.039秒の前方シークを実行できた。
1秒後のバッファ量は2.035秒、速度は1.0倍。続く8秒間のサンプルもすべて
Playing / 1.0倍で、バッファ量は約2.0〜2.1秒だった。
配信者からの遅延表示はシーク後約2.2〜2.7秒。
[測定データ](measurements/buffer-jump.json)を参照。

ただし、25秒戻した4秒後でも getLiveLatency() は変更前の値を返した。
そのため、この試行を「遅延統計が27秒から2秒になった」とは表現しない。
内部の遅延統計だけを即時判定に使用するのも避ける。
映像時刻が約25秒先へ進み、バッファ末尾との差が縮まったことは確認できた。

### 手動で使用

scripts/catch-up.js を視聴ページのDevToolsへ貼り付けてから、以下を実行する。
スクリプトを貼り付けるだけでは再生位置は変更しない。

```js
twitchCatchUp.preview(); // 飛ばせる秒数・バッファ量を確認
twitchCatchUp.jump();    // 約2秒のバッファを残して前へ飛ぶ
```

1秒以上飛ばせる場合だけ実行する。一時停止・シーク中・VOD・広告ラベル表示中は
実行しない。バッファの不連続をまたがない。毎回プレイヤーを探索する。
広告ラベル検出と内部APIの互換性には従来と同じ限界がある。
スクリプトの構文チェックと、実ブラウザーでの前方シークを確認済み。

### 効果の範囲

視聴者側で再生が遅れ、映像が先まで届いている場合には、この方法が有効な候補。
一方、30秒遅延していてもバッファが2秒しかない場合は、受信前の遅延を
このシークで取り戻すことはできない。その状態でのプレイヤー再接続の効果は未検証。
また、手動で戻したケースの成功が、自然に発生する全遅延の改善を保証するものではない。
自動化する場合は、ユーザーの意図した巻き戻しと区別し、広告・停止・再接続も扱う必要がある。


## 明示的な追従ON/OFFの試作

manifest.json と extension/content.js を追加。Chrome / Edge向けのManifest V3拡張として
読み込める構成とした。初期OFF、ページのパスが変わるとOFF、設定は永続化しない。
ONでは毎秒確認し、現在の連続バッファ内で5秒以上先へ飛べる場合に2秒を残してシークする。
シーク間隔は最低5秒。手動の巻き戻しを推測して自動OFFにする処理は入れない。

UIはTwitchの player-controls__right-control-group 内に挿入し、設定アイコンの左に配置。
独立した映像上のパネルは置かない。状態の補足はツールチップと読み上げ用テキストにする。

既存Edge DevTools接続（127.0.0.1:9222）から同じスクリプトを実ライブへ注入して確認。
OFFで20秒戻すとバッファ約22.16秒を維持、ONへ切り替えると約2.10秒へ短縮。
再度OFFで6秒戻すと約8.18秒を維持した。[測定値](measurements/toggle.json)。
標準コントローラー表示時にはボタンが同じバーに並び、マウスを映像外へ移動して
4.5秒後には標準コントローラーと共通の祖先が opacity:0 となることを確認。
スクリーンショットでも、表示時の配置と非表示時にボタンが残らないことを確認した。
拡張としてのインストール経路は未検証。

追加で、ON中に8秒戻しても定期処理でバッファ約2.21秒へ戻ること、
標準の一時停止操作中はONのまま待機して再生位置が動かないこと、
history.replaceStateでパス変更を模擬するとOFFに戻ることを確認した。
実際のチャンネル間ナビゲーションはこの追加チェックでは行っていない。
[追加測定値](measurements/toggle-lifecycle.json)。


## 拡張設定によるデフォルトON/OFF

拡張のオプション画面に「デフォルトでON（追従）」を追加。
chrome.storage.local に保存し、未設定時はOFF。
ページ初回・パス変更時に初期値を使用する。視聴中の設定編集は次のページから適用し、
手動で変更した追従状態を上書きしない。

ストレージへのアクセスはISOLATED側の settings-bridge.js に限定し、
MAIN側へは初期値の真偽値だけを渡す。初期読み込み前に仮のOFFを通知しない。
読み込み中に保存値が変更された場合、古い読み込み結果を破棄する。

Nodeの5テストで読み込み競合・初期通知・ON/OFF保存・保存失敗・読み込み失敗を確認。
保存APIはモック。実ページ上では設定メッセージを使い、初期ON、手動OFFの維持、
パス変更を模擬した際の初期値再適用を確認した。
[測定結果](measurements/default-settings.json)。
設定画面から実ストレージ経由で届く一連の拡張動作は未検証。


## 日本語・英語表示

Chrome i18nの _locales/ja と _locales/en にUI文言を定義した。
設定画面と拡張メタデータはブラウザーの表示言語を使い、未対応言語は英語へフォールバック。
MAIN側のプレイヤー表示にはISOLATED側から翻訳済み文字列を渡す。
受信前の短い期間は英語表示。Twitch側の表示言語とは独立している。

既存の設定テストに英語表示・保存通知と両カタログの整合性確認を追加し、7件通過。
Edgeの既存視聴ページで翻訳文字列の受信を検証し、日本語・英語のボタンとツールチップの
DOM出力を確認した。ブラウザー言語の変更と拡張としての再読み込みを通した一連の検証は未実施。


## ストア提出準備での実インストール検証

2026-10-29、検証用Edgeへ Extensions.loadUnpacked で実際に読み込んだ。
設定画面のチェック操作で chrome.storage.local へ保存され、設定ページ再読み込み後も復元。
新しいTwitchページで初期ON、設定を変更しても現在のON/OFFを維持、
Twitchページ再読み込みで新しい初期値を反映することを確認した。
実験で変更した設定は元に戻し、実験用タブは閉じた。
[検証結果](measurements/installed-extension.json)。

ランタイムのみの再現可能な提出ZIP、16/32/48/128pxアイコン、実際の設定画面とプレイヤーの
スクリーンショット、掲載文とポリシー案を追加。ストアへのアップロードや公開はしていない。


## プライバシーポリシー公開

kyoh86.devリポジトリに既存のArticleLayoutを使った日英MDXページを追加。
ビルド成功、ローカルのEdgeで英語セクションへの移動と表示幅を確認。
コミット7aa048cをmainへpushし、Cloudflare Pagesのデプロイ成功を確認。
https://kyoh86.dev/twitch-latency-mitigator/privacy/ がHTTP 200を返し、
日本語・英語の本文を含むことを確認した。ストア提出資料のURLも同じ値へ更新。


## Chrome ウェブストア審査提出

2026-10-29、登録済みの開発者アカウントで0.1.0を審査提出。
拡張ID: kdleejjbfihefcckhcblndelkiilchmb。
日英の説明、全言語共通のスクリーンショット2枚、アイコン、権限の理由、
公開済みポリシーURL、審査用手順を登録した。英語・日本語の説明は保存後に確認。
無料・一般公開・全地域。審査承認後に自動公開する設定。
データ申告は現在のTwitchパスの参照とプレイヤー状態の参照に対応し、
ウェブ履歴・ウェブサイトのコンテンツを選択。端末内処理のみで開発者へは送信しない。

送信後の管理画面で「審査待ち」と送信完了メッセージを確認した。
公開・審査承認を意味するものではない。
[提出記録](measurements/store-submission.json)。
