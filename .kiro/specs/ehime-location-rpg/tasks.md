# Implementation Plan: Ehime Location RPG（実装計画）

## Overview

本計画は、設計書のレイヤードアーキテクチャ（UI 層 / 状態管理層 / 純粋ドメインロジック層 / Location_Service / Repository 層）に沿って、MVP（Requirements 1〜12）をインクリメンタルに構築するコーディングタスク群です。技術スタックは React + TypeScript、プロパティベーステストは fast-check（最低100回反復）を使用します。

実装は「純粋ドメインロジック層」を最初に構築し、各ドメインモジュールに対して設計書の Correctness Properties（Property 1〜35）をプロパティベーステストとして書きます。続いて Repository 層・永続化／再試行・Location_Service・状態管理層・UI 層を実装し、最後にすべてを結線します。

後期フェーズ機能（Requirements 13〜17 / Property 36〜47）は MVP の完了要件ではなく、本計画の末尾に「後期フェーズ（参考）」として記載するに留めます。MVP 完了に必須ではありません。

- `*` が付いたサブタスクは任意（テスト関連）であり、MVP を素早く動かす場合はスキップ可能です。
- 各タスクは設計書のインターフェースと要求番号を参照します。
- プロパティテストは各プロパティを個別のサブタスクとして実装し、設計書のプロパティ番号と検証対象の要求番号を明記します。

## Tasks

- [x] 1. プロジェクト基盤のセットアップ
  - React + TypeScript プロジェクトを Vite で初期化し、モバイルファーストのビルド設定を行う
  - テストフレームワーク（Vitest）と fast-check を依存に追加し、最低100回反復の既定設定を用意する
  - Vercel デプロイ設定（`vercel.json` とビルドコマンド）を追加する
  - ディレクトリ構成を作成する（`src/domain`, `src/repository`, `src/services`, `src/state`, `src/ui`, `src/test`）
  - _Requirements: 12.1, 12.2_

- [x] 2. 中核データモデルと型定義
  - [x] 2.1 ドメイン型を定義する（`src/domain/types.ts`）
    - `Result<T, E>`, `ISODateTime`, `Position`, `Spot`, `Region`, `Stamp`, `QuestDefinition`, `QuestProgress`, `ShopItem`, `EquipmentSlot`, `Boss`, `RegionalEvent`, `PlayerState`, `RewardGrant`, `CharacterStats`, `ItemCatalog` を設計書 Data Models に従って定義する
    - 新規プレイヤーの初期 `PlayerState`（level 1 相当、経験値0、解放地域は最初の1つのみ）を生成するファクトリ関数を実装する
    - _Requirements: 1.8, 3.2, 4.1, 5.3, 6.1, 7.1, 8.5, 9.1, 10.2, 11.4_

  - [ ]* 2.2 共有テストジェネレータを実装する（`src/test/generators.ts`）
    - fast-check 用のジェネレータを用意する: `Spot`（半径20〜200m）, `QuestDefinition`（必須スポット1〜100 または カウント1〜100）, `ShopItem`（価格1〜999,999,999・効果説明280文字以内）, `Boss`（単一バインド・限定アイテム1個以上）, `Position`（緯度経度・精度）, `PlayerState`
    - エッジケース（精度ちょうど50m、半径境界、経験値0/最大、コレクション総数0、距離の100m境界、非ASCII文字列）を含める
    - _Requirements: 1.8, 4.1, 7.1, 9.1_

- [x] 3. Location ドメインロジックと Spot_Manager
  - [x] 3.1 スポット入場判定を実装する（`src/domain/location.ts`）
    - 純粋関数 `resolveSpotPresence(position, spots)` を実装する。精度50m超は破棄して null、`Entry_Radius` 内が無ければ null、複数該当時は中心が最も近いスポットのみ返す
    - _Requirements: 1.2, 1.3, 1.4, 1.5_

  - [x] 3.2 Spot_Manager と Spot 定義検証を実装する（`src/domain/spotManager.ts`）
    - `getSpot`, `listSpots`, `listRegions`, `getUnlockOrder` を実装し、`Entry_Radius` が 20〜200m の範囲外の Spot 定義を拒否する検証を行う
    - _Requirements: 1.8, 10.1_

  - [ ]* 3.3 Location 入場判定のプロパティテスト
    - **Property 1: スポット入場判定の正当性**
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5**

  - [ ]* 3.4 Spot 半径制約のプロパティテスト
    - **Property 2: スポット半径定義の制約**
    - **Validates: Requirements 1.8**

