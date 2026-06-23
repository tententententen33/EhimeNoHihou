// Title_System のプロパティベーステスト（fast-check, 各 100 回反復）
//
// 設計書「Correctness Properties」の Property 31（称号付与の冪等性）を検証する。
// grantIfEarned は (state, title) のみに依存する自己完結した純粋関数であり、
// 「達成条件を満たし未付与なら 1 つだけ付与」「既付与なら再付与せず称号集合不変」
// という冪等性を持つ（Req 11.2, 11.3）。

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { grantIfEarned } from './title';
import { createInitialPlayerState } from './types';
import type {
  PlayerState,
  Stamp,
  TitleCondition,
  TitleDefinition,
} from './types';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// 参照実装（達成条件の充足判定）
//
// title.ts の内部判定（isConditionSatisfied）と同じ意味論を独立に再現し、
// テスト側で「条件が充足されているはずか」を判断するための真値とする。
// 対象集合が空の場合は未達（false）扱いとする。
// ---------------------------------------------------------------------------

function referenceSatisfied(
  state: PlayerState,
  condition: TitleCondition
): boolean {
  switch (condition.kind) {
    case 'allSpotsVisitedInRegion': {
      if (condition.spotIds.length === 0) return false;
      const visited = new Set(state.stamps.map((s) => s.spotId));
      return condition.spotIds.every((id) => visited.has(id));
    }
    case 'allBossesDefeatedInRegion': {
      if (condition.bossIds.length === 0) return false;
      const defeated = new Set(state.defeatedBossIds);
      return condition.bossIds.every((id) => defeated.has(id));
    }
  }
}

// ---------------------------------------------------------------------------
// fast-check ジェネレータ（任意入力空間の構築）
// ---------------------------------------------------------------------------

// 共有 id プール。条件が参照する id とプレイヤー保持 id を重複させ、
// 「充足／未充足」の双方が十分な頻度で発生するように設計する。
const spotIdArb = fc.constantFrom(
  'spot-a',
  'spot-b',
  'spot-c',
  'spot-d',
  'spot-e'
);
const bossIdArb = fc.constantFrom('boss-1', 'boss-2', 'boss-3', 'boss-4');
const titleIdArb = fc.constantFrom('title-x', 'title-y', 'title-z');

const stampArb: fc.Arbitrary<Stamp> = spotIdArb.map((spotId) => ({
  spotId,
  earnedAt: '2024-01-01T00:00:00.000Z',
}));

/** 称号の達成条件（2 種いずれか）。対象集合は空を含み得る（未達ケースの網羅）。 */
const titleConditionArb: fc.Arbitrary<TitleCondition> = fc.oneof(
  fc.record({
    kind: fc.constant<'allSpotsVisitedInRegion'>('allSpotsVisitedInRegion'),
    regionId: fc.constantFrom('region-1', 'region-2'),
    spotIds: fc.uniqueArray(spotIdArb, { maxLength: 5 }),
  }),
  fc.record({
    kind: fc.constant<'allBossesDefeatedInRegion'>('allBossesDefeatedInRegion'),
    regionId: fc.constantFrom('region-1', 'region-2'),
    bossIds: fc.uniqueArray(bossIdArb, { maxLength: 4 }),
  })
);

/** 称号定義ジェネレータ（ちょうど 1 つの達成条件を持つ, Req 11.1）。 */
const titleDefinitionArb: fc.Arbitrary<TitleDefinition> = fc.record({
  id: titleIdArb,
  name: fc.constant('称号'),
  description: fc.constant('説明'),
  condition: titleConditionArb,
});

/**
 * PlayerState ジェネレータ。
 * grantIfEarned が参照するフィールド（stamps/defeatedBossIds/titleIds）と、
 * 設問で指定された ownedItemIds を任意に変化させ、その他は妥当な既定値を用いる。
 */
