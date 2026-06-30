// Damage_Calculator のテスト（Property 18 / Req 14）
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeDamage } from './damage';

const NUM_RUNS = 100;

/** 決定論的な rng（毎回同じ系列を返す）。 */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe('Property 18: ダメージ計算（Req 14）', () => {
  it('ダメージは常に 1 以上の整数', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 300 }),
        fc.integer({ min: 0, max: 200 }),
        fc.double({ min: 0, max: 3, noNaN: true }),
        fc.double({ min: 0, max: 0.999, noNaN: true }),
        (attack, defense, multiplier, r) => {
          const d = computeDamage({ attack, defense, multiplier }, () => r);
          expect(Number.isInteger(d)).toBe(true);
          expect(d).toBeGreaterThanOrEqual(1);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it('攻撃力単調性: 攻撃力を増やすとダメージは非減少（クリティカル無し）', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 40 }),
        (attack, extra, defense) => {
          const d1 = computeDamage({ attack, defense, multiplier: 1, critChance: 0 }, () => 0.5);
          const d2 = computeDamage({ attack: attack + extra, defense, multiplier: 1, critChance: 0 }, () => 0.5);
          expect(d2).toBeGreaterThanOrEqual(d1);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it('決定性: 同一入力・同一 RNG 系列で同一ダメージ', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 0, max: 80 }),
        (attack, defense) => {
          const input = { attack, defense, multiplier: 1.5, critChance: 0.2, critMultiplier: 2 };
          const a = computeDamage(input, seqRng([0.1, 0.05]));
          const b = computeDamage(input, seqRng([0.1, 0.05]));
          expect(a).toBe(b);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it('クリティカルは基本ダメージ以上になる', () => {
    // crit 確実発生（rng=0 < critChance）vs crit 無し（critChance=0）。
    const base = computeDamage({ attack: 50, defense: 0, multiplier: 1, critChance: 0 }, () => 0);
    const crit = computeDamage({ attack: 50, defense: 0, multiplier: 1, critChance: 1, critMultiplier: 2 }, () => 0);
    expect(crit).toBeGreaterThanOrEqual(base);
  });
});
