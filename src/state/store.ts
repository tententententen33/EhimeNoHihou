// セッション状態ストア（Task 15.2）
//
// 本モジュールは状態管理層の中核として、セッション状態（現在の確定済み
// `PlayerState`）と各種カタログ・コンテキスト（スポット・地域・ボス・称号・
// アイテムカタログ・アンロック順序）を保持し、純粋ドメイン関数群
// （stamp / quest / reward / character / shop / boss / map / title / collection）
// を結線して「次状態」を計算する。計算した次状態の永続化は
// `PersistenceController`（Task 15.1）へ受け渡す。
//
// 永続化方針（設計書 Error Handling）:
// - ロールバック型（スタンプ・報酬・装備・称号）: `commitWithRollback` を用い、
//   永続化が成功するまで確定とせず、失敗時は直前の永続済み状態へ復元する
//   （Req 3.4, 4.6, 5.7, 8.6, 11.5）。
// - 再試行型（購入・地域アンロック）: `enqueueRetry` + `sync` を用い、最大 3 回
//   まで再試行する。購入はセッション状態に購入結果を保全し（Req 7.6, 7.7）、
//   地域アンロックは永続化が確定するまで解放を確定しない（Req 10.4, 10.5）。
//
// 通知順序の保証（Req 10.6）:
// - 地域アンロックの通知（region-unlocked）は、永続化が確定した「後」にのみ
//   発行する。永続化が失敗した場合は解放を確定せず、通知も発行しない。
// - レベルアップ通知（level-up）は、報酬適用後の確定状態でレベルが上昇した
//   場合にのみ発行する。
//
// 本ストアはセッション状態（this.state）を保持するが、状態計算自体は純粋
// ドメイン層へ委ね、ここでは「ドメイン関数の結線」と「永続化の受け渡し・
// 通知の発行」に専念する。

import type {
  Boss,
  EquipmentSlot,
  ISODateTime,
  ItemCatalog,
  PlayerState,
  QuestProgress,
  Region,
  Spot,
  TitleDefinition,
} from '../domain/types';

import { grantStampIfAbsent } from '../domain/stamp';
import { applyStamp } from '../domain/quest';
import { applyReward, grantQuestCompletionReward } from '../domain/reward';
import { computeWalkReward } from '../domain/reward';
import {
  equip,
  unequip,
  levelForExperience,
  type EquipError,
} from '../domain/character';
import { purchase, type PurchaseError } from '../domain/shop';
import { isAvailable, resolveWin, type VisitedAreas } from '../domain/boss';
import {
  canUnlockNext,
  unlockRegion,
  type RegionUnlockContext,
} from '../domain/map';
import { grantIfEarned } from '../domain/title';

import {
  PersistenceController,
  type PersistenceError,
} from './persistenceController';

// ---------------------------------------------------------------------------
// 通知（subscribe で購読する）
// ---------------------------------------------------------------------------

/** レベルアップ通知（Req 6.3）。報酬適用後にレベルが上昇したとき発行する。 */
export interface LevelUpNotification {
  kind: 'level-up';
  /** 上昇前のレベル */
  previousLevel: number;
  /** 上昇後の新しいレベル */
  newLevel: number;
}

/** 地域アンロック通知（Req 10.6）。永続化確定後にのみ発行する。 */
export interface RegionUnlockedNotification {
  kind: 'region-unlocked';
  /** 解放された Region の id */
  regionId: string;
  /** 解放された Region の表示名（未知の場合は id を流用） */
  regionName: string;
}

/** アイテムドロップ通知。ボス・中ボス撃破で確率ドロップや限定アイテムを得たとき発行する。 */
export interface ItemDroppedNotification {
  kind: 'item-dropped';
  /** ドロップ元のボス表示名 */
  bossName: string;
  /** 獲得したアイテム id 一覧（確率ドロップ＋新規限定アイテム） */
  itemIds: string[];
}

