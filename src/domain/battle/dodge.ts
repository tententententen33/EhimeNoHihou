// Dodge_Engine: 避けフェーズのリアルタイム処理を純粋関数で表現（Req 10, 11, 12）
//
// すべて「経過時間 dtMs を引数に取る純粋関数」。アニメーションループ・入力・描画は
// UI（Battle_View）が担い、本モジュールは判定のみを行う。

import type { Bullet, DodgeArea, Soul, Vec2 } from './types';
import { HOMING_DURATION_MS, MAX_BULLET_LIFETIME_MS } from './types';

/** dtMs が有効（有限かつ正）かどうか。 */
function validDt(dtMs: number): boolean {
  return Number.isFinite(dtMs) && dtMs > 0;
}

/** 値を [min, max] にクランプする。 */
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * ソウルを移動する（Req 10.1〜10.4）。
 *
 * 移動量は soulSpeed * dtMs * inputDir。位置は当たり判定半径を考慮してエリア
 * 内（[radius, size-radius]）へクランプする。dtMs が無効（0 以下/非有限）または
 * 無入力（{0,0}）の場合は位置を変えない（同一 Soul を返す）。
 */
export function moveSoul(
  soul: Soul,
  inputDir: Vec2,
  soulSpeed: number,
  dtMs: number,
  area: DodgeArea
): Soul {
  if (!validDt(dtMs)) return soul;
  if (inputDir.x === 0 && inputDir.y === 0) return soul;

  const nx = soul.pos.x + inputDir.x * soulSpeed * dtMs;
  const ny = soul.pos.y + inputDir.y * soulSpeed * dtMs;

  // エリア幅が直径未満の場合でも破綻しないように max を取る。
  const maxX = Math.max(soul.radius, area.width - soul.radius);
  const maxY = Math.max(soul.radius, area.height - soul.radius);

  return {
    ...soul,
    pos: {
      x: clamp(nx, soul.radius, maxX),
      y: clamp(ny, soul.radius, maxY),
    },
  };
}

/**
 * 弾を移動し、エリア外へ完全に出た弾を除外する（Req 11.1, 11.2, 11.3）。
 *
 * 各弾の移動量は velocity * dtMs。homing>0 の弾は target（ソウル位置）へ
 * 速度の向きを徐々に向ける（速さの大きさは維持）。dtMs が無効なら弾集合を
 * そのまま返す。target 未指定なら追尾しない（純粋直進）。
 */
export function advanceBullets(bullets: Bullet[], dtMs: number, area: DodgeArea, target?: Vec2): Bullet[] {
  if (!validDt(dtMs)) return bullets;

  const result: Bullet[] = [];
  for (const b of bullets) {
    const age = (b.ageMs ?? 0) + dtMs;

    // 衝撃波リング: 中心は固定で半径だけ拡大する。画面を覆い尽くしたら除去。
    if (b.ringRadius !== undefined) {
      const grow = b.growRate ?? 0;
      const ringRadius = b.ringRadius + grow * dtMs;
      const maxR = Math.hypot(area.width, area.height) * 0.75;
      if (ringRadius > maxR || age > MAX_BULLET_LIFETIME_MS) continue;
      result.push({ ...b, ageMs: age, ringRadius });
      continue;
    }

    let vx = b.velocity.x;
    let vy = b.velocity.y;

    // 追尾は一定時間だけ、かつ時間とともに弱める。これで一度カーブして
    // ソウル付近を通り過ぎ、その後は直進して画面外へ抜ける（留まらない）。
    if (b.homing && b.homing > 0 && target && age <= HOMING_DURATION_MS) {
      const speed = Math.hypot(vx, vy) || 0.0001;
      const dx = target.x - b.pos.x;
      const dy = target.y - b.pos.y;
      const dlen = Math.hypot(dx, dy) || 1;
      const desiredX = (dx / dlen) * speed;
      const desiredY = (dy / dlen) * speed;
      // 経過とともに 1→0 へ減衰させ、終盤はほぼ直進にする。
      const decay = 1 - age / HOMING_DURATION_MS;
      const k = Math.min(1, (b.homing * decay * dtMs) / 1000);
      let nx = vx + (desiredX - vx) * k;
      let ny = vy + (desiredY - vy) * k;
      // 速さの大きさを維持する。
      const nlen = Math.hypot(nx, ny) || 0.0001;
      nx = (nx / nlen) * speed;
      ny = (ny / nlen) * speed;
      vx = nx;
      vy = ny;
    }

    const next: Bullet = {
      ...b,
      ageMs: age,
      velocity: { x: vx, y: vy },
      pos: { x: b.pos.x + vx * dtMs, y: b.pos.y + vy * dtMs },
    };
    const out =
      next.pos.x + next.radius < 0 ||
      next.pos.x - next.radius > area.width ||
      next.pos.y + next.radius < 0 ||
      next.pos.y - next.radius > area.height ||
      age > MAX_BULLET_LIFETIME_MS;
    if (!out) {
      result.push(next);
    }
  }
  return result;
}

/**
 * ソウルといずれかの弾が当たっているかを判定する（Req 12.1）。
 *
 * 2 円の中心間距離が半径和以下のとき被弾とみなす。
 */
export function detectHit(soul: Soul, bullets: Bullet[]): boolean {
  for (const b of bullets) {
    const dx = soul.pos.x - b.pos.x;
    const dy = soul.pos.y - b.pos.y;
    // リング弾: ソウルがリングの帯（半径±太さ）に重なったら被弾。
    // ただし、すき間（開口部）の角度内ならすり抜けられる。
    if (b.ringRadius !== undefined) {
      const dist = Math.hypot(dx, dy);
      const band = soul.radius + (b.ringThickness ?? 4);
      if (Math.abs(dist - b.ringRadius) <= band) {
        if (b.gapHalf !== undefined && b.gapAngle !== undefined) {
          // ソウル方向の角度がすき間内なら安全。
          const ang = Math.atan2(soul.pos.y - b.pos.y, soul.pos.x - b.pos.x);
          let diff = Math.abs(ang - b.gapAngle) % (Math.PI * 2);
          if (diff > Math.PI) diff = Math.PI * 2 - diff;
          // すき間の角半幅は半径に応じて確保（ソウルが通れる最小角を保証）。
          const minHalf = Math.min(Math.PI / 2, (soul.radius + 4) / Math.max(1, b.ringRadius));
          const half = Math.max(b.gapHalf, minHalf);
          if (diff <= half) {
            continue; // すき間を通過中＝被弾しない
          }
        }
        return true;
      }
      continue;
    }
    const rs = soul.radius + b.radius;
    if (dx * dx + dy * dy <= rs * rs) {
      return true;
    }
  }
  return false;
}
