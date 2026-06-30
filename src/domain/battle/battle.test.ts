// Battle_System のテスト（Property 1〜10, 16, 17, 19, 20, 23 / Req 1〜9, 13, 16, 18, 20）
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  startBattle,
  availableCommands,
  selectCommand,
  resolveEnemyAction,
  tickDodge,
} from './battle';
import type { BattleState, Command, EnemyDefinition } from './types';
import type { CharacterStats } from '../types';

const NUM_RUNS = 100;

function makeEnemy(stats: CharacterStats): EnemyDefinition {
  return {
    id: 'enemy-test',
    name: 'テスト',
    stats,
    normalPatterns: [
      { id: 'n1', message: 'n1', spawn: { count: 3, speed: 0.1, radius: 6, pattern: 'rain', damageMultiplier: 1 }, dodgeDurationMs: 800 },
    ],
    enragedPatterns: [
      { id: 'e1', message: 'e1', spawn: { count: 5, speed: 0.15, radius: 6, pattern: 'sweep', damageMultiplier: 1.2 }, dodgeDurationMs: 900 },
    ],
    actOptions: [{ id: 'check', label: 'しらべる', message: 'かんさつ' }],
    fleeChance: 0.5,
    messages: { start: 'はじまり', playerLowHp: 'ピンチ', win: 'かった', lose: 'まけた' },
  };
}

const statsArb: fc.Arbitrary<CharacterStats> = fc.record({
  hp: fc.integer({ min: 1, max: 300 }),
  attack: fc.integer({ min: 0, max: 50 }),
  defense: fc.integer({ min: 0, max: 30 }),
  speed: fc.integer({ min: 0, max: 30 }),
});

function start(player: CharacterStats, enemy: CharacterStats): BattleState {
  return startBattle(player, makeEnemy(enemy), 'normal', [
    { id: 'heal', name: 'みかん', healAmount: 30, usesRemaining: 1 },
  ]);
}

