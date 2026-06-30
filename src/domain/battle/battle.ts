// Battle_System: バトル全体の状態機械（Req 2, 3, 9, 10〜13, 16, 18, 20）
//
// startBattle / availableCommands / selectCommand / resolveEnemyAction / tickDodge
// を提供する純粋関数群。各遷移関数は許可された Phase でのみ作用し、それ以外では
// 状態を変更しない（フェーズガード）。乱数は注入 Rng で評価する。

import type {
  BattleState,
  BattleItem,
  Command,
  Combatant,
  DifficultyConfig,
  DifficultyId,
  EnemyDefinition,
  PendingPhase,
  Rng,
} from './types';
import type { CharacterStats } from '../types';
import {
  DEFAULT_DODGE_AREA,
  INVINCIBILITY_MS,
  LOW_HP_RATIO,
  MAX_DT_MS,
  SOUL_RADIUS,
  SOUL_SPEED_PER_SPEED,
  SOUL_SPEED_MAX_BONUS,
  WAVE_INTERVAL_MS,
  WAVES_PER_TURN,
  WAVE_TAIL_MS,
  WAVE_SPEED_ESCALATION,
  WAVE_COUNT_ESCALATION,
  type Vec2,
} from './types';
import { getDifficulty } from './difficulty';
import { computeDamage } from './damage';
import {
  resolveAttack,
  resolveDefend,
  resolveItem,
  resolveAct,
  resolveFlee,
  defendMitigation,
} from './command';
import { selectEnemyAction, generateBullets, generateBulletsFromSpawn } from './enemyAI';
import { moveSoul, advanceBullets, detectHit } from './dodge';

/** CharacterStats を満タン HP の Combatant に変換する（HP は最低 1）。 */
function toCombatant(stats: CharacterStats): Combatant {
  const maxHp = Math.max(1, Math.round(stats.hp));
  return {
    maxHp,
    hp: maxHp,
    attack: Math.max(0, Math.round(stats.attack)),
    defense: Math.max(0, Math.round(stats.defense)),
    speed: Math.max(0, Math.round(stats.speed)),
  };
}

/**
 * バトルを開始する（Req 2）。
 * プレイヤー合計ステータス・敵定義・難易度から初期 BattleState を生成する。
 * HP=maxHp、Phase=commandSelect、Outcome=ongoing、開始メッセージをログに付与。
 */
export function startBattle(
  playerStats: CharacterStats,
  enemyDef: EnemyDefinition,
  difficulty: DifficultyId,
  items: BattleItem[] = []
): BattleState {
  return {
    phase: 'commandSelect',
    outcome: 'ongoing',
    turn: 0,
    player: toCombatant(playerStats),
    enemy: toCombatant(enemyDef.stats),
    enemyDef,
    difficulty,
    defending: false,
    items: items.map((it) => ({ ...it })),
    dodge: null,
    currentPattern: null,
    log: [enemyDef.messages.start],
    lowHpNotified: false,
  };
}

/** 現在選択可能なコマンド種別を返す（commandSelect のときのみ非空, Req 3.1）。 */
export function availableCommands(state: BattleState): Command['kind'][] {
  if (state.phase !== 'commandSelect' || state.outcome !== 'ongoing') return [];
  return ['attack', 'defend', 'item', 'act', 'flee'];
}

/** 「ひっさつ」などはなし。必殺可否のような補助は将来拡張。 */

/**
 * コマンドを選択・解決する（Req 3, 4, 5, 6, 7, 8）。
 * commandSelect 以外・決着後・無効コマンドでは状態不変（Req 3.3, 3.4, 20.1, 20.3）。
 * 有効なコマンドが解決されたらターン数を 1 加算する。
 */
export function selectCommand(state: BattleState, command: Command, rng: Rng): BattleState {
  if (state.phase !== 'commandSelect' || state.outcome !== 'ongoing') {
    return state;
  }

  const next = dispatchCommand(state, command, rng);
  // 無効コマンド（同一参照）はターンを消費しない（Req 3.4, 20.3）。
  if (next === state) {
    return state;
  }
  return { ...next, turn: state.turn + 1 };
}

function dispatchCommand(state: BattleState, command: Command, rng: Rng): BattleState {
  switch (command.kind) {
    case 'attack':
      return resolveAttack(state, rng, command.hit ?? true);
    case 'defend':
      return resolveDefend(state);
    case 'item':
      return resolveItem(state, command.itemId);
    case 'act':
      return resolveAct(state, command.optionId);
    case 'flee':
      return resolveFlee(state, rng);
    default:
      // 未定義コマンドは拒否（状態不変）。
      return state;
  }
}

/**
 * 敵行動を解決する（Req 9）。
 * Enemy_AI が行動を選び、弾を生成して避けフェーズ（dodge）へ遷移する。
 * enemyAction 以外・決着後では状態不変。
 */
