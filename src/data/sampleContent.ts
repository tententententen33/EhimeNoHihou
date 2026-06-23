// サンプルゲームコンテンツ（Task 20.1 用のローカル/開発シード）
//
// 本モジュールは、状態管理層（SessionStore）と各ビューを結線する際に必要となる
// 「ゲーム定義（静的コンテンツ）」一式を提供する。具体的には、愛媛県内の 2 地域に
// またがるスポット、ショップアイテム/装備、限定アイテム付きのボス、クエスト、称号、
// コレクション、地域アンロック順序を定義する。
//
// 【重要】本データはバックエンド（AWS, VITE_API_BASE_URL）が未デプロイのため、
// ローカル/開発でアプリを動作させる目的のサンプルである。実運用では、ゲーム定義は
// バックエンドから取得し、プレイヤー状態の永続化は
//   src/repository/userDataStore.ts の `createUserDataStore`（HTTP 実装, VITE_API_BASE_URL）
// を用いる。差し替えを容易にするため、本サンプルは独立モジュールに分離している。
//
// ここで定義する識別子・座標は実在地に基づくが、ゲームバランスや報酬値はデモ用の
// 暫定値である。

import {
  createInitialPlayerState,
  type Boss,
  type CollectionDefinition,
  type ItemCatalog,
  type PlayerState,
  type QuestDefinition,
  type QuestProgress,
  type Region,
  type Spot,
  type TitleDefinition,
} from '../domain/types';
import type { SessionStoreContext } from '../state/store';

// ---------------------------------------------------------------------------
// 地域（Region）と アンロック順序（Req 10.1, 10.2）
// ---------------------------------------------------------------------------

/** 地域 id（参照の取り違えを防ぐため定数化） */
export const REGION_MATSUYAMA = 'region-matsuyama';
export const REGION_IMABARI = 'region-imabari';

/**
 * 地域定義。アンロック順序は 松山 → 今治 の単一の鎖（全順序, Req 10.1）。
 * - 松山: 最初の地域（predecessorId なし）。新規プレイヤーは松山のみ解放（Req 10.2）。
 * - 今治: 松山の全スポット訪問で解放（allSpotsVisitedInRegion）。
 */
export const REGIONS: Region[] = [
  {
    id: REGION_MATSUYAMA,
    name: '松山エリア',
    predecessorId: null,
    // 最初の地域は初期解放のため、この条件は評価対象にならない（便宜上 stampCount 0）。
    unlockCondition: { kind: 'stampCount', requiredCount: 0 },
  },
  {
    id: REGION_IMABARI,
    name: '今治エリア',
    predecessorId: REGION_MATSUYAMA,
    // 松山エリアの全スポットを訪問すると今治エリアが解放される。
    unlockCondition: { kind: 'allSpotsVisitedInRegion', regionId: REGION_MATSUYAMA },
  },
];

/** Region id の全順序（Spot_Manager の getUnlockOrder 相当）。 */
export const UNLOCK_ORDER: string[] = [REGION_MATSUYAMA, REGION_IMABARI];

// ---------------------------------------------------------------------------
// スポット（Spot）（Req 1.8, 5.3）
// ---------------------------------------------------------------------------

/** スポット id 定数 */
export const SPOT_MATSUYAMA_CASTLE = 'spot-matsuyama-castle';
export const SPOT_DOGO_ONSEN = 'spot-dogo-onsen';
export const SPOT_IMABARI_CASTLE = 'spot-imabari-castle';
export const SPOT_KURUSHIMA_BRIDGE = 'spot-kurushima-bridge';

/**
 * スポット定義。各スポットは実在地の座標と入場半径（20〜200m, Req 1.8）、
 * 初回訪問報酬（Req 5.3）を持つ。
 */
