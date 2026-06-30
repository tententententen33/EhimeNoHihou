# Implementation Plan: アンダーテイル風ターン制バトル（実装計画）

## Overview

本計画は設計書（`design.md`）に沿って、アンダーテイル風バトルを純粋ドメイン層（`src/domain/battle/`）から段階的に構築し、最後に仮 UI と既存ゲームへ結線するコーディングタスク群です。技術スタックは React + TypeScript、プロパティテストは fast-check（最低100回反復）を使用します。

方針:
- 判定ロジックはすべて副作用なしの純粋関数として実装し、設計書 Property 1〜23 をプロパティテストで検証する。
- 乱数は注入 `Rng` で評価し、テストで決定論的に固定する。
- リアルタイム避けは「経過時間 `dtMs` を引数に取る純粋関数」で表現する。
- 旧セミオート実装（`src/domain/battle.ts` / `battle.test.ts` / `src/ui/views/BattleView.tsx` / `BattleView.css`）は削除して置き換える。

注記:
- `*` 付きサブタスクはテスト関連で、素早く動かす場合は後回し可能（ただし本計画では各機能にテスト観点を付ける方針）。
- 各タスクは設計書のインターフェース・要求番号を参照する。

## Tasks

- [ ] 1. 型定義と基盤定数（`src/domain/battle/types.ts`）
  - `Rng`, `Vec2`, `Combatant`, `Phase`, `Outcome`, `DifficultyId` を定義する
  - `Soul`, `Bullet`, `DodgeArea`, `DodgeState`, `Command`, `BattleItem`, `BulletSpawnSpec`, `EnemyActionPattern`, `ActOption`, `ActEffect`, `EnemyDefinition`, `BattleState` を設計書 Data Models に従って定義する
  - 共有定数（`VARIANCE_MIN`, `DEFAULT_ENEMY_STATS`, `DEFEND_MITIGATION`, `INVINCIBILITY_MS`, `LOW_HP_RATIO`, `ENRAGE_RATIO`, `MAX_DT_MS`）を定義する
  - _Requirements: 1.1, 1.2, 2.3, 2.6_

- [ ] 2. Difficulty_Config（`src/domain/battle/difficulty.ts`）
  - [ ] 2.1 Easy/Normal/Hard の `DifficultyConfig` 定義と `getDifficulty(id)` を実装する
    - 単調関係（弾速・弾数・ダメージ係数: Easy<=Normal<=Hard、移動速度・予兆時間: Easy>=Normal>=Hard）を満たす値を設定する
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5_
  - [ ]* 2.2 難易度単調性のプロパティテスト
    - **Property 21: 難易度の単調性**
    - **Validates: Requirements 19.1, 19.3, 19.4, 19.5**

- [ ] 3. Damage_Calculator（`src/domain/battle/damage.ts`）
  - [ ] 3.1 `computeDamage(input, rng)` を実装する
    - `raw = attack*multiplier*variance - defense/2`、クリティカル・難易度係数・軽減係数を適用し 1 以上の整数へクランプ
    - _Requirements: 14.1, 14.2, 14.3, 14.4_
  - [ ]* 3.2 ダメージ計算のプロパティテスト
    - **Property 18: ダメージ計算**
    - **Validates: Requirements 14.1, 14.2, 14.3, 14.4**

- [ ] 4. Battle_System 骨格とコマンド（こうげき/ぼうぎょ）
  - [ ] 4.1 `startBattle` とフェーズ/勝敗の中核を実装する（`src/domain/battle/battle.ts`）
    - プレイヤー `totalStats`・敵 `stats`（未設定は既定値）から `Combatant` 生成、初期 `commandSelect`/`ongoing`、HP=maxHp
    - `availableCommands`, `selectCommand`（フェーズガード・無効コマンド拒否・enemyAction 遷移）、勝敗確定後の不変を実装
    - 開始/勝利/敗北メッセージのログ付与
    - _Requirements: 1.1, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 16.1, 16.2, 16.3, 16.4, 18.1, 18.4, 18.5_
  - [ ] 4.2 こうげき・ぼうぎょを実装する（`src/domain/battle/command.ts`）
    - `resolveAttack`（敵HP減算・0クランプ・勝利遷移・攻撃メッセージ）、`resolveDefend`（軽減フラグ・1回適用解除）
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 18.2_
  - [ ]* 4.3 中核・コマンドのプロパティテスト
    - **Property 1: 単一敵の不変条件** / **Validates: Requirements 1.1, 1.2**
    - **Property 2: 初期状態の不変条件** / **Validates: Requirements 2.4, 2.5, 2.6**
    - **Property 3: フェーズガード** / **Validates: Requirements 3.3, 20.1**
    - **Property 6: こうげきと勝利** / **Validates: Requirements 4.1, 4.3, 4.4, 16.1**
    - **Property 7: ぼうぎょの軽減** / **Validates: Requirements 5.1, 5.2, 5.3, 12.6**
    - **Property 19: 勝敗判定と決着後不変** / **Validates: Requirements 16.2, 16.3, 16.4**

