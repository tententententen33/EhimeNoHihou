// Collections ビュー（Task 19.5 / Req 3.5, 11.6）。
//
// 本コンポーネントは表示専用（presentational）であり、状態を持たず副作用も行わない。
// 表示内容は以下の3点で、いずれも純粋ドメインロジックの集計結果を描画する。
//   1. スタンプ取得数／総数（getStampSummary, Req 3.5）
//   2. 各コレクションの取得数／総数と完了状態（getProgress / isComplete, Req 11.6）
//   3. 付与済み称号（PlayerState.titleIds を TitleDefinition の名称へ対応付け）
//
// データの読み込み・状態更新は状態管理層（Task 20）の責務であり、ここでは
// props として確定済みのドメインデータを受け取って描画するのみである。
import type {
  CollectionDefinition,
  PlayerState,
  TitleDefinition,
} from '../../domain/types';
import { getStampSummary } from '../../domain/stamp';
import { getProgress, isComplete } from '../../domain/collection';
import './styles/CollectionsView.css';

export interface CollectionsViewProps {
  // プレイヤーの永続状態（スタンプ・撃破ボス・所持アイテム・称号などの集約）。
  player: PlayerState;
  // 利用可能なスタンプの総数（スタンプ集計の分母, Req 3.5）。
  totalSpots: number;
  // 表示対象のコレクション定義一覧（Req 11.6）。
  collections: CollectionDefinition[];
  // 称号定義一覧。付与済み称号 id（player.titleIds）から名称を引くために使用する。
  titles: TitleDefinition[];
}

// 進捗バーを描画する小コンポーネント（取得数／総数を視覚化する）。
function ProgressBar({
  obtained,
  total,
}: {
  obtained: number;
  total: number;
}) {
  // 総数 0 のときは 0% とする（ゼロ除算回避, Req 11.8 のコレクションを想定）。
  const ratio = total > 0 ? obtained / total : 0;
  const percent = Math.round(ratio * 100);
  return (
    <div
      className="collections-bar"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={obtained}
    >
      <div
        className="collections-bar__fill"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export function CollectionsView({
  player,
  totalSpots,
  collections,
  titles,
}: CollectionsViewProps) {
  // スタンプ取得数／総数（Req 3.5）。
  const stampSummary = getStampSummary(player, totalSpots);

  // 付与済み称号を名称へ対応付ける（未知の id は除外し、定義のある称号のみ表示）。
  const titleById = new Map(titles.map((t) => [t.id, t]));
  const grantedTitles = player.titleIds
    .map((id) => titleById.get(id))
    .filter((t): t is TitleDefinition => t !== undefined);

  return (
    <div className="collections">
      {/* スタンプ集計（Req 3.5） */}
      <section className="collections-section" aria-labelledby="collections-stamp-heading">
        <h2 id="collections-stamp-heading" className="collections-section__title">
          スタンプ
        </h2>
        <div className="collections-card">
          <div className="collections-card__head">
            <span className="collections-card__name">取得スタンプ</span>
            <span className="collections-card__count">
              {stampSummary.earned} / {stampSummary.total}
            </span>
          </div>
          <ProgressBar obtained={stampSummary.earned} total={stampSummary.total} />
        </div>
      </section>

      {/* コレクション一覧（取得数／総数と完了状態, Req 11.6） */}
      <section className="collections-section" aria-labelledby="collections-list-heading">
        <h2 id="collections-list-heading" className="collections-section__title">
          コレクション
        </h2>
        {collections.length === 0 ? (
          <p className="collections-empty">コレクションはまだありません。</p>
        ) : (
          <ul className="collections-list">
            {collections.map((collection) => {
              const { obtained, total } = getProgress(collection, player);
              const complete = isComplete(collection, player);
              return (
                <li key={collection.id} className="collections-card">
                  <div className="collections-card__head">
                    <span className="collections-card__name">{collection.name}</span>
                    <span className="collections-card__count">
                      {obtained} / {total}
                    </span>
                  </div>
                  <ProgressBar obtained={obtained} total={total} />
                  <span
                    className={`collections-status${
                      complete ? ' collections-status--complete' : ''
                    }`}
                  >
                    {complete ? '達成' : '未達成'}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 付与済み称号（player.titleIds を称号名へ対応付け） */}
      <section className="collections-section" aria-labelledby="collections-title-heading">
        <h2 id="collections-title-heading" className="collections-section__title">
          称号
        </h2>
        {grantedTitles.length === 0 ? (
          <p className="collections-empty">付与された称号はまだありません。</p>
        ) : (
          <ul className="collections-titles">
            {grantedTitles.map((title) => (
              <li key={title.id} className="collections-title">
                <span className="collections-title__name">{title.name}</span>
                {title.description && (
                  <span className="collections-title__desc">{title.description}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
