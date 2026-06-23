// Location ドメインロジックのプロパティベーステスト（fast-check）
//
// 設計書 Correctness Properties のうち、本ファイルは以下を検証する。
// - Property 1: スポット入場判定の正当性（resolveSpotPresence） … Req 1.2, 1.3, 1.4, 1.5
// - Property 2: スポット半径定義の制約（createSpotManager の Entry_Radius 検証） … Req 1.8
//
// 既存の spotManager.test.ts は構造検証の具体例テストを担うため、ここでは
// プロパティ（不変条件）の検証に専念する。各テストは最低 100 回反復する。

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  ACCURACY_THRESHOLD_METERS,
  resolveSpotPresence,
} from './location';
import {
  ENTRY_RADIUS_MAX_METERS,
  ENTRY_RADIUS_MIN_METERS,
  createSpotManager,
} from './spotManager';
import type { Position, Region, RewardGrant, Spot } from './types';

// ---------------------------------------------------------------------------
// テスト内の独立リファレンス実装
// （実装 location.ts とは別に書き起こし、結果を突き合わせる）
// ---------------------------------------------------------------------------

const EARTH_RADIUS_METERS = 6_371_000;
const noReward: RewardGrant = { coins: 0, experience: 0, items: [] };

/** 度 → ラジアン変換（リファレンス用） */
function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Haversine 距離（メートル）の独立リファレンス実装 */
function referenceHaversine(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  return EARTH_RADIUS_METERS * c;
}

/**
 * 入場判定の独立リファレンス。
 * 精度しきい値超は null、Entry_Radius 内が無ければ null、複数該当時は
 * 中心が最も近いスポット（同距離は入力順で先勝ち）の id を返す。
 */
function referenceResolve(position: Position, spots: Spot[]): string | null {
  if (position.accuracyMeters > ACCURACY_THRESHOLD_METERS) {
    return null;
  }
  let bestId: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const spot of spots) {
    const distance = referenceHaversine(position, spot.center);
    if (distance > spot.entryRadiusMeters) {
      continue;
    }
    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = spot.id;
    }
  }
  return bestId;
}

// ---------------------------------------------------------------------------
// 補助: 緯度経度オフセット計算（スポットを位置の周辺に配置する）
// ---------------------------------------------------------------------------

/** 原点から指定距離・方位に置いた座標を近似的に求める（半径内/外を混在させるため） */
function offsetLatLng(
  origin: { lat: number; lng: number },
  distanceMeters: number,
  bearingRad: number
): { lat: number; lng: number } {
  const metersPerDegLat = 111_320;
  const dLat = (distanceMeters * Math.cos(bearingRad)) / metersPerDegLat;
  const cosLat = Math.cos(toRadians(origin.lat));
  const safeCosLat = Math.abs(cosLat) < 1e-6 ? 1e-6 : cosLat;
  const dLng = (distanceMeters * Math.sin(bearingRad)) / (metersPerDegLat * safeCosLat);
  return { lat: origin.lat + dLat, lng: origin.lng + dLng };
}

function makeSpot(id: string, center: { lat: number; lng: number }, entryRadiusMeters: number): Spot {
  return {
    id,
    name: `spot-${id}`,
    description: `説明 ${id}`,
    center,
    entryRadiusMeters,
    regionId: 'r1',
    firstVisitReward: noReward,
  };
}

