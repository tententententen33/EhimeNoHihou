// PlayerState シリアライズ／デシリアライズのプロパティテスト（Task 14.3）
//
// 設計書「Correctness Properties」の Property 35（プレイヤー状態の永続化
// ラウンドトリップ）を fast-check で検証する。すなわち任意の妥当な
// PlayerState について、deserialize(serialize(state)) が保存対象の各フィールドを
// 同値で復元することを確認する。
//
// 注意: デシリアライザは外部由来データの欠損・不正に備えて正規化を行うため、
// ラウンドトリップが「正確一致」となるよう、ジェネレータは常に妥当（範囲内）な
// データのみを生成する。

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { serialize, deserialize } from './serialization';
import { createInitialPlayerState } from '../domain/types';
import type {
  EquipmentSlot,
  PlayerState,
  QuestProgress,
  Stamp,
} from '../domain/types';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// fast-check ジェネレータ（妥当な入力空間の構築）
// ---------------------------------------------------------------------------

/** 非空の id 文字列（spotId / itemId / bossId / regionId など）。 */
const idArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 12 });

/** ISO 8601 形式の付与日時（earnedAt）。妥当な日時のみを生成する。 */
const isoDateArb: fc.Arbitrary<string> = fc
  .date({
    min: new Date('2020-01-01T00:00:00.000Z'),
    max: new Date('2035-12-31T23:59:59.999Z'),
  })
  .map((d) => d.toISOString());

/** スタンプ（spotId + ISO earnedAt）。 */
const stampArb: fc.Arbitrary<Stamp> = fc.record({
  spotId: idArb,
  earnedAt: isoDateArb,
});

/** スロット別有効装備（各スロットは文字列 id または null=未装備）。 */
const equippedArb: fc.Arbitrary<Record<EquipmentSlot, string | null>> = fc.record({
  weapon: fc.option(idArb, { nil: null }),
  armor: fc.option(idArb, { nil: null }),
  accessory: fc.option(idArb, { nil: null }),
});

/** 非負・有限の報酬値（コイン・経験値）。 */
const rewardAmountArb: fc.Arbitrary<number> = fc.nat({ max: 1_000_000 });

/** RewardGrant（コイン・経験値は非負、items は文字列配列）。 */
const rewardArb = fc.record({
  coins: rewardAmountArb,
  experience: rewardAmountArb,
  items: fc.array(idArb, { maxLength: 5 }),
});

/** クエスト進行（spots / count 条件と報酬を備える妥当な進行状態）。 */
const questArb: fc.Arbitrary<QuestProgress> = fc
  .record({
    id: idArb,
    // eventId は任意（後期フェーズ Req 17）。半数程度で付与する。
    eventId: fc.option(idArb, { nil: undefined }),
    condition: fc.oneof(
      fc.record({
        kind: fc.constant('spots' as const),
        requiredSpotIds: fc.array(idArb, { maxLength: 5 }),
      }),
      fc.record({
        kind: fc.constant('count' as const),
        requiredCount: fc.nat({ max: 100 }),
      })
    ),
    reward: rewardArb,
    satisfiedSpotIds: fc.array(idArb, { maxLength: 5 }),
    satisfiedCount: fc.nat({ max: 100 }),
    complete: fc.boolean(),
    rewardGranted: fc.boolean(),
  })
  .map(
    ({
      id,
      eventId,
      condition,
      reward,
      satisfiedSpotIds,
      satisfiedCount,
      complete,
      rewardGranted,
    }): QuestProgress => ({
      definition: {
        id,
        ...(eventId !== undefined ? { eventId } : {}),
        condition,
        reward,
      },
      satisfiedSpotIds,
      satisfiedCount,
      complete,
      rewardGranted,
    })
  );

/**
 * 妥当な PlayerState ジェネレータ。
 * createInitialPlayerState を基底とし、保存対象の各フィールドを範囲内の
 * ランダムな妥当データで上書きする。pendingWalkMeters は 0〜99（繰り越し範囲）。
 */
const playerStateArb: fc.Arbitrary<PlayerState> = fc
  .record({
    playerId: idArb,
    coins: rewardAmountArb,
    experience: rewardAmountArb,
    stamps: fc.array(stampArb, { maxLength: 8 }),
    ownedItemIds: fc.array(idArb, { maxLength: 8 }),
    equipped: equippedArb,
    defeatedBossIds: fc.array(idArb, { maxLength: 6 }),
    grantedLimitedItemIds: fc.array(idArb, { maxLength: 6 }),
    titleIds: fc.array(idArb, { maxLength: 6 }),
    unlockedRegionIds: fc.array(idArb, { minLength: 1, maxLength: 6 }),
    quests: fc.array(questArb, { maxLength: 5 }),
    pendingWalkMeters: fc.nat({ max: 99 }),
  })
  .map((fields) => ({
    ...createInitialPlayerState(fields.playerId, fields.unlockedRegionIds[0]),
    ...fields,
  }));

// ---------------------------------------------------------------------------
// Property 35: プレイヤー状態の永続化ラウンドトリップ
//   （Validates: Requirements 3.2, 7.4, 8.5, 9.5, 11.4）
// ---------------------------------------------------------------------------

describe('Property 35: プレイヤー状態の永続化ラウンドトリップ', () => {
  // Feature: ehime-location-rpg, Property 35: 任意の妥当な PlayerState について、
  // deserialize(serialize(state)) は次の各フィールドを同値で復元する:
  // coins, experience, stamps（spotId + earnedAt）, ownedItemIds,
  // equipped（スロット別）, defeatedBossIds, grantedLimitedItemIds, titleIds,
  // unlockedRegionIds, quests, pendingWalkMeters。
  it('serialize → deserialize で保存対象の各フィールドが同値で復元される', () => {
    fc.assert(
      fc.property(playerStateArb, (state) => {
        const restored = deserialize(serialize(state));

        // 数値フィールド
        expect(restored.coins).toEqual(state.coins);
        expect(restored.experience).toEqual(state.experience);
        expect(restored.pendingWalkMeters).toEqual(state.pendingWalkMeters);

        // スタンプ（spotId + earnedAt）
        expect(restored.stamps).toEqual(state.stamps);

        // 所持アイテム
        expect(restored.ownedItemIds).toEqual(state.ownedItemIds);

        // スロット別有効装備
        expect(restored.equipped).toEqual(state.equipped);

        // 撃破済みボス・付与済み限定アイテム・称号・解放済み地域
        expect(restored.defeatedBossIds).toEqual(state.defeatedBossIds);
        expect(restored.grantedLimitedItemIds).toEqual(state.grantedLimitedItemIds);
        expect(restored.titleIds).toEqual(state.titleIds);
        expect(restored.unlockedRegionIds).toEqual(state.unlockedRegionIds);

        // クエスト進行（定義・条件・報酬・進行状態）
        expect(restored.quests).toEqual(state.quests);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
