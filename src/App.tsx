// アプリのエントリポイント結線（Task 20.1 / Req 1.3, 3.1, 4.2, 5.3, 10.3, 11.2, 12.6, 12.7）
//
// 本コンポーネントは、これまで個別に実装してきた各層を 1 本のアプリへ結線する。
//   - 起動時に User_Data_Store からプレイヤーデータを読み込む（ローディング/失敗時再試行, Req 12.6, 12.7）。
//   - 状態管理層（PersistenceController + SessionStore）を構築する。
//   - Location_Service による位置取得 → スポット入場判定 → スタンプ付与 → クエスト進行
//     → 報酬付与 → 地域アンロック → 称号付与の一連のフローを結線する
//     （Req 1.3, 3.1, 4.2, 5.3, 10.3, 11.2）。
//   - 各ビュー（Map/Character/Shop/Quests/Collections）を AppLayout のビューレジストリへ接続する。
//
// 【バックエンドについて】
// AWS バックエンド（VITE_API_BASE_URL）が未デプロイのため、本 MVP ではローカル/開発用に
// `InMemoryUserDataStore` をシードして使用する。ゲーム定義は `src/data/sampleContent.ts`
// に分離しており、実運用では Repository 層の `createUserDataStore`（HTTP 実装,
// VITE_API_BASE_URL）へ差し替える。下記 `createDataStore` のコメントを参照。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppLayout, type LoadStatus, type ViewRegistry } from './ui/AppLayout';
import { MapView } from './ui/views/MapView';
import { LeafletMapSurface } from './ui/views/LeafletMapSurface';
import { CharacterView } from './ui/views/CharacterView';
import { ShopView, type PurchaseOutcome } from './ui/views/ShopView';
import { QuestsView } from './ui/views/QuestsView';
import { CollectionsView } from './ui/views/CollectionsView';
import { FriendsView } from './ui/views/FriendsView';

import { LocationService } from './services/locationService';
import {
  InMemoryUserDataStore,
  UserDataStoreError,
  type UserDataStore,
  // 実運用ではこちらを使用する（HTTP 実装, VITE_API_BASE_URL）:
  // createUserDataStore,
} from './repository/userDataStore';
import { PersistenceController } from './state/persistenceController';
import {
  createSessionStore,
  type SessionStore,
  type StoreNotification,
} from './state/store';
import type { ItemCatalog, PlayerState } from './domain/types';
import { isAvailable } from './domain/boss';
import { InMemoryFriendRepository } from './repository/friendRepository';
import './ui/styles/App.css';

import {
  BOSSES,
  COLLECTIONS,
  ITEM_CATALOG,
  SPOTS,
  TITLES,
  TOTAL_SPOTS,
  createGameContext,
  createGameInitialState,
} from './data/gameContent';

// ローカル開発用の固定プレイヤー id（実運用では認証から取得する）。
const PLAYER_ID = 'local-player';

// 初期データ取得のタイムアウト（Req 12.6, 12.8: 10 秒）。
const LOAD_TIMEOUT_MS = 10_000;

// 地域アンロック通知バナーの表示時間（ミリ秒）。
const REGION_BANNER_MS = 5_000;

/**
 * 使用する User_Data_Store を生成する。
 *
 * 開発/ローカル: `InMemoryUserDataStore`（保存データはメモリ上、シードなしで開始し、
 *   初回起動時に初期状態を作成・保存する）。
 *
 * 実運用（バックエンド デプロイ後）: 以下に差し替える。
 *   return createUserDataStore(); // HTTP 実装。環境変数 VITE_API_BASE_URL を使用。
 */
function createDataStore(): UserDataStore {
  return new InMemoryUserDataStore();
}

/** `store.load` に 10 秒のタイムアウトを付与する（Req 12.6, 12.8）。 */
function loadWithTimeout(
  store: UserDataStore,
  playerId: string,
  timeoutMs: number
): Promise<PlayerState> {
  return Promise.race([
    store.load(playerId),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), timeoutMs);
    }),
  ]);
}

