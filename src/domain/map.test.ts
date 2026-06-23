// Map_System のプロパティベーステスト（fast-check, 各 100 回反復）
//
// 設計書「Correctness Properties」の Property 3・4・5・28・29・30 を検証する。
// 各テストには対象プロパティとプロパティ本文をタグコメントとして付与する。
//
// 対象（src/domain/map.ts, src/domain/spotManager.ts, src/domain/types.ts）:
// - getVisibleMarkers / getSpotDetail / isSpotUnlocked（Req 2.2, 2.3, 2.4, 2.5）
// - canUnlockNext / unlockRegion / isUnlockConditionSatisfied（Req 10.3, 10.7）
// - createSpotManager().getUnlockOrder（Req 10.1）
// - createInitialPlayerState（Req 10.2）

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  canUnlockNext,
  getSpotDetail,
  getVisibleMarkers,
  isSpotUnlocked,
  unlockRegion,
  type RegionUnlockContext,
} from './map';
import { createSpotManager } from './spotManager';
import { createInitialPlayerState } from './types';
import type { PlayerState, Region, Spot, UnlockCondition } from './types';

/** すべてのプロパティで共通の反復回数（設計書: 最低 100 回） */
const NUM_RUNS = 100;

// ===========================================================================
// fast-check ジェネレータ（任意入力空間の構築）
// ===========================================================================

/**
 * 妥当な地域チェイン（全順序の単一の鎖）を生成する。
 * region-0 は predecessorId が null、region-i (i>0) は region-(i-1) を直前に持つ。
 * 解放条件は bossDefeated（boss-<regionId>）とし、撃破済みボスで充足を直接制御できる。
 */
function regionChainArb(minLen = 1, maxLen = 6): fc.Arbitrary<Region[]> {
  return fc.integer({ min: minLen, max: maxLen }).map((n) =>
    Array.from({ length: n }, (_unused, i): Region => {
      const id = `region-${i}`;
      const condition: UnlockCondition = {
        kind: 'bossDefeated',
        bossId: `boss-${id}`,
      };
      return {
        id,
        name: `地域-${i}`,
        predecessorId: i === 0 ? null : `region-${i - 1}`,
        unlockCondition: condition,
      };
    })
  );
}

/**
 * 指定地域 id 集合に属するスポット配列を生成する。
 * スポット id は `spot-<index>` で一意。entryRadiusMeters は 20〜200m に収める。
 */
function spotsArb(regionIds: string[]): fc.Arbitrary<Spot[]> {
  return fc
    .array(
      fc.record({
        regionId: fc.constantFrom(...regionIds),
        entryRadiusMeters: fc.integer({ min: 20, max: 200 }),
        lat: fc.double({ min: -90, max: 90, noNaN: true }),
        lng: fc.double({ min: -180, max: 180, noNaN: true }),
        coins: fc.nat({ max: 1000 }),
        experience: fc.nat({ max: 1000 }),
        items: fc.array(fc.string(), { maxLength: 3 }),
      }),
      { minLength: 0, maxLength: 12 }
    )
    .map((seeds) =>
      seeds.map(
        (s, i): Spot => ({
          id: `spot-${i}`,
          name: `スポット-${i}`,
          description: `説明-${i}`,
          center: { lat: s.lat, lng: s.lng },
          entryRadiusMeters: s.entryRadiusMeters,
          regionId: s.regionId,
          firstVisitReward: { coins: s.coins, experience: s.experience, items: s.items },
        })
      )
    );
}

/** 配列が空でも安全に部分集合（順序保存）を生成する。 */
function safeSubarrayArb<T>(items: T[]): fc.Arbitrary<T[]> {
  return items.length > 0 ? fc.subarray(items) : fc.constant([] as T[]);
}

/**
 * Map_System のマーカー／詳細プロパティ用シナリオ。
 * 地域チェイン・スポット集合・解放済み地域の部分集合・訪問済みスポットの部分集合を生成する。
 */
const mapScenarioArb = regionChainArb(1, 5).chain((regions) => {
  const regionIds = regions.map((r) => r.id);
  return spotsArb(regionIds).chain((spots) => {
    const spotIds = spots.map((s) => s.id);
    return fc.record({
      regions: fc.constant(regions),
      spots: fc.constant(spots),
      unlockedRegionIds: safeSubarrayArb(regionIds),
      visitedSpotIds: safeSubarrayArb(spotIds),
    });
  });
});

