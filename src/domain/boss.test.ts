// Boss_System のプロパティベーステスト（fast-check, 各 100 回反復）
//
// 設計書「Correctness Properties」の Property 24〜27 を検証する。
// 対象は src/domain/boss.ts の純粋ドメインロジック:
//   - isAvailable(boss, visited)        … ボス可用性判定（Req 9.2, 9.7）
//   - resolveWin(state, boss)           … 勝利時の報酬付与・撃破記録（Req 9.3, 9.4）
//   - resolveLossOrAbandon(state)       … 敗北・中断の無作用（Req 9.6）
//   - VisitedAreas                      … 入場済みエリア集合
//
// 各テストには対象プロパティとプロパティ本文をタグコメントとして付与する。

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isAvailable, resolveWin, resolveLossOrAbandon } from './boss';
import type { VisitedAreas } from './boss';
import { createInitialPlayerState } from './types';
import type { Boss, PlayerState } from './types';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// fast-check ジェネレータ（任意入力空間の構築）
// ---------------------------------------------------------------------------

/**
 * 小さな id プール。bind 対象とプレイヤーの訪問集合を同一プールから生成する
 * ことで、「入場済み／未入場」の双方のケースが十分な頻度で現れるようにする
 * （Property 24 の同値性を両方向で検証するため）。
 */
const idPoolArb = (prefix: string): fc.Arbitrary<string> =>
  fc.integer({ min: 0, max: 5 }).map((n) => `${prefix}-${n}`);

const spotIdArb = idPoolArb('spot');
const regionIdArb = idPoolArb('region');

/**
 * Boss ジェネレータ。
 * - bind は spot または region のいずれか単一（Req 9.1）。
 * - reward は非負のコイン・経験値、通常アイテム、1 個以上の Limited_Item を持つ。
 *   Limited_Item id は重複しうる小プールから生成し、重複排除ロジックを検証する。
 */
const bossArb: fc.Arbitrary<Boss> = fc.record({
  id: idPoolArb('boss'),
  bind: fc.oneof(
    spotIdArb.map((spotId) => ({ kind: 'spot' as const, spotId })),
    regionIdArb.map((regionId) => ({ kind: 'region' as const, regionId }))
  ),
  reward: fc.record({
    coins: fc.nat({ max: 100_000 }),
    experience: fc.nat({ max: 100_000 }),
    items: fc.array(fc.string(), { maxLength: 4 }),
    // 1 個以上の Limited_Item（Req 9.1, 9.4）。小プールで重複を誘発する。
    limitedItemIds: fc.array(idPoolArb('limited'), {
      minLength: 1,
      maxLength: 5,
    }),
  }),
});

/**
 * VisitedAreas ジェネレータ。入場済みの Spot/Region id 集合を小プールから生成する。
 */
const visitedAreasArb: fc.Arbitrary<VisitedAreas> = fc.record({
  visitedSpotIds: fc.array(spotIdArb, { maxLength: 6 }),
  enteredRegionIds: fc.array(regionIdArb, { maxLength: 6 }),
});

/**
 * PlayerState ジェネレータ。
 * resolveWin が参照するフィールド（coins/experience/ownedItemIds/
 * defeatedBossIds/grantedLimitedItemIds）を任意に変化させ、その他は初期状態の
 * 妥当な既定値を用いる。coins/experience は非負。
 */
const playerStateArb: fc.Arbitrary<PlayerState> = fc
  .record({
    coins: fc.nat({ max: 1_000_000 }),
    experience: fc.nat({ max: 1_000_000 }),
    ownedItemIds: fc.array(fc.string(), { maxLength: 5 }),
    defeatedBossIds: fc.array(idPoolArb('boss'), { maxLength: 5 }),
    grantedLimitedItemIds: fc.array(idPoolArb('limited'), { maxLength: 5 }),
  })
  .map((fields) => ({
    ...createInitialPlayerState('player-1', 'region-1'),
    ...fields,
  }));

/** bind 対象の id を取り出すヘルパー */
function boundId(boss: Boss): string {
  return boss.bind.kind === 'spot' ? boss.bind.spotId : boss.bind.regionId;
}

/** プレイヤーが bind 対象に入場済みか（テスト側の独立判定） */
function hasEnteredBound(boss: Boss, visited: VisitedAreas): boolean {
  return boss.bind.kind === 'spot'
    ? visited.visitedSpotIds.includes(boss.bind.spotId)
    : visited.enteredRegionIds.includes(boss.bind.regionId);
}

