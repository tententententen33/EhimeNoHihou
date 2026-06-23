// Stamp_System: スタンプ付与・集計（Req 3）
//
// 本モジュールはスポット訪問によるスタンプの付与と表示用集計を担う
// 純粋ドメインロジックである。すべての関数は入力 `PlayerState` を破壊的に
// 変更せず、必要に応じて新しい状態を返す（I/O・副作用なし）。
//
// 永続化（User_Data_Store への保存）は状態管理層・Repository 層の責務であり、
// 本モジュールは「付与後（または据え置き）の次状態」を計算するのみである。

import type { ISODateTime, PlayerState, Stamp } from './types';

/**
 * スタンプ付与の結果。
 * - nextState: 付与後（または据え置き）のプレイヤー状態
 * - granted: 新規にスタンプが付与されたか（既取得なら false）
 * - stamp: 当該スポットのスタンプ（新規付与・既存いずれの場合も対応するスタンプ）
 */
export interface StampGrantResult {
  nextState: PlayerState;
  granted: boolean;
  stamp?: Stamp;
}

/**
 * 未取得スポットに対してスタンプを 1 つ付与する（Req 3.1, 3.3）。
 *
 * 冪等性（Property 6）:
 * - 当該スポットのスタンプを持たない場合は、ちょうど 1 つのスタンプを追加する。
 * - 既にスタンプを持つ場合は、付与を繰り返しても枚数・既存の `spotId` と
 *   `earnedAt` を一切変更しない（付与 1 回と複数回が同一結果）。
 *
 * 入力 `state` は変更せず、付与時は新しい状態を返す。据え置き時は同一参照を返す。
 *
 * @param state 現在のプレイヤー状態
 * @param spotId 対象スポットの識別子
 * @param now 付与日時（ISO 8601）。新規付与時のみ使用される
 * @returns nextState / granted / stamp を含む結果
 */
export function grantStampIfAbsent(
  state: PlayerState,
  spotId: string,
  now: ISODateTime
): StampGrantResult {
  const existing = state.stamps.find((s) => s.spotId === spotId);

  // 既取得: 据え置き（spotId / earnedAt 不変）。状態は変更しない（Req 3.3）。
  if (existing) {
    return {
      nextState: state,
      granted: false,
      stamp: existing,
    };
  }

  // 未取得: ちょうど 1 つ付与する（Req 3.1）。
  const stamp: Stamp = { spotId, earnedAt: now };
  const nextState: PlayerState = {
    ...state,
    stamps: [...state.stamps, stamp],
  };

  return {
    nextState,
    granted: true,
    stamp,
  };
}

/**
 * スタンプ取得数／総数を表示用に集計する（Req 3.5）。
 *
 * 範囲不変条件（Property 7）:
 * - earned は 0 以上かつ total 以下に収まる（0..total へクランプ）。
 * - earned は保持する相異なるスタンプ数（spotId 単位で重複排除）と一致する。
 * - total は負の入力を 0 に丸める（防御的）。
 *
 * @param state プレイヤー状態
 * @param totalSpots 利用可能なスタンプ総数
 * @returns earned（取得数）と total（総数）
 */
export function getStampSummary(
  state: PlayerState,
  totalSpots: number
): { earned: number; total: number } {
  // 総数は 0 以上に丸める（負値・非整数の防御）。
  const total = Math.max(0, Math.floor(totalSpots));

  // 相異なる spotId の数を取得数とする（重複があっても 1 として数える）。
  const distinctCount = new Set(state.stamps.map((s) => s.spotId)).size;

  // 0..total の範囲にクランプする。
  const earned = Math.min(Math.max(0, distinctCount), total);

  return { earned, total };
}
