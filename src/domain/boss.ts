// Boss_System: エリアボスの可用性判定とバトル解決（Req 9）
//
// 本モジュールはエリアボスの「可用性判定」と「バトル解決（勝利・敗北・中断）」を
// 担う純粋ドメインロジックである。すべての関数は入力 `PlayerState` を破壊的に
// 変更せず、必要に応じて新しい状態を返す（I/O・副作用なし）。
//
// 報酬付与は Reward_Engine（`applyReward`）を経由して行う（Req 9.3）。
// 永続化（User_Data_Store への保存）は状態管理層・Repository 層の責務であり、
// 本モジュールは「解決後の次状態」を計算するのみである。

import type { Boss, PlayerState } from './types';
import { applyReward } from './reward';

/**
 * プレイヤーが入場済みのエリア集合。
 *
 * ボス可用性（Req 9.2, 9.7）は「ボスが紐づく Spot または Region に
 * 入場済みか」で決まるため、入場済みの Spot id 集合と Region id 集合を
 * 明示的に受け取る。状態管理層は訪問履歴（スタンプ・解放地域など）から
 * 本構造を導出して渡す。
 */
export interface VisitedAreas {
  /** 入場済みの Spot id 一覧 */
  visitedSpotIds: string[];
  /** 入場済み（解放済み）の Region id 一覧 */
  enteredRegionIds: string[];
}

/**
 * ボス勝利の解決結果。
 * - nextState: 報酬付与・撃破記録後のプレイヤー状態
 * - grantedLimitedItemIds: 今回新たに付与した Limited_Item id 一覧
 * - newlyDefeated: 今回新たに撃破記録したか（既撃破なら false）
 */
export interface BossWinResult {
  nextState: PlayerState;
  grantedLimitedItemIds: string[];
  newlyDefeated: boolean;
}

/**
 * ボスバトルが可用かどうかを判定する（Req 9.2, 9.7, Property 24）。
 *
 * 可用であることは、そのボスが紐づく `Spot` または `Region` に
 * 入場済みであることと同値である。
 * - bind.kind === 'spot': 当該 spotId が入場済み Spot 集合に含まれるか
 * - bind.kind === 'region': 当該 regionId が入場済み Region 集合に含まれるか
 *
 * @param boss 対象ボス定義
 * @param visited プレイヤーの入場済みエリア
 * @returns 入場済みなら true（可用）、未入場なら false（不可用）
 */
export function isAvailable(boss: Boss, visited: VisitedAreas): boolean {
  if (boss.bind.kind === 'spot') {
    return visited.visitedSpotIds.includes(boss.bind.spotId);
  }
  // bind.kind === 'region'
  return visited.enteredRegionIds.includes(boss.bind.regionId);
}

/**
 * ボス勝利を解決する（Req 9.3, 9.4, Property 25, 26）。
 *
 * 勝利時は Reward_Engine（`applyReward`）を通じて定義された報酬を付与し、
 * 当該ボスを撃破済みとして記録する。
 * - コイン・経験値は勝利のたびに必ず付与する（Req 9.4）。
 * - Limited_Item（`boss.reward.limitedItemIds`）は、当該プレイヤーに
 *   まだ付与されていないものだけを付与する。付与した id は
 *   `grantedLimitedItemIds` に追記して重複付与を防ぐ（Req 9.4）。
 * - 通常報酬の `items` は毎回付与される（Limited_Item の重複排除対象外）。
 * - 撃破記録（`defeatedBossIds`）は重複なく 1 件のみ保持する（Req 9.5）。
 *
 * 入力 `state` は変更せず、新しい状態を返す。
 *
 * @param state 現在のプレイヤー状態
 * @param boss 勝利したボス定義
 * @returns nextState / grantedLimitedItemIds / newlyDefeated を含む結果
 */
export function resolveWin(state: PlayerState, boss: Boss): BossWinResult {
  // 未取得の Limited_Item のみを抽出する（重複排除, Req 9.4）。
  // 同一勝利内での重複指定も 1 回に正規化する。
  const alreadyGranted = new Set(state.grantedLimitedItemIds);
  const newLimitedItemIds: string[] = [];
  for (const itemId of boss.reward.limitedItemIds) {
    if (!alreadyGranted.has(itemId)) {
      alreadyGranted.add(itemId);
      newLimitedItemIds.push(itemId);
    }
  }

  // Reward_Engine 経由で報酬を付与する（Req 9.3）。
  // コイン・経験値・通常アイテムに加え、未取得の Limited_Item を所持へ加える。
  const afterReward = applyReward(state, {
    coins: boss.reward.coins,
    experience: boss.reward.experience,
    items: [...boss.reward.items, ...newLimitedItemIds],
  });

  // 撃破記録を重複なく更新する（Req 9.5）。
  const newlyDefeated = !state.defeatedBossIds.includes(boss.id);
  const defeatedBossIds = newlyDefeated
    ? [...afterReward.defeatedBossIds, boss.id]
    : afterReward.defeatedBossIds;

  // 付与済み Limited_Item id を追記する（Req 9.4）。
  const grantedLimitedItemIds = [
    ...afterReward.grantedLimitedItemIds,
    ...newLimitedItemIds,
  ];

  const nextState: PlayerState = {
    ...afterReward,
    defeatedBossIds,
    grantedLimitedItemIds,
  };

  return {
    nextState,
    grantedLimitedItemIds: newLimitedItemIds,
    newlyDefeated,
  };
}

/**
 * ボスバトルの敗北・中断を解決する（Req 9.6, Property 27）。
 *
 * 敗北または中断では、ボスを撃破済みに記録せず、報酬も一切付与しない。
 * 結果としてプレイヤー状態は不変であり、ボスバトルは可用なまま保たれる
 * （可用性は `isAvailable` が訪問エリアのみから判定するため、状態を
 * 変更しない限り維持される）。
 *
 * 状態を変更しないことを表現するため、入力 `state` をそのまま返す。
 *
 * @param state 現在のプレイヤー状態
 * @returns 変更されないプレイヤー状態（同一参照）
 */
export function resolveLossOrAbandon(state: PlayerState): PlayerState {
  // 撃破記録なし・報酬付与なし・可用維持（状態据え置き）。
  return state;
}
