# repository 層

`User_Data_Store`（AWS バックエンド）への読み書きを抽象化する層。

- `serialization.ts`: `PlayerState` のシリアライズ／デシリアライズ（Task 14.1）
- `userDataStore.ts`: load / persist クライアント（Task 14.2）