const playerStateArb: fc.Arbitrary<PlayerState> = fc
  .record({
    stamps: fc.array(stampArb, { maxLength: 6 }),
    defeatedBossIds: fc.uniqueArray(bossIdArb, { maxLength: 4 }),
    ownedItemIds: fc.uniqueArray(fc.string(), { maxLength: 4 }),
    titleIds: fc.uniqueArray(titleIdArb, { maxLength: 3 }),
  })
  .map(({ stamps, defeatedBossIds, ownedItemIds, titleIds }) => ({
    ...createInitialPlayerState('player-1', 'region-1'),
    stamps,
    defeatedBossIds,
    ownedItemIds,
    titleIds,
  }));

// ---------------------------------------------------------------------------
// Property 31: 称号付与の冪等性（Validates: Requirements 11.2, 11.3）
// ---------------------------------------------------------------------------

describe('Property 31: 称号付与の冪等性', () => {
  // Feature: ehime-location-rpg, Property 31: 称号付与の冪等性。任意のプレイヤー状態と
  // 称号定義について、達成条件を満たし未付与なら称号 id がちょうど 1 つ付与され
  // （granted: true, Req 11.2）、既に付与済みなら再付与されず titleIds は一切変化しない
  // （granted: false, Req 11.3）。さらに付与を 1 回適用しても複数回適用しても、最終的な
  // titleIds は等しい（grant-once == grant-many）。

  it('未付与の称号: 充足なら 1 つ付与、未充足なら不変。再適用は冪等', () => {
    fc.assert(
      fc.property(playerStateArb, titleDefinitionArb, (baseState, title) => {
        // 確実に「未付与」状態から開始する。
        const state: PlayerState = {
          ...baseState,
          titleIds: baseState.titleIds.filter((id) => id !== title.id),
        };
        const satisfied = referenceSatisfied(state, title.condition);

        // 1 回目の付与適用。
        const first = grantIfEarned(state, title);

        if (satisfied) {
          // 充足 + 未付与 -> ちょうど 1 つ付与される（Req 11.2）。
          expect(first.granted).toBe(true);
          expect(first.nextState.titleIds).toContain(title.id);
          expect(
            first.nextState.titleIds.filter((id) => id === title.id)
          ).toHaveLength(1);
          // 既存の称号集合は保持され、追加は title.id のみ。
          expect(first.nextState.titleIds).toEqual([
            ...state.titleIds,
            title.id,
          ]);
        } else {
          // 未充足 -> 付与されず状態不変（Req 11.2 の対偶）。
          expect(first.granted).toBe(false);
          expect(first.nextState).toBe(state);
          expect(first.nextState.titleIds).toEqual(state.titleIds);
        }

        // 入力状態は破壊されない（純粋）。
        expect(state.titleIds).not.toContain(title.id);

        // grant-once == grant-many: さらに複数回再適用しても titleIds は不変。
        let cur = first;
        for (let i = 0; i < 4; i++) {
          const again = grantIfEarned(cur.nextState, title);
          // 1 回目で付与済みであれば以降は再付与されない（Req 11.3）。
          if (cur.granted || cur.nextState.titleIds.includes(title.id)) {
            expect(again.granted).toBe(false);
          }
          expect(again.nextState.titleIds).toEqual(cur.nextState.titleIds);
          cur = again;
        }

        // 最終 titleIds は 1 回適用の結果と一致する（冪等性）。
        expect(cur.nextState.titleIds).toEqual(first.nextState.titleIds);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('既付与の称号: 充足の有無にかかわらず再付与されず titleIds は不変（Req 11.3）', () => {
    fc.assert(
      fc.property(playerStateArb, titleDefinitionArb, (baseState, title) => {
        // 確実に「既付与」状態を構成する。
        const titleIds = baseState.titleIds.includes(title.id)
          ? baseState.titleIds
          : [...baseState.titleIds, title.id];
        const state: PlayerState = { ...baseState, titleIds };

        const result = grantIfEarned(state, title);

        // 既付与なので再付与されず、称号集合は完全に不変（同一参照を据え置く）。
        expect(result.granted).toBe(false);
        expect(result.nextState).toBe(state);
        expect(result.nextState.titleIds).toEqual(state.titleIds);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