// ---------------------------------------------------------------------------
// Property 24: ボス可用性の同値条件（Validates: Requirements 9.2, 9.7）
// ---------------------------------------------------------------------------

describe('Property 24: ボス可用性の同値条件', () => {
  // Feature: ehime-location-rpg, Property 24: For any ボスとプレイヤーの訪問エリアに
  // ついて、ボスバトルが可用であることは、そのボスが紐づく Spot または Region に
  // 入場済みであることと同値である。
  it('isAvailable は bind 対象への入場済みであることと同値', () => {
    fc.assert(
      fc.property(bossArb, visitedAreasArb, (boss, visited) => {
        const available = isAvailable(boss, visited);
        // テスト側の独立判定と完全一致する（双方向の同値）
        expect(available).toBe(hasEnteredBound(boss, visited));
      }),
      { numRuns: NUM_RUNS }
    );
  });

  // 入場済みなら必ず可用、未入場なら必ず不可用（同値の対偶も確認）
  it('bind 対象を訪問集合へ追加すると可用、取り除くと不可用になる', () => {
    fc.assert(
      fc.property(bossArb, visitedAreasArb, (boss, visited) => {
        const id = boundId(boss);

        // bind 対象を確実に含む訪問集合 → 可用
        const withBound: VisitedAreas =
          boss.bind.kind === 'spot'
            ? { ...visited, visitedSpotIds: [...visited.visitedSpotIds, id] }
            : { ...visited, enteredRegionIds: [...visited.enteredRegionIds, id] };
        expect(isAvailable(boss, withBound)).toBe(true);

        // bind 対象を確実に除いた訪問集合 → 不可用
        const withoutBound: VisitedAreas = {
          visitedSpotIds: visited.visitedSpotIds.filter((s) => s !== id),
          enteredRegionIds: visited.enteredRegionIds.filter((r) => r !== id),
        };
        expect(isAvailable(boss, withoutBound)).toBe(false);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 25: ボス勝利時の付与と撃破記録（Validates: Requirements 9.3）
// ---------------------------------------------------------------------------

describe('Property 25: ボス勝利時の付与と撃破記録', () => {
  // Feature: ehime-location-rpg, Property 25: For any 未撃破ボスに勝利した場合、
  // Reward_Engine を通じて定義された報酬が付与され、当該ボスがそのプレイヤーの
  // 撃破済みとして記録される。
  it('未撃破ボス勝利で報酬付与（coins/experience 加算）と撃破記録が行われる', () => {
    fc.assert(
      fc.property(playerStateArb, bossArb, (state, boss) => {
        // 当該ボスを未撃破にそろえる（前提条件）
        const undefeated: PlayerState = {
          ...state,
          defeatedBossIds: state.defeatedBossIds.filter((b) => b !== boss.id),
        };

        const result = resolveWin(undefeated, boss);

        // Reward_Engine 経由でコイン・経験値が定義どおり加算される
        expect(result.nextState.coins).toBe(undefeated.coins + boss.reward.coins);
        expect(result.nextState.experience).toBe(
          undefeated.experience + boss.reward.experience
        );

        // 通常アイテムは所持へ加算される
        for (const item of boss.reward.items) {
          expect(result.nextState.ownedItemIds).toContain(item);
        }

        // 当該ボスが撃破済みとして記録される（新規撃破）
        expect(result.newlyDefeated).toBe(true);
        expect(result.nextState.defeatedBossIds).toContain(boss.id);

        // 入力状態は不変（純粋）
        expect(undefeated.defeatedBossIds).not.toContain(boss.id);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('既撃破ボスへの再勝利では撃破記録は重複せず newlyDefeated は false', () => {
    fc.assert(
      fc.property(playerStateArb, bossArb, (state, boss) => {
        // 当該ボスを既撃破にそろえる
        const defeated: PlayerState = {
          ...state,
          defeatedBossIds: [...state.defeatedBossIds.filter((b) => b !== boss.id), boss.id],
        };

        const result = resolveWin(defeated, boss);

        expect(result.newlyDefeated).toBe(false);
        // 撃破記録は重複しない（boss.id はちょうど 1 件）
        const occurrences = result.nextState.defeatedBossIds.filter(
          (b) => b === boss.id
        ).length;
        expect(occurrences).toBe(1);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 26: 限定アイテムの重複排除（Validates: Requirements 9.4）
// ---------------------------------------------------------------------------

describe('Property 26: 限定アイテムの重複排除', () => {
  // Feature: ehime-location-rpg, Property 26: For any ボスへの勝利回数列について、
  // コインと経験値は毎回付与される一方、各 Limited_Item は当該プレイヤーに対して
  // 高々1回しか付与されない。
  it('連続勝利でコイン・経験値は毎回付与、Limited_Item は高々1回のみ付与される', () => {
    fc.assert(
      fc.property(
        playerStateArb,
        bossArb,
        fc.integer({ min: 1, max: 5 }),
        (state, boss, winCount) => {
          // 当該ボスを未撃破にそろえてから連続勝利させる
          let cur: PlayerState = {
            ...state,
            defeatedBossIds: state.defeatedBossIds.filter((b) => b !== boss.id),
          };

          const startCoins = cur.coins;
          const startExp = cur.experience;
          // 開始時点で既に付与済みの Limited_Item（再付与されてはならない）
          const preGranted = new Set(cur.grantedLimitedItemIds);
          // このボスが付与しうる相異なる Limited_Item
          const bossLimited = new Set(boss.reward.limitedItemIds);

          // 全勝利で新規付与された Limited_Item の累積
          const grantedAcrossWins: string[] = [];

          for (let i = 0; i < winCount; i++) {
            const result = resolveWin(cur, boss);

            // コイン・経験値は毎回確実に加算される（Req 9.4 前半）
            expect(result.nextState.coins).toBe(cur.coins + boss.reward.coins);
            expect(result.nextState.experience).toBe(
              cur.experience + boss.reward.experience
            );

            // 今回新規付与された Limited_Item は、いずれもこのボスのものであり、
            // かつ既付与ではない（重複排除）
            for (const id of result.grantedLimitedItemIds) {
              expect(bossLimited.has(id)).toBe(true);
              expect(preGranted.has(id)).toBe(false);
            }

            grantedAcrossWins.push(...result.grantedLimitedItemIds);
            cur = result.nextState;
          }

          // コイン・経験値は winCount 回ぶん正確に加算される
          expect(cur.coins).toBe(startCoins + boss.reward.coins * winCount);
          expect(cur.experience).toBe(startExp + boss.reward.experience * winCount);

          // 各 Limited_Item は全勝利を通じて高々1回しか新規付与されない
          const grantedCounts = new Map<string, number>();
          for (const id of grantedAcrossWins) {
            grantedCounts.set(id, (grantedCounts.get(id) ?? 0) + 1);
          }
          for (const count of grantedCounts.values()) {
            expect(count).toBe(1);
          }

          // 最終状態において、開始時に未付与だった本ボスの Limited_Item は
          // 連続勝利を通じてちょうど1回だけ付与されている（重複排除の帰結）。
          for (const id of bossLimited) {
            if (!preGranted.has(id)) {
              const finalCount = cur.grantedLimitedItemIds.filter(
                (g) => g === id
              ).length;
              expect(finalCount).toBe(1);
            }
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 27: 敗北・中断の無作用（Validates: Requirements 9.6）
// ---------------------------------------------------------------------------

describe('Property 27: 敗北・中断の無作用', () => {
  // Feature: ehime-location-rpg, Property 27: For any ボスバトルの敗北または中断に
  // ついて、ボスは撃破済みに記録されず、報酬は付与されず、そのボスバトルは可用な
  // まま保たれる。
  it('敗北・中断ではプレイヤー状態が一切変化しない（同一参照）', () => {
    fc.assert(
      fc.property(playerStateArb, (state) => {
        const snapshot = JSON.stringify(state);
        const next = resolveLossOrAbandon(state);

        // 状態は不変（同一参照かつ内容一致）
        expect(next).toBe(state);
        expect(JSON.stringify(next)).toBe(snapshot);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('敗北・中断後も撃破記録は増えず、可用性は変わらない', () => {
    fc.assert(
      fc.property(playerStateArb, bossArb, visitedAreasArb, (state, boss, visited) => {
        const beforeAvailable = isAvailable(boss, visited);
        const beforeDefeated = state.defeatedBossIds.includes(boss.id);

        const next = resolveLossOrAbandon(state);

        // 撃破記録は変化しない（新規記録なし）
        expect(next.defeatedBossIds.includes(boss.id)).toBe(beforeDefeated);
        // 報酬付与なし（コイン・経験値・所持アイテム不変）
        expect(next.coins).toBe(state.coins);
        expect(next.experience).toBe(state.experience);
        expect(next.ownedItemIds).toEqual(state.ownedItemIds);
        // 可用性は訪問エリアのみに依存するため、状態据え置きで維持される
        expect(isAvailable(boss, visited)).toBe(beforeAvailable);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
