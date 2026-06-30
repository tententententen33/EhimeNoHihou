// Dodge_Engine のテスト（Property 12, 13, 14, 15 / Req 10, 11, 12）
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { moveSoul, advanceBullets, detectHit } from './dodge';
import type { Bullet, DodgeArea, Soul } from './types';

const NUM_RUNS = 100;
const area: DodgeArea = { width: 320, height: 200 };

const soulArb: fc.Arbitrary<Soul> = fc.record({
  pos: fc.record({
    x: fc.double({ min: 8, max: 312, noNaN: true }),
    y: fc.double({ min: 8, max: 192, noNaN: true }),
  }),
  radius: fc.constant(8),
});

const dirArb = fc.constantFrom(
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 }
);

describe('Property 12: ソウルの境界内不変条件（Req 10）', () => {
  it('移動後のソウルは常にエリア内（半径考慮）に収まる', () => {
    fc.assert(
      fc.property(soulArb, dirArb, fc.double({ min: 0, max: 500, noNaN: true }), (soul, dir, dt) => {
        const moved = moveSoul(soul, dir, 0.3, dt, area);
        expect(moved.pos.x).toBeGreaterThanOrEqual(soul.radius);
        expect(moved.pos.x).toBeLessThanOrEqual(area.width - soul.radius);
        expect(moved.pos.y).toBeGreaterThanOrEqual(soul.radius);
        expect(moved.pos.y).toBeLessThanOrEqual(area.height - soul.radius);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('無入力・dt0 では位置不変（同一参照）', () => {
    const soul: Soul = { pos: { x: 100, y: 100 }, radius: 8 };
    expect(moveSoul(soul, { x: 0, y: 0 }, 0.3, 16, area)).toBe(soul);
    expect(moveSoul(soul, { x: 1, y: 0 }, 0.3, 0, area)).toBe(soul);
  });

  it('クランプ前の移動距離は soulSpeed * dt（中央・小さな dt）', () => {
    const soul: Soul = { pos: { x: 160, y: 100 }, radius: 8 };
    const moved = moveSoul(soul, { x: 1, y: 0 }, 0.3, 10, area);
    expect(moved.pos.x).toBeCloseTo(160 + 0.3 * 10, 6);
  });
});

describe('Property 13/14: 弾の移動と画面外除去（Req 11）', () => {
  const bulletArb: fc.Arbitrary<Bullet> = fc.record({
    id: fc.string({ minLength: 1, maxLength: 4 }),
    pos: fc.record({
      x: fc.double({ min: 20, max: 300, noNaN: true }),
      y: fc.double({ min: 20, max: 180, noNaN: true }),
    }),
    velocity: fc.record({
      x: fc.double({ min: -0.2, max: 0.2, noNaN: true }),
      y: fc.double({ min: -0.2, max: 0.2, noNaN: true }),
    }),
    radius: fc.constant(6),
    damageMultiplier: fc.constant(1),
  });

  it('アクティブ弾数は単調非増加（Req 11.2）', () => {
    fc.assert(
      fc.property(fc.array(bulletArb, { maxLength: 12 }), fc.double({ min: 1, max: 50, noNaN: true }), (bullets, dt) => {
        const next = advanceBullets(bullets, dt, area);
        expect(next.length).toBeLessThanOrEqual(bullets.length);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('合流性: dt 分割適用と一括適用で位置が一致（画面内のまま）', () => {
    // エリア中央付近・低速で画面外除去が起きない条件にする。
    const b: Bullet = { id: 'b', pos: { x: 160, y: 100 }, velocity: { x: 0.05, y: 0.03 }, radius: 6, damageMultiplier: 1 };
    const dt = 20;
    const once = advanceBullets([b], dt, area);
    const twice = advanceBullets(advanceBullets([b], dt / 2, area), dt / 2, area);
    expect(once[0]!.pos.x).toBeCloseTo(twice[0]!.pos.x, 6);
    expect(once[0]!.pos.y).toBeCloseTo(twice[0]!.pos.y, 6);
  });

  it('移動量は velocity * dt', () => {
    const b: Bullet = { id: 'b', pos: { x: 100, y: 100 }, velocity: { x: 0.1, y: -0.05 }, radius: 6, damageMultiplier: 1 };
    const next = advanceBullets([b], 10, area)[0]!;
    expect(next.pos.x).toBeCloseTo(100 + 0.1 * 10, 6);
    expect(next.pos.y).toBeCloseTo(100 - 0.05 * 10, 6);
  });

  it('無効 dt では弾集合を変更しない（同一参照, Req 20.5）', () => {
    const bullets: Bullet[] = [{ id: 'b', pos: { x: 100, y: 100 }, velocity: { x: 0.1, y: 0 }, radius: 6, damageMultiplier: 1 }];
    expect(advanceBullets(bullets, 0, area)).toBe(bullets);
    expect(advanceBullets(bullets, -5, area)).toBe(bullets);
    expect(advanceBullets(bullets, Number.NaN, area)).toBe(bullets);
  });
});

describe('Property 15: 当たり判定の幾何（Req 12.1）', () => {
  it('中心間距離 <= 半径和のとき true、それ以外で false', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 320, noNaN: true }),
        fc.double({ min: 0, max: 200, noNaN: true }),
        fc.double({ min: 0, max: 320, noNaN: true }),
        fc.double({ min: 0, max: 200, noNaN: true }),
        (sx, sy, bx, by) => {
          const soul: Soul = { pos: { x: sx, y: sy }, radius: 8 };
          const bullet: Bullet = { id: 'b', pos: { x: bx, y: by }, velocity: { x: 0, y: 0 }, radius: 6, damageMultiplier: 1 };
          const dist2 = (sx - bx) ** 2 + (sy - by) ** 2;
          const rs = 14;
          expect(detectHit(soul, [bullet])).toBe(dist2 <= rs * rs);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it('弾が無ければ被弾なし', () => {
    expect(detectHit({ pos: { x: 0, y: 0 }, radius: 8 }, [])).toBe(false);
  });
});
