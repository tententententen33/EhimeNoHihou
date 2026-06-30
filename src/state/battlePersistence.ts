// 進行中バトルの保存・復元（アプリを閉じても再開できるようにする）。
//
// バトルの全状態（BattleState）は副作用なしの純粋データ（関数を含まない）なので
// そのまま JSON 化して localStorage に保存できる。起動時に読み出し、ポーズ状態で
// バトル画面を復元する。勝敗確定・中断時にはクリアする。

import type { BattleState, DifficultyId } from '../domain/battle';

const KEY = 'ehime-battle-inprogress-v1';

/** 保存する進行中バトルのスナップショット。 */
export interface SavedBattle {
  /** 対戦中のボス id（再開時に敵定義・画像を復元するため）。 */
  bossId: string;
  difficulty: DifficultyId;
  playerLevel: number;
  /** バトルの全状態。 */
  state: BattleState;
}

/** 進行中バトルを保存する。 */
export function saveBattle(snapshot: SavedBattle): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    // ストレージ不可（プライベートモード等）でも致命的ではないため握りつぶす。
  }
}

/** 保存済みの進行中バトルを読み出す（無ければ null）。 */
export function loadBattle(): SavedBattle | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedBattle;
    // 最低限の妥当性チェック。
    if (!parsed || typeof parsed.bossId !== 'string' || !parsed.state) return null;
    if (parsed.state.outcome !== 'ongoing') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 保存済みの進行中バトルを消す。 */
export function clearBattle(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 同上。
  }
}
