// Enemy_AI: 敵の行動選択と弾生成（Req 9, 11.4, 19.2）
//
// 純粋関数。HP 割合で通常/変化パターン集合を切り替え、注入 RNG で行動を選ぶ。
// 同一 BattleState・同一 RNG 系列で同一行動を返す（決定性）。

import type {
  BattleState,
  Bullet,
  BulletSpawnSpec,
  DifficultyConfig,
  DodgeArea,
  EnemyActionPattern,
  Rng,
} from './types';
import { ENRAGE_RATIO, SPEED_REF_COUNT, SPEED_COUNT_MIN_MUL, SPEED_COUNT_MAX_MUL } from './types';

/** rng 値を [0,1) に丸める（防御）。 */
function clamp01(v: number): number {
  if (!Number.isFinite(v) || v < 0) return 0;
  if (v >= 1) return 0.999999;
  return v;
}

/** 値を [min, max] にクランプする。 */
function clampX(v: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, v));
}

/**
 * 敵の次行動を選択する（Req 9.1〜9.4）。
 *
 * 敵 HP が最大の 50% より大きければ通常パターン集合、50% 以下なら変化後パターン
 * 集合から、RNG で 1 つ選ぶ。境界（ちょうど 50%）は変化後。空集合の場合は
 * もう一方の集合へフォールバックする。
 */
export function selectEnemyAction(state: BattleState, rng: Rng): EnemyActionPattern {
  const patterns = patternPool(state);
  if (patterns.length === 0) return defaultPattern(state.enemyDef.name);
  const index = Math.min(patterns.length - 1, Math.floor(clamp01(rng()) * patterns.length));
  return patterns[index]!;
}

/** 現在の HP に応じた行動パターン集合（空ならもう一方へフォールバック）。 */
function patternPool(state: BattleState): EnemyActionPattern[] {
  const { enemy, enemyDef } = state;
  const enraged = enemy.hp <= enemy.maxHp * ENRAGE_RATIO;
  const primary = enraged ? enemyDef.enragedPatterns : enemyDef.normalPatterns;
  const fallback = enraged ? enemyDef.normalPatterns : enemyDef.enragedPatterns;
  return primary.length > 0 ? primary : fallback;
}

/** パターン未定義の敵向けフォールバック行動。 */
function defaultPattern(name: string): EnemyActionPattern {
  return {
    id: 'default',
    message: `${name} の攻撃！`,
    spawn: { count: 4, speed: 0.12, radius: 6, pattern: 'rain', damageMultiplier: 1 },
    dodgeDurationMs: 4000,
  };
}

/**
 * 行動パターンと難易度から初期 Bullet 集合を生成する（Req 9.5, 11.4, 19.2）。
 *
 * 弾数は bulletCountScale、弾速は bulletSpeedScale を乗算する。
 * pattern 種別ごとに出現位置・速度ベクトルを変えて、敵ごとに異なる攻撃にする。
 *
 * variation は「同じ攻撃の少しずらした版」を作るための位相（0=基本形, 1,2,…で
 * ウェーブが進むほどずれる）。落下系は位置をずらし、放射・扇・螺旋は角度を
 * ずらすので、1 ターン内の追加ウェーブが「似ているが避け位置が変わる」攻撃になる。
 */
export function generateBullets(
  pattern: EnemyActionPattern,
  difficulty: DifficultyConfig,
  area: DodgeArea,
  rng: Rng,
  variation = 0
): Bullet[] {
  return generateBulletsFromSpawn(pattern.spawn, pattern.id, difficulty, area, rng, variation);
}

/**
 * 弾生成スペック（BulletSpawnSpec）から Bullet 集合を生成する。
 * 多段攻撃のフェーズ生成にも使う（pattern.spawn 以外の任意 spawn を渡せる）。
 */
