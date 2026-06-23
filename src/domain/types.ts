// ドメイン中核データモデルと型定義
//
// 本ファイルは設計書「Data Models」に従い、ドメインロジック層が扱う
// 中核データモデルを TypeScript の型として定義する。型名・識別子は英語のまま、
// 説明は日本語で記述する（設計方針に準拠）。
//
// 純粋ドメインロジック層は副作用を持たないため、ここで定義する型も
// 永続化・I/O に依存しない純粋なデータ構造のみで構成する。

// ---------------------------------------------------------------------------
// 基本型
// ---------------------------------------------------------------------------

/** ISO 8601 形式の日時文字列 */
export type ISODateTime = string;

/**
 * 成否を表す結果型。
 * 無効な操作はドメイン層で失敗値（ok: false）として返し、状態を変更しない。
 */
export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/** 装備スロット（武器・防具・アクセサリ） */
export type EquipmentSlot = 'weapon' | 'armor' | 'accessory';

/**
 * キャラクターのステータス。装備のステータス効果はこの各項目に加算される。
 * `ShopItem.statEffects` は本型の `Partial` として、寄与する項目のみを持つ。
 */
export interface CharacterStats {
  attack: number;
  defense: number;
  hp: number;
  speed: number;
}

/** 全項目 0 のステータス（合成計算の初期値） */
export const ZERO_STATS: CharacterStats = {
  attack: 0,
  defense: 0,
  hp: 0,
  speed: 0,
};

// ---------------------------------------------------------------------------
// 位置・スポット（Req 1, 2）
// ---------------------------------------------------------------------------

/** プレイヤーの地理的位置。精度 50m 超は入場判定で破棄される（Req 1.2） */
export interface Position {
  lat: number;
  lng: number;
  /** 水平精度（メートル）。50m より悪い場合は破棄 */
  accuracyMeters: number;
  /** 取得時刻（epoch ミリ秒） */
  timestamp: number;
}

/** スポット定義（Req 1.8） */
export interface Spot {
  id: string;
  name: string;
  description: string;
  center: { lat: number; lng: number };
  /** 入場半径（メートル）。20〜200 の範囲（Req 1.8） */
  entryRadiusMeters: number;
  regionId: string;
  /** 初回訪問報酬（Req 5.3） */
  firstVisitReward: RewardGrant;
}

// ---------------------------------------------------------------------------
// 地域・アンロック（Req 10）
// ---------------------------------------------------------------------------

/**
 * 地域の解放条件。
 * - allSpotsVisitedInRegion: 指定 Region 内の全スポット訪問
 * - bossDefeated: 指定ボスの撃破
 * - stampCount: 取得スタンプ総数が閾値以上
 */
export type UnlockCondition =
  | { kind: 'allSpotsVisitedInRegion'; regionId: string }
  | { kind: 'bossDefeated'; bossId: string }
  | { kind: 'stampCount'; requiredCount: number };

/** 地域定義（Req 10.1） */
export interface Region {
  id: string;
  name: string;
  /** 先行 Region。アンロック順序の最初の Region のみ null（Req 10.1） */
  predecessorId: string | null;
  unlockCondition: UnlockCondition;
}

// ---------------------------------------------------------------------------
// スタンプ（Req 3）
// ---------------------------------------------------------------------------

/** スタンプ（スポット訪問の記録） */
export interface Stamp {
  spotId: string;
  /** 付与日時（Req 3.2） */
  earnedAt: ISODateTime;
}

// ---------------------------------------------------------------------------
// 報酬（Req 4.5, 5）
// ---------------------------------------------------------------------------

/** 報酬付与（コイン・経験値・アイテム）。コイン/経験値は 0 以上（Req 5.6） */
export interface RewardGrant {
  /** 0 以上（Req 5.6） */
  coins: number;
  /** 0 以上（Req 5.6） */
  experience: number;
  items: string[];
}

// ---------------------------------------------------------------------------
// クエスト（Req 4）
// ---------------------------------------------------------------------------

/** クエスト定義（Req 4.1） */
export interface QuestDefinition {
  id: string;
  /** 地域イベント由来の場合のイベント識別子（後期フェーズ Req 17） */
  eventId?: string;
  /**
   * 達成条件。
   * - spots: 必須スポット集合（1〜100）
   * - count: スタンプ数（1〜100）
   */
  condition:
    | { kind: 'spots'; requiredSpotIds: string[] }
    | { kind: 'count'; requiredCount: number };
  /** 完了報酬（Req 4.5） */
  reward: RewardGrant;
}

