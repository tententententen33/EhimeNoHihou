// Shop ビュー（Task 19.3 / Req 7）。
//
// 購入可能アイテム（名前・コイン価格・効果説明）を一覧表示し（Req 7.1）、
// Limited_Item は一覧から除外する（Req 7.5, listPurchasable に委譲）。
// アイテムごとの購入操作を提供し、購入結果に応じて以下の日本語メッセージを表示する。
//   - 残高不足による拒否メッセージ（Req 7.3）
//   - 購入確定（所持追加）メッセージ（Req 7.8）
//   - 永続化失敗（保存不可）メッセージ（Req 7.6, 7.7）
//
// 本コンポーネントは表示専用（presentational）であり、購入のドメイン処理・永続化・
// 再試行は親（状態管理層）が `onPurchase` の結果として返す。ここではその結果を
// 解釈してメッセージ状態を更新するのみとする。
import { useState } from 'react';
import { listPurchasable } from '../../domain/shop';
import type { ItemCatalog, PlayerState } from '../../domain/types';
import './ShopView.css';

/**
 * 購入操作の結果。親（状態管理層）が `onPurchase` の戻り値として返す。
 * - { ok: true, saved: true }  購入確定かつ永続化成功（Req 7.8）
 * - { ok: true, saved: false } 購入はセッション状態に保持されたが永続化に失敗（Req 7.7）
 * - { ok: false, reason: 'insufficient' } 残高不足で拒否（Req 7.3）
 */
export type PurchaseOutcome =
  | { ok: true; saved: boolean }
  | { ok: false; reason: 'insufficient' };

export interface ShopViewProps {
  /** コイン残高表示・購入判定に用いるプレイヤー状態 */
  player: PlayerState;
  /** アイテムカタログ（購入可能一覧の元データ） */
  itemCatalog: ItemCatalog;
  /** 購入操作ハンドラ。ドメイン購入・永続化・再試行は親が担当する。 */
  onPurchase: (itemId: string) => Promise<PurchaseOutcome> | PurchaseOutcome;
}

// 表示中メッセージの種別（トーン分けに使用）。
type MessageTone = 'success' | 'warning' | 'error';

interface ShopMessage {
  tone: MessageTone;
  text: string;
}

// コイン残高を桁区切りで表示する（最大 999,999,999, Req 7.1）。
function formatCoins(coins: number): string {
  return coins.toLocaleString('ja-JP');
}

export function ShopView({ player, itemCatalog, onPurchase }: ShopViewProps) {
  // 直近の購入操作に対する表示メッセージ（Req 7.3, 7.7, 7.8）。
  const [message, setMessage] = useState<ShopMessage | null>(null);
  // 購入処理中のアイテム id（多重操作防止のためボタンを無効化する）。
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);

  // Limited_Item を除外した購入可能アイテム一覧（Req 7.5）。
  const purchasableItems = listPurchasable(itemCatalog);

  async function handlePurchase(itemId: string, itemName: string) {
    // 連続操作中は何もしない。
    if (pendingItemId !== null) {
      return;
    }
    setPendingItemId(itemId);
    setMessage(null);
    try {
      const outcome = await onPurchase(itemId);
      if (!outcome.ok) {
        // 残高不足の拒否（Req 7.3）。
        setMessage({
          tone: 'error',
          text: 'コインが不足しているため購入できません。',
        });
        return;
      }
      if (outcome.saved) {
        // 購入確定・所持追加（Req 7.8）。
        setMessage({
          tone: 'success',
          text: `「${itemName}」を購入し、所持アイテムに追加しました。`,
        });
      } else {
        // 永続化に失敗したが、購入内容はセッション状態に保持（Req 7.7）。
        setMessage({
          tone: 'warning',
          text: `「${itemName}」の購入を保存できませんでした。通信環境の回復後に自動で再保存されます。`,
        });
      }
    } finally {
      setPendingItemId(null);
    }
  }

  return (
    <section className="shop-view" aria-label="ショップ">
      {/* コイン残高表示 */}
      <header className="shop-view__header">
        <h2 className="shop-view__title">ショップ</h2>
        <p className="shop-view__balance">
          所持コイン
          <span className="shop-view__balance-value">
            {formatCoins(player.coins)}
          </span>
        </p>
      </header>

      {/* 購入結果メッセージ（Req 7.3, 7.7, 7.8） */}
      {message !== null && (
        <p
          className={`shop-view__message shop-view__message--${message.tone}`}
          role={message.tone === 'success' ? 'status' : 'alert'}
          aria-live="polite"
        >
          {message.text}
        </p>
      )}

      {/* 購入可能アイテム一覧（Req 7.1, 7.5） */}
      {purchasableItems.length === 0 ? (
        <p className="shop-view__empty">購入できるアイテムはありません。</p>
      ) : (
        <ul className="shop-view__list">
          {purchasableItems.map((item) => {
            const isPending = pendingItemId === item.id;
            const isDisabled = pendingItemId !== null;
            return (
              <li key={item.id} className="shop-item">
                <div className="shop-item__info">
                  <span className="shop-item__name">{item.name}</span>
                  <span className="shop-item__price">
                    {formatCoins(item.priceCoins)} コイン
                  </span>
                  <p className="shop-item__description">
                    {item.effectDescription}
                  </p>
                </div>
                <button
                  type="button"
                  className="shop-item__buy"
                  disabled={isDisabled}
                  aria-label={`${item.name}を購入する`}
                  onClick={() => handlePurchase(item.id, item.name)}
                >
                  {isPending ? '購入中…' : '購入'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
