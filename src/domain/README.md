# domain 層

純粋なドメインロジック層（副作用なし）。ゲームルールを純粋関数として実装する。

- 報酬計算 / レベル導出 / クエスト進行 / スタンプ・ボスの重複排除 / 地域アンロック / コレクション集計 など
- `Correctness Properties`（設計書 Property 1〜35）のプロパティベーステスト対象。

後続タスク（Task 2 以降）で `types.ts`, `location.ts`, `stamp.ts`, `quest.ts`, `reward.ts`, `character.ts`, `shop.ts`, `boss.ts`, `map.ts`, `title.ts`, `collection.ts` を追加する。
