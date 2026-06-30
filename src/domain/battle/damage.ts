// Damage_Calculator: ダメージ算出（Req 14）
//
// 純粋関数。攻撃力・防御力・倍率・分散（注入 RNG）・クリティカル・難易度係数・
// 軽減係数からダメージを算出し、1 以上の整数へクランプする。

import type { Rng } from './types';
import { VARIANCE_MIN } from './types';

export interface DamageInput {
  attack: number;
  defense: number;
  /** 基本倍率（コマンドや弾の係数）。 */
  multiplier: number;
  /** 難易度のダメージ係数（被ダメージ側に適用）。未指定は 1。 */
  damageScale?: number;
  /** ぼうぎょなどの軽減係数（0<r<1）。未指定は 1。 */
  mitigation?: number;
  /** クリティカル発生確率（0..1）。未指定は 0。 */
  critChance?: number;
  /** クリティカル倍率（>=1）。未指定は 1。 */
  critMultiplier?: number;
}

/** rng 値を [0,1) に丸める（不正値への防御）。 */
function clamp01(v: number): number {
  if (!Number.isFinite(v) || v < 0) return 0;
  if (v >= 1) return 0.999999;
  return v;
}

/**
 * ダメージを算出する（Req 14.1, 14.2, 14.3, 14.4）。
 *
 * raw = attack * multiplier * variance * (crit?) - defense/2 を、軽減係数・
 * 難易度係数で調整し、1 以上の整数へクランプする。variance は
 * [VARIANCE_MIN, 1) の乱数。同一入力（RNG 値含む）で同一結果（決定性）。
 */
export function computeDamage(input: DamageInput, rng: Rng): number {
  const {
    attack,
    defense,
    multiplier,
    damageScale = 1,
    mitigation = 1,
    critChance = 0,
    critMultiplier = 1,
  } = input;

  const variance = VARIANCE_MIN + clamp01(rng()) * (1 - VARIANCE_MIN);
  const isCrit = clamp01(rng()) < critChance;
  const critFactor = isCrit ? critMultiplier : 1;

  const base = attack * multiplier * variance * critFactor;
  const raw = (base - defense / 2) * mitigation * damageScale;

  return Math.max(1, Math.round(raw));
}
