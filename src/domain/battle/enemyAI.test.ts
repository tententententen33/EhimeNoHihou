// Enemy_AI のテスト（Property 11 / Req 9）
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { selectEnemyAction, generateBullets } from './enemyAI';
import { getDifficulty } from './difficulty';
import { startBattle } from './battle';
import type { BattleState, EnemyDefinition } from './types';

const NUM_RUNS = 100;

function makeEnemy(): EnemyDefinition {
  return {
    id: 'enemy-test',
    name: 'テスト',
    stats: { hp: 100, attack: 12, defense: 5, speed: 8 },
    normalPatterns: [
      { id: 'n1', message: 'n1', spawn: { count: 3, speed: 0.1, radius: 6, pattern: 'rain', damageMultiplier: 1 }, dodgeDurationMs: 1000 },
      { id: 'n2', message: 'n2', spawn: { count: 4, speed: 0.1, radius: 6, pattern: 'sweep', damageMultiplier: 1 }, dodgeDurationMs: 1000 },
    ],
    enragedPatterns: [
      { id: 'e1', message: 'e1', spawn: { count: 6, speed: 0.15, radius: 6, pattern: 'rain', damageMultiplier: 1.2 }, dodgeDurationMs: 1200 },
    ],
    actOptions: [{ id: 'check', label: 'しらべる', message: 'm' }],
    fleeChance: 0.5,
    messages: { start: 's', playerLowHp: 'low', win: 'w', lose: 'l' },
  };
}

function stateWithEnemyHp(hp: number): BattleState {
  const s = startBattle({ hp: 50, attack: 10, defense: 5, speed: 10 }, makeEnemy(), 'normal');
  return { ...s, enemy: { ...s.enemy, hp } };
}

describe('Property 11: 敵行動の決定性とパターン切替（Req 9）', () => {
  it('HP > 50% は通常パターン集合（id が n*）から選ぶ', () => {
    const s = stateWithEnemyHp(80); // maxHp 100
    fc.assert(
      fc.property(fc.double({ min: 0, max: 0.999, noNaN: true }), (r) => {
        const p = selectEnemyAction(s, () => r);
        expect(p.id.startsWith('n')).toBe(true);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('HP <= 50%（境界含む）は変化後パターン集合（id が e*）から選ぶ', () => {
    const boundary = stateWithEnemyHp(50); // ちょうど 50%
    const low = stateWithEnemyHp(20);
    expect(selectEnemyAction(boundary, () => 0).id.startsWith('e')).toBe(true);
    expect(selectEnemyAction(low, () => 0.9).id.startsWith('e')).toBe(true);
  });

  it('決定性: 同一状態・同一 RNG 値で同一行動', () => {
    const s = stateWithEnemyHp(80);
    fc.assert(
      fc.property(fc.double({ min: 0, max: 0.999, noNaN: true }), (r) => {
        expect(selectEnemyAction(s, () => r).id).toBe(selectEnemyAction(s, () => r).id);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('generateBullets は難易度の弾数スケールを反映する', () => {
    const pattern = makeEnemy().normalPatterns[0]!; // count 3
    const area = { width: 320, height: 200 };
    const normal = generateBullets(pattern, getDifficulty('normal'), area, () => 0.5);
    const easy = generateBullets(pattern, getDifficulty('easy'), area, () => 0.5);
    const hard = generateBullets(pattern, getDifficulty('hard'), area, () => 0.5);
    expect(normal.length).toBe(3); // round(3 * 1.0)
    expect(easy.length).toBe(2); // round(3 * 0.7) = 2
    expect(hard.length).toBe(4); // round(3 * 1.3) = 4
    // 全弾がエリア上端の外側（rain）から開始する。
    for (const b of normal) {
      expect(b.velocity.y).toBeGreaterThan(0);
    }
  });
});
