// PersistenceController のプロパティテスト（Task 15.3）
//
// Property 34: 永続化失敗時の状態保全と再試行上限
// （Validates: Requirements 3.4, 4.6, 5.7, 7.6, 7.7, 8.6, 10.5, 11.5）
//
// 本テストは状態管理層の永続化方針を検証する:
// 1. ロールバック型（commitWithRollback）: 永続化が失敗した場合、確定済み状態
//    （lastPersisted）は操作前から一切変化せず、ok:false と rollbackState
//    （= 直前の永続済み状態）が返る。成功時のみ lastPersisted を更新する。
// 2. 再試行型（enqueueRetry + sync）: 永続化を最大 MAX_RETRIES(3) 回まで再試行し、
//    3 回連続失敗後も保留項目（セッション状態）を保全し notSaved:true を返す。
//    失敗してから成功するストアでは最終的に永続化され、保留項目が除去される。

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import {
  MAX_RETRIES,
  PersistenceController,
} from './persistenceController';
import {
  UserDataStoreError,
  type UserDataStore,
} from '../repository/userDataStore';
import type { PlayerState } from '../domain/types';

// ---------------------------------------------------------------------------
// テスト用フェイク UserDataStore
// ---------------------------------------------------------------------------

/**
 * 永続化の成否を決定論的に制御できるフェイク `UserDataStore`。
 * - `alwaysFail`: 常に persist が失敗する。
 * - `failTimes`: 先頭 N 回の persist が失敗し、その後成功する。
 * 失敗は本番経路と同様に `UserDataStoreError` を throw して通知する。
 */
class FakeUserDataStore implements UserDataStore {
  /** persist が呼ばれた総回数（再試行回数の検証に使用）。 */
  persistCalls = 0;
  /** 永続化に成功した最新状態（playerId 別）。 */
  readonly persisted = new Map<string, PlayerState>();

  private remainingFailures: number;
  private readonly alwaysFail: boolean;

  constructor(opts: { failTimes?: number; alwaysFail?: boolean } = {}) {
    this.remainingFailures = opts.failTimes ?? 0;
    this.alwaysFail = opts.alwaysFail ?? false;
  }

  async load(playerId: string): Promise<PlayerState> {
    const state = this.persisted.get(playerId);
    if (state === undefined) {
      throw new UserDataStoreError('load', `存在しません: ${playerId}`, { status: 404 });
    }
    return JSON.parse(JSON.stringify(state)) as PlayerState;
  }

  async persist(playerId: string, state: PlayerState): Promise<void> {
    this.persistCalls += 1;
    if (this.alwaysFail || this.remainingFailures > 0) {
      if (this.remainingFailures > 0) {
        this.remainingFailures -= 1;
      }
      throw new UserDataStoreError('persist', `保存失敗（テスト）: ${playerId}`);
    }
    // 参照共有を避けるため deep copy して保持する。
    this.persisted.set(playerId, JSON.parse(JSON.stringify(state)) as PlayerState);
  }
}

// ---------------------------------------------------------------------------
// PlayerState ジェネレータ
// ---------------------------------------------------------------------------

/** 妥当な `PlayerState` を生成する。状態保全の検証に十分な多様性を持たせる。 */
const arbPlayerState: fc.Arbitrary<PlayerState> = fc.record({
  playerId: fc.string({ minLength: 1, maxLength: 8 }),
  coins: fc.nat({ max: 1_000_000 }),
  experience: fc.nat({ max: 1_000_000 }),
  stamps: fc.array(
    fc.record({
      spotId: fc.string({ minLength: 1, maxLength: 6 }),
      earnedAt: fc.constant('2024-01-01T00:00:00.000Z'),
    }),
    { maxLength: 5 }
  ),
  ownedItemIds: fc.array(fc.string({ minLength: 1, maxLength: 6 }), { maxLength: 5 }),
  equipped: fc.record({
    weapon: fc.option(fc.string({ minLength: 1, maxLength: 6 }), { nil: null }),
    armor: fc.option(fc.string({ minLength: 1, maxLength: 6 }), { nil: null }),
    accessory: fc.option(fc.string({ minLength: 1, maxLength: 6 }), { nil: null }),
  }),
  defeatedBossIds: fc.array(fc.string({ minLength: 1, maxLength: 6 }), { maxLength: 5 }),
  grantedLimitedItemIds: fc.array(fc.string({ minLength: 1, maxLength: 6 }), { maxLength: 5 }),
  titleIds: fc.array(fc.string({ minLength: 1, maxLength: 6 }), { maxLength: 5 }),
  unlockedRegionIds: fc.array(fc.string({ minLength: 1, maxLength: 6 }), { maxLength: 5 }),
  quests: fc.constant([]),
  pendingWalkMeters: fc.nat({ max: 99 }),
});

