// 永続化失敗時の状態保全と再試行キュー（Task 15.1）
//
// 本モジュールは状態管理層の一部として、`User_Data_Store` への永続化が
// 失敗した場合の「確定前ロールバック」と「再試行キュー」を司る。
// 設計書「Error Handling（永続化・ネットワークエラー）」および永続化フロー
// （Mermaid flowchart）に対応する。
//
// 2 つの方針:
//
// 1. 確定前ロールバック（ロールバック型操作）
//    スタンプ付与（Req 3.4）・報酬付与（Req 4.6, 5.7）・装備変更（Req 8.6）・
//    地域アンロック（Req 10.4）・称号付与（Req 11.5）は、永続化が成功するまで
//    「獲得・確定」として扱わない。永続化が失敗した場合は直前の永続済み状態
//    （lastPersisted）へ復元し、保存失敗を示すエラー指示を返す。確定済み状態は
//    操作前から一切変化しない。
//
// 2. 再試行キュー（再試行型操作・最大 3 回）
//    購入（Req 7.6, 7.7）と地域アンロック（Req 10.5）は、セッション状態に保留項目
//    （pending item）を保持し、次回の同期で最大 MAX_RETRIES 回まで再試行する。
//    3 回連続失敗後も、保留項目（購入済みアイテム・更新後残高などを反映した
//    目標状態）はセッション状態に保全し、保存不可（not-saved）を示す指示を返す。
//    成功した時点で保留項目をキューから除去し、lastPersisted を更新する。
//
// 本コントローラはセッション状態（lastPersisted・保留キュー）を保持するが、
// 状態計算自体は純粋ドメイン層に委ね、ここでは永続化の成否と保全のみを扱う。

import { type PlayerState } from '../domain/types';
import { type UserDataStore } from '../repository/userDataStore';

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/** 再試行型操作の最大再試行回数（Req 7.6, 7.7, 10.5）。 */
export const MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// エラー・結果型
// ---------------------------------------------------------------------------

/** 永続化失敗を表すエラー指示。UI 層は保存失敗メッセージの表示に用いる。 */
export interface PersistenceError {
  kind: 'persist-failed';
  /** 表示・ログ用の説明（日本語）。 */
  message: string;
  /** 元の例外（Repository 層が投げたもの）。 */
  cause?: unknown;
}

/**
 * ロールバック型操作のコミット結果。
 * - 成功: 永続化が成功し、確定状態（committed）が更新された。
 * - 失敗: 永続化が失敗し、確定とはせず直前の永続済み状態（rollbackState）へ
 *   復元すべきことと、エラー指示（error）を返す。
 */
export type CommitResult =
  | { ok: true; committed: PlayerState }
  | { ok: false; rollbackState: PlayerState; error: PersistenceError };

/** 再試行型操作の種別（購入・地域アンロック）。 */
export type RetryKind = 'purchase' | 'regionUnlock';

/** 再試行キューに保持する保留項目。 */
export interface PendingItem {
  /** 保留項目の識別子（キュー内で一意）。 */
  id: string;
  /** 再試行型操作の種別。 */
  kind: RetryKind;
  /** 永続化を試みる目標状態（操作適用後のセッション状態）。 */
  state: PlayerState;
  /** これまでの永続化試行回数（0 以上 MAX_RETRIES 以下）。 */
  attempts: number;
}

/** 同期（sync）における 1 保留項目の処理結果。 */
export interface SyncItemOutcome {
  /** 対象の保留項目（処理後の attempts を反映）。 */
  item: PendingItem;
  /**
   * 結果ステータス。
   * - persisted: 永続化に成功しキューから除去された。
   * - exhausted: MAX_RETRIES 回連続失敗し、保留項目を保全したまま未保存。
   */
  status: 'persisted' | 'exhausted';
}

/** 同期（sync）全体の結果。 */
export interface SyncResult {
  /** 今回の同期で処理した各保留項目の結果。 */
  outcomes: SyncItemOutcome[];
  /** 同期後も保全されている（未保存の）保留項目一覧。 */
  remaining: PendingItem[];
  /**
   * 未保存の保留項目が残っているか（Req 7.7 の保存不可指示に対応）。
   * true の場合、UI 層は保存不可メッセージを表示しつつセッション状態を保全する。
   */
  notSaved: boolean;
}

// ---------------------------------------------------------------------------
// 内部ユーティリティ
// ---------------------------------------------------------------------------

/**
 * `PlayerState` の深いコピーを作る。
 * 保持する確定状態・保留状態が外部の変更で破壊されないよう、参照共有を避ける。
 * `PlayerState` は JSON 直列化可能な純粋データのため JSON クローンで十分。
 */
function clonePlayerState(state: PlayerState): PlayerState {
  return JSON.parse(JSON.stringify(state)) as PlayerState;
}

