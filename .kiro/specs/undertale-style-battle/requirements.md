# Requirements Document

## Introduction

本仕様は、既存の位置情報RPG「愛媛ロケーションRPG」（React + TypeScript + Vite、ドメインロジックは副作用なしの純粋関数 + fast-check プロパティテスト）に、アンダーテイル風のターン制バトルシステムを新規実装するための要件を定義する。以前検討した「セミオート・ターン制」案（既存の `battle.ts` / `battle.test.ts` / `BattleView.tsx` / `BattleView.css`）は破棄し、本仕様で置き換える。

バトルの基本ループは「プレイヤーのコマンド選択 → コマンド結果の発生 → 敵の行動 → 避けフェーズ → ダメージ判定 → 勝敗判定」である。避けフェーズはアンダーテイル同様のリアルタイム弾幕回避を含む。

本実装は段階的に進める。**MVP（最小実装）では単一の敵との戦闘のみを対象とし、UI は仮の見た目で動作確認を優先する。** 複数敵・凝った演出は将来フェーズに切り出す。

アーキテクチャ整合性の方針:
- バトルの判定ロジック（コマンド解決・ダメージ計算・弾の移動・当たり判定・フェーズ遷移・敵行動選択・勝敗判定）は副作用のない純粋関数として実装し、プロパティテストで検証する。
- 乱数は注入可能な RNG（`() => number`、`[0, 1)` を返す）で評価し、テストで決定論的に固定できる。
- リアルタイム性（弾の移動・経過時間）は「経過時間（ミリ秒）を引数に取る純粋関数」として表現し、アニメーションループ・入力・描画は presentational UI（`Battle_View`）が担う。
- 勝敗確定後の報酬付与・撃破記録は既存の `boss.ts` の `resolveWin` / `resolveLossOrAbandon` を流用し、結線は `SessionStore.defeatBoss` 相当の状態管理層が担う。バトルドメインは報酬付与・永続化を行わない。
- 敵の戦闘ステータスは既存 `Boss.stats`（`CharacterStats`）を流用し、未設定時は既定値にフォールバックする。プレイヤーの戦闘ステータスは既存 `totalStats`（レベル基礎 + 装備）を入力とする。

## Glossary

- **Battle_System**: バトル全体のフェーズ状態（`BattleState`）と遷移を管理する純粋ドメインモジュール。コマンド選択・敵行動・避け・ダメージ・勝敗の各フェーズ遷移を担う。
- **Command_System**: プレイヤーコマンド（こうげき・ぼうぎょ・アイテム・こうどう・にげる）を解決する純粋関数群。Battle_System の一部。
- **Enemy_AI**: 敵の次行動（攻撃パターン）を選択する純粋関数。注入された RNG と Battle_State を入力に行動を決定する。
- **Dodge_Engine**: 避けフェーズのリアルタイム処理を純粋関数で表現するモジュール。弾（Bullet）の位置更新、プレイヤー（Soul）の移動、当たり判定、無敵時間、フェーズ終了判定を担う。
- **Damage_Calculator**: 攻撃力・防御力・倍率・乱数からダメージ量を算出する純粋関数。
- **Difficulty_Config**: 難易度（Easy / Normal / Hard）ごとの戦闘パラメータ（弾速・弾数・予兆時間・ダメージ係数・プレイヤー移動速度）を保持する定義。
- **Battle_View**: バトル画面を描画する presentational UI コンポーネント。アニメーションループ・キー入力・効果描画を担い、判定は Battle_System / Dodge_Engine の純粋関数へ委譲する。
- **Battle_Session**: バトルの開始から勝敗確定後の報酬結線までを担う状態管理層（既存 `SessionStore` 相当）。`resolveWin` / `resolveLossOrAbandon` を呼び分ける。
- **BattleState**: バトルの全状態を表す不変データ（プレイヤーHP・敵HP・現在フェーズ・ターン・避け状態・ログ・勝敗結果など）。
- **Phase**: バトルの現在段階。`commandSelect`（コマンド選択）/ `enemyAction`（敵行動）/ `dodge`（避け）/ `resolve`（ダメージ判定）/ `ended`（決着）のいずれか。
- **Soul**: 避けフェーズで操作するプレイヤーの当たり判定オブジェクト（位置と当たり判定半径を持つ）。
- **Bullet**: 避けフェーズで敵が放つ弾（位置・速度・当たり判定半径を持つ）。
- **DodgeArea**: 避けフェーズの矩形領域（弾とソウルが移動できる境界）。
- **Outcome**: バトルの決着結果。`ongoing`（進行中）/ `win`（勝利）/ `lose`（敗北）/ `fled`（逃走成功）のいずれか。
- **InvincibilityWindow**: 被弾直後の無敵時間。この間は追加の被弾を受けない。
- **Combatant**: 戦闘参加者（プレイヤーまたは敵）の戦闘パラメータ（最大HP・現在HP・攻撃・防御・速度）。

