// User_Data_Store クライアント（Req 5.5, 12.6）
//
// 本モジュールは `User_Data_Store`（AWS バックエンド）への読み書きを抽象化する
// Repository 層のクライアントである。プレイヤーの永続状態（`PlayerState`）を
// バックエンド API から読み込み（load）・書き込み（persist）する。
//
// 設計方針:
// - 読み書きの失敗（HTTP 非 OK 応答・ネットワーク障害・本文の不正）は、
//   すべて例外（throw）で状態管理層へ通知する（Req 5.5, 12.6）。これにより
//   状態管理層の「確定前ロールバック」「再試行キュー」が失敗を捕捉できる。
// - 本文の直列化／復元は `serialization.ts` の `serialize` / `deserialize` を
//   再利用する（保存フォーマットの一元管理・Property 35 のラウンドトリップ整合）。
//
// AWS バックエンドに関する前提:
// - バックエンドは AWS 上にホストされる REST API で、Vercel から配信される
//   フロントエンドが HTTPS でアクセスする。API のベース URL は Vite の
//   環境変数 `VITE_API_BASE_URL`（ビルド時に注入）で構成する。
//   例: `https://api.example.com/v1`
// - 想定エンドポイント:
//     GET  {baseUrl}/players/{playerId}  -> 200: 保存済み PlayerState（JSON）
//     PUT  {baseUrl}/players/{playerId}  -> 2xx: 保存成功（本文は問わない）
//   実際の認証（Cognito / API Gateway 等）やパス設計はバックエンド未デプロイの
//   ため確定していないが、ベース URL を環境変数で切り替えれば差し替え可能とする。
// - バックエンドは `serialize(state)` が生成した JSON をそのまま保存し、
//   読み込み時に同形式の JSON を返すことを前提とする。`deserialize` が
//   防御的な正規化を行うため、軽微なスキーマ差異には耐性がある。
//
// 注意: バックエンドが未デプロイのため、本番経路にモックデータは埋め込まない。
//       ローカル開発・テスト向けには `InMemoryUserDataStore` を別途提供する。

import { deserialize, serialize } from './serialization';
import { type PlayerState } from '../domain/types';

/**
 * `User_Data_Store` クライアントのインターフェース（設計書 Repository 層）。
 *
 * - `load(playerId)`: プレイヤーの永続状態を取得する（Req 12.6）。
 * - `persist(playerId, state)`: プレイヤーの永続状態を保存する。失敗は例外で通知。
 */
export interface UserDataStore {
  /**
   * 指定プレイヤーの永続状態を読み込む。
   * @throws 取得失敗（HTTP 非 OK・ネットワーク障害・本文不正）時に例外を投げる。
   */
  load(playerId: string): Promise<PlayerState>;
  /**
   * 指定プレイヤーの永続状態を保存する。
   * @throws 保存失敗（HTTP 非 OK・ネットワーク障害）時に例外を投げる（Req 5.5）。
   */
  persist(playerId: string, state: PlayerState): Promise<void>;
}

/** Repository 層で投げる共通エラー。失敗種別を識別できるようにする。 */
export class UserDataStoreError extends Error {
  /** 失敗の分類（取得 / 保存） */
  readonly operation: 'load' | 'persist';
  /** 取得できた場合の HTTP ステータス（ネットワーク障害時は undefined） */
  readonly status?: number;

  constructor(
    operation: 'load' | 'persist',
    message: string,
    options?: { status?: number; cause?: unknown }
  ) {
    super(message);
    this.name = 'UserDataStoreError';
    this.operation = operation;
    this.status = options?.status;
    // cause は環境によって未対応のため任意設定とする。
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP（fetch）ベースの実装 — 本番経路
// ---------------------------------------------------------------------------

/** `HttpUserDataStore` の任意設定。テスト時に fetch / baseUrl を差し替え可能。 */
export interface HttpUserDataStoreOptions {
  /** API ベース URL。省略時は `import.meta.env.VITE_API_BASE_URL` を使用。 */
  baseUrl?: string;
  /** fetch 実装の差し替え（テスト用）。省略時はグローバル `fetch`。 */
  fetchImpl?: typeof fetch;
}

/**
 * AWS バックエンド API に対する fetch ベースの `UserDataStore` 実装。
 *
 * ベース URL は `VITE_API_BASE_URL` で構成し、`players/{playerId}` に対して
 * GET（load）/ PUT（persist）を行う。非 OK 応答・ネットワーク障害・本文の
 * パース失敗はすべて `UserDataStoreError` として投げる。
 */
export class HttpUserDataStore implements UserDataStore {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpUserDataStoreOptions = {}) {
    // Vite の環境変数からベース URL を解決する（ビルド時に注入）。
    const envBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
    const resolved = options.baseUrl ?? envBaseUrl;
    if (!resolved) {
      // 設定漏れは早期に検知できるよう、生成時点で例外を投げる。
      throw new UserDataStoreError(
        'load',
        'API ベース URL が未設定です。環境変数 VITE_API_BASE_URL を設定してください。'
      );
    }
    // 末尾スラッシュを正規化し、エンドポイント結合時の二重スラッシュを防ぐ。
    this.baseUrl = resolved.replace(/\/+$/, '');

    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new UserDataStoreError(
        'load',
        'fetch が利用できません。fetch 対応環境で実行するか fetchImpl を指定してください。'
      );
    }
    // fetch は this バインドが必要なため bind して保持する。
    this.fetchImpl = fetchImpl.bind(globalThis);
  }

