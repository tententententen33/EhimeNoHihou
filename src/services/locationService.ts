// Location_Service（Geolocation ラッパ）
//
// 本ファイルは設計書「Components and Interfaces / Location_Service」および
// 「Error Handling / 外部サービスエラー（Geolocation）」に対応する。
// ブラウザの `navigator.geolocation` をラップし、精度フィルタリングと
// スポット入場判定の入力（ドメイン Position）を提供する。
//
// 検証対象の要求:
// - Req 1.1: 位置許可時に現在の緯度経度を水平精度 50m 以内で取得する
// - Req 1.6: 位置許可が拒否された場合、スタンプ獲得に位置が必要である旨の
//            メッセージ用エラーを返す
// - Req 1.7: 30 秒以内に精度 50m 以内の位置を取得できない場合は再試行用の
//            状態を返し、既存のスポット入場状態を保持する
//
// 入場判定そのものは純粋関数 `resolveSpotPresence`（src/domain/location.ts）に
// 委譲する。本サービスは副作用（Geolocation 取得）のみを担う。

import {
  ACCURACY_THRESHOLD_METERS,
  resolveSpotPresence,
  type SpotPresenceResult,
} from '../domain/location';
import type { Position, Spot } from '../domain/types';

/** 精度 50m 以内の位置を取得するまでの上限時間（ミリ秒, Req 1.7） */
export const POSITION_TIMEOUT_MS = 30_000;

/**
 * 位置取得結果の判別共用体（discriminated union）。
 *
 * 期待される失敗（権限拒否・タイムアウト）は例外ではなく値として表現し、
 * 呼び出し側が `kind` で網羅的に分岐できるようにする。
 * 予期しない内部エラーのみ `error` として返す。
 *
 * - 'ok'      : 精度 50m 以内の位置を取得できた（Req 1.1）
 * - 'denied'  : 位置許可が拒否された（Req 1.6）
 * - 'timeout' : 制限時間内に精度 50m 以内の位置を取得できなかった（Req 1.7）
 * - 'error'   : 上記以外の取得失敗（位置が利用不可など）
 */
export type LocationResult =
  | { kind: 'ok'; position: Position }
  | { kind: 'denied'; message: string }
  | { kind: 'timeout'; message: string }
  | { kind: 'error'; message: string };

/**
 * テスト容易性のために注入可能な Geolocation 実装の最小インターフェース。
 * 標準の `navigator.geolocation` はこのシグネチャに適合する。
 */
export interface GeolocationLike {
  getCurrentPosition(
    success: (position: GeolocationPosition) => void,
    error: (err: GeolocationPositionError) => void,
    options?: PositionOptions
  ): void;
}

/** Req 1.6: 位置許可拒否時に表示するメッセージ */
export const LOCATION_DENIED_MESSAGE =
  'スタンプを獲得するには位置情報へのアクセスが必要です。';

/** Req 1.7: タイムアウト時（再試行を促す）に表示するメッセージ */
export const LOCATION_TIMEOUT_MESSAGE =
  '十分な精度の位置情報を取得できませんでした。もう一度お試しください。';

/** その他の取得失敗時に表示するメッセージ */
export const LOCATION_UNAVAILABLE_MESSAGE =
  '位置情報を取得できませんでした。もう一度お試しください。';

/**
 * GeolocationPositionError.code の定数。
 * 一部の環境では `GeolocationPositionError` が実行時に存在しないため、
 * 仕様で定義された数値リテラルを直接参照する。
 */
const PERMISSION_DENIED = 1;

/**
 * ブラウザ Geolocation をラップする LocationService。
 *
 * @example
 * const service = new LocationService();
 * const result = await service.getCurrentPosition();
 * if (result.kind === 'ok') {
 *   const presence = service.resolvePresence(result.position, spots);
 * }
 */
export class LocationService {
  private readonly geolocation: GeolocationLike | undefined;
  private readonly timeoutMs: number;

