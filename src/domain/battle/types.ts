// Battle_System: 型定義と基盤定数（アンダーテイル風ターン制バトル）
//
// 本ファイルはバトル領域の中核データモデルを定義する。すべて副作用を持たない
// 純粋なデータ構造であり、判定ロジック（battle.ts / command.ts / dodge.ts /
// enemyAI.ts / damage.ts）の入出力となる。

import type { CharacterStats } from '../types';

// ---------------------------------------------------------------------------
// 基本型
// ---------------------------------------------------------------------------

/** 注入可能な乱数。[0,1) を返す。テストで決定論的に固定する。 */
export type Rng = () => number;

/** 2 次元ベクトル（避けエリア座標系。原点は左上、+x 右・+y 下、単位 px）。 */
export interface Vec2 {
  x: number;
  y: number;
}

/** 戦闘参加者（プレイヤー/敵）の戦闘パラメータと現在 HP。HP は 0..maxHp の整数。 */
export interface Combatant {
  maxHp: number;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
}

/** バトルの現在段階。 */
export type Phase = 'commandSelect' | 'enemyAction' | 'dodge' | 'resolve' | 'ended';

/** バトルの決着結果。 */
export type Outcome = 'ongoing' | 'win' | 'lose' | 'fled';

/** 難易度。 */
export type DifficultyId = 'easy' | 'normal' | 'hard';

// ---------------------------------------------------------------------------
// 難易度
// ---------------------------------------------------------------------------

/** 難易度ごとの戦闘パラメータ（Req 19）。 */
export interface DifficultyConfig {
  /** 弾速スケール。Easy<=Normal<=Hard。 */
  bulletSpeedScale: number;
  /** 弾数スケール。Easy<=Normal<=Hard。 */
  bulletCountScale: number;
  /** 予兆時間（ms）。Easy>=Normal>=Hard。 */
  telegraphMs: number;
  /** ダメージ係数。Easy<=Normal<=Hard。 */
  damageScale: number;
  /** ソウル移動速度（px/ms）。Easy>=Normal>=Hard。 */
  soulSpeed: number;
}

// ---------------------------------------------------------------------------
// 避けフェーズ
// ---------------------------------------------------------------------------

/** 避けエリア（矩形。原点 (0,0) 左上）。 */
export interface DodgeArea {
  width: number;
  height: number;
}

/** プレイヤーの当たり判定オブジェクト。 */
export interface Soul {
  pos: Vec2;
  radius: number;
}

/** 敵弾。velocity は px/ms。 */
export interface Bullet {
  id: string;
  pos: Vec2;
  velocity: Vec2;
  radius: number;
  /** 被弾時のダメージ倍率。 */
  damageMultiplier: number;
  /** 追尾の強さ（0/未指定で直進）。 */
  homing?: number;
  /** 見た目（既定 circle）。 */
  shape?: BulletShape;
  /** 生成からの経過時間（ms）。追尾の打ち切り・寿命管理に使う。 */
  ageMs?: number;
  /** 弾画像の URL（指定時は画像で描画。当たり判定は円のまま）。 */
  spriteUrl?: string;
  /** 進行方向へ画像を回転させる（槍・鳥など）。 */
  spin?: boolean;
  /** 衝撃波リングの現在半径（px）。指定時はリング弾として扱う。 */
  ringRadius?: number;
  /** リングの拡大速度（px/ms）。 */
  growRate?: number;
  /** リングの当たり帯の半分の太さ（px）。 */
  ringThickness?: number;
  /** リングのすき間（開口部）の中心角（rad, atan2 と同じ画面座標系）。 */
  gapAngle?: number;
  /** すき間の半幅（rad）。この範囲内はすり抜けられる。 */
  gapHalf?: number;
}

/** 避けフェーズの状態。 */
export interface DodgeState {
  area: DodgeArea;
  soul: Soul;
  bullets: Bullet[];
  /** 累積経過時間（ms）。 */
  elapsedMs: number;
  /** このターンの規定時間（ms）。 */
  durationMs: number;
  /** 予兆時間（ms）。elapsedMs < telegraphMs の間は弾を動かさない。 */
  telegraphMs: number;
  /** 無敵終了時刻（ms, elapsedMs 基準）。elapsedMs < invincibleUntilMs の間は無敵。 */
  invincibleUntilMs: number;
  /** 残りの追加ウェーブ数（敵攻撃を繰り返す回数 - 1）。 */
  wavesRemaining: number;
  /** 次の追加ウェーブを出す時刻（elapsedMs 基準）。 */
  nextWaveMs: number;
  /** 追加ウェーブの間隔（ms）。 */
  waveIntervalMs: number;
  /** これまでに出したウェーブ数（初回=1。エスカレーション計算に使う）。 */
  waveIndex: number;
  /** 時刻到達で生成する保留フェーズ（多段攻撃用。atMs 昇順）。空なら通常ウェーブ方式。 */
  pendingPhases: PendingPhase[];
}

// ---------------------------------------------------------------------------
// 敵定義・コマンド・アイテム
// ---------------------------------------------------------------------------

