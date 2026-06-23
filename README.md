# 愛媛ロケーションRPG (Ehime Location RPG)

愛媛県内の実在する観光スポットを実際に訪れることでゲームが進行する、モバイルファーストの React Web アプリケーションです。

## 技術スタック

- **フロントエンド**: React 18 + TypeScript + Vite（モバイルファースト）
- **テスト**: Vitest + fast-check（プロパティベーステストは最低100回反復）
- **デプロイ**: Vercel
- **バックエンド**: AWS ホストのデータバックエンド（`User_Data_Store`）

## セットアップ

```bash
npm install
```

## スクリプト

| コマンド | 説明 |
| --- | --- |
| `npm run dev` | 開発サーバーを起動（モバイル端末からアクセス可: `host: true`） |
| `npm run build` | 型チェック + 本番ビルド（`dist/` 出力） |
| `npm run preview` | ビルド成果物のプレビュー |
| `npm run test` | テストを1回実行（Vitest） |
| `npm run test:watch` | テストをウォッチモードで実行 |
| `npm run typecheck` | 型チェックのみ |

## ディレクトリ構成

```
src/
  domain/      純粋なドメインロジック層（副作用なし）
  repository/  User_Data_Store クライアント・永続化シリアライズ
  services/    外部サービス連携（Geolocation など）
  state/       状態管理層（セッション状態・楽観的更新・再試行キュー）
  ui/          UI 層（header/main/footer レイアウトと各ビュー）
  test/        テストセットアップと共有テストユーティリティ
```

## プロパティベーステスト

各プロパティテストは fast-check を用い、最低100回反復します（`src/test/setup.ts` で `numRuns: 100` をグローバル設定）。
タグ形式: `Feature: ehime-location-rpg, Property {number}: {property_text}`
