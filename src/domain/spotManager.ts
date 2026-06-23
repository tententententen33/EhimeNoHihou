// Spot_Manager（スポット定義・地域・アンロック順序の管理）
//
// 本モジュールは設計書「Components and Interfaces / Spot_Manager」に従い、
// スポット定義・地域定義・地域のアンロック順序を保持する純粋な管理層を提供する。
//
// MVP スコープのため、後期フェーズ（Req 17）の地域イベント定義
// （defineRegionalEvent）は本タスクでは実装しない。
//
// スポット定義の検証として、各 Spot の Entry_Radius が 20m〜200m の範囲内である
// ことを保証し、範囲外の定義は Result の失敗値として拒否する（Req 1.8）。
// アンロック順序は Region の predecessor 連鎖から全順序（単一の鎖）として導出する
// （Req 10.1）。

import type { Region, Spot } from './types';
import type { Result } from './types';

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/** Entry_Radius の最小値（メートル, Req 1.8） */
export const ENTRY_RADIUS_MIN_METERS = 20;

/** Entry_Radius の最大値（メートル, Req 1.8） */
export const ENTRY_RADIUS_MAX_METERS = 200;

// ---------------------------------------------------------------------------
// インターフェース
// ---------------------------------------------------------------------------

/**
 * Spot_Manager。スポット・地域・アンロック順序を保持する。
 * 構築時に定義を検証するため、本インターフェースのメソッドは検証済みの
 * 整合したデータのみを返す。
 */
export interface SpotManager {
  /** id から Spot を引く。存在しなければ undefined */
  getSpot(spotId: string): Spot | undefined;
  /** 全 Spot の一覧（定義順） */
  listSpots(): Spot[];
  /** 全 Region の一覧（定義順） */
  listRegions(): Region[];
  /** Region id の全順序（アンロック順序, Req 10.1） */
  getUnlockOrder(): string[];
}

// ---------------------------------------------------------------------------
// エラー型
// ---------------------------------------------------------------------------

/**
 * Spot_Manager 構築時の検証エラー。
 * - invalidEntryRadius: Entry_Radius が 20〜200m の範囲外（Req 1.8）
 * - duplicateSpotId: 同一 Spot id の重複
 * - duplicateRegionId: 同一 Region id の重複
 * - unknownRegionReference: Spot が参照する Region が未定義
 * - invalidUnlockOrder: 地域の predecessor 連鎖が全順序を成さない（Req 10.1）
 */
export type SpotManagerError =
  | { kind: 'invalidEntryRadius'; spotId: string; entryRadiusMeters: number }
  | { kind: 'duplicateSpotId'; spotId: string }
  | { kind: 'duplicateRegionId'; regionId: string }
  | { kind: 'unknownRegionReference'; spotId: string; regionId: string }
  | { kind: 'invalidUnlockOrder'; reason: string };

// ---------------------------------------------------------------------------
// ファクトリ
// ---------------------------------------------------------------------------

/**
 * スポット・地域定義を検証して Spot_Manager を構築する。
 *
 * 検証内容:
 * - 各 Spot の Entry_Radius が 20m〜200m の範囲内であること（Req 1.8）。
 * - Spot id / Region id に重複がないこと。
 * - 各 Spot の regionId が定義済み Region を参照していること。
 * - Region の predecessor 連鎖が全順序（単一の鎖・循環なし）を成すこと（Req 10.1）。
 *
 * いずれかの検証に失敗した場合は `Result` の失敗値を返し、Spot_Manager を構築しない。
 *
 * @param spots スポット定義の配列
 * @param regions 地域定義の配列
 */
