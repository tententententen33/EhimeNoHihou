// Quest_System ドメインロジック（Req 4）
//
// クエストの進行・完了・表示を担う純粋関数群。副作用（I/O・永続化）は持たない。
// 設計書「Components and Interfaces / Quest_System」および
// Correctness Properties（Property 8, 9）に対応する。
//
// クエスト条件は 2 種類（設計書 Data Models）。
// - kind: 'spots' … 必須スポット集合（1〜100）。相異なる必須スポットを訪問するたびに進行。
// - kind: 'count' … 要求スタンプ数（1〜100）。相異なるスポットを訪問するたびに進行。
//
// いずれの種類でも「同一スポットは高々1回しか数えない」（Req 4.2, 4.3）。

import type { QuestProgress, QuestDisplay } from './types';

/**
 * クエストの必要条件数を返す。
 * - spots: 相異なる必須スポット数
 * - count: 要求スタンプ数（requiredCount）
 */
function requiredConditionCount(quest: QuestProgress): number {
  const condition = quest.definition.condition;
  if (condition.kind === 'spots') {
    // 必須スポット id を相異なる集合として数える（定義側の重複を無視）
    return new Set(condition.requiredSpotIds).size;
  }
  return condition.requiredCount;
}

/**
 * 指定スポットがこのクエストの進行に「寄与しうる」かを判定する。
 * - spots: そのスポットが必須スポット集合に含まれるときのみ寄与する（Req 4.2）
 * - count: 任意のスポットが寄与しうる（要求スタンプ数を満たすため）
 */
function spotContributes(quest: QuestProgress, spotId: string): boolean {
  const condition = quest.definition.condition;
  if (condition.kind === 'spots') {
    return condition.requiredSpotIds.includes(spotId);
  }
  return true;
}

/**
 * スタンプ付与イベントを反映し、クエスト進行を更新する（Req 4.2, 4.3, 4.8）。
 *
 * - 寄与しうる相異なるスポットのみ進行を 1 加算する。
 * - 既に数えたスポット、または寄与しないスポットの場合は進行を変更しない（同一の状態を返す）。
 * - 満たした条件数が必要条件数に達したら完了とする（Req 4.4）。
 *
 * 純粋関数として、入力の `quest` を破壊的に変更せず新しい `QuestProgress` を返す。
 *
 * @param quest 現在のクエスト進行
 * @param spotId スタンプが付与されたスポット id
 * @returns 反映後のクエスト進行（変化が無い場合は内容的に同一の状態）
 */
export function applyStamp(quest: QuestProgress, spotId: string): QuestProgress {
  // 既に数えたスポット、または寄与しないスポットは進行を変更しない（Req 4.3）
  if (quest.satisfiedSpotIds.includes(spotId) || !spotContributes(quest, spotId)) {
    return quest;
  }

  const required = requiredConditionCount(quest);

  // 既に必要条件数を満たしている場合はこれ以上加算しない（同値性の保全, Property 9）
  if (quest.satisfiedCount >= required) {
    return quest;
  }

  const satisfiedSpotIds = [...quest.satisfiedSpotIds, spotId];
  const satisfiedCount = satisfiedSpotIds.length;

  return {
    ...quest,
    satisfiedSpotIds,
    satisfiedCount,
    complete: satisfiedCount === required, // Req 4.4, 4.8
  };
}

/**
 * クエストの完了判定（Req 4.4, 4.8）。
 *
 * 満たした条件数が必要条件数に等しいときに限り真を返す（同値）。
 * いずれかの条件が未達なら未完了。
 */
export function isComplete(quest: QuestProgress): boolean {
  return quest.satisfiedCount === requiredConditionCount(quest);
}

/**
 * アクティブクエストの表示情報を返す（Req 4.7）。
 *
 * 現在の満たした条件数・必要条件数・残り未達条件（未達の必須スポット id と残り件数）を返す。
 */
export function getDisplay(quest: QuestProgress): QuestDisplay {
  const requiredCount = requiredConditionCount(quest);
  const satisfiedCount = quest.satisfiedCount;
  const remainingCount = Math.max(0, requiredCount - satisfiedCount);

  const condition = quest.definition.condition;
  // spots クエストのみ、未達の必須スポット id を列挙する。
  // count クエストは特定スポットに紐付かないため空配列とする。
  const remainingSpotIds =
    condition.kind === 'spots'
      ? [...new Set(condition.requiredSpotIds)].filter(
          (id) => !quest.satisfiedSpotIds.includes(id)
        )
      : [];

  return {
    satisfiedCount,
    requiredCount,
    remainingCount,
    remainingSpotIds,
    complete: isComplete(quest),
  };
}