## Requirements

### Requirement 1: MVP スコープ（単一の敵との戦闘）

**User Story:** 開発者として、まず単一の敵との戦闘だけを動作させたい。そうすれば小さく確実に検証しながら段階的に拡張できる。

#### Acceptance Criteria

1. WHEN バトルが開始される, THE Battle_System SHALL ちょうど 1 体の敵を持つ `BattleState` を生成する
2. THE Battle_System SHALL 1 つの `BattleState` につき 1 体の敵のみを保持する
3. WHERE 複数の敵・パーティ・敵の追加召喚が要求される場合, THE Battle_System SHALL それらを MVP スコープ外として扱い、本要件群では実装対象に含めない
4. THE Battle_View SHALL 仮の見た目（最小限のスタイル）でバトル画面を描画し、機能の動作確認を成立させる

**テスト観点:** `startBattle` の戻り値が常に単一敵を持つ（プロパティ: 任意のステータス入力に対し敵は 1 体）。

### Requirement 2: バトルの開始と初期状態

**User Story:** プレイヤーとして、ボスに挑むとバトルが始まり、双方のHPと初期画面が正しく表示されてほしい。

#### Acceptance Criteria

1. WHEN バトルが開始される, THE Battle_System SHALL プレイヤーの合計ステータス（`totalStats`: レベル基礎 + 装備）から `Combatant` を生成する
2. WHEN バトルが開始される, THE Battle_System SHALL 敵の `Boss.stats`（`CharacterStats`）から `Combatant` を生成する
3. IF 敵の `Boss.stats` が未設定である, THEN THE Battle_System SHALL 既定の戦闘ステータス（弱めの中ボス相当の固定値）を用いて `Combatant` を生成する
4. WHEN バトルが開始される, THE Battle_System SHALL プレイヤーと敵の現在HPをそれぞれの最大HPに等しい値で初期化する
5. WHEN バトルが開始される, THE Battle_System SHALL 現在 Phase を `commandSelect` に設定し、Outcome を `ongoing` に設定する
6. THE Battle_System SHALL すべての `Combatant` の最大HPを 1 以上の整数として生成する
7. THE Battle_View SHALL プレイヤーHP・敵HP・コマンド一覧・メッセージウィンドウ・避けエリアの各表示要素を画面に配置する

**テスト観点:** 初期 `BattleState` の不変条件（プロパティ: 現在HP == 最大HP、最大HP >= 1、Phase == `commandSelect`、Outcome == `ongoing`）。

### Requirement 3: コマンド選択フェーズ

**User Story:** プレイヤーとして、自分のターンに行動コマンドを選びたい。そうすれば戦い方を選択できる。

#### Acceptance Criteria

