// フレンド機能 ドメインモデルと純粋関数
//
// フレンド一覧・検索・申請・パーティー・プライバシー設定を扱う。
// 本モジュールは副作用を持たず、データ構造と計算のみを提供する。

import type { ISODateTime } from './types';

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

/** フレンド関係のステータス */
export type FriendStatus = 'pending' | 'accepted' | 'rejected';

/** 位置情報の公開設定 */
export type LocationPrivacy = 'hidden' | 'friends_only' | 'party_only';

/** オンライン状態 */
export type OnlineStatus = 'online' | 'offline' | 'away';

/** ユーザープロフィール（フレンド表示用） */
export interface UserProfile {
  userId: string;
  username: string;
  avatarUrl: string | null;
  level: number;
  title: string | null;
  onlineStatus: OnlineStatus;
  /** 訪問スポット数 */
  visitedSpotCount: number;
  /** ボス討伐数 */
  defeatedBossCount: number;
  /** 総歩行距離（メートル） */
  totalWalkMeters: number;
  /** お気に入り写真 URL */
  favoritePhotoUrl: string | null;
}

/** フレンド関係レコード（friends テーブル相当） */
export interface FriendRecord {
  friendId: string;
  userId: string;
  friendUserId: string;
  status: FriendStatus;
  createdAt: ISODateTime;
}

/** フレンド申請レコード（friend_requests テーブル相当） */
export interface FriendRequest {
  requestId: string;
  fromUserId: string;
  toUserId: string;
  status: FriendStatus;
  createdAt: ISODateTime;
  /** 送信者プロフィール（UI表示用、ドメインでは任意） */
  fromProfile?: UserProfile;
}

/** パーティー（parties テーブル相当） */
export interface Party {
  partyId: string;
  leaderId: string;
  createdAt: ISODateTime;
  members: PartyMember[];
}

/** パーティーメンバー（party_members テーブル相当） */
export interface PartyMember {
  partyId: string;
  userId: string;
  profile?: UserProfile;
}

/** フレンド一覧の表示用データ（プロフィール付き） */
export interface FriendEntry {
  friendRecord: FriendRecord;
  profile: UserProfile;
}

/** フレンド機能の状態（UIが保持するステート） */
export interface FriendState {
  friends: FriendEntry[];
  incomingRequests: FriendRequest[];
  outgoingRequests: FriendRequest[];
  currentParty: Party | null;
  locationPrivacy: LocationPrivacy;
  searchResults: UserProfile[];
  searchQuery: string;
}

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/** パーティーの最大人数 */
export const MAX_PARTY_SIZE = 4;

// ---------------------------------------------------------------------------
// 純粋関数
// ---------------------------------------------------------------------------

/** 初期フレンド状態を生成する */
export function createInitialFriendState(): FriendState {
  return {
    friends: [],
    incomingRequests: [],
    outgoingRequests: [],
    currentParty: null,
    locationPrivacy: 'hidden',
    searchResults: [],
    searchQuery: '',
  };
}

/** フレンド申請を承認した場合の状態更新 */
export function acceptRequest(
  state: FriendState,
  requestId: string,
  now: ISODateTime
): FriendState {
  const request = state.incomingRequests.find((r) => r.requestId === requestId);
  if (!request) return state;

  // 申請を受信リストから除去
  const incomingRequests = state.incomingRequests.filter((r) => r.requestId !== requestId);

  // フレンド一覧に追加（プロフィールがある場合）
  const newFriend: FriendEntry | null = request.fromProfile
    ? {
        friendRecord: {
          friendId: `friend-${Date.now()}`,
          userId: request.toUserId,
          friendUserId: request.fromUserId,
          status: 'accepted',
          createdAt: now,
        },
        profile: request.fromProfile,
      }
    : null;

  return {
    ...state,
    incomingRequests,
    friends: newFriend ? [...state.friends, newFriend] : state.friends,
  };
}

/** フレンド申請を拒否した場合の状態更新 */
export function rejectRequest(state: FriendState, requestId: string): FriendState {
  return {
    ...state,
    incomingRequests: state.incomingRequests.filter((r) => r.requestId !== requestId),
  };
}

/** フレンドを削除した場合の状態更新 */
export function removeFriend(state: FriendState, friendUserId: string): FriendState {
  return {
    ...state,
    friends: state.friends.filter((f) => f.profile.userId !== friendUserId),
  };
}

/** パーティーに参加可能か判定する */
export function canJoinParty(party: Party | null): boolean {
  if (party === null) return true; // パーティーがないので新規作成可能
  return party.members.length < MAX_PARTY_SIZE;
}

/** パーティーにメンバーを追加した状態を返す */
export function addPartyMember(party: Party, member: PartyMember): Party | null {
  if (party.members.length >= MAX_PARTY_SIZE) return null;
  return {
    ...party,
    members: [...party.members, member],
  };
}

/** パーティーからメンバーを削除した状態を返す */
export function removePartyMember(party: Party, userId: string): Party {
  return {
    ...party,
    members: party.members.filter((m) => m.userId !== userId),
  };
}

/** 位置情報公開設定を変更した状態を返す */
export function setLocationPrivacy(state: FriendState, privacy: LocationPrivacy): FriendState {
  return { ...state, locationPrivacy: privacy };
}

/** 検索結果をセットした状態を返す */
export function setSearchResults(state: FriendState, results: UserProfile[], query: string): FriendState {
  return { ...state, searchResults: results, searchQuery: query };
}

/** 指定ユーザーが既にフレンドか判定する */
export function isFriend(state: FriendState, userId: string): boolean {
  return state.friends.some((f) => f.profile.userId === userId);
}

/** 指定ユーザーに既に申請済みか判定する */
export function hasPendingRequest(state: FriendState, userId: string): boolean {
  return state.outgoingRequests.some(
    (r) => r.toUserId === userId && r.status === 'pending'
  );
}

/** 未読のフレンド申請件数を取得する */
export function getPendingRequestCount(state: FriendState): number {
  return state.incomingRequests.filter((r) => r.status === 'pending').length;
}
