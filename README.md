# first-note

音源ファイルから短い区間を選び、その区間の代表ピッチを推定して基準音として再生できるWebアプリです。

楽器や歌のキー合わせ、フレーズ単位の音程確認に使うことを想定しています。

https://github.com/maru-k-lab/first-note

## 機能

- 音声ファイルの読み込み
- 波形上での解析区間選択
- 選択区間の自動ループ再生
- 代表ピッチの推定
- 基準音の再生
- マイク入力による一致度確認
- モバイル対応

## Privacy

音声ファイルはWeb Audio APIを使ってブラウザ内で処理します。選択したファイルをサーバーへアップロードしません。

マイク入力はチューナー表示中のみ使用します。ブラウザの許可が必要で、マイク機能は `localhost` または HTTPS でのみ利用できます。

## 対応ファイル

- mp3
- wav
- m4a
- ogg

動画ファイルは公開版では未対応です。動画からの音声抽出は将来の改善項目です。

## 技術スタック

- Vite
- TypeScript
- Tailwind CSS
- Web Audio API
- Cloudflare Pages

## 開発

```bash
npm install
npm run dev
```

## ビルド

```bash
npm run build
```

本番配信用ファイルは `dist/` に生成されます。

## ソースコード

https://github.com/maru-k-lab/first-note

## ライセンス

本プロジェクトは `pitchfinder` を使用しているため、GPL-3.0-only としてソースコードを公開しています。

詳細は [LICENSE](./LICENSE) と各依存パッケージのライセンスを参照してください。

主な実行時依存:

- `pitchfinder`: GPL v3
- `pitchy`: MIT
