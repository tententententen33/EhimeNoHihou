// Spot_Manager のユニットテスト
//
// getSpot / listSpots / listRegions / getUnlockOrder の基本動作と、
// Entry_Radius の範囲検証（20〜200m, Req 1.8）・アンロック順序の導出（Req 10.1）を
// 具体例・エッジケースで検証する。

import { describe, expect, it } from 'vitest';
import {
  ENTRY_RADIUS_MAX_METERS,
  ENTRY_RADIUS_MIN_METERS,
  createSpotManager,
} from './spotManager';
import type { Region, RewardGrant, Spot } from './types';

const noReward: RewardGrant = { coins: 0, experience: 0, items: [] };

function makeSpot(id: string, regionId: string, entryRadiusMeters: number): Spot {
  return {
    id,
    name: `spot-${id}`,
    description: `説明 ${id}`,
    center: { lat: 33.8, lng: 132.7 },
    entryRadiusMeters,
    regionId,
    firstVisitReward: noReward,
  };
}

function makeRegion(id: string, predecessorId: string | null): Region {
  return {
    id,
    name: `region-${id}`,
    predecessorId,
    unlockCondition: { kind: 'stampCount', requiredCount: 1 },
  };
}

describe('createSpotManager - 正常系', () => {
  const regions = [makeRegion('r1', null), makeRegion('r2', 'r1'), makeRegion('r3', 'r2')];
  const spots = [makeSpot('s1', 'r1', 50), makeSpot('s2', 'r2', 200), makeSpot('s3', 'r3', 20)];

  it('有効な定義から Spot_Manager を構築できる', () => {
    const result = createSpotManager(spots, regions);
    expect(result.ok).toBe(true);
  });

  it('getSpot は id に対応する Spot を返し、未知の id には undefined を返す', () => {
    const result = createSpotManager(spots, regions);
    if (!result.ok) throw new Error('構築に失敗');
    expect(result.value.getSpot('s2')?.name).toBe('spot-s2');
    expect(result.value.getSpot('unknown')).toBeUndefined();
  });

  it('listSpots / listRegions は全件を返す', () => {
    const result = createSpotManager(spots, regions);
    if (!result.ok) throw new Error('構築に失敗');
    expect(result.value.listSpots().map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(result.value.listRegions().map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
  });

  it('getUnlockOrder は predecessor 連鎖に沿った全順序を返す', () => {
    const result = createSpotManager(spots, regions);
    if (!result.ok) throw new Error('構築に失敗');
    expect(result.value.getUnlockOrder()).toEqual(['r1', 'r2', 'r3']);
  });

  it('定義順が連鎖順と異なっても正しい全順序を導出する', () => {
    const shuffled = [makeRegion('r3', 'r2'), makeRegion('r1', null), makeRegion('r2', 'r1')];
    const result = createSpotManager([], shuffled);
    if (!result.ok) throw new Error('構築に失敗');
    expect(result.value.getUnlockOrder()).toEqual(['r1', 'r2', 'r3']);
  });

  it('返り値は内部状態の変更を引き起こさない（防御的コピー）', () => {
    const result = createSpotManager(spots, regions);
    if (!result.ok) throw new Error('構築に失敗');
    const list = result.value.listSpots();
    list.pop();
    expect(result.value.listSpots()).toHaveLength(3);
  });
});

describe('Entry_Radius の範囲検証（Req 1.8）', () => {
  const regions = [makeRegion('r1', null)];

  it('境界値（20m, 200m）は許容される', () => {
    const minOk = createSpotManager([makeSpot('s1', 'r1', ENTRY_RADIUS_MIN_METERS)], regions);
    const maxOk = createSpotManager([makeSpot('s1', 'r1', ENTRY_RADIUS_MAX_METERS)], regions);
    expect(minOk.ok).toBe(true);
    expect(maxOk.ok).toBe(true);
  });

  it('20m 未満は拒否される', () => {
    const result = createSpotManager([makeSpot('s1', 'r1', 19)], regions);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'invalidEntryRadius', spotId: 's1', entryRadiusMeters: 19 });
  });

  it('200m 超は拒否される', () => {
    const result = createSpotManager([makeSpot('s1', 'r1', 201)], regions);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('invalidEntryRadius');
  });

  it('非有限値（NaN）は拒否される', () => {
    const result = createSpotManager([makeSpot('s1', 'r1', Number.NaN)], regions);
    expect(result.ok).toBe(false);
  });
});

describe('構造検証', () => {
  it('Spot id の重複を拒否する', () => {
    const regions = [makeRegion('r1', null)];
    const result = createSpotManager([makeSpot('s1', 'r1', 50), makeSpot('s1', 'r1', 60)], regions);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('duplicateSpotId');
  });

  it('Region id の重複を拒否する', () => {
    const result = createSpotManager([], [makeRegion('r1', null), makeRegion('r1', null)]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('duplicateRegionId');
  });

  it('未定義 Region を参照する Spot を拒否する', () => {
    const result = createSpotManager([makeSpot('s1', 'rX', 50)], [makeRegion('r1', null)]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unknownRegionReference');
  });
});

describe('アンロック順序の検証（Req 10.1）', () => {
  it('先頭 Region が存在しない（全て predecessor を持つ）場合は拒否する', () => {
    const result = createSpotManager([], [makeRegion('r1', 'r2'), makeRegion('r2', 'r1')]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('invalidUnlockOrder');
  });

  it('先頭 Region が複数存在する場合は拒否する', () => {
    const result = createSpotManager([], [makeRegion('r1', null), makeRegion('r2', null)]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('invalidUnlockOrder');
  });

  it('分岐（同一 predecessor を持つ複数 Region）を拒否する', () => {
    const result = createSpotManager(
      [],
      [makeRegion('r1', null), makeRegion('r2', 'r1'), makeRegion('r3', 'r1')]
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('invalidUnlockOrder');
  });

  it('空の Region 集合では空のアンロック順序を返す', () => {
    const result = createSpotManager([], []);
    if (!result.ok) throw new Error('構築に失敗');
    expect(result.value.getUnlockOrder()).toEqual([]);
  });
});
