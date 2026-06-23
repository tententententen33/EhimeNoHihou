// Vitest グローバルセットアップ
// - testing-library のカスタムマッチャ（jest-dom）を有効化する
// - fast-check のグローバル設定で、各プロパティテストの最低反復回数を 100 回に固定する
//   （設計書 Testing Strategy / tasks.md: 最低100回反復の既定設定）
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as fc from 'fast-check';

// プロパティベーステストの既定反復回数を 100 回に設定する。
// 個々のテストで numRuns を上書きする場合は、必ず 100 以上を指定すること。
fc.configureGlobal({ numRuns: 100 });

// 各テスト後に DOM をクリーンアップする
afterEach(() => {
  cleanup();
});