/** クエスト進行状態 */
export interface QuestProgress {
  definition: QuestDefinition;
  /** 進行に寄与した相異なる必須スポット（重複カウントしない, Req 4.2, 4.3） */
  satisfiedSpotIds: string[];
  /** 満たした条件数 */
  satisfiedCount: number;
  /** 完了状態（Req 4.4, 4.8） */
  complete: boolean;
  /** 完了報酬を付与済みか（一度だけ付与, Req 4.5） */
  rewardGranted: boolean;
}

/**
 * アクティブクエストの表示情報（Req 4.7）。
 * 現在の満たした条件数・必要条件数・残り未達条件を表す。
 */
export interface QuestDisplay {
  /** 現在の満たした条件数 */
  satisfiedCount: number;
  /** 必要条件数（spots は相異なる必須スポット数、count は要求スタンプ数） */
  requiredCount: number;
  /** 残り未達条件数（requiredCount - satisfiedCount, 0 以上） */
  remainingCount: number;
  /**
   * 残り未達の必須スポット id 一覧。
   * - spots クエスト: まだ満たしていない必須スポット id
   * - count クエスト: 特定スポットに紐付かないため常に空配列
   */
  remainingSpotIds: string[];
  /** 完了状態（Req 4.4, 4.8） */
  complete: boolean;
}

// ---------------------------------------------------------------------------
// ショップ・アイテム（Req 7, 8）
// ---------------------------------------------------------------------------

/** ショップアイテム／装備定義 */
export interface ShopItem {
  id: string;
  name: string;
  /** コイン価格。1〜999,999,999（Req 7.1） */
  priceCoins: number;
  /** 効果説明。最大 280 文字（Req 7.1） */
  effectDescription: string;
  slot: EquipmentSlot;
  /** 装備時に寄与するステータス効果（寄与項目のみ） */
  statEffects: Partial<CharacterStats>;
  /** true は Limited_Item で Shop 一覧から除外（Req 7.5） */
  isLimited: boolean;
}

/**
 * アイテムカタログ。アイテム id からその定義を引くためのルックアップ。
 * ステータス合成（`computeStats`）や購入一覧（`listPurchasable`）の入力となる。
 */
export type ItemCatalog = Record<string, ShopItem>;

// ---------------------------------------------------------------------------
// ボス（Req 9）
// ---------------------------------------------------------------------------

/** ボス定義（Req 9.1） */
export interface Boss {
  id: string;
  /** 紐づく単一の Spot または Region（Req 9.1） */
  bind:
    | { kind: 'spot'; spotId: string }
    | { kind: 'region'; regionId: string };
  /** 報酬。少なくとも 1 つの Limited_Item を含む（Req 9.1, 9.4） */
  reward: RewardGrant & { limitedItemIds: string[] };
}

// ---------------------------------------------------------------------------
// 称号（Req 11.1〜11.5）
// ---------------------------------------------------------------------------

/**
 * 称号の達成条件（Req 11.1）。
 *
 * 各称号はちょうど 1 つの「測定可能な完了状態」を達成条件として持つ。
 * 条件評価を `grantIfEarned(state, title)` の純粋関数として自己完結させるため、
 * 評価に必要な地域メンバーシップ（対象スポット集合・対象ボス集合）を
 * 条件自身に埋め込む。これにより外部の Spot_Manager 等への依存なしに評価できる。
 *
 * - allSpotsVisitedInRegion: 指定 Region に属する全スポット（`spotIds`）を訪問済み
 * - allBossesDefeatedInRegion: 指定 Region に属する全ボス（`bossIds`）を撃破済み
 */
export type TitleCondition =
  | {
      kind: 'allSpotsVisitedInRegion';
      regionId: string;
      /** 当該 Region に属するスポット id 集合（評価対象。空集合は未達扱い） */
      spotIds: string[];
    }
  | {
      kind: 'allBossesDefeatedInRegion';
      regionId: string;
      /** 当該 Region に属するボス id 集合（評価対象。空集合は未達扱い） */
      bossIds: string[];
    };

/** 称号定義（Req 11.1）。ちょうど 1 つの達成条件を持つ。 */
export interface TitleDefinition {
  id: string;
  name: string;
  description: string;
  /** ちょうど 1 つの達成条件（Req 11.1） */
  condition: TitleCondition;
}

