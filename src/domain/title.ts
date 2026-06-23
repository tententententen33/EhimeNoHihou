// Title_System: 称号付与（Req 11.1, 11.2, 11.3）
//
// 本モジュールは称号の達成条件評価と付与を担う純粋ドメインロジックである。
// すべての関数は入力 `PlayerState` を破壊的に変更せず、付与時のみ新しい状態を
// 返す（I/O・副作用なし）。永続化（User_Data_Store への保存, Req 11.4/11.5）は
// 状態管理層・Repository 層の責務であり、本モジュールは「付与後（または据え置き）
// の次状態」を計算するのみである。
//
// 設計判断: 称号の達成条件評価に必要な地域メンバーシップ（対象スポット集合・
// 対象ボス集合）は `TitleCondition` 自身に埋め込まれている。これにより
// `grantIfEarned` は (state, title) のみに依存する自己完結した純粋関数となり、
// Spot_Manager などの外部コンテキストを参照しない。

import type { PlayerState, TitleCondition, TitleDefinition } from './types';

/**
 * 称号付与の結果。
 * - nextState: 付与後（または据え置き）のプレイヤー状態
 * - granted: 新規に称号が付与されたか（既付与・条件未達なら false）
 */
export interface TitleGrantResult {
  nextState: PlayerState;
  granted: boolean;
}

/**
 * 称号の達成条件が現在のプレイヤー状態で充足されているかを判定する（Req 11.1）。
 *
 * いずれの条件も「測定可能な完了状態」であり、対象集合が空の場合は未達（false）と
 * みなす（完了対象が存在しない地域に対して称号を付与しない防御的設計）。
 *
 * @param state プレイヤー状態
 * @param condition 称号の達成条件
 * @returns 条件を満たすなら true
 */
function isConditionSatisfied(
  state: PlayerState,
  condition: TitleCondition
): boolean {
  switch (condition.kind) {
    case 'allSpotsVisitedInRegion': {
      // 対象 Region の全スポットを訪問済み（スタンプ保持）であること。
      if (condition.spotIds.length === 0) return false;
      const visited = new Set(state.stamps.map((s) => s.spotId));
      return condition.spotIds.every((spotId) => visited.has(spotId));
    }
    case 'allBossesDefeatedInRegion': {
      // 対象 Region の全ボスを撃破済みであること。
      if (condition.bossIds.length === 0) return false;
      const defeated = new Set(state.defeatedBossIds);
      return condition.bossIds.every((bossId) => defeated.has(bossId));
    }
  }
}

/**
 * 達成条件を満たし未付与なら称号を付与する（Req 11.2, 11.3）。
 *
 * 冪等性（Property 31）:
 * - 達成条件を満たし、かつ未付与の場合: 称号 id を `titleIds` に 1 つ追加し
 *   `granted: true` を返す（Req 11.2）。
 * - 既に付与済みの場合: 達成条件の充足有無にかかわらず再付与せず、既存の称号集合を
 *   一切変更しない（`granted: false`, Req 11.3）。
 * - 達成条件を満たさない場合: 付与せず状態不変（`granted: false`）。
 *
 * 入力 `state` は変更せず、付与時のみ新しい状態を返す。据え置き時は同一参照を返す。
 *
 * @param state 現在のプレイヤー状態
 * @param title 評価対象の称号定義
 * @returns nextState / granted を含む結果
 */
export function grantIfEarned(
  state: PlayerState,
  title: TitleDefinition
): TitleGrantResult {
  // 既付与: 据え置き（称号集合不変, Req 11.3）。状態は変更しない。
  if (state.titleIds.includes(title.id)) {
    return { nextState: state, granted: false };
  }

  // 未付与かつ条件未達: 付与しない。状態は変更しない。
  if (!isConditionSatisfied(state, title.condition)) {
    return { nextState: state, granted: false };
  }

  // 未付与かつ条件充足: ちょうど 1 つ付与する（Req 11.2）。
  const nextState: PlayerState = {
    ...state,
    titleIds: [...state.titleIds, title.id],
  };

  return { nextState, granted: true };
}