  /**
   * @param geolocation 注入する Geolocation 実装（既定: navigator.geolocation）
   * @param timeoutMs   精度 50m 以内の位置取得を待つ上限時間（既定: 30 秒, Req 1.7）
   */
  constructor(
    geolocation: GeolocationLike | undefined = typeof navigator !== 'undefined'
      ? navigator.geolocation
      : undefined,
    timeoutMs: number = POSITION_TIMEOUT_MS
  ) {
    this.geolocation = geolocation;
    this.timeoutMs = timeoutMs;
  }

  /**
   * 現在位置を取得する（Req 1.1, 1.6, 1.7）。
   *
   * 取得した位置の水平精度が 50m より悪い場合は破棄し（Req 1.2 と整合）、
   * 制限時間内に精度 50m 以内の位置を得られなければ `timeout` を返す。
   * 例外は投げず、期待される失敗は `LocationResult` の値として返す。
   *
   * 注意: 既存のスポット入場状態の保持（Req 1.7）は状態管理層の責務であり、
   * 本メソッドは `timeout`/`denied`/`error` のいずれでも入場状態を表す値を
   * 返さない（＝呼び出し側が現在の入場状態を据え置けばよい）。
   */
  getCurrentPosition(): Promise<LocationResult> {
    return new Promise<LocationResult>((resolve) => {
      if (!this.geolocation) {
        resolve({ kind: 'error', message: LOCATION_UNAVAILABLE_MESSAGE });
        return;
      }

      // 多重 resolve を防ぐためのガード
      let settled = false;
      const settle = (result: LocationResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(result);
      };

      // Req 1.7: 30 秒以内に精度 50m 以内を取得できなければタイムアウト。
      // ブラウザ側の timeout も設定するが、保険として独自タイマーも持つ。
      const timer = setTimeout(() => {
        settle({ kind: 'timeout', message: LOCATION_TIMEOUT_MESSAGE });
      }, this.timeoutMs);

      const clearTimer = (): void => clearTimeout(timer);

      this.geolocation.getCurrentPosition(
        (geoPosition) => {
          clearTimer();

          const position = toDomainPosition(geoPosition);

          // Req 1.1 / 1.2: 精度 50m 超の位置は破棄し、再試行を促す。
          if (position.accuracyMeters > ACCURACY_THRESHOLD_METERS) {
            settle({ kind: 'timeout', message: LOCATION_TIMEOUT_MESSAGE });
            return;
          }

          settle({ kind: 'ok', position });
        },
        (err) => {
          clearTimer();

          // Req 1.6: 権限拒否はスタンプ獲得に位置が必要である旨を伝える。
          if (err.code === PERMISSION_DENIED) {
            settle({ kind: 'denied', message: LOCATION_DENIED_MESSAGE });
            return;
          }

          // Req 1.7: タイムアウトコードは再試行用の状態として返す。
          if (err.code === TIMEOUT) {
            settle({ kind: 'timeout', message: LOCATION_TIMEOUT_MESSAGE });
            return;
          }

          settle({ kind: 'error', message: LOCATION_UNAVAILABLE_MESSAGE });
        },
        {
          enableHighAccuracy: true,
          timeout: this.timeoutMs,
          maximumAge: 0,
        }
      );
    });
  }

  /**
   * 位置と全スポットから入場スポットを判定する（Req 1.3, 1.4, 1.5）。
   * 判定ロジックは純粋関数 `resolveSpotPresence` に委譲する。
   */
  resolvePresence(position: Position, spots: Spot[]): SpotPresenceResult {
    return resolveSpotPresence(position, spots);
  }
}

/** GeolocationPositionError.code のタイムアウト定数 */
const TIMEOUT = 3;

/**
 * ブラウザの `GeolocationPosition` をドメインの `Position` へ変換する。
 * coords（緯度経度・水平精度）と timestamp をマッピングする。
 */
export function toDomainPosition(geoPosition: GeolocationPosition): Position {
  return {
    lat: geoPosition.coords.latitude,
    lng: geoPosition.coords.longitude,
    accuracyMeters: geoPosition.coords.accuracy,
    timestamp: geoPosition.timestamp,
  };
}
