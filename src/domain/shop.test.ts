// Shop（ショップ一覧・購入処理）のテスト
//
// 設計書「Correctness Properties」の Property 17〜19 をプロパティベーステストで
// 検証する（タスク 9.2〜9.4）。あわせて代表的な具体例・エッジケースを
// ユニットテストで検証する。
//
// 検証対象（src/domain/shop.ts）:
// - listPurchasable(catalog): Limited_Item（isLimited === true）を一覧から除外（Req 7.5）
// - purchase(state, item): 残高 >= 価格なら控除・所持追加（Req 7.2）、
//   残高不足なら Result 失敗で拒否し状態不変（Req 7.3）

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { listPurchasable, purchase } from './shop';
import { createInitialPlayerState } from './types';
import type {
  EquipmentSlot,
  ItemCatalog,
  PlayerState,
  ShopItem,
} from './types';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// fast-check ジェネレータ（任意入力空間の構築）
// ---------------------------------------------------------------------------

/** 装備スロット（weapon / armor / accessory） */
const slotArb: fc.Arbitrary<EquipmentSlot> = fc.constantFrom(
  'weapon',
  'armor',
  'accessory'
);

/**
 * ShopItem ジェネレータ。
 * - priceCoins: 1〜999,999,999（Req 7.1 の価格範囲）
 * - effectDescription: 最大 280 文字（Req 7.1）。非 ASCII を含みうる
 * - isLimited: true/false の双方を生成（Limited_Item 除外の検証用）
 */
const shopItemArb: fc.Arbitrary<ShopItem> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 12 }),
  name: fc.string({ maxLength: 20 }),
  priceCoins: fc.integer({ min: 1, max: 999_999_999 }),
  effectDescription: fc.string({ maxLength: 280 }),
  slot: slotArb,
  statEffects: fc.constant({}),
  isLimited: fc.boolean(),
});

/**
 * ItemCatalog ジェネレータ。
 * 相異なる id を持つ ShopItem 配列から id をキーとするルックアップを構築する。
 * isLimited の真偽が混在するよう、限定/非限定の双方を含みうる集合を生成する。
 */
const itemCatalogArb: fc.Arbitrary<ItemCatalog> = fc
  .uniqueArray(shopItemArb, {
    selector: (item) => item.id,
    maxLength: 12,
  })
  .map((items) => {
    const catalog: ItemCatalog = {};
    for (const item of items) {
      catalog[item.id] = item;
    }
    return catalog;
  });

/**
 * PlayerState ジェネレータ。
 * purchase が参照するフィールド（coins / ownedItemIds）を任意に変化させ、
 * その他は初期状態の妥当な既定値を用いる。coins は非負。
 */
const playerStateArb: fc.Arbitrary<PlayerState> = fc
  .record({
    coins: fc.nat({ max: 1_000_000_000 }),
    ownedItemIds: fc.array(fc.string({ maxLength: 8 }), { maxLength: 5 }),
  })
  .map(({ coins, ownedItemIds }) => ({
    ...createInitialPlayerState('player-1', 'region-1'),
    coins,
    ownedItemIds,
  }));

/**
 * 「状態 + 購入可能（残高 >= 価格）なアイテム」のペア生成器。
 * まずアイテムを生成し、その価格以上の残高を持つ状態を構築することで、
 * 購入成功ケース（Property 17）の入力空間に確実に収める。
 */
const affordablePairArb: fc.Arbitrary<{ state: PlayerState; item: ShopItem }> =
  shopItemArb.chain((item) =>
    fc
      .record({
        // 価格ちょうど（境界）から十分上までを含む残高
        extra: fc.nat({ max: 1_000_000 }),
        ownedItemIds: fc.array(fc.string({ maxLength: 8 }), { maxLength: 5 }),
      })
      .map(({ extra, ownedItemIds }) => ({
        item,
        state: {
          ...createInitialPlayerState('player-1', 'region-1'),
          coins: item.priceCoins + extra,
          ownedItemIds,
        },
      }))
  );

/**
 * 「状態 + コイン不足（残高 < 価格）なアイテム」のペア生成器。
 * 価格は 2 以上に制約し、0〜(価格-1) の残高を割り当てることで、
 * 購入拒否ケース（Property 18）の入力空間に確実に収める。
 */
const unaffordablePairArb: fc.Arbitrary<{ state: PlayerState; item: ShopItem }> =
  shopItemArb
    .map((item) => ({
      ...item,
      // 残高不足を成立させるため価格は 2 以上にする（残高 0〜価格-1 が存在しうる）
      priceCoins: Math.max(2, item.priceCoins),
    }))
    .chain((item) =>
      fc
        .record({
          coins: fc.integer({ min: 0, max: item.priceCoins - 1 }),
          ownedItemIds: fc.array(fc.string({ maxLength: 8 }), { maxLength: 5 }),
        })
        .map(({ coins, ownedItemIds }) => ({
          item,
          state: {
            ...createInitialPlayerState('player-1', 'region-1'),
            coins,
            ownedItemIds,
          },
        }))
    );

// ===========================================================================
// ユニットテスト（具体例・エッジケース）
// ===========================================================================

function baseState(): PlayerState {
  return createInitialPlayerState('p1', 'region-1');
}

function makeItem(overrides: Partial<ShopItem> = {}): ShopItem {
  return {
    id: 'sword',
    name: '名刀',
    priceCoins: 100,
    effectDescription: '攻撃力アップ',
    slot: 'weapon',
    statEffects: { attack: 10 },
    isLimited: false,
    ...overrides,
  };
}

