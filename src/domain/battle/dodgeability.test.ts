// 回避可能性の検証（全敵・全攻撃パターン）。
//
// 簡易な回避 AI（数フレーム先読みで最も安全な方向へ動く）を使い、各敵の各攻撃
// パターンを通しで避けられるか（被弾が許容回数以内か）を確認する。完全な証明では
// ないが、「人間が避けられないほど理不尽なパターンが無いか」の強い目安になる。

import { describe, it, expect } from 'vitest';
import { startBattle, resolveEnemyAction, tickDodge } from './battle';
import { moveSoul, advanceBullets } from './dodge';
import { getDifficulty } from './difficulty';
import { SOUL_SPEED_PER_SPEED, SOUL_SPEED_MAX_BONUS } from './types';
import type { Bullet, BattleState, DodgeArea, Soul, Vec2 } from './types';
import { enemyDefinitionFromBoss } from '../../data/enemyContent';
import type { Boss, CharacterStats } from '../types';

// 検証対象の全ボス id（中ボス22 + 市町ボス9）。
const MIDBOSS_IDS = [
  'midboss-spot-dogo-honkan',
  'midboss-spot-dogo-asuka',
  'midboss-spot-matsuyama-castle',
  'midboss-spot-botchan-train',
  'midboss-spot-ishiteji',
  'midboss-spot-kururin',
  'midboss-spot-okudogo',
  'midboss-spot-shimonada',
  'midboss-spot-shikoku-karst',
  'midboss-spot-yokaichi',
  'midboss-spot-uchikoza',
  'midboss-spot-kurushima-bridge',
  'midboss-spot-oyamazumi',
  'midboss-spot-imabari-castle',
  'midboss-spot-kirosan',
  'midboss-spot-towel-museum',
  'midboss-spot-nibukawa',
  'midboss-spot-aoshima',
  'midboss-spot-ozu-castle',
  'midboss-spot-ishizuchi',
  'midboss-spot-besshiyama',
  'midboss-spot-uwajima-castle',
];
const BOSS_IDS = [
  'boss-region-matsuyama',
  'boss-region-iyo',
  'boss-region-kumakogen',
  'boss-region-uchiko',
  'boss-region-imabari',
  'boss-region-ozu',
  'boss-region-saijo',
  'boss-region-niihama',
  'boss-region-uwajima',
];

/** 決定的 PRNG（mulberry32）。 */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stubBoss(id: string): Boss {
  const kind = id.startsWith('boss-') ? 'boss' : 'midBoss';
  const stats: CharacterStats = { hp: 200, attack: 14, defense: 6, speed: 8 };
  return {
    id,
    name: id,
    kind,
    stats,
    bind: { kind: 'spot', spotId: id },
    reward: { limitedItemIds: [] },
  } as unknown as Boss;
}

/** ソウルと弾の余裕（クリアランス, px）。負＝接触。リングはすき間を考慮。 */
function clearance(soul: Soul, bullets: Bullet[]): number {
  let minC = Infinity;
  for (const b of bullets) {
    const dx = soul.pos.x - b.pos.x;
    const dy = soul.pos.y - b.pos.y;
    if (b.ringRadius !== undefined) {
      const dist = Math.hypot(dx, dy);
      if (b.gapHalf !== undefined && b.gapAngle !== undefined) {
        const ang = Math.atan2(dy, dx);
        let diff = Math.abs(ang - b.gapAngle) % (Math.PI * 2);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        const minHalf = Math.min(Math.PI / 2, (soul.radius + 4) / Math.max(1, b.ringRadius));
        if (diff <= Math.max(b.gapHalf, minHalf)) continue; // すき間内は安全
      }
      minC = Math.min(minC, Math.abs(dist - b.ringRadius) - (soul.radius + (b.ringThickness ?? 4)));
    } else {
      minC = Math.min(minC, Math.hypot(dx, dy) - (soul.radius + b.radius));
    }
  }
  return minC;
}

