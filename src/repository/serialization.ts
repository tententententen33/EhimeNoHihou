// PlayerState のシリアライズ／デシリアライズ（Req 3.2, 7.4, 8.5, 9.5, 11.4）
//
// 本モジュールは `User_Data_Store`（AWS バックエンド）への保存・復元に用いる
// `PlayerState` のシリアライズ（直列化）とデシリアライズ（復元）を担う。
//
// 設計方針:
// - シリアライズは `PlayerState` を JSON 文字列へ変換する。
// - デシリアライズは保存された生データ（JSON 文字列または既にパース済みの
//   オブジェクト）から `PlayerState` を復元する。
// - ラウンドトリップ（Property 35）を満たす。すなわち有効な `PlayerState` を
//   シリアライズして再度デシリアライズすると、コイン・経験値・スタンプ
//   （spotId / earnedAt）・所持アイテム・スロット別有効装備・撃破済みボス・
//   付与済み限定アイテム・称号・解放済み地域（およびクエスト・歩行繰り越し）が
//   同値で復元される。
// - デシリアライズは外部由来の不完全・不正なデータに備え、欠損フィールドには
//   防御的な既定値を補う（基本的な検証）。
//
// 本モジュールは純粋であり I/O を行わない。ネットワーク経由の読み書きは
// `userDataStore.ts`（Task 14.2）が担当する。

import {
  type EquipmentSlot,
  type ISODateTime,
  type PlayerState,
  type QuestProgress,
  type Stamp,
} from '../domain/types';

/** 永続化フォーマットのバージョン（将来のスキーマ移行に備える）。 */
export const SERIALIZATION_VERSION = 1;

/** 装備スロットの全集合（復元時の正規化に用いる）。 */
const EQUIPMENT_SLOTS: EquipmentSlot[] = ['weapon', 'armor', 'accessory'];

// ---------------------------------------------------------------------------
// 小さなヘルパー（防御的正規化）
// ---------------------------------------------------------------------------

/** 値が plain object（配列・null を除く）かどうかを判定する。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 数値を取り出す。数値以外・NaN は既定値にフォールバックする。 */
function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** 0 以上の数値へ正規化する（負値・非数は 0）。 */
function toNonNegativeNumber(value: unknown): number {
  const n = toNumber(value, 0);
  return n < 0 ? 0 : n;
}

/** 文字列を取り出す。文字列以外は既定値にフォールバックする。 */
function toStringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * 文字列配列へ正規化する。配列以外は空配列、文字列以外の要素は除外する。
 * 所持アイテム・撃破済みボス・限定アイテム・称号・解放済み地域などに用いる。
 */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

/** スタンプ配列へ正規化する（spotId / earnedAt のみを保持する）。 */
function toStamps(value: unknown): Stamp[] {
  if (!Array.isArray(value)) return [];
  const stamps: Stamp[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    if (typeof raw.spotId !== 'string') continue;
    const earnedAt: ISODateTime = typeof raw.earnedAt === 'string' ? raw.earnedAt : '';
    stamps.push({ spotId: raw.spotId, earnedAt });
  }
  return stamps;
}

/**
 * スロット別有効装備へ正規化する（Req 8.5）。
 * 既知スロットのみを対象とし、文字列でない値・欠損は null（未装備）に補う。
 */
function toEquipped(value: unknown): Record<EquipmentSlot, string | null> {
  const source = isRecord(value) ? value : {};
  const equipped = {} as Record<EquipmentSlot, string | null>;
  for (const slot of EQUIPMENT_SLOTS) {
    const itemId = source[slot];
    equipped[slot] = typeof itemId === 'string' ? itemId : null;
  }
  return equipped;
}

/**
 * クエスト進行配列へ正規化する（Req 4）。
 * クエスト定義（condition / reward）と進行状態を防御的に復元する。
 */
function toQuests(value: unknown): QuestProgress[] {
  if (!Array.isArray(value)) return [];
  const quests: QuestProgress[] = [];

  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const def = raw.definition;
    if (!isRecord(def) || typeof def.id !== 'string') continue;

    // 達成条件（spots / count）を復元する。
    const rawCondition = def.condition;
    let condition: QuestProgress['definition']['condition'];
    if (isRecord(rawCondition) && rawCondition.kind === 'count') {
      condition = {
        kind: 'count',
        requiredCount: toNonNegativeNumber(rawCondition.requiredCount),
      };
    } else if (isRecord(rawCondition) && rawCondition.kind === 'spots') {
      condition = {
        kind: 'spots',
        requiredSpotIds: toStringArray(rawCondition.requiredSpotIds),
      };
    } else {
      // 不明な条件は空の spots 条件として扱う（防御的）。
      condition = { kind: 'spots', requiredSpotIds: [] };
    }

    // 完了報酬を復元する。
    const rawReward = isRecord(def.reward) ? def.reward : {};
    const reward = {
      coins: toNonNegativeNumber(rawReward.coins),
      experience: toNonNegativeNumber(rawReward.experience),
      items: toStringArray(rawReward.items),
    };

    const definition: QuestProgress['definition'] = {
      id: def.id,
      condition,
      reward,
    };
    // 任意の eventId（後期フェーズ Req 17）を保持する。
    if (typeof def.eventId === 'string') {
      definition.eventId = def.eventId;
    }

    quests.push({
      definition,
      satisfiedSpotIds: toStringArray(raw.satisfiedSpotIds),
      satisfiedCount: toNonNegativeNumber(raw.satisfiedCount),
      complete: raw.complete === true,
      rewardGranted: raw.rewardGranted === true,
    });
  }

  return quests;
}

