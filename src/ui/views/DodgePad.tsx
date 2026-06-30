// DodgePad: 避けフェーズの方向入力（バーチャルアナログスティック）。
//
// 円形ベースをドラッグすると、中心からの傾き量に応じた方向ベクトル（大きさ0〜1）を
// onChange で親へ通知する。浅く倒すとゆっくり、深く倒すと速く動く（アナログ入力）。
// 指を離すと中央へ戻り {0,0} を通知する。PC のキーボードは BattleView 側で扱う。

import { useRef, useState } from 'react';
import type { Vec2 } from '../../domain/battle';
import './DodgePad.css';

export interface DodgePadProps {
  /** 方向ベクトル（大きさ0〜1）が変化したときに呼ばれる。無入力は {0,0}。 */
  onChange: (dir: Vec2) => void;
}

/** スティックが倒れる最大半径（px）。 */
const MAX_RADIUS = 46;

export function DodgePad({ onChange }: DodgePadProps) {
  const baseRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(false);
  const [knob, setKnob] = useState<Vec2>({ x: 0, y: 0 });

  const updateFromPointer = (clientX: number, clientY: number) => {
    const el = baseRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > MAX_RADIUS && dist > 0) {
      dx = (dx / dist) * MAX_RADIUS;
      dy = (dy / dist) * MAX_RADIUS;
    }
    setKnob({ x: dx, y: dy });
    // 大きさ0〜1の方向ベクトル（浅い傾き=ゆっくり）。
    onChange({ x: dx / MAX_RADIUS, y: dy / MAX_RADIUS });
  };

  const handleDown = (e: React.PointerEvent) => {
    e.preventDefault();
    activeRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    updateFromPointer(e.clientX, e.clientY);
  };

  const handleMove = (e: React.PointerEvent) => {
    if (!activeRef.current) return;
    e.preventDefault();
    updateFromPointer(e.clientX, e.clientY);
  };

  const handleUp = (e: React.PointerEvent) => {
    if (!activeRef.current) return;
    e.preventDefault();
    activeRef.current = false;
    setKnob({ x: 0, y: 0 });
    onChange({ x: 0, y: 0 });
  };

  return (
    <div
      ref={baseRef}
      className="stick"
      aria-label="移動スティック"
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
    >
      <div className="stick__knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}
