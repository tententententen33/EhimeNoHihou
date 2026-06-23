// Quests ビュー（Req 4.7）
//
// アクティブクエストの進行状況を表示する純粋な表示用コンポーネント。
// 各クエストについて以下を描画する（Req 4.7）。
// - 現在の満たした条件数（satisfiedCount）
// - 必要条件数（requiredCount）
// - 残り未達条件（remainingCount と、spots クエストの未達必須スポット一覧）
// - 完了状態（complete のときは完了バッジを表示）
//
// ドメインロジック（進行・完了・表示算出）は src/domain/quest.ts に委譲し、
// 本コンポーネントは getDisplay の結果を描画するのみで副作用を持たない。

import type { PlayerState, QuestProgress } from '../../domain/types';
import { getDisplay } from '../../domain/quest';
import './QuestsView.css';

export interface QuestsViewProps {
  /** プレイヤー状態。アクティブクエスト（quests）を参照する */
  player: PlayerState;
  /**
   * スポット id を表示名へ変換する任意のルックアップ。
   * 指定された場合、残り未達の必須スポット id を名前で描画する。
   * 未指定、または名前が見つからない場合は id をそのまま表示する。
   */
  spotName?: (spotId: string) => string | undefined;
}

/** クエスト定義 id から人間可読なラベルを生成する（クエスト名は未定義のため id を表示） */
function questLabel(quest: QuestProgress): string {
  return quest.definition.id;
}

/** 単一クエストの進行カードを描画する */
function QuestCard({
  quest,
  spotName,
}: {
  quest: QuestProgress;
  spotName?: (spotId: string) => string | undefined;
}) {
  const display = getDisplay(quest);
  const { satisfiedCount, requiredCount, remainingCount, remainingSpotIds, complete } = display;

  // 進捗率（0〜100）。requiredCount が 0 になることは定義上ないが、念のため 0 除算を防ぐ。
  const percent = requiredCount > 0 ? Math.round((satisfiedCount / requiredCount) * 100) : 0;

  return (
    <li className={`quest-card${complete ? ' quest-card--complete' : ''}`}>
      <div className="quest-card__header">
        <span className="quest-card__title">{questLabel(quest)}</span>
        {complete ? (
          <span className="quest-card__badge" aria-label="達成済み">
            達成
          </span>
        ) : null}
      </div>

      {/* 現在数 / 必要数（Req 4.7） */}
      <div className="quest-card__counts">
        <span className="quest-card__counts-value">
          {satisfiedCount} / {requiredCount}
        </span>
        <span className="quest-card__counts-label">条件達成</span>
      </div>

      {/* 進捗インジケータ */}
      <div
        className="quest-card__progress"
        role="progressbar"
        aria-valuenow={satisfiedCount}
        aria-valuemin={0}
        aria-valuemax={requiredCount}
      >
        <div className="quest-card__progress-fill" style={{ width: `${percent}%` }} />
      </div>

      {/* 残り未達条件（Req 4.7） */}
      {complete ? (
        <p className="quest-card__remaining quest-card__remaining--done">
          すべての条件を達成しました
        </p>
      ) : (
        <div className="quest-card__remaining">
          <p className="quest-card__remaining-summary">残り {remainingCount} 件</p>
          {remainingSpotIds.length > 0 ? (
            <ul className="quest-card__remaining-list">
              {remainingSpotIds.map((spotId) => (
                <li key={spotId} className="quest-card__remaining-item">
                  {spotName?.(spotId) ?? spotId}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </li>
  );
}

/**
 * アクティブクエスト一覧を表示するビュー。
 * クエストが無い場合は空状態を表示する。
 */
export function QuestsView({ player, spotName }: QuestsViewProps) {
  const quests = player.quests;

  return (
    <section className="quests-view" aria-label="クエスト">
      <h2 className="quests-view__heading">クエスト</h2>

      {quests.length === 0 ? (
        <p className="quests-view__empty">進行中のクエストはありません</p>
      ) : (
        <ul className="quests-view__list">
          {quests.map((quest) => (
            <QuestCard key={quest.definition.id} quest={quest} spotName={spotName} />
          ))}
        </ul>
      )}
    </section>
  );
}
