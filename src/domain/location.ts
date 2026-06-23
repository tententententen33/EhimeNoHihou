// Location ドメインロジック（スポット入場判定）
//
// 本ファイルは設計書「Components and Interfaces / Location_Service」の
// 純粋関数 `resolveSpotPresence` を実装する。副作用（I/O・Geolocation 取得）は
// 持たず、与えられた位置とスポット集合のみから入場スポットを決定する。
//
// 検証対象の要求:
// - Req 1.2: 水平精度が 50m より悪い位置は破棄し、いずれのスポットにも入場しない
// - Req 1.3: ちょうど 1 つのスポットの Entry_Radius 内なら、そのスポットに入場
// - Req 1.4: 複数スポットの Entry_Radius 内なら、中心が最も近いスポットのみに入場
// - Req 1.5: いずれの Entry_Radius にも入らない場合は現在スポットなし（null）

import type { Position, Spot } from './types';

/** 入場判定の精度しきい値（メートル）。これより悪い精度の位置は破棄する（Req 1.2） */
export const ACCURACY_THRESHOLD_METERS = 50;

/** 地球の平均半径（メートル）。Haversine 距離計算に用いる */
const EARTH_RADIUS_METERS = 6_371_000;

/**
 * スポット入場判定の結果。
 * `spotId` は現在いるスポットの識別子。いずれのスポットにもいなければ null（Req 1.5）。
 *
 * 注: 設計書の `SpotPresenceResult` に対応する。`types.ts` には未定義のため
 * 本モジュールで定義・公開する。
 */
export interface SpotPresenceResult {
  /** 現在いるスポット。なければ null（Req 1.5） */
  spotId: string | null;
}

/** 度をラジアンへ変換する */
function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * 2 つの緯度経度間の大円距離（メートル）を Haversine 公式で求める。
 * 最近接スポットの選択（Req 1.4）に用いるため、正確な距離を返す。
 */
export function haversineDistanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinHalfDLat = Math.sin(dLat / 2);
  const sinHalfDLng = Math.sin(dLng / 2);

  const h =
    sinHalfDLat * sinHalfDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinHalfDLng * sinHalfDLng;

  // 数値誤差で h がわずかに 1 を超えても asin 定義域に収める
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  return EARTH_RADIUS_METERS * c;
}

/**
 * プレイヤー位置とスポット集合から、現在いるスポットを判定する純粋関数。
 *
 * 判定規則（Req 1.2〜1.5）:
 * 1. 位置の水平精度が 50m より悪い場合は破棄し、`spotId` を null とする（Req 1.2）。
 * 2. 精度が 50m 以内の場合、各スポット中心までの距離を求め、その距離が
 *    当該スポットの `entryRadiusMeters` 以内であるスポット（候補）を集める。
 * 3. 候補が無ければ `spotId` を null とする（Req 1.5）。
 * 4. 候補が複数ある場合は、中心が最も近いスポットのみを返す（Req 1.4）。
 *    距離が同値の場合は入力順で先に現れたスポットを優先する（決定的挙動）。
 *
 * @param position プレイヤーの現在位置
 * @param spots 判定対象の全スポット
 * @returns 現在いるスポットを表す `SpotPresenceResult`
 */
export function resolveSpotPresence(
  position: Position,
  spots: Spot[]
): SpotPresenceResult {
  // Req 1.2: 精度 50m 超は破棄
  if (position.accuracyMeters > ACCURACY_THRESHOLD_METERS) {
    return { spotId: null };
  }

  let nearestSpotId: string | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const spot of spots) {
    const distance = haversineDistanceMeters(position, spot.center);

    // Entry_Radius 内のスポットのみ候補とする（Req 1.3, 1.5）
    if (distance > spot.entryRadiusMeters) {
      continue;
    }

    // 中心が最も近い候補を選ぶ（Req 1.4）。
    // 厳密な不等号により、同距離の場合は先に現れたスポットを優先する。
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestSpotId = spot.id;
    }
  }

  return { spotId: nearestSpotId };
}
