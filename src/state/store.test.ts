// SessionStore のユニットテスト（Task 15.4）
//
// 状態管理層の代表的フローを具体例・エッジケースで検証する:
// - 地域アンロック通知は永続化確定後にのみ、正しい順序で発行される（Req 10.4, 10.6）。
// - 購入確定: 成功パス（saved:true）と、永続化失敗時の保存不可パス（saved:false,
//   ただしセッション状態は保全）（Req 7.8）。
// - スタンプ保存失敗時のロールバック表示（Req 3.4）。

import { describe, expect, it, beforeEach } from 'vitest';

import {
  PersistenceController,
} from './persistenceController';
import {
  SessionStore,
  type SessionStoreContext,
  type StoreNotification,
} from './store';
import {
  InMemoryUserDataStore,
  UserDataStoreError,
  type UserDataStore,
} from '../repository/userDataStore';
import type {
  Boss,
  ItemCatalog,
  PlayerState,
  Region,
  RewardGrant,
  ShopItem,
  Spot,
  TitleDefinition,
} from '../domain/types';
import { createInitialPlayerState } from '../domain/types';

// ---------------------------------------------------------------------------
// 制御可能なフェイク UserDataStore（永続化失敗を任意に切り替え可能）
// ---------------------------------------------------------------------------

/**
 * persist の成否をフラグで切り替えられるフェイクストア。
 * 既定は成功（InMemory 同様に保持）。`failPersist=true` の間は常に失敗する。
 */
class ToggleableUserDataStore implements UserDataStore {
  failPersist = false;
  persistCalls = 0;
  private readonly store = new Map<string, PlayerState>();

  async load(playerId: string): Promise<PlayerState> {
    const state = this.store.get(playerId);
    if (state === undefined) {
      throw new UserDataStoreError('load', `存在しません: ${playerId}`, { status: 404 });
    }
    return JSON.parse(JSON.stringify(state)) as PlayerState;
  }

  async persist(playerId: string, state: PlayerState): Promise<void> {
    this.persistCalls += 1;
    if (this.failPersist) {
      throw new UserDataStoreError('persist', `保存失敗（テスト）: ${playerId}`);
    }
    this.store.set(playerId, JSON.parse(JSON.stringify(state)) as PlayerState);
  }
}

// ---------------------------------------------------------------------------
// 最小コンテキスト（数件のスポット・地域・アイテム）
// ---------------------------------------------------------------------------

const noReward: RewardGrant = { coins: 0, experience: 0, items: [] };

function makeSpot(id: string, regionId: string, reward: RewardGrant = noReward): Spot {
  return {
    id,
    name: `spot-${id}`,
    description: `説明 ${id}`,
    center: { lat: 33.84, lng: 132.77 },
    entryRadiusMeters: 50,
    regionId,
    firstVisitReward: reward,
  };
}

function makeRegion(id: string, predecessorId: string | null, unlockStampCount: number): Region {
  return {
    id,
    name: `地域-${id}`,
    predecessorId,
    unlockCondition: { kind: 'stampCount', requiredCount: unlockStampCount },
  };
}

function makeShopItem(id: string, priceCoins: number): ShopItem {
  return {
    id,
    name: `item-${id}`,
    priceCoins,
    effectDescription: '効果',
    slot: 'weapon',
    statEffects: { attack: 1 },
    isLimited: false,
  };
}

// 2 地域・複数スポット・アイテムカタログを持つ最小コンテキスト。
// r1 は初期解放地域、r2 は「相異なるスタンプ 2 個」で解放される。
const REGION_1 = 'r1';
const REGION_2 = 'r2';

const spots: Spot[] = [
  makeSpot('s1', REGION_1, { coins: 10, experience: 0, items: [] }),
  makeSpot('s2', REGION_1, { coins: 10, experience: 0, items: [] }),
  makeSpot('s3', REGION_2),
];

const regions: Region[] = [
  makeRegion(REGION_1, null, 1),
  makeRegion(REGION_2, REGION_1, 2), // 相異なるスタンプ 2 個で解放
];

const bosses: Boss[] = [];
const titles: TitleDefinition[] = [];