export function createSpotManager(
  spots: Spot[],
  regions: Region[]
): Result<SpotManager, SpotManagerError> {
  // --- 地域 id の重複検査 ---
  const regionById = new Map<string, Region>();
  for (const region of regions) {
    if (regionById.has(region.id)) {
      return { ok: false, error: { kind: 'duplicateRegionId', regionId: region.id } };
    }
    regionById.set(region.id, region);
  }

  // --- スポット id の重複・半径・地域参照の検査 ---
  const spotById = new Map<string, Spot>();
  for (const spot of spots) {
    if (spotById.has(spot.id)) {
      return { ok: false, error: { kind: 'duplicateSpotId', spotId: spot.id } };
    }

    // Entry_Radius の範囲検証（Req 1.8）。20m 未満または 200m 超は拒否する。
    if (
      !Number.isFinite(spot.entryRadiusMeters) ||
      spot.entryRadiusMeters < ENTRY_RADIUS_MIN_METERS ||
      spot.entryRadiusMeters > ENTRY_RADIUS_MAX_METERS
    ) {
      return {
        ok: false,
        error: {
          kind: 'invalidEntryRadius',
          spotId: spot.id,
          entryRadiusMeters: spot.entryRadiusMeters,
        },
      };
    }

    // Spot が参照する Region が定義済みであることを保証する。
    if (!regionById.has(spot.regionId)) {
      return {
        ok: false,
        error: { kind: 'unknownRegionReference', spotId: spot.id, regionId: spot.regionId },
      };
    }

    spotById.set(spot.id, spot);
  }

  // --- アンロック順序の導出（Req 10.1） ---
  const unlockOrderResult = deriveUnlockOrder(regions, regionById);
  if (!unlockOrderResult.ok) {
    return unlockOrderResult;
  }
  const unlockOrder = unlockOrderResult.value;

  // 検証済みの不変データを内部に保持する。返却用のコピーを返し、外部からの変更を防ぐ。
  const spotsSnapshot = [...spots];
  const regionsSnapshot = [...regions];

  const manager: SpotManager = {
    getSpot(spotId: string): Spot | undefined {
      return spotById.get(spotId);
    },
    listSpots(): Spot[] {
      return [...spotsSnapshot];
    },
    listRegions(): Region[] {
      return [...regionsSnapshot];
    },
    getUnlockOrder(): string[] {
      return [...unlockOrder];
    },
  };

  return { ok: true, value: manager };
}

// ---------------------------------------------------------------------------
// 内部ヘルパ
// ---------------------------------------------------------------------------

/**
 * Region の predecessor 連鎖からアンロック順序（Region id の全順序）を導出する（Req 10.1）。
 *
 * 全順序の条件:
 * - predecessorId が null の Region（先頭）がちょうど 1 つ存在する。
 * - 先頭以外の各 Region は定義済みの直前 Region をちょうど 1 つ持つ。
 * - 各 Region は高々 1 つの後続 Region を持つ（分岐しない単一の鎖）。
 * - 循環を含まない。
 * - すべての Region が連鎖に含まれる。
 */
function deriveUnlockOrder(
  regions: Region[],
  regionById: Map<string, Region>
): Result<string[], SpotManagerError> {
  if (regions.length === 0) {
    return { ok: true, value: [] };
  }

  // 先頭（predecessorId === null）の特定。ちょうど 1 つでなければ全順序を成さない。
  const roots = regions.filter((r) => r.predecessorId === null);
  const root = roots[0];
  if (roots.length !== 1 || root === undefined) {
    return {
      ok: false,
      error: {
        kind: 'invalidUnlockOrder',
        reason: `先頭 Region（predecessorId が null）はちょうど 1 つである必要があります（検出数: ${roots.length}）`,
      },
    };
  }

  // 各 Region の直前 Region から後続 Region への対応を構築する。
  // 分岐（同一 predecessor を持つ複数 Region）や未定義参照を検出する。
  const successorByPredecessor = new Map<string, string>();
  for (const region of regions) {
    if (region.predecessorId === null) {
      continue;
    }
    if (!regionById.has(region.predecessorId)) {
      return {
        ok: false,
        error: {
          kind: 'invalidUnlockOrder',
          reason: `Region '${region.id}' の直前 Region '${region.predecessorId}' が未定義です`,
        },
      };
    }
    if (successorByPredecessor.has(region.predecessorId)) {
      return {
        ok: false,
        error: {
          kind: 'invalidUnlockOrder',
          reason: `Region '${region.predecessorId}' が複数の後続 Region を持つため全順序を成しません`,
        },
      };
    }
    successorByPredecessor.set(region.predecessorId, region.id);
  }

  // 先頭から後続を辿り、全順序を構築する。
  const order: string[] = [];
  const visited = new Set<string>();
  let currentId: string | undefined = root.id;
  while (currentId !== undefined) {
    if (visited.has(currentId)) {
      return {
        ok: false,
        error: { kind: 'invalidUnlockOrder', reason: `アンロック順序に循環が含まれています（${currentId}）` },
      };
    }
    visited.add(currentId);
    order.push(currentId);
    currentId = successorByPredecessor.get(currentId);
  }

  // すべての Region が単一の鎖に含まれていることを確認する（孤立・分断の検出）。
  if (order.length !== regions.length) {
    return {
      ok: false,
      error: {
        kind: 'invalidUnlockOrder',
        reason: `すべての Region が単一の鎖に含まれていません（鎖の長さ: ${order.length}, Region 総数: ${regions.length}）`,
      },
    };
  }

  return { ok: true, value: order };
}
