// Map ビュー（Task 19.1 / Req 2）。
//
// 現在位置を中心に地図を描画し、解放済みスポットのマーカー（getVisibleMarkers）を表示する。
// ロックスポットは秘匿表示（名前・説明・報酬を出さない）とし、解放スポットを選択したときのみ
// 名前・説明・訪問状態を詳細パネルに表示する（Req 2.2, 2.3, 2.4, 2.5）。
// 位置が無い場合は愛媛県内の既定座標（松山城周辺）へセンタリングし（Req 2.6）、
// 10秒以内に描画できない場合は読み込み失敗メッセージと再試行を表示する（Req 2.7）。
//
// 【設計上の選択（Map SDK 抽象化）】
// 本 MVP では API キーや重量級の外部 Map SDK を導入せず、緯度経度から相対座標へ射影して
// マーカーを div で配置する軽量な「アプリ内マップサーフェス（InAppMapSurface）」を既定描画とする。
// 将来 Google Maps / Mapbox 等の実 SDK へ差し替えられるよう、描画面を `MapSurface` という
// 小さなインターフェース（`renderSurface` プロップ）の背後に抽象化している。実 SDK 採用時は
// `renderSurface` に SDK ラッパを渡すだけで、本ビューのマーカー生成・秘匿ロジックを再利用できる。
// 地図描画自体は設計書 Testing Strategy のとおり PBT 非対象であり、本ファイルは表示専用
// （presentational）コンポーネントとして純粋ドメイン関数（map.ts）の結果を描画するに留める。

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { PlayerState, Spot } from '../../domain/types';
import {
  getSpotDetail,
  getVisibleMarkers,
  isSpotUnlocked,
} from '../../domain/map';
import './MapView.css';

// 愛媛県内の既定センター座標（松山城周辺）。位置が無い場合に使用する（Req 2.6）。
export const EHIME_DEFAULT_CENTER = { lat: 33.8457, lng: 132.766 } as const;

// 地図の読み込み・描画状態（Req 2.1, 2.7）。
// - 'loading': 地図の読み込み・センタリング中
// - 'ready'  : 描画完了
// - 'error'  : 10秒以内に描画できなかった（読み込み失敗メッセージ＋再試行）
export type MapRenderStatus = 'loading' | 'ready' | 'error';

// 地図描画面に渡す1マーカー分の情報。実 SDK 差し替え時もこの形を入力とする。
export interface SurfaceMarker {
  spotId: string;
  lat: number;
  lng: number;
  /** ロック状態か。ロックは秘匿表示（名前等を持たない）（Req 2.3） */
  locked: boolean;
  /** 現在選択中のマーカーか（強調表示用） */
  selected: boolean;
  /**
   * 地図上に表示する名前ラベル。解放済みスポットのみ設定する（Req 2.4）。
   * ロックスポットには設定しない（名前を秘匿するため, Req 2.3）。
   */
  label?: string;
}

// 地図描画面（Map SDK 抽象）に渡すプロップ。実 SDK ラッパもこの契約を満たせばよい。
export interface MapSurfaceProps {
  /** センター座標（現在位置、無ければ愛媛県内の既定座標）（Req 2.1, 2.6） */
  center: { lat: number; lng: number };
  /** 現在位置マーカーを描画するか（位置が利用可能なときのみ true） */
  hasPlayerPosition: boolean;
  /** 現在位置の水平精度（メートル）。精度円の半径表示に用いる（任意） */
  playerAccuracyMeters?: number;
  /** 描画するマーカー集合（解放済み＋ロック） */
  markers: SurfaceMarker[];
  /** マーカー選択時のハンドラ */
  onSelectMarker: (spotId: string) => void;
}

export interface MapViewProps {
  /** プレイヤー状態（マーカーの解放判定・訪問状態の算出に使用） */
  player: PlayerState;
  /** 全スポット定義 */
  spots: Spot[];
  /** 現在位置（精度50m以内が取得できている場合）。無ければ null（Req 2.6） */
  position: { lat: number; lng: number } | null;
  /** 現在位置の水平精度（メートル）。精度円表示に用いる（任意） */
  positionAccuracyMeters?: number;
  /** 地図描画状態。既定は 'ready'（Req 2.1, 2.7） */
  status?: MapRenderStatus;
  /** 読み込み失敗時の再試行ハンドラ（Req 2.7） */
  onRetry?: () => void;
  /**
   * 読み込みが10秒以内に完了しなかったことを親へ通知するコールバック（Req 2.7）。
   * 本ビューは状態 'loading' のまま10秒経過したときに一度だけ呼ぶ。実際に 'error' へ
   * 遷移させるかは状態管理層（親）が判断する（表示専用に保つため）。
   */
  onLoadTimeout?: () => void;
  /**
   * 地図描画面の差し替え用フック（Map SDK 抽象）。
   * 省略時は軽量なアプリ内マップサーフェス（InAppMapSurface）を使用する。
   * 実 SDK 採用時はここに SDK ラッパ（MapSurfaceProps を受け取り ReactNode を返す関数）を渡す。
   */
  renderSurface?: (surfaceProps: MapSurfaceProps) => ReactNode;
}