export const SPOTS: Spot[] = [
  {
    id: SPOT_MATSUYAMA_CASTLE,
    name: '松山城',
    description: '松山市の中心、勝山の山頂に建つ現存十二天守のひとつ。',
    center: { lat: 33.8457, lng: 132.7657 },
    entryRadiusMeters: 80,
    regionId: REGION_MATSUYAMA,
    firstVisitReward: { coins: 50, experience: 120, items: [] },
  },
  {
    id: SPOT_DOGO_ONSEN,
    name: '道後温泉本館',
    description: '日本最古級の温泉。レトロな本館建築が名物。',
    center: { lat: 33.8519, lng: 132.7866 },
    entryRadiusMeters: 60,
    regionId: REGION_MATSUYAMA,
    firstVisitReward: { coins: 40, experience: 100, items: [] },
  },
  {
    id: SPOT_IMABARI_CASTLE,
    name: '今治城',
    description: '海水を引き込んだ堀をもつ、日本有数の海城。',
    center: { lat: 34.0667, lng: 132.9979 },
    entryRadiusMeters: 70,
    regionId: REGION_IMABARI,
    firstVisitReward: { coins: 60, experience: 140, items: [] },
  },
  {
    id: SPOT_KURUSHIMA_BRIDGE,
    name: '来島海峡大橋',
    description: 'しまなみ海道を彩る世界初の三連吊橋。',
    center: { lat: 34.1167, lng: 132.9833 },
    entryRadiusMeters: 120,
    regionId: REGION_IMABARI,
    firstVisitReward: { coins: 70, experience: 160, items: [] },
  },
];

/** スポット総数（コレクション/スタンプ集計の分母として使用, Req 3.5）。 */
export const TOTAL_SPOTS = SPOTS.length;

// ---------------------------------------------------------------------------
// アイテム/装備カタログ（Req 7.1, 7.5, 8.x, 9.1）
// ---------------------------------------------------------------------------

/** アイテム id 定数 */
export const ITEM_MIKAN_SWORD = 'item-mikan-sword';
export const ITEM_TOWEL_ARMOR = 'item-towel-armor';
export const ITEM_PONJUICE_CHARM = 'item-ponjuice-charm';
/** 限定アイテム（Limited_Item）。ショップ非表示・ボス報酬でのみ入手（Req 7.5, 9.1）。 */
export const ITEM_BOTCHAN_BLADE = 'item-botchan-blade';

/**
 * アイテムカタログ（id → 定義）。
 * `isLimited: true` のアイテムは Shop 一覧から除外される（Req 7.5）。
 */
export const ITEM_CATALOG: ItemCatalog = {
  [ITEM_MIKAN_SWORD]: {
    id: ITEM_MIKAN_SWORD,
    name: 'みかんの剣',
    priceCoins: 100,
    effectDescription: '愛媛の太陽を浴びて育った一振り。攻撃が上がる。',
    slot: 'weapon',
    statEffects: { attack: 8 },
    isLimited: false,
  },
  [ITEM_TOWEL_ARMOR]: {
    id: ITEM_TOWEL_ARMOR,
    name: '今治タオルの鎧',
    priceCoins: 150,
    effectDescription: 'ふわふわで丈夫な今治タオル製。防御が上がる。',
    slot: 'armor',
    statEffects: { defense: 10, hp: 20 },
    isLimited: false,
  },
  [ITEM_PONJUICE_CHARM]: {
    id: ITEM_PONJUICE_CHARM,
    name: 'ポンジュースのお守り',
    priceCoins: 80,
    effectDescription: '蛇口から出るあの味の力。素早さが上がる。',
    slot: 'accessory',
    statEffects: { speed: 6, hp: 10 },
    isLimited: false,
  },
  [ITEM_BOTCHAN_BLADE]: {
    id: ITEM_BOTCHAN_BLADE,
    name: '坊っちゃんの刃',
    priceCoins: 999_999_999, // ショップ非表示のため価格は名目上の値
    effectDescription: '道後の湯守を退けた者のみが手にする限定の刃。攻撃が大きく上がる。',
    slot: 'weapon',
    statEffects: { attack: 20, speed: 4 },
    isLimited: true, // Limited_Item: Shop から除外（Req 7.5）
  },
};

// ---------------------------------------------------------------------------
// ボス（Boss）（Req 9.1）
// ---------------------------------------------------------------------------

/** ボス id 定数 */
export const BOSS_DOGO_GUARDIAN = 'boss-dogo-guardian';

/**
 * ボス定義。松山エリアに紐づき、報酬として限定アイテム（坊っちゃんの刃）を含む（Req 9.1）。
 * 当該エリアに入場済みであれば可用となる（Req 9.2）。
 */
export const BOSSES: Boss[] = [
  {
    id: BOSS_DOGO_GUARDIAN,
    bind: { kind: 'region', regionId: REGION_MATSUYAMA },
    reward: {
      coins: 120,
      experience: 300,
      items: [],
      limitedItemIds: [ITEM_BOTCHAN_BLADE],
    },
  },
];

// ---------------------------------------------------------------------------
// クエスト（QuestDefinition）（Req 4.1, 4.5）
// ---------------------------------------------------------------------------

/** クエスト id 定数 */
export const QUEST_MATSUYAMA_TOUR = 'quest-matsuyama-tour';
export const QUEST_STAMP_COLLECTOR = 'quest-stamp-collector';

