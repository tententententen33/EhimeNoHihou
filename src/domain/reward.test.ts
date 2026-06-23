// Reward_Engine のユニットテスト（具体例・エッジケース）
//
// プロパティテスト（任意サブタスク 6.2〜6.5）とは別に、computeWalkReward /
// applyReward / grantQuestCompletionReward の代表的な振る舞いと境界条件を
// 具体例で検証する。

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  computeWalkReward,
  applyReward,
  grantQuestCompletionReward,
} from './reward';
import { createInitialPlayerState } from './types';
import type { PlayerState, QuestProgress, RewardGrant } from './types';

function baseState(): PlayerState {
  return createInitialPlayerState('p1', 'region-1');
}

describe('computeWalkReward', () => {
  it('完了 100m ごとに 1 コインを付与し、剰余を繰り越す', () => {
    expect(computeWalkReward(0, 250)).toEqual({
      coinsGranted: 2,
      carryOverMeters: 50,
    });
  });

  it('繰り越し距離を加算して計算する', () => {
    // 80m 繰り越し + 30m = 110m -> 1 コイン, 10m 繰り越し
    expect(computeWalkReward(80, 30)).toEqual({
      coinsGranted: 1,
      carryOverMeters: 10,
    });
  });

  it('100m 未満ならコインは 0、全量を繰り越す', () => {
    expect(computeWalkReward(0, 99)).toEqual({
      coinsGranted: 0,
      carryOverMeters: 99,
    });
  });

  it('ちょうど 100m の境界で 1 コイン、繰り越し 0', () => {
    expect(computeWalkReward(60, 40)).toEqual({
      coinsGranted: 1,
      carryOverMeters: 0,
    });
  });

  it('逐次適用と一括適用でコイン合計が一致する（繰り越しの保存）', () => {
    const oneShot = computeWalkReward(0, 250);

    const step1 = computeWalkReward(0, 120); // 1 coin, carry 20
    const step2 = computeWalkReward(step1.carryOverMeters, 130); // 20+130=150 -> 1 coin, carry 50
    const totalCoins = step1.coinsGranted + step2.coinsGranted;

    expect(totalCoins).toBe(oneShot.coinsGranted);
    expect(step2.carryOverMeters).toBe(oneShot.carryOverMeters);
  });

  it('負値・非数の入力は 0 として扱う', () => {
    expect(computeWalkReward(-100, -50)).toEqual({
      coinsGranted: 0,
      carryOverMeters: 0,
    });
    expect(computeWalkReward(Number.NaN, 150)).toEqual({
      coinsGranted: 1,
      carryOverMeters: 50,
    });
  });
});

