// Map_System: マーカー生成と情報秘匿（Req 2.2, 2.3, 2.4, 2.5）
//
// 本モジュールは設計書「Components and Interfaces / Map_System」に従い、
// 地図上のマーカー生成と、スポット選択時の詳細ペイロード生成（情報秘匿を含む）を
// 担う純粋ドメインロジックである。すべての関数は副作用・I/O を持たず、
// 入力 `PlayerState` を破壊的に変更しない。
//
// MVP では「解放済み Region 内のスポットは解放済み（可視・アンロック）」として扱う。
// あるスポットがアンロック済みかどうかは、その `regionId` がプレイヤーの
// `unlockedRegionIds` に含まれるかで判定する。
//
// 地域アンロックロジック（canUnlockNext / unlockRegion, Req 10.3, 10.7）は
// 本ファイル末尾の「地域アンロックロジック」セクションに実装している（Task 12.2）。

import type { PlayerState, Region, Spot, UnlockCondition } from './types';

// ---------------------------------------------------------------------------
// マーカー型（Req 2.2, 2.3）
// ---------------------------------------------------------------------------

/** マーカーが指す地理座標（地図描画用） */
export interface MarkerPosition {
  lat: number;
  lng: number;
}

/**
 * 解放済みスポットのマーカー。
 * 地図描画に必要な id と座標のみを持ち、名前・説明・報酬といった詳細は含めない
 * （詳細は選択時に `getSpotDetail` で取得する）。
 */
export interface UnlockedMarker {
  spotId: string;
  position: MarkerPosition;
  locked: false;
}

/**
 * ロック状態スポットのマーカー（Req 2.3）。
 * 名前・説明・報酬の詳細をいずれも含まず、ロック表示に必要な最小情報
 * （id と座標）のみを持つ。型構造上、秘匿対象の項目を一切保持しない。
 */
export interface LockedMarker {
  spotId: string;
  position: MarkerPosition;
  locked: true;
}

/** 地図マーカー。解放済み（locked: false）／ロック（locked: true）の判別共用体。 */
export type MapMarker = UnlockedMarker | LockedMarker;

// ---------------------------------------------------------------------------
// スポット選択時の詳細ペイロード（Req 2.4, 2.5）
// ---------------------------------------------------------------------------

/** 訪問状態。プレイヤーのスタンプ有無と一致する（Req 2.4）。 */
export type VisitStatus = 'visited' | 'not visited';

/**
 * 解放済みスポットの選択時詳細（Req 2.4）。
 * 名前・説明・訪問状態を含む。
 */
export interface UnlockedSpotDetail {
  spotId: string;
  locked: false;
  name: string;
  description: string;
  /** スタンプ有無に基づく訪問状態（Req 2.4） */
  visitStatus: VisitStatus;
}

/**
 * ロック状態スポットの選択時詳細（Req 2.5）。
 * 名前・説明・報酬の詳細をいずれも含まず、ロックされている旨のみを示す。
 * 型構造上、秘匿対象の項目を一切保持しない。
 */
export interface LockedSpotDetail {
  spotId: string;
  locked: true;
}

/** スポット選択時の詳細ペイロード。解放済み／ロックの判別共用体。 */
export type SpotDetail = UnlockedSpotDetail | LockedSpotDetail;

// ---------------------------------------------------------------------------
// 内部ヘルパ
// ---------------------------------------------------------------------------

/**
 * スポットがアンロック済みか判定する。
 *
 * MVP では「解放済み Region 内のスポットは解放済み」として扱うため、
 * スポットの `regionId` がプレイヤーの `unlockedRegionIds` に含まれるかで判定する。
 *
 * @param state プレイヤー状態
 * @param spot 対象スポット
 * @returns 当該スポットがアンロック済みなら true
 */
export function isSpotUnlocked(state: PlayerState, spot: Spot): boolean {
  return state.unlockedRegionIds.includes(spot.regionId);
}

/**
 * プレイヤーが当該スポットのスタンプを保持しているか判定する。
 *
 * @param state プレイヤー状態
 * @param spotId 対象スポットの識別子
 * @returns スタンプを保持していれば true
 */
function hasStamp(state: PlayerState, spotId: string): boolean {
  return state.stamps.some((s) => s.spotId === spotId);
}

// ---------------------------------------------------------------------------
// マーカー生成（Req 2.2, 2.3）
// ---------------------------------------------------------------------------

/**
 * 解放済み Region 内かつ解放済みのスポットのマーカー集合を返す（Req 2.2）。
 *
 * MVP では「解放済み Region 内のスポットは解放済み（可視・アンロック）」として扱うため、
 * `regionId` がプレイヤーの `unlockedRegionIds` に含まれるスポットのみを対象とし、
 * それらを解放済みマーカー（locked: false）として返す。ロック Region のスポットは
 * 可視マーカー集合に含めない。
 *
 * 返すマーカーは id と座標のみを持ち、名前・説明・報酬といった詳細は含めない
 * （詳細は選択時に `getSpotDetail` で取得する）。
 *
 * @param state プレイヤー状態
 * @param spots 全スポット集合
 * @returns 解放済みスポットに対応するマーカー集合
 */