/** ストアが発行する通知の判別共用体。 */
export type StoreNotification =
  | LevelUpNotification
  | RegionUnlockedNotification
  | ItemDroppedNotification;

/** 通知購読リスナ。 */
export type NotificationListener = (notification: StoreNotification) => void;

// ---------------------------------------------------------------------------
// アクション結果・エラー型
// ---------------------------------------------------------------------------

/**
 * ストアアクションの失敗理由。
 * - persistence: 永続化に失敗した（ロールバック済み、または保存不可）。
 * - purchase: 購入のドメイン検証に失敗した（コイン不足）。
 * - equip: 装備のドメイン検証に失敗した（未所持・スロット不適合など）。
 * - bossUnavailable: ボスが未入場で可用でない。
 * - unknownBoss / unknownItem: 指定 id がカタログに存在しない。
 */
export type StoreError =
  | { kind: 'persistence'; error: PersistenceError }
  | { kind: 'purchase'; error: PurchaseError }
  | { kind: 'equip'; error: EquipError }
  | { kind: 'bossUnavailable'; bossId: string }
  | { kind: 'bossPrerequisite'; bossId: string }
  | { kind: 'unknownBoss'; bossId: string }
  | { kind: 'unknownItem'; itemId: string };

/** ロールバック型アクション（visitSpot / recordWalk / equipItem / defeatBoss）の結果。 */
export type CommitActionResult =
  | { ok: true; state: PlayerState }
  | { ok: false; state: PlayerState; error: StoreError };

/** 称号評価アクションの結果（付与された称号 id を併せて返す）。 */
export type TitleActionResult =
  | { ok: true; state: PlayerState; grantedTitleIds: string[] }
  | { ok: false; state: PlayerState; error: StoreError };

/** 購入アクションの結果（saved: 今回の同期で永続化が確定したか）。 */
export type PurchaseActionResult =
  | { ok: true; state: PlayerState; saved: boolean }
  | { ok: false; state: PlayerState; error: StoreError };

/** 地域アンロックアクションの結果（unlockedRegionId: 今回確定した解放地域、無ければ null）。 */
export type RegionUnlockActionResult =
  | { ok: true; state: PlayerState; unlockedRegionId: string | null }
  | { ok: false; state: PlayerState; unlockedRegionId: null; error: StoreError };

// ---------------------------------------------------------------------------
// ストア構築コンテキスト
// ---------------------------------------------------------------------------

/**
 * セッションストアが結線時に参照する静的コンテキスト（カタログ群）。
 * これらはゲーム定義であり、プレイヤー状態とは独立に保持する。
 */
export interface SessionStoreContext {
  /** 全スポット定義（マーカー生成・初回訪問報酬・地域メンバーシップに使用）。 */
  spots: Spot[];
  /** 全地域定義（アンロック条件の評価に使用）。 */
  regions: Region[];
  /** 全ボス定義（可用性判定・勝利解決に使用）。 */
  bosses: Boss[];
  /** 全称号定義（称号付与の評価に使用）。 */
  titles: TitleDefinition[];
  /** アイテムカタログ（購入・装備に使用）。 */
  itemCatalog: ItemCatalog;
  /** Region id の全順序（Spot_Manager の getUnlockOrder）。 */
  unlockOrder: string[];
  /**
   * 地域アンロック条件の評価コンテキスト（spots-per-region 等）。
   * 省略時は `spots` の `regionId` から自動導出する。
   */
  regionUnlockContext?: RegionUnlockContext;
}

// ---------------------------------------------------------------------------
// 内部ユーティリティ
// ---------------------------------------------------------------------------

/** スポット集合から Region id ごとの所属スポット id 集合を構築する。 */
function buildSpotIdsByRegion(spots: Spot[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const spot of spots) {
    (map[spot.regionId] ??= []).push(spot.id);
  }
  return map;
}

// ---------------------------------------------------------------------------
// SessionStore
// ---------------------------------------------------------------------------