1. WHILE 現在 Phase が `commandSelect` である, THE Battle_System SHALL こうげき・ぼうぎょ・アイテム・こうどう・にげる の 5 コマンドを選択可能として提示する
2. WHEN プレイヤーがコマンドを選択する, THE Battle_System SHALL 選択されたコマンドの結果を解決し、続いて Phase を敵行動側（`enemyAction`）へ遷移させる
3. IF 現在 Phase が `commandSelect` 以外である状態でコマンド選択が要求される, THEN THE Battle_System SHALL 当該コマンドを適用せず、現在の `BattleState` を変更しない
4. IF 定義されていないコマンドが指定される, THEN THE Battle_System SHALL 当該入力を拒否し、現在の `BattleState` を変更しない

**テスト観点:** `commandSelect` 以外の Phase でのコマンド入力が状態不変であること（プロパティ）。未定義コマンドのエラー条件テスト。

### Requirement 4: こうげきコマンド

**User Story:** プレイヤーとして、こうげきで敵にダメージを与えたい。そうすれば敵を倒せる。

#### Acceptance Criteria

1. WHEN プレイヤーがこうげきを選択する, THE Command_System SHALL Damage_Calculator が算出したダメージ量を敵の現在HPから減算する
2. THE Command_System SHALL こうげきによる敵の現在HPを 0 未満にならないようにクランプする
3. WHEN こうげきによって敵の現在HPが 0 になる, THE Battle_System SHALL Outcome を `win` に設定し、Phase を `ended` に遷移させる
4. WHILE 敵の現在HPが 0 より大きい, THE Battle_System SHALL こうげき解決後に敵行動フェーズへ遷移させる

**テスト観点:** ダメージ適用後の敵HPが `[0, 最大HP]` に収まる（プロパティ）。敵HPが 0 になったとき Outcome == `win`（プロパティ）。

### Requirement 5: ぼうぎょコマンド

**User Story:** プレイヤーとして、ぼうぎょで次に受けるダメージを軽減したい。そうすればピンチをしのげる。

#### Acceptance Criteria

1. WHEN プレイヤーがぼうぎょを選択する, THE Command_System SHALL 直後の避けフェーズおよびダメージ判定で受ける被ダメージに 1 未満かつ 0 より大きい軽減係数を適用する状態を `BattleState` に記録する
2. WHEN ぼうぎょによる被ダメージ軽減が 1 回適用される, THE Battle_System SHALL 当該軽減状態を解除し、次ターン以降に持ち越さない
3. THE Command_System SHALL ぼうぎょ適用後の被ダメージを 1 以上の整数にクランプする

**テスト観点:** ぼうぎょ時の被ダメージ <= 非ぼうぎょ時の同条件被ダメージ（メタモルフィック・プロパティ）。軽減が次ターンに持ち越さないこと。

### Requirement 6: アイテムコマンド

**User Story:** プレイヤーとして、アイテムを使ってHPを回復したい。そうすれば戦闘を継続できる。

#### Acceptance Criteria

1. WHILE 現在 Phase が `commandSelect` である, THE Command_System SHALL バトルで使用可能なアイテムの一覧を提示する
2. WHEN プレイヤーが回復アイテムを使用する, THE Command_System SHALL 当該アイテムの回復量をプレイヤーの現在HPに加算する
3. THE Command_System SHALL アイテムによる回復後のプレイヤー現在HPを最大HPを上限としてクランプする
4. WHEN 回復アイテムが使用される, THE Command_System SHALL 当該アイテムの残り使用可能回数を 1 減算する
5. IF 残り使用可能回数が 0 のアイテムの使用が要求される, THEN THE Command_System SHALL 当該使用を拒否し、プレイヤーの現在HPと `BattleState` を変更しない

**テスト観点:** 回復後HPが最大HPを超えない（プロパティ: 回復量・現在HPが任意でも上限クランプ）。使用回数 0 での使用拒否（エラー条件）。

### Requirement 7: こうどうコマンド（様子を見る・会話分岐）

**User Story:** プレイヤーとして、敵の様子を見たり会話したりして戦闘を有利にしたい。そうすればアンダーテイル風の駆け引きを楽しめる。

