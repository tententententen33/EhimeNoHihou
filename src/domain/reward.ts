// Reward_Engine（報酬計算と適用）
//
// 本ファイルは設計書「Components and Interfaces > Reward_Engine」に従い、
// 歩行距離・初回訪問・ボス撃破・クエスト完了からコイン・経験値・アイテムを
// 計算／適用する純粋関数群を実装する（Req 4.5, 5）。
//
// 純粋ドメインロジック層に属するため、本ファイルは I/O（永続化・ネットワーク・
// 時刻取得など）を一切行わない。永続化は Repository 層が担当する（Req 5.5）。

import type { PlayerState, QuestProgress, RewardGrant } from './types';

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

/**
 * 歩行報酬の計算結果。
 * - coinsGranted: 完了した 100m ごとに 1 コイン（Req 5.1）
 * - carryOverMeters: 100m 未満の繰り越し距離（Req 5.2）
 */
export interface WalkRewardResult {
  /** 今回付与されるコイン数（合計距離 / 100 の商, 切り捨て）。0 以上 */
  coinsGranted: number;
  /** 次回へ繰り越す 100m 未満の距離（合計距離 % 100）。0 以上 100 未満 */
  carryOverMeters: number;
}

/**
 * クエスト完了報酬の付与結果。
 * - nextState: 報酬適用後（または据え置き）のプレイヤー状態
 * - quest: rewardGranted を更新したクエスト進行
 * - granted: 今回新たに報酬を付与したか（一度限り付与の判定結果, Req 4.5）
 */
export interface QuestRewardResult {
  nextState: PlayerState;
  quest: QuestProgress;
  granted: boolean;
}

// ---------------------------------------------------------------------------
// 内部ヘルパー
// ---------------------------------------------------------------------------

/**
 * 報酬源（初回訪問・ボス撃破・クエスト完了）のコイン/経験値が 0 以上である
 * ことを保証する（Req 5.6）。負値が混入した場合は 0 に丸める。
 * 非数（NaN）も 0 として扱い、状態の破壊を防ぐ。
 */
function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * 距離入力を 0 以上の有限値へ正規化する。
 * 歩行距離は本来非負だが、不正入力（負値・NaN）でも破綻しないよう丸める。
 */
function nonNegativeMeters(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * 累積歩行距離からコイン付与数と繰り越し距離を計算する（Req 5.1, 5.2）。
 *
 * 完了した 100m ごとに 1 コインを付与し、100m 未満の剰余は次回へ繰り越す。
 * 距離を任意に分割して逐次適用しても、合計コインは一括適用と等しくなる
 * （繰り越しが保存される, 設計書 Property 11）。
 *
 * @param pendingMeters 前回までの繰り越し距離（0 以上）
 * @param addedMeters 今回追加された歩行距離（0 以上）
 */
export function computeWalkReward(
  pendingMeters: number,
  addedMeters: number
): WalkRewardResult {
  const total = nonNegativeMeters(pendingMeters) + nonNegativeMeters(addedMeters);
  const coinsGranted = Math.floor(total / 100);
  const carryOverMeters = total % 100;
  return { coinsGranted, carryOverMeters };
}

/**
 * プレイヤー状態へ報酬を適用する（純粋・I/O なし, Req 5.3, 5.4, 5.5）。
 *
 * 適用後のコインと経験値は、それぞれ適用前の値に付与量を正確に加えた値になる
 * （初回訪問・ボス撃破・クエスト完了のいずれの報酬源でも成り立つ, Property 12）。
 * コイン/経験値の付与量は 0 以上であることを保証する（Req 5.6, Property 13）。
 * アイテムは所持アイテムへ加算する。永続化は行わない（Req 5.5 は Repository 層）。
 *
 * @param state 適用前のプレイヤー状態（変更しない）
 * @param grant 付与する報酬
 * @returns 報酬適用後の新しいプレイヤー状態
 */
export function applyReward(state: PlayerState, grant: RewardGrant): PlayerState {
  const coins = nonNegative(grant.coins);
  const experience = nonNegative(grant.experience);
  const items = Array.isArray(grant.items) ? grant.items : [];

  return {
    ...state,
    coins: state.coins + coins,
    experience: state.experience + experience,
    ownedItemIds: [...state.ownedItemIds, ...items],
  };
}

/**
 * クエスト完了報酬を一度だけ付与する（Req 4.5, Property 10）。
 *
 * 完了済み（complete）かつ未付与（rewardGranted === false）の場合に限り、
 * 定義された報酬を `applyReward` 経由で付与し、`rewardGranted` を true にする。
 * 既に付与済み、または未完了の場合は状態を変更せず据え置く（granted: false）。
 * これにより、完了への遷移およびその後の再評価を通じて報酬はちょうど 1 回だけ
 * 付与される。
 *
 * @param state 現在のプレイヤー状態（変更しない）
 * @param quest 対象クエストの進行状態（変更しない）
 * @returns 付与結果（次状態・更新後クエスト・付与有無）
 */
export function grantQuestCompletionReward(
  state: PlayerState,
  quest: QuestProgress
): QuestRewardResult {
  // 未完了、または既に付与済みなら据え置き（一度限り付与の保証, Req 4.5）
  if (!quest.complete || quest.rewardGranted) {
    return { nextState: state, quest, granted: false };
  }

  const nextState = applyReward(state, quest.definition.reward);
  const nextQuest: QuestProgress = { ...quest, rewardGranted: true };
  return { nextState, quest: nextQuest, granted: true };
}