const PLAYER_ID = 'player-1';

// ---------------------------------------------------------------------------
// Property 34: 永続化失敗時の状態保全と再試行上限
// ---------------------------------------------------------------------------

describe('Property 34: 永続化失敗時の状態保全と再試行上限', () => {
  // Feature: ehime-location-rpg, Property 34: 永続化失敗時の状態保全と再試行上限
  it('commitWithRollback は永続化失敗時に ok:false と rollbackState=lastPersisted を返し、確定状態を変更しない', async () => {
    await fc.assert(
      fc.asyncProperty(arbPlayerState, arbPlayerState, async (initial, next) => {
        const store = new FakeUserDataStore({ alwaysFail: true });
        const controller = new PersistenceController(store, PLAYER_ID, initial);

        const result = await controller.commitWithRollback(next);

        // 永続化失敗 → ok:false かつ復元先は直前の永続済み状態（= initial）。
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.rollbackState).toEqual(initial);
        expect(result.error.kind).toBe('persist-failed');

        // 確定済み状態は操作前から一切変化しない（Req 3.4, 4.6, 5.7, 8.6, 11.5）。
        expect(controller.getLastPersisted()).toEqual(initial);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: ehime-location-rpg, Property 34: 永続化失敗時の状態保全と再試行上限
  it('commitWithRollback は永続化成功時に ok:true を返し lastPersisted を次状態へ更新する', async () => {
    await fc.assert(
      fc.asyncProperty(arbPlayerState, arbPlayerState, async (initial, next) => {
        const store = new FakeUserDataStore(); // 失敗しない
        const controller = new PersistenceController(store, PLAYER_ID, initial);

        const result = await controller.commitWithRollback(next);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.committed).toEqual(next);
        // 確定状態が次状態へ更新されている。
        expect(controller.getLastPersisted()).toEqual(next);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: ehime-location-rpg, Property 34: 永続化失敗時の状態保全と再試行上限
  it('sync は永続化が常に失敗する場合、最大 MAX_RETRIES 回再試行し保留項目を保全して notSaved:true を返す', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbPlayerState,
        arbPlayerState,
        fc.constantFrom('purchase' as const, 'regionUnlock' as const),
        async (initial, target, kind) => {
          const store = new FakeUserDataStore({ alwaysFail: true });
          const controller = new PersistenceController(store, PLAYER_ID, initial);

          const enqueued = controller.enqueueRetry(kind, target);
          const syncResult = await controller.sync();

          // 最大 MAX_RETRIES(3) 回まで再試行している（Req 7.6, 7.7, 10.5）。
          expect(store.persistCalls).toBe(MAX_RETRIES);

          // 3 回連続失敗後も保存不可指示と保留項目の保全がなされている。
          expect(syncResult.notSaved).toBe(true);
          expect(syncResult.outcomes).toHaveLength(1);
          expect(syncResult.outcomes[0].status).toBe('exhausted');
          expect(syncResult.outcomes[0].item.attempts).toBe(MAX_RETRIES);

          // 保留項目（目標状態）はセッション状態に保全される（Req 7.7）。
          expect(controller.hasPending()).toBe(true);
          const remaining = controller.getPendingItems();
          expect(remaining).toHaveLength(1);
          expect(remaining[0].id).toBe(enqueued.id);
          expect(remaining[0].state).toEqual(target);

          // 確定済み状態は操作前から変化しない。
          expect(controller.getLastPersisted()).toEqual(initial);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: ehime-location-rpg, Property 34: 永続化失敗時の状態保全と再試行上限
  it('sync は失敗してから成功するストア（失敗回数 < MAX_RETRIES）で最終的に永続化し保留項目を除去する', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbPlayerState,
        arbPlayerState,
        fc.integer({ min: 0, max: MAX_RETRIES - 1 }),
        fc.constantFrom('purchase' as const, 'regionUnlock' as const),
        async (initial, target, failTimes, kind) => {
          const store = new FakeUserDataStore({ failTimes });
          const controller = new PersistenceController(store, PLAYER_ID, initial);

          controller.enqueueRetry(kind, target);
          const syncResult = await controller.sync();

          // 失敗 failTimes 回 + 成功 1 回 = failTimes + 1 回の試行で永続化される。
          expect(store.persistCalls).toBe(failTimes + 1);
          expect(syncResult.notSaved).toBe(false);
          expect(syncResult.outcomes).toHaveLength(1);
          expect(syncResult.outcomes[0].status).toBe('persisted');

          // 保留項目は除去され、確定状態は目標状態へ更新される。
          expect(controller.hasPending()).toBe(false);
          expect(controller.getLastPersisted()).toEqual(target);
        }
      ),
      { numRuns: 100 }
    );
  });
});