/** 訪問済みスポット id 集合からスタンプ付き PlayerState を構築する。 */
function makeState(unlockedRegionIds: string[], visitedSpotIds: string[]): PlayerState {
  const firstRegion = unlockedRegionIds[0] ?? 'region-0';
  return {
    ...createInitialPlayerState('player-1', firstRegion),
    unlockedRegionIds,
    stamps: visitedSpotIds.map((spotId) => ({
      spotId,
      earnedAt: '2024-01-01T00:00:00.000Z',
    })),
  };
}

/** 秘匿対象（名前・説明・報酬・訪問状態）のキー名。ロック詳細に現れてはならない。 */
const SECRET_KEYS = ['name', 'description', 'reward', 'visitStatus', 'firstVisitReward'];

// ===========================================================================
// Property 3: 解放スポットのマーカー対応（Validates: Requirements 2.2）
// ===========================================================================

describe('Property 3: 解放スポットのマーカー対応', () => {
  // Feature: ehime-location-rpg, Property 3: 任意のプレイヤー状態とスポット集合について、
  // Map_System が返すマーカー集合は、解放済み Region 内かつ解放済みのスポットの集合と
  // 正確に一致する。
  it('getVisibleMarkers は解放済み Region のスポットと正確に一致し、すべて解放済みマーカーである', () => {
    fc.assert(
      fc.property(mapScenarioArb, ({ spots, unlockedRegionIds, visitedSpotIds }) => {
        const state = makeState(unlockedRegionIds, visitedSpotIds);
        const markers = getVisibleMarkers(state, spots);

        // 期待集合: regionId が解放済みのスポットちょうど一致
        const expectedIds = spots
          .filter((s) => unlockedRegionIds.includes(s.regionId))
          .map((s) => s.id)
          .sort();
        const actualIds = markers.map((m) => m.spotId).sort();
        expect(actualIds).toEqual(expectedIds);

        // すべて解放済みマーカー（locked:false）で、座標がスポットと一致する
        for (const marker of markers) {
          expect(marker.locked).toBe(false);
          const spot = spots.find((s) => s.id === marker.spotId);
          expect(spot).toBeDefined();
          expect(marker.position).toEqual({ lat: spot!.center.lat, lng: spot!.center.lng });
          // 対応スポットは確かに解放済み Region に属する
          expect(isSpotUnlocked(state, spot!)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

// ===========================================================================
// Property 4: ロックスポットの情報秘匿（Validates: Requirements 2.3, 2.5）
// ===========================================================================

describe('Property 4: ロックスポットの情報秘匿', () => {
  // Feature: ehime-location-rpg, Property 4: 任意のロック状態のスポットについて、
  // そのマーカーおよび選択時ペイロードは名前・説明・報酬の詳細をいずれも含まない。
  it('ロックスポットの詳細とマーカーは名前・説明・報酬を一切含まない', () => {
    fc.assert(
      fc.property(mapScenarioArb, ({ spots, unlockedRegionIds, visitedSpotIds }) => {
        const state = makeState(unlockedRegionIds, visitedSpotIds);
        const lockedSpots = spots.filter((s) => !unlockedRegionIds.includes(s.regionId));

        for (const spot of lockedSpots) {
          // ロック判定
          expect(isSpotUnlocked(state, spot)).toBe(false);

          // 選択時ペイロードは locked:true で、秘匿対象のキーを一切持たない
          const detail = getSpotDetail(state, spot);
          expect(detail.locked).toBe(true);
          expect(detail.spotId).toBe(spot.id);
          const detailKeys = Object.keys(detail);
          for (const secret of SECRET_KEYS) {
            expect(detailKeys).not.toContain(secret);
          }
          // ペイロードのキーは id と locked のみ
          expect(detailKeys.sort()).toEqual(['locked', 'spotId']);
        }

        // 可視マーカー集合にはロックスポットが一切含まれない（マーカー側でも秘匿）
        const visibleIds = new Set(getVisibleMarkers(state, spots).map((m) => m.spotId));
        for (const spot of lockedSpots) {
          expect(visibleIds.has(spot.id)).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

// ===========================================================================
// Property 5: 解放スポット詳細の表示内容（Validates: Requirements 2.4）
// ===========================================================================

describe('Property 5: 解放スポット詳細の表示内容', () => {
  // Feature: ehime-location-rpg, Property 5: 任意の解放済みスポットについて、選択時の
  // 詳細ペイロードは名前・説明・訪問状態（"visited" または "not visited"）を含み、
  // 訪問状態はプレイヤーのスタンプ有無と一致する。
  it('解放済みスポットの詳細は名前・説明を含み、訪問状態がスタンプ有無と一致する', () => {
    fc.assert(
      fc.property(mapScenarioArb, ({ spots, unlockedRegionIds, visitedSpotIds }) => {
        const state = makeState(unlockedRegionIds, visitedSpotIds);
        const visitedSet = new Set(visitedSpotIds);
        const unlockedSpots = spots.filter((s) => unlockedRegionIds.includes(s.regionId));

        for (const spot of unlockedSpots) {
          const detail = getSpotDetail(state, spot);
          expect(detail.locked).toBe(false);
          if (detail.locked) continue; // 型の絞り込み（到達しない）

          expect(detail.spotId).toBe(spot.id);
          expect(detail.name).toBe(spot.name);
          expect(detail.description).toBe(spot.description);

          // 訪問状態はスタンプ有無と一致する
          const expectedStatus = visitedSet.has(spot.id) ? 'visited' : 'not visited';
          expect(detail.visitStatus).toBe(expectedStatus);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

// ===========================================================================
// Property 28: 地域アンロック順序の構造不変条件（Validates: Requirements 10.1）
// ===========================================================================

describe('Property 28: 地域アンロック順序の構造不変条件', () => {
  // Feature: ehime-location-rpg, Property 28: 任意の地域構成について、アンロック順序は
  // 全順序（単一の鎖）であり、最初の Region を除く各 Region はちょうど1つの直前 Region を
  // 持ち、循環を含まない。
  it('妥当な地域チェインから導出される順序は単一の全順序（循環なし）である', () => {
    fc.assert(
      fc.property(
        regionChainArb(1, 8),
        // 定義順がチェイン順と異なっても正しい全順序を導出することを確認するため並べ替える
        fc.integer({ min: 0, max: 1_000_000 }),
        (regions, seed) => {
          // 配列順をシャッフルして渡す（順序は predecessor 連鎖から導出されるべき）
          const shuffled = shuffleWithSeed(regions, seed);
          const result = createSpotManager([], shuffled);
          expect(result.ok).toBe(true);
          if (!result.ok) return;

          const order = result.value.getUnlockOrder();
          const regionById = new Map(regions.map((r) => [r.id, r]));

          // 全 Region を過不足なく含む（単一の鎖）
          expect(order.length).toBe(regions.length);

          // id に重複がない（循環していれば長さ不一致または重複が生じる）
          expect(new Set(order).size).toBe(order.length);

          // 先頭は predecessorId が null
          expect(regionById.get(order[0])!.predecessorId).toBeNull();

          // 先頭以外は直前 Region をちょうど 1 つ持ち、それが順序上の直前要素に一致する
          for (let i = 1; i < order.length; i++) {
            const region = regionById.get(order[i])!;
            expect(region.predecessorId).toBe(order[i - 1]);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

/** seed に基づく決定的シャッフル（Fisher-Yates, 線形合同法の擬似乱数）。 */
function shuffleWithSeed<T>(items: T[], seed: number): T[] {
  const arr = [...items];
  let state = (seed % 2147483647) + 1;
  const next = (): number => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ===========================================================================
// Property 29: 新規アカウントの初期アンロック（Validates: Requirements 10.2）
// ===========================================================================

describe('Property 29: 新規アカウントの初期アンロック', () => {
  // Feature: ehime-location-rpg, Property 29: 任意の地域構成について、新規作成された
  // プレイヤー状態ではアンロック順序の最初の Region のみが解放済みで、他のすべての
  // Region はロック状態である。
  it('createInitialPlayerState は最初の Region のみ解放し、他はすべてロック状態にする', () => {
    fc.assert(
      fc.property(regionChainArb(1, 8), (regions) => {
        const manager = createSpotManager([], regions);
        expect(manager.ok).toBe(true);
        if (!manager.ok) return;

        const order = manager.value.getUnlockOrder();
        const firstRegionId = order[0];

        const state = createInitialPlayerState('player-1', firstRegionId);

        // 解放済み地域は最初の 1 つのみ
        expect(state.unlockedRegionIds).toEqual([firstRegionId]);

        // 他のすべての Region はロック状態（その Region のスポットは未解放）
        for (const region of regions) {
          const probeSpot: Spot = {
            id: `probe-${region.id}`,
            name: 'probe',
            description: 'probe',
            center: { lat: 0, lng: 0 },
            entryRadiusMeters: 50,
            regionId: region.id,
            firstVisitReward: { coins: 0, experience: 0, items: [] },
          };
          const unlocked = isSpotUnlocked(state, probeSpot);
          expect(unlocked).toBe(region.id === firstRegionId);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

// ===========================================================================
// Property 30: アンロックの単調性とロック地域の侵入不可
//   （Validates: Requirements 10.3, 10.7）
// ===========================================================================

/** bossDefeated 条件のみのため、条件評価コンテキストは空で十分。 */
const EMPTY_CONTEXT: RegionUnlockContext = { spotIdsByRegion: {} };

describe('Property 30: アンロックの単調性とロック地域の侵入不可', () => {
  // Feature: ehime-location-rpg, Property 30: 任意のプレイヤー状態について、次のロック
  // Region の解放条件を満たすとき unlockRegion はアンロック順序上の次の Region をちょうど
  // 1つ解放し、解放条件が未達の Region はロック状態のまま侵入不可である。
  const scenarioArb = regionChainArb(1, 6).chain((regions) => {
    const order = regions.map((r) => r.id);
    return fc.record({
      regions: fc.constant(regions),
      order: fc.constant(order),
      // 解放済みプレフィックス数（先頭は常に解放: 1 以上）
      unlockedCount: fc.integer({ min: 1, max: order.length }),
      // 次のロック Region の条件を満たすか
      nextSatisfied: fc.boolean(),
      // 順序を飛ばさないことの検証用: 次より後ろの Region 条件も満たしておく
      defeatLater: fc.boolean(),
    });
  });

  it('条件充足時のみ次の Region をちょうど 1 つ解放し、未達 Region はロック維持・順序を飛ばさない', () => {
    fc.assert(
      fc.property(
        scenarioArb,
        ({ regions, order, unlockedCount, nextSatisfied, defeatLater }) => {
          const n = order.length;
          const unlockedRegionIds = order.slice(0, unlockedCount);
          const hasNext = unlockedCount < n;
          const nextId = hasNext ? order[unlockedCount] : undefined;

          // 撃破済みボスで条件充足を直接制御する（条件は boss-<regionId>）
          const defeatedBossIds: string[] = [];
          if (nextId !== undefined && nextSatisfied) {
            defeatedBossIds.push(`boss-${nextId}`);
          }
          if (defeatLater && unlockedCount + 1 < n) {
            for (const id of order.slice(unlockedCount + 1)) {
              defeatedBossIds.push(`boss-${id}`);
            }
          }

          const state: PlayerState = {
            ...createInitialPlayerState('player-1', order[0]),
            unlockedRegionIds,
            defeatedBossIds,
          };

          const result = canUnlockNext(state, regions, order, EMPTY_CONTEXT);

          if (!hasNext) {
            // すべて解放済み: 解放対象は存在しない
            expect(result.regionId).toBeNull();
            return;
          }

          if (nextSatisfied) {
            // 条件充足: アンロック順序上の次の Region ちょうど 1 つを解放可能
            expect(result.regionId).toBe(nextId);

            const after = unlockRegion(state, result.regionId!);
            // ちょうど 1 つだけ追加される（順序上の次の Region）
            expect(after.unlockedRegionIds).toEqual(order.slice(0, unlockedCount + 1));
            // 後続の条件を満たしていても先に解放されない（順序を飛ばさない）
            for (const id of order.slice(unlockedCount + 1)) {
              expect(after.unlockedRegionIds).not.toContain(id);
            }
            // 入力状態は破壊的に変更されない（純粋性）
            expect(state.unlockedRegionIds).toEqual(unlockedRegionIds);
          } else {
            // 条件未達: 解放可能な Region は無く、次の Region はロック状態のまま
            expect(result.regionId).toBeNull();
            expect(state.unlockedRegionIds).not.toContain(nextId);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
