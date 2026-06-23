// Location_Service のユニットテスト
//
// 本ファイルは tasks.md タスク 16.2 に対応する。
// LocationService.getCurrentPosition / resolvePresence の挙動を、
// 注入した擬似 GeolocationLike（成功・失敗・無応答）を用いて具体例・
// エッジケースで検証する（プロパティベーステストは不要）。
//
// 検証対象の要求:
// - Req 1.1 / 1.2: 精度 50m 以内は 'ok'、50m 超は破棄して 'timeout'
// - Req 1.6: 権限拒否（code 1）は 'denied' と LOCATION_DENIED_MESSAGE
// - Req 1.7: 制限時間内に精度 50m 以内を取得できなければ 'timeout'（再試行用）。
//            このとき本サービスは入場状態（presence）を返さない＝呼び出し側が
//            既存のスポット入場状態を据え置ける。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOCATION_DENIED_MESSAGE,
  LOCATION_TIMEOUT_MESSAGE,
  LocationService,
  POSITION_TIMEOUT_MS,
  type GeolocationLike,
} from './locationService';
import type { Spot } from '../domain/types';

// ---------------------------------------------------------------------------
// テスト用ヘルパ
// ---------------------------------------------------------------------------

/** 指定 coords を返す擬似 GeolocationPosition を生成する */
function makeGeoPosition(
  latitude: number,
  longitude: number,
  accuracy: number,
  timestamp = 1_000
): GeolocationPosition {
  return {
    coords: {
      latitude,
      longitude,
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      // 一部の型定義では toJSON が要求されるため付与する
      toJSON() {
        return this;
      },
    },
    timestamp,
    toJSON() {
      return this;
    },
  } as unknown as GeolocationPosition;
}

/** 指定 code を持つ擬似 GeolocationPositionError を生成する */
function makeGeoError(code: number): GeolocationPositionError {
  return {
    code,
    message: `error-${code}`,
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  } as unknown as GeolocationPositionError;
}

/** success コールバックを即時に呼ぶ擬似 Geolocation */
function successGeolocation(position: GeolocationPosition): GeolocationLike {
  return {
    getCurrentPosition(success) {
      success(position);
    },
  };
}

/** error コールバックを即時に呼ぶ擬似 Geolocation */
function errorGeolocation(err: GeolocationPositionError): GeolocationLike {
  return {
    getCurrentPosition(_success, error) {
      error(err);
    },
  };
}

/** どのコールバックも呼ばない擬似 Geolocation（無応答 = タイムアウト検証用） */
function neverGeolocation(): GeolocationLike {
  return {
    getCurrentPosition() {
      // 何もしない（応答しない）
    },
  };
}

/** 愛媛・松山城周辺を基準にしたサンプルスポット */
function makeSpot(id: string, lat: number, lng: number, entryRadiusMeters = 50): Spot {
  return {
    id,
    name: `spot-${id}`,
    description: `説明 ${id}`,
    center: { lat, lng },
    entryRadiusMeters,
    regionId: 'r1',
    firstVisitReward: { coins: 0, experience: 0, items: [] },
  };
}

// ---------------------------------------------------------------------------
// getCurrentPosition: 精度フィルタリング（Req 1.1 / 1.2）
// ---------------------------------------------------------------------------

describe('getCurrentPosition - 精度フィルタリング（Req 1.1 / 1.2）', () => {
  it('精度 50m 以内の位置は kind=ok で Position にマッピングして返す', async () => {
    const geo = successGeolocation(makeGeoPosition(33.8456, 132.7656, 30, 1_234));
    const service = new LocationService(geo);

    const result = await service.getCurrentPosition();

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.position).toEqual({
      lat: 33.8456,
      lng: 132.7656,
      accuracyMeters: 30,
      timestamp: 1_234,
    });
  });

  it('精度ちょうど 50m（境界値）は許容され kind=ok を返す', async () => {
    const geo = successGeolocation(makeGeoPosition(33.84, 132.76, 50));
    const service = new LocationService(geo);

    const result = await service.getCurrentPosition();

    expect(result.kind).toBe('ok');
  });

  it('精度 50m 超の位置は破棄して kind=timeout を返す（再試行を促す）', async () => {
    const geo = successGeolocation(makeGeoPosition(33.84, 132.76, 50.1));
    const service = new LocationService(geo);

    const result = await service.getCurrentPosition();

    expect(result.kind).toBe('timeout');
    if (result.kind !== 'timeout') return;
    expect(result.message).toBe(LOCATION_TIMEOUT_MESSAGE);
  });
});

