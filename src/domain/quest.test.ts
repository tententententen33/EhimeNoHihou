// Quest_System のプロパティベーステスト（Req 4.2, 4.3, 4.4, 4.8）
//
// 設計書「Correctness Properties」の Property 8・9 を fast-check で検証する。
// - Property 8: クエスト進行の相異カウント（Validates: Requirements 4.2, 4.3）
// - Property 9: クエスト完了の同値条件（Validates: Requirements 4.4, 4.8）
//
// 各プロパティは最低 100 回の試行（numRuns: 100）で検証する。

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { applyStamp, isComplete } from './quest';
import type { QuestDefinition, QuestProgress, RewardGrant } from './types';

// ---------------------------------------------------------------------------
// テスト補助：必要条件数の算出（quest.ts の内部関数と同等の参照実装）
// ---------------------------------------------------------------------------

/**
 * クエスト定義から必要条件数を導出する（テスト側の独立した参照実装）。
 * - spots: 相異なる必須スポット数
 * - count: 要求スタンプ数
 */
function expectedRequiredCount(definition: QuestDefinition): number {
  const condition = definition.condition;
  if (condition.kind === 'spots') {
    return new Set(condition.requiredSpotIds).size;
  }
  return condition.requiredCount;
}

// ---------------------------------------------------------------------------
// fast-check ジェネレータ
// ---------------------------------------------------------------------------

/**
 * スポット id の生成。
 * 限定プール（s0〜s149）から生成し、付与列に重複や必須集合との交差を
 * 起こしやすくすることで、相異カウントの境界を確実に踏む。
 */
const spotIdArb: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: 149 })
  .map((n) => `s${n}`);

/** 報酬付与（コイン/経験値は 0 以上） */
const rewardArb: fc.Arbitrary<RewardGrant> = fc.record({
  coins: fc.nat({ max: 1_000_000 }),
  experience: fc.nat({ max: 1_000_000 }),
  items: fc.array(fc.string(), { maxLength: 5 }),
});

/** spots クエスト定義：1〜100 個の相異なる必須スポット id */
const spotsDefinitionArb: fc.Arbitrary<QuestDefinition> = fc.record({
  id: fc.string(),
  condition: fc
    .uniqueArray(spotIdArb, { minLength: 1, maxLength: 100 })
    .map((requiredSpotIds) => ({ kind: 'spots' as const, requiredSpotIds })),
  reward: rewardArb,
});

/** count クエスト定義：要求スタンプ数 1〜100 */
const countDefinitionArb: fc.Arbitrary<QuestDefinition> = fc.record({
  id: fc.string(),
  condition: fc
    .integer({ min: 1, max: 100 })
    .map((requiredCount) => ({ kind: 'count' as const, requiredCount })),
  reward: rewardArb,
});

/** いずれかの種類のクエスト定義 */
const anyDefinitionArb: fc.Arbitrary<QuestDefinition> = fc.oneof(
  spotsDefinitionArb,
  countDefinitionArb
);

/** 定義から初期（未進行）のクエスト進行を生成する */
function freshProgress(definition: QuestDefinition): QuestProgress {
  return {
    definition,
    satisfiedSpotIds: [],
    satisfiedCount: 0,
    complete: false,
    rewardGranted: false,
  };
}

/** スタンプ付与列（重複を含む任意のスポット id の列） */
const grantsArb: fc.Arbitrary<string[]> = fc.array(spotIdArb, { maxLength: 200 });

// ---------------------------------------------------------------------------
// Property 8: クエスト進行の相異カウント
// ---------------------------------------------------------------------------

describe('Feature: ehime-location-rpg, Property 8: クエスト進行の相異カウント', () => {
  // For any クエストとスタンプ付与列（重複を含む）について、進行数は付与された
  // 相異なる必須スポット数に等しく、同一スポットを2回以上数えない。
  // Validates: Requirements 4.2, 4.3

  it('spots クエスト: 進行数は付与された相異なる必須スポット数に等しい', () => {
    fc.assert(
      fc.property(spotsDefinitionArb, grantsArb, (definition, grants) => {
        const final = grants.reduce<QuestProgress>(
          (acc, spotId) => applyStamp(acc, spotId),
          freshProgress(definition)
        );

        // 期待値：付与列の相異なるスポットのうち、必須集合に含まれるものの数
        const requiredSet = new Set(
          (definition.condition as { kind: 'spots'; requiredSpotIds: string[] })
            .requiredSpotIds
        );
        const distinctRequiredGranted = new Set(
          grants.filter((id) => requiredSet.has(id))
        );
        const expected = distinctRequiredGranted.size;

        expect(final.satisfiedCount).toBe(expected);
        // satisfiedSpotIds の要素数と進行数は一致する
        expect(final.satisfiedSpotIds.length).toBe(final.satisfiedCount);
        // 同一スポットを2回以上数えない（重複なし）
        expect(new Set(final.satisfiedSpotIds).size).toBe(
          final.satisfiedSpotIds.length
        );
        // 数えられたスポットは必ず必須集合に含まれる
        for (const id of final.satisfiedSpotIds) {
          expect(requiredSet.has(id)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('count クエスト: 進行数は付与された相異なるスポット数（要求数で頭打ち）に等しい', () => {
    fc.assert(
      fc.property(countDefinitionArb, grantsArb, (definition, grants) => {
        const final = grants.reduce<QuestProgress>(
          (acc, spotId) => applyStamp(acc, spotId),
          freshProgress(definition)
        );

        const requiredCount = (
          definition.condition as { kind: 'count'; requiredCount: number }
        ).requiredCount;
        const distinctGranted = new Set(grants).size;
        // count は任意スポットが寄与するが、要求数を超えて数えない
        const expected = Math.min(distinctGranted, requiredCount);

        expect(final.satisfiedCount).toBe(expected);
        expect(final.satisfiedSpotIds.length).toBe(final.satisfiedCount);
        // 同一スポットを2回以上数えない（重複なし）
        expect(new Set(final.satisfiedSpotIds).size).toBe(
          final.satisfiedSpotIds.length
        );
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9: クエスト完了の同値条件
// ---------------------------------------------------------------------------

describe('Feature: ehime-location-rpg, Property 9: クエスト完了の同値条件', () => {
  // For any クエスト進行状態について、isComplete が真であることは、満たした
  // 条件数が必要条件数に等しいことと同値である（いずれかの条件が未達なら未完了）。
  // Validates: Requirements 4.4, 4.8

  /**
   * 定義に応じて satisfiedCount を 0〜必要数+3 の範囲で振った進行状態を生成する。
   * 等値・未達・超過のいずれの場合も踏むようにする。
   */
  const progressArb: fc.Arbitrary<QuestProgress> = anyDefinitionArb.chain(
    (definition) => {
      const required = expectedRequiredCount(definition);
      return fc
        .integer({ min: 0, max: required + 3 })
        .map<QuestProgress>((satisfiedCount) => ({
          definition,
          // isComplete は satisfiedCount と定義のみを参照するため任意で良い
          satisfiedSpotIds: [],
          satisfiedCount,
          complete: false,
          rewardGranted: false,
        }));
    }
  );

  it('isComplete が真 ⇔ 満たした条件数 == 必要条件数（両種類）', () => {
    fc.assert(
      fc.property(progressArb, (quest) => {
        const required = expectedRequiredCount(quest.definition);
        const expectedComplete = quest.satisfiedCount === required;

        expect(isComplete(quest)).toBe(expectedComplete);

        // いずれかの条件が未達（満たした数 < 必要数）なら未完了
        if (quest.satisfiedCount < required) {
          expect(isComplete(quest)).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });
});