describe('listPurchasable', () => {
  it('Limited_Item（isLimited === true）を一覧から除外する', () => {
    const catalog: ItemCatalog = {
      a: makeItem({ id: 'a', isLimited: false }),
      b: makeItem({ id: 'b', isLimited: true }),
      c: makeItem({ id: 'c', isLimited: false }),
    };

    const result = listPurchasable(catalog);

    expect(result.map((i) => i.id).sort()).toEqual(['a', 'c']);
    expect(result.every((i) => !i.isLimited)).toBe(true);
  });

  it('空カタログでは空配列を返す', () => {
    expect(listPurchasable({})).toEqual([]);
  });
});

describe('purchase', () => {
  it('残高 >= 価格ならコインを控除し所持に追加する（Req 7.2）', () => {
    const state = { ...baseState(), coins: 150 };
    const item = makeItem({ id: 'sword', priceCoins: 100 });

    const result = purchase(state, item);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nextState.coins).toBe(50);
      expect(result.value.nextState.ownedItemIds).toEqual(['sword']);
    }
  });

  it('残高ちょうど（境界）でも購入できる', () => {
    const state = { ...baseState(), coins: 100 };
    const result = purchase(state, makeItem({ priceCoins: 100 }));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.nextState.coins).toBe(0);
  });

  it('残高不足なら Result 失敗で拒否する（Req 7.3）', () => {
    const state = { ...baseState(), coins: 99 };
    const result = purchase(state, makeItem({ priceCoins: 100 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('insufficient_coins');
      expect(result.error.required).toBe(100);
      expect(result.error.available).toBe(99);
    }
  });

  it('入力状態を変更しない（純粋）', () => {
    const state = { ...baseState(), coins: 150 };
    const snapshot = JSON.stringify(state);

    purchase(state, makeItem({ priceCoins: 100 }));

    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

// ===========================================================================
// プロパティベーステスト（fast-check, 各 100 回反復）
//
// 設計書「Correctness Properties」の Property 17〜19 を検証する。
// 各テストには対象プロパティとプロパティ本文をタグコメントとして付与する。
// ===========================================================================

// ---------------------------------------------------------------------------
// Property 17: 購入成功時の残高と所持の更新（Validates: Requirements 7.2）
// ---------------------------------------------------------------------------

describe('Property 17: 購入成功時の残高と所持の更新', () => {
  // Feature: ehime-location-rpg, Property 17: 任意の状態と、残高がアイテム価格以上の
  // アイテムについて、購入は成功し、次状態のコインは元の残高から価格を差し引いた値に
  // 等しく、次状態の所持アイテムは元の所持に当該アイテム id を加えたものに等しい。
  it('残高 >= 価格なら、控除後残高 = 元残高 - 価格、所持に id を追加する', () => {
    fc.assert(
      fc.property(affordablePairArb, ({ state, item }) => {
        const result = purchase(state, item);

        // 残高十分なので購入は必ず成功する
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const next = result.value.nextState;
        // 残高は価格分だけ正確に控除される
        expect(next.coins).toBe(state.coins - item.priceCoins);
        // 所持アイテムは元の所持 + 当該アイテム id
        expect(next.ownedItemIds).toEqual([...state.ownedItemIds, item.id]);
        // 入力状態は不変（純粋）
        expect(state.coins).toBeGreaterThanOrEqual(item.priceCoins);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 18: コイン不足時の購入拒否（Validates: Requirements 7.3）
// ---------------------------------------------------------------------------

describe('Property 18: コイン不足時の購入拒否', () => {
  // Feature: ehime-location-rpg, Property 18: 任意の状態と、残高がアイテム価格未満の
  // アイテムについて、購入は失敗（Result fail）し、コイン残高と所持アイテムは
  // いずれも変更されない（状態不変）。
  it('残高 < 価格なら、Result 失敗を返し coins / ownedItemIds は不変', () => {
    fc.assert(
      fc.property(unaffordablePairArb, ({ state, item }) => {
        const coinsBefore = state.coins;
        const ownedBefore = [...state.ownedItemIds];

        const result = purchase(state, item);

        // 残高不足なので購入は必ず拒否される
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.kind).toBe('insufficient_coins');

        // 入力状態は一切変更されない（状態不変）
        expect(state.coins).toBe(coinsBefore);
        expect(state.ownedItemIds).toEqual(ownedBefore);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 19: 限定アイテムのショップ除外（Validates: Requirements 7.5）
// ---------------------------------------------------------------------------

describe('Property 19: 限定アイテムのショップ除外', () => {
  // Feature: ehime-location-rpg, Property 19: 任意の ItemCatalog について、
  // listPurchasable が返す一覧には isLimited が true のアイテム（Limited_Item）が
  // 一切含まれない。
  it('listPurchasable の結果に isLimited === true のアイテムが含まれない', () => {
    fc.assert(
      fc.property(itemCatalogArb, (catalog) => {
        const result = listPurchasable(catalog);

        // 返却される全アイテムは非限定
        expect(result.every((item) => !item.isLimited)).toBe(true);
        // カタログ中の非限定アイテムはすべて含まれる（過不足なし）
        const expectedIds = Object.values(catalog)
          .filter((item) => !item.isLimited)
          .map((item) => item.id)
          .sort();
        expect(result.map((item) => item.id).sort()).toEqual(expectedIds);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