- [x] 4. Stamp_System の実装
  - [x] 4.1 スタンプ付与・集計を実装する（`src/domain/stamp.ts`）
    - `grantStampIfAbsent(state, spotId, now)` を実装する。未取得なら1枚付与、既取得なら据え置き（`spotId`/`earnedAt` 不変）
    - `getStampSummary(state, totalSpots)` で取得数/総数を集計する
    - _Requirements: 3.1, 3.3, 3.5_

  - [ ]* 4.2 スタンプ付与の冪等性プロパティテスト
    - **Property 6: スタンプ付与の冪等性**
    - **Validates: Requirements 3.1, 3.3**

  - [ ]* 4.3 スタンプ集計のプロパティテスト
    - **Property 7: スタンプ集計の範囲不変条件**
    - **Validates: Requirements 3.5**

- [x] 5. Quest_System の実装
  - [x] 5.1 クエスト進行・完了・表示を実装する（`src/domain/quest.ts`）
    - `applyStamp(quest, spotId)` で相異なる必須スポットのみ進行を加算する
    - `isComplete(quest)` で満たした条件数==必要条件数の同値判定を行う
    - `getDisplay(quest)` で現在数・必要数・残り未達条件を返す
    - _Requirements: 4.2, 4.3, 4.4, 4.7, 4.8_

  - [ ]* 5.2 クエスト進行の相異カウントのプロパティテスト
    - **Property 8: クエスト進行の相異カウント**
    - **Validates: Requirements 4.2, 4.3**

  - [ ]* 5.3 クエスト完了同値条件のプロパティテスト
    - **Property 9: クエスト完了の同値条件**
    - **Validates: Requirements 4.4, 4.8**

- [x] 6. Reward_Engine の実装
  - [x] 6.1 報酬計算と適用を実装する（`src/domain/reward.ts`）
    - `computeWalkReward(pendingMeters, addedMeters)` で完了100mごとに1コイン、剰余を繰り越す
    - `applyReward(state, grant)` でコイン・経験値・アイテムを加算する（純粋・I/O なし）
    - 報酬源（初回訪問・ボス撃破・クエスト完了）のコイン/経験値が 0 以上であることを保証する
    - クエスト完了報酬を一度だけ付与する制御（`rewardGranted` フラグ）を実装する
    - _Requirements: 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ]* 6.2 歩行コイン累積計算のプロパティテスト
    - **Property 11: 歩行コインの累積計算**
    - **Validates: Requirements 5.1, 5.2**

  - [ ]* 6.3 報酬適用の加算不変条件のプロパティテスト
    - **Property 12: 報酬適用の加算不変条件**
    - **Validates: Requirements 5.3, 5.4, 5.5**

  - [ ]* 6.4 報酬の非負性のプロパティテスト
    - **Property 13: 報酬の非負性**
    - **Validates: Requirements 5.6**

  - [ ]* 6.5 クエスト報酬の一度限り付与のプロパティテスト
    - **Property 10: クエスト報酬の一度限り付与**
    - **Validates: Requirements 4.5**

- [ ] 7. Checkpoint - ここまでのテストを確認
  - すべてのテストが通ることを確認し、疑問があればユーザーに確認する。