// 読み込みタイムアウト（Req 2.7: 10秒）。
const LOAD_TIMEOUT_MS = 10_000;

/**
 * Map ビュー本体。マーカー生成・秘匿ロジックはドメイン層（map.ts）に委譲し、
 * ここでは結果の描画とスポット選択 UI のみを担う表示専用コンポーネントである。
 */
export function MapView({
  player,
  spots,
  position,
  positionAccuracyMeters,
  status = 'ready',
  onRetry,
  onLoadTimeout,
  renderSurface,
}: MapViewProps) {
  // 選択中のスポット id（マーカー選択で更新）。未選択は null。
  const [selectedSpotId, setSelectedSpotId] = useState<string | null>(null);

  // センター座標: 現在位置があればそれを、無ければ愛媛県内の既定座標を使う（Req 2.1, 2.6）。
  const center = position ?? EHIME_DEFAULT_CENTER;

  // 解放済みスポットのマーカー（Req 2.2）。詳細（名前・説明・報酬）は含まない。
  const unlockedMarkers = useMemo(
    () => getVisibleMarkers(player, spots),
    [player, spots]
  );

  // ロックスポットのマーカー（Req 2.3）。位置のみを持ち、名前・説明・報酬は一切含めない。
  // getVisibleMarkers は解放済みのみを返すため、ロック分はここで秘匿状態のまま導出する。
  const lockedMarkers = useMemo<SurfaceMarker[]>(
    () =>
      spots
        .filter((spot) => !isSpotUnlocked(player, spot))
        .map((spot) => ({
          spotId: spot.id,
          lat: spot.center.lat,
          lng: spot.center.lng,
          locked: true,
          selected: spot.id === selectedSpotId,
        })),
    [player, spots, selectedSpotId]
  );

  // 描画面へ渡すマーカー集合（解放済み＋ロック）。
  const surfaceMarkers = useMemo<SurfaceMarker[]>(() => {
    // スポット id → 名前の参照（解放済みマーカーのラベル表示に使用）。
    const nameById = new Map(spots.map((s) => [s.id, s.name]));
    const unlocked: SurfaceMarker[] = unlockedMarkers.map((m) => ({
      spotId: m.spotId,
      lat: m.position.lat,
      lng: m.position.lng,
      locked: false,
      selected: m.spotId === selectedSpotId,
      // 解放済みスポットは名前を表示してよい（Req 2.4）。
      label: nameById.get(m.spotId),
    }));
    return [...unlocked, ...lockedMarkers];
  }, [unlockedMarkers, lockedMarkers, selectedSpotId, spots]);

  // 選択中スポットの詳細ペイロード（Req 2.4, 2.5）。
  // ドメイン関数 getSpotDetail がロック時は名前・説明・報酬を秘匿した形を返す。
  const selectedDetail = useMemo(() => {
    if (selectedSpotId === null) {
      return null;
    }
    const spot = spots.find((s) => s.id === selectedSpotId);
    if (spot === undefined) {
      return null;
    }
    return getSpotDetail(player, spot);
  }, [selectedSpotId, spots, player]);

  // 読み込みが10秒以内に完了しない場合に親へ通知する（Req 2.7）。
  // status が 'loading' の間だけタイマーを張り、完了/失敗・アンマウントで解除する。
  useEffect(() => {
    if (status !== 'loading' || onLoadTimeout === undefined) {
      return;
    }
    const timer = window.setTimeout(onLoadTimeout, LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [status, onLoadTimeout]);

  // 読み込み失敗時は失敗メッセージと再試行を表示する（Req 2.7）。
  if (status === 'error') {
    return (
      <section className="map-view" aria-label="マップ">
        <div className="map-view__status map-view__status--error" role="alert">
          <p className="map-view__status-text">
            地図を読み込めませんでした。通信環境をご確認ください。
          </p>
          <button
            type="button"
            className="map-view__retry"
            onClick={onRetry}
          >
            再試行
          </button>
        </div>
      </section>
    );
  }

  // 読み込み中はローディング表示（センタリング完了待ち, Req 2.1）。
  if (status === 'loading') {
    return (
      <section className="map-view" aria-label="マップ">
        <div className="map-view__status" role="status" aria-live="polite">
          <span className="map-view__spinner" aria-hidden="true" />
          <p className="map-view__status-text">地図を読み込んでいます…</p>
        </div>
      </section>
    );
  }

  // 描画面プロップを組み立てる。
  const surfaceProps: MapSurfaceProps = {
    center,
    hasPlayerPosition: position !== null,
    playerAccuracyMeters: positionAccuracyMeters,
    markers: surfaceMarkers,
    onSelectMarker: setSelectedSpotId,
  };

  return (
    <section className="map-view" aria-label="マップ">
      {/* 位置が無い場合は既定座標で表示している旨を示す（Req 2.6） */}
      {position === null && (
        <p className="map-view__notice" role="note">
          現在位置が取得できないため、愛媛県内の既定地点を表示しています。
        </p>
      )}

      {/* 地図描画面（既定はアプリ内サーフェス、実 SDK は renderSurface で差し替え） */}
      {renderSurface ? (
        renderSurface(surfaceProps)
      ) : (
        <InAppMapSurface {...surfaceProps} />
      )}

      {/* 選択スポットの詳細パネル（Req 2.4, 2.5） */}
      {selectedDetail !== null && (
        <SpotDetailPanel
          detail={selectedDetail}
          onClose={() => setSelectedSpotId(null)}
        />
      )}
    </section>
  );
}

// 緯度経度を描画面内の相対位置（%）へ射影する際の表示幅（度）。
// センターから ±(SPAN_DEG/2) の範囲をビューポート全体に対応づける。MVP の簡易射影。
const SPAN_DEG = 0.08;

/**
 * 軽量なアプリ内マップサーフェス（既定の描画面）。
 *
 * 実 Map SDK を使わず、各マーカーの緯度経度をセンター基準の相対位置（%）へ線形射影し、
 * 絶対配置の div として描画する。北が上（緯度が大きいほど上）になるよう y を反転する。
 * 表示範囲外のマーカーは端にクランプして見切れを防ぐ。あくまで MVP 用の簡易描画であり、
 * 実 SDK 採用時は本コンポーネントを置き換える前提（MapView の renderSurface 参照）。
 */
function InAppMapSurface({
  center,
  hasPlayerPosition,
  markers,
  onSelectMarker,
}: MapSurfaceProps): ReactNode {
  // 経度→x%、緯度→y% への射影（0〜100 にクランプ）。
  const project = (lat: number, lng: number): { xPct: number; yPct: number } => {
    const xPct = 50 + ((lng - center.lng) / SPAN_DEG) * 100;
    const yPct = 50 - ((lat - center.lat) / SPAN_DEG) * 100;
    return {
      xPct: clamp(xPct, 2, 98),
      yPct: clamp(yPct, 2, 98),
    };
  };

  return (
    <div className="map-surface" role="application" aria-label="地図">
      {/* 現在位置マーカー（位置が利用可能なときのみ。常にセンター＝50%,50%） */}
      {hasPlayerPosition && (
        <span
          className="map-surface__player"
          style={{ left: '50%', top: '50%' }}
          aria-label="現在位置"
        />
      )}

      {markers.map((marker) => {
        const { xPct, yPct } = project(marker.lat, marker.lng);
        const classNames = [
          'map-surface__marker',
          marker.locked
            ? 'map-surface__marker--locked'
            : 'map-surface__marker--unlocked',
          marker.selected ? 'map-surface__marker--selected' : '',
        ]
          .filter(Boolean)
          .join(' ');

        // ロックマーカーはアクセシブル名にも名称を出さない（秘匿, Req 2.3）。
        const label = marker.locked ? 'ロックされたスポット' : '解放済みスポット';

        return (
          <button
            key={marker.spotId}
            type="button"
            className={classNames}
            style={{ left: `${xPct}%`, top: `${yPct}%` }}
            aria-label={label}
            aria-pressed={marker.selected}
            onClick={() => onSelectMarker(marker.spotId)}
          >
            <span aria-hidden="true">{marker.locked ? '🔒' : '📍'}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * スポット選択時の詳細パネル（Req 2.4, 2.5）。
 *
 * detail はドメイン関数 getSpotDetail が返す判別共用体で、ロック時（locked: true）は
 * 名前・説明・報酬を構造上保持しないため、本パネルはロック旨のみを表示する（Req 2.5）。
 * 解放時（locked: false）は名前・説明・訪問状態を表示する（Req 2.4）。
 */
function SpotDetailPanel({
  detail,
  onClose,
}: {
  detail: ReturnType<typeof getSpotDetail>;
  onClose: () => void;
}): ReactNode {
  if (detail.locked) {
    // ロックスポット: 名前・説明・報酬を一切表示しない（Req 2.5）。
    return (
      <div className="map-detail map-detail--locked" role="dialog" aria-label="スポット詳細">
        <button
          type="button"
          className="map-detail__close"
          aria-label="閉じる"
          onClick={onClose}
        >
          ×
        </button>
        <p className="map-detail__locked-text">
          🔒 このスポットはまだ解放されていません。
        </p>
      </div>
    );
  }

  // 解放済みスポット: 名前・説明・訪問状態を表示（Req 2.4）。
  const visited = detail.visitStatus === 'visited';
  return (
    <div className="map-detail" role="dialog" aria-label="スポット詳細">
      <button
        type="button"
        className="map-detail__close"
        aria-label="閉じる"
        onClick={onClose}
      >
        ×
      </button>
      <h2 className="map-detail__name">{detail.name}</h2>
      <p className="map-detail__description">{detail.description}</p>
      <p
        className={`map-detail__visit${
          visited ? ' map-detail__visit--visited' : ''
        }`}
      >
        {visited ? '✅ 訪問済み' : '⬜ 未訪問'}
      </p>
    </div>
  );
}

// 値を [min, max] に収める補助関数。
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
