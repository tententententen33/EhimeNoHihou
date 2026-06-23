// Character_System（キャラクター成長・装備）
//
// 本ファイルは設計書「Components and Interfaces > Character_System」に従い、
// レベル・経験値・装備・ステータスを管理する純粋関数群を実装する（Req 6, 8）。
//
// 純粋ドメインロジック層に属するため、本ファイルは I/O（永続化・ネットワーク・
// 時刻取得など）を一切行わない。永続化は Repository 層が担当する。
//
// ファイル構成（セクション）:
//   1. レベル・経験値ロジック（Task 8.1, Req 6.1/6.2/6.4/6.5/6.6）
//   2. 装備管理とステータス合成（Task 8.2, Req 8.x）※別タスクで追加
//
// 各セクションは独立して追記できるよう、名前付きエクスポートで構成する。

import type {
  PlayerState,
  Result,
  EquipmentSlot,
  ItemCatalog,
  ShopItem,
  CharacterStats,
} from './types';
import { ZERO_STATS } from './types';

// ===========================================================================
// セクション 1: レベル・経験値ロジック（Task 8.1）
// ===========================================================================

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/** 最小レベル（新規プレイヤーの開始レベル, Req 6.1） */
export const MIN_LEVEL = 1;

/** 最大レベル（Req 6.1, 6.2） */
export const MAX_LEVEL = 99;

/**
 * 経験値カーブの基底係数。
 *
 * レベル L（1〜99）に到達するために必要な累積経験値を、二次曲線
 *   threshold(L) = BASE_EXPERIENCE * (L - 1)^2
 * で定義する（documented XP curve）。
 * - L = 1 → 0（新規プレイヤーは経験値 0 でレベル 1, Req 6.1）
 * - L = 2 → 100, L = 3 → 400, ... と単調増加する
 * - L = 99 → 100 * 98^2 = 960,400（最大レベル到達に必要な経験値）
 *
 * 二次曲線は L に対して厳密に単調増加するため、経験値からレベルへの導出は
 * 単調かつ有界（1〜99）になる（設計書 Property 14）。
 */
export const BASE_EXPERIENCE = 100;

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

/**
 * 経験値操作のエラー（Req 6.6, Property 16）。
 * 結果の経験値が 0 未満になる操作は拒否され、本エラーが返る。
 */
export interface ExperienceError {
  kind: 'negativeExperience';
  /** 適用しようとした増減量 */
  delta: number;
  /** 操作前の（保持される）経験値 */
  previousExperience: number;
  /** 適用すると 0 未満になる計算結果（参考） */
  attemptedExperience: number;
}

/**
 * レベル表示情報（Req 6.4, 6.5, Property 15）。
 * - level: 現在レベル（1〜99）
 * - experience: 現在の累積経験値
 * - atMaxLevel: 最大レベル（99）に到達済みか
 * - experienceToNextLevel: 次レベルに必要な残り経験値（正の値）。
 *     最大レベル時は次レベル要求の代わりに null（最大到達表示）とする。
 */
export interface LevelDisplay {
  level: number;
  experience: number;
  atMaxLevel: boolean;
  experienceToNextLevel: number | null;
}

// ---------------------------------------------------------------------------
// 内部ヘルパー
// ---------------------------------------------------------------------------

/**
 * レベル L（1〜99）に到達するために必要な累積経験値を返す。
 * threshold(L) = BASE_EXPERIENCE * (L - 1)^2（二次曲線, 単調増加）。
 */
function thresholdForLevel(level: number): number {
  const n = level - 1;
  return BASE_EXPERIENCE * n * n;
}

