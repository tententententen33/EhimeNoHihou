// Battle ビュー（アンダーテイル風ターン制バトルの画面）。
//
// presentational + ローカル状態コンポーネント。判定はすべて Battle_System の
// 純粋関数へ委譲する。避けフェーズは requestAnimationFrame で tickDodge を駆動し、
// タッチ（DodgePad）/キーボード入力を方向ベクトルへ写像して渡す。
// 勝敗が確定したら親へ onWin / onClose で通知する（報酬付与は親が実行）。
//
// 画像スロット:
// - 敵スプライト: enemyDef.spriteUrl（未指定は絵文字）
// - プレイヤー（ハート）: soulSpriteUrl（未指定は赤いハート SVG）
// - 背景: backgroundUrl（未指定は緑グリッド CSS）

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CharacterStats } from '../../domain/types';
import {
  startBattle,
  selectCommand,
  resolveEnemyAction,
  tickDodge,
  type BattleState,
  type Command,
  type DifficultyId,
  type EnemyDefinition,
  type BattleItem,
  type Vec2,
  type Outcome,
} from '../../domain/battle';
import { DodgePad } from './DodgePad';
import { SimpleEnemy, type SimpleEnemyAnim } from './SimpleEnemy';
import { saveBattle, clearBattle } from '../../state/battlePersistence';
import { getQuiz, type QuizQuestion } from '../../data/quizzes';
import './BattleView.css';

export interface BattleViewProps {
  enemyDef: EnemyDefinition;
  playerStats: CharacterStats;
  difficulty: DifficultyId;
  /** プレイヤーのレベル（LV 表示用）。 */
  playerLevel?: number;
  /** バトルに持ち込むアイテム。 */
  items?: BattleItem[];
  /** プレイヤー（ハート）の画像 URL（任意。未指定は赤ハート）。 */
  soulSpriteUrl?: string;
  /** 向き別のソウル画像を返す関数（指定時は移動方向で画像を切り替える）。 */
  soulSpriteByFacing?: (facing: 'down' | 'up' | 'left' | 'right') => string;
  /** バトル背景画像の URL（任意。未指定は緑グリッド）。 */
  backgroundUrl?: string;
  /** 敵キャラクター画像の URL（1枚絵・透過PNG推奨。未指定は絵文字）。 */
  enemySpriteUrl?: string;
  /** 敵スプライトの表示倍率（画像の余白差を補正。既定 1）。 */
  enemyScale?: number;
  /** 敵スプライトの下方向オフセット（px。足を地面に合わせる）。 */
  enemyOffsetY?: number;
  /** 敵スプライトの横方向オフセット（px。頭を中央に合わせる）。 */
  enemyOffsetX?: number;
  /** 復元する進行中バトル状態（アプリ再開時。未指定は新規開始）。 */
  initialState?: BattleState;
  /** 復元時に一時停止状態で開始するか。 */
  startPaused?: boolean;
  /** 勝利時（親が報酬付与・撃破記録を実行）。 */
  onWin: () => void;
  /** 敗北/逃走/中断時（状態不変で閉じる）。 */
  onClose: (outcome: Exclude<Outcome, 'ongoing' | 'win'>) => void;
}

/** HP バー残量割合（0..100%）。 */
function hpPercent(hp: number, maxHp: number): number {
  if (maxHp <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((hp / maxHp) * 100)));
}

/** キーコード → 方向。 */
const KEY_DIR: Record<string, keyof typeof KEY_FLAGS> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
};
const KEY_FLAGS = { up: false, down: false, left: false, right: false };

/** クイズの制限時間（ms）。 */
const QUIZ_TIME_MS = 7000;

/** クイズの選択肢順をランダムに入れ替える（正解が常に同じ位置にならないように）。 */
function shuffleQuiz(q: QuizQuestion): QuizQuestion {
  const indices = q.choices.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j]!, indices[i]!];
  }
  return {
    q: q.q,
    choices: indices.map((i) => q.choices[i]!),
    answer: indices.indexOf(q.answer),
  };
}