/** 弾の出現パターン種別。敵ごとに異なる攻撃を表現するために多数用意する。 */
export type BulletPattern =
  | 'rain' // 上から直下降（ランダム x）
  | 'rainColumns' // 等間隔の列で落とす（壁＋すき間）
  | 'sweepL' // 左から右へ横断
  | 'sweepR' // 右から左へ横断
  | 'sides' // 左右両側から内側へ
  | 'diagDownR' // 上から右下へ斜め
  | 'diagDownL' // 上から左下へ斜め
  | 'fan' // 上中央から扇状に拡散
  | 'burst' // 中心から全方位へ放射
  | 'spiral' // 渦状（角度オフセット付き放射）
  | 'aimed' // プレイヤー初期位置を狙って降る
  | 'random' // ランダム位置・ランダム方向
  | 'homing' // プレイヤーを追尾する
  | 'shockwave'; // 中心から広がる衝撃波リング

/** 弾の見た目（当たり判定は常に円）。 */
export type BulletShape = 'circle' | 'square' | 'diamond' | 'triangle';

/** 弾の生成仕様（行動パターンが持つ）。 */
export interface BulletSpawnSpec {
  /** 基準の弾数（難易度の bulletCountScale を乗算）。 */
  count: number;
  /** 基準の弾速（px/ms。難易度の bulletSpeedScale を乗算）。 */
  speed: number;
  /** 弾の当たり判定半径（px）。 */
  radius: number;
  /** 出現パターン。 */
  pattern: BulletPattern;
  /** 被弾時のダメージ倍率。 */
  damageMultiplier: number;
  /** 追尾の強さ（0で直進。大きいほどソウルへ強く曲がる。毎秒の補間率）。 */
  homing?: number;
  /** 弾の見た目（既定 circle）。 */
  shape?: BulletShape;
  /** true のとき球数による弾速補正を無効化し、speed をそのまま使う（手組み攻撃用）。 */
  ignoreCountSpeed?: boolean;
  /** 弾画像の URL（指定時は画像で描画）。 */
  spriteUrl?: string;
  /** 進行方向へ画像を回転させる。 */
  spin?: boolean;
}

/** 攻撃の 1 フェーズ（予兆後 atMs に弾を生成する）。多段攻撃の表現に使う。 */
export interface AttackPhase {
  /** 予兆終了からの経過 ms。0 以下なら攻撃開始と同時に出す。 */
  atMs: number;
  /** このフェーズで生成する弾仕様。 */
  spawn: BulletSpawnSpec;
}

/** 避けフェーズ中に時刻到達で生成する保留フェーズ。 */
export interface PendingPhase {
  atMs: number;
  spawn: BulletSpawnSpec;
  /** 弾 id の接頭辞（パターン id）。 */
  id: string;
}

/** 敵の 1 行動（攻撃パターン）。 */
export interface EnemyActionPattern {
  id: string;
  /** 行動時メッセージ（Req 18.2）。 */
  message: string;
  spawn: BulletSpawnSpec;
  /** 避けフェーズ規定時間（ms, Req 13.4）。 */
  dodgeDurationMs: number;
  /** 多段攻撃の時間差フェーズ（指定時はこちらを使い、通常の3ウェーブは行わない）。 */
  phases?: AttackPhase[];
}

/** こうどう（ACT）の効果（MVP は最小）。 */
export type ActEffect = { kind: 'none' } | { kind: 'sparable' };

/** こうどう選択肢（Req 7）。 */
export interface ActOption {
  id: string;
  label: string;
  /** 選択時メッセージ（Req 7.2）。 */
  message: string;
  /** 戦闘条件への影響（任意）。 */
  effect?: ActEffect;
}

/** 敵定義（MVP: 1 体）。 */
export interface EnemyDefinition {
  id: string;
  name: string;
  /** 名前のふりがな（ルビ表示用）。 */
  reading?: string;
  stats: CharacterStats;
  /** 敵スプライト画像の URL（任意）。未指定時は絵文字フォールバック表示。 */
  spriteUrl?: string;
  /** 通常時の行動パターン集合（HP > 50%）。 */
  normalPatterns: EnemyActionPattern[];
  /** 変化後の行動パターン集合（HP <= 50%）。 */
  enragedPatterns: EnemyActionPattern[];
  /** こうどう選択肢（Req 7.1）。 */
  actOptions: ActOption[];
  /** 逃走成功の基準確率（0..1, Req 8.4）。 */
  fleeChance: number;
  /** 演出メッセージ（Req 18）。 */
  messages: {
    start: string;
    playerLowHp: string;
    win: string;
    lose: string;
  };
}

/** バトルで使用する消費アイテム（MVP: 固定回復）。 */
export interface BattleItem {
  id: string;
  name: string;
  /** 回復量（HP）。 */
  healAmount: number;
  /** このバトル内の残り使用回数（Req 6.4, 6.5）。 */
  usesRemaining: number;
}