#### Acceptance Criteria

1. WHEN プレイヤーがこうどうを選択する, THE Command_System SHALL 当該敵に定義されたこうどう選択肢（様子を見る・会話分岐など）を提示する
2. WHEN プレイヤーが「様子を見る」を選択する, THE Command_System SHALL 当該敵のステータスまたは状況を説明するメッセージを `BattleState` のログへ追加する
3. WHERE こうどうが戦闘条件に影響する選択肢である, THE Command_System SHALL 当該こうどうに定義された効果（被ダメージ・敵行動・勝敗条件への影響）を `BattleState` に反映する
4. WHEN こうどうが解決される, THE Battle_System SHALL こうどう解決後に敵行動フェーズへ遷移させる

**テスト観点:** こうどう解決が敵HPを増減させない（様子を見るは非攻撃である不変条件）。こうどう適用後に必ず `enemyAction` へ遷移すること。

### Requirement 8: にげるコマンド

**User Story:** プレイヤーとして、勝てそうにないときは逃走したい。そうすれば全滅を避けられる。

#### Acceptance Criteria

1. WHEN プレイヤーがにげるを選択する, THE Command_System SHALL 注入された RNG の値と逃走成功確率を比較して逃走の成否を判定する
2. WHEN 逃走判定が成功する, THE Battle_System SHALL Outcome を `fled` に設定し、Phase を `ended` に遷移させる
3. IF 逃走判定が失敗する, THEN THE Battle_System SHALL 逃走失敗ペナルティとして当該ターンのプレイヤーのこうげき機会を消費し、敵行動フェーズへ遷移させる
4. THE Command_System SHALL 逃走成功確率を 0 以上 1 以下の値として算出する

**テスト観点:** RNG を固定したときの逃走成否の決定性（モデルベース）。確率が `[0, 1]` に収まる（プロパティ）。

### Requirement 9: 敵の行動フェーズ

**User Story:** プレイヤーとして、自分の行動後に敵が反撃してきてほしい。そうすれば戦闘に緊張感が生まれる。

#### Acceptance Criteria

1. WHEN 現在 Phase が `enemyAction` になる, THE Enemy_AI SHALL 当該敵の行動パターン集合から次の行動を 1 つ選択する
2. WHILE 敵の現在HPが最大HPの 50% より大きい, THE Enemy_AI SHALL 通常時の行動パターン集合から行動を選択する
3. WHILE 敵の現在HPが最大HPの 50% 以下である, THE Enemy_AI SHALL 変化後の行動パターン集合から行動を選択する
4. THE Enemy_AI SHALL 注入された RNG を用いて行動を選択し、同一の RNG 系列と `BattleState` に対して決定論的に同一の行動を返す
5. WHEN 敵の行動が決定される, THE Battle_System SHALL 当該行動に対応する弾配置パラメータを生成し、Phase を `dodge`（避けフェーズ）へ遷移させる

**テスト観点:** 同一 RNG・同一 `BattleState` で敵行動が一致する（決定性プロパティ）。HP 50% 境界での行動パターン集合切替（境界値テスト）。

### Requirement 10: 避けフェーズ — ソウル移動

**User Story:** プレイヤーとして、避けフェーズでソウルを動かして弾を回避したい。そうすれば被ダメージを抑えられる。

#### Acceptance Criteria

1. WHILE 現在 Phase が `dodge` である, THE Dodge_Engine SHALL プレイヤーの入力方向と Difficulty_Config のプレイヤー移動速度に基づき、経過時間に比例して Soul の位置を更新する
2. THE Dodge_Engine SHALL Soul の位置を DodgeArea の境界内にクランプし、境界を越える移動を境界上で停止させる
3. WHEN 入力方向が与えられない, THE Dodge_Engine SHALL Soul の位置を変化させない
4. THE Dodge_Engine SHALL Soul の位置更新を、経過時間（ミリ秒）を引数に取る純粋関数として算出する