// ---------------------------------------------------------------------------
// コレクション（Req 11.6, 11.7, 11.8）
// ---------------------------------------------------------------------------

/**
 * コレクション定義（Req 11.6〜11.8）。
 *
 * コレクションは「ある種類のエントリ id の集合」で表される。
 * 取得数（obtained）は、`entryIds` のうちプレイヤー状態の対応する集合に
 * 存在する相異なる id の数として算出する（`Collection_System` 参照）。
 *
 * - kind 'stamp': `entryIds` を spotId とみなし、`PlayerState.stamps` の
 *   取得済み spotId と突き合わせる。
 * - kind 'boss': `entryIds` を bossId とみなし、`PlayerState.defeatedBossIds`
 *   と突き合わせる。
 * - kind 'item': `entryIds` を itemId とみなし、`PlayerState.ownedItemIds`
 *   と突き合わせる。
 *
 * 総数（total）は `entryIds` の相異なる id の数である。`entryIds` が空の
 * コレクション（総数 0）は決して完了しない（Req 11.8）。
 */
export interface CollectionDefinition {
  id: string;
  name: string;
  /** 集計対象の種類（スタンプ・ボス・アイテム） */
  kind: 'stamp' | 'boss' | 'item';
  /** コレクションを構成するエントリ id（kind に応じて spotId/bossId/itemId） */
  entryIds: string[];
}

// ---------------------------------------------------------------------------
// 地域イベント（後期フェーズ Req 17）
// ---------------------------------------------------------------------------

/** 地域イベント定義。endTime は startTime より後（Req 17.1, 17.5） */
export interface RegionalEvent {
  id: string;
  regionId: string;
  startTime: ISODateTime;
  endTime: ISODateTime;
}

// ---------------------------------------------------------------------------
// プレイヤー永続状態（集約ルート）
// ---------------------------------------------------------------------------

/**
 * プレイヤーの永続状態を表す集約ルート。`User_Data_Store` に保存される。
 * ドメイン関数は本状態を入力に取り、次状態を純粋に計算する。
 */
export interface PlayerState {
  playerId: string;
  /** コイン残高。0 以上 */
  coins: number;
  /** 累積経験値。0 以上（Req 6.6） */
  experience: number;
  /** 取得スタンプ（Req 3） */
  stamps: Stamp[];
  /** 所持アイテム id（Req 7, 8） */
  ownedItemIds: string[];
  /** スロット別の有効装備（未装備は null, Req 8） */
  equipped: Record<EquipmentSlot, string | null>;
  /** 撃破済みボス id（Req 9.5） */
  defeatedBossIds: string[];
  /** 付与済み Limited_Item id（重複排除に使用, Req 9.4） */
  grantedLimitedItemIds: string[];
  /** 付与済み称号 id（Req 11） */
  titleIds: string[];
  /** 解放済み地域 id（Req 10.2, 10.4） */
  unlockedRegionIds: string[];
  /** アクティブクエスト進行（Req 4） */
  quests: QuestProgress[];
  /** 100m 未満の歩行繰り越し距離（Req 5.2） */
  pendingWalkMeters: number;
}

// ---------------------------------------------------------------------------
// ファクトリ関数
// ---------------------------------------------------------------------------

/**
 * 新規プレイヤーの初期 `PlayerState` を生成する。
 *
 * 新規アカウントは以下の初期状態を持つ（Req 6.1, 10.2）。
 * - level 1 相当（経験値 0）
 * - コイン 0、所持/装備/撃破/称号などはすべて空
 * - 解放地域はアンロック順序の最初の 1 つ（`firstRegionId`）のみ
 *
 * @param playerId プレイヤー識別子
 * @param firstRegionId アンロック順序上の最初の Region の id（唯一の初期解放地域）
 * @param quests 初期に保持するアクティブクエスト進行（省略時は空）
 */
export function createInitialPlayerState(
  playerId: string,
  firstRegionId: string,
  quests: QuestProgress[] = []
): PlayerState {
  return {
    playerId,
    coins: 0,
    experience: 0, // level 1 相当（Req 6.1）
    stamps: [],
    ownedItemIds: [],
    equipped: {
      weapon: null,
      armor: null,
      accessory: null,
    },
    defeatedBossIds: [],
    grantedLimitedItemIds: [],
    titleIds: [],
    unlockedRegionIds: [firstRegionId], // 最初の地域のみ解放（Req 10.2）
    quests,
    pendingWalkMeters: 0,
  };
}