// ---------------------------------------------------------------------------
// getCurrentPosition: 権限拒否（Req 1.6）
// ---------------------------------------------------------------------------

describe('getCurrentPosition - 権限拒否（Req 1.6）', () => {
  it('権限拒否（code 1）は kind=denied と LOCATION_DENIED_MESSAGE を返す', async () => {
    const geo = errorGeolocation(makeGeoError(1));
    const service = new LocationService(geo);

    const result = await service.getCurrentPosition();

    expect(result.kind).toBe('denied');
    if (result.kind !== 'denied') return;
    expect(result.message).toBe(LOCATION_DENIED_MESSAGE);
  });
});

// ---------------------------------------------------------------------------
// getCurrentPosition: タイムアウト（Req 1.7）
// ---------------------------------------------------------------------------

describe('getCurrentPosition - タイムアウト（Req 1.7）', () => {
  it('Geolocation の TIMEOUT エラー（code 3）は kind=timeout を返す', async () => {
    const geo = errorGeolocation(makeGeoError(3));
    const service = new LocationService(geo);

    const result = await service.getCurrentPosition();

    expect(result.kind).toBe('timeout');
    if (result.kind !== 'timeout') return;
    expect(result.message).toBe(LOCATION_TIMEOUT_MESSAGE);
  });

  it('応答が無いまま制限時間を超えると kind=timeout を返す（疑似タイマー）', async () => {
    vi.useFakeTimers();
    try {
      const service = new LocationService(neverGeolocation(), POSITION_TIMEOUT_MS);

      const promise = service.getCurrentPosition();
      // 制限時間を超えるまで時間を進める
      await vi.advanceTimersByTimeAsync(POSITION_TIMEOUT_MS);

      const result = await promise;
      expect(result.kind).toBe('timeout');
      if (result.kind !== 'timeout') return;
      expect(result.message).toBe(LOCATION_TIMEOUT_MESSAGE);
    } finally {
      vi.useRealTimers();
    }
  });

  it('タイムアウト時は入場状態（presence）を一切返さない＝呼び出し側が既存状態を保持できる', async () => {
    // timeout 結果は 'ok' ではないため position を持たず、resolvePresence の
    // 入力を生成しない。呼び出し側は現在の入場状態を据え置けばよい（Req 1.7）。
    const geo = errorGeolocation(makeGeoError(3));
    const service = new LocationService(geo);

    const result = await service.getCurrentPosition();

    expect(result.kind).toBe('timeout');
    // 'ok' 以外の結果に position フィールドが存在しないことを確認する
    expect('position' in result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getCurrentPosition: その他のエラー / Geolocation 未提供
// ---------------------------------------------------------------------------

describe('getCurrentPosition - その他の失敗', () => {
  it('位置利用不可（code 2）は kind=error を返す', async () => {
    const geo = errorGeolocation(makeGeoError(2));
    const service = new LocationService(geo);

    const result = await service.getCurrentPosition();

    expect(result.kind).toBe('error');
  });

  it('Geolocation 実装が無い場合は kind=error を返す', async () => {
    const service = new LocationService(undefined);

    const result = await service.getCurrentPosition();

    expect(result.kind).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// resolvePresence: ドメイン resolveSpotPresence への委譲
// ---------------------------------------------------------------------------

describe('resolvePresence - ドメイン委譲（Req 1.3）', () => {
  let service: LocationService;

  beforeEach(() => {
    service = new LocationService(neverGeolocation());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('入場半径内に 1 つのスポットがある場合、その spotId を返す', () => {
    const center = { lat: 33.8456, lng: 132.7656 };
    const spot = makeSpot('castle', center.lat, center.lng, 50);

    // スポット中心とほぼ同一の位置（半径内）
    const presence = service.resolvePresence(
      { lat: center.lat, lng: center.lng, accuracyMeters: 10, timestamp: 1_000 },
      [spot]
    );

    expect(presence.spotId).toBe('castle');
  });

  it('どのスポットの入場半径にも入らない場合は spotId=null を返す', () => {
    const spot = makeSpot('castle', 33.8456, 132.7656, 50);

    // 中心から十分離れた位置（約 0.01 度 ≒ 1km 以上）
    const presence = service.resolvePresence(
      { lat: 33.86, lng: 132.78, accuracyMeters: 10, timestamp: 1_000 },
      [spot]
    );

    expect(presence.spotId).toBeNull();
  });
});