**テスト観点:** 任意の入力・経過時間に対し Soul が常に DodgeArea 内に収まる（不変条件プロパティ）。経過時間 0 で位置不変。移動距離 == 速度 × 経過時間（境界クランプ前）。

### Requirement 11: 避けフェーズ — 弾の移動と画面外処理

**User Story:** プレイヤーとして、敵の弾が決まった速度で動き、画面外に出た弾は消えてほしい。そうすれば回避の見通しが立つ。

#### Acceptance Criteria

1. WHILE 現在 Phase が `dodge` である, THE Dodge_Engine SHALL 各 Bullet の位置を、その速度ベクトルと経過時間（ミリ秒）に比例して更新する
2. WHEN Bullet が DodgeArea の境界を完全に越える, THE Dodge_Engine SHALL 当該 Bullet をアクティブな弾集合から除外する
3. THE Dodge_Engine SHALL 弾の位置更新を、経過時間（ミリ秒）と弾集合を引数に取る純粋関数として算出する
4. THE Dodge_Engine SHALL 弾速・弾数・予兆時間を Difficulty_Config から取得した値に基づいて決定する

**テスト観点:** 弾の移動量 == 速度 × 経過時間（プロパティ）。画面外判定後にアクティブ弾数が単調減少（不変条件）。Confluence: 経過時間の分割適用（Δt を 2 回）と一括適用が同一結果。

### Requirement 12: 避けフェーズ — 当たり判定・被ダメージ・無敵時間

**User Story:** プレイヤーとして、弾に当たるとHPが減り、被弾直後は短時間無敵になってほしい。そうすれば理不尽な連続被弾を避けられる。

#### Acceptance Criteria

1. WHEN Soul の当たり判定円と Bullet の当たり判定円が重なる, THE Dodge_Engine SHALL 当該被弾を検出する
2. WHEN 被弾が検出され、かつ InvincibilityWindow が無効である, THE Dodge_Engine SHALL Difficulty_Config のダメージ係数に基づく被ダメージをプレイヤーの現在HPから減算する
3. WHEN 被ダメージが適用される, THE Dodge_Engine SHALL 定義された無敵時間ぶん InvincibilityWindow を有効化する
4. WHILE InvincibilityWindow が有効である, THE Dodge_Engine SHALL 追加の被弾による被ダメージを適用しない
5. THE Dodge_Engine SHALL 被ダメージ適用後のプレイヤー現在HPを 0 未満にならないようにクランプする
6. IF 直前のターンでぼうぎょが選択されている, THEN THE Dodge_Engine SHALL 被ダメージに Requirement 5 の軽減係数を適用する

**テスト観点:** 2 円の距離 <= 半径和のとき被弾検出（プロパティ: 幾何的当たり判定）。無敵中は被ダメージ 0（不変条件）。被ダメージ後HP >= 0。

### Requirement 13: 避けフェーズ — 終了条件

**User Story:** プレイヤーとして、避けフェーズが一定時間で終わり、次の自分のターンに戻ってほしい。そうすればテンポよく戦える。

#### Acceptance Criteria

1. WHEN 避けフェーズの累積経過時間が当該ターンの規定時間に達する, THE Dodge_Engine SHALL 避けフェーズを終了する
2. WHEN プレイヤーの現在HPが避けフェーズ中に 0 になる, THE Dodge_Engine SHALL 避けフェーズを途中終了し、Battle_System の Outcome を `lose` に設定する
3. WHEN 避けフェーズが規定時間到達で終了する AND Outcome が `ongoing` である, THE Battle_System SHALL Phase を `commandSelect` に遷移させる
4. THE Dodge_Engine SHALL 1 ターンの避け時間を Difficulty_Config の予兆時間・弾数とは独立した規定時間として保持する

