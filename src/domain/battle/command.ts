// Command_System: プレイヤーコマンドの解決（Req 4, 5, 6, 7, 8）
//
// 純粋関数。各 resolve* は入力 BattleState を変更せず次状態を返す。
// 無効な操作（存在しないアイテム/選択肢・使用回数0）の場合は同一参照を返し、
// 上位（battle.ts）がそれを「変化なし」として扱う。

import type { BattleState, Rng } from './types';
import {
  DEFEND_BASE_REDUCTION,
  DEFEND_PER_DEFENSE,
  DEFEND_MIN_MULT,
  FLEE_SPEED_FACTOR,
  FLEE_MAX_CHANCE,
} from './types';
import { computeDamage } from './damage';

/**
 * こうげき（Req 4）。
 * 敵の現在 HP を Damage_Calculator のダメージぶん減算（0 クランプ）。
 * 敵 HP が 0 になれば win/ended、そうでなければ enemyAction へ遷移。
 * hit=false（クイズ不正解など）の場合はダメージを与えず enemyAction へ進む。
 */
export function resolveAttack(state: BattleState, rng: Rng, hit = true): BattleState {
  if (!hit) {
    return {
      ...state,
      log: [...state.log, 'こうげきは はずれた！'],
      phase: 'enemyAction',
    };
  }

  const damage = computeDamage(
    { attack: state.player.attack, defense: state.enemy.defense, multiplier: 1, critChance: 0.1, critMultiplier: 1.5 },
    rng
  );
  const hp = Math.max(0, state.enemy.hp - damage);
  const enemy = { ...state.enemy, hp };
  const log = [...state.log, `あなたのこうげき！ ${state.enemyDef.name} に ${damage} ダメージ`];

  if (hp === 0) {
    return {
      ...state,
      enemy,
      log: [...log, state.enemyDef.messages.win],
      outcome: 'win',
      phase: 'ended',
    };
  }
  return { ...state, enemy, log, phase: 'enemyAction' };
}

/**
 * ぼうぎょ（Req 5）。
 * 次の被ダメージを軽減する状態を立て、enemyAction へ遷移する。
 * 軽減の解除（1 回適用後）は dodge 側で行う。
 */
export function resolveDefend(state: BattleState): BattleState {
  return {
    ...state,
    defending: true,
    log: [...state.log, 'あなたは身を守っている。次の被ダメージが軽減される。'],
    phase: 'enemyAction',
  };
}

/**
 * アイテム使用（Req 6）。
 * 回復量を現在 HP に加算（最大 HP クランプ）し、使用回数を 1 減らす。
 * 未定義 id・使用回数 0 のアイテムは拒否（状態不変）。
 */
export function resolveItem(state: BattleState, itemId: string): BattleState {
  const index = state.items.findIndex((it) => it.id === itemId);
  if (index < 0) return state;
  const item = state.items[index]!;
  if (item.usesRemaining <= 0) return state;

  const hp = Math.min(state.player.maxHp, state.player.hp + item.healAmount);
  const healed = hp - state.player.hp;
  const items = state.items.map((it, i) =>
    i === index ? { ...it, usesRemaining: it.usesRemaining - 1 } : it
  );

  return {
    ...state,
    player: { ...state.player, hp },
    items,
    log: [...state.log, `${item.name} を使った！ HP が ${healed} 回復した。`],
    phase: 'enemyAction',
  };
}

/**
 * こうどう（Req 7）。
 * 選択肢のメッセージをログへ追加し、効果を反映して enemyAction へ遷移。
 * 「様子を見る」を含め敵 HP は変化させない。未定義 id は拒否（状態不変）。
 */
export function resolveAct(state: BattleState, optionId: string): BattleState {
  const option = state.enemyDef.actOptions.find((o) => o.id === optionId);
  if (option === undefined) return state;

  // MVP では効果は最小（メッセージのみ）。将来 effect で被ダメージ/勝敗へ影響。
  return {
    ...state,
    log: [...state.log, option.message],
    phase: 'enemyAction',
  };
}

/**
 * にげる（Req 8）。
 * 逃走成功率は「敵の基準確率 + プレイヤーの素早さ補正」。素早さが上がる装備ほど
 * 逃げやすい（上限 FLEE_MAX_CHANCE）。成功で fled/ended、失敗は当該ターンの
 * こうげき機会を消費して enemyAction へ遷移（ペナルティ）。
 */
export function resolveFlee(state: BattleState, rng: Rng): BattleState {
  const base = Math.min(1, Math.max(0, state.enemyDef.fleeChance));
  const chance = Math.min(FLEE_MAX_CHANCE, base + state.player.speed * FLEE_SPEED_FACTOR);
  const success = rng() < chance;
  if (success) {
    return {
      ...state,
      log: [...state.log, 'あなたは うまく にげだした！'],
      outcome: 'fled',
      phase: 'ended',
    };
  }
  return {
    ...state,
    log: [...state.log, 'にげられなかった！'],
    phase: 'enemyAction',
  };
}

/**
 * ぼうぎょ軽減の適用係数を返す（dodge 側の被ダメージ計算で使用）。
 *
 * ぼうぎょ中は「基本軽減率 + 防具(defense)×係数」だけ被ダメージを減らす。
 * 防具が高いほど軽減が大きく、最大で DEFEND_MIN_MULT（=最大 90% 軽減）まで。
 * 非ぼうぎょ時は 1（軽減なし）。
 */
export function defendMitigation(state: BattleState): number {
  if (!state.defending) return 1;
  const reduction = DEFEND_BASE_REDUCTION + state.player.defense * DEFEND_PER_DEFENSE;
  return Math.max(DEFEND_MIN_MULT, 1 - reduction);
}
