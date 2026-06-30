// 敵ごとのバトル表示調整（画像の余白差による見かけサイズ・位置のばらつきを補正）。
//
// 透過PNGの余白量・キャラ位置が画像ごとに違うため、倍率・縦横オフセットで
// 見た目（頭が中央・足が地面）を揃える。offsetX 正=右、offsetY 正=下。

interface BossDisplay {
  /** 敵スプライトの表示倍率（既定 1）。 */
  scale?: number;
  /** 下方向への移動量（px。正で下、負で上）。 */
  offsetY?: number;
  /** 横方向への移動量（px。正で右、負で左）。 */
  offsetX?: number;
}

/** 全敵共通の基本オフセット（道後本館以外は少し左上に寄せて頭を中央へ）。 */
const DEFAULT_OFFSET_Y = 18;
const DEFAULT_OFFSET_X = -22;

const DISPLAY: Record<string, BossDisplay> = {
  // 道後温泉本館の主は拡大＋やや下げ。横はずらさない。
  'midboss-spot-dogo-honkan': { scale: 1.3, offsetY: 48, offsetX: 0 },
};

/** 指定ボスの敵スプライト表示倍率を返す（既定 1）。 */
export function bossDisplayScale(bossId: string): number {
  return DISPLAY[bossId]?.scale ?? 1;
}

/** 指定ボスの敵スプライト下方向オフセット（px）を返す。 */
export function bossDisplayOffsetY(bossId: string): number {
  return DISPLAY[bossId]?.offsetY ?? DEFAULT_OFFSET_Y;
}

/** 指定ボスの敵スプライト横方向オフセット（px）を返す。 */
export function bossDisplayOffsetX(bossId: string): number {
  return DISPLAY[bossId]?.offsetX ?? DEFAULT_OFFSET_X;
}