const DIRS: Vec2[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 0.707, y: 0.707 },
  { x: -0.707, y: 0.707 },
  { x: 0.707, y: -0.707 },
  { x: -0.707, y: -0.707 },
];

/** 先読みで最も安全な方向を選ぶ。 */
function chooseDir(soul: Soul, bullets: Bullet[], area: DodgeArea, soulSpeed: number, dt: number): Vec2 {
  let best: Vec2 = { x: 0, y: 0 };
  let bestScore = -Infinity;
  for (const dir of DIRS) {
    let s = soul;
    let bs = bullets;
    let minC = Infinity;
    for (let step = 0; step < 6; step++) {
      s = moveSoul(s, dir, soulSpeed, dt, area);
      bs = advanceBullets(bs, dt, area, s.pos);
      minC = Math.min(minC, clearance(s, bs));
    }
    if (minC > bestScore) {
      bestScore = minC;
      best = dir;
    }
  }
  return best;
}

/** 1 パターンを通しで避け、被弾回数を返す。 */
function simulate(def: ReturnType<typeof enemyDefinitionFromBoss>, enraged: boolean): number {
  const player: CharacterStats = { hp: 100000, attack: 10, defense: 10, speed: 10 };
  const pool = enraged ? def.enragedPatterns : def.normalPatterns;
  const len = Math.max(1, pool.length);
  // パターン総当たり: ここでは pool 全部を一括ではなく、各 index を別 simulate で回す。
  let totalHits = 0;
  for (let i = 0; i < len; i++) {
    const prng = makeRng(1234 + i * 97 + (enraged ? 5000 : 0));
    let firstCall = true;
    const rng = () => {
      if (firstCall) {
        firstCall = false;
        return (i + 0.5) / len; // index i を選択させる
      }
      return prng();
    };

    let s: BattleState = startBattle(player, def, 'normal');
    s = { ...s, phase: 'enemyAction', enemy: { ...s.enemy, hp: enraged ? 1 : s.enemy.maxHp } };
    s = resolveEnemyAction(s, rng);

    const config = getDifficulty('normal');
    const soulSpeed = config.soulSpeed * (1 + Math.min(player.speed * SOUL_SPEED_PER_SPEED, SOUL_SPEED_MAX_BONUS));
    const dt = 24;
    let prevHp = s.player.hp;
    let guard = 0;
    while (s.phase === 'dodge' && s.dodge !== null && guard < 600) {
      const dir = chooseDir(s.dodge.soul, s.dodge.bullets, s.dodge.area, soulSpeed, dt);
      s = tickDodge(s, dt, dir, prng);
      if (s.player.hp < prevHp) totalHits += 1;
      prevHp = s.player.hp;
      guard += 1;
    }
  }
  return totalHits;
}

describe('回避可能性: 全敵・全攻撃パターンが避けられる（被弾が許容内）', () => {
  const ALL = [...MIDBOSS_IDS, ...BOSS_IDS];
  // 簡易 AI なので多少の被弾は許容。理不尽（多数被弾）なパターンが無いことを確認する。
  const MAX_HITS = 3;

  it('通常パターン: どの敵も簡易AIで避けきれる', () => {
    const failures: string[] = [];
    for (const id of ALL) {
      const def = enemyDefinitionFromBoss(stubBoss(id));
      const hits = simulate(def, false);
      if (hits > MAX_HITS) failures.push(`${id}(normal): ${hits}被弾`);
    }
    expect(failures, `避けにくいパターン: ${failures.join(', ')}`).toEqual([]);
  });

  it('激化パターン（HP50%以下）: どの敵も簡易AIで避けきれる', () => {
    const failures: string[] = [];
    for (const id of ALL) {
      const def = enemyDefinitionFromBoss(stubBoss(id));
      const hits = simulate(def, true);
      if (hits > MAX_HITS) failures.push(`${id}(enraged): ${hits}被弾`);
    }
    expect(failures, `避けにくいパターン: ${failures.join(', ')}`).toEqual([]);
  });
});
