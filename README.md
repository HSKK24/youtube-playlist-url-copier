# YouTube Playlist URL Copier

YouTubeプレイリストから動画のタイトルとURLを一括取得・コピーできるChrome拡張機能です。

## 特徴

- **YouTube Data API 不要** — YouTube の内部データ（`ytInitialData` + continuation token）を解析して取得
- **大規模プレイリスト対応** — 通常のスクレイピングでは100件程度が限界だが、内部APIのページネーションでループ取得することで2,000件以上に対応
- **柔軟な選択・コピー** — 全選択・範囲指定・個別選択に対応。URLのみ / タイトル+URLの2形式でコピー可能
- **ローカル完結・データ保存なし** — 外部サーバーへの送信なし、ユーザーデータの保存なし

## 動作環境

- Google Chrome（Manifest V3）

## インストール

1. このリポジトリをクローンまたはZIPでダウンロード
2. Chrome で `chrome://extensions/` を開く
3. 右上の「デベロッパーモード」をオン
4. 「パッケージ化されていない拡張機能を読み込む」をクリック
5. ダウンロードしたフォルダを選択

## 使い方

1. YouTubeのプレイリストページのURLをコピー
2. 拡張機能のアイコンをクリックしてポップアップを開く
3. URLを貼り付けて「動画を取得」をクリック
4. 取得された動画を選択してコピー

## 取得アーキテクチャ

```
プレイリストURL入力
    ↓
HTMLフェッチ → ytInitialData 抽出（初回100件）
    ↓
continuation token 取得
    ↓
YouTube 内部API（/youtubei/v1/browse）に POST × N回
    ↓
token が null になるまでループ取得
    ↓
動画リスト表示
```

## パフォーマンス目安

| 動画数 | 取得時間 |
|--------|---------|
| 100件 | 約1秒 |
| 500件 | 約3秒 |
| 1,000件 | 約5秒 |
| 2,000件 | 約8秒 |

## 技術スタック

| 技術 | 用途 |
|------|------|
| Chrome Extension Manifest V3 | 拡張機能基盤 |
| `declarativeNetRequest` | YouTube CORS制限の回避 |
| `ytInitialData` 解析 | 初回動画リストの取得 |
| YouTube 内部API（`/youtubei/v1/browse`） | continuation による全件取得 |
| `navigator.clipboard` | クリップボードへのコピー |

## プライバシーについて

リクエストはユーザー自身の YouTube セッション（ログインクッキー）を使って実行されます。取得した動画情報は外部サーバーへ一切送信されず、ローカルのメモリ上でのみ処理されます。

## 注意事項

- YouTube の内部API仕様が変更された場合、動作しなくなる可能性があります
- 本ツールは個人利用・学習目的で開発しています。YouTube 利用規約を遵守した範囲でご使用ください

## License

MIT