**テスト観点:** 累積時間 >= 規定時間で必ず終了（プロパティ）。HP 0 到達で `lose` かつ途中終了（境界値）。

### Requirement 14: ダメージ計算

**User Story:** 開発者として、ダメージ計算が一貫した式で行われてほしい。そうすればバランス調整とテストが容易になる。

#### Acceptance Criteria

1. THE Damage_Calculator SHALL 攻撃側の攻撃力・防御側の防御力・倍率・注入された RNG による分散から被ダメージを算出する
2. THE Damage_Calculator SHALL 算出するダメージを 1 以上の整数にクランプする
3. WHERE クリティカルが発生する条件を満たす, THE Damage_Calculator SHALL 定義されたクリティカル倍率を基本ダメージに乗算する
4. THE Damage_Calculator SHALL 同一の入力（攻撃力・防御力・倍率・RNG 値）に対して同一のダメージを返す

**テスト観点:** ダメージ >= 1（プロパティ）。攻撃力単調性（攻撃力増 → ダメージ非減少、メタモルフィック）。RNG 固定時の決定性（モデルベース）。

### Requirement 15: HP と最大HP

**User Story:** プレイヤーとして、HPが正しく管理され、回復や被弾で上限・下限を超えないでほしい。そうすれば表示と挙動が信頼できる。

#### Acceptance Criteria

1. THE Battle_System SHALL プレイヤーと敵の現在HPを常に 0 以上かつ各自の最大HP以下の整数として保持する
2. WHEN 現在HPを増減させる操作が行われる, THE Battle_System SHALL 結果を `[0, 最大HP]` の範囲にクランプする
3. WHEN いずれかの Combatant の現在HPが 0 に達する, THE Battle_System SHALL Outcome を勝敗確定状態（`win` または `lose`）に設定する

**テスト観点:** 任意の操作列の後でも現在HP ∈ `[0, 最大HP]`（不変条件プロパティ）。

### Requirement 16: 勝敗判定

**User Story:** プレイヤーとして、敵を倒せば勝ち、自分が倒れれば負けと正しく判定してほしい。そうすれば戦闘の決着が明確になる。

#### Acceptance Criteria

1. WHEN 敵の現在HPが 0 になる, THE Battle_System SHALL Outcome を `win` に設定する
2. WHEN プレイヤーの現在HPが 0 になる, THE Battle_System SHALL Outcome を `lose` に設定する
3. WHILE Outcome が `ongoing` 以外である, THE Battle_System SHALL 以降のコマンド入力・フェーズ遷移を適用せず、`BattleState` を変更しない
4. IF プレイヤーと敵の現在HPが同一の解決内で同時に 0 になる, THEN THE Battle_System SHALL Outcome を `win` に設定する

**テスト観点:** 決着後の入力が状態不変（冪等性プロパティ）。同時 0 の優先順位（境界値・曖昧性解消）。

### Requirement 17: 勝敗確定後の報酬・記録の結線

**User Story:** プレイヤーとして、ボスに勝ったら既存の報酬・撃破記録・称号評価がこれまで通り反映されてほしい。そうすればバトルがゲーム進行に繋がる。

#### Acceptance Criteria

1. WHEN Outcome が `win` に確定する, THE Battle_Session SHALL 既存の `resolveWin` を呼び出して報酬付与・撃破記録を確定させる
2. WHEN Outcome が `lose` または `fled` に確定する, THE Battle_Session SHALL 既存の `resolveLossOrAbandon` を呼び出し、報酬付与・撃破記録を行わない
3. THE Battle_System SHALL 報酬付与・永続化・称号評価を自身では行わず、`Battle_Session`（状態管理層）へ委譲する
4. WHEN `resolveWin` が完了する, THE Battle_Session SHALL 既存のアンロック・称号評価の結線（`SessionStore.defeatBoss` 相当）を実行する

