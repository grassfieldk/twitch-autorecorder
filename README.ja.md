# Twitch Autorecorder

Twitch 配信を自動監視・録画するツールです

## 使い方

1. `.env.example` を `.env` にコピーして編集
2. 依存パッケージのインストール:
   ```bash
   npm install
   ```
3. 録画開始:
   ```bash
   npm start -- <twitch_username>
   ```

## ログファイル

- `logs/{username}_watch_yyyymmdd.log` — メインイベントログ（日毎に分割）
- `logs/{username}_download_yyyymmdd_hhmm.log` — FFmpeg ダウンロードログ

## ライセンス

MIT
