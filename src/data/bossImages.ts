// ボスごとのバトル用画像（敵キャラ・背景）の解決。
//
// 構成方針（敵は1枚絵・パーツ分割なし）:
// - 敵キャラ画像: public/battle/bosses/<bossId>.png（透過PNG・文字なし推奨）
// - 背景画像:     public/battle/backgrounds/<bossId>.png（無ければ緑グリッドにフォールバック）
// - プレイヤー:   public/battle/soul.png（無ければ赤ハートにフォールバック）
//
// いずれも存在しない場合は BattleView 側で onError によりフォールバック表示する。

/** Vite の base を考慮した public 配下のパスを返す。 */
function publicPath(rel: string): string {
  const base = import.meta.env.BASE_URL ?? '/';
  return `${base}${rel}`;
}

/** 敵キャラクター画像（1枚絵）の URL。ファイル名は `<bossId>-chara.png`。 */
export function enemyImageUrl(bossId: string): string {
  return publicPath(`battle/bosses/${bossId}-chara.png`);
}

/** バトル背景画像の URL。ファイル名は `<bossId>-bagground.png`。 */
export function backgroundImageUrl(bossId: string): string {
  return publicPath(`battle/backgrounds/${bossId}-bagground.png`);
}

/** ソウル（プレイヤー）の向き。 */
export type SoulFacing = 'down' | 'up' | 'left' | 'right';

/**
 * プレイヤー（ソウル）画像の URL。男の子キャラの 4 方向。
 * ファイル名: public/battle/soul/boy-<down|up|left|right>.png
 * - down: 正面（手前向き） / up: 背面 / left: 左向き / right: 右向き
 */
export function soulImageUrl(facing: SoulFacing = 'down'): string {
  return publicPath(`battle/soul/boy-${facing}.png`);
}

/** 攻撃オブジェクト（弾）画像の URL。ファイル名: public/battle/bullets/<name>.png */
export function bulletImageUrl(name: string): string {
  return publicPath(`battle/bullets/${name}.png`);
}