export function getVisibleMarkers(state: PlayerState, spots: Spot[]): MapMarker[] {
  const markers: MapMarker[] = [];
  for (const spot of spots) {
    if (!isSpotUnlocked(state, spot)) {
      // ロック Region のスポットは可視マーカー集合に含めない（Req 2.2）。
      continue;
    }
    markers.push({
      spotId: spot.id,
      position: { lat: spot.center.lat, lng: spot.center.lng },
      locked: false,
    });
  }
  return markers;
}

// ---------------------------------------------------------------------------
// スポット選択時の詳細生成と情報秘匿（Req 2.4, 2.5）
// ---------------------------------------------------------------------------

/**
 * スポット選択時の詳細ペイロードを生成する（Req 2.4, 2.5）。
 *
 * - 解放済みスポット: 名前・説明・訪問状態（"visited" / "not visited"）を返す。
 *   訪問状態はプレイヤーのスタンプ有無と一致する（Req 2.4）。
 * - ロックスポット: 名前・説明・報酬の詳細をいずれも含めず、ロックされている旨のみを返す
 *   （Req 2.5）。返却型の構造上、秘匿対象の項目を一切保持しない。
 *
 * アンロック判定は `isSpotUnlocked`（Region 解放状態）に基づく。
 *
 * @param state プレイヤー状態
 * @param spot 選択されたスポット
 * @returns 解放済み／ロックに応じた詳細ペイロード
 */
export function getSpotDetail(state: PlayerState, spot: Spot): SpotDetail {
  if (!isSpotUnlocked(state, spot)) {
    // ロックスポット: 名前・説明・報酬を秘匿する（Req 2.5）。
    return { spotId: spot.id, locked: true };
  }

  // 解放済みスポット: 名前・説明・訪問状態を返す（Req 2.4）。
  return {
    spotId: spot.id,
    locked: false,
    name: spot.name,
    description: spot.description,
    visitStatus: hasStamp(state, spot.id) ? 'visited' : 'not visited',
  };
}

/**
 * `getSpotDetail` の別名。マーカー選択（select）時の詳細取得として利用する。
 * @see getSpotDetail
 */
export const selectSpot = getSpotDetail;

// ===========================================================================
// 地域アンロックロジック（Req 10.3, 10.7）
// ===========================================================================
//
// 本セクションは設計書「Components and Interfaces / Map_System」の
// canUnlockNext / unlockRegion に対応する純粋ドメインロジックである。
// すべての関数は副作用・I/O を持たず、入力 `PlayerState` を破壊的に変更しない。
//
// アンロックは「アンロック順序（全順序の単一の鎖, Req 10.1）上で、
// まだ解放していない最初の Region（＝次のロック Region）」を対象に進める。
// その Region の解放条件（`UnlockCondition`）を満たすときのみ解放可能とし、
// 条件未達の Region はロック状態のまま維持し、侵入不可とする（Req 10.7）。
//
// 永続化との関係:
//   `unlockRegion` は「永続化が成功した後に確定する」前提の状態反映関数である。
//   実際の解放確定（および失敗時のロールバック・再試行）は状態管理層が担う。
//   本関数はあくまで「解放後の次状態」を純粋に計算するのみである（Req 10.3, 10.4）。

/**
 * 地域アンロック条件の評価に必要な外部コンテキスト。
 *
 * `UnlockCondition` のうち `allSpotsVisitedInRegion` の評価には、対象 Region に
 * 属するスポット id 集合が必要となる。純粋関数として自己完結させるため、
 * 評価に必要な情報をコンテキストとして受け取る（Spot_Manager 等への直接依存を避ける）。
 */
export interface RegionUnlockContext {
  /**
   * Region id ごとの所属スポット id 集合。
   * `allSpotsVisitedInRegion` 条件の評価に使用する。
   * 未登録の Region は所属スポットなし（空集合）として扱う。
   */
  spotIdsByRegion: Record<string, readonly string[]>;
}

/**
 * プレイヤーが保持する相異なるスタンプ（spotId）数を数える。
 * 同一スポットの重複スタンプは想定しないが、堅牢性のため集合で相異数を算出する。
 */
function distinctVisitedSpotIds(state: PlayerState): Set<string> {
  return new Set(state.stamps.map((s) => s.spotId));
}