/** 「データが存在しない（新規プレイヤー）」を表す取得失敗かどうかを判定する。 */
function isNotFound(error: unknown): boolean {
  return error instanceof UserDataStoreError && error.status === 404;
}

export function App() {
  // 初期データ取得状態（Req 12.7: loading / Req 12.8: error / ready）。
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading');
  // 現在の確定済みプレイヤー状態（ストアの getState を反映）。
  const [player, setPlayer] = useState<PlayerState | null>(null);
  // 現在位置（精度 50m 以内が取れている場合）。無ければ null（Req 2.6）。
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  // 現在位置の水平精度（メートル）。精度円表示に用いる。
  const [positionAccuracy, setPositionAccuracy] = useState<number | undefined>(undefined);
  // 位置取得に関するメッセージ（権限拒否 Req 1.6 / タイムアウト Req 1.7 など）。
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  // レベルアップ通知（Req 6.3）。CharacterView へ渡す。
  const [levelUp, setLevelUp] = useState<{ newLevel: number } | null>(null);
  // 地域アンロックの一時バナー（Req 10.6）。
  const [regionBanner, setRegionBanner] = useState<string | null>(null);
  // 画面上部に出すトースト通知（レベルアップ・ドロップなど）。
  const [toast, setToast] = useState<string | null>(null);

  // 副作用を持つインフラは生成を 1 回に固定する（再レンダーで作り直さない）。
  const dataStoreRef = useRef<UserDataStore | null>(null);
  if (dataStoreRef.current === null) {
    dataStoreRef.current = createDataStore();
  }
  const locationServiceRef = useRef<LocationService | null>(null);
  if (locationServiceRef.current === null) {
    locationServiceRef.current = new LocationService();
  }
  // フレンドリポジトリ（インメモリ実装）
  const friendRepoRef = useRef<InMemoryFriendRepository | null>(null);
  if (friendRepoRef.current === null) {
    friendRepoRef.current = new InMemoryFriendRepository();
  }
  // 静的コンテキスト（カタログ群）は不変なのでメモ化する。
  const context = useMemo(() => createGameContext(), []);

  // 構築済みの SessionStore（読み込み成功後に生成）。
  const storeRef = useRef<SessionStore | null>(null);

  /** ストア通知（レベルアップ・地域アンロック・ドロップ）を UI 状態へ反映する。 */
  const handleNotification = useCallback((notification: StoreNotification) => {
    if (notification.kind === 'level-up') {
      // レベルアップ通知を CharacterView に表示させる（Req 6.3）。
      setLevelUp({ newLevel: notification.newLevel });
      // 画面上部にもトーストで知らせる。
      setToast(`🎉 レベルアップ！ レベル ${notification.newLevel} になりました`);
      window.setTimeout(() => setToast(null), REGION_BANNER_MS);
    } else if (notification.kind === 'region-unlocked') {
      // 地域アンロックの一時バナーを表示する（Req 10.6）。
      setRegionBanner(`新しい地域「${notification.regionName}」が解放されました！`);
      window.setTimeout(() => setRegionBanner(null), REGION_BANNER_MS);
    } else {
      // アイテムドロップ通知（ボス・中ボス）。アイテム id を名前へ変換して表示。
      const names = notification.itemIds
        .map((id) => ITEM_CATALOG[id]?.name ?? id)
        .join('、');
      setToast(`⚔️ ${notification.bossName} が「${names}」を落とした！`);
      window.setTimeout(() => setToast(null), REGION_BANNER_MS);
    }
  }, []);

  /**
   * 起動時の読み込み処理（Req 12.6, 12.7, 12.8）。
   * - ローディングを表示しつつ User_Data_Store から読み込む。
   * - データが無い新規プレイヤーは初期状態を作成・保存する（開発シード）。
   * - タイムアウト/その他の失敗時は error 状態にして再試行 UI を出す。
   */
  const initialize = useCallback(async () => {
    const dataStore = dataStoreRef.current!;
    setLoadStatus('loading');
    setLocationMessage(null);

    let state: PlayerState;
    try {
      state = await loadWithTimeout(dataStore, PLAYER_ID, LOAD_TIMEOUT_MS);
    } catch (error) {
      if (isNotFound(error)) {
        // 新規プレイヤー: 初期状態を作成し永続化する（保存に失敗したら error 表示）。
        try {
          const initial = createGameInitialState(PLAYER_ID);
          await dataStore.persist(PLAYER_ID, initial);
          state = initial;
        } catch {
          setLoadStatus('error');
          return;
        }
      } else {
        // タイムアウト・ネットワーク障害など（Req 12.8）。
        setLoadStatus('error');
        return;
      }
    }

    // 状態管理層を構築する（永続化コントローラ + セッションストア）。
    const controller = new PersistenceController(dataStore, PLAYER_ID, state);
    const store = createSessionStore(controller, state, context);
    store.subscribe(handleNotification);
    storeRef.current = store;

    setPlayer(store.getState());
    setLoadStatus('ready');
  }, [context, handleNotification]);

  // 起動時に 1 回だけ読み込む。
  useEffect(() => {
    void initialize();
  }, [initialize]);

  // -------------------------------------------------------------------------
  // ゲームプレイフローの結線
  // -------------------------------------------------------------------------

  /**
   * スポット入場を反映する一連のフロー（Req 1.3, 3.1, 4.2, 5.3, 10.3, 11.2）。
   * スタンプ付与 → クエスト進行 → 初回訪問報酬（visitSpot 内）→ 地域アンロック → 称号付与。
   */
  const enterSpot = useCallback(async (spotId: string) => {
    const store = storeRef.current;
    if (!store) {
      return;
    }
    // スタンプ付与・クエスト進行・初回訪問報酬（Req 3.1, 4.2, 5.3）。
    await store.visitSpot(spotId, new Date().toISOString());
    // 地域アンロック（条件を満たせば次の地域を解放, Req 10.3）。
    await store.tryUnlockNextRegion();
    // 称号付与（条件を満たせば付与, Req 11.2）。
    await store.evaluateTitles();
    setPlayer(store.getState());
  }, []);

  /** 「現在地を確認」: Location_Service で位置を取得し、入場スポットを判定する（Req 1.3）。 */
  const checkLocation = useCallback(async () => {
    const service = locationServiceRef.current!;
    const result = await service.getCurrentPosition();

    if (result.kind !== 'ok') {
      // 権限拒否（Req 1.6）・タイムアウト（Req 1.7）・その他はメッセージを表示し、
      // 既存のスポット入場状態（スタンプ等）は保持する（状態を変更しない）。
      setLocationMessage(result.message);
      return;
    }

    setLocationMessage(null);
    setPosition({ lat: result.position.lat, lng: result.position.lng });
    setPositionAccuracy(result.position.accuracyMeters);

    // 入場スポット判定（Req 1.3, 1.4, 1.5）。
    const presence = service.resolvePresence(result.position, SPOTS);
    if (presence.spotId !== null) {
      await enterSpot(presence.spotId);
    }
  }, [enterSpot]);

  /** 歩行距離を記録する（デモ: 100m 単位, Req 5.1, 5.2）。 */
  const walk = useCallback(async (meters: number) => {
    const store = storeRef.current;
    if (!store) {
      return;
    }
    await store.recordWalk(meters);
    setPlayer(store.getState());
  }, []);

  /** ボスを撃破する（勝利, Req 9.3）。撃破後にアンロック・称号評価も行う。 */
  const defeatBoss = useCallback(async (bossId: string) => {
    const store = storeRef.current;
    if (!store) {
      return;
    }
    await store.defeatBoss(bossId);
    await store.tryUnlockNextRegion();
    await store.evaluateTitles();
    setPlayer(store.getState());
  }, []);

  /** 装備変更（Req 8.3）。ドメイン検証 → 永続化 → 状態反映。 */
  const handleEquip = useCallback(async (itemId: string) => {
    const store = storeRef.current;
    if (!store) {
      return;
    }
    await store.equipItem(itemId);
    setPlayer(store.getState());
  }, []);

  /** 装備解除（外す）。永続化 → 状態反映。 */
  const handleUnequip = useCallback(async (slot: 'weapon' | 'armor' | 'accessory') => {
    const store = storeRef.current;
    if (!store) {
      return;
    }
    await store.unequipItem(slot);
    setPlayer(store.getState());
  }, []);

  /** 購入（Req 7.2, 7.3, 7.7）。ShopView が期待する PurchaseOutcome 形へ変換して返す。 */
  const handlePurchase = useCallback(async (itemId: string): Promise<PurchaseOutcome> => {
    const store = storeRef.current;
    if (!store) {
      return { ok: false, reason: 'insufficient' };
    }
    const result = await store.purchaseItem(itemId);
    setPlayer(store.getState());
    if (!result.ok) {
      // ショップ一覧由来の購入失敗はコイン不足を想定（Req 7.3）。
      return { ok: false, reason: 'insufficient' };
    }
    // saved=false は永続化に失敗したがセッション状態は保全（Req 7.7）。
    return { ok: true, saved: result.saved };
  }, []);

  // -------------------------------------------------------------------------
  // ビューレジストリの組み立て
  // -------------------------------------------------------------------------

  const views: ViewRegistry | undefined = useMemo(() => {
    if (player === null) {
      return undefined;
    }

    // 入場済み（解放済み）エリアに紐づく、利用可能なボス一覧（Req 9.2）。
    const visited = {
      visitedSpotIds: player.stamps.map((s) => s.spotId),
      enteredRegionIds: [...player.unlockedRegionIds],
    };
    const availableBosses = BOSSES.filter((boss) => isAvailable(boss, visited));

    // 市町ボスの解禁判定: その市内の中ボスを全撃破しているか。
    const defeatedSet = new Set(player.defeatedBossIds);
    const spotRegionById = new Map(SPOTS.map((s) => [s.id, s.regionId]));
    const midBossIdsByRegion = new Map<string, string[]>();
    for (const b of BOSSES) {
      if (b.kind === 'midBoss' && b.bind.kind === 'spot') {
        const rid = spotRegionById.get(b.bind.spotId);
        if (rid !== undefined) {
          const list = midBossIdsByRegion.get(rid) ?? [];
          list.push(b.id);
          midBossIdsByRegion.set(rid, list);
        }
      }
    }
    const isRegionBossUnlocked = (boss: (typeof BOSSES)[number]): boolean => {
      if (boss.bind.kind !== 'region') {
        return true;
      }
      const required = midBossIdsByRegion.get(boss.bind.regionId) ?? [];
      return required.every((id) => defeatedSet.has(id));
    };

    // 解放済みかつ未訪問のスポット（デモ用の入場ボタン対象）。
    const stampedSpotIds = new Set(player.stamps.map((s) => s.spotId));
    const visitableSpots = SPOTS.filter(
      (spot) =>
        player.unlockedRegionIds.includes(spot.regionId) && !stampedSpotIds.has(spot.id)
    );

    // スポット id → 名前のルックアップ（QuestsView の残り未達条件表示に使用）。
    const spotNameById = new Map(SPOTS.map((s) => [s.id, s.name]));

    // ショップは解放済み地域のアイテムのみ並べる（地域ゲート）。
    // 地域に紐づかないアイテムは常に表示。限定アイテムは listPurchasable 側で除外される。
    const unlockedSet = new Set(player.unlockedRegionIds);
    const shopCatalog: ItemCatalog = {};
    for (const [id, item] of Object.entries(ITEM_CATALOG)) {
      if (item.regionId === undefined || unlockedSet.has(item.regionId)) {
        shopCatalog[id] = item;
      }
    }

    // Map ビューは「現在地確認 + 開発用操作 + 地図」を合成して提供する。
    const mapNode = (
      <div className="app-map-pane">
        {regionBanner !== null && (
          <p className="app-banner app-banner--region" role="status">
            {regionBanner}
          </p>
        )}
        {locationMessage !== null && (
          <p className="app-banner app-banner--warning" role="alert">
            {locationMessage}
          </p>
        )}

        <div className="app-actions">
          <button type="button" className="app-actions__primary" onClick={checkLocation}>
            現在地を確認
          </button>
        </div>

        {/* 開発用コントロール（MVP の動作確認用。連続位置取得は対象外のため手動操作）。 */}
        <details className="app-devtools">
          <summary>開発ツール（デモ操作）</summary>
          <div className="app-devtools__group">
            <span className="app-devtools__label">スポットに入場</span>
            {visitableSpots.length === 0 ? (
              <p className="app-devtools__empty">入場可能な未訪問スポットはありません。</p>
            ) : (
              visitableSpots.map((spot) => (
                <button key={spot.id} type="button" onClick={() => void enterSpot(spot.id)}>
                  {spot.name} に入場
                </button>
              ))
            )}
          </div>
          <div className="app-devtools__group">
            <span className="app-devtools__label">歩行</span>
            <button type="button" onClick={() => void walk(100)}>
              100m 歩く
            </button>
            <button type="button" onClick={() => void walk(550)}>
              550m 歩く
            </button>
          </div>
          <div className="app-devtools__group">
            <span className="app-devtools__label">ボスバトル</span>
            {availableBosses.length === 0 ? (
              <p className="app-devtools__empty">挑戦できるボスはいません。</p>
            ) : (
              availableBosses.map((boss) => {
                const locked = boss.kind === 'boss' && !isRegionBossUnlocked(boss);
                return (
                  <button
                    key={boss.id}
                    type="button"
                    disabled={locked}
                    title={locked ? '市内の中ボスを全て倒すと解禁されます' : undefined}
                    onClick={() => void defeatBoss(boss.id)}
                  >
                    {boss.kind === 'midBoss' ? '【中ボス】' : '【ボス】'}
                    {boss.name ?? boss.id}
                    {locked ? '（中ボス全撃破で解禁）' : ' に勝利'}
                  </button>
                );
              })
            )}
          </div>
        </details>

        <MapView
          player={player}
          spots={SPOTS}
          position={position}
          positionAccuracyMeters={positionAccuracy}
          renderSurface={(surfaceProps) => <LeafletMapSurface {...surfaceProps} />}
        />
      </div>
    );

    return {
      map: mapNode,
      character: (
        <CharacterView
          player={player}
          itemCatalog={ITEM_CATALOG}
          onEquip={(itemId) => void handleEquip(itemId)}
          onUnequip={(slot) => void handleUnequip(slot)}
          levelUp={levelUp}
          onDismissLevelUp={() => setLevelUp(null)}
        />
      ),
      shop: (
        <ShopView player={player} itemCatalog={shopCatalog} onPurchase={handlePurchase} />
      ),
      quests: (
        <QuestsView
          player={player}
          spotName={(id) => spotNameById.get(id)}
          visibleRegionIds={player.unlockedRegionIds}
        />
      ),
      collections: (
        <CollectionsView
          player={player}
          totalSpots={TOTAL_SPOTS}
          collections={COLLECTIONS}
          titles={TITLES}
        />
      ),
      friends: (
        <FriendsView
          currentUserId={PLAYER_ID}
          repository={friendRepoRef.current!}
        />
      ),
    };
  }, [
    player,
    position,
    positionAccuracy,
    levelUp,
    locationMessage,
    regionBanner,
    checkLocation,
    enterSpot,
    walk,
    defeatBoss,
    handleEquip,
    handleUnequip,
    handlePurchase,
  ]);

  return (
    <>
      {toast !== null && (
        <div className="app-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
      <AppLayout loadStatus={loadStatus} onRetry={() => void initialize()} views={views} />
    </>
  );
}
