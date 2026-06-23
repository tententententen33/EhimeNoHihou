import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// 基盤セットアップの疎通確認用テスト（trivial smoke test）。
// Vitest と fast-check が正しく構成されていることを検証する。
describe('toolchain setup', () => {
  it('Vitest が動作する', () => {
    expect(1 + 1).toBe(2);
  });

  it('fast-check が動作し、グローバル既定の反復回数が100以上である', () => {
    // configureGlobal で設定した numRuns が反映されていることを確認する。
    const config = fc.readConfigureGlobal();
    expect(config?.numRuns ?? 0).toBeGreaterThanOrEqual(100);

    // 単純なプロパティ（加算の可換性）が成立することを確認する。
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        return a + b === b + a;
      }),
    );
  });
});