- [ ] 8. Character_System の実装
  - [ ] 8.1 レベル・経験値ロジックを実装する（`src/domain/character.ts`）
    - `levelForExperience(experience)` を実装する（1〜99 に丸め、単調・有界）
    - `addExperience(state, delta)` を実装する。結果が0未満になる操作は `Result` 失敗で拒否し直前値を保持する
    - `getProgressDisplay(state)` を実装する。99未満は次レベル必要経験値、99 は最大到達表示
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.6_

  - [ ] 8.2 装備管理とステータス合成を実装する（同 `src/domain/character.ts`）
    - `equip(state, itemId)` で所持・スロット適合を検証し、スロットの有効アイテムを唯一化（旧装備を解除）する。無効操作は `Result` 失敗で拒否する
    - `computeStats(state, items)` で全有効装備のステータス効果を合算し、空スロットは効果を寄与しない
    - 所持装備のスロット別グルーピング表示用関数を実装する（空スロットは空状態表示）
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.7, 8.8_

  - [ ]* 8.3 レベル導出の単調・有界性のプロパティテスト
    - **Property 14: レベル導出の単調・有界性**
    - **Validates: Requirements 6.1, 6.2**

  - [ ]* 8.4 レベル表示内容のプロパティテスト
    - **Property 15: レベル表示内容**
    - **Validates: Requirements 6.4, 6.5**

  - [ ]* 8.5 経験値の非負拒否のプロパティテスト
    - **Property 16: 経験値の非負拒否**
    - **Validates: Requirements 6.6**

  - [ ]* 8.6 装備付け替え（スロット唯一性）のプロパティテスト
    - **Property 20: 装備の付け替え（スロット唯一性）**
    - **Validates: Requirements 8.3**

  - [ ]* 8.7 無効な装備操作の拒否のプロパティテスト
    - **Property 21: 無効な装備操作の拒否**
    - **Validates: Requirements 8.4**

  - [ ]* 8.8 装備グルーピングのプロパティテスト
    - **Property 22: 装備グルーピングの正当性**
    - **Validates: Requirements 8.1**

  - [ ]* 8.9 ステータス合成のプロパティテスト
    - **Property 23: ステータス合成の正当性**
    - **Validates: Requirements 8.7, 8.8**

- [ ] 9. Shop の実装
  - [ ] 9.1 ショップ一覧と購入処理を実装する（`src/domain/shop.ts`）
    - `listPurchasable(catalog)` で `isLimited` のアイテム（Limited_Item）を一覧から除外する
    - `purchase(state, item)` で残高>=価格なら控除・所持追加、残高不足なら `Result` 失敗で拒否し状態不変とする
    - _Requirements: 7.1, 7.2, 7.3, 7.5_

  - [ ]* 9.2 購入成功時の更新のプロパティテスト
    - **Property 17: 購入成功時の残高と所持の更新**
    - **Validates: Requirements 7.2**

  - [ ]* 9.3 コイン不足時の購入拒否のプロパティテスト
    - **Property 18: コイン不足時の購入拒否**
    - **Validates: Requirements 7.3**

  - [ ]* 9.4 限定アイテムのショップ除外のプロパティテスト
    - **Property 19: 限定アイテムのショップ除外**
    - **Validates: Requirements 7.5**

- [ ] 10. Boss_System の実装
  - [ ] 10.1 ボス可用性とバトル解決を実装する（`src/domain/boss.ts`）
    - `isAvailable(boss, visited)` でボスが紐づく Spot/Region への入場済み判定を行う
    - `resolveWin(state, boss)` で Reward_Engine 経由の報酬付与と撃破記録を行い、Limited_Item は未取得時のみ付与する
    - 敗北・中断は撃破記録せず報酬付与なし・可用維持となる解決を実装する
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.6, 9.7_

  - [ ]* 10.2 ボス可用性の同値条件のプロパティテスト
    - **Property 24: ボス可用性の同値条件**
    - **Validates: Requirements 9.2, 9.7**

  - [ ]* 10.3 ボス勝利時の付与と撃破記録のプロパティテスト
    - **Property 25: ボス勝利時の付与と撃破記録**
    - **Validates: Requirements 9.3**

  - [ ]* 10.4 限定アイテムの重複排除のプロパティテスト
    - **Property 26: 限定アイテムの重複排除**
    - **Validates: Requirements 9.4**

  - [ ]* 10.5 敗北・中断の無作用のプロパティテスト
    - **Property 27: 敗北・中断の無作用**
    - **Validates: Requirements 9.6**

- [ ] 11. Checkpoint - ここまでのテストを確認
  - すべてのテストが通ることを確認し、疑問があればユーザーに確認する。

