// Collection_System のプロパティベーステスト（fast-check, 各 100 回反復）
//
// 設計書「Correctness Properties」の Property 32（コレクション進捗の範囲不変条件）
// および Property 33（コレクション完了の同値条件）を検証する。
// getProgress は obtained/total を算出し、isComplete は完了判定を行う純粋関数である
// （Req 11.6, 11.7, 11.8）。

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { getProgress, isComplete } from './collection';
import { createInitialPlayerState } from './types';
import type { CollectionDefinition, PlayerState, Stamp } from './types';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// fast-check ジェネレータ（任意入力空間の構築）
//
// コレクションのエントリ id とプレイヤー保持 id を共有プールから生成し、
// 「全取得・一部取得・未取得」の各状況が十分な頻度で発生するよう設計する。
// total 0（entryIds 空）のケースも明示的に含める（Req 11.8 の検証用）。
// ---------------------------------------------------------------------------

// kind 横断で同一プールを使い、エントリ id と保持 id を重複させる。
const entryIdArb = fc.constantFrom(
  'e-1',
  'e-2',
  'e-3',
  'e-4',
  'e-5',
  'e-6'
);

const stampArb: fc.Arbitrary<Stamp> = entryIdArb.map((spotId) => ({
  spotId,
  earnedAt: '2024-01-01T00:00:00.000Z',
}));

/** コレクション定義。entryIds は空（total 0）から重複ありまで広く生成する。 */
const collectionDefinitionArb: fc.Arbitrary<CollectionDefinition> = fc.record({
  id: fc.constantFrom('col-1', 'col-2'),
  name: fc.constant('コレクション'),
  kind: fc.constantFrom<'stamp' | 'boss' | 'item'>('stamp', 'boss', 'item'),
  // 重複を許す配列で「重複 id でも distinct 集計」を踏む。空配列で total 0 も網羅。
  entryIds: fc.array(entryIdArb, { maxLength: 8 }),
});

/**
 * PlayerState ジェネレータ。
 * getProgress が kind に応じて参照する stamps / defeatedBossIds / ownedItemIds を
 * いずれも共有プールから任意生成し、その他は妥当な既定値を用いる。
 */
const playerStateArb: fc.Arbitrary<PlayerState> = fc
  .record({
    stamps: fc.array(stampArb, { maxLength: 8 }),
    defeatedBossIds: fc.uniqueArray(entryIdArb, { maxLength: 6 }),
    ownedItemIds: fc.uniqueArray(entryIdArb, { maxLength: 6 }),
  })
  .map(({ stamps, defeatedBossIds, ownedItemIds }) => ({
    ...createInitialPlayerState('player-1', 'region-1'),
    stamps,
    defeatedBossIds,
    ownedItemIds,
  }));

// ---------------------------------------------------------------------------
// Property 32: コレクション進捗の範囲不変条件（Validates: Requirements 11.6）
// ---------------------------------------------------------------------------

describe('Property 32: コレクション進捗の範囲不変条件', () => {
  // Feature: ehime-location-rpg, Property 32: コレクション進捗の範囲不変条件。任意の
  // コレクション定義とプレイヤー状態について、getProgress が返す total は entryIds の
  // 相異なる id 数（0 以上）に等しく、obtained は常に 0 以上かつ total 以下に収まる
  // （0..total）。entryIds に重複があっても obtained が total を超えることはない。
  it('obtained は 0..total に収まり、total は distinct(entryIds) に等しい', () => {
    fc.assert(
      fc.property(
        collectionDefinitionArb,
        playerStateArb,
        (collection, state) => {
          const { obtained, total } = getProgress(collection, state);

          // total は相異なる entryIds の数。
          expect(total).toBe(new Set(collection.entryIds).size);
          expect(total).toBeGreaterThanOrEqual(0);

          // obtained は 0 以上かつ total 以下（範囲不変条件）。
          expect(obtained).toBeGreaterThanOrEqual(0);
          expect(obtained).toBeLessThanOrEqual(total);
          expect(Number.isInteger(obtained)).toBe(true);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 33: コレクション完了の同値条件（Validates: Requirements 11.7, 11.8）
// ---------------------------------------------------------------------------

describe('Property 33: コレクション完了の同値条件', () => {
  // Feature: ehime-location-rpg, Property 33: コレクション完了の同値条件。任意の
  // コレクション定義とプレイヤー状態について、isComplete が true となるのは total が
  // 1 以上かつ obtained が total に等しいとき、かつそのときに限る（Req 11.7）。
  // total が 0 のコレクションは決して完了しない（Req 11.8）。
  it('isComplete iff (total >= 1 && obtained == total)。total 0 は常に未完了', () => {
    fc.assert(
      fc.property(
        collectionDefinitionArb,
        playerStateArb,
        (collection, state) => {
          const { obtained, total } = getProgress(collection, state);
          const complete = isComplete(collection, state);

          // 完了の同値条件。
          expect(complete).toBe(total >= 1 && obtained === total);

          // total 0 は決して完了しない（Req 11.8）。
          if (total === 0) {
            expect(complete).toBe(false);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