**テスト観点:** `win` で `resolveWin` が、`lose`/`fled` で `resolveLossOrAbandon` が呼ばれる結線テスト（モデルベース・統合）。バトルドメインが `PlayerState` を直接変更しないこと。

### Requirement 18: 会話・演出メッセージ

**User Story:** プレイヤーとして、戦闘開始・攻撃・HP低下・勝利・敗北の各場面でセリフや演出を見たい。そうすればアンダーテイル風の雰囲気を楽しめる。

#### Acceptance Criteria

1. WHEN バトルが開始される, THE Battle_System SHALL 当該敵の戦闘開始メッセージを `BattleState` のログへ追加する
2. WHEN プレイヤーまたは敵が攻撃を行う, THE Battle_System SHALL 当該攻撃に対応するメッセージを `BattleState` のログへ追加する
3. WHEN プレイヤーの現在HPが最大HPの規定割合以下に低下する, THE Battle_System SHALL HP低下時メッセージを `BattleState` のログへ追加する
4. WHEN Outcome が `win` に確定する, THE Battle_System SHALL 勝利時メッセージを `BattleState` のログへ追加する
5. WHEN Outcome が `lose` に確定する, THE Battle_System SHALL 敗北時メッセージを `BattleState` のログへ追加する
6. THE Battle_View SHALL `BattleState` のログのメッセージをメッセージウィンドウへ表示する

**テスト観点:** 各イベント発生時に対応メッセージがログへ 1 件追加される（プロパティ）。MVP では演出はテキストログで代替可。

### Requirement 19: 難易度設定

**User Story:** プレイヤーとして、難易度を選んで弾幕や被ダメージの厳しさを変えたい。そうすれば自分に合った歯ごたえで遊べる。

#### Acceptance Criteria

1. THE Difficulty_Config SHALL Easy・Normal・Hard の 3 段階を定義する
2. WHEN 難易度が選択される, THE Battle_System SHALL 当該難易度の弾速・弾数・予兆時間・ダメージ係数・プレイヤー移動速度を採用する
3. THE Difficulty_Config SHALL 弾速・弾数・ダメージ係数について Easy <= Normal <= Hard の単調関係を満たす値を保持する
4. THE Difficulty_Config SHALL プレイヤー移動速度について Easy >= Normal >= Hard の単調関係を満たす値を保持する
5. THE Difficulty_Config SHALL 予兆時間について Easy >= Normal >= Hard の単調関係を満たす値を保持する

**テスト観点:** 3 難易度間のパラメータ単調性（プロパティ・順序検証）。難易度切替が弾・被ダメージ計算に反映されること。

### Requirement 20: 例外処理・堅牢性

**User Story:** プレイヤーとして、コマンド選択中の誤操作や連打、画面外の弾、一時停止で戦闘が壊れないでほしい。そうすれば安心してプレイできる。

#### Acceptance Criteria

1. WHILE 現在 Phase が `commandSelect` 以外である, THE Battle_System SHALL コマンド選択操作を受け付けず、`BattleState` を変更しない
2. WHEN 同一フレーム内または無敵時間中に複数の被弾入力が発生する, THE Dodge_Engine SHALL Requirement 12 の無敵時間規則に従い被ダメージを 1 回分のみ適用する
3. WHEN 同一コマンドが連続して短時間に複数回入力される, THE Battle_System SHALL 当該ターンに対して 1 回分のコマンドのみを適用し、残りの重複入力を無視する
4. WHEN バトルが一時停止される, THE Battle_System SHALL 避けフェーズの経過時間・弾位置・Soul位置を停止時点の値で保持し、再開時に同一状態から継続する
5. IF 経過時間として負の値または非有限値が与えられる, THEN THE Dodge_Engine SHALL 当該更新を経過時間 0 として扱い、位置・HPを変化させない

**テスト観点:** 不正な経過時間（負・NaN・Infinity）で状態不変（エラー条件プロパティ）。連打で 1 回のみ適用（冪等性）。一時停止→再開で状態保存（round-trip）。