/** プレイヤーコマンド（Req 3.1）。 */
export type Command =
  | { kind: 'attack'; hit?: boolean }
  | { kind: 'defend' }
  | { kind: 'item'; itemId: string }
  | { kind: 'act'; optionId: string }
  | { kind: 'flee' };

// ---------------------------------------------------------------------------
// 集約状態
// ---------------------------------------------------------------------------

/** バトルの全状態（不変データ）。 */
export interface BattleState {
  phase: Phase;
  outcome: Outcome;
  /** 経過ターン数（コマンド選択を 1 ターンと数える）。 */
  turn: number;
  player: Combatant;
  enemy: Combatant;
  enemyDef: EnemyDefinition;
  difficulty: DifficultyId;
  /** ぼうぎょ中フラグ（次の被ダメージで軽減し適用後に解除）。 */
  defending: boolean;
  /** バトルアイテムの残量。 */
  items: BattleItem[];
  /** 避けフェーズ状態。dodge 以外では null。 */
  dodge: DodgeState | null;
  /** 直近で選ばれた敵行動（弾生成元）。 */
  currentPattern: EnemyActionPattern | null;
  /** メッセージログ（古い順, Req 18.6）。 */
  log: string[];
  /** HP 低下メッセージを既に出したか（重複防止）。 */
  lowHpNotified: boolean;
}

// ---------------------------------------------------------------------------
// 定数（初期バランス・デモ用）
// ---------------------------------------------------------------------------

/** ダメージ分散の下限（[VARIANCE_MIN, 1) で揺らす）。 */
export const VARIANCE_MIN = 0.85;

/** 敵 stats 未設定時のフォールバック（弱めの中ボス相当, Req 2.3）。 */
export const DEFAULT_ENEMY_STATS: CharacterStats = {
  hp: 120,
  attack: 16,
  defense: 8,
  speed: 8,
};

/** ぼうぎょの基本軽減率（防具0でもこの割合だけ軽減する）。 */
export const DEFEND_BASE_REDUCTION = 0.4;

/** 防具（defense）1 あたりの追加軽減率（防具が高いほど軽減が増える, Req 5）。 */
export const DEFEND_PER_DEFENSE = 0.01;

/** ぼうぎょ時の被ダメージ倍率の下限（最大 90% 軽減まで）。 */
export const DEFEND_MIN_MULT = 0.1;

/** 被弾後無敵時間（ms, Req 12.3）。 */
export const INVINCIBILITY_MS = 2000;

/** HP 低下メッセージ閾値（Req 18.3）。 */
export const LOW_HP_RATIO = 0.3;

/** 行動パターン変化閾値（Req 9.2, 9.3）。 */
export const ENRAGE_RATIO = 0.5;

/** 1 フレームの経過時間上限（ms）。長時間停止後のワープ防止（Req 20.4）。 */
export const MAX_DT_MS = 100;

/** 追尾弾がソウルを追い続ける時間（ms）。これを過ぎると直進して画面外へ抜ける。 */
export const HOMING_DURATION_MS = 850;

/** 弾の最大寿命（ms）。これを超えた弾は強制的に除去し、画面の溜まりを防ぐ。 */
export const MAX_BULLET_LIFETIME_MS = 6000;

/** 敵攻撃のウェーブ（弾の再出現）間隔（ms）。 */
export const WAVE_INTERVAL_MS = 1200;

/** 1 ターンの敵攻撃ウェーブ総数（初回 + 追加。約2.5回ぶんの手応え）。 */
export const WAVES_PER_TURN = 3;

/** 最終ウェーブ後、弾を捌くための余韻時間（ms）。 */
export const WAVE_TAIL_MS = 1500;

/** にげる成功率に対する素早さ係数（素早さ1あたりの加算）。 */
export const FLEE_SPEED_FACTOR = 0.012;

/** にげる成功率の上限。 */
export const FLEE_MAX_CHANCE = 0.95;

/** ソウル速度の素早さ係数（素早さ値1あたりの倍率加算）。 */
export const SOUL_SPEED_PER_SPEED = 0.015;

/** ソウル速度の素早さによる最大ボーナス倍率（+70%まで）。 */
export const SOUL_SPEED_MAX_BONUS = 0.7;

/** 追加ウェーブごとの難易度上昇率（弾速）。ウェーブが進むほど速くなる。 */
export const WAVE_SPEED_ESCALATION = 0.12;

/** 追加ウェーブごとの難易度上昇率（弾数）。 */
export const WAVE_COUNT_ESCALATION = 0.15;

/** 弾速の球数補正の基準球数（この球数で等倍）。 */
export const SPEED_REF_COUNT = 8;

/** 球数補正の下限倍率（球が多いほど遅く。さすがに避けられるように）。 */
export const SPEED_COUNT_MIN_MUL = 0.6;

/** 球数補正の上限倍率（球が少ない/狙い撃ちはより速く）。 */
export const SPEED_COUNT_MAX_MUL = 1.55;

/** 既定の避けエリア（px）。 */
export const DEFAULT_DODGE_AREA: DodgeArea = { width: 320, height: 200 };

/** ソウルの当たり判定半径（px）。 */
export const SOUL_RADIUS = 8;
