/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// モバイルファーストの React + TypeScript ビルド設定
// テスト（Vitest）は jsdom 環境で実行し、グローバル API を有効化する。
export default defineConfig({
  plugins: [react()],
  // モバイル端末からローカル開発サーバーへアクセスできるようにする
  server: {
    host: true,
    port: 5173,
    watch: {
      // バトル用の画像（public/battle 配下）はHMR不要。Windows で大きな画像が
      // ロックされると watcher が EBUSY でクラッシュするため監視対象から除外する。
      ignored: ['**/public/battle/**'],
    },
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
  },
});
