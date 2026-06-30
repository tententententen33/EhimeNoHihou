// 敵キャラの最小アニメーション（Idle / Hit / Attack / Death）。
//
// 本格的なボーン/スケルトンは使わず、1枚のスプライト（または絵文字）に対して
// CSS（待機の揺れ）＋ Web Animations API（被弾/攻撃/死亡の一発再生）で
// 「生きている / 攻撃された / 攻撃した / 死んだ」が分かる程度に動かす。
//
// - Idle:   その場で上下にゆっくり揺れる（常時ループ）
// - Hit:    一瞬のけぞる＋点滅
// - Attack: 前へ踏み込む（腕・武器を前に出す代わりに全体を前進＋拡大）
// - Death:  傾いて倒れ、薄くなって静止（揺れは止まる）

import { useEffect, useRef, useState } from 'react';
import './SimpleEnemy.css';

export type SimpleEnemyAnim = 'idle' | 'attack' | 'hit' | 'death';

export interface SimpleEnemyProps {
  /** 敵スプライト画像（無ければ絵文字）。 */
  spriteUrl?: string;
  /** 画像が無い場合のフォールバック絵文字。 */
  emoji: string;
  /** 敵名（alt 用）。 */
  name: string;
  /** 現在のアニメーション状態。 */
  animation: SimpleEnemyAnim;
  /** 同一アニメを再生し直すためのトークン（変化で再トリガ）。 */
  playToken: number;
  /** 表示倍率（画像の余白差を補正。既定 1）。 */
  scale?: number;
}

export function SimpleEnemy({ spriteUrl, emoji, name, animation, playToken, scale = 1 }: SimpleEnemyProps) {
  const fxRef = useRef<HTMLDivElement>(null);
  const [imgError, setImgError] = useState(false);
  const dead = animation === 'death';

  // attack / hit / death を一発再生（WAAPI）。idle は CSS で常時ループ。
  useEffect(() => {
    const el = fxRef.current;
    if (!el) return;

    if (animation === 'attack') {
      el.animate(
        [
          { transform: 'translateY(0) scale(1)' },
          { transform: 'translateY(16px) scale(1.07)', offset: 0.45 },
          { transform: 'translateY(0) scale(1)' },
        ],
        { duration: 380, easing: 'ease-out' }
      );
    } else if (animation === 'hit') {
      el.animate(
        [
          { transform: 'translateX(0)', opacity: 1 },
          { transform: 'translateX(12px)', opacity: 0.25, offset: 0.2 },
          { transform: 'translateX(2px)', opacity: 1, offset: 0.4 },
          { transform: 'translateX(9px)', opacity: 0.25, offset: 0.6 },
          { transform: 'translateX(0)', opacity: 1 },
        ],
        { duration: 420, easing: 'ease-out' }
      );
    } else if (animation === 'death') {
      el.animate(
        [
          { transform: 'translateY(0) rotate(0deg)', opacity: 1 },
          { transform: 'translateY(8px) rotate(10deg)', opacity: 1, offset: 0.4 },
          { transform: 'translateY(44px) rotate(26deg)', opacity: 0.2 },
        ],
        { duration: 1100, easing: 'ease-in', fill: 'forwards' }
      );
    }
  }, [animation, playToken]);

  return (
    <div className="se">
      <div className="se__fx" ref={fxRef}>
        <div className={`se__idle${dead ? ' se__idle--dead' : ''}`}>
          {spriteUrl && !imgError ? (
            <img
              className="se__img"
              src={spriteUrl}
              alt={name}
              draggable={false}
              onError={() => setImgError(true)}
              style={{ transform: `scale(${scale})`, transformOrigin: 'center bottom' }}
            />
          ) : (
            <span
              className="se__emoji"
              aria-hidden="true"
              style={{ transform: `scale(${scale})`, transformOrigin: 'center bottom', display: 'inline-block' }}
            >
              {emoji}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