/** プレイヤー（ハート）の既定表示: 赤いピクセル風ハート。 */
function HeartSoul({ size }: { size: number }) {
  return (
    <svg className="ut-soul__svg" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="#ff2d2d"
        d="M8 14 L2 8 A3 3 0 0 1 8 4 A3 3 0 0 1 14 8 Z"
      />
    </svg>
  );
}

export function BattleView({
  enemyDef,
  playerStats,
  difficulty,
  playerLevel = 1,
  items = [],
  soulSpriteUrl,
  soulSpriteByFacing,
  backgroundUrl,
  enemySpriteUrl,
  enemyScale,
  enemyOffsetY,
  enemyOffsetX,
  initialState,
  startPaused,
  onWin,
  onClose,
}: BattleViewProps) {
  const initial = useMemo(
    () => initialState ?? startBattle(playerStats, enemyDef, difficulty, items),
    [initialState, playerStats, enemyDef, difficulty, items]
  );
  const [state, setState] = useState<BattleState>(initial);

  const stateRef = useRef(state);
  stateRef.current = state;
  const inputRef = useRef<Vec2>({ x: 0, y: 0 });
  const keysRef = useRef({ ...KEY_FLAGS });
  const notifiedRef = useRef(false);

  // ソウルの向き（移動方向で切り替える）。既定は正面（down）。
  const [soulFacing, setSoulFacing] = useState<'down' | 'up' | 'left' | 'right'>('down');
  const facingRef = useRef(soulFacing);
  const applyFacing = (dir: Vec2) => {
    if (dir.x === 0 && dir.y === 0) return; // 停止中は向き維持
    const f =
      Math.abs(dir.x) >= Math.abs(dir.y)
        ? dir.x < 0
          ? 'left'
          : 'right'
        : dir.y < 0
          ? 'up'
          : 'down';
    if (f !== facingRef.current) {
      facingRef.current = f;
      setSoulFacing(f);
    }
  };

  // 一時停止（PAUSE）。避けフェーズの tick を止める。復元時は停止状態で開始。
  const [paused, setPaused] = useState(startPaused ?? false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  // キーボード入力（PC）→ 方向ベクトル。
  useEffect(() => {
    const recompute = () => {
      const k = keysRef.current;
      let x = 0;
      let y = 0;
      if (k.left) x -= 1;
      if (k.right) x += 1;
      if (k.up) y -= 1;
      if (k.down) y += 1;
      inputRef.current = x === 0 && y === 0 ? { x: 0, y: 0 } : { x: x / Math.hypot(x, y), y: y / Math.hypot(x, y) };
      applyFacing(inputRef.current);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const dir = KEY_DIR[e.key];
      if (dir) {
        keysRef.current[dir] = true;
        recompute();
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const dir = KEY_DIR[e.key];
      if (dir) {
        keysRef.current[dir] = false;
        recompute();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // 避けフェーズ駆動の rAF ループ。
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const dt = t - last;
      last = t;
      const cur = stateRef.current;
      if (!pausedRef.current && cur.phase === 'dodge' && cur.outcome === 'ongoing') {
        setState((prev) => tickDodge(prev, dt, inputRef.current, Math.random));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 勝敗確定で親へ通知。
  useEffect(() => {
    if (state.outcome === 'ongoing' || notifiedRef.current) return;
    notifiedRef.current = true;
    const id = window.setTimeout(() => {
      if (state.outcome === 'win') onWin();
      else onClose(state.outcome as Exclude<Outcome, 'ongoing' | 'win'>);
    }, 1300);
    return () => window.clearTimeout(id);
  }, [state.outcome, onWin, onClose]);

  // コマンド実行: 選択 → （enemyAction なら）敵行動を解決して避けへ。
  const runCommand = (command: Command) => {
    setState((prev) => {
      const afterCmd = selectCommand(prev, command, Math.random);
      if (afterCmd.phase === 'enemyAction') {
        return resolveEnemyAction(afterCmd, Math.random);
      }
      return afterCmd;
    });
  };

  // こうげき: クイズがある敵はまず出題、無ければ通常どおり命中。
  // 同じ戦闘では出題済みの問題を避け、未出題からランダムに選ぶ（全問出たらリセット）。
  const onAttack = () => {
    const questions = getQuiz(enemyDef.id);
    if (questions && questions.length > 0) {
      let remaining = questions.map((_, i) => i).filter((i) => !askedRef.current.has(i));
      if (remaining.length === 0) {
        // 全問出題済み → リセットして再利用。
        askedRef.current.clear();
        remaining = questions.map((_, i) => i);
      }
      const idx = remaining[Math.floor(Math.random() * remaining.length)]!;
      askedRef.current.add(idx);
      setQuiz(shuffleQuiz(questions[idx]!));
    } else {
      runCommand({ kind: 'attack' });
    }
  };

  // クイズ判定の解決（正解/不正解 → 演出 → こうげき命中 or 敵ターン）。
  const resolveQuiz = (correct: boolean) => {
    setQuiz(null);
    setFeedback(correct ? 'correct' : 'wrong');
    window.setTimeout(() => {
      setFeedback(null);
      runCommand({ kind: 'attack', hit: correct });
    }, 900);
  };

  // クイズ回答。
  const onAnswer = (index: number) => {
    resolveQuiz(quiz !== null && index === quiz.answer);
  };

  // クイズを中断してコマンドへ戻る（押し間違え用。ターンを消費しない）。
  const cancelQuiz = () => {
    setQuiz(null);
  };

  const [itemOpen, setItemOpen] = useState(false);
  // こうげき時に出題中のクイズ（null なら非出題）。
  const [quiz, setQuiz] = useState<QuizQuestion | null>(null);
  // クイズの残り時間（ms）と内部カウンタ。
  const [quizTimeLeft, setQuizTimeLeft] = useState(QUIZ_TIME_MS);
  const quizRemainRef = useRef(QUIZ_TIME_MS);
  // この戦闘で既に出題した問題のインデックス（重複出題を避ける）。
  const askedRef = useRef<Set<number>>(new Set());
  // 回答結果の演出（せいかい！／ざんねん…）。
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  // 画像読み込み失敗時のフォールバック制御。
  const [bgError, setBgError] = useState(false);
  const [soulError, setSoulError] = useState(false);
  // 向きが変わったら画像読み込みエラーをリセット（別方向の画像を再試行）。
  useEffect(() => {
    setSoulError(false);
  }, [soulFacing]);

  // 敵アニメ状態（idle/attack/hit/death）。token で同一アニメを再トリガ。
  const [enemyAnim, setEnemyAnim] = useState<{ anim: SimpleEnemyAnim; token: number }>({
    anim: 'idle',
    token: 0,
  });

  // 敵 HP が減ったら被弾（hit）。
  const prevHpRef = useRef(state.enemy.hp);
  useEffect(() => {
    if (state.enemy.hp < prevHpRef.current) {
      setEnemyAnim((a) => ({ anim: 'hit', token: a.token + 1 }));
    }
    prevHpRef.current = state.enemy.hp;
  }, [state.enemy.hp]);

  // 敵ターン開始で攻撃（attack）。
  const prevPhaseRef = useRef(state.phase);
  useEffect(() => {
    if (state.phase === 'enemyAction' && prevPhaseRef.current !== 'enemyAction') {
      setEnemyAnim((a) => ({ anim: 'attack', token: a.token + 1 }));
    }
    prevPhaseRef.current = state.phase;
  }, [state.phase]);

  // 勝利（＝敵を倒した）で敵の死亡モーション。
  useEffect(() => {
    if (state.outcome === 'win') {
      setEnemyAnim((a) => ({ anim: 'death', token: a.token + 1 }));
    }
  }, [state.outcome]);

  // 進行中バトルの保存（アプリを閉じても再開できるように）。
  // 毎フレームではなく、フェーズ・ターン・HP・決着の変化など粗い節目でのみ保存する。
  useEffect(() => {
    const s = stateRef.current;
    if (s.outcome === 'ongoing') {
      saveBattle({ bossId: enemyDef.id, difficulty, playerLevel, state: s });
    } else {
      clearBattle();
    }
    // stateRef.current が最新の state を指すため依存は粗い節目のみにする。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.turn, state.player.hp, state.enemy.hp, state.outcome, enemyDef.id, difficulty, playerLevel]);

  const enemySprite = enemySpriteUrl ?? enemyDef.spriteUrl;

  // クイズ制限時間（7秒）。時間切れは不正解扱い。ポーズ中は止める。
  useEffect(() => {
    if (!quiz) return;
    quizRemainRef.current = QUIZ_TIME_MS;
    setQuizTimeLeft(QUIZ_TIME_MS);
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = t - last;
      last = t;
      if (!pausedRef.current) quizRemainRef.current -= dt;
      if (quizRemainRef.current <= 0) {
        setQuizTimeLeft(0);
        resolveQuiz(false);
        return;
      }
      setQuizTimeLeft(quizRemainRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quiz]);

  const inCommand = state.phase === 'commandSelect' && state.outcome === 'ongoing';
  const inDodge = state.phase === 'dodge' && state.dodge !== null;
  const recentLog = state.log.slice(-3);
  const dodge = state.dodge;

  // ソウル画像（向き対応があれば現在の向き、無ければ単一画像）。
  const soulSrc = soulSpriteByFacing ? soulSpriteByFacing(soulFacing) : soulSpriteUrl;

  // クイズの残り秒数と危機度（残りが減るほど数字が大きく・赤く）。
  const quizSec = Math.max(0, Math.ceil(quizTimeLeft / 1000));
  const quizDanger = 1 - quizTimeLeft / QUIZ_TIME_MS;

  // 中央ボックスの寸法（避けエリアに一致させて画面のガタつきを防ぐ）。
  const boxW = dodge?.area.width ?? 320;
  const boxH = dodge?.area.height ?? 200;

  return (
    <div className="ut-battle" role="dialog" aria-modal="true" aria-label={`${enemyDef.name} とのバトル`}>
      <div className="ut-battle__stage">
        {/* 一時停止（PAUSE）ボタン: 右上 */}
        <button
          type="button"
          className="ut-battle__pause-btn"
          onClick={() => setPaused(true)}
          aria-label="ポーズ"
        >
          ⏸ PAUSE
        </button>

        {/* 敵エリア: 背景レイヤー + 敵レイヤー（単一画像 + Transform アニメ） */}
        <div className="ut-battle__enemy-area">
          {/* 背景（1枚画像、無ければ緑グリッド） */}
          {backgroundUrl && !bgError ? (
            <img className="ut-bg" src={backgroundUrl} alt="" aria-hidden="true" onError={() => setBgError(true)} />
          ) : (
            <div className="ut-grid" aria-hidden="true" />
          )}

          {/* 敵キャラ（簡易アニメ: idle/attack/hit/death） */}
          <div className="ut-enemy" style={{ transform: `translate(${enemyOffsetX ?? 0}px, ${enemyOffsetY ?? 0}px)` }}>
            <SimpleEnemy
              spriteUrl={enemySprite}
              emoji={enemyDef.id.includes('mid') ? '👹' : '🐉'}
              name={enemyDef.name}
              animation={enemyAnim.anim}
              playToken={enemyAnim.token}
              scale={enemyScale ?? 1}
            />
          </div>

          {/* 敵名（ふりがな付き）＋ そのちょい下に敵HPバー */}
          <div className="ut-enemy-info">
            <span className="ut-enemy-info__name">
              <ruby>
                {enemyDef.name}
                {enemyDef.reading && <rt>{enemyDef.reading}</rt>}
              </ruby>
            </span>
            <div className="ut-enemy-info__hp">
              <div
                className="ut-enemy-info__hp-fill"
                style={{ width: `${hpPercent(state.enemy.hp, state.enemy.maxHp)}%` }}
              />
            </div>
          </div>
        </div>

        {/* 中央ボックス（白枠）。コマンド時はメッセージ、避け時はアリーナ。 */}
        <div className="ut-battle__box" style={{ width: boxW, height: boxH }}>
          {inDodge && dodge ? (
            <div className="ut-arena" key="arena">
              {/* プレイヤー（ハート＝自分のキャラ） */}
              <div
                className="ut-soul"
                style={{
                  left: dodge.soul.pos.x - dodge.soul.radius,
                  top: dodge.soul.pos.y - dodge.soul.radius,
                  width: dodge.soul.radius * 2,
                  height: dodge.soul.radius * 2,
                  opacity: dodge.elapsedMs < dodge.invincibleUntilMs ? 0.4 : 1,
                }}
              >
                {soulSrc && !soulError ? (
                  <img
                    className="ut-soul__img"
                    src={soulSrc}
                    alt="あなた"
                    onError={() => setSoulError(true)}
                  />
                ) : (
                  <HeartSoul size={dodge.soul.radius * 2} />
                )}
              </div>
              {/* 弾 */}
              {dodge.bullets.map((b) => {
                // リング弾（衝撃波）: 中心基準で、すき間付きの輪を SVG で描く。
                if (b.ringRadius !== undefined) {
                  const r = b.ringRadius;
                  const d = r * 2;
                  const stroke = Math.max(3, (b.ringThickness ?? 4));
                  const rr = Math.max(1, r - stroke / 2);
                  const circ = 2 * Math.PI * rr;
                  const gapHalf = b.gapHalf ?? 0;
                  const gapLen = (gapHalf / Math.PI) * circ; // 2*gapHalf ぶんの弧長
                  const dashLen = Math.max(0, circ - gapLen);
                  const halfGapDeg = (gapHalf * 180) / Math.PI;
                  const rotDeg = ((b.gapAngle ?? 0) * 180) / Math.PI + halfGapDeg;
                  return (
                    <div
                      key={b.id}
                      className="ut-bullet ut-bullet--ring"
                      style={{ left: b.pos.x - r, top: b.pos.y - r, width: d, height: d }}
                    >
                      <svg width={d} height={d} className="ut-ring-svg" style={{ transform: `rotate(${rotDeg}deg)` }}>
                        <circle
                          cx={r}
                          cy={r}
                          r={rr}
                          fill="none"
                          stroke="#ffffff"
                          strokeWidth={stroke}
                          strokeDasharray={`${dashLen} ${gapLen}`}
                        />
                      </svg>
                    </div>
                  );
                }
                const angle = b.spin ? (Math.atan2(b.velocity.y, b.velocity.x) * 180) / Math.PI + 90 : 0;
                return (
                  <div
                    key={b.id}
                    className={`ut-bullet ut-bullet--${b.shape ?? 'circle'}${b.homing && !b.spriteUrl ? ' ut-bullet--homing' : ''}${b.spriteUrl ? ' ut-bullet--sprite' : ''}`}
                    style={{
                      left: b.pos.x - b.radius,
                      top: b.pos.y - b.radius,
                      width: b.radius * 2,
                      height: b.radius * 2,
                    }}
                  >
                    {b.spriteUrl && (
                      <img
                        className="ut-bullet__img"
                        src={b.spriteUrl}
                        alt=""
                        style={b.spin ? { transform: `rotate(${angle}deg) scale(1.8)` } : undefined}
                      />
                    )}
                  </div>
                );
              })}
              {dodge.elapsedMs < dodge.telegraphMs && <span className="ut-telegraph">⚠ こうげきがくる！</span>}
            </div>
          ) : quiz ? (
            <div className="ut-quiz" key="quiz">
              <span
                className={`ut-quiz__timer${quizDanger > 0.6 ? ' ut-quiz__timer--danger' : ''}`}
                style={{ fontSize: `${1.0 + quizDanger * 1.6}rem` }}
              >
                {quizSec}
              </span>
              <p className="ut-quiz__q">{quiz.q}</p>
              <div className="ut-quiz__choices">
                {quiz.choices.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    className="ut-quiz__choice"
                    onClick={() => onAnswer(i)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          ) : feedback ? (
            <div className={`ut-feedback ut-feedback--${feedback}`} key="feedback">
              {feedback === 'correct' ? 'せいかい！' : 'ざんねん…'}
            </div>
          ) : (
            <div className="ut-msg" aria-live="polite" key="msg">
              {recentLog.map((line, i) => (
                <p key={state.log.length - recentLog.length + i} className="ut-msg__line">
                  * {line}
                </p>
              ))}
              {state.outcome !== 'ongoing' && (
                <p className="ut-msg__result">
                  {state.outcome === 'win' && '🎉 勝利！'}
                  {state.outcome === 'lose' && '💀 敗北…'}
                  {state.outcome === 'fled' && '🏃 にげた'}
                </p>
              )}
            </div>
          )}
        </div>

        {/* ステータス行（LV / HP） */}
        <div className="ut-status">
          <span className="ut-status__lv">LV {playerLevel}</span>
          <span className="ut-status__hp-label">HP</span>
          <div className="ut-status__hp-bar">
            <div
              className="ut-status__hp-fill"
              style={{ width: `${hpPercent(state.player.hp, state.player.maxHp)}%` }}
            />
          </div>
          <span className="ut-status__hp-num">
            {state.player.hp} / {state.player.maxHp}
          </span>
        </div>

        {/* コマンド or 避けパッド or 結果 */}
        <div className="ut-controls">
          {inCommand && !itemOpen && !quiz && !feedback && (
            <div className="ut-cmdrow">
              <button type="button" className="ut-cmd" onClick={onAttack}>
                <span className="ut-cmd__ic">✛</span>こうげき
              </button>
              <button type="button" className="ut-cmd" onClick={() => runCommand({ kind: 'defend' })}>
                <span className="ut-cmd__ic">🛡</span>ぼうぎょ
              </button>
              <button type="button" className="ut-cmd" onClick={() => setItemOpen(true)}>
                <span className="ut-cmd__ic">✦</span>アイテム
              </button>
              <button type="button" className="ut-cmd" onClick={() => runCommand({ kind: 'flee' })}>
                <span className="ut-cmd__ic">✕</span>みのがす
              </button>
            </div>
          )}

          {inCommand && itemOpen && (
            <div className="ut-submenu">
              {state.items.length === 0 && <p className="ut-empty">アイテムがない</p>}
              {state.items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className="ut-cmd"
                  disabled={it.usesRemaining <= 0}
                  onClick={() => { setItemOpen(false); runCommand({ kind: 'item', itemId: it.id }); }}
                >
                  {it.name}（残{it.usesRemaining}）HP+{it.healAmount}
                </button>
              ))}
              <button type="button" className="ut-cmd ut-cmd--back" onClick={() => setItemOpen(false)}>
                もどる
              </button>
            </div>
          )}

          {inDodge && <DodgePad onChange={(dir) => { inputRef.current = dir; applyFacing(dir); }} />}

          {/* クイズ中はコマンド領域に「もどる」を出す（押し間違え対策） */}
          {inCommand && quiz && (
            <div className="ut-backrow">
              <button type="button" className="ut-cmd ut-cmd--back ut-cmd--wide" onClick={cancelQuiz}>
                ↩ もどる
              </button>
            </div>
          )}
        </div>

        {/* 一時停止オーバーレイ */}
        {paused && (
          <div className="ut-battle__pause-overlay" role="dialog" aria-label="ポーズ中">
            <p className="ut-battle__pause-title">ポーズ中</p>
            <button type="button" className="ut-cmd" onClick={() => setPaused(false)}>
              ▶ さいかい
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