function makeRegion(id: string, predecessorId: string | null): Region {
  return {
    id,
    name: `region-${id}`,
    predecessorId,
    unlockCondition: { kind: 'stampCount', requiredCount: 1 },
  };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

// 精度: しきい値 50m を境界として両側を確実に含める
const arbAccuracy = fc.oneof(
  fc.double({ min: 0, max: 100, noNaN: true }),
  fc.constant(ACCURACY_THRESHOLD_METERS), // ちょうど 50m（許容側の境界）
  fc.constant(ACCURACY_THRESHOLD_METERS + 0.001) // 50m 超（破棄側の境界）
);

const arbPosition: fc.Arbitrary<Position> = fc.record({
  // 極付近は経度変換が不安定になるため緯度を制限する
  lat: fc.double({ min: -80, max: 80, noNaN: true }),
  lng: fc.double({ min: -179, max: 179, noNaN: true }),
  accuracyMeters: arbAccuracy,
  timestamp: fc.integer({ min: 0, max: 2_000_000_000_000 }),
});

/** 指定位置の周辺に配置したスポットの Arbitrary（半径内/外が混在するよう距離を振る） */
function arbSpotNear(position: { lat: number; lng: number }): fc.Arbitrary<Spot> {
  return fc
    .record({
      id: fc.string({ minLength: 1, maxLength: 8 }),
      entryRadiusMeters: fc.double({ min: 20, max: 200, noNaN: true }),
      offsetMeters: fc.double({ min: 0, max: 400, noNaN: true }),
      bearingRad: fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
    })
    .map(({ id, entryRadiusMeters, offsetMeters, bearingRad }) =>
      makeSpot(id, offsetLatLng(position, offsetMeters, bearingRad), entryRadiusMeters)
    );
}

const arbPositionAndSpots = arbPosition.chain((position) =>
  fc.array(arbSpotNear(position), { maxLength: 6 }).map((spots) => ({ position, spots }))
);

// ---------------------------------------------------------------------------
// Property 1
// ---------------------------------------------------------------------------

describe('Property 1: スポット入場判定の正当性', () => {
  // Feature: ehime-location-rpg, Property 1: 水平精度が 50m より悪い位置では現在スポットを null とし、精度が 50m 以内の位置では Entry_Radius 内にスポットが存在しなければ null、存在すれば中心座標が最も近いスポットのみを現在スポットとして返す。
  // Validates: Requirements 1.2, 1.3, 1.4, 1.5
  it('独立リファレンスと一致する（精度破棄・半径内判定・最近接選択）', () => {
    fc.assert(
      fc.property(arbPositionAndSpots, ({ position, spots }) => {
        const actual = resolveSpotPresence(position, spots).spotId;
        const expected = referenceResolve(position, spots);
        expect(actual).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: ehime-location-rpg, Property 1: 水平精度が 50m より悪い位置では現在スポットを null とし、精度が 50m 以内の位置では Entry_Radius 内にスポットが存在しなければ null、存在すれば中心座標が最も近いスポットのみを現在スポットとして返す。
  // Validates: Requirements 1.2
  it('精度が 50m を超える位置では常に null を返す（Req 1.2）', () => {
    const arbBadAccuracyCase = arbPosition.chain((p) =>
      fc.array(arbSpotNear(p), { maxLength: 6 }).map((spots) => ({
        position: { ...p, accuracyMeters: ACCURACY_THRESHOLD_METERS + 0.001 },
        spots,
      }))
    );
    fc.assert(
      fc.property(arbBadAccuracyCase, ({ position, spots }) => {
        expect(resolveSpotPresence(position, spots).spotId).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  // Feature: ehime-location-rpg, Property 1: 水平精度が 50m より悪い位置では現在スポットを null とし、精度が 50m 以内の位置では Entry_Radius 内にスポットが存在しなければ null、存在すれば中心座標が最も近いスポットのみを現在スポットとして返す。
  // Validates: Requirements 1.3, 1.4, 1.5
  it('返されたスポットは Entry_Radius 内かつ全候補の最近接である（Req 1.3, 1.4, 1.5）', () => {
    const arbGoodAccuracyCase = arbPosition.chain((p) =>
      fc
        .record({
          accuracyMeters: fc.double({ min: 0, max: 50, noNaN: true }),
          spots: fc.array(arbSpotNear(p), { maxLength: 6 }),
        })
        .map(({ accuracyMeters, spots }) => ({
          position: { ...p, accuracyMeters },
          spots,
        }))
    );
    fc.assert(
      fc.property(arbGoodAccuracyCase, ({ position, spots }) => {
        const resultId = resolveSpotPresence(position, spots).spotId;
        const inRadius = spots.filter(
          (s) => referenceHaversine(position, s.center) <= s.entryRadiusMeters
        );
        if (inRadius.length === 0) {
          // 半径内が無ければ null（Req 1.5）
          expect(resultId).toBeNull();
          return;
        }
        // null でなく、半径内スポットのいずれかであること（Req 1.3）
        expect(resultId).not.toBeNull();
        const chosen = spots.find((s) => s.id === resultId);
        expect(chosen).toBeDefined();
        const chosenDistance = referenceHaversine(position, chosen!.center);
        expect(chosenDistance).toBeLessThanOrEqual(chosen!.entryRadiusMeters);
        // 選ばれたスポットは半径内候補の中で最小距離である（Req 1.4）
        const minDistance = Math.min(
          ...inRadius.map((s) => referenceHaversine(position, s.center))
        );
        expect(chosenDistance).toBeLessThanOrEqual(minDistance + 1e-9);
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2
// ---------------------------------------------------------------------------

describe('Property 2: スポット半径定義の制約', () => {
  // 半径を [20,200] の内外にわたって広く振る Arbitrary
  const arbRadius = fc.oneof(
    fc.double({ min: 0, max: 300, noNaN: true }),
    fc.constant(ENTRY_RADIUS_MIN_METERS), // 20（境界・許容）
    fc.constant(ENTRY_RADIUS_MAX_METERS), // 200（境界・許容）
    fc.constant(ENTRY_RADIUS_MIN_METERS - 0.001), // 19.999（境界・拒否）
    fc.constant(ENTRY_RADIUS_MAX_METERS + 0.001), // 200.001（境界・拒否）
    fc.double({ min: -1000, max: 0, noNaN: true })
  );

  // Feature: ehime-location-rpg, Property 2: 有効な Spot 定義について、その Entry_Radius は 20m 以上 200m 以下である（範囲外は検証で拒否される）。
  // Validates: Requirements 1.8
  it('Entry_Radius が [20,200] のときのみ受理され、範囲外は invalidEntryRadius で拒否される', () => {
    const region = makeRegion('r1', null);
    fc.assert(
      fc.property(arbRadius, (radius) => {
        const result = createSpotManager([makeSpot('s1', { lat: 33.8, lng: 132.7 }, radius)], [region]);
        const inRange =
          radius >= ENTRY_RADIUS_MIN_METERS && radius <= ENTRY_RADIUS_MAX_METERS;
        expect(result.ok).toBe(inRange);
        if (!result.ok) {
          expect(result.error.kind).toBe('invalidEntryRadius');
        }
      }),
      { numRuns: 100 }
    );
  });
});
