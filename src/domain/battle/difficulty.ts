// Difficulty_Config: 難易度ごとの戦闘パラメータ（Req 19）
//
// 単調関係を満たす固定値を定義する:
// - 弾速・弾数・ダメージ係数: Easy <= Normal <= Hard
// - ソウル移動速度・予兆時間: Easy >= Normal >= Hard

import type { DifficultyConfig, DifficultyId } from './types';

/** 3 難易度の定義。 */
export const DIFFICULTY: Record<DifficultyId, DifficultyConfig> = {
  easy: {
    bulletSpeedScale: 0.72,
    bulletCountScale: 0.8,
    telegraphMs: 2200,
    damageScale: 0.8,
    soulSpeed: 0.2,
  },
  normal: {
    bulletSpeedScale: 0.92,
    bulletCountScale: 1.0,
    telegraphMs: 1800,
    damageScale: 1.0,
    soulSpeed: 0.16,
  },
  hard: {
    bulletSpeedScale: 1.15,
    bulletCountScale: 1.3,
    telegraphMs: 1400,
    damageScale: 1.3,
    soulSpeed: 0.14,
  },
};

/** 難易度設定を取得する。 */
export function getDifficulty(id: DifficultyId): DifficultyConfig {
  return DIFFICULTY[id];
}
