// フレンド機能 リポジトリ層
//
// フレンド関連のデータアクセスを抽象化する。
// 本 MVP ではインメモリ実装を提供する。実運用ではバックエンド API に差し替える。

import type {
  FriendEntry,
  FriendRequest,
  LocationPrivacy,
  OnlineStatus,
  Party,
  PartyMember,
  UserProfile,
} from '../domain/friend';

// ---------------------------------------------------------------------------
// リポジトリインターフェース
// ---------------------------------------------------------------------------

export interface FriendRepository {
  /** フレンド一覧を取得する */
  getFriends(userId: string): Promise<FriendEntry[]>;
  /** フレンド申請を送信する */
  sendFriendRequest(fromUserId: string, toUserId: string): Promise<FriendRequest>;
  /** 受信したフレンド申請一覧を取得する */
  getIncomingRequests(userId: string): Promise<FriendRequest[]>;
  /** 送信したフレンド申請一覧を取得する */
  getOutgoingRequests(userId: string): Promise<FriendRequest[]>;
  /** フレンド申請を承認する */
  acceptFriendRequest(requestId: string): Promise<void>;
  /** フレンド申請を拒否する */
  rejectFriendRequest(requestId: string): Promise<void>;
  /** フレンドを削除する */
  removeFriend(userId: string, friendUserId: string): Promise<void>;
  /** ユーザーを検索する */
  searchUsers(query: string): Promise<UserProfile[]>;
  /** ユーザープロフィールを取得する */
  getUserProfile(userId: string): Promise<UserProfile | null>;
  /** 位置情報公開設定を保存する */
  setLocationPrivacy(userId: string, privacy: LocationPrivacy): Promise<void>;
  /** 位置情報公開設定を取得する */
  getLocationPrivacy(userId: string): Promise<LocationPrivacy>;
  /** パーティーを作成する */
  createParty(leaderId: string): Promise<Party>;
  /** パーティーに参加する */
  joinParty(partyId: string, userId: string): Promise<PartyMember>;
  /** パーティーから離脱する */
  leaveParty(partyId: string, userId: string): Promise<void>;
  /** 現在のパーティー情報を取得する */
  getCurrentParty(userId: string): Promise<Party | null>;
  /** パーティーを解散する */
  disbandParty(partyId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// インメモリ実装（開発・デモ用）
// ---------------------------------------------------------------------------

/** デモ用のサンプルユーザープロフィール */
const SAMPLE_USERS: UserProfile[] = [
  {
    userId: 'user-tanaka',
    username: '田中太郎',
    avatarUrl: null,
    level: 12,
    title: '松山マスター',
    onlineStatus: 'online',
    visitedSpotCount: 8,
    defeatedBossCount: 3,
    totalWalkMeters: 15200,
    favoritePhotoUrl: null,
  },
  {
    userId: 'user-suzuki',
    username: '鈴木花子',
    avatarUrl: null,
    level: 8,
    title: '道後の湯入り',
    onlineStatus: 'away',
    visitedSpotCount: 5,
    defeatedBossCount: 1,
    totalWalkMeters: 8400,
    favoritePhotoUrl: null,
  },
  {
    userId: 'user-sato',
    username: '佐藤健一',
    avatarUrl: null,
    level: 15,
    title: '霊峰登拝',
    onlineStatus: 'online',
    visitedSpotCount: 14,
    defeatedBossCount: 6,
    totalWalkMeters: 32100,
    favoritePhotoUrl: null,
  },
  {
    userId: 'user-yamada',
    username: '山田美咲',
    avatarUrl: null,
    level: 6,
    title: null,
    onlineStatus: 'offline',
    visitedSpotCount: 3,
    defeatedBossCount: 0,
    totalWalkMeters: 4800,
    favoritePhotoUrl: null,
  },
  {
    userId: 'user-takahashi',
    username: '高橋龍太',
    avatarUrl: null,
    level: 20,
    title: '宇和島の闘牛王討伐者',
    onlineStatus: 'online',
    visitedSpotCount: 22,
    defeatedBossCount: 9,
    totalWalkMeters: 58000,
    favoritePhotoUrl: null,
  },
];

export class InMemoryFriendRepository implements FriendRepository {
  private friends: FriendEntry[] = [];
  private requests: FriendRequest[] = [];
  private parties: Party[] = [];
  private locationSettings: Map<string, LocationPrivacy> = new Map();
  private idCounter = 0;

  constructor() {
    // デモ用: 初期フレンドを設定
    this.friends = [
      {
        friendRecord: {
          friendId: 'friend-1',
          userId: 'local-player',
          friendUserId: 'user-tanaka',
          status: 'accepted',
          createdAt: '2024-01-15T10:00:00Z',
        },
        profile: SAMPLE_USERS[0]!,
      },
      {
        friendRecord: {
          friendId: 'friend-2',
          userId: 'local-player',
          friendUserId: 'user-suzuki',
          status: 'accepted',
          createdAt: '2024-02-10T14:30:00Z',
        },
        profile: SAMPLE_USERS[1]!,
      },
    ];

    // デモ用: 受信フレンド申請を設定
    this.requests = [
      {
        requestId: 'req-1',
        fromUserId: 'user-sato',
        toUserId: 'local-player',
        status: 'pending',
        createdAt: '2024-03-20T09:00:00Z',
        fromProfile: SAMPLE_USERS[2]!,
      },
    ];
  }

  private nextId(prefix: string): string {
    return `${prefix}-${++this.idCounter}-${Date.now()}`;
  }

  async getFriends(userId: string): Promise<FriendEntry[]> {
    return this.friends.filter(
      (f) => f.friendRecord.userId === userId || f.friendRecord.friendUserId === userId
    );
  }

  async sendFriendRequest(fromUserId: string, toUserId: string): Promise<FriendRequest> {
    const request: FriendRequest = {
      requestId: this.nextId('req'),
      fromUserId,
      toUserId,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.requests.push(request);
    return request;
  }

  async getIncomingRequests(userId: string): Promise<FriendRequest[]> {
    return this.requests.filter(
      (r) => r.toUserId === userId && r.status === 'pending'
    );
  }

  async getOutgoingRequests(userId: string): Promise<FriendRequest[]> {
    return this.requests.filter(
      (r) => r.fromUserId === userId && r.status === 'pending'
    );
  }

  async acceptFriendRequest(requestId: string): Promise<void> {
    const request = this.requests.find((r) => r.requestId === requestId);
    if (!request) return;
    request.status = 'accepted';

    // フレンド一覧に追加
    const profile = SAMPLE_USERS.find((u) => u.userId === request.fromUserId);
    if (profile) {
      this.friends.push({
        friendRecord: {
          friendId: this.nextId('friend'),
          userId: request.toUserId,
          friendUserId: request.fromUserId,
          status: 'accepted',
          createdAt: new Date().toISOString(),
        },
        profile,
      });
    }
  }

  async rejectFriendRequest(requestId: string): Promise<void> {
    const request = this.requests.find((r) => r.requestId === requestId);
    if (request) {
      request.status = 'rejected';
    }
  }

  async removeFriend(_userId: string, friendUserId: string): Promise<void> {
    this.friends = this.friends.filter(
      (f) => f.friendRecord.friendUserId !== friendUserId
    );
  }

  async searchUsers(query: string): Promise<UserProfile[]> {
    if (!query.trim()) return [];
    const lower = query.toLowerCase();
    return SAMPLE_USERS.filter((u) =>
      u.username.toLowerCase().includes(lower)
    );
  }

  async getUserProfile(userId: string): Promise<UserProfile | null> {
    return SAMPLE_USERS.find((u) => u.userId === userId) ?? null;
  }

  async setLocationPrivacy(userId: string, privacy: LocationPrivacy): Promise<void> {
    this.locationSettings.set(userId, privacy);
  }

  async getLocationPrivacy(userId: string): Promise<LocationPrivacy> {
    return this.locationSettings.get(userId) ?? 'hidden';
  }

  async createParty(leaderId: string): Promise<Party> {
    const leaderProfile = SAMPLE_USERS.find((u) => u.userId === leaderId) ?? {
      userId: leaderId,
      username: 'あなた',
      avatarUrl: null,
      level: 1,
      title: null,
      onlineStatus: 'online' as OnlineStatus,
      visitedSpotCount: 0,
      defeatedBossCount: 0,
      totalWalkMeters: 0,
      favoritePhotoUrl: null,
    };
    const party: Party = {
      partyId: this.nextId('party'),
      leaderId,
      createdAt: new Date().toISOString(),
      members: [{ partyId: '', userId: leaderId, profile: leaderProfile }],
    };
    party.members[0]!.partyId = party.partyId;
    this.parties.push(party);
    return party;
  }

  async joinParty(partyId: string, userId: string): Promise<PartyMember> {
    const party = this.parties.find((p) => p.partyId === partyId);
    if (!party) throw new Error('パーティーが見つかりません');
    const profile = SAMPLE_USERS.find((u) => u.userId === userId);
    const member: PartyMember = { partyId, userId, profile };
    party.members.push(member);
    return member;
  }

  async leaveParty(partyId: string, userId: string): Promise<void> {
    const party = this.parties.find((p) => p.partyId === partyId);
    if (!party) return;
    party.members = party.members.filter((m) => m.userId !== userId);
    // リーダーが抜けたら解散
    if (party.members.length === 0 || party.leaderId === userId) {
      this.parties = this.parties.filter((p) => p.partyId !== partyId);
    }
  }

  async getCurrentParty(userId: string): Promise<Party | null> {
    return this.parties.find(
      (p) => p.members.some((m) => m.userId === userId)
    ) ?? null;
  }

  async disbandParty(partyId: string): Promise<void> {
    this.parties = this.parties.filter((p) => p.partyId !== partyId);
  }
}