- [ ] 12. Map_System の実装
  - [ ] 12.1 マーカー生成と情報秘匿を実装する（`src/domain/map.ts`）
    - `getVisibleMarkers(state, spots)` で解放済み Region 内かつ解放済み Spot のマーカー集合を返す
    - ロックスポットのマーカー／選択ペイロードが名前・説明・報酬詳細を含まないよう秘匿し、解放スポットは名前・説明・訪問状態を返す
    - _Requirements: 2.2, 2.3, 2.4, 2.5_

  - [ ] 12.2 地域アンロックロジックを実装する（同 `src/domain/map.ts`）
    - `canUnlockNext(state)` で次のロック Region の解放条件充足を判定する
    - `unlockRegion(state, regionId)` でアンロック順序上の次の Region をちょうど1つ解放する（永続化成功後に確定する前提）
    - 解放条件未達の Region はロック維持・侵入不可とする
    - _Requirements: 10.3, 10.7_

  - [ ]* 12.3 解放スポットのマーカー対応のプロパティテスト
    - **Property 3: 解放スポットのマーカー対応**
    - **Validates: Requirements 2.2**

  - [ ]* 12.4 ロックスポットの情報秘匿のプロパティテスト
    - **Property 4: ロックスポットの情報秘匿**
    - **Validates: Requirements 2.3, 2.5**

  - [ ]* 12.5 解放スポット詳細表示のプロパティテスト
    - **Property 5: 解放スポット詳細の表示内容**
    - **Validates: Requirements 2.4**

  - [ ]* 12.6 アンロック順序の構造不変条件のプロパティテスト
    - **Property 28: 地域アンロック順序の構造不変条件**
    - **Validates: Requirements 10.1**

  - [ ]* 12.7 新規アカウント初期アンロックのプロパティテスト
    - **Property 29: 新規アカウントの初期アンロック**
    - **Validates: Requirements 10.2**

  - [ ]* 12.8 アンロックの単調性・侵入不可のプロパティテスト
    - **Property 30: アンロックの単調性とロック地域の侵入不可**
    - **Validates: Requirements 10.3, 10.7**

- [ ] 13. Title_System と Collection_System の実装
  - [ ] 13.1 称号付与を実装する（`src/domain/title.ts`）
    - `grantIfEarned(state, title)` で条件充足かつ未付与なら付与、既付与なら据え置き（称号集合不変）とする
    - _Requirements: 11.1, 11.2, 11.3_

  - [ ] 13.2 コレクション集計を実装する（`src/domain/collection.ts`）
    - `getProgress(collection, state)` で取得数/総数（0〜総数）を集計する
    - `isComplete(collection, state)` で総数>=1 かつ取得==総数の同値判定を行い、総数0は常に未完了とする
    - _Requirements: 11.6, 11.7, 11.8_

  - [ ]* 13.3 称号付与の冪等性のプロパティテスト
    - **Property 31: 称号付与の冪等性**
    - **Validates: Requirements 11.2, 11.3**

  - [ ]* 13.4 コレクション進捗の範囲不変条件のプロパティテスト
    - **Property 32: コレクション進捗の範囲不変条件**
    - **Validates: Requirements 11.6**

  - [ ]* 13.5 コレクション完了の同値条件のプロパティテスト
    - **Property 33: コレクション完了の同値条件**
    - **Validates: Requirements 11.7, 11.8**

- [ ] 14. Repository 層と永続化シリアライズ
  - [ ] 14.1 PlayerState のシリアライズ／デシリアライズを実装する（`src/repository/serialization.ts`）
    - コイン・経験値・スタンプ（`spotId`/`earnedAt`）・所持アイテム・スロット別有効装備・撃破済みボス・付与済み限定アイテム・称号・解放済み地域を保存・復元する
    - _Requirements: 3.2, 7.4, 8.5, 9.5, 11.4_

  - [ ] 14.2 User_Data_Store クライアントを実装する（`src/repository/userDataStore.ts`）
    - `load(playerId)` と `persist(playerId, state)` を AWS バックエンド API に対して実装し、失敗を例外で通知する
    - _Requirements: 5.5, 12.6_

  - [ ]* 14.3 プレイヤー状態の永続化ラウンドトリップのプロパティテスト
    - **Property 35: プレイヤー状態の永続化ラウンドトリップ**
    - **Validates: Requirements 3.2, 7.4, 8.5, 9.5, 11.4**