  /** プレイヤー状態の取得先 URL を組み立てる。 */
  private playerUrl(playerId: string): string {
    return `${this.baseUrl}/players/${encodeURIComponent(playerId)}`;
  }

  async load(playerId: string): Promise<PlayerState> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.playerUrl(playerId), {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
    } catch (cause) {
      // ネットワーク障害（オフライン・DNS 失敗等）。
      throw new UserDataStoreError('load', `プレイヤーデータの取得に失敗しました（ネットワーク障害）: ${playerId}`, {
        cause,
      });
    }

    if (!response.ok) {
      throw new UserDataStoreError(
        'load',
        `プレイヤーデータの取得に失敗しました（HTTP ${response.status}）: ${playerId}`,
        { status: response.status }
      );
    }

    // 本文を取得して復元する。本文の取得・復元失敗も取得失敗として通知する。
    let body: string;
    try {
      body = await response.text();
    } catch (cause) {
      throw new UserDataStoreError('load', `プレイヤーデータの読み取りに失敗しました: ${playerId}`, { cause });
    }

    try {
      // deserialize は JSON 文字列を受け取り、防御的に PlayerState を復元する。
      return deserialize(body);
    } catch (cause) {
      throw new UserDataStoreError('load', `プレイヤーデータの復元に失敗しました（本文が不正）: ${playerId}`, {
        cause,
      });
    }
  }

  async persist(playerId: string, state: PlayerState): Promise<void> {
    const body = serialize(state);

    let response: Response;
    try {
      response = await this.fetchImpl(this.playerUrl(playerId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch (cause) {
      // ネットワーク障害は例外で通知する（状態管理層が再試行・ロールバックに使用）。
      throw new UserDataStoreError('persist', `プレイヤーデータの保存に失敗しました（ネットワーク障害）: ${playerId}`, {
        cause,
      });
    }

    if (!response.ok) {
      throw new UserDataStoreError(
        'persist',
        `プレイヤーデータの保存に失敗しました（HTTP ${response.status}）: ${playerId}`,
        { status: response.status }
      );
    }
    // 2xx は保存成功とみなす（応答本文は問わない）。
  }
}

// ---------------------------------------------------------------------------
// インメモリ実装 — ローカル開発・テスト向け
// ---------------------------------------------------------------------------

/**
 * メモリ上でプレイヤー状態を保持する `UserDataStore` 実装。
 *
 * バックエンド未デプロイ時のローカル開発や、状態管理層・UI のテストに用いる。
 * 本番経路では使用しない。保存・復元には本番と同じ `serialize` / `deserialize`
 * を経由させ、ラウンドトリップ整合（参照共有の回避）を保つ。
 */
export class InMemoryUserDataStore implements UserDataStore {
  /** playerId -> シリアライズ済み JSON */
  private readonly store = new Map<string, string>();

  /** 任意の初期データ（playerId -> PlayerState）を投入できる。 */
  constructor(initial?: Record<string, PlayerState>) {
    if (initial) {
      for (const [playerId, state] of Object.entries(initial)) {
        this.store.set(playerId, serialize(state));
      }
    }
  }

  async load(playerId: string): Promise<PlayerState> {
    const body = this.store.get(playerId);
    if (body === undefined) {
      // 未保存のプレイヤーは取得失敗として通知する（HTTP 404 相当）。
      throw new UserDataStoreError('load', `プレイヤーデータが存在しません: ${playerId}`, { status: 404 });
    }
    return deserialize(body);
  }

  async persist(playerId: string, state: PlayerState): Promise<void> {
    // シリアライズしてから保持することで、呼び出し側との参照共有を避ける。
    this.store.set(playerId, serialize(state));
  }

  /** テスト補助: 指定プレイヤーの保存有無を返す。 */
  has(playerId: string): boolean {
    return this.store.has(playerId);
  }

  /** テスト補助: 保持データを全消去する。 */
  clear(): void {
    this.store.clear();
  }
}

/**
 * 既定の `UserDataStore` を生成するファクトリ。
 * 本番経路では HTTP 実装を返す（環境変数 `VITE_API_BASE_URL` を使用）。
 */
export function createUserDataStore(options?: HttpUserDataStoreOptions): UserDataStore {
  return new HttpUserDataStore(options);
}