/**
 * クエスト定義。
 * - 松山周遊: 松山エリアの 2 スポットを訪問する（spots 条件）。
 * - スタンプ集め: 相異なる 3 スポットを訪問する（count 条件）。
 */
export const QUEST_DEFINITIONS: QuestDefinition[] = [
  {
    id: QUEST_MATSUYAMA_TOUR,
    condition: {
      kind: 'spots',
      requiredSpotIds: [SPOT_MATSUYAMA_CASTLE, SPOT_DOGO_ONSEN],
    },
    reward: { coins: 80, experience: 200, items: [] },
  },
  {
    id: QUEST_STAMP_COLLECTOR,
    condition: { kind: 'count', requiredCount: 3 },
    reward: { coins: 60, experience: 150, items: [] },
  },
];

// ---------------------------------------------------------------------------
// 称号（TitleDefinition）（Req 11.1）
// ---------------------------------------------------------------------------

/** 称号 id 定数 */
export const TITLE_MATSUYAMA_MASTER = 'title-matsuyama-master';
export const TITLE_DOGO_VICTOR = 'title-dogo-victor';

/**
 * 称号定義。各称号はちょうど 1 つの達成条件を持つ（Req 11.1）。
 * 条件評価に必要な地域メンバーシップ（対象スポット集合・対象ボス集合）を埋め込む。
 */
export const TITLES: TitleDefinition[] = [
  {
    id: TITLE_MATSUYAMA_MASTER,
    name: '松山マスター',
    description: '松山エリアの全スポットを制覇した証。',
    condition: {
      kind: 'allSpotsVisitedInRegion',
      regionId: REGION_MATSUYAMA,
      spotIds: [SPOT_MATSUYAMA_CASTLE, SPOT_DOGO_ONSEN],
    },
  },
  {
    id: TITLE_DOGO_VICTOR,
    name: '道後の勝者',
    description: '道後の湯守を退けた強者。',
    condition: {
      kind: 'allBossesDefeatedInRegion',
      regionId: REGION_MATSUYAMA,
      bossIds: [BOSS_DOGO_GUARDIAN],
    },
  },
];

// ---------------------------------------------------------------------------
// コレクション（CollectionDefinition）（Req 11.6, 11.7, 11.8）
// ---------------------------------------------------------------------------

/** コレクション id 定数 */
export const COLLECTION_ALL_STAMPS = 'collection-all-stamps';
export const COLLECTION_ALL_BOSSES = 'collection-all-bosses';

/**
 * コレクション定義。
 * - 全スタンプ: 全スポットのスタンプを集める（kind: 'stamp'）。
 * - ボス討伐録: 全ボスを撃破する（kind: 'boss'）。
 */
export const COLLECTIONS: CollectionDefinition[] = [
  {
    id: COLLECTION_ALL_STAMPS,
    name: '全スタンプ',
    kind: 'stamp',
    entryIds: SPOTS.map((s) => s.id),
  },
  {
    id: COLLECTION_ALL_BOSSES,
    name: 'ボス討伐録',
    kind: 'boss',
    entryIds: BOSSES.map((b) => b.id),
  },
];

// ---------------------------------------------------------------------------
// 状態管理層へ渡すコンテキストと初期プレイヤー状態
// ---------------------------------------------------------------------------

/** SessionStore に渡す静的コンテキスト（カタログ群）を組み立てる。 */
export function createSampleContext(): SessionStoreContext {
  return {
    spots: SPOTS,
    regions: REGIONS,
    bosses: BOSSES,
    titles: TITLES,
    itemCatalog: ITEM_CATALOG,
    unlockOrder: UNLOCK_ORDER,
    // regionUnlockContext は省略（store が spots の regionId から自動導出する）。
  };
}

/** クエスト定義から初期のクエスト進行（未着手）を生成する。 */
export function createInitialQuests(): QuestProgress[] {
  return QUEST_DEFINITIONS.map((definition) => ({
    definition,
    satisfiedSpotIds: [],
    satisfiedCount: 0,
    complete: false,
    rewardGranted: false,
  }));
}

/**
 * 新規プレイヤーの初期状態を生成する（保存データが無い場合に使用）。
 * アンロック順序の最初の地域（松山）のみ解放し、初期クエストを付与する（Req 10.2）。
 */
export function createSampleInitialState(playerId: string): PlayerState {
  return createInitialPlayerState(playerId, REGION_MATSUYAMA, createInitialQuests());
}
