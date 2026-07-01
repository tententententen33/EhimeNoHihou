// Leaflet + OpenStreetMap による実地図サーフェス（Map SDK 抽象の実装）
//
// MapView の `renderSurface`（MapSurfaceProps）に差し込んで使う、実際に機能する地図。
// - OpenStreetMap のタイルを表示するため、道路・地名が見え、ドラッグ移動・ズームができる。
// - API キー不要で動作する（OSM タイルを利用）。将来 Google Maps / Apple MapKit へ
//   置き換える場合も、同じ MapSurfaceProps 契約を満たす別コンポーネントを作って
//   MapView の renderSurface に渡すだけでよい（本コンポーネントを差し替える）。
//
// マーカーは L.divIcon（HTML）で描画するため、Leaflet 既定アイコン画像の読み込み問題
// （バンドラ環境でアイコンが欠落する既知の問題）を回避できる。
// - 解放済みスポット: 📍。名前ラベルを表示（Req 2.2, 2.4）。
// - ロックスポット: 🔒。名前・報酬は表示せず「ロックされたスポット」とのみ示す（Req 2.3）。
// - 現在位置: 青い丸。

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { MapSurfaceProps } from './MapView';
import './LeafletMapSurface.css';

// 既定のズームレベル（市街地が見える程度）。
const DEFAULT_ZOOM = 14;

