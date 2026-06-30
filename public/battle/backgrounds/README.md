# バトル背景画像の配置

各ボスの背景画像を **ボスID をファイル名にした PNG** で置きます。

- パス: `public/battle/backgrounds/<bossId>.png`
- 表示: `object-fit: cover`（エリア全体を覆う）
- 無い場合: 緑グリッドにフォールバック

例:
- `public/battle/backgrounds/midboss-spot-dogo-honkan.png`
- `public/battle/backgrounds/boss-region-imabari.png`

ボスID の一覧は `../bosses/README.md` の対応表を参照してください（敵キャラ画像と同じファイル名規則）。