/**
 * セッション状態ストア。
 *
 * 現在の確定済み `PlayerState`（this.state）と静的コンテキストを保持し、
 * 高レベルアクション（訪問・歩行・購入・装備・ボス撃破・称号評価・地域解放）を
 * 提供する。各アクションは適切なドメイン関数で次状態を計算し、永続化方針
 * （ロールバック型 / 再試行型）に従って `PersistenceController` へ受け渡す。
 */
export class SessionStore {
  private readonly controller: PersistenceController;

  /** 現在の確定済みセッション状態。 */
  private state: PlayerState;

  // --- 静的コンテキスト（高速参照用に id マップを構築して保持） ---
  private readonly spotsById: Map<string, Spot>;
  private readonly regions: Region[];
  private readonly regionsById: Map<string, Region>;
  private readonly bossesById: Map<string, Boss>;
  private readonly titles: TitleDefinition[];
  private readonly itemCatalog: ItemCatalog;
  private readonly unlockOrder: string[];
  private readonly regionUnlockContext: RegionUnlockContext;

  /** Region id → その地域に属する中ボス（midBoss）id 一覧。ボス解禁条件の判定に使う。 */
  private readonly midBossIdsByRegion: Map<string, string[]>;

  /** 通知購読リスナ集合。 */
  private readonly listeners = new Set<NotificationListener>();

  /** 再試行型保留項目 id の自動採番カウンタ。 */
  private retryCounter = 0;

  /**
   * @param controller 永続化コントローラ（Task 15.1）。
   * @param initialState 起動時にロード済みの確定状態（セッションの初期値）。
   * @param context 静的コンテキスト（スポット・地域・ボス・称号・カタログ・順序）。
   */
  constructor(
    controller: PersistenceController,
    initialState: PlayerState,
    context: SessionStoreContext
  ) {
    this.controller = controller;
    this.state = initialState;

    this.spotsById = new Map(context.spots.map((s) => [s.id, s]));
    this.regions = context.regions;
    this.regionsById = new Map(context.regions.map((r) => [r.id, r]));
    this.bossesById = new Map(context.bosses.map((b) => [b.id, b]));
    this.titles = context.titles;
    this.itemCatalog = context.itemCatalog;
    this.unlockOrder = [...context.unlockOrder];
    this.regionUnlockContext =
      context.regionUnlockContext ?? {
        spotIdsByRegion: buildSpotIdsByRegion(context.spots),
      };

    // 中ボス（kind==='midBoss', spot 紐付け）を、所属スポットの地域別に集計する。
    // ボス（市町ボス）の解禁条件「市内の中ボスを全撃破」の判定に用いる。
    const spotRegionById = new Map(context.spots.map((s) => [s.id, s.regionId]));
    const midMap = new Map<string, string[]>();
    for (const boss of context.bosses) {
      if (boss.kind === 'midBoss' && boss.bind.kind === 'spot') {
        const regionId = spotRegionById.get(boss.bind.spotId);
        if (regionId !== undefined) {
          (midMap.get(regionId) ?? midMap.set(regionId, []).get(regionId)!).push(boss.id);
        }
      }
    }
    this.midBossIdsByRegion = midMap;
  }

  // -------------------------------------------------------------------------
  // 状態・通知の参照
  // -------------------------------------------------------------------------

  /** 現在のセッション状態を返す。 */
  getState(): PlayerState {
    return this.state;
  }