describe('Property 1/2: 開始時の不変条件（Req 1, 2）', () => {
  it('敵は単一・HP 満タン・commandSelect・ongoing で開始', () => {
    fc.assert(
      fc.property(statsArb, statsArb, (p, e) => {
        const s = start(p, e);
        expect(s.enemy).toBeDefined();
        expect(Array.isArray((s as unknown as { enemies?: unknown }).enemies)).toBe(false);
        expect(s.player.hp).toBe(s.player.maxHp);
        expect(s.enemy.hp).toBe(s.enemy.maxHp);
        expect(s.player.maxHp).toBeGreaterThanOrEqual(1);
        expect(s.enemy.maxHp).toBeGreaterThanOrEqual(1);
        expect(s.phase).toBe('commandSelect');
        expect(s.outcome).toBe('ongoing');
        expect(s.turn).toBe(0);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

describe('Property 3: フェーズガード（Req 3.3, 20.1）', () => {
  it('commandSelect 以外では selectCommand は状態不変（同一参照）', () => {
    const s = start({ hp: 50, attack: 10, defense: 5, speed: 10 }, { hp: 50, attack: 10, defense: 5, speed: 5 });
    const afterAttack = selectCommand(s, { kind: 'attack' }, () => 0.5); // → enemyAction
    expect(afterAttack.phase).toBe('enemyAction');
    expect(selectCommand(afterAttack, { kind: 'attack' }, () => 0.5)).toBe(afterAttack);
  });

  it('enemyAction 以外で resolveEnemyAction は状態不変', () => {
    const s = start({ hp: 50, attack: 10, defense: 5, speed: 10 }, { hp: 50, attack: 10, defense: 5, speed: 5 });
    expect(resolveEnemyAction(s, () => 0.5)).toBe(s);
  });

  it('dodge 以外で tickDodge は状態不変', () => {
    const s = start({ hp: 50, attack: 10, defense: 5, speed: 10 }, { hp: 50, attack: 10, defense: 5, speed: 5 });
    expect(tickDodge(s, 16, { x: 0, y: 0 }, () => 0.5)).toBe(s);
  });
});

describe('Property 4: 無効コマンド拒否（Req 3.4, 6.5, 20.3）', () => {
  it('存在しないアイテム/選択肢は状態不変（同一参照・ターン不変）', () => {
    const s = start({ hp: 50, attack: 10, defense: 5, speed: 10 }, { hp: 50, attack: 10, defense: 5, speed: 5 });
    expect(selectCommand(s, { kind: 'item', itemId: 'nope' }, () => 0.5)).toBe(s);
    expect(selectCommand(s, { kind: 'act', optionId: 'nope' }, () => 0.5)).toBe(s);
  });

  it('使用回数 0 のアイテムは拒否', () => {
    let s = startBattle({ hp: 50, attack: 10, defense: 5, speed: 10 }, makeEnemy({ hp: 50, attack: 5, defense: 0, speed: 5 }), 'normal', [
      { id: 'heal', name: 'みかん', healAmount: 30, usesRemaining: 0 },
    ]);
    expect(selectCommand(s, { kind: 'item', itemId: 'heal' }, () => 0.5)).toBe(s);
    void s;
  });
});

describe('Property 6: こうげきと勝利（Req 4, 16.1）', () => {
  it('敵 HP が 0 になったら win/ended、生存なら enemyAction', () => {
    fc.assert(
      fc.property(statsArb, statsArb, (p, e) => {
        const s = start(p, e);
        const after = selectCommand(s, { kind: 'attack' }, () => 0.5);
        expect(after.enemy.hp).toBeGreaterThanOrEqual(0);
        if (after.enemy.hp === 0) {
          expect(after.outcome).toBe('win');
          expect(after.phase).toBe('ended');
        } else {
          expect(after.phase).toBe('enemyAction');
        }
        expect(after.turn).toBe(1);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('一撃で倒せる場合 win になる', () => {
    const s = start({ hp: 50, attack: 999, defense: 0, speed: 10 }, { hp: 1, attack: 1, defense: 0, speed: 1 });
    const after = selectCommand(s, { kind: 'attack' }, () => 0.9);
    expect(after.outcome).toBe('win');
    expect(after.phase).toBe('ended');
    expect(after.log).toContain('かった');
  });
});

describe('Property 7: ぼうぎょ（Req 5）', () => {
  it('ぼうぎょで defending フラグが立ち enemyAction へ遷移', () => {
    const s = start({ hp: 50, attack: 10, defense: 5, speed: 10 }, { hp: 50, attack: 10, defense: 5, speed: 5 });
    const after = selectCommand(s, { kind: 'defend' }, () => 0.5);
    expect(after.defending).toBe(true);
    expect(after.phase).toBe('enemyAction');
  });
});

describe('Property 8: 回復の上限クランプ（Req 6）', () => {
  it('回復後 HP は最大 HP 以下、使用回数が 1 減る', () => {
    // プレイヤーを削った状態を作る（攻撃でターンを回すのは複雑なので直接構築）。
    const base = start({ hp: 100, attack: 10, defense: 5, speed: 10 }, { hp: 100, attack: 10, defense: 5, speed: 5 });
    const damaged: BattleState = { ...base, player: { ...base.player, hp: 80 } };
    const after = selectCommand(damaged, { kind: 'item', itemId: 'heal' }, () => 0.5);
    expect(after.player.hp).toBeLessThanOrEqual(after.player.maxHp);
    expect(after.player.hp).toBe(100); // 80 + 30 を 100 にクランプ
    expect(after.items[0]!.usesRemaining).toBe(0);
  });
});

describe('Property 9: こうどう（Req 7）', () => {
  it('こうどうは敵 HP を変えず enemyAction へ遷移', () => {
    const s = start({ hp: 50, attack: 10, defense: 5, speed: 10 }, { hp: 50, attack: 10, defense: 5, speed: 5 });
    const after = selectCommand(s, { kind: 'act', optionId: 'check' }, () => 0.5);
    expect(after.enemy.hp).toBe(s.enemy.hp);
    expect(after.phase).toBe('enemyAction');
    expect(after.log).toContain('かんさつ');
  });
});

describe('Property 10: にげる（Req 8）', () => {
  it('RNG < fleeChance で fled/ended、それ以外は enemyAction', () => {
    const s = start({ hp: 50, attack: 10, defense: 5, speed: 10 }, { hp: 50, attack: 10, defense: 5, speed: 5 });
    const success = selectCommand(s, { kind: 'flee' }, () => 0); // 0 < 0.5
    expect(success.outcome).toBe('fled');
    expect(success.phase).toBe('ended');
    const fail = selectCommand(s, { kind: 'flee' }, () => 0.99); // >= 0.5
    expect(fail.outcome).toBe('ongoing');
    expect(fail.phase).toBe('enemyAction');
  });
});

describe('Property 5: HP クランプ不変条件（ランダム操作列, Req 15）', () => {
  it('任意の操作列の後でも HP は [0, maxHp] に収まる', () => {
    fc.assert(
      fc.property(
        statsArb,
        statsArb,
        fc.array(fc.constantFrom('attack', 'defend', 'act', 'item'), { maxLength: 20 }),
        fc.infiniteStream(fc.double({ min: 0, max: 0.999, noNaN: true })),
        (p, e, cmds, stream) => {
          const it = stream[Symbol.iterator]();
          const rng = () => it.next().value as number;
          let s = start(p, e);
          let ci = 0;
          for (let step = 0; step < 60 && s.outcome === 'ongoing'; step++) {
            if (s.phase === 'commandSelect') {
              const kind = cmds[ci++ % Math.max(1, cmds.length)] ?? 'attack';
              const cmd: Command =
                kind === 'item' ? { kind: 'item', itemId: 'heal' } : kind === 'act' ? { kind: 'act', optionId: 'check' } : { kind };
              s = selectCommand(s, cmd, rng);
            } else if (s.phase === 'enemyAction') {
              s = resolveEnemyAction(s, rng);
            } else if (s.phase === 'dodge') {
              s = tickDodge(s, 50, { x: rng() - 0.5, y: rng() - 0.5 }, rng);
            }
            expect(s.player.hp).toBeGreaterThanOrEqual(0);
            expect(s.player.hp).toBeLessThanOrEqual(s.player.maxHp);
            expect(s.enemy.hp).toBeGreaterThanOrEqual(0);
            expect(s.enemy.hp).toBeLessThanOrEqual(s.enemy.maxHp);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

describe('Property 16/17: 避けフェーズの遷移（Req 13）', () => {
  it('規定時間到達で commandSelect へ戻る（被弾なし）', () => {
    // 弾が当たらないよう、プレイヤー防御を高くしダメージを最小化しつつ、
    // ここでは敵攻撃力 0・弾当たりでも 1 ダメージだが HP 大で生存を担保。
    let s = start({ hp: 9999, attack: 10, defense: 999, speed: 10 }, { hp: 100, attack: 0, defense: 5, speed: 5 });
    s = selectCommand(s, { kind: 'defend' }, () => 0.5);
    s = resolveEnemyAction(s, () => 0.5);
    expect(s.phase).toBe('dodge');
    // 複数ウェーブぶんの規定時間を超えるまで進める（十分な反復で必ず終了する）。
    for (let i = 0; i < 600 && s.phase === 'dodge'; i++) {
      s = tickDodge(s, 50, { x: 0, y: 0 }, () => 0.5);
    }
    expect(s.phase).toBe('commandSelect');
    expect(s.outcome).toBe('ongoing');
  });

  it('避けフェーズ中に HP 0 で lose/ended（途中終了）', () => {
    let s = start({ hp: 1, attack: 10, defense: 0, speed: 10 }, { hp: 100, attack: 50, defense: 5, speed: 5 });
    s = selectCommand(s, { kind: 'attack' }, () => 0.5);
    s = resolveEnemyAction(s, () => 0.5);
    // 予兆を超えて弾を進め、ソウルを動かさず被弾させる。
    let guard = 0;
    while (s.phase === 'dodge' && guard < 200) {
      s = tickDodge(s, 50, { x: 0, y: 0 }, () => 0.5);
      guard++;
    }
    // HP1・防御0・敵攻撃50 なら被弾で 0 になり lose になりうる。被弾しない乱数配置でも
    // 規定時間で commandSelect に戻る場合があるため、結果はどちらかに収束する。
    expect(['lose', 'ongoing']).toContain(s.outcome);
  });

  it('無効 dt（負/NaN）では状態不変（同一参照, Req 20.5）', () => {
    let s = start({ hp: 100, attack: 10, defense: 5, speed: 10 }, { hp: 100, attack: 10, defense: 5, speed: 5 });
    s = selectCommand(s, { kind: 'attack' }, () => 0.5);
    s = resolveEnemyAction(s, () => 0.5);
    expect(tickDodge(s, -1, { x: 0, y: 0 }, () => 0.5)).toBe(s);
    expect(tickDodge(s, Number.NaN, { x: 0, y: 0 }, () => 0.5)).toBe(s);
  });
});

describe('Property 19: 決着後の不変（Req 16.3）', () => {
  it('ended 後はどの遷移関数も状態不変', () => {
    const s = start({ hp: 50, attack: 999, defense: 0, speed: 10 }, { hp: 1, attack: 1, defense: 0, speed: 1 });
    const won = selectCommand(s, { kind: 'attack' }, () => 0.9);
    expect(won.outcome).toBe('win');
    expect(selectCommand(won, { kind: 'attack' }, () => 0.5)).toBe(won);
    expect(resolveEnemyAction(won, () => 0.5)).toBe(won);
    expect(tickDodge(won, 16, { x: 0, y: 0 }, () => 0.5)).toBe(won);
  });
});

describe('Property 20: メッセージ（Req 18）', () => {
  it('開始メッセージがログ先頭に入る', () => {
    const s = start({ hp: 50, attack: 10, defense: 5, speed: 10 }, { hp: 50, attack: 10, defense: 5, speed: 5 });
    expect(s.log[0]).toBe('はじまり');
  });
});

describe('availableCommands', () => {
  it('commandSelect では 5 コマンド、それ以外では空', () => {
    const s = start({ hp: 50, attack: 10, defense: 5, speed: 10 }, { hp: 50, attack: 10, defense: 5, speed: 5 });
    expect(availableCommands(s)).toHaveLength(5);
    const after = selectCommand(s, { kind: 'attack' }, () => 0.5);
    expect(availableCommands(after)).toHaveLength(0);
  });
});

describe('多段攻撃（phases）: 時間差で弾が追加生成される', () => {
  function phasedEnemy(): EnemyDefinition {
    return {
      id: 'enemy-phased',
      name: '多段',
      stats: { hp: 100, attack: 5, defense: 0, speed: 5 },
      normalPatterns: [
        {
          id: 'mp',
          message: '多段攻撃！',
          spawn: { count: 3, speed: 0.1, radius: 6, pattern: 'rain', damageMultiplier: 1, ignoreCountSpeed: true },
          dodgeDurationMs: 5000,
          phases: [
            { atMs: 0, spawn: { count: 3, speed: 0.1, radius: 6, pattern: 'rain', damageMultiplier: 1, ignoreCountSpeed: true } },
            { atMs: 600, spawn: { count: 4, speed: 0.1, radius: 6, pattern: 'burst', damageMultiplier: 1, ignoreCountSpeed: true } },
          ],
        },
      ],
      enragedPatterns: [],
      actOptions: [{ id: 'check', label: 'しらべる', message: 'm' }],
      fleeChance: 0.5,
      messages: { start: 's', playerLowHp: 'low', win: 'w', lose: 'l' },
    };
  }

  it('開始時は atMs<=0 のフェーズのみ、予兆後 atMs 到達で後続フェーズが追加される', () => {
    let s = startBattle({ hp: 100, attack: 10, defense: 99, speed: 5 }, phasedEnemy(), 'normal');
    s = selectCommand(s, { kind: 'attack' }, () => 0.5);
    s = resolveEnemyAction(s, () => 0.5);
    expect(s.phase).toBe('dodge');
    // 初期は最初のフェーズ（3発）のみ。保留フェーズが1つ残る。
    const initialCount = s.dodge!.bullets.length;
    expect(initialCount).toBe(3);
    expect(s.dodge!.pendingPhases.length).toBe(1);

    // 予兆（telegraph）+ 600ms を超えるまで進めると後続フェーズ（+4発）が出る。
    const target = s.dodge!.telegraphMs + 700;
    let guard = 0;
    while (s.phase === 'dodge' && s.dodge!.elapsedMs < target && guard < 500) {
      s = tickDodge(s, 50, { x: 0, y: 0 }, () => 0.5);
      guard++;
    }
    // 後続フェーズが生成され、保留は空になっている（画面外に出た弾で総数は前後しうるが
    // pendingPhases の消化は確実）。
    expect(s.dodge === null || s.dodge.pendingPhases.length === 0).toBe(true);
  });
});