- [ ] 15. 状態管理層（楽観的更新・再試行キュー・永続化失敗処理）
  - [ ] 15.1 永続化失敗時の状態保全と再試行キューを実装する（`src/state/persistenceController.ts`）
    - ロールバック型操作（スタンプ・報酬・装備・地域アンロック・称号）は永続化成功まで確定とせず、失敗時は直前の永続済み状態へ復元しエラー指示を返す
    - 再試行型操作（購入・地域アンロック）はセッション状態に保留項目を保持し、次回同期で最大3回まで再試行する。3回連続失敗後も保留項目を保全する
    - _Requirements: 3.4, 4.6, 5.7, 7.6, 7.7, 8.6, 10.4, 10.5, 11.5_

  - [ ] 15.2 ドメイン操作を結線するセッション状態ストアを実装する（`src/state/store.ts`）
    - セッション状態を保持し、各ドメイン関数（stamp/quest/reward/character/shop/boss/map/title/collection）を呼び出して次状態を計算し、永続化コントローラへ受け渡す
    - 地域アンロックは永続化確定後に通知を発行する（通知順序の保証）
    - _Requirements: 3.1, 4.5, 7.2, 8.3, 9.3, 10.3, 10.6, 11.2_

  - [ ]* 15.3 永続化失敗時の状態保全と再試行上限のプロパティテスト
    - **Property 34: 永続化失敗時の状態保全と再試行上限**
    - **Validates: Requirements 3.4, 4.6, 5.7, 7.6, 7.7, 8.6, 10.5, 11.5**

  - [ ]* 15.4 状態管理層のユニットテスト
    - アンロック永続化後の通知順序（Req 10.4, 10.6）、購入確定メッセージ（Req 7.8）、スタンプ保存失敗表示（Req 3.4）のエッジケースを検証する
    - _Requirements: 3.4, 7.8, 10.4, 10.6_

- [ ] 16. Location_Service（Geolocation ラッパ）
  - [ ] 16.1 Geolocation ラッパを実装する（`src/services/locationService.ts`）
    - `getCurrentPosition()` でブラウザ Geolocation を取得し、精度50m超を破棄する。`resolveSpotPresence`（ドメイン）へ位置を受け渡す
    - 権限拒否時はスタンプ獲得に位置が必要である旨のメッセージ用エラーを返す
    - 30秒以内に精度50m以内を取得できない場合は再試行用の状態を返し、既存のスポット入場状態を保持する
    - _Requirements: 1.1, 1.6, 1.7_

  - [ ]* 16.2 Location_Service のユニットテスト
    - 権限拒否メッセージ（Req 1.6）、タイムアウト再試行と入場状態保持（Req 1.7）をモックで検証する
    - _Requirements: 1.6, 1.7_

- [ ] 17. Checkpoint - ドメイン・状態・サービス層のテストを確認
  - すべてのテストが通ることを確認し、疑問があればユーザーに確認する。

- [ ] 18. UI 層: レイアウトとナビゲーション
  - [ ] 18.1 header / main / footer レイアウトとナビゲーションを実装する（`src/ui/AppLayout.tsx`）
    - header / main / footer の3領域を描画し、map / character / shop / quests / collections への menu navigation を実装する
    - メニュー選択時に対応ビューを main 領域へ表示する
    - ビューポート480px以下で横スクロールを発生させず、タッチターゲットを最小44×44pxで描画する CSS を適用する
    - 初期データ取得中はローディング表示、10秒超過時は読み込み失敗メッセージと再試行を表示する
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_

  - [ ]* 18.2 レイアウトとナビゲーションのレンダリングテスト
    - 3領域の描画、メニュー遷移、480px でのレイアウト（横スクロール抑止・タッチターゲット）、ローディング／取得失敗表示を検証する
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.7, 12.8_

- [ ] 19. UI 層: 各ビューの実装
  - [ ] 19.1 Map ビューを実装する（`src/ui/views/MapView.tsx`）
    - Map SDK を用いて現在位置中心の地図を描画し、`getVisibleMarkers` のマーカーを表示する。ロックスポットは秘匿表示、解放スポット選択時に詳細を表示する
    - 位置が無い場合は愛媛県内の既定座標にセンタリングし、10秒以内に描画できない場合は読み込み失敗メッセージと再試行を表示する
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [ ] 19.2 Character ビューを実装する（`src/ui/views/CharacterView.tsx`）
    - レベル・経験値・次レベル要求（または最大到達表示）と、スロット別装備グルーピング・装備変更 UI・合成ステータスを表示する。レベルアップ通知（最低3秒または明示的解除まで）を表示する
    - _Requirements: 6.3, 6.4, 6.5, 8.1, 8.2, 8.3_

  - [ ] 19.3 Shop ビューを実装する（`src/ui/views/ShopView.tsx`）
    - 購入可能アイテム（名前・価格・効果説明、Limited_Item 除外）を一覧表示し、購入操作・残高不足メッセージ・購入確定メッセージ・保存不可メッセージを表示する
    - _Requirements: 7.1, 7.3, 7.5, 7.8_

  - [ ] 19.4 Quests ビューを実装する（`src/ui/views/QuestsView.tsx`）
    - アクティブクエストの現在数・必要数・残り未達条件を表示し、完了時の状態を反映する
    - _Requirements: 4.7_

  - [ ] 19.5 Collections ビューを実装する（`src/ui/views/CollectionsView.tsx`）
    - スタンプ取得数/総数、コレクション取得数/総数と完了状態、付与済み称号を表示する
    - _Requirements: 3.5, 11.6_

  - [ ]* 19.6 各ビューのレンダリングテスト
    - ロックスポット秘匿表示（Req 2.3, 2.5）、空スロットの空状態表示（Req 8.2）、購入確定メッセージ（Req 7.8）、最大レベル表示（Req 6.5）を検証する
    - _Requirements: 2.3, 2.5, 6.5, 7.8, 8.2_