/** 経験値入力を 0 以上の有限値へ正規化する（不正入力でも破綻させない）。 */
function normalizeExperience(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * 累積経験値からレベルを導出する（Req 6.1, 6.2, Property 14）。
 *
 * 閾値 threshold(L) <= experience を満たす最大の L を返す。結果は 1〜99 に
 * 丸められ、experience が 0（または不正値）のときレベルは 1 になる。
 * 二次曲線の単調性により exp1 <= exp2 ⇒ level(exp1) <= level(exp2) が成り立ち、
 * 単一の経験値獲得で複数閾値を越えても 99 を超えない（有界性）。
 *
 * @param experience 累積経験値（0 以上を想定。負値・NaN は 0 として扱う）
 * @returns 1〜99 のレベル
 */
export function levelForExperience(experience: number): number {
  const exp = normalizeExperience(experience);
  let level = MIN_LEVEL;
  // MIN_LEVEL+1 から順に閾値を満たすか判定する（最大でも 98 回）。
  for (let candidate = MIN_LEVEL + 1; candidate <= MAX_LEVEL; candidate++) {
    if (exp >= thresholdForLevel(candidate)) {
      level = candidate;
    } else {
      break;
    }
  }
  return level;
}

/**
 * プレイヤーの経験値を増減する（Req 6.6, Property 16）。
 *
 * 結果の経験値が 0 未満になる操作は `Result` 失敗で拒否し、直前の経験値を
 * 保持する（状態は変更しない）。正常時は経験値を更新した新しい状態を返す。
 * レベルは経験値から都度導出するため（`levelForExperience`）、本関数は
 * 経験値のみを更新する。永続化は行わない（Repository 層が担当）。
 *
 * @param state 現在のプレイヤー状態（変更しない）
 * @param delta 経験値の増減量（正負いずれも可）
 * @returns 成功時は更新後の状態、失敗時は ExperienceError
 */
export function addExperience(
  state: PlayerState,
  delta: number
): Result<PlayerState, ExperienceError> {
  const attempted = state.experience + delta;

  // 0 未満になる操作（または NaN を生む不正な delta）は拒否し、直前値を保持する。
  if (!Number.isFinite(attempted) || attempted < 0) {
    return {
      ok: false,
      error: {
        kind: 'negativeExperience',
        delta,
        previousExperience: state.experience,
        attemptedExperience: attempted,
      },
    };
  }

  return {
    ok: true,
    value: { ...state, experience: attempted },
  };
}

/**
 * レベル・経験値の表示情報を返す（Req 6.4, 6.5, Property 15）。
 *
 * - 99 未満: 現在レベル・現在経験値・次レベルに必要な残り経験値（正の値）を含む。
 * - 99（最大）: 次レベル要求の代わりに最大到達表示（experienceToNextLevel = null）。
 *
 * 残り経験値は threshold(level + 1) - experience で計算する。`level` は閾値を
 * 満たす最大レベルであるため threshold(level + 1) > experience が保証され、
 * 残り経験値は常に正になる。
 *
 * @param state 現在のプレイヤー状態
 * @returns レベル表示情報
 */
export function getProgressDisplay(state: PlayerState): LevelDisplay {
  const experience = normalizeExperience(state.experience);
  const level = levelForExperience(experience);

  if (level >= MAX_LEVEL) {
    // 最大レベル到達: 次レベル要求の代わりに最大到達表示（Req 6.5）
    return {
      level: MAX_LEVEL,
      experience,
      atMaxLevel: true,
      experienceToNextLevel: null,
    };
  }

  // 99 未満: 次レベルに必要な残り経験値（正の値）を含める（Req 6.4）
  const experienceToNextLevel = thresholdForLevel(level + 1) - experience;
  return {
    level,
    experience,
    atMaxLevel: false,
    experienceToNextLevel,
  };
}

// ===========================================================================
// セクション 2: 装備管理とステータス合成（Task 8.2）
// ===========================================================================
//
// 本セクションは設計書「Character_System」に従い、装備の付け替え（スロット
// 唯一化）・無効操作の拒否・有効装備からのステータス再計算・所持装備の
// スロット別グルーピング表示を純粋関数として実装する（Req 8.1〜8.4, 8.7, 8.8）。
//
// 永続化（Req 8.5, 8.6）は本ドメイン層では扱わず、状態管理／Repository 層が
// 担当する。本セクションの関数はすべて I/O を持たない純粋関数である。

// ---------------------------------------------------------------------------
// 全スロット一覧（装備処理・グルーピングの走査に使用）
// ---------------------------------------------------------------------------

/** 装備スロットの全列挙（武器・防具・アクセサリ） */
export const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = [
  'weapon',
  'armor',
  'accessory',
];

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

/**
 * 装備操作のエラー（Req 8.4, Property 21）。
 * - notOwned: 所持していないアイテムを装備しようとした
 * - unknownItem: カタログに存在しないアイテム id を指定した
 * - slotMismatch: 指定アイテムが対象スロットに適合しない（参考情報を含む）
 *
 * いずれの失敗時も状態は変更されず、対象スロットの有効アイテムは保持される。
 */
export type EquipError =
  | { kind: 'notOwned'; itemId: string }
  | { kind: 'unknownItem'; itemId: string }
  | { kind: 'slotMismatch'; itemId: string; slot: EquipmentSlot };

/**
 * スロット別のグルーピング表示要素（Req 8.1, 8.2）。
 * - slot: 対象スロット
 * - items: そのスロットに装備可能な所持アイテム（当該スロット適合のもののみ）
 * - activeItemId: 現在の有効アイテム id（未装備は null）
 * - isEmpty: そのスロットに所持アイテムが 1 つも無い空状態か（Req 8.2）
 */
export interface EquipmentSlotGroup {
  slot: EquipmentSlot;
  items: ShopItem[];
  activeItemId: string | null;
  isEmpty: boolean;
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * 所持アイテムを対応スロットに装備する（Req 8.3, 8.4, Property 20, 21）。
 *
 * 検証順序:
 *   1. カタログに存在しない id → `unknownItem` 失敗
 *   2. 所持していない id → `notOwned` 失敗
 * 成功時は、そのアイテムのスロットに対し有効アイテムを当該 id へ更新し、
 * 同スロットに既存の有効アイテムがあれば自動的に解除される（スロット唯一性）。
 * 失敗時は状態を一切変更せず、対象スロットの有効アイテムを保持する。
 *
 * 注: アイテムの所属スロットはカタログ定義（`ShopItem.slot`）が唯一の真実で
 * あるため、「対象スロットへの適合」はカタログ上のスロットへ装備することと
 * 同義になる。所持済みかつカタログに存在すれば、そのアイテムは自身のスロット
 * に必ず適合するため `slotMismatch` は通常発生しない（型の健全性のため
 * `EquipError` には定義として残す）。
 *
 * @param state 現在のプレイヤー状態（変更しない）
 * @param itemId 装備したいアイテム id
 * @param catalog アイテムカタログ（id → 定義のルックアップ）
 * @returns 成功時は更新後の状態、失敗時は EquipError
 */
export function equip(
  state: PlayerState,
  itemId: string,
  catalog: ItemCatalog
): Result<PlayerState, EquipError> {
  const item = catalog[itemId];

  // カタログに存在しない id は装備不可（Req 8.4）。状態は変更しない。
  if (item === undefined) {
    return { ok: false, error: { kind: 'unknownItem', itemId } };
  }

  // 所持していないアイテムは装備不可（Req 8.4）。状態は変更しない。
  if (!state.ownedItemIds.includes(itemId)) {
    return { ok: false, error: { kind: 'notOwned', itemId } };
  }

  // 当該アイテムのスロットへ有効アイテムを唯一化（旧装備は自動解除, Req 8.3）。
  return {
    ok: true,
    value: {
      ...state,
      equipped: {
        ...state.equipped,
        [item.slot]: itemId,
      },
    },
  };
}

/**
 * 全有効装備のステータス効果を合算する（Req 8.7, 8.8, Property 23）。
 *
 * 各スロットの有効アイテム（`PlayerState.equipped`）について、カタログ定義の
 * `statEffects`（寄与項目のみの `Partial`）を `ZERO_STATS` から各項目へ加算する。
 * 空スロット（null）やカタログに存在しない id は寄与しない（Req 8.8）。
 *
 * @param state 現在のプレイヤー状態
 * @param items アイテムカタログ（id → 定義のルックアップ）
 * @returns 合成後のキャラクターステータス
 */
export function computeStats(
  state: PlayerState,
  items: ItemCatalog
): CharacterStats {
  // ZERO_STATS は共有定数のため、複製してから加算する（不変性の保持）。
  const total: CharacterStats = { ...ZERO_STATS };

  for (const slot of EQUIPMENT_SLOTS) {
    const activeItemId = state.equipped[slot];
    // 空スロットは効果を寄与しない（Req 8.8）。
    if (activeItemId === null) {
      continue;
    }
    const item = items[activeItemId];
    // カタログ未定義の id も寄与しない（防御的・状態は破綻させない）。
    if (item === undefined) {
      continue;
    }
    const effects = item.statEffects;
    total.attack += effects.attack ?? 0;
    total.defense += effects.defense ?? 0;
    total.hp += effects.hp ?? 0;
    total.speed += effects.speed ?? 0;
  }

  return total;
}

/**
 * 所持装備をスロット別にグルーピングして返す（Req 8.1, 8.2, Property 22）。
 *
 * 各スロットについて、当該スロットに適合する所持アイテム（カタログ上の
 * `slot` が一致するもの）のみを列挙する。各アイテムは自身が装備可能な
 * スロットの下にのみ現れる（Req 8.1）。所持アイテムが 1 つも無いスロットは
 * 空状態（`isEmpty: true`, `items: []`）として表示する（Req 8.2）。
 *
 * カタログに存在しない所持 id はスロットを判定できないため、いずれのスロット
 * にも含めない（表示は健全な定義済みアイテムに限る）。
 *
 * @param state 現在のプレイヤー状態
 * @param items アイテムカタログ（id → 定義のルックアップ）
 * @returns 全スロット分の `EquipmentSlotGroup`（EQUIPMENT_SLOTS の順）
 */
export function groupOwnedEquipment(
  state: PlayerState,
  items: ItemCatalog
): EquipmentSlotGroup[] {
  // 所持 id をカタログ定義へ解決する（未定義 id は除外）。
  const ownedItems: ShopItem[] = [];
  for (const id of state.ownedItemIds) {
    const item = items[id];
    if (item !== undefined) {
      ownedItems.push(item);
    }
  }

  return EQUIPMENT_SLOTS.map((slot) => {
    // 当該スロットに適合する所持アイテムのみを抽出（Req 8.1）。
    const slotItems = ownedItems.filter((item) => item.slot === slot);
    return {
      slot,
      items: slotItems,
      activeItemId: state.equipped[slot],
      isEmpty: slotItems.length === 0, // 所持アイテム無し → 空状態（Req 8.2）
    };
  });
}
