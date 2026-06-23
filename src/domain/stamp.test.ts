// Stamp_System のプロパティベーステスト（Property 6, 7）
//
// fast-check による不変条件検証。各プロパティは最低 100 回反復する。
// grantStampIfAbsent の冪等性（Property 6）と getStampSummary の
// 範囲不変条件（Property 7）を、任意の PlayerState / spotId / 総数に対して検証する。

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { grantStampIfAbsent, getStampSummary } from './stamp';
import { createInitialPlayerState } from './types';
import type { PlayerState, Stamp } from './types';

// --- ジェネレータ -----------------------------------------------------------

/** spotId の任意文字列（非空・非 ASCII を含む）。生成空間を意図的に小さく絞り重複を誘発する。 */
const spotIdArb = fc.oneof(
  fc.constantFrom('spot-1', 'spot-2', 'spot-3', '道後温泉', 'A', 'b'),
  fc.string({ minLength: 1, maxLength: 6 })
);

/** ISO 8601 風の日時文字列。 */
const isoArb = fc
  .integer({ min: 0, max: 4_102_444_800_000 }) // 1970..2100 のおおよそ
  .map((ms) => new Date(ms).toISOString());

/** 単一スタンプのジェネレータ。 */
const stampArb: fc.Arbitrary<Stamp> = fc.record({
  spotId: spotIdArb,
  earnedAt: isoArb,
});

/**
 * 任意の PlayerState を生成する。
 * createInitialPlayerState を土台に、ランダムなスタンプ列（重複 spotId も許容）を載せる。
 */
const playerStateArb: fc.Arbitrary<PlayerState> = fc
  .record({
    playerId: fc.string({ minLength: 1, maxLength: 8 }),
    stamps: fc.array(stampArb, { maxLength: 20 }),
  })
  .map(({ playerId, stamps }) => {
    const base = createInitialPlayerState(playerId, 'region-1');
    return { ...base, stamps };
  });

// --- Property 6 -------------------------------------------------------------

describe('Property 6: スタンプ付与の冪等性', () => {
  // Feature: ehime-location-rpg, Property 6: スタンプ付与の冪等性
  // For any プレイヤー状態とスポットについて、当該スポットのスタンプを持たない場合は
  // 付与によりちょうど1つのスタンプが追加され、既にスタンプを持つ場合は付与を繰り返しても
  // 枚数・既存の spotId と earnedAt が変化しない（付与1回と複数回が同一結果）。
  // Validates: Requirements 3.1, 3.3
  it('未取得なら1枚追加、既取得なら据え置き（付与1回==複数回）', () => {
    fc.assert(
      fc.property(playerStateArb, spotIdArb, isoArb, (state, spotId, now) => {
        const hadStamp = state.stamps.some((s) => s.spotId === spotId);
        const beforeCount = state.stamps.length;

        const first = grantStampIfAbsent(state, spotId, now);

        if (hadStamp) {
          // 既取得: granted は false、枚数不変、状態は同一参照（変更しない）。
          expect(first.granted).toBe(false);
          expect(first.nextState.stamps.length).toBe(beforeCount);
          expect(first.nextState).toBe(state);
        } else {
          // 未取得: ちょうど1枚追加され、当該スポットのスタンプを保持する。
          expect(first.granted).toBe(true);
          expect(first.nextState.stamps.length).toBe(beforeCount + 1);
          expect(first.nextState.stamps.filter((s) => s.spotId === spotId)).toHaveLength(1);
        }

        // 当該スポットのスタンプ（付与後の状態における）。
        const granted = first.nextState.stamps.find((s) => s.spotId === spotId)!;

        // 再付与を複数回繰り返しても、枚数も既存スタンプ（spotId/earnedAt）も変化しない。
        let current = first.nextState;
        for (let i = 0; i < 3; i++) {
          const repeat = grantStampIfAbsent(current, spotId, `re-grant-${i}`);
          expect(repeat.granted).toBe(false);
          expect(repeat.nextState).toBe(current); // 据え置きは同一参照
          const same = repeat.nextState.stamps.find((s) => s.spotId === spotId)!;
          expect(same.spotId).toBe(granted.spotId);
          expect(same.earnedAt).toBe(granted.earnedAt);
          current = repeat.nextState;
        }

        // 付与1回後と複数回後で当該スポットのスタンプ枚数が一致する。
        const countAfterOnce = first.nextState.stamps.filter((s) => s.spotId === spotId).length;
        const countAfterMany = current.stamps.filter((s) => s.spotId === spotId).length;
        expect(countAfterMany).toBe(countAfterOnce);
      }),
      { numRuns: 100 }
    );
  });

  it('入力状態を破壊的に変更しない（純粋性）', () => {
    fc.assert(
      fc.property(playerStateArb, spotIdArb, isoArb, (state, spotId, now) => {
        const snapshot = JSON.stringify(state);
        grantStampIfAbsent(state, spotId, now);
        expect(JSON.stringify(state)).toBe(snapshot);
      }),
      { numRuns: 100 }
    );
  });
});

// --- Property 7 -------------------------------------------------------------

describe('Property 7: スタンプ集計の範囲不変条件', () => {
  // Feature: ehime-location-rpg, Property 7: スタンプ集計の範囲不変条件
  // For any プレイヤー状態と総スポット数について、表示される取得スタンプ数は
  // 0 以上かつ総数以下であり、保持する相異なるスタンプ数と一致する（総数でクランプ）。
  // Validates: Requirements 3.5
  it('earned は 0..total に収まり、相異なる保持数（total でクランプ）と一致する', () => {
    fc.assert(
      fc.property(playerStateArb, fc.integer({ min: -5, max: 50 }), (state, totalSpots) => {
        const { earned, total } = getStampSummary(state, totalSpots);

        const distinct = new Set(state.stamps.map((s) => s.spotId)).size;
        const expectedTotal = Math.max(0, Math.floor(totalSpots));
        const expectedEarned = Math.min(Math.max(0, distinct), expectedTotal);

        // 範囲不変条件: 0 <= earned <= total。
        expect(earned).toBeGreaterThanOrEqual(0);
        expect(earned).toBeLessThanOrEqual(total);

        // total は負の入力を 0 に丸める。
        expect(total).toBe(expectedTotal);

        // earned は相異なる保持数を total でクランプした値と一致する。
        expect(earned).toBe(expectedEarned);
      }),
      { numRuns: 100 }
    );
  });
});