- [ ] 20. 全体の結線と統合
  - [ ] 20.1 アプリのエントリポイントを結線する（`src/main.tsx`, `src/App.tsx`）
    - 起動時に User_Data_Store からプレイヤーデータを読み込み（ローディング／失敗時再試行）、状態管理層・Location_Service・各ビューを接続する
    - 位置更新 → スポット入場 → スタンプ付与 → クエスト進行 → 報酬付与 → 地域アンロック／称号付与の一連のフローを結線する
    - _Requirements: 1.3, 3.1, 4.2, 5.3, 10.3, 11.2, 12.6, 12.7_

  - [ ]* 20.2 統合（スモーク）テスト
    - 入場からスタンプ・クエスト・報酬・アンロックまでの主要フローを、モックの Location_Service と User_Data_Store を用いた少数例で検証する
    - _Requirements: 1.3, 3.1, 4.2, 5.5, 10.3_

- [ ] 21. Final Checkpoint - すべてのテストを確認
  - すべてのテストが通ることを確認し、疑問があればユーザーに確認する。

## Notes

- `*` が付いたサブタスクは任意（ユニット／プロパティ／統合テスト）であり、MVP を素早く動かす場合はスキップ可能です。コア実装タスクは任意ではありません。
- プロパティテストは fast-check を用い、各テストで最低100回反復します。各テストには `Feature: ehime-location-rpg, Property {number}: {property_text}` 形式のタグコメントを付与します。
- 各タスクはトレーサビリティのため具体的な要求番号を参照します。チェックポイントでインクリメンタルに検証します。
- 地図描画・UI レイアウト・外部サービス連携は PBT 非対象とし、レンダリング／統合テストで担保します（設計書 Testing Strategy 準拠）。

### 後期フェーズ（Later Phase / 参考・MVP 完了に必須ではない）

Requirements 13〜17（フレンド、写真、パーティ、リアルタイムバトル、地域イベント）および Property 36〜47 は MVP 完了後の実装対象です。MVP では実装しません。実装時は `Friend_Service` / `Photo_Service` / `Party_Service` を独立モジュールとして追加し、設計書のプロパティ 36〜47 をプロパティテスト化します。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "3.1", "3.2", "4.1", "5.1", "6.1", "8.1", "9.1", "13.1", "13.2", "14.1"] },
    { "id": 3, "tasks": ["8.2", "10.1", "12.1", "14.2"] },
    { "id": 4, "tasks": ["12.2"] },
    { "id": 5, "tasks": ["3.3", "3.4", "4.2", "4.3", "5.2", "5.3", "6.2", "6.3", "6.4", "6.5", "8.3", "8.4", "8.5", "8.6", "8.7", "8.8", "8.9", "9.2", "9.3", "9.4", "10.2", "10.3", "10.4", "10.5", "12.3", "12.4", "12.5", "12.6", "12.7", "12.8", "13.3", "13.4", "13.5", "14.3"] },
    { "id": 6, "tasks": ["15.1"] },
    { "id": 7, "tasks": ["15.2", "16.1"] },
    { "id": 8, "tasks": ["15.3", "15.4", "16.2", "18.1"] },
    { "id": 9, "tasks": ["18.2", "19.1", "19.2", "19.3", "19.4", "19.5"] },
    { "id": 10, "tasks": ["19.6", "20.1"] },
    { "id": 11, "tasks": ["20.2"] }
  ]
}
```
