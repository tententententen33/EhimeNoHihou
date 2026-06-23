// Character ビュー（Task 19.2 / Req 6, 8）。
//
// 本コンポーネントは表示専用（presentational）であり、状態の更新・永続化は行わない。
// ドメイン純粋関数（getProgressDisplay / groupOwnedEquipment / computeStats）から
// 得た表示情報を描画し、装備変更は onEquip コールバックで親へ委譲する（Task 20 で結線）。
//
// 表示内容:
//   - レベル・経験値・次レベル要求（最大到達時は最大表示）（Req 6.4, 6.5）
//   - レベルアップ通知バナー（最低3秒または明示的解除まで表示）（Req 6.3）
//   - スロット別の所持装備グルーピング・空状態・装備変更 UI（Req 8.1, 8.2, 8.3）
//   - 有効装備から合成したキャラクターステータス（Req 8.7, 8.8）
import { useEffect, useState } from 'react';
import type { EquipmentSlot, ItemCatalog, PlayerState } from '../../domain/types';
import {
  computeStats,
  getProgressDisplay,
  groupOwnedEquipment,
} from '../../domain/character';
import './CharacterView.css';

// レベルアップ通知の最低表示時間（ミリ秒, Req 6.3）。
const LEVEL_UP_MIN_DISPLAY_MS = 3000;

// スロットの日本語表示ラベル（表示順は groupOwnedEquipment と同一）。
const SLOT_LABEL: Record<EquipmentSlot, string> = {
  weapon: '武器',
  armor: '防具',
  accessory: 'アクセサリ',
};

// ステータス項目の日本語表示ラベル（表示順を固定）。
const STAT_ROWS: ReadonlyArray<{ key: keyof ReturnType<typeof computeStats>; label: string }> = [
  { key: 'attack', label: '攻撃' },
  { key: 'defense', label: '防御' },
  { key: 'hp', label: 'HP' },
  { key: 'speed', label: '速さ' },
];

export interface CharacterViewProps {
  // 表示対象のプレイヤー状態。
  player: PlayerState;
  // アイテムカタログ（id → 定義のルックアップ）。
  itemCatalog: ItemCatalog;
  // 装備変更ハンドラ。対象アイテム id を親へ通知する（Req 8.3）。
  onEquip: (itemId: string) => void;
  // レベルアップ通知。表示対象が無い場合は null（Req 6.3）。
  levelUp?: { newLevel: number } | null;
  // レベルアップ通知の解除ハンドラ（明示的解除, Req 6.3）。
  onDismissLevelUp?: () => void;
}

export function CharacterView({
  player,
  itemCatalog,
  onEquip,
  levelUp = null,
  onDismissLevelUp,
}: CharacterViewProps) {
  // ドメイン純粋関数から表示情報を導出する（再計算は描画時に都度行う）。
  const progress = getProgressDisplay(player);
  const slotGroups = groupOwnedEquipment(player, itemCatalog);
  const stats = computeStats(player, itemCatalog);

  // レベルアップ通知を最低3秒は解除できないようにするためのフラグ（Req 6.3）。
  const [canDismiss, setCanDismiss] = useState(false);

  useEffect(() => {
    // 通知が表示されていない間は何もしない。
    if (levelUp === null) {
      return;
    }
    // 新しい通知が来たら解除不可へ戻し、最低表示時間の経過後に解除可能にする。
    setCanDismiss(false);
    const timerId = window.setTimeout(() => {
      setCanDismiss(true);
    }, LEVEL_UP_MIN_DISPLAY_MS);
    return () => window.clearTimeout(timerId);
    // newLevel が変われば別の通知として再計時する。
  }, [levelUp]);

  // 解除可能になってからのみ親へ解除を通知する（最低3秒の保証, Req 6.3）。
  const handleDismiss = () => {
    if (canDismiss) {
      onDismissLevelUp?.();
    }
  };

  return (
    <section className="character-view" aria-label="キャラクター">
      {/* レベルアップ通知バナー（Req 6.3） */}
      {levelUp !== null && (
        <div className="character-levelup" role="status" aria-live="polite">
          <span className="character-levelup__icon" aria-hidden="true">
            🎉
          </span>
          <span className="character-levelup__text">
            レベルアップ！ レベル {levelUp.newLevel} になりました
          </span>
          <button
            type="button"
            className="character-levelup__dismiss"
            onClick={handleDismiss}
            disabled={!canDismiss}
            aria-label="レベルアップ通知を閉じる"
          >
            閉じる
          </button>
        </div>
      )}

      {/* レベル・経験値・進捗（Req 6.4, 6.5） */}
      <div className="character-progress">
        <div className="character-progress__level">
          <span className="character-progress__level-label">レベル</span>
          <span className="character-progress__level-value">{progress.level}</span>
        </div>
        <dl className="character-progress__detail">
          <div className="character-progress__row">
            <dt>経験値</dt>
            <dd>{progress.experience}</dd>
          </div>
          <div className="character-progress__row">
            <dt>次のレベルまで</dt>
            <dd>
              {progress.atMaxLevel ? (
                // 最大レベル到達時は次レベル要求の代わりに最大表示（Req 6.5）。
                <span className="character-progress__max">最大レベル到達</span>
              ) : (
                <span>残り {progress.experienceToNextLevel} 経験値</span>
              )}
            </dd>
          </div>
        </dl>
      </div>

      {/* 合成ステータス（Req 8.7, 8.8） */}
      <div className="character-stats">
        <h2 className="character-section__title">ステータス</h2>
        <dl className="character-stats__grid">
          {STAT_ROWS.map((row) => (
            <div key={row.key} className="character-stats__row">
              <dt>{row.label}</dt>
              <dd>{stats[row.key]}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* スロット別の所持装備（Req 8.1, 8.2, 8.3） */}
      <div className="character-equipment">
        <h2 className="character-section__title">装備</h2>
        {slotGroups.map((group) => (
          <div key={group.slot} className="character-slot">
            <h3 className="character-slot__title">{SLOT_LABEL[group.slot]}</h3>
            {group.isEmpty ? (
              // 所持アイテムが無いスロットは空状態を表示（Req 8.2）。
              <p className="character-slot__empty">所持アイテムがありません</p>
            ) : (
              <ul className="character-slot__items">
                {group.items.map((item) => {
                  const isActive = group.activeItemId === item.id;
                  return (
                    <li
                      key={item.id}
                      className={`character-item${isActive ? ' character-item--active' : ''}`}
                    >
                      <div className="character-item__info">
                        <span className="character-item__name">{item.name}</span>
                        <span className="character-item__effect">
                          {item.effectDescription}
                        </span>
                      </div>
                      {isActive ? (
                        // 現在の有効装備は装備済みを示す（再装備不要）。
                        <span className="character-item__badge" aria-label="装備中">
                          装備中
                        </span>
                      ) : (
                        // 装備変更は親へ委譲する（Req 8.3）。
                        <button
                          type="button"
                          className="character-item__equip"
                          onClick={() => onEquip(item.id)}
                        >
                          装備する
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