const itemCatalog: ItemCatalog = {
  potion: makeShopItem('potion', 30),
};

function makeContext(): SessionStoreContext {
  return {
    spots,
    regions,
    bosses,
    titles,
    itemCatalog,
    unlockOrder: [REGION_1, REGION_2],
  };
}

const PLAYER_ID = 'player-1';

/** r1 のみ解放済みの初期状態（コインは指定可能）。 */
function makeInitialState(coins = 0): PlayerState {
  return { ...createInitialPlayerState(PLAYER_ID, REGION_1), coins };
}

function makeStore(
  store: UserDataStore,
  initial: PlayerState
): { sessionStore: SessionStore; notifications: StoreNotification[] } {
  const controller = new PersistenceController(store, PLAYER_ID, initial);
  const sessionStore = new SessionStore(controller, initial, makeContext());
  const notifications: StoreNotification[] = [];
  sessionStore.subscribe((n) => notifications.push(n));
  return { sessionStore, notifications };
}

// ---------------------------------------------------------------------------
// 地域アンロック通知の順序（Req 10.4, 10.6）
// ---------------------------------------------------------------------------

describe('地域アンロック通知（Req 10.4, 10.6）', () => {
  it('永続化が成功した場合のみ、解放を確定し region-unlocked 通知を発行する', async () => {
    const backend = new ToggleableUserDataStore();
    // r2 解放条件（相異なるスタンプ 2 個）を満たす初期状態を用意する。
    const initial: PlayerState = {
      ...makeInitialState(),
      stamps: [
        { spotId: 's1', earnedAt: '2024-01-01T00:00:00.000Z' },
        { spotId: 's2', earnedAt: '2024-01-01T00:00:00.000Z' },
      ],
    };
    const { sessionStore, notifications } = makeStore(backend, initial);

    const result = await sessionStore.tryUnlockNextRegion();

    expect(result.ok).toBe(true);
    expect(result.unlockedRegionId).toBe(REGION_2);
    // 解放が確定し、状態へ反映されている（Req 10.4）。
    expect(sessionStore.getState().unlockedRegionIds).toContain(REGION_2);
    // 通知は永続化確定後に発行される（Req 10.6）。
    expect(notifications).toEqual([
      { kind: 'region-unlocked', regionId: REGION_2, regionName: '地域-r2' },
    ]);
  });

  it('永続化が失敗した場合は解放を確定せず、通知も発行しない（Req 10.5, 10.6）', async () => {
    const backend = new ToggleableUserDataStore();
    backend.failPersist = true; // 永続化を常に失敗させる
    const initial: PlayerState = {
      ...makeInitialState(),
      stamps: [
        { spotId: 's1', earnedAt: '2024-01-01T00:00:00.000Z' },
        { spotId: 's2', earnedAt: '2024-01-01T00:00:00.000Z' },
      ],
    };
    const { sessionStore, notifications } = makeStore(backend, initial);

    const result = await sessionStore.tryUnlockNextRegion();

    expect(result.ok).toBe(false);
    expect(result.unlockedRegionId).toBeNull();
    // 解放は確定せず、ロック状態のまま維持される。
    expect(sessionStore.getState().unlockedRegionIds).not.toContain(REGION_2);
    // 通知は一切発行されない（順序保証: 確定の「後」のみ）。
    expect(notifications).toHaveLength(0);
  });

  it('解放条件が未達なら何もせず（通知なし）成功を返す', async () => {
    const backend = new ToggleableUserDataStore();
    // スタンプ 1 個のみ（r2 は 2 個要求）。
    const initial: PlayerState = {
      ...makeInitialState(),
      stamps: [{ spotId: 's1', earnedAt: '2024-01-01T00:00:00.000Z' }],
    };
    const { sessionStore, notifications } = makeStore(backend, initial);

    const result = await sessionStore.tryUnlockNextRegion();

    expect(result.ok).toBe(true);
    expect(result.unlockedRegionId).toBeNull();
    expect(notifications).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 購入確定メッセージ（Req 7.8）
// ---------------------------------------------------------------------------

describe('購入確定（Req 7.8）', () => {
  it('永続化成功時は saved:true を返し、コイン控除・所持追加が確定する', async () => {
    const backend = new InMemoryUserDataStore();
    const initial = makeInitialState(100);
    const { sessionStore } = makeStore(backend, initial);

    const result = await sessionStore.purchaseItem('potion');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.saved).toBe(true);
    expect(result.state.coins).toBe(70); // 100 - 30
    expect(result.state.ownedItemIds).toContain('potion');
  });

  it('永続化失敗時は saved:false を返すが、セッション状態（購入結果）は保全される', async () => {
    const backend = new ToggleableUserDataStore();
    backend.failPersist = true;
    const initial = makeInitialState(100);
    const { sessionStore } = makeStore(backend, initial);

    const result = await sessionStore.purchaseItem('potion');

    // 保存不可だが購入自体は成功扱いで、セッション状態は保全される（Req 7.7, 7.8）。
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.saved).toBe(false);
    expect(sessionStore.getState().coins).toBe(70);
    expect(sessionStore.getState().ownedItemIds).toContain('potion');
  });

  it('コイン残高不足の購入は状態を変更せず購入エラーを返す（Req 7.3）', async () => {
    const backend = new InMemoryUserDataStore();
    const initial = makeInitialState(10); // 価格 30 に満たない
    const { sessionStore } = makeStore(backend, initial);

    const result = await sessionStore.purchaseItem('potion');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('purchase');
    expect(sessionStore.getState().coins).toBe(10);
    expect(sessionStore.getState().ownedItemIds).not.toContain('potion');
  });

  it('未知アイテムの購入は unknownItem エラーを返す', async () => {
    const backend = new InMemoryUserDataStore();
    const { sessionStore } = makeStore(backend, makeInitialState(100));

    const result = await sessionStore.purchaseItem('does-not-exist');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unknownItem');
  });
});

// ---------------------------------------------------------------------------
// スタンプ保存失敗時のロールバック表示（Req 3.4）
// ---------------------------------------------------------------------------

describe('スタンプ保存失敗時のロールバック（Req 3.4）', () => {
  let backend: ToggleableUserDataStore;

  beforeEach(() => {
    backend = new ToggleableUserDataStore();
  });

  it('永続化成功時はスタンプ付与・初回訪問報酬が確定する', async () => {
    const initial = makeInitialState();
    const { sessionStore } = makeStore(backend, initial);

    const result = await sessionStore.visitSpot('s1', '2024-01-01T00:00:00.000Z');

    expect(result.ok).toBe(true);
    expect(result.state.stamps.map((s) => s.spotId)).toContain('s1');
    expect(result.state.coins).toBe(10); // s1 初回訪問報酬
  });

  it('永続化失敗時はスタンプ付与を確定せず、直前の永続済み状態へロールバックする', async () => {
    const initial = makeInitialState();
    const { sessionStore } = makeStore(backend, initial);

    backend.failPersist = true;
    const result = await sessionStore.visitSpot('s1', '2024-01-01T00:00:00.000Z');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('persistence');
    // 確定済み状態は操作前から変化しない（スタンプ未付与・コイン不変）。
    expect(result.state.stamps).toHaveLength(0);
    expect(result.state.coins).toBe(0);
    expect(sessionStore.getState().stamps).toHaveLength(0);
    expect(sessionStore.getState().coins).toBe(0);
  });

  it('保存失敗後に再び成功する永続化では、その後の訪問が正しく確定する', async () => {
    const initial = makeInitialState();
    const { sessionStore } = makeStore(backend, initial);

    // 1 回目: 失敗 → ロールバック。
    backend.failPersist = true;
    const failed = await sessionStore.visitSpot('s1', '2024-01-01T00:00:00.000Z');
    expect(failed.ok).toBe(false);
    expect(sessionStore.getState().stamps).toHaveLength(0);

    // 2 回目: 成功 → 確定。
    backend.failPersist = false;
    const ok = await sessionStore.visitSpot('s1', '2024-01-01T00:00:00.000Z');
    expect(ok.ok).toBe(true);
    expect(sessionStore.getState().stamps.map((s) => s.spotId)).toContain('s1');
    expect(sessionStore.getState().coins).toBe(10);
  });
});
