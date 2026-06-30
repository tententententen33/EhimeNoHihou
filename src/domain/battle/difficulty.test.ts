// Difficulty_Config のテスト（Property 21 / Req 19）
import { describe, it, expect } from 'vitest';
import { DIFFICULTY } from './difficulty';

describe('Property 21: 難易度の単調性（Req 19）', () => {
  const e = DIFFICULTY.easy;
  const n = DIFFICULTY.normal;
  const h = DIFFICULTY.hard;

  it('弾速・弾数・ダメージ係数は Easy <= Normal <= Hard', () => {
    expect(e.bulletSpeedScale).toBeLessThanOrEqual(n.bulletSpeedScale);
    expect(n.bulletSpeedScale).toBeLessThanOrEqual(h.bulletSpeedScale);
    expect(e.bulletCountScale).toBeLessThanOrEqual(n.bulletCountScale);
    expect(n.bulletCountScale).toBeLessThanOrEqual(h.bulletCountScale);
    expect(e.damageScale).toBeLessThanOrEqual(n.damageScale);
    expect(n.damageScale).toBeLessThanOrEqual(h.damageScale);
  });

  it('ソウル移動速度・予兆時間は Easy >= Normal >= Hard', () => {
    expect(e.soulSpeed).toBeGreaterThanOrEqual(n.soulSpeed);
    expect(n.soulSpeed).toBeGreaterThanOrEqual(h.soulSpeed);
    expect(e.telegraphMs).toBeGreaterThanOrEqual(n.telegraphMs);
    expect(n.telegraphMs).toBeGreaterThanOrEqual(h.telegraphMs);
  });
});
