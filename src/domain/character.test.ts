// Character_System のプロパティテスト（Task 8.3〜8.9）
//
// 本ファイルは設計書「Correctness Properties」の Property 14, 15, 16, 20, 21,
// 22, 23 を fast-check で検証する。レベル・経験値ロジック（Req 6.x）と装備・
// ステータス合成ロジック（Req 8.x）が、任意の入力に対して普遍的な性質を満たす
// ことを確認する。各プロパティは最低 100 回（numRuns: 100）試行する。
//
// 純粋ドメイン関数のためモック・フェイクは使用せず、実際の振る舞いを検証する。

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  levelForExperience,
  addExperience,
  getProgressDisplay,
  equip,
  computeStats,
  groupOwnedEquipment,
  MIN_LEVEL,
  MAX_LEVEL,
  EQUIPMENT_SLOTS,
} from './character';
import { createInitialPlayerState } from './types';
import type {
  PlayerState,
  EquipmentSlot,
  ItemCatalog,
  CharacterStats,
} from './types';

// ---------------------------------------------------------------------------
// 共通ヘルパー
// ---------------------------------------------------------------------------

/** テスト用の基準プレイヤー状態（経験値 0・所持/装備なし） */
function baseState(): PlayerState {
  return createInitialPlayerState('p1', 'region-1');
}

// ---------------------------------------------------------------------------
// fast-check アービトラリ（ShopItem / ItemCatalog / PlayerState 構成要素）
// ---------------------------------------------------------------------------

/** 装備スロットの任意生成 */
const slotArb = fc.constantFrom<EquipmentSlot>('weapon', 'armor', 'accessory');

/**
 * ステータス効果（`Partial<CharacterStats>`）の任意生成。
 * 寄与項目のみを持つよう requiredKeys を空にして全項目を省略可能とする。
 */
const statEffectsArb = fc.record(
  {
    attack: fc.integer({ min: -50, max: 50 }),
    defense: fc.integer({ min: -50, max: 50 }),
    hp: fc.integer({ min: -100, max: 100 }),
    speed: fc.integer({ min: -50, max: 50 }),
  },
  { requiredKeys: [] }
);

/**
 * アイテムカタログ（`ItemCatalog`）の任意生成。
 * id は一意な短い文字列とし、各 id にスロット・ステータス効果を持つ ShopItem を割り当てる。
 */
const catalogArb: fc.Arbitrary<ItemCatalog> = fc
  .uniqueArray(
    fc.record({
      id: fc.string({ minLength: 1, maxLength: 6 }),
      slot: slotArb,
      statEffects: statEffectsArb,
      priceCoins: fc.integer({ min: 1, max: 1000 }),
      isLimited: fc.boolean(),
    }),
    { selector: (r) => r.id, minLength: 1, maxLength: 8 }
  )
  .map((records) => {
    const catalog: ItemCatalog = {};
    for (const r of records) {
      catalog[r.id] = {
        id: r.id,
        name: `item-${r.id}`,
        priceCoins: r.priceCoins,
        effectDescription: '',
        slot: r.slot,
        statEffects: r.statEffects,
        isLimited: r.isLimited,
      };
    }
    return catalog;
  });

/**
 * 所持アイテムを当該スロットへ装備した状態（`equipped`）の任意生成。
 * 各スロットには「null」または「そのスロットに適合する所持アイテム id」を割り当てる。
 */
function equippedFromOwnedArb(
  catalog: ItemCatalog,
  owned: string[]
): fc.Arbitrary<Record<EquipmentSlot, string | null>> {
  const candidatesFor = (slot: EquipmentSlot) =>
    owned.filter((id) => catalog[id]?.slot === slot);
  const slotArbFor = (slot: EquipmentSlot): fc.Arbitrary<string | null> => {
    const candidates = candidatesFor(slot);
    return candidates.length === 0
      ? fc.constant(null)
      : fc.oneof(fc.constant<string | null>(null), fc.constantFrom(...candidates));
  };
  return fc.record({
    weapon: slotArbFor('weapon'),
    armor: slotArbFor('armor'),
    accessory: slotArbFor('accessory'),
  });
}

/** カタログ内の任意 id（または null）をスロットごとに割り当てた `equipped` の任意生成 */
function equippedFromCatalogArb(
  catalog: ItemCatalog
): fc.Arbitrary<Record<EquipmentSlot, string | null>> {
  const ids = Object.keys(catalog);
  const per = fc.oneof(fc.constant<string | null>(null), fc.constantFrom(...ids));
  return fc.record({ weapon: per, armor: per, accessory: per });
}

// ===========================================================================
// Task 8.3 / Property 14: レベル導出の単調・有界性（Req 6.1, 6.2）
// ===========================================================================