/** 解放済みスポット用の divIcon（名前ラベル付き）。 */
function unlockedIcon(label: string | undefined, selected: boolean): L.DivIcon {
  const labelHtml =
    label !== undefined && label !== ''
      ? `<span class="leaflet-spot__label">${escapeHtml(label)}</span>`
      : '';
  return L.divIcon({
    className: 'leaflet-spot-icon',
    html: `<div class="leaflet-spot${selected ? ' leaflet-spot--selected' : ''}"><span class="leaflet-spot__pin" aria-hidden="true">📍</span>${labelHtml}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
  });
}

/** 札所（お遍路）用の divIcon（控えめな星）。通常ピンより目立たせない。 */
function henroIcon(selected: boolean): L.DivIcon {
  return L.divIcon({
    className: 'leaflet-spot-icon',
    html: `<div class="leaflet-spot leaflet-spot--henro${selected ? ' leaflet-spot--selected' : ''}"><span class="leaflet-spot__pin leaflet-spot__pin--henro" aria-hidden="true">★</span></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

/** ロックスポット用の divIcon（名前・報酬を伏せ、鍵のみ表示）。 */
function lockedIcon(selected: boolean): L.DivIcon {
  return L.divIcon({
    className: 'leaflet-spot-icon',
    html: `<div class="leaflet-spot leaflet-spot--locked${selected ? ' leaflet-spot--selected' : ''}"><span class="leaflet-spot__pin" aria-hidden="true">🔒</span></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
  });
}

/** 現在位置用の divIcon（Google Map 風の青い点滅ドット）。 */
function playerIcon(): L.DivIcon {
  return L.divIcon({
    className: 'leaflet-player-icon',
    // pulse: 拡散する点滅リング / dot: 中心の青い点
    html: '<div class="leaflet-player" aria-hidden="true"><span class="leaflet-player__pulse"></span><span class="leaflet-player__dot"></span></div>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

/** HTML 文字列へ差し込む際の最小限のエスケープ（XSS 回避）。 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Leaflet 実装の地図サーフェス。MapSurfaceProps を受け取り、実際の地図を描画する。
 */
export function LeafletMapSurface({
  center,
  hasPlayerPosition,
  playerAccuracyMeters,
  markers,
  onSelectMarker,
}: MapSurfaceProps) {
  // 地図を描画する DOM コンテナ。
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Leaflet 地図インスタンス（マウント中のみ保持）。
  const mapRef = useRef<L.Map | null>(null);
  // スポットマーカーをまとめて管理するレイヤ。
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  // 現在位置マーカー。
  const playerMarkerRef = useRef<L.Marker | null>(null);
  // 現在位置の精度円（Google Map 風の薄青い円）。
  const accuracyCircleRef = useRef<L.Circle | null>(null);
  // 直近にセンタリングした座標（プレイヤー位置更新時のみ再センタリングするため）。
  const lastCenterRef = useRef<{ lat: number; lng: number } | null>(null);
  // 最新の onSelectMarker をイベントから参照するための ref。
  const onSelectRef = useRef(onSelectMarker);
  onSelectRef.current = onSelectMarker;

  // 地図の初期化（マウント時に 1 回）。
  useEffect(() => {
    if (containerRef.current === null || mapRef.current !== null) {
      return;
    }
    const map = L.map(containerRef.current, {
      center: [center.lat, center.lng],
      zoom: DEFAULT_ZOOM,
      // モバイルでの操作性（ドラッグ・ピンチズーム）は既定で有効。
      zoomControl: true,
    });

    // OpenStreetMap タイル（道路・地名が見える実地図）。
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    markerLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    lastCenterRef.current = { lat: center.lat, lng: center.lng };

    // flex/可変レイアウト内でのサイズ確定のため、次フレームで再計算する。
    const sizeTimer = window.setTimeout(() => map.invalidateSize(), 0);

    // コンテナのサイズ変化（全面化・回転・アドレスバー増減など）に追従して再計算する。
    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      resizeObserver = new ResizeObserver(() => map.invalidateSize());
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      window.clearTimeout(sizeTimer);
      resizeObserver?.disconnect();
      map.remove();
      mapRef.current = null;
      markerLayerRef.current = null;
      playerMarkerRef.current = null;
    };
    // 初期化は一度のみ。center 等の変化は別 effect で反映する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // マーカー集合の更新（解放済み／ロック）。
  useEffect(() => {
    const layer = markerLayerRef.current;
    if (layer === null) {
      return;
    }
    layer.clearLayers();

    for (const m of markers) {
      const icon = m.locked
        ? lockedIcon(m.selected)
        : m.henro
          ? henroIcon(m.selected)
          : unlockedIcon(m.label, m.selected);
      const marker = L.marker([m.lat, m.lng], {
        icon,
        // アクセシビリティ用の代替テキスト（ロックは名称を出さない）。
        alt: m.locked ? 'ロックされたスポット' : m.henro ? '札所（お遍路）' : (m.label ?? '解放済みスポット'),
        keyboard: true,
      });
      marker.on('click', () => onSelectRef.current(m.spotId));
      layer.addLayer(marker);
    }
  }, [markers]);

  // 現在位置マーカー＋精度円の更新。
  useEffect(() => {
    const map = mapRef.current;
    if (map === null) {
      return;
    }
    if (hasPlayerPosition) {
      const latlng: L.LatLngExpression = [center.lat, center.lng];

      // 中心の点滅ドット
      if (playerMarkerRef.current === null) {
        playerMarkerRef.current = L.marker(latlng, {
          icon: playerIcon(),
          alt: '現在位置',
          interactive: false,
          zIndexOffset: 1000,
        }).addTo(map);
      } else {
        playerMarkerRef.current.setLatLng(latlng);
      }

      // 精度円（半径＝水平精度メートル）。精度が大きすぎる場合は上限でクランプする。
      const radius = Math.min(Math.max(playerAccuracyMeters ?? 0, 0), 1000);
      if (radius > 0) {
        if (accuracyCircleRef.current === null) {
          accuracyCircleRef.current = L.circle(latlng, {
            radius,
            interactive: false,
            color: '#1565c0',
            weight: 1,
            opacity: 0.4,
            fillColor: '#1a73e8',
            fillOpacity: 0.12,
          }).addTo(map);
        } else {
          accuracyCircleRef.current.setLatLng(latlng);
          accuracyCircleRef.current.setRadius(radius);
        }
      } else if (accuracyCircleRef.current !== null) {
        accuracyCircleRef.current.remove();
        accuracyCircleRef.current = null;
      }
    } else {
      if (playerMarkerRef.current !== null) {
        playerMarkerRef.current.remove();
        playerMarkerRef.current = null;
      }
      if (accuracyCircleRef.current !== null) {
        accuracyCircleRef.current.remove();
        accuracyCircleRef.current = null;
      }
    }
  }, [hasPlayerPosition, center.lat, center.lng, playerAccuracyMeters]);

  // センター座標が変わったら（主に現在位置の更新時）地図を移動する。
  // ユーザーのパン操作を妨げないよう、座標が実際に変化したときのみ再センタリングする。
  useEffect(() => {
    const map = mapRef.current;
    if (map === null) {
      return;
    }
    const last = lastCenterRef.current;
    if (last === null || last.lat !== center.lat || last.lng !== center.lng) {
      map.setView([center.lat, center.lng], map.getZoom());
      lastCenterRef.current = { lat: center.lat, lng: center.lng };
    }
  }, [center.lat, center.lng]);

  return <div ref={containerRef} className="leaflet-surface" role="application" aria-label="地図" />;
}