export function resolveEnemyAction(state: BattleState, rng: Rng): BattleState {
  if (state.phase !== 'enemyAction' || state.outcome !== 'ongoing') {
    return state;
  }

  const pattern = selectEnemyAction(state, rng);
  const config = getDifficulty(state.difficulty);
  const area = DEFAULT_DODGE_AREA;

  let bullets: ReturnType<typeof generateBullets>;
  let durationMs: number;
  let pendingPhases: PendingPhase[];
  let wavesRemaining: number;
  let nextWaveMs: number;

  if (pattern.phases && pattern.phases.length > 0) {
    // 多段攻撃: フェーズを時刻順に並べ、atMs<=0 は即時生成、それ以外は保留。
    const sorted = [...pattern.phases].sort((a, b) => a.atMs - b.atMs);
    bullets = [];
    const pending: PendingPhase[] = [];
    for (const ph of sorted) {
      if (ph.atMs <= 0) {
        bullets = [...bullets, ...generateBulletsFromSpawn(ph.spawn, pattern.id, config, area, rng)];
      } else {
        pending.push({ atMs: ph.atMs, spawn: ph.spawn, id: pattern.id });
      }
    }
    const maxAt = sorted.reduce((m, p) => Math.max(m, p.atMs), 0);
    durationMs = config.telegraphMs + maxAt + WAVE_TAIL_MS;
    pendingPhases = pending;
    wavesRemaining = 0;
    nextWaveMs = Number.POSITIVE_INFINITY;
  } else {
    // 通常: 単一パターンを 1 ターンで複数ウェーブ繰り返す（約2.5回ぶん）。
    bullets = generateBullets(pattern, config, area, rng);
    const activeMs = WAVE_INTERVAL_MS * (WAVES_PER_TURN - 1) + WAVE_TAIL_MS;
    durationMs = config.telegraphMs + activeMs;
    pendingPhases = [];
    wavesRemaining = WAVES_PER_TURN - 1;
    nextWaveMs = config.telegraphMs + WAVE_INTERVAL_MS;
  }

  return {
    ...state,
    phase: 'dodge',
    currentPattern: pattern,
    log: [...state.log, pattern.message],
    dodge: {
      area,
      soul: { pos: { x: area.width / 2, y: area.height * 0.68 }, radius: SOUL_RADIUS },
      bullets,
      elapsedMs: 0,
      durationMs,
      telegraphMs: config.telegraphMs,
      invincibleUntilMs: 0,
      wavesRemaining,
      nextWaveMs,
      waveIntervalMs: WAVE_INTERVAL_MS,
      waveIndex: 1,
      pendingPhases,
    },
  };
}

/** dtMs を有効な経過時間へ正規化する（負/非有限は 0、過大は上限クランプ, Req 20.4, 20.5）。 */
function sanitizeDt(dtMs: number): number {
  if (!Number.isFinite(dtMs) || dtMs <= 0) return 0;
  return Math.min(dtMs, MAX_DT_MS);
}

/**
 * 避けフェーズを dtMs ぶん進める（Req 10, 11, 12, 13）。
 * - dodge 以外・決着後では状態不変。
 * - dtMs が無効なら経過時間 0 として状態不変（Req 20.5）。
 * - ソウル移動・弾移動（予兆後）・被弾検出・無敵中無効・被ダメージ（難易度係数
 *   ＋ぼうぎょ軽減）・HP クランプ・無敵更新・HP低下メッセージ・終了判定を行う。
 */
