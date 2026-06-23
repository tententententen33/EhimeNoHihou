// Shop（ショップ一覧と購入処理）
//
// 本ファイルは設計書「Components and Interfaces > Shop」に従い、
// 購入可能アイテムの一覧表示とコイン取引を行う純粋関数群を実装する（Req 7）。
// Limited_Item（isLimited === true）は購入可能一覧から除外する（Req 7.5）。
//
// 純粋ドメインロジック層に属するため、本ファイルは I/O（永続化・ネットワーク・
// 時刻取得など）を一切行わない。永続化は Repository 層／状態管理層が担当する
// （Req 7.4, 7.6, 7.7）。

import type { ItemCatalog, PlayerState, Result, ShopItem } from './types';

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

/**
 * 購入成功時の結果。
 * - nextState: コイン控除・所持追加後のプレイヤー状態（Req 7.2）
 */
export interface PurchaseResult {
  nextState: PlayerState;
}

/**
 * 購入失敗の理由。
 * - kind 'insufficient_coins': コイン残高がアイテム価格未満（Req 7.3）
 */
export interface PurchaseError {
  kind: 'insufficient_coins';
  /** 必要なコイン価格 */
  required: number;
  /** 現在のコイン残高 */
  available: number;
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * 購入可能アイテムの一覧を返す（Req 7.5, 設計書 Property 19）。
 *
 * カタログ中のすべてのアイテムから `isLimited` が true のアイテム
 * （Limited_Item）を除外した一覧を返す。Limited_Item はボス報酬としてのみ
 * 入手可能であり、Shop では購入できない。
 *
 * @param catalog アイテムカタログ（id からアイテム定義へのルックアップ）
 * @returns Limited_Item を除外した購入可能アイテムの配列
 */
export function listPurchasable(catalog: ItemCatalog): ShopItem[] {
  return Object.values(catalog).filter((item) => !item.isLimited);
}

/**
 * アイテムを購入する（Req 7.2, 7.3, 設計書 Property 17, 18）。
 *
 * コイン残高がアイテム価格以上なら、コインを価格分だけ控除し、当該アイテムを
 * 所持アイテムへ追加した次状態を `Result` 成功で返す（Req 7.2）。
 * コイン残高がアイテム価格未満なら、購入を拒否し、コイン残高・所持アイテムを
 * 一切変更せず（状態不変）、コイン不足を示すエラーを `Result` 失敗で返す
 * （Req 7.3）。
 *
 * 本関数は純粋であり、永続化は行わない（Req 7.4, 7.6, 7.7 は状態管理層が担当）。
 *
 * @param state 購入前のプレイヤー状態（変更しない）
 * @param item 購入対象アイテム
 * @returns 成功時は次状態、失敗時はコイン不足エラー
 */
export function purchase(
  state: PlayerState,
  item: ShopItem
): Result<PurchaseResult, PurchaseError> {
  // 残高不足は拒否し、状態を一切変更しない（Req 7.3, Property 18）
  if (state.coins < item.priceCoins) {
    return {
      ok: false,
      error: {
        kind: 'insufficient_coins',
        required: item.priceCoins,
        available: state.coins,
      },
    };
  }

  // 残高 >= 価格: 控除・所持追加（Req 7.2, Property 17）
  const nextState: PlayerState = {
    ...state,
    coins: state.coins - item.priceCoins,
    ownedItemIds: [...state.ownedItemIds, item.id],
  };

  return { ok: true, value: { nextState } };
}