- [ ] 5. コマンド（アイテム/こうどう/にげる）
  - [ ] 5.1 `resolveItem`・`resolveAct`・`resolveFlee` を実装する（`src/domain/battle/command.ts`）
    - アイテム: 回復・最大HPクランプ・使用回数減算・回数0拒否
    - こうどう: 選択肢提示・メッセージ追加・効果反映・enemyAction 遷移（様子を見るは非攻撃）
    - にげる: RNG×成功確率で成否、成功=fled、失敗=ターン消費して enemyAction
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3, 8.4_
  - [ ]* 5.2 アイテム/こうどう/にげるのプロパティテスト
    - **Property 4: 未定義/無効コマンド拒否** / **Validates: Requirements 3.4, 6.5, 20.3**
    - **Property 8: 回復の上限クランプ** / **Validates: Requirements 6.2, 6.3, 6.4**
    - **Property 9: こうどうの非攻撃性と遷移** / **Validates: Requirements 7.1, 7.2, 7.4**
    - **Property 10: 逃走の決定性と確率域** / **Validates: Requirements 8.1, 8.2, 8.3, 8.4**

- [ ] 6. Enemy_AI（`src/domain/battle/enemyAI.ts`）
  - [ ] 6.1 `selectEnemyAction`・`generateBullets`・`resolveEnemyAction` を実装する
    - HP割合で通常/変化パターン集合切替（境界50%は変化後）、RNG で行動選択（決定的）、弾仕様生成、dodge 遷移、攻撃メッセージ
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 11.4, 18.2, 19.2_
  - [ ]* 6.2 敵行動のプロパティテスト
    - **Property 11: 敵行動の決定性とパターン切替**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5**

- [ ] 7. Dodge_Engine（`src/domain/battle/dodge.ts` と `battle.ts` の `tickDodge`）
  - [ ] 7.1 `moveSoul`・`advanceBullets`・`detectHit` を実装する
    - ソウル移動（速度×dt・境界クランプ・無入力/dt0で不変）、弾移動（速度×dt・画面外除去）、円当たり判定
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 11.1, 11.2, 11.3, 12.1_
  - [ ] 7.2 `tickDodge` を実装する（避けフェーズ統合）
    - 予兆時間・ソウル/弾更新・被弾検出・無敵中無効・被ダメージ（難易度係数＋ぼうぎょ軽減）・HPクランプ・無敵更新・終了判定（規定時間→commandSelect、HP0→lose）・不正dt無作用・HP低下メッセージ
    - _Requirements: 12.2, 12.3, 12.4, 12.5, 12.6, 13.1, 13.2, 13.3, 13.4, 15.1, 15.2, 18.3, 20.2, 20.4, 20.5_
  - [ ]* 7.3 避けフェーズのプロパティテスト
    - **Property 5: HP クランプ不変条件** / **Validates: Requirements 4.2, 6.3, 12.5, 15.1, 15.2**
    - **Property 12: ソウルの境界内不変条件** / **Validates: Requirements 10.1, 10.2, 10.3, 10.4**
    - **Property 13: 弾移動量と合流性** / **Validates: Requirements 11.1, 11.3**
    - **Property 14: 画面外除去の単調性** / **Validates: Requirements 11.2, 11.4**
    - **Property 15: 当たり判定の幾何** / **Validates: Requirements 12.1**
    - **Property 16: 無敵中の被ダメージ無効** / **Validates: Requirements 12.2, 12.3, 12.4, 20.2**
    - **Property 17: 避けフェーズ終了** / **Validates: Requirements 13.1, 13.2, 13.3, 13.4**
    - **Property 22: 不正経過時間の無作用** / **Validates: Requirements 20.5**