/**
 * 単一の `UnlockCondition` がプレイヤー状態に対して充足されているかを評価する（Req 10.3）。
 *
 * 条件種別ごとの判定:
 * - allSpotsVisitedInRegion: 対象 Region に属する全スポットを訪問済みなら充足。
 *   対象スポット集合が空（未登録・空配列）の場合は「訪問対象が存在しない」ため
 *   未達扱い（false）とする。
 * - bossDefeated: 指定ボスを撃破済み（`defeatedBossIds` に含む）なら充足。
 * - stampCount: 相異なる取得スタンプ数が要求数以上なら充足。
 *
 * 本関数は純粋で、`state` を変更しない。
 *
 * @param state プレイヤー状態
 * @param condition 評価対象の解放条件
 * @param context 条件評価に必要な外部コンテキスト（spots-per-region 等）
 * @returns 条件を満たすなら true
 */
export function isUnlockConditionSatisfied(
  state: PlayerState,
  condition: UnlockCondition,
  context: RegionUnlockContext
): boolean {
  switch (condition.kind) {
    case 'allSpotsVisitedInRegion': {
      const spotIds = context.spotIdsByRegion[condition.regionId] ?? [];
      // 訪問対象が存在しない Region は未達扱い（解放条件を満たさない）。
      if (spotIds.length === 0) {
        return false;
      }
      const visited = distinctVisitedSpotIds(state);
      return spotIds.every((spotId) => visited.has(spotId));
    }
    case 'bossDefeated':
      return state.defeatedBossIds.includes(condition.bossId);
    case 'stampCount':
      return distinctVisitedSpotIds(state).size >= condition.requiredCount;
  }
}

/**
 * アンロック順序上の「次のロック Region」の解放条件が充足されているかを判定する（Req 10.3）。
 *
 * 判定手順:
 * 1. `unlockOrder`（全順序, Req 10.1）を先頭から走査し、`unlockedRegionIds` に
 *    含まれない最初の Region（＝次に解放すべきロック Region）を特定する。
 *    すべて解放済みなら解放対象なし（regionId: null）。
 * 2. 当該 Region の定義（`regions` から検索）の `unlockCondition` を評価する。
 *    条件を満たすなら、その Region id を返す。満たさなければ regionId: null。
 *
 * アンロックは順序上「次のロック Region」ちょうど 1 つを対象とするため、順序を飛ばして
 * 後続の Region を解放することはない。条件未達なら解放可能 Region は無い（null）。
 *
 * 本関数は純粋で、`state` を変更しない。判定のみを行い、状態は変えない。
 *
 * @param state プレイヤー状態
 * @param regions 全 Region 定義（解放条件の参照に使用）
 * @param unlockOrder Region id の全順序（Spot_Manager の `getUnlockOrder`）
 * @param context 条件評価に必要な外部コンテキスト
 * @returns 解放可能なら `{ regionId }`、無ければ `{ regionId: null }`
 */
export function canUnlockNext(
  state: PlayerState,
  regions: Region[],
  unlockOrder: string[],
  context: RegionUnlockContext
): { regionId: string | null } {
  // アンロック順序上で最初の未解放 Region（次のロック Region）を特定する。
  const nextLockedId = unlockOrder.find(
    (regionId) => !state.unlockedRegionIds.includes(regionId)
  );
  if (nextLockedId === undefined) {
    // すべて解放済み。解放対象は存在しない。
    return { regionId: null };
  }

  const region = regions.find((r) => r.id === nextLockedId);
  if (region === undefined) {
    // 定義が見つからない場合は解放不可とする（防御的）。
    return { regionId: null };
  }

  // 解放条件を満たすときのみ、その Region を解放可能とする。
  if (isUnlockConditionSatisfied(state, region.unlockCondition, context)) {
    return { regionId: nextLockedId };
  }

  // 条件未達 Region はロック維持・侵入不可（Req 10.7）。
  return { regionId: null };
}

/**
 * 指定 Region を解放した次状態を返す（Req 10.3, 10.4）。
 *
 * 本関数は「永続化が成功した後に解放を確定する」前提の状態反映であり、
 * `unlockedRegionIds` に当該 Region id をちょうど 1 つ追加する。既に解放済みの場合は
 * 冪等に元の状態をそのまま返す（重複追加しない）。
 *
 * 呼び出し側（状態管理層）は、`canUnlockNext` が返した解放可能な Region id に対して
 * 本関数を適用することで、アンロック順序上の次の Region をちょうど 1 つ解放する。
 * 解放条件未達の Region に対しては `canUnlockNext` が id を返さないため、本関数を通じて
 * 解放されることはなく、当該 Region はロック状態のまま侵入不可に保たれる（Req 10.7）。
 *
 * 本関数は純粋で、入力 `state` を破壊的に変更しない（新しい状態オブジェクトを返す）。
 *
 * @param state プレイヤー状態
 * @param regionId 解放する Region の id
 * @returns 当該 Region を解放した次状態（既に解放済みなら不変）
 */
export function unlockRegion(state: PlayerState, regionId: string): PlayerState {
  // 冪等性: 既に解放済みなら状態を変更しない。
  if (state.unlockedRegionIds.includes(regionId)) {
    return state;
  }
  return {
    ...state,
    unlockedRegionIds: [...state.unlockedRegionIds, regionId],
  };
}