/** 例外から表示用メッセージを取り出す。 */
function toMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message) {
    return cause.message;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// PersistenceController
// ---------------------------------------------------------------------------

/**
 * 永続化失敗時の状態保全と再試行キューを司るコントローラ。
 *
 * セッション状態として「直前に永続化に成功した状態（lastPersisted）」と
 * 「再試行型操作の保留キュー」を保持する。永続化には注入された
 * `UserDataStore`（失敗を例外で通知）を使用する。
 */
export class PersistenceController {
  private readonly store: UserDataStore;
  private readonly playerId: string;

  /** 直前に永続化に成功した確定状態（ロールバック先）。 */
  private lastPersisted: PlayerState;

  /** 再試行型操作の保留キュー。 */
  private pending: PendingItem[] = [];

  /** 自動採番用カウンタ（保留項目 id の生成に使用）。 */
  private idCounter = 0;

  /**
   * @param store 永続化に用いる `UserDataStore`（失敗を例外で通知）。
   * @param playerId 対象プレイヤーの識別子。
   * @param initialPersisted 起動時にロード済みの確定状態（ロールバックの初期値）。
   */
  constructor(store: UserDataStore, playerId: string, initialPersisted: PlayerState) {
    this.store = store;
    this.playerId = playerId;
    this.lastPersisted = clonePlayerState(initialPersisted);
  }

  // -------------------------------------------------------------------------
  // ロールバック型操作
  // -------------------------------------------------------------------------

  /**
   * ロールバック型操作（スタンプ・報酬・装備・地域アンロック・称号）を確定する。
   *
   * 次状態の永続化を試み、成功した場合のみ確定（lastPersisted を更新）して
   * ok を返す。失敗した場合は確定とせず、復元すべき直前の永続済み状態
   * （rollbackState）と保存失敗のエラー指示を返す。確定済み状態は操作前から
   * 変化しない（Req 3.4, 4.6, 5.7, 8.6, 10.4, 11.5）。
   *
   * @param nextState 操作適用後の楽観的更新状態（確定候補）。
   */
  async commitWithRollback(nextState: PlayerState): Promise<CommitResult> {
    try {
      await this.store.persist(this.playerId, nextState);
    } catch (cause) {
      // 永続化失敗: 確定とせず、直前の永続済み状態へ復元するよう返す。
      return {
        ok: false,
        rollbackState: clonePlayerState(this.lastPersisted),
        error: {
          kind: 'persist-failed',
          message: toMessage(cause, '保存に失敗しました。直前の状態に戻します。'),
          cause,
        },
      };
    }

    // 永続化成功: ここで初めて確定とする。
    this.lastPersisted = clonePlayerState(nextState);
    return { ok: true, committed: clonePlayerState(this.lastPersisted) };
  }

  // -------------------------------------------------------------------------
  // 再試行キュー（再試行型操作）
  // -------------------------------------------------------------------------

  /**
   * 再試行型操作（購入・地域アンロック）の保留項目をキューに追加する。
   *
   * 楽観的更新を反映した目標状態をセッション状態として保持し、次回の `sync` で
   * 永続化を試みる。保存が確定するまでキューに保全される（Req 7.6, 10.5）。
   *
   * @param kind 操作種別（purchase / regionUnlock）。
   * @param state 操作適用後の目標状態（購入済みアイテム・更新後残高などを反映）。
   * @param id 保留項目 id（省略時は自動採番）。
   * @returns 追加された保留項目。
   */
  enqueueRetry(kind: RetryKind, state: PlayerState, id?: string): PendingItem {
    const item: PendingItem = {
      id: id ?? `${kind}-${++this.idCounter}`,
      kind,
      state: clonePlayerState(state),
      attempts: 0,
    };
    this.pending.push(item);
    return { ...item, state: clonePlayerState(item.state) };
  }

  /**
   * 保留キューを同期する。各保留項目について、`attempts` が MAX_RETRIES に
   * 達するまで永続化を再試行する。
   *
   * - 成功した項目はキューから除去し、lastPersisted を更新する。
   * - MAX_RETRIES 回連続して失敗した項目は保全し（キューに残し）、未保存
   *   （exhausted）として記録する。保存不可指示は `SyncResult.notSaved` で返す
   *   （Req 7.7: 3 回連続失敗後もセッション状態を保全する）。
   *
   * 注意: 複数項目を同期する場合、永続化は「より古い保留項目から順に」直列で
   * 試行する。先行項目が未保存のままでも後続項目の試行は行う（各項目は独立した
   * 目標状態を保持するため）。
   */
  async sync(): Promise<SyncResult> {
    const outcomes: SyncItemOutcome[] = [];
    const survivors: PendingItem[] = [];

    for (const item of this.pending) {
      let persisted = false;

      // attempts が上限に達するまで再試行する（最大 MAX_RETRIES 回）。
      while (item.attempts < MAX_RETRIES) {
        item.attempts += 1;
        try {
          await this.store.persist(this.playerId, item.state);
          persisted = true;
          break;
        } catch {
          // 失敗。attempts を消費し、上限未満であれば再試行を続ける。
        }
      }

      if (persisted) {
        // 永続化成功: 確定状態を更新し、キューから除去する。
        this.lastPersisted = clonePlayerState(item.state);
        outcomes.push({ item: { ...item, state: clonePlayerState(item.state) }, status: 'persisted' });
      } else {
        // MAX_RETRIES 回連続失敗: 保留項目を保全（キューに残す）。
        survivors.push(item);
        outcomes.push({ item: { ...item, state: clonePlayerState(item.state) }, status: 'exhausted' });
      }
    }

    // 未保存（保全）項目のみをキューに残す。
    this.pending = survivors;

    return {
      outcomes,
      remaining: survivors.map((p) => ({ ...p, state: clonePlayerState(p.state) })),
      notSaved: survivors.length > 0,
    };
  }

  // -------------------------------------------------------------------------
  // セッション状態の参照
  // -------------------------------------------------------------------------

  /** 直前に永続化に成功した確定状態のコピーを返す。 */
  getLastPersisted(): PlayerState {
    return clonePlayerState(this.lastPersisted);
  }

  /** 現在保全されている保留項目のコピー一覧を返す。 */
  getPendingItems(): PendingItem[] {
    return this.pending.map((p) => ({ ...p, state: clonePlayerState(p.state) }));
  }

  /** 保留項目が存在するか（未保存の再試行型操作があるか）。 */
  hasPending(): boolean {
    return this.pending.length > 0;
  }
}