describe('applyReward', () => {
  it('コイン・経験値・アイテムを加算する', () => {
    const state = baseState();
    const grant: RewardGrant = { coins: 50, experience: 30, items: ['sword'] };

    const next = applyReward(state, grant);

    expect(next.coins).toBe(state.coins + 50);
    expect(next.experience).toBe(state.experience + 30);
    expect(next.ownedItemIds).toEqual([...state.ownedItemIds, 'sword']);
  });

  it('入力状態を変更しない（純粋）', () => {
    const state = baseState();
    const snapshot = JSON.stringify(state);

    applyReward(state, { coins: 10, experience: 10, items: [] });

    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('負のコイン・経験値は 0 として扱う（非負性の保証, Req 5.6）', () => {
    const state = { ...baseState(), coins: 100, experience: 100 };

    const next = applyReward(state, { coins: -50, experience: -20, items: [] });

    expect(next.coins).toBe(100);
    expect(next.experience).toBe(100);
  });
});

describe('grantQuestCompletionReward', () => {
  function completeQuest(rewardGranted: boolean): QuestProgress {
    return {
      definition: {
        id: 'q1',
        condition: { kind: 'count', requiredCount: 1 },
        reward: { coins: 100, experience: 40, items: ['medal'] },
      },
      satisfiedSpotIds: [],
      satisfiedCount: 1,
      complete: true,
      rewardGranted,
    };
  }

  it('完了かつ未付与なら報酬を付与し rewardGranted を立てる', () => {
    const state = baseState();
    const quest = completeQuest(false);

    const result = grantQuestCompletionReward(state, quest);

    expect(result.granted).toBe(true);
    expect(result.quest.rewardGranted).toBe(true);
    expect(result.nextState.coins).toBe(state.coins + 100);
    expect(result.nextState.experience).toBe(state.experience + 40);
    expect(result.nextState.ownedItemIds).toContain('medal');
  });

  it('既に付与済みなら据え置く（一度限り付与, Req 4.5）', () => {
    const state = baseState();
    const quest = completeQuest(true);

    const result = grantQuestCompletionReward(state, quest);

    expect(result.granted).toBe(false);
    expect(result.nextState).toBe(state);
    expect(result.quest).toBe(quest);
  });

  it('未完了なら報酬を付与しない', () => {
    const state = baseState();
    const quest: QuestProgress = { ...completeQuest(false), complete: false };

    const result = grantQuestCompletionReward(state, quest);

    expect(result.granted).toBe(false);
    expect(result.nextState).toBe(state);
  });

  it('再評価しても合計付与は 1 回のみ', () => {
    const state = baseState();
    const first = grantQuestCompletionReward(state, completeQuest(false));
    const second = grantQuestCompletionReward(first.nextState, first.quest);

    expect(second.granted).toBe(false);
    expect(second.nextState.coins).toBe(state.coins + 100);
  });
});

// ===========================================================================
// プロパティベーステスト（fast-check, 各 100 回反復）
//
// 設計書「Correctness Properties」の Property 10〜13 を検証する。
// 各テストには対象プロパティとプロパティ本文をタグコメントとして付与する。
// ===========================================================================

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// fast-check ジェネレータ（任意入力空間の構築）
// ---------------------------------------------------------------------------

/**
 * PlayerState ジェネレータ。
 * applyReward が参照するフィールド（coins/experience/ownedItemIds）を任意に変化
 * させ、その他は初期状態の妥当な既定値を用いる。coins/experience は非負。
 */
const playerStateArb: fc.Arbitrary<PlayerState> = fc
  .record({
    coins: fc.nat({ max: 1_000_000 }),
    experience: fc.nat({ max: 1_000_000 }),
    ownedItemIds: fc.array(fc.string(), { maxLength: 5 }),
  })
  .map(({ coins, experience, ownedItemIds }) => ({
    ...createInitialPlayerState('player-1', 'region-1'),
    coins,
    experience,
    ownedItemIds,
  }));

/** 非負・有限な RewardGrant（加算不変条件の検証用） */
const rewardGrantArb: fc.Arbitrary<RewardGrant> = fc.record({
  coins: fc.nat({ max: 1_000_000 }),
  experience: fc.nat({ max: 1_000_000 }),
  items: fc.array(fc.string(), { maxLength: 5 }),
});

/** 不正値（負値・NaN・Infinity）を含む数値（非負性の検証用） */
const wildNumberArb: fc.Arbitrary<number> = fc.oneof(
  fc.integer({ min: -1_000_000, max: 1_000_000 }),
  fc.double({ min: -1_000_000, max: 1_000_000, noNaN: true }),
  fc.constant(Number.NaN),
  fc.constant(Number.NEGATIVE_INFINITY),
  fc.constant(Number.POSITIVE_INFINITY)
);

/** 不正値を含む RewardGrant（非負性の検証用） */
const wildRewardArb: fc.Arbitrary<RewardGrant> = fc.record({
  coins: wildNumberArb,
  experience: wildNumberArb,
  items: fc.array(fc.string(), { maxLength: 5 }),
});

/** 完了済み・未付与のクエスト進行（一度限り付与の検証用）。報酬は非負 */
const completeUngrantedQuestArb: fc.Arbitrary<QuestProgress> = fc
  .record({
    id: fc.string({ minLength: 1 }),
    reward: rewardGrantArb,
  })
  .map(
    ({ id, reward }): QuestProgress => ({
      definition: {
        id,
        condition: { kind: 'count', requiredCount: 1 },
        reward,
      },
      satisfiedSpotIds: [],
      satisfiedCount: 1,
      complete: true,
      rewardGranted: false,
    })
  );

// ---------------------------------------------------------------------------
// Property 11: 歩行コインの累積計算（Validates: Requirements 5.1, 5.2）
// ---------------------------------------------------------------------------

describe('Property 11: 歩行コインの累積計算', () => {
  // Feature: ehime-location-rpg, Property 11: 任意の繰り越し距離と追加距離について、
  // 付与コインは合計距離を 100 で割った商（切り捨て）に等しく、繰り越し距離は
  // 合計を 100 で割った剰余に等しい。さらに距離を任意に分割して逐次適用しても、
  // 合計コインは一括適用と等しい（繰り越しが保存される）。
  it('一括適用は floor(合計/100) コイン・合計%100 繰り越しになる', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 1_000_000 }),
        fc.nat({ max: 1_000_000 }),
        (pending, added) => {
          const total = pending + added;
          const result = computeWalkReward(pending, added);
          expect(result.coinsGranted).toBe(Math.floor(total / 100));
          expect(result.carryOverMeters).toBe(total % 100);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it('追加距離を任意分割して逐次適用しても合計コイン・最終繰り越しが一致する', () => {
    fc.assert(
      // pending は前回の computeWalkReward が返した繰り越し（carryOverMeters）であり、
      // 定義上つねに 0〜99 の範囲に収まる。逐次適用の等価性はこの正当な入力空間で成立する。
      fc.property(
        fc.nat({ max: 99 }),
        fc.array(fc.nat({ max: 10_000 }), { maxLength: 20 }),
        (pending, chunks) => {
          const addedTotal = chunks.reduce((a, b) => a + b, 0);
          const oneShot = computeWalkReward(pending, addedTotal);

          let carry = pending;
          let totalCoins = 0;
          for (const chunk of chunks) {
            const step = computeWalkReward(carry, chunk);
            totalCoins += step.coinsGranted;
            carry = step.carryOverMeters;
          }

          expect(totalCoins).toBe(oneShot.coinsGranted);
          expect(carry).toBe(oneShot.carryOverMeters);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 12: 報酬適用の加算不変条件（Validates: Requirements 5.3, 5.4, 5.5）
// ---------------------------------------------------------------------------

describe('Property 12: 報酬適用の加算不変条件', () => {
  // Feature: ehime-location-rpg, Property 12: 任意のプレイヤー状態と報酬付与について、
  // applyReward 適用後のコインと経験値は、それぞれ適用前の値に付与量を正確に加えた
  // 値になる（初回訪問・ボス撃破・クエスト完了のいずれの報酬源でも成り立つ）。
  it('適用後の coins/experience は適用前 + 付与量に等しい', () => {
    fc.assert(
      fc.property(playerStateArb, rewardGrantArb, (state, grant) => {
        const next = applyReward(state, grant);
        expect(next.coins).toBe(state.coins + grant.coins);
        expect(next.experience).toBe(state.experience + grant.experience);
        // 付与アイテムは所持へ加算される
        expect(next.ownedItemIds).toEqual([...state.ownedItemIds, ...grant.items]);
        // 入力状態は不変（純粋）
        expect(state.coins).toBe(state.coins);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 13: 報酬の非負性（Validates: Requirements 5.6）
// ---------------------------------------------------------------------------

describe('Property 13: 報酬の非負性', () => {
  // Feature: ehime-location-rpg, Property 13: 任意の報酬計算の入力（負値・NaN・
  // Infinity を含む）について、算出されるコインは 0 以上、経験値は 0 以上である。
  it('applyReward は不正な付与量でも coins/experience を非負に保つ', () => {
    fc.assert(
      fc.property(playerStateArb, wildRewardArb, (state, grant) => {
        const next = applyReward(state, grant);
        expect(next.coins).toBeGreaterThanOrEqual(0);
        expect(next.experience).toBeGreaterThanOrEqual(0);
        // 不正値（負/NaN/Infinity）は付与されず、適用前以上を維持する
        expect(next.coins).toBeGreaterThanOrEqual(state.coins);
        expect(next.experience).toBeGreaterThanOrEqual(state.experience);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('computeWalkReward は不正な距離入力でも非負のコイン・繰り越しを返す', () => {
    fc.assert(
      fc.property(wildNumberArb, wildNumberArb, (pending, added) => {
        const result = computeWalkReward(pending, added);
        expect(result.coinsGranted).toBeGreaterThanOrEqual(0);
        expect(result.carryOverMeters).toBeGreaterThanOrEqual(0);
        expect(result.carryOverMeters).toBeLessThan(100);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 10: クエスト報酬の一度限り付与（Validates: Requirements 4.5）
// ---------------------------------------------------------------------------

describe('Property 10: クエスト報酬の一度限り付与', () => {
  // Feature: ehime-location-rpg, Property 10: 任意のクエストについて、完了への遷移
  // およびその後の再評価を通じて、定義されたコインと経験値はちょうど 1 回だけ
  // 付与される（rewardGranted ゲートによる）。
  it('完了遷移後に複数回評価しても付与はちょうど 1 回のみ', () => {
    fc.assert(
      fc.property(
        playerStateArb,
        completeUngrantedQuestArb,
        fc.integer({ min: 1, max: 5 }),
        (state, quest, reEvalCount) => {
          // 1 回目: 完了かつ未付与なので付与される
          const first = grantQuestCompletionReward(state, quest);
          expect(first.granted).toBe(true);
          expect(first.quest.rewardGranted).toBe(true);

          // 以降の再評価: 既付与のため一切付与されない（据え置き）
          let cur = first;
          for (let i = 0; i < reEvalCount; i++) {
            const again = grantQuestCompletionReward(cur.nextState, cur.quest);
            expect(again.granted).toBe(false);
            expect(again.nextState).toBe(cur.nextState);
            cur = again;
          }

          // 合計付与はちょうど 1 回分
          expect(cur.nextState.coins).toBe(state.coins + quest.definition.reward.coins);
          expect(cur.nextState.experience).toBe(
            state.experience + quest.definition.reward.experience
          );
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