// ---------------------------------------------------------------------------
// シリアライズ
// ---------------------------------------------------------------------------

/**
 * `PlayerState` を永続化用の JSON 文字列へシリアライズする。
 *
 * 保存対象（Req 3.2, 7.4, 8.5, 9.5, 11.4）:
 * - coins（コイン）/ experience（経験値）
 * - stamps（スタンプ: spotId / earnedAt）
 * - ownedItemIds（所持アイテム）
 * - equipped（スロット別有効装備）
 * - defeatedBossIds（撃破済みボス）
 * - grantedLimitedItemIds（付与済み限定アイテム）
 * - titleIds（称号）/ unlockedRegionIds（解放済み地域）
 * - quests（クエスト進行）/ pendingWalkMeters（歩行繰り越し）
 *
 * @param state 永続化するプレイヤー状態
 * @returns JSON 文字列
 */
export function serialize(state: PlayerState): string {
  const payload = {
    version: SERIALIZATION_VERSION,
    playerId: state.playerId,
    coins: state.coins,
    experience: state.experience,
    stamps: state.stamps.map((s) => ({ spotId: s.spotId, earnedAt: s.earnedAt })),
    ownedItemIds: [...state.ownedItemIds],
    equipped: {
      weapon: state.equipped.weapon,
      armor: state.equipped.armor,
      accessory: state.equipped.accessory,
    },
    defeatedBossIds: [...state.defeatedBossIds],
    grantedLimitedItemIds: [...state.grantedLimitedItemIds],
    titleIds: [...state.titleIds],
    unlockedRegionIds: [...state.unlockedRegionIds],
    quests: state.quests.map((q) => ({
      definition: {
        id: q.definition.id,
        ...(q.definition.eventId !== undefined ? { eventId: q.definition.eventId } : {}),
        condition:
          q.definition.condition.kind === 'count'
            ? { kind: 'count', requiredCount: q.definition.condition.requiredCount }
            : { kind: 'spots', requiredSpotIds: [...q.definition.condition.requiredSpotIds] },
        reward: {
          coins: q.definition.reward.coins,
          experience: q.definition.reward.experience,
          items: [...q.definition.reward.items],
        },
      },
      satisfiedSpotIds: [...q.satisfiedSpotIds],
      satisfiedCount: q.satisfiedCount,
      complete: q.complete,
      rewardGranted: q.rewardGranted,
    })),
    pendingWalkMeters: state.pendingWalkMeters,
  };

  return JSON.stringify(payload);
}

// ---------------------------------------------------------------------------
// デシリアライズ
// ---------------------------------------------------------------------------

/**
 * 永続化された生データから `PlayerState` を復元する。
 *
 * 入力は JSON 文字列、または既にパース済みのオブジェクトのいずれも許容する。
 * 外部由来のデータが不完全・不正な場合に備え、各フィールドは防御的に正規化し、
 * 欠損は既定値（空配列・null・0 など）で補う（基本的な検証）。
 *
 * ラウンドトリップ（Property 35）: `serialize` の出力を本関数に渡すと、
 * 保存対象の各フィールドが同値で復元される。
 *
 * @param raw JSON 文字列またはパース済みオブジェクト
 * @returns 復元された `PlayerState`
 * @throws JSON 文字列のパースに失敗した場合
 */
export function deserialize(raw: string | unknown): PlayerState {
  // 文字列なら JSON としてパースする。パース失敗は例外として通知する。
  const data: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const source = isRecord(data) ? data : {};

  return {
    playerId: toStringValue(source.playerId, ''),
    coins: toNonNegativeNumber(source.coins),
    experience: toNonNegativeNumber(source.experience),
    stamps: toStamps(source.stamps),
    ownedItemIds: toStringArray(source.ownedItemIds),
    equipped: toEquipped(source.equipped),
    defeatedBossIds: toStringArray(source.defeatedBossIds),
    grantedLimitedItemIds: toStringArray(source.grantedLimitedItemIds),
    titleIds: toStringArray(source.titleIds),
    unlockedRegionIds: toStringArray(source.unlockedRegionIds),
    quests: toQuests(source.quests),
    pendingWalkMeters: toNonNegativeNumber(source.pendingWalkMeters),
  };
}