describe('Feature: ehime-location-rpg, Property 14: レベル導出の単調・有界性', () => {
  it('任意の経験値に対しレベルは 1..99 に有界で、経験値に対し単調非減少（exp 0 は level 1）', () => {
    // 経験値 0 は必ず level 1（Req 6.1）
    expect(levelForExperience(0)).toBe(MIN_LEVEL);

    // 極端に大きい経験値でも 99 を超えない（有界性, Req 6.2）
    expect(levelForExperience(Number.MAX_SAFE_INTEGER)).toBe(MAX_LEVEL);

    // 有界性: 任意の exp>=0 で level は 1..99
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 2_000_000, noNaN: true, noDefaultInfinity: true }),
        (exp) => {
          const level = levelForExperience(exp);
          expect(level).toBeGreaterThanOrEqual(MIN_LEVEL);
          expect(level).toBeLessThanOrEqual(MAX_LEVEL);
        }
      ),
      { numRuns: 100 }
    );

    // 単調性: exp1 <= exp2 ならば level(exp1) <= level(exp2)
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 2_000_000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 2_000_000, noNaN: true, noDefaultInfinity: true }),
        (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          const levelLo = levelForExperience(lo);
          const levelHi = levelForExperience(hi);
          expect(levelLo).toBeLessThanOrEqual(levelHi);
          expect(levelLo).toBeGreaterThanOrEqual(MIN_LEVEL);
          expect(levelHi).toBeLessThanOrEqual(MAX_LEVEL);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ===========================================================================
// Task 8.4 / Property 15: レベル表示内容（Req 6.4, 6.5）
// ===========================================================================

describe('Feature: ehime-location-rpg, Property 15: レベル表示内容', () => {
  it('99 未満は次レベル要求が正の値、99 到達時は atMaxLevel かつ次レベル要求は null', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 2_000_000, noNaN: true, noDefaultInfinity: true }),
        (exp) => {
          const state: PlayerState = { ...baseState(), experience: exp };
          const display = getProgressDisplay(state);

          if (display.atMaxLevel) {
            // 最大レベル到達: level 99・次レベル要求は null（Req 6.5）
            expect(display.level).toBe(MAX_LEVEL);
            expect(display.experienceToNextLevel).toBeNull();
          } else {
            // 99 未満: level は 1..98、現在経験値を含み、次レベル要求は正の値（Req 6.4）
            expect(display.level).toBeGreaterThanOrEqual(MIN_LEVEL);
            expect(display.level).toBeLessThan(MAX_LEVEL);
            expect(display.experience).toBe(exp);
            expect(display.experienceToNextLevel).not.toBeNull();
            expect(display.experienceToNextLevel as number).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ===========================================================================
// Task 8.5 / Property 16: 経験値の非負拒否（Req 6.6）
// ===========================================================================

describe('Feature: ehime-location-rpg, Property 16: 経験値の非負拒否', () => {
  it('結果が 0 未満なら拒否し直前値を保持、そうでなければ previous+delta で成功する', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -1_000_000, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
        (exp, delta) => {
          const state: PlayerState = { ...baseState(), experience: exp };
          const result = addExperience(state, delta);
          const attempted = exp + delta;

          if (attempted < 0) {
            // 0 未満になる操作は拒否（Result fail）し、直前の経験値を保持（Req 6.6）
            expect(result.ok).toBe(false);
            expect(state.experience).toBe(exp); // 入力状態は不変
            if (!result.ok) {
              expect(result.error.previousExperience).toBe(exp);
            }
          } else {
            // 正常時は previous + delta で成功
            expect(result.ok).toBe(true);
            if (result.ok) {
              expect(result.value.experience).toBe(attempted);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ===========================================================================
// Task 8.6 / Property 20: 装備の付け替え（スロット唯一性）（Req 8.3）
// ===========================================================================

describe('Feature: ehime-location-rpg, Property 20: 装備の付け替え（スロット唯一性）', () => {
  // 所持アイテム（非空）と装備対象・初期装備状態を生成する
  const scenarioArb = catalogArb.chain((catalog) => {
    const ids = Object.keys(catalog);
    return fc.subarray(ids, { minLength: 1 }).chain((owned) =>
      fc
        .record({
          target: fc.constantFrom(...owned),
          equipped: equippedFromOwnedArb(catalog, owned),
        })
        .map(({ target, equipped }) => ({ catalog, owned, target, equipped }))
    );
  });

  it('所持アイテムを自身のスロットへ装備すると有効化され、旧装備は解除され、スロットごとに高々 1 つだけ有効', () => {
    fc.assert(
      fc.property(scenarioArb, ({ catalog, owned, target, equipped }) => {
        const state: PlayerState = {
          ...baseState(),
          ownedItemIds: owned,
          equipped,
        };
        const result = equip(state, target, catalog);

        expect(result.ok).toBe(true);
        if (result.ok) {
          const slot = catalog[target].slot;
          // 対象スロットの有効アイテムが target になる（旧装備は自動解除, Req 8.3）
          expect(result.value.equipped[slot]).toBe(target);

          // 他スロットは変更されない
          for (const s of EQUIPMENT_SLOTS) {
            if (s !== slot) {
              expect(result.value.equipped[s]).toBe(equipped[s]);
            }
            // 各スロットは高々 1 つの有効アイテム（string か null の単一値）
            const v = result.value.equipped[s];
            expect(v === null || typeof v === 'string').toBe(true);
          }

          // 入力状態は不変（純粋関数）
          expect(state.equipped[slot]).toBe(equipped[slot]);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ===========================================================================
// Task 8.7 / Property 21: 無効な装備操作の拒否（Req 8.4）
// ===========================================================================

describe('Feature: ehime-location-rpg, Property 21: 無効な装備操作の拒否', () => {
  // 未所持アイテム または カタログ未定義アイテムを装備対象に生成する
  const invalidArb = catalogArb.chain((catalog) => {
    const ids = Object.keys(catalog);
    return fc.subarray(ids).chain((owned) => {
      const notOwned = ids.filter((id) => !owned.includes(id));
      const unknownArb = fc
        .string({ minLength: 1, maxLength: 8 })
        .filter((s) => !(s in catalog))
        .map((target) => ({ catalog, owned, target }));
      if (notOwned.length === 0) {
        return unknownArb;
      }
      const notOwnedArb = fc
        .constantFrom(...notOwned)
        .map((target) => ({ catalog, owned, target }));
      return fc.oneof(notOwnedArb, unknownArb);
    });
  });

  it('未所持・未定義アイテムの装備は Result fail で拒否され、状態は変更されない', () => {
    fc.assert(
      fc.property(invalidArb, ({ catalog, owned, target }) => {
        const state: PlayerState = {
          ...baseState(),
          ownedItemIds: owned,
          equipped: { weapon: null, armor: null, accessory: null },
        };
        const snapshot = JSON.stringify(state);

        const result = equip(state, target, catalog);

        expect(result.ok).toBe(false);
        // 状態は一切変更されない（Req 8.4）
        expect(JSON.stringify(state)).toBe(snapshot);
      }),
      { numRuns: 100 }
    );
  });
});

// ===========================================================================
// Task 8.8 / Property 22: 装備グルーピングの正当性（Req 8.1）
// ===========================================================================

describe('Feature: ehime-location-rpg, Property 22: 装備グルーピングの正当性', () => {
  const scenarioArb = catalogArb.chain((catalog) => {
    const ids = Object.keys(catalog);
    return fc.subarray(ids).map((owned) => ({ catalog, owned }));
  });

  it('各アイテムは自身のスロットの下にのみ現れ、所持アイテムはちょうど 1 回配置される', () => {
    fc.assert(
      fc.property(scenarioArb, ({ catalog, owned }) => {
        const state: PlayerState = { ...baseState(), ownedItemIds: owned };
        const groups = groupOwnedEquipment(state, catalog);

        // 各グループ内のアイテムは当該スロットに一致する（Req 8.1）
        for (const group of groups) {
          for (const item of group.items) {
            expect(item.slot).toBe(group.slot);
          }
        }

        // 所持（カタログ定義済み）アイテムは全グループ通算でちょうど 1 回現れる
        const ownedDefined = owned.filter((id) => catalog[id] !== undefined);
        const placedIds = groups.flatMap((g) => g.items.map((i) => i.id));
        for (const id of ownedDefined) {
          const count = placedIds.filter((p) => p === id).length;
          expect(count).toBe(1);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ===========================================================================
// Task 8.9 / Property 23: ステータス合成の正当性（Req 8.7, 8.8）
// ===========================================================================

describe('Feature: ehime-location-rpg, Property 23: ステータス合成の正当性', () => {
  const scenarioArb = catalogArb.chain((catalog) =>
    equippedFromCatalogArb(catalog).map((equipped) => ({ catalog, equipped }))
  );

  it('computeStats は有効装備の statEffects を ZERO_STATS に合算した値に等しく、空スロットは寄与しない', () => {
    fc.assert(
      fc.property(scenarioArb, ({ catalog, equipped }) => {
        const state: PlayerState = { ...baseState(), equipped };
        const stats = computeStats(state, catalog);

        // 期待値: 有効スロットの効果のみを 0 から合算（空スロット・未定義は寄与なし, Req 8.8）
        const expected: CharacterStats = { attack: 0, defense: 0, hp: 0, speed: 0 };
        for (const slot of EQUIPMENT_SLOTS) {
          const id = equipped[slot];
          if (id === null) continue;
          const item = catalog[id];
          if (item === undefined) continue;
          expected.attack += item.statEffects.attack ?? 0;
          expected.defense += item.statEffects.defense ?? 0;
          expected.hp += item.statEffects.hp ?? 0;
          expected.speed += item.statEffects.speed ?? 0;
        }

        expect(stats).toEqual(expected);
      }),
      { numRuns: 100 }
    );

    // 空スロットのみのとき合成は全項目 0（Req 8.8）
    const emptyState: PlayerState = { ...baseState() };
    expect(computeStats(emptyState, {})).toEqual({
      attack: 0,
      defense: 0,
      hp: 0,
      speed: 0,
    });
  });
});
