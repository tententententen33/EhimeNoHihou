// オンボーディング画面
//
// 初回起動時に表示する導入画面。3ステップで構成：
// 1. ようこそ画面（タイトル・世界観説明）
// 2. 名前入力
// 3. 冒険開始（キャラ表示・開始ボタン）

import { useState } from 'react';
import './OnboardingView.css';

export interface OnboardingViewProps {
  /** オンボーディング完了時のコールバック */
  onComplete: (playerName: string) => void;
}

type Step = 0 | 1 | 2;

export function OnboardingView({ onComplete }: OnboardingViewProps) {
  const [step, setStep] = useState<Step>(0);
  const [name, setName] = useState('');

  const canProceedName = name.trim().length >= 1 && name.trim().length <= 10;

  return (
    <div className="onboarding">
      {/* ステップ0: ようこそ */}
      {step === 0 && (
        <div className="onboarding__page onboarding__page--welcome">
          <div className="onboarding__emblem">⚔️</div>
          <h1 className="onboarding__title">愛媛の秘宝</h1>
          <p className="onboarding__subtitle">〜 現実世界を冒険するRPG 〜</p>
          <div className="onboarding__story">
            <p>
              愛媛県には、まだ見ぬ秘宝が眠っている。
            </p>
            <p>
              道後の湯守、来島の水軍大将、石鎚の山神…<br />
              各地に潜むボスを倒し、スタンプを集め、<br />
              愛媛のすべてを冒険しよう。
            </p>
          </div>
          <button
            type="button"
            className="onboarding__btn onboarding__btn--primary"
            onClick={() => setStep(1)}
          >
            冒険を始める →
          </button>
        </div>
      )}

      {/* ステップ1: 名前入力 */}
      {step === 1 && (
        <div className="onboarding__page onboarding__page--name">
          <div className="onboarding__emblem">🧙‍♂️</div>
          <h2 className="onboarding__heading">冒険者の名前を決めよう</h2>
          <p className="onboarding__desc">この名前は他の冒険者に表示されます</p>
          <div className="onboarding__input-wrap">
            <input
              type="text"
              className="onboarding__input"
              placeholder="名前を入力（1〜10文字）"
              maxLength={10}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <span className="onboarding__input-count">{name.length}/10</span>
          </div>
          <div className="onboarding__actions">
            <button
              type="button"
              className="onboarding__btn onboarding__btn--ghost"
              onClick={() => setStep(0)}
            >
              ← 戻る
            </button>
            <button
              type="button"
              className="onboarding__btn onboarding__btn--primary"
              disabled={!canProceedName}
              onClick={() => setStep(2)}
            >
              次へ →
            </button>
          </div>
        </div>
      )}

      {/* ステップ2: 冒険開始 */}
      {step === 2 && (
        <div className="onboarding__page onboarding__page--start">
          <div className="onboarding__character">
            <div className="onboarding__character-avatar">🧙‍♂️</div>
            <div className="onboarding__character-info">
              <span className="onboarding__character-name">{name.trim()}</span>
              <span className="onboarding__character-level">Lv.1 冒険者</span>
            </div>
          </div>
          <div className="onboarding__ready">
            <h2 className="onboarding__heading">準備完了！</h2>
            <p className="onboarding__desc">
              松山エリアからあなたの冒険が始まります。<br />
              スポットに近づいてスタンプを集め、<br />
              ボスを倒して新しい地域を解放しよう！
            </p>
          </div>
          <div className="onboarding__tips">
            <div className="onboarding__tip">
              <span className="onboarding__tip-icon">📍</span>
              <span className="onboarding__tip-text">スポットに近づくとスタンプ獲得</span>
            </div>
            <div className="onboarding__tip">
              <span className="onboarding__tip-icon">⚔️</span>
              <span className="onboarding__tip-text">ボスを倒して限定アイテムを入手</span>
            </div>
            <div className="onboarding__tip">
              <span className="onboarding__tip-icon">🗺️</span>
              <span className="onboarding__tip-text">全スポット制覇で次の地域が解放</span>
            </div>
          </div>
          <button
            type="button"
            className="onboarding__btn onboarding__btn--start"
            onClick={() => onComplete(name.trim())}
          >
            ⚔️ 冒険に出発！
          </button>
          <button
            type="button"
            className="onboarding__btn onboarding__btn--ghost"
            onClick={() => setStep(1)}
          >
            ← 名前を変更
          </button>
        </div>
      )}

      {/* ステップインジケーター */}
      <div className="onboarding__dots">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`onboarding__dot${step === i ? ' onboarding__dot--active' : ''}`}
          />
        ))}
      </div>
    </div>
  );
}