- [ ] 8. 演出メッセージ・例外処理の仕上げ
  - [ ] 8.1 メッセージ付与（開始/攻撃/HP低下/勝利/敗北）と重複防止・連打冪等を確認・補強する
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 20.1, 20.3_
  - [ ]* 8.2 演出・堅牢性のプロパティテスト
    - **Property 20: 演出メッセージの付与** / **Validates: Requirements 18.1, 18.2, 18.3, 18.4, 18.5**
    - **Property 23: 連打の冪等性** / **Validates: Requirements 20.3, 20.4**

- [ ] 9. 公開 API 集約（`src/domain/battle/index.ts`）
  - 各モジュールの公開関数・型を再エクスポートする
  - _Requirements: 1.1_

- [ ] 10. 敵定義サンプルと難易度・アイテム（`src/data/enemyContent.ts`）
  - MVP 用の敵 1 体（通常/変化パターン・こうどう選択肢・逃走確率・メッセージ）と、デモ用回復アイテム、既存 `Boss` との対応づけ（`Boss.id` → `EnemyDefinition`）を定義する
  - _Requirements: 1.1, 2.2, 2.3, 6.1, 7.1, 9.1_

- [ ] 11. 仮 UI（`Battle_View` 置き換え・`DodgePad`）
  - [ ] 11.1 旧 `src/ui/views/BattleView.tsx` / `BattleView.css` を削除し、新 `BattleView` を実装する
    - コマンドボタン・HP/メッセージ表示・避けエリア描画、`requestAnimationFrame` で `tickDodge` 駆動、Outcome 確定で `onWin`/`onClose`
    - _Requirements: 1.4, 2.7, 18.6_
  - [ ] 11.2 `DodgePad`（タッチ/キー → 方向ベクトル）と難易度選択 UI を実装する
    - モバイルのバーチャルパッド/ドラッグ、PC は矢印キー、無入力は {0,0}
    - _Requirements: 10.1, 19.2_

- [ ] 12. 既存ゲームへの結線（Battle_Session）と旧ドメイン削除
  - [ ] 12.1 旧 `src/domain/battle.ts` / `src/domain/battle.test.ts` を削除する
  - [ ] 12.2 `App.tsx` の結線を更新する
    - ボスバトル開始で新 `BattleView` を表示、`onWin` で既存 `SessionStore.defeatBoss`（→`resolveWin`→アンロック→称号）を実行、`onClose`（lose/fled）は無作用で閉じる
    - プレイヤー `totalStats` と敵定義・難易度を渡す
    - _Requirements: 17.1, 17.2, 17.3, 17.4_
  - [ ]* 12.3 結線テスト
    - win で `defeatBoss`/`resolveWin` 系、lose/fled で無作用が呼ばれること、バトルドメインが `PlayerState` を直接変更しないこと
    - _Requirements: 17.1, 17.2, 17.3, 17.4_

- [ ] 13. 動作確認とビルド
  - 型チェック・テスト・ビルドを通し、仮 UI でコマンド→敵行動→避け（タッチ移動）→被弾→勝敗の一連を手動確認する
  - _Requirements: 1.4_

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "3.2", "4.1"] },
    { "id": 3, "tasks": ["4.2", "6.1", "7.1"] },
    { "id": 4, "tasks": ["4.3", "5.1", "6.2", "7.2"] },
    { "id": 5, "tasks": ["5.2", "7.3", "8.1"] },
    { "id": 6, "tasks": ["8.2", "9"] },
    { "id": 7, "tasks": ["10", "11.1", "11.2"] },
    { "id": 8, "tasks": ["12.1", "12.2"] },
    { "id": 9, "tasks": ["12.3", "13"] }
  ]
}
```

## Notes

- 純粋ドメイン層（タスク 1〜9）を先に固め、各機能にプロパティテストを付ける。UI・結線（タスク 10〜13）は後段。
- 乱数は常に注入 `Rng`。テストは `fc.infiniteStream` で系列を固定し決定論的に検証する。
- リアルタイム性は `tickDodge(state, dtMs, inputDir, rng)` の純粋関数に閉じ込め、UI は `requestAnimationFrame` で駆動するのみ。
- 旧セミオート実装（`src/domain/battle.ts` / `battle.test.ts` / `src/ui/views/BattleView.tsx` / `BattleView.css`）はタスク 11.1・12.1 で削除・置き換える。
- `*` 付きサブタスクはテストタスク。本計画では各機能のテスト観点を満たすため実施を推奨。
- MVP は敵 1 体・仮 UI・最小アイテム。複数敵・凝った演出は対象外。