  /**
   * 通知（レベルアップ・地域アンロック）を購読する。
   * @returns 購読解除関数。
   */
  subscribe(listener: NotificationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 登録済みリスナへ通知を発行する。 */
  private emit(notification: StoreNotification): void {
    for (const listener of this.listeners) {
      listener(notification);
    }
  }

  /** 報酬適用前後でレベルが上昇していればレベルアップ通知を発行する（Req 6.3）。 */
  private emitLevelUpIfRaised(before: PlayerState, after: PlayerState): void {
    const previousLevel = levelForExperience(before.experience);
    const newLevel = levelForExperience(after.experience);
    if (newLevel > previousLevel) {
      this.emit({ kind: 'level-up', previousLevel, newLevel });
    }
  }

  /** 現在の状態からボス可用性判定用の入場済みエリアを導出する。 */
  private visitedAreas(): VisitedAreas {
    return {
      visitedSpotIds: this.state.stamps.map((s) => s.spotId),
      enteredRegionIds: [...this.state.unlockedRegionIds],
    };
  }

  // -------------------------------------------------------------------------
  // 共通: ロールバック型コミット
  // -------------------------------------------------------------------------

  /**
   * ロールバック型操作の次状態を永続化コントローラへ受け渡して確定する。
   *
   * 成功時はセッション状態を確定状態へ更新し、レベルアップ通知を評価する。
   * 失敗時はセッション状態を直前の永続済み状態へ復元し、永続化エラーを返す
   * （確定済み状態は操作前から変化しない）。
   *
   * @param before コミット前の状態（レベルアップ判定の基準）。
   * @param next コミット候補となる楽観的更新後の状態。
   */
  private async commitRollback(
    before: PlayerState,
    next: PlayerState
  ): Promise<CommitActionResult> {
    const result = await this.controller.commitWithRollback(next);
    if (result.ok) {
      this.state = result.committed;
      this.emitLevelUpIfRaised(before, this.state);
      return { ok: true, state: this.state };
    }
    // 永続化失敗: 直前の永続済み状態へ復元する（Req 3.4, 4.6, 5.7, 8.6, 11.5）。
    this.state = result.rollbackState;
    return {
      ok: false,
      state: this.state,
      error: { kind: 'persistence', error: result.error },
    };
  }

  /**
   * スタンプ付与に伴うクエスト進行・完了報酬を反映した次状態を計算する。
   *
   * - 各クエストへスタンプを反映（`applyStamp`、相異なるスポットのみ進行）。
   * - 完了かつ未付与のクエストに対し完了報酬を一度だけ付与（`grantQuestCompletionReward`）。
   *
   * 純粋計算であり、永続化・副作用は行わない。
   */
  private advanceQuests(state: PlayerState, spotId: string): PlayerState {
    // 1) 全クエストへスタンプ付与を反映する（Req 4.2, 4.3）。
    let working: PlayerState = {
      ...state,
      quests: state.quests.map((q) => applyStamp(q, spotId)),
    };

    // 2) 完了クエストの報酬を一度だけ付与する（Req 4.5）。
    const updatedQuests: QuestProgress[] = [];
    for (const quest of working.quests) {
      const res = grantQuestCompletionReward(working, quest);
      working = res.nextState; // コイン・経験値・アイテムの加算を反映
      updatedQuests.push(res.quest); // rewardGranted 更新後のクエスト
    }
    working = { ...working, quests: updatedQuests };

    return working;
  }

  // -------------------------------------------------------------------------
  // アクション: スポット訪問（スタンプ + クエスト進行 + 初回訪問報酬）
  // -------------------------------------------------------------------------

  /**
   * スポットへの入場を反映する（Req 3.1, 4.5, 5.3）。
   *
   * 新規訪問（スタンプ未取得）の場合のみ:
   *   1. スタンプを 1 つ付与（`grantStampIfAbsent`）。
   *   2. 当該スポットの初回訪問報酬を適用（`applyReward`）。
   *   3. クエスト進行を反映し、完了報酬を一度だけ付与（`advanceQuests`）。
   *   4. ロールバック型でコミットし、レベルアップ通知を評価。
   * 既訪問（スタンプ取得済み）の場合は据え置き、永続化を行わず成功を返す。
   *
   * @param spotId 入場スポットの識別子。
   * @param now スタンプ付与日時（ISO 8601）。
   */
  async visitSpot(spotId: string, now: ISODateTime): Promise<CommitActionResult> {
    const before = this.state;

    // スタンプ付与（未取得時のみ新規付与, Req 3.1）。
    const stampResult = grantStampIfAbsent(before, spotId, now);
    if (!stampResult.granted) {
      // 既訪問: 据え置き。永続化は不要（状態は不変）。
      return { ok: true, state: this.state };
    }

    let next = stampResult.nextState;

    // 初回訪問報酬（Req 5.3）。スポット定義が存在する場合に付与する。
    const spot = this.spotsById.get(spotId);
    if (spot) {
      next = applyReward(next, spot.firstVisitReward);
    }

    // クエスト進行・完了報酬（Req 4.2, 4.3, 4.5）。
    next = this.advanceQuests(next, spotId);

    return this.commitRollback(before, next);
  }

  // -------------------------------------------------------------------------
  // アクション: 歩行距離記録（歩行コイン）
  // -------------------------------------------------------------------------

  /**
   * 歩行距離を記録し、完了 100m ごとのコインを付与する（Req 5.1, 5.2）。
   *
   * 繰り越し距離（`pendingWalkMeters`）と今回距離から付与コインと次の繰り越しを
   * 計算し（`computeWalkReward`）、コインと繰り越しを更新してロールバック型で
   * コミットする。
   *
   * @param addedMeters 今回追加された歩行距離（メートル）。
   */
  async recordWalk(addedMeters: number): Promise<CommitActionResult> {
    const before = this.state;
    const { coinsGranted, carryOverMeters } = computeWalkReward(
      before.pendingWalkMeters,
      addedMeters
    );

    const next: PlayerState = {
      ...before,
      coins: before.coins + coinsGranted,
      pendingWalkMeters: carryOverMeters,
    };

    return this.commitRollback(before, next);
  }

  // -------------------------------------------------------------------------
  // アクション: 装備変更
  // -------------------------------------------------------------------------

  /**
   * 所持アイテムを対応スロットへ装備する（Req 8.3）。
   *
   * ドメイン検証（所持・カタログ存在）に失敗した場合は状態を変更せず装備エラーを
   * 返す。成功時はロールバック型でコミットする（Req 8.6）。
   *
   * @param itemId 装備するアイテム id。
   */
  async equipItem(itemId: string): Promise<CommitActionResult> {
    const before = this.state;
    const result = equip(before, itemId, this.itemCatalog);
    if (!result.ok) {
      return { ok: false, state: this.state, error: { kind: 'equip', error: result.error } };
    }
    return this.commitRollback(before, result.value);
  }

  /**
   * 指定スロットの装備を解除する（外す）。
   *
   * 既に未装備の場合は据え置き（永続化不要）で成功を返す。装備中の場合は
   * 解除してロールバック型でコミットする（Req 8.6）。
   *
   * @param slot 解除する装備スロット。
   */
  async unequipItem(slot: EquipmentSlot): Promise<CommitActionResult> {
    const before = this.state;
    if (before.equipped[slot] === null) {
      // 元から未装備: 状態不変で成功（永続化不要）。
      return { ok: true, state: this.state };
    }
    const next = unequip(before, slot);
    return this.commitRollback(before, next);
  }

  /** 市町ボスの解禁条件（市内の中ボス全撃破）を満たすか判定する。 */
  canFightRegionBoss(bossId: string): boolean {
    const boss = this.bossesById.get(bossId);
    if (boss === undefined || boss.bind.kind !== 'region') {
      // 中ボスや不明なボスは本判定の対象外（true を返す）。
      return true;
    }
    const required = this.midBossIdsByRegion.get(boss.bind.regionId) ?? [];
    const defeated = new Set(this.state.defeatedBossIds);
    return required.every((id) => defeated.has(id));
  }

  // -------------------------------------------------------------------------
  // アクション: ボス撃破
  // -------------------------------------------------------------------------

  /**
   * ボスバトルの勝利を解決する（Req 9.3）。
   *
   * 未知のボス、または未入場で可用でないボスは拒否する（Req 9.2, 9.7）。
   * 可用な場合は報酬付与・撃破記録（`resolveWin`、Limited_Item は未取得時のみ）を
   * 反映し、ロールバック型でコミットする。
   *
   * @param bossId 撃破したボスの id。
   */
  async defeatBoss(bossId: string): Promise<CommitActionResult> {
    const before = this.state;

    const boss = this.bossesById.get(bossId);
    if (boss === undefined) {
      return { ok: false, state: this.state, error: { kind: 'unknownBoss', bossId } };
    }

    // 可用性判定（入場済みエリアに紐づくか, Req 9.2, 9.7）。
    if (!isAvailable(boss, this.visitedAreas())) {
      return { ok: false, state: this.state, error: { kind: 'bossUnavailable', bossId } };
    }

    // 市町ボスは、その市内の中ボスを全撃破していないと戦えない。
    if (boss.kind === 'boss' && !this.canFightRegionBoss(bossId)) {
      return { ok: false, state: this.state, error: { kind: 'bossPrerequisite', bossId } };
    }

    const winResult = resolveWin(before, boss);
    const committed = await this.commitRollback(before, winResult.nextState);

    // 永続化が確定したら、確率ドロップ／新規限定アイテムの取得を通知する。
    if (committed.ok) {
      const droppedIds = [
        ...winResult.droppedItemIds,
        ...winResult.grantedLimitedItemIds,
      ];
      if (droppedIds.length > 0) {
        this.emit({
          kind: 'item-dropped',
          bossName: boss.name ?? boss.id,
          itemIds: droppedIds,
        });
      }
    }
    return committed;
  }

  // -------------------------------------------------------------------------
  // アクション: 称号評価
  // -------------------------------------------------------------------------

  /**
   * 全称号の達成条件を評価し、未付与かつ条件充足の称号を付与する（Req 11.2）。
   *
   * 1 つ以上付与される場合のみロールバック型でコミットする。何も付与されない
   * 場合は据え置き、永続化を行わず成功を返す。
   *
   * @returns 付与された称号 id 一覧を含む結果。
   */
  async evaluateTitles(): Promise<TitleActionResult> {
    const before = this.state;

    let next = before;
    const grantedTitleIds: string[] = [];
    for (const title of this.titles) {
      const res = grantIfEarned(next, title);
      if (res.granted) {
        next = res.nextState;
        grantedTitleIds.push(title.id);
      }
    }

    // 付与が無ければ据え置き（状態不変・永続化不要）。
    if (grantedTitleIds.length === 0) {
      return { ok: true, state: this.state, grantedTitleIds: [] };
    }

    const commit = await this.commitRollback(before, next);
    if (commit.ok) {
      return { ok: true, state: commit.state, grantedTitleIds };
    }
    // 永続化失敗: 称号付与は確定しない（ロールバック済み）。
    return { ok: false, state: commit.state, error: commit.error };
  }

  // -------------------------------------------------------------------------
  // アクション: 購入（再試行型）
  // -------------------------------------------------------------------------

  /**
   * アイテムを購入する（Req 7.2, 7.6, 7.7）。
   *
   * ドメイン検証（残高）に失敗した場合は状態を変更せず購入エラーを返す（Req 7.3）。
   * 成功時は楽観的更新としてセッション状態へ購入結果を反映し、再試行型として
   * 永続化を試みる（最大 3 回）。永続化が 3 回連続で失敗してもセッション状態
   * （購入済みアイテム・更新後残高）は保全し、`saved: false` を返す（Req 7.7）。
   *
   * @param itemId 購入対象アイテム id。
   */
  async purchaseItem(itemId: string): Promise<PurchaseActionResult> {
    const item = this.itemCatalog[itemId];
    if (item === undefined) {
      return { ok: false, state: this.state, error: { kind: 'unknownItem', itemId } };
    }

    const result = purchase(this.state, item);
    if (!result.ok) {
      // 残高不足: 状態不変で拒否（Req 7.3）。
      return { ok: false, state: this.state, error: { kind: 'purchase', error: result.error } };
    }

    // 楽観的更新: 購入結果をセッション状態に反映し保全する（Req 7.6）。
    const next = result.value.nextState;
    this.state = next;

    // 再試行型として永続化を試みる（最大 3 回, Req 7.6, 7.7）。
    const pendingId = `purchase-${itemId}-${++this.retryCounter}`;
    this.controller.enqueueRetry('purchase', next, pendingId);
    const sync = await this.controller.sync();

    const outcome = sync.outcomes.find((o) => o.item.id === pendingId);
    const saved = outcome?.status === 'persisted';

    // 保存可否にかかわらずセッション状態は保全する（Req 7.7）。
    return { ok: true, state: this.state, saved };
  }

  // -------------------------------------------------------------------------
  // アクション: 次の地域アンロック（再試行型・通知は永続化確定後）
  // -------------------------------------------------------------------------

  /**
   * アンロック順序上の次のロック地域を、解放条件を満たす場合に解放する
   * （Req 10.3, 10.4, 10.5, 10.6）。
   *
   * 解放条件を満たさない（または全地域解放済み）場合は何もせず成功を返す。
   * 解放可能な場合は再試行型として解放後状態の永続化を試みる（最大 3 回）。
   * - 永続化が確定した場合のみ解放を確定し、地域アンロック通知を発行する
   *   （通知は永続化確定の「後」のみ, Req 10.6）。
   * - 永続化が失敗した場合は当該地域をロック状態のまま維持し、通知を発行せず
   *   永続化エラーを返す（Req 10.5）。
   */
  async tryUnlockNextRegion(): Promise<RegionUnlockActionResult> {
    const { regionId } = canUnlockNext(
      this.state,
      this.regions,
      this.unlockOrder,
      this.regionUnlockContext
    );

    // 解放対象なし（条件未達・全解放済み）。状態不変で成功。
    if (regionId === null) {
      return { ok: true, state: this.state, unlockedRegionId: null };
    }

    // 解放後状態を計算（永続化確定までは this.state へ反映しない）。
    const unlockedState = unlockRegion(this.state, regionId);

    // 再試行型として永続化を試みる（最大 3 回, Req 10.5）。
    const pendingId = `regionUnlock-${regionId}-${++this.retryCounter}`;
    this.controller.enqueueRetry('regionUnlock', unlockedState, pendingId);
    const sync = await this.controller.sync();

    const outcome = sync.outcomes.find((o) => o.item.id === pendingId);
    if (outcome?.status === 'persisted') {
      // 永続化確定: ここで初めて解放を確定し、通知を発行する（Req 10.4, 10.6）。
      this.state = unlockedState;
      const region = this.regionsById.get(regionId);
      this.emit({
        kind: 'region-unlocked',
        regionId,
        regionName: region?.name ?? regionId,
      });
      return { ok: true, state: this.state, unlockedRegionId: regionId };
    }

    // 永続化失敗: 解放を確定せずロック維持。通知は発行しない（Req 10.5）。
    const error: PersistenceError = {
      kind: 'persist-failed',
      message: '地域の解放を保存できませんでした。解放は確定していません。',
    };
    return { ok: false, state: this.state, unlockedRegionId: null, error: { kind: 'persistence', error } };
  }
}

/**
 * セッションストアを生成するファクトリ。
 *
 * @param controller 永続化コントローラ（Task 15.1）。
 * @param initialState 起動時にロード済みの確定状態。
 * @param context 静的コンテキスト。
 */
export function createSessionStore(
  controller: PersistenceController,
  initialState: PlayerState,
  context: SessionStoreContext
): SessionStore {
  return new SessionStore(controller, initialState, context);
}
