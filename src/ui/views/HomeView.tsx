// ホーム画面 - RPGの冒険拠点メニュー
//
// キャラクター・レベル・経験値バー・コイン・現在のクエスト・
// 今日の歩行距離・次のおすすめスポットを表示する。

import type { ItemCatalog, PlayerState, QuestProgress, Spot } from '../../domain/types';
import { levelForExperience, getProgressDisplay } from '../../domain/character';
import { getDisplay } from '../../domain/quest';
import './HomeView.css';

export interface HomeViewProps {
  player: PlayerState;
  itemCatalog: ItemCatalog;
  spots: Spot[];
  /** 現在のアクティブクエスト（未完了のもの） */
  activeQuests: QuestProgress[];
  /** 今日の歩行距離（メートル） */
  todayWalkMeters: number;
  /** プレイヤー名 */
  playerName?: string;
}

/** コイン表示のフォーマット */
function formatCoins(coins: number): string {
  return coins.toLocaleString('ja-JP');
}

export function HomeView({
  player,
  itemCatalog,
  spots,
  activeQuests,
  todayWalkMeters,
  playerName = '冒険者',
}: HomeViewProps) {
  const progress = getProgressDisplay(player);
  const level = levelForExperience(player.experience);

  // 経験値バーのパーセント
  const expForBar = progress.atMaxLevel
    ? 100
    : (() => {
        const remaining = progress.experienceToNextLevel ?? 0;
        // 残りが少ないほど100%に近い（レベルごとの必要EXPは level*20 程度）
        const estimatedTotal = remaining + level * 20;
        return Math.max(0, Math.min(100, 100 - Math.round((remaining / estimatedTotal) * 100)));
      })();

  // 未完了クエストの最初の1つ
  const currentQuest = activeQuests.find((q) => !q.complete);
  const currentQuestDisplay = currentQuest ? getDisplay(currentQuest) : null;

  // 次のおすすめスポット（解放済み＆未訪問の最初のスポット）
  const visitedSpotIds = new Set(player.stamps.map((s) => s.spotId));
  const nextSpot = spots.find(
    (s) => player.unlockedRegionIds.includes(s.regionId) && !visitedSpotIds.has(s.id)
  );

  // 装備中の武器名
  const weaponId = player.equipped.weapon;
  const weaponName = weaponId ? (itemCatalog[weaponId]?.name ?? null) : null;

  return (
    <section className="home-view" aria-label="ホーム">
      {/* キャラクターカード */}
      <div className="home-character-card">
        <div className="home-character-card__avatar">
          <span className="home-character-card__avatar-icon">🧙‍♂️</span>
          <span className="home-character-card__level-badge">Lv.{level}</span>
        </div>
        <div className="home-character-card__info">
          <h2 className="home-character-card__name">{playerName}</h2>
          {player.titleIds.length > 0 && (
            <span className="home-character-card__title">
              👑 称号あり
            </span>
          )}
          {weaponName && (
            <span className="home-character-card__weapon">⚔️ {weaponName}</span>
          )}
        </div>
        <div className="home-character-card__coins">
          <span className="home-character-card__coin-icon">🪙</span>
          <span className="home-character-card__coin-value">{formatCoins(player.coins)}</span>
        </div>
      </div>

      {/* 経験値バー */}
      <div className="home-exp">
        <div className="home-exp__header">
          <span className="home-exp__label">経験値</span>
          <span className="home-exp__value">
            {progress.atMaxLevel ? 'MAX' : `残り ${progress.experienceToNextLevel ?? 0} EXP`}
          </span>
        </div>
        <div className="home-exp__bar">
          <div
            className="home-exp__bar-fill"
            style={{ width: `${expForBar}%` }}
          />
        </div>
      </div>

      {/* ステータスグリッド */}
      <div className="home-stats">
        <div className="home-stats__item">
          <span className="home-stats__icon">📍</span>
          <span className="home-stats__value">{player.stamps.length}</span>
          <span className="home-stats__label">スポット</span>
        </div>
        <div className="home-stats__item">
          <span className="home-stats__icon">⚔️</span>
          <span className="home-stats__value">{player.defeatedBossIds.length}</span>
          <span className="home-stats__label">ボス討伐</span>
        </div>
        <div className="home-stats__item">
          <span className="home-stats__icon">🚶</span>
          <span className="home-stats__value">{(todayWalkMeters / 1000).toFixed(1)}km</span>
          <span className="home-stats__label">今日の距離</span>
        </div>
        <div className="home-stats__item">
          <span className="home-stats__icon">🗺️</span>
          <span className="home-stats__value">{player.unlockedRegionIds.length}</span>
          <span className="home-stats__label">地域解放</span>
        </div>
      </div>

      {/* 現在のクエスト */}
      {currentQuest && currentQuestDisplay && (
        <div className="home-quest">
          <h3 className="home-quest__heading">📜 現在のクエスト</h3>
          <div className="home-quest__card">
            <span className="home-quest__name">
              {currentQuest.definition.name ?? currentQuest.definition.id}
            </span>
            <div className="home-quest__progress">
              <span className="home-quest__count">
                {currentQuestDisplay.satisfiedCount} / {currentQuestDisplay.requiredCount}
              </span>
              <div className="home-quest__bar">
                <div
                  className="home-quest__bar-fill"
                  style={{
                    width: `${currentQuestDisplay.requiredCount > 0 ? Math.round((currentQuestDisplay.satisfiedCount / currentQuestDisplay.requiredCount) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 次のおすすめスポット */}
      {nextSpot && (
        <div className="home-next-spot">
          <h3 className="home-next-spot__heading">🗝️ 次のおすすめスポット</h3>
          <div className="home-next-spot__card">
            <span className="home-next-spot__icon">📍</span>
            <div className="home-next-spot__info">
              <span className="home-next-spot__name">{nextSpot.name}</span>
              <span className="home-next-spot__reward">
                🪙 {nextSpot.firstVisitReward.coins} ・ ✨ {nextSpot.firstVisitReward.experience} EXP
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 冒険のヒント */}
      <div className="home-tip">
        <span className="home-tip__icon">💡</span>
        <span className="home-tip__text">
          スポットに近づくと自動でスタンプが手に入ります。地図で目的地を確認しよう！
        </span>
      </div>
    </section>
  );
}
