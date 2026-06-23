// Collection_System: コレクション集計（Req 11.6, 11.7, 11.8）
//
// 本モジュールはコレクション（スタンプ・ボス・アイテムなどのエントリ集合）の
// 取得数／総数の集計と完了判定を担う純粋ドメインロジックである。
// すべての関数は入力を破壊的に変更せず、I/O・副作用を持たない。
//
// 取得数（obtained）は、コレクション定義の `entryIds` のうち、プレイヤー状態の
// 対応する集合に存在する相異なる id の数として算出する。総数（total）は
// `entryIds` の相異なる id の数である。

import type { CollectionDefinition, PlayerState } from './types';

/**
 * コレクションの種類に応じて、プレイヤーが保持する「取得済みエントリ id 集合」を返す。
 *
 * - 'stamp': 取得済みスタンプの spotId 集合
 * - 'boss': 撃破済みボスの bossId 集合
 * - 'item': 所持アイテムの itemId 集合
 */
function getOwnedEntryIds(
  collection: CollectionDefinition,
  state: PlayerState
): Set<string> {
  switch (collection.kind) {
    case 'stamp':
      return new Set(state.stamps.map((s) => s.spotId));
    case 'boss':
      return new Set(state.defeatedBossIds);
    case 'item':
      return new Set(state.ownedItemIds);
  }
}

/**
 * コレクションの取得数／総数を集計する（Req 11.6）。
 *
 * 範囲不変条件（Property 32）:
 * - total は `entryIds` の相異なる id の数（0 以上）。
 * - obtained は `entryIds` のうちプレイヤーが取得済みの相異なる id の数で、
 *   常に 0 以上かつ total 以下に収まる（0..total）。
 *
 * `entryIds` に重複が含まれていても相異なる id として数えるため、
 * obtained が total を超えることはない。
 *
 * @param collection コレクション定義
 * @param state プレイヤー状態
 * @returns obtained（取得数）と total（総数）
 */
export function getProgress(
  collection: CollectionDefinition,
  state: PlayerState
): { obtained: number; total: number } {
  // 総数は相異なるエントリ id の数。
  const distinctEntryIds = new Set(collection.entryIds);
  const total = distinctEntryIds.size;

  // プレイヤーが取得済みのエントリ id 集合。
  const owned = getOwnedEntryIds(collection, state);

  // entryIds のうち取得済みの相異なる id を数える（0..total に自然に収まる）。
  let obtained = 0;
  for (const id of distinctEntryIds) {
    if (owned.has(id)) {
      obtained += 1;
    }
  }

  return { obtained, total };
}

/**
 * コレクションの完了判定（Req 11.7, 11.8）。
 *
 * 完了同値条件（Property 33）:
 * - 総数が 1 以上かつ取得数が総数に等しいとき、かつそのときに限り完了。
 * - 総数 0 のコレクションは決して完了しない（Req 11.8）。
 *
 * @param collection コレクション定義
 * @param state プレイヤー状態
 * @returns 完了していれば true
 */
export function isComplete(
  collection: CollectionDefinition,
  state: PlayerState
): boolean {
  const { obtained, total } = getProgress(collection, state);
  return total >= 1 && obtained === total;
}
