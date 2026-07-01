// アプリ全体のレイアウトとナビゲーションを担うコンポーネント（Task 18.1 / Req 12）。
// header / main / footer の3領域を描画し（Req 12.1）、
// map / character / shop / quests / collections へのメニューナビゲーションを提供する（Req 12.2, 12.3）。
// 各ビューの実体は Task 19 で実装するため、ここではビューレジストリ（props）として受け取り、
// 未提供のビューにはプレースホルダを表示する。
import type { ReactNode } from 'react';
import { useState } from 'react';
import './styles/AppLayout.css';

// ナビゲーション先のビューを識別するキー（Req 12.2）。
export type NavKey = 'home' | 'map' | 'character' | 'shop' | 'quests' | 'collections' | 'friends';

// 初期データ取得状態（Req 12.6, 12.7, 12.8）。
// - 'loading': User_Data_Store からの取得中（ローディング表示）
// - 'error'  : 10秒以内に取得できなかった（読み込み失敗メッセージ＋再試行）
// - 'ready'  : 取得完了（通常のビューを表示）
export type LoadStatus = 'loading' | 'error' | 'ready';

// ビューレジストリ。NavKey ごとに描画するビューを差し込む（Task 19 で実体を提供）。
export type ViewRegistry = Partial<Record<NavKey, ReactNode>>;

export interface AppLayoutProps {
  // 初期データ取得状態。既定は 'ready'。
  loadStatus?: LoadStatus;
  // 読み込み失敗時の再試行ハンドラ（Req 12.8）。
  onRetry?: () => void;
  // 各ビューの描画内容（Task 19 から差し込む）。
  views?: ViewRegistry;
  // 初期表示ビュー。既定は 'home'。
  initialView?: NavKey;
}

// メニュー項目の定義（表示順・ラベルは日本語、RPG風アイコン）。
const NAV_ITEMS: ReadonlyArray<{ key: NavKey; label: string; icon: string }> = [
  { key: 'home', label: 'ホーム', icon: '🏠' },
  { key: 'map', label: 'マップ', icon: '🧭' },
  { key: 'quests', label: 'クエスト', icon: '📜' },
  { key: 'shop', label: 'ショップ', icon: '🏪' },
  { key: 'friends', label: 'フレンド', icon: '👥' },
  { key: 'character', label: 'マイページ', icon: '⚔️' },
];

// NavKey からメニュー定義を引くためのラベル参照。
const NAV_LABEL: Record<NavKey, string> = {
  home: 'ホーム',
  map: 'マップ',
  friends: 'フレンド',
  character: 'マイページ',
  shop: 'ショップ',
  quests: 'クエスト',
  collections: '図鑑',
};

export function AppLayout({
  loadStatus = 'ready',
  onRetry,
  views,
  initialView = 'home',
}: AppLayoutProps) {
  // 現在アクティブなビュー。メニュー選択で切り替える（Req 12.3）。
  const [activeView, setActiveView] = useState<NavKey>(initialView);

  return (
    <div className="app-shell">
      {/* header 領域（Req 12.1） */}
      <header className="app-header">
        <h1 className="app-header__title">愛媛の秘宝</h1>
        <span className="app-header__view-label">{NAV_LABEL[activeView]}</span>
      </header>

      {/* main 領域（Req 12.1）。取得状態に応じて表示を切り替える */}
      <main className="app-main" data-view={activeView}>
        {renderMain({ loadStatus, activeView, views, onRetry })}
      </main>

      {/* footer 領域＝メニューナビゲーション（Req 12.1, 12.2） */}
      <footer className="app-footer">
        <nav className="app-nav" aria-label="メインナビゲーション">
          {NAV_ITEMS.map((item) => {
            const isActive = item.key === activeView;
            return (
              <button
                key={item.key}
                type="button"
                className={`app-nav__item${isActive ? ' app-nav__item--active' : ''}`}
                // データ取得が完了するまではビュー切り替えを無効化する。
                disabled={loadStatus !== 'ready'}
                aria-current={isActive ? 'page' : undefined}
                aria-label={item.label}
                onClick={() => setActiveView(item.key)}
              >
                <span className="app-nav__icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="app-nav__label">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </footer>
    </div>
  );
}

// main 領域の中身を取得状態に応じて描画する。
function renderMain({
  loadStatus,
  activeView,
  views,
  onRetry,
}: {
  loadStatus: LoadStatus;
  activeView: NavKey;
  views?: ViewRegistry;
  onRetry?: () => void;
}): ReactNode {
  // 初期データ取得中はローディング表示（Req 12.7）。
  if (loadStatus === 'loading') {
    return (
      <div className="app-status" role="status" aria-live="polite">
        <span className="app-status__spinner" aria-hidden="true" />
        <p className="app-status__text">データを読み込んでいます…</p>
      </div>
    );
  }

  // 10秒超過などで取得失敗した場合は失敗メッセージと再試行（Req 12.8）。
  if (loadStatus === 'error') {
    return (
      <div className="app-status app-status--error" role="alert">
        <p className="app-status__text">
          プレイヤーデータを読み込めませんでした。通信環境をご確認ください。
        </p>
        <button type="button" className="app-status__retry" onClick={onRetry}>
          再試行
        </button>
      </div>
    );
  }

  // 取得完了後はアクティブビューを表示する（Req 12.3）。
  const view = views?.[activeView];
  if (view !== undefined) {
    return view;
  }

  // ビュー未提供時のプレースホルダ（実体は Task 19 で実装）。
  return (
    <div className="app-placeholder">
      <p>「{NAV_LABEL[activeView]}」ビューは準備中です。</p>
    </div>
  );
}
