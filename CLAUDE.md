# ピアノ練習プレーヤー（楽譜 → 練習用画面）

ピアノ初心者（本人）が、手持ちの楽譜を「鍵盤が光る・楽譜とリズムが見える・音が鳴る」練習画面にして使う、自分専用の Web アプリ。
iPhone の Safari で開き、「ホーム画面に追加」して使う。App Store には出さず、他人にも配布しない。

## 全体の流れ

1. 楽譜を iPhone の「書類をスキャン」で撮る（PDF）
2. Windows PC の **Audiveris** で MusicXML に変換する
3. **MuseScore** で読み取りミスを人が直す（アプリ側に修正画面は作らない）
4. iPhone のアプリで、そのファイルを選んで読み込む（端末内に保存）

アプリが担うのは「曲データを読み込んで、練習画面に表示・再生する」ところだけ。

## 著作権・プライバシー（重要）

- 楽譜は市販品。**曲データ（MusicXML・写真・PDF・曲 JSON）はリポジトリにコミットしない。**
- 公開リポジトリ（GitHub Pages）にはプレーヤーのコードだけを置く。
- 曲データとその元になったファイルは `private/` に置く（`.gitignore` で除外済み）。テスト用の曲は、自作の短いものだけを `tests/fixtures/` に置く。アプリに入れる「お試しの曲」（`samples/`）も自作のものだけ。

## UI について本人が決めたこと（変えないこと）

- 選択中のボタンは「塗りつぶし＋✓」。上部に「選択中：…」の要約を出す。
- 片手を選んだら、もう片方の鍵盤・楽譜・リズム図は**非表示**（薄くせず消す）。
- 起動時は最初のセクションの1小節目、再生は「最初から全曲」が初期選択。
- 大きさは数値（％）で調整し、初期値はすべて 50。
- 文言は**やさしい日本語**（音名はドレミ、指番号は 1〜5）。
- 使い方ボタン（モーダル）とバージョン表示＋変更履歴（`src/version.js` の `CHANGELOG`）を置く。
- ファイル名・URL にバージョンは入れない（ホーム画面のアイコンが古い版を開かないように、URL は固定）。
- 鍵盤は1枚の SVG に描く（両手のときは上下2段）。

## 進め方の決まり

- 本人は音楽理論に詳しくない。**音楽の細かい仕様は一般的なやり方に沿って Claude が決めてよい。**
  使い勝手やシステムに関わることは、本人に聞いてから決める。
- 大きめの変更の前は、設計の曖昧な点を本人に質問して詰めてから実装する。

## 構成

ビルドなしの素の ES modules。外部ライブラリなし。型は JSDoc で書く。

```
index.html  styles.css
manifest.webmanifest   ホーム画面に追加したときの名前・全画面表示・アイコン
icons/        アイコン PNG（tools/make-icons.mjs で作る。手で描かない）
samples/      お試しの曲（自作）。曲ファイルがなくても動きを試せる
src/
  version.js    VERSION と CHANGELOG
  pitch.js      音名 ⇔ MIDI、ドレミ名、五線上の位置、臨時記号
  song.js       曲 JSON の検査と正規化（エラーはやさしい日本語）
  timeline.js   リピート展開、テンポ表、フェルマータ、ms の予定表
  keyboard.js / score.js / rhythm.js   鍵盤・楽譜・リズム図の SVG
  audio.js      三角波の音、クリック、iPhone 対策（音の有効化・マナーモード）
  player.js     再生ループ
  storage.js    最後に開いた曲を IndexedDB に保存
  ui.js  main.js
tests/          node:test。fixtures/ は自作の短い曲だけ
tools/
  serve.mjs        ローカル確認用サーバー（依存なし）
  make-icons.mjs   アイコン PNG を作る（依存なし）
  v07-extract.mjs  v0.7.0 の HTML からデータ部分を取り出す
  convert-v07.mjs  v0.7.0 → 曲 JSON 変換
private/        （git 管理外）v0.7.0 の HTML、元の引き継ぎメモ、曲 JSON
```

## コマンド

- テスト：`node --test`
- ローカル確認：`node tools/serve.mjs` → http://localhost:8080/
- v0.7.0 → JSON 変換：`node tools/convert-v07.mjs`（`private/songs/jiyuu-e-no-tobira.json` を書き出す）
- アイコンを作り直す：`node tools/make-icons.mjs`（`icons/` に PNG を書き出す）

## 曲データ形式（JSON, formatVersion 1）

時間は整数 tick（**4分音符 = 480**）。音の高さは表記つき音名（`"Bb4"` `"C#5"`、オクターブは C4 = 真ん中のド）。

```jsonc
{
  "format": "piano-practice-song", "formatVersion": 1,
  "title": "曲名", "ticksPerQuarter": 480,
  "display": { "rhRange": ["A3","F5"], "lhRange": ["C2","D4"] },   // 任意。鍵盤の表示範囲
  "sections": [{ "name": "イントロ", "from": 1, "to": 8 }],         // 小節番号で指定
  "measures": [{
    "number": 1,
    "time": [4,4], "key": -1, "tempo": 108,   // 変わる小節にだけ書く（key は ♭ならマイナス、♯ならプラスの数）
    "repeatStart": true, "repeatEnd": true, "ending": [1],   // リピート・番号かっこ
    "chords": [{ "t": 0, "name": "C" }],      // コード名（表示用）
    "memo": "小節のヒント", "warn": "確認メモ",   // 任意
    "rh": [ /* 右手のイベント */ ], "lh": [ /* 左手のイベント */ ]
  }]
}
```

イベント：`{ "t": 小節内の開始tick, "d": 長さtick, "notes": [{ "p": "F4", "f": 1, "tie": "start"|"stop"|"continue" }], "ly": ["1番","2番"], "fermata": true }`

- タイの続き（`stop`/`continue`）は弾き直さない。鳴らす長さはタイでつながった分を足す。
- フェルマータは、その音がかかっている区間の時間を2倍にのばす（両手とも）。
- 演奏順はリピート記号からプレーヤーが計算し、何回目の通りかで歌詞の番を選ぶ。
- 臨時記号は、調号と違う音に毎回付ける（初心者向け）。

## フェーズ

- **フェーズ1（v0.8.0）**：曲データとプレーヤーの分離。曲ファイルを開く・最後の曲を覚える。お試しの曲。ホーム画面用のアイコンと全画面表示（manifest）。GitHub Pages で公開し、iPhone で試す。
- **フェーズ2**：MusicXML（`.musicxml` / `.mxl`）→ 曲 JSON 変換。staff 1 → 右手、staff 2 → 左手。divisions → tick、chord、tie、lyric、3連符、repeat/ending、tempo、fermata、fingering。4/4 以外の拍子。鍵盤の表示範囲を曲の音域から自動で決める。
- **フェーズ3**：オフライン対応（Service Worker）、曲一覧（IndexedDB）、練習していた小節・設定の復元。
- **フェーズ4（任意）**：音色の改善（サンプル音源）、指番号の簡易自動割り当て。

## 未決事項

- 練習中の iPhone の置き方（縦／横、譜面台に置いたときの操作）→ iPhone で試したあとに相談する。
- MusicXML の曲に「小節ヒント」を自動で付けるか → フェーズ2で相談する。