export function generateBulletsFromSpawn(
  spawn: BulletSpawnSpec,
  id: string,
  difficulty: DifficultyConfig,
  area: DodgeArea,
  rng: Rng,
  variation = 0
): Bullet[] {
  const count = Math.max(1, Math.round(spawn.count * difficulty.bulletCountScale));
  // 球数に応じて弾速を反比例補正する。球が多いほど遅く（さすがに避けられる
  // ように）、球が少ない/狙い撃ち系ほど速くする。ignoreCountSpeed の弾は補正しない。
  const countSpeedMul = spawn.ignoreCountSpeed
    ? 1
    : clampX(SPEED_REF_COUNT / count, SPEED_COUNT_MIN_MUL, SPEED_COUNT_MAX_MUL);
  const speed = spawn.speed * difficulty.bulletSpeedScale * countSpeedMul;
  const radius = spawn.radius;
  const dmg = spawn.damageMultiplier;

  // ずらし量。落下系は半区画ぶん、角度系は一定角ぶんずらす。
  const v = Math.max(0, variation);
  const posPhase = v * 0.5; // 位置の位相シフト（区画比率）
  const angPhase = v * 0.5; // 角度の位相シフト（rad）
  const frac = (t: number) => t - Math.floor(t); // 小数部（[0,1) へ巻き戻す）

  // ソウルの初期位置（中央やや下）。aimed の狙点に使う。ウェーブごとに少し横へずらす。
  const aimShift = (frac(posPhase) - 0.5) * area.width * 0.5;
  const target = { x: area.width / 2 + aimShift, y: area.height * 0.68 };
  const center = { x: area.width / 2, y: area.height / 2 };
  const spanX = Math.max(0, area.width - radius * 2);
  const spanY = Math.max(0, area.height - radius * 2);

  const bullets: Bullet[] = [];
  const push = (x: number, y: number, vx: number, vy: number, i: number) => {
    bullets.push({
      id: `${id}-w${v}-${i}`,
      pos: { x, y },
      velocity: { x: vx, y: vy },
      radius,
      damageMultiplier: dmg,
      homing: spawn.homing,
      shape: spawn.shape,
      ageMs: 0,
      spriteUrl: spawn.spriteUrl,
      spin: spawn.spin,
    });
  };

  // 衝撃波リング: 中心から広がる 1〜count 重のリング弾を生成する。
  // すき間（開口部）を空け、そこを通れば避けられるようにする。
  if (spawn.pattern === 'shockwave') {
    const gapHalf = 0.62; // すき間の半幅（rad, 約36°→開口約72°）
    for (let i = 0; i < count; i++) {
      // すき間の向きはリングごとに変える（同じ場所に留まれない）。
      const gapAngle = clamp01(rng()) * Math.PI * 2 + i * 1.7;
      bullets.push({
        id: `${id}-w${v}-ring${i}`,
        pos: { x: center.x, y: center.y },
        velocity: { x: 0, y: 0 },
        radius,
        damageMultiplier: dmg,
        ageMs: 0,
        spriteUrl: spawn.spriteUrl,
        ringRadius: radius + i * radius * 2, // 多重リングは間隔をあける
        growRate: speed,
        ringThickness: Math.max(3, radius * 0.6),
        gapAngle,
        gapHalf,
      });
    }
    return bullets;
  }

  for (let i = 0; i < count; i++) {
    const r = clamp01(rng());
    switch (spawn.pattern) {
      case 'rain': {
        // 真下に落ちるだけの簡単な雨をやめ、ソウル付近の帯へ一点集中して
        // 素早く降ってくる収束雨にする（避けるには動く必要がある）。
        const sx = radius + frac(r + posPhase) * spanX;
        const sy = -radius;
        const spread = ((i + 0.5) / count - 0.5) * area.width * 0.36;
        const tx = clampX(target.x + spread, radius, area.width - radius);
        const dx = tx - sx;
        const dy = target.y - sy;
        const len = Math.hypot(dx, dy) || 1;
        const fast = speed * 1.25;
        push(sx, sy, (dx / len) * fast, (dy / len) * fast, i);
        break;
      }
      case 'rainColumns': {
        // 四角の壁。すき間に立つだけで避けられないよう、ソウルへ寄せつつ
        // 素早く落とす（前ウェーブと半区画ずらしてすき間も塞ぐ）。
        const sx = radius + frac((i + 0.5) / count + posPhase / count) * spanX;
        const sy = -radius - clamp01(rng()) * 60;
        const spread = ((i + 0.5) / count - 0.5) * area.width * 0.5;
        const tx = clampX(target.x + spread, radius, area.width - radius);
        const dx = tx - sx;
        const dy = target.y - sy;
        const len = Math.hypot(dx, dy) || 1;
        const fast = speed * 1.12;
        push(sx, sy, (dx / len) * fast, (dy / len) * fast, i);
        break;
      }
      case 'sweepL':
        push(-radius, radius + frac(r + posPhase) * spanY, speed, 0, i);
        break;
      case 'sweepR':
        push(area.width + radius, radius + frac(r + posPhase) * spanY, -speed, 0, i);
        break;
      case 'sides':
        if (i % 2 === 0) push(-radius, radius + frac(r + posPhase) * spanY, speed, 0, i);
        else push(area.width + radius, radius + frac(r + posPhase) * spanY, -speed, 0, i);
        break;
      case 'diagDownR':
        push(frac(r + posPhase) * area.width * 0.6, -radius, speed * 0.6, speed, i);
        break;
      case 'diagDownL':
        push(area.width - frac(r + posPhase) * area.width * 0.6, -radius, -speed * 0.6, speed, i);
        break;
      case 'fan': {
        const t = count > 1 ? i / (count - 1) : 0.5;
        const angle = (-55 + t * 110) * (Math.PI / 180) + angPhase * 0.4;
        push(area.width / 2, -radius, Math.sin(angle) * speed, Math.cos(angle) * speed, i);
        break;
      }
      case 'burst': {
        // 放射。ウェーブごとに半ステップ回転させて角度をずらす。
        const angle = (i / count) * Math.PI * 2 + (angPhase * Math.PI) / count;
        push(center.x, center.y, Math.cos(angle) * speed, Math.sin(angle) * speed, i);
        break;
      }
      case 'spiral': {
        const base = clamp01(rng()) * Math.PI * 2 + angPhase;
        const angle = base + (i / count) * Math.PI * 2;
        push(center.x, center.y, Math.cos(angle) * speed, Math.sin(angle) * speed, i);
        break;
      }
      case 'aimed': {
        const x = radius + frac(r + posPhase) * spanX;
        const y = -radius;
        const dx = target.x - x;
        const dy = target.y - y;
        const len = Math.hypot(dx, dy) || 1;
        push(x, y, (dx / len) * speed, (dy / len) * speed, i);
        break;
      }
      case 'random': {
        const x = radius + frac(r + posPhase) * spanX;
        const y = radius + clamp01(rng()) * spanY * 0.4;
        const dir = clamp01(rng()) * Math.PI * 2 + angPhase;
        push(x, y, Math.cos(dir) * speed, Math.sin(dir) * speed, i);
        break;
      }
      case 'homing': {
        // 上端や左右からソウルへ向けて出現し、その後も追尾する。
        const edge = (i + v) % 3;
        let x: number;
        let y: number;
        if (edge === 0) {
          x = radius + frac(r + posPhase) * spanX;
          y = -radius;
        } else if (edge === 1) {
          x = -radius;
          y = radius + frac(r + posPhase) * spanY * 0.7;
        } else {
          x = area.width + radius;
          y = radius + frac(r + posPhase) * spanY * 0.7;
        }
        const dx = target.x - x;
        const dy = target.y - y;
        const len = Math.hypot(dx, dy) || 1;
        push(x, y, (dx / len) * speed, (dy / len) * speed, i);
        break;
      }
      default:
        push(radius + frac(r + posPhase) * spanX, -radius, 0, speed, i);
    }
  }
  return bullets;
}