export function tickDodge(
  state: BattleState,
  dtMs: number,
  inputDir: Vec2,
  rng: Rng
): BattleState {
  if (state.phase !== 'dodge' || state.outcome !== 'ongoing' || state.dodge === null) {
    return state;
  }
  const dt = sanitizeDt(dtMs);
  if (dt === 0) {
    return state;
  }

  const dodge = state.dodge;
  const config = getDifficulty(state.difficulty);
  const newElapsed = dodge.elapsedMs + dt;

  // ソウルは常に動かせる（予兆中も回避位置を整えられる）。
  // 素早さが上がる装備ほどソウルが速く動ける（最大 +SOUL_SPEED_MAX_BONUS）。
  const speedBonus = Math.min(state.player.speed * SOUL_SPEED_PER_SPEED, SOUL_SPEED_MAX_BONUS);
  const soulSpeed = config.soulSpeed * (1 + speedBonus);
  const soul = moveSoul(dodge.soul, inputDir, soulSpeed, dt, dodge.area);

  // 弾は予兆時間を過ぎてから動き始める。homing 弾はソウルを追尾する。
  const telegraphPassed = dodge.elapsedMs >= dodge.telegraphMs;
  let bullets = telegraphPassed ? advanceBullets(dodge.bullets, dt, dodge.area, soul.pos) : dodge.bullets;

  // 追加ウェーブの再出現（1 ターンで攻撃を複数回繰り返す）。
  // 同じ攻撃の「少しずらした版」を出す。位置や角度がウェーブごとにずれ、さらに
  // 弾速・弾数も少しずつ上がるので、最初に避けた場所に留まるだけでは避けられない。
  let wavesRemaining = dodge.wavesRemaining;
  let nextWaveMs = dodge.nextWaveMs;
  let waveIndex = dodge.waveIndex;
  while (wavesRemaining > 0 && newElapsed >= nextWaveMs && state.currentPattern) {
    waveIndex += 1;
    const waveConfig = escalateConfig(config, waveIndex);
    bullets = [
      ...bullets,
      ...generateBullets(state.currentPattern, waveConfig, dodge.area, rng, waveIndex - 1),
    ];
    wavesRemaining -= 1;
    nextWaveMs += dodge.waveIntervalMs;
  }

  // 多段攻撃の保留フェーズ: 予兆後の経過時間が atMs に達したフェーズを順に生成する。
  let pendingPhases = dodge.pendingPhases;
  if (pendingPhases.length > 0) {
    const activeMs = newElapsed - dodge.telegraphMs;
    let spawnCount = 0;
    while (spawnCount < pendingPhases.length && activeMs >= pendingPhases[spawnCount]!.atMs) {
      const ph = pendingPhases[spawnCount]!;
      bullets = [...bullets, ...generateBulletsFromSpawn(ph.spawn, ph.id, config, dodge.area, rng)];
      spawnCount += 1;
    }
    if (spawnCount > 0) {
      pendingPhases = pendingPhases.slice(spawnCount);
    }
  }

  let player = state.player;
  let defending = state.defending;
  let invincibleUntilMs = dodge.invincibleUntilMs;
  let log = state.log;
  let lowHpNotified = state.lowHpNotified;

  // 被弾判定（無敵中は無効, Req 12.2, 12.4）。
  const invincible = newElapsed < dodge.invincibleUntilMs;
  if (!invincible && detectHit(soul, bullets)) {
    const multiplier = state.currentPattern?.spawn.damageMultiplier ?? 1;
    const damage = computeDamage(
      {
        attack: state.enemy.attack,
        defense: state.player.defense,
        multiplier,
        damageScale: config.damageScale,
        mitigation: defendMitigation(state),
      },
      rng
    );
    const hp = Math.max(0, player.hp - damage);
    player = { ...player, hp };
    // 被弾ログは追加しない（毎フレーム氾濫するため）。ダメージは HP バーで表示。
    invincibleUntilMs = newElapsed + INVINCIBILITY_MS;
    // ぼうぎょ軽減は 1 回適用で解除（Req 5.2）。
    defending = false;
  }

  // HP 低下メッセージ（重複防止, Req 18.3）。
  if (!lowHpNotified && player.hp > 0 && player.hp <= player.maxHp * LOW_HP_RATIO) {
    log = [...log, state.enemyDef.messages.playerLowHp];
    lowHpNotified = true;
  }

  // 敗北（避けフェーズ途中終了, Req 13.2）。
  if (player.hp === 0) {
    return {
      ...state,
      player,
      defending,
      lowHpNotified,
      log: [...log, state.enemyDef.messages.lose],
      dodge: null,
      outcome: 'lose',
      phase: 'ended',
    };
  }

  // 規定時間到達で避けフェーズ終了 → コマンド選択へ（Req 13.1, 13.3）。
  if (newElapsed >= dodge.durationMs) {
    return {
      ...state,
      player,
      defending: false, // 使われなかったぼうぎょもターン終了で解除
      lowHpNotified,
      log,
      dodge: null,
      phase: 'commandSelect',
    };
  }

  // 継続。
  return {
    ...state,
    player,
    defending,
    lowHpNotified,
    log,
    dodge: {
      ...dodge,
      soul,
      bullets,
      elapsedMs: newElapsed,
      invincibleUntilMs,
      wavesRemaining,
      nextWaveMs,
      waveIndex,
      pendingPhases,
    },
  };
}

/**
 * 追加ウェーブ用に難易度設定をエスカレーションする。
 * ウェーブが進むほど弾速・弾数を増やし、1 ターン内でも徐々に難しくする。
 */
function escalateConfig(config: DifficultyConfig, waveIndex: number): DifficultyConfig {
  const step = Math.max(0, waveIndex - 1);
  return {
    ...config,
    bulletSpeedScale: config.bulletSpeedScale * (1 + WAVE_SPEED_ESCALATION * step),
    bulletCountScale: config.bulletCountScale * (1 + WAVE_COUNT_ESCALATION * step),
  };
}
