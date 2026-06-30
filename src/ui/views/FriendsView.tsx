// フレンド機能 ビュー
//
// フレンド一覧・検索・申請・パーティー・プライバシー設定のUIを提供する。
// RPGテーマに沿ったカードベースのデザイン。

import { useCallback, useEffect, useState } from 'react';
import type {
  FriendEntry,
  FriendRequest,
  FriendState,
  LocationPrivacy,
  Party,
  UserProfile,
} from '../../domain/friend';
import {
  createInitialFriendState,
  getPendingRequestCount,
  MAX_PARTY_SIZE,
} from '../../domain/friend';
import type { FriendRepository } from '../../repository/friendRepository';
import './FriendsView.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FriendsViewProps {
  /** 現在のユーザー ID */
  currentUserId: string;
  /** フレンドリポジトリ */
  repository: FriendRepository;
}

// サブページの種類
type FriendsTab = 'list' | 'search' | 'requests' | 'party' | 'settings';

// ---------------------------------------------------------------------------
// コンポーネント
// ---------------------------------------------------------------------------

export function FriendsView({ currentUserId, repository }: FriendsViewProps) {
  const [state, setState] = useState<FriendState>(createInitialFriendState);
  const [activeTab, setActiveTab] = useState<FriendsTab>('list');
  const [loading, setLoading] = useState(true);
  const [selectedProfile, setSelectedProfile] = useState<UserProfile | null>(null);

  // 初期データ読み込み
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [friends, incoming, outgoing, party, privacy] = await Promise.all([
          repository.getFriends(currentUserId),
          repository.getIncomingRequests(currentUserId),
          repository.getOutgoingRequests(currentUserId),
          repository.getCurrentParty(currentUserId),
          repository.getLocationPrivacy(currentUserId),
        ]);
        setState((s) => ({
          ...s,
          friends,
          incomingRequests: incoming,
          outgoingRequests: outgoing,
          currentParty: party,
          locationPrivacy: privacy,
        }));
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [currentUserId, repository]);

  // 検索
  const handleSearch = useCallback(async (query: string) => {
    setState((s) => ({ ...s, searchQuery: query }));
    if (!query.trim()) {
      setState((s) => ({ ...s, searchResults: [] }));
      return;
    }
    const results = await repository.searchUsers(query);
    setState((s) => ({ ...s, searchResults: results }));
  }, [repository]);

  // フレンド申請送信
  const handleSendRequest = useCallback(async (toUserId: string) => {
    const request = await repository.sendFriendRequest(currentUserId, toUserId);
    setState((s) => ({
      ...s,
      outgoingRequests: [...s.outgoingRequests, request],
    }));
  }, [currentUserId, repository]);

  // フレンド申請承認
  const handleAcceptRequest = useCallback(async (requestId: string) => {
    await repository.acceptFriendRequest(requestId);
    // リロード
    const [friends, incoming] = await Promise.all([
      repository.getFriends(currentUserId),
      repository.getIncomingRequests(currentUserId),
    ]);
    setState((s) => ({ ...s, friends, incomingRequests: incoming }));
  }, [currentUserId, repository]);

  // フレンド申請拒否
  const handleRejectRequest = useCallback(async (requestId: string) => {
    await repository.rejectFriendRequest(requestId);
    setState((s) => ({
      ...s,
      incomingRequests: s.incomingRequests.filter((r) => r.requestId !== requestId),
    }));
  }, [repository]);

  // フレンド削除
  const handleRemoveFriend = useCallback(async (friendUserId: string) => {
    await repository.removeFriend(currentUserId, friendUserId);
    setState((s) => ({
      ...s,
      friends: s.friends.filter((f) => f.profile.userId !== friendUserId),
    }));
  }, [currentUserId, repository]);

  // プライバシー設定変更
  const handlePrivacyChange = useCallback(async (privacy: LocationPrivacy) => {
    await repository.setLocationPrivacy(currentUserId, privacy);
    setState((s) => ({ ...s, locationPrivacy: privacy }));
  }, [currentUserId, repository]);

  // パーティー作成
  const handleCreateParty = useCallback(async () => {
    const party = await repository.createParty(currentUserId);
    setState((s) => ({ ...s, currentParty: party }));
  }, [currentUserId, repository]);

  // パーティーにフレンドを招待
  const handleInviteToParty = useCallback(async (userId: string) => {
    if (!state.currentParty) return;
    await repository.joinParty(state.currentParty.partyId, userId);
    const party = await repository.getCurrentParty(currentUserId);
    setState((s) => ({ ...s, currentParty: party }));
  }, [currentUserId, repository, state.currentParty]);

  // パーティー離脱
  const handleLeaveParty = useCallback(async () => {
    if (!state.currentParty) return;
    await repository.leaveParty(state.currentParty.partyId, currentUserId);
    setState((s) => ({ ...s, currentParty: null }));
  }, [currentUserId, repository, state.currentParty]);

  // パーティー解散
  const handleDisbandParty = useCallback(async () => {
    if (!state.currentParty) return;
    await repository.disbandParty(state.currentParty.partyId);
    setState((s) => ({ ...s, currentParty: null }));
  }, [repository, state.currentParty]);

  const pendingCount = getPendingRequestCount(state);

  if (loading) {
    return (
      <section className="friends-view" aria-label="フレンド">
        <div className="friends-loading">
          <span className="friends-loading__spinner" />
          <p>読み込み中…</p>
        </div>
      </section>
    );
  }

  // プロフィール詳細表示
  if (selectedProfile) {
    return (
      <section className="friends-view" aria-label="フレンドプロフィール">
        <ProfileDetail
          profile={selectedProfile}
          onBack={() => setSelectedProfile(null)}
        />
      </section>
    );
  }

  return (
    <section className="friends-view" aria-label="フレンド">
      {/* タブ切り替え */}
      <div className="friends-tabs" role="tablist" aria-label="フレンドメニュー">
        <TabButton label="一覧" tab="list" active={activeTab} onClick={setActiveTab} icon="👥" />
        <TabButton label="検索" tab="search" active={activeTab} onClick={setActiveTab} icon="🔍" />
        <TabButton
          label="申請"
          tab="requests"
          active={activeTab}
          onClick={setActiveTab}
          icon="📩"
          badge={pendingCount > 0 ? pendingCount : undefined}
        />
        <TabButton label="パーティー" tab="party" active={activeTab} onClick={setActiveTab} icon="⚔️" />
        <TabButton label="設定" tab="settings" active={activeTab} onClick={setActiveTab} icon="🔒" />
      </div>

      {/* コンテンツ */}
      {activeTab === 'list' && (
        <FriendList
          friends={state.friends}
          onViewProfile={setSelectedProfile}
          onRemove={handleRemoveFriend}
        />
      )}
      {activeTab === 'search' && (
        <FriendSearch
          searchQuery={state.searchQuery}
          searchResults={state.searchResults}
          outgoingRequests={state.outgoingRequests}
          friends={state.friends}
          onSearch={handleSearch}
          onSendRequest={handleSendRequest}
          onViewProfile={setSelectedProfile}
        />
      )}
      {activeTab === 'requests' && (
        <FriendRequests
          incomingRequests={state.incomingRequests}
          onAccept={handleAcceptRequest}
          onReject={handleRejectRequest}
        />
      )}
      {activeTab === 'party' && (
        <PartyPanel
          party={state.currentParty}
          friends={state.friends}
          currentUserId={currentUserId}
          onCreateParty={handleCreateParty}
          onInvite={handleInviteToParty}
          onLeave={handleLeaveParty}
          onDisband={handleDisbandParty}
        />
      )}
      {activeTab === 'settings' && (
        <PrivacySettings
          locationPrivacy={state.locationPrivacy}
          onChange={handlePrivacyChange}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// サブコンポーネント
// ---------------------------------------------------------------------------

function TabButton({
  label,
  tab,
  active,
  onClick,
  icon,
  badge,
}: {
  label: string;
  tab: FriendsTab;
  active: FriendsTab;
  onClick: (tab: FriendsTab) => void;
  icon: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active === tab}
      className={`friends-tab${active === tab ? ' friends-tab--active' : ''}`}
      onClick={() => onClick(tab)}
    >
      <span className="friends-tab__icon">{icon}</span>
      <span className="friends-tab__label">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="friends-tab__badge">{badge}</span>
      )}
    </button>
  );
}

/** オンライン状態インジケーター */
function OnlineIndicator({ status }: { status: string }) {
  return (
    <span
      className={`friends-online friends-online--${status}`}
      aria-label={status === 'online' ? 'オンライン' : status === 'away' ? '離席中' : 'オフライン'}
    />
  );
}

/** ユーザーアバター */
function UserAvatar({ profile }: { profile: UserProfile }) {
  const initials = profile.username.slice(0, 1);
  return (
    <div className="friends-avatar">
      {profile.avatarUrl ? (
        <img src={profile.avatarUrl} alt={profile.username} className="friends-avatar__img" />
      ) : (
        <span className="friends-avatar__initials">{initials}</span>
      )}
      <OnlineIndicator status={profile.onlineStatus} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// フレンド一覧
// ---------------------------------------------------------------------------

function FriendList({
  friends,
  onViewProfile,
  onRemove,
}: {
  friends: FriendEntry[];
  onViewProfile: (profile: UserProfile) => void;
  onRemove: (userId: string) => void;
}) {
  if (friends.length === 0) {
    return (
      <div className="friends-empty">
        <p className="friends-empty__icon">👥</p>
        <p className="friends-empty__text">フレンドがまだいません</p>
        <p className="friends-empty__hint">「検索」タブからフレンドを追加しましょう！</p>
      </div>
    );
  }

  return (
    <ul className="friends-list">
      {friends.map((friend) => (
        <li key={friend.friendRecord.friendId} className="friends-card">
          <button
            type="button"
            className="friends-card__profile-btn"
            onClick={() => onViewProfile(friend.profile)}
            aria-label={`${friend.profile.username}のプロフィールを見る`}
          >
            <UserAvatar profile={friend.profile} />
            <div className="friends-card__info">
              <span className="friends-card__name">{friend.profile.username}</span>
              <span className="friends-card__level">Lv.{friend.profile.level}</span>
              {friend.profile.title && (
                <span className="friends-card__title">👑 {friend.profile.title}</span>
              )}
            </div>
          </button>
          <button
            type="button"
            className="friends-card__remove"
            onClick={() => onRemove(friend.profile.userId)}
            aria-label={`${friend.profile.username}を削除`}
          >
            削除
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// フレンド検索
// ---------------------------------------------------------------------------

function FriendSearch({
  searchQuery,
  searchResults,
  outgoingRequests,
  friends,
  onSearch,
  onSendRequest,
  onViewProfile,
}: {
  searchQuery: string;
  searchResults: UserProfile[];
  outgoingRequests: FriendRequest[];
  friends: FriendEntry[];
  onSearch: (query: string) => void;
  onSendRequest: (userId: string) => void;
  onViewProfile: (profile: UserProfile) => void;
}) {
  const isFriendAlready = (userId: string) =>
    friends.some((f) => f.profile.userId === userId);
  const hasPending = (userId: string) =>
    outgoingRequests.some((r) => r.toUserId === userId && r.status === 'pending');

  return (
    <div className="friends-search">
      <div className="friends-search__bar">
        <span className="friends-search__icon">🔍</span>
        <input
          type="text"
          className="friends-search__input"
          placeholder="ユーザー名で検索…"
          value={searchQuery}
          onChange={(e) => onSearch(e.target.value)}
          aria-label="フレンド検索"
        />
      </div>

      {searchResults.length === 0 && searchQuery.trim() !== '' && (
        <p className="friends-search__empty">該当するユーザーが見つかりません</p>
      )}

      {searchResults.length > 0 && (
        <ul className="friends-list">
          {searchResults.map((user) => {
            const alreadyFriend = isFriendAlready(user.userId);
            const pending = hasPending(user.userId);
            return (
              <li key={user.userId} className="friends-card">
                <button
                  type="button"
                  className="friends-card__profile-btn"
                  onClick={() => onViewProfile(user)}
                  aria-label={`${user.username}のプロフィールを見る`}
                >
                  <UserAvatar profile={user} />
                  <div className="friends-card__info">
                    <span className="friends-card__name">{user.username}</span>
                    <span className="friends-card__level">Lv.{user.level}</span>
                    {user.title && (
                      <span className="friends-card__title">👑 {user.title}</span>
                    )}
                  </div>
                </button>
                {alreadyFriend ? (
                  <span className="friends-card__status-badge">フレンド</span>
                ) : pending ? (
                  <span className="friends-card__status-badge friends-card__status-badge--pending">申請中</span>
                ) : (
                  <button
                    type="button"
                    className="friends-card__add"
                    onClick={() => onSendRequest(user.userId)}
                    aria-label={`${user.username}にフレンド申請を送る`}
                  >
                    ＋申請
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// フレンド申請
// ---------------------------------------------------------------------------

function FriendRequests({
  incomingRequests,
  onAccept,
  onReject,
}: {
  incomingRequests: FriendRequest[];
  onAccept: (requestId: string) => void;
  onReject: (requestId: string) => void;
}) {
  const pending = incomingRequests.filter((r) => r.status === 'pending');

  if (pending.length === 0) {
    return (
      <div className="friends-empty">
        <p className="friends-empty__icon">📩</p>
        <p className="friends-empty__text">フレンド申請はありません</p>
      </div>
    );
  }

  return (
    <ul className="friends-list">
      {pending.map((request) => (
        <li key={request.requestId} className="friends-card friends-card--request">
          <div className="friends-card__request-info">
            {request.fromProfile && <UserAvatar profile={request.fromProfile} />}
            <div className="friends-card__info">
              <span className="friends-card__name">
                {request.fromProfile?.username ?? request.fromUserId}
              </span>
              {request.fromProfile && (
                <span className="friends-card__level">Lv.{request.fromProfile.level}</span>
              )}
            </div>
          </div>
          <div className="friends-card__actions">
            <button
              type="button"
              className="friends-card__accept"
              onClick={() => onAccept(request.requestId)}
              aria-label="承認"
            >
              ✓ 承認
            </button>
            <button
              type="button"
              className="friends-card__reject"
              onClick={() => onReject(request.requestId)}
              aria-label="拒否"
            >
              ✗ 拒否
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// パーティー
// ---------------------------------------------------------------------------

function PartyPanel({
  party,
  friends,
  currentUserId,
  onCreateParty,
  onInvite,
  onLeave,
  onDisband,
}: {
  party: Party | null;
  friends: FriendEntry[];
  currentUserId: string;
  onCreateParty: () => void;
  onInvite: (userId: string) => void;
  onLeave: () => void;
  onDisband: () => void;
}) {
  if (!party) {
    return (
      <div className="friends-party">
        <div className="friends-empty">
          <p className="friends-empty__icon">⚔️</p>
          <p className="friends-empty__text">パーティーに参加していません</p>
          <p className="friends-empty__hint">
            パーティーを作成して、フレンドと一緒にボスを倒そう！
          </p>
        </div>
        <button
          type="button"
          className="friends-party__create rpg-btn rpg-btn--primary"
          onClick={onCreateParty}
        >
          ⚔️ パーティーを作成
        </button>
      </div>
    );
  }

  const isLeader = party.leaderId === currentUserId;
  const memberIds = new Set(party.members.map((m) => m.userId));
  const invitableFriends = friends.filter(
    (f) => !memberIds.has(f.profile.userId)
  );
  const canInvite = party.members.length < MAX_PARTY_SIZE;

  return (
    <div className="friends-party">
      <div className="friends-party__header">
        <h3 className="friends-party__title">⚔️ 冒険パーティー</h3>
        <span className="friends-party__count">
          {party.members.length} / {MAX_PARTY_SIZE}
        </span>
      </div>

      {/* メンバーリスト */}
      <ul className="friends-party__members">
        {party.members.map((member) => (
          <li key={member.userId} className="friends-party__member">
            {member.profile && <UserAvatar profile={member.profile} />}
            <div className="friends-card__info">
              <span className="friends-card__name">
                {member.profile?.username ?? member.userId}
                {member.userId === party.leaderId && (
                  <span className="friends-party__leader-badge">リーダー</span>
                )}
              </span>
              {member.profile && (
                <span className="friends-card__level">Lv.{member.profile.level}</span>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* フレンド招待 */}
      {canInvite && invitableFriends.length > 0 && (
        <div className="friends-party__invite">
          <h4 className="friends-party__invite-title">フレンドを招待</h4>
          <ul className="friends-party__invite-list">
            {invitableFriends.map((friend) => (
              <li key={friend.profile.userId} className="friends-party__invite-item">
                <span>{friend.profile.username}</span>
                <button
                  type="button"
                  className="friends-card__add"
                  onClick={() => onInvite(friend.profile.userId)}
                >
                  招待
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 操作ボタン */}
      <div className="friends-party__actions">
        {isLeader ? (
          <button
            type="button"
            className="rpg-btn rpg-btn--outline"
            onClick={onDisband}
          >
            パーティーを解散
          </button>
        ) : (
          <button
            type="button"
            className="rpg-btn rpg-btn--outline"
            onClick={onLeave}
          >
            パーティーを離脱
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// プライバシー設定
// ---------------------------------------------------------------------------

function PrivacySettings({
  locationPrivacy,
  onChange,
}: {
  locationPrivacy: LocationPrivacy;
  onChange: (privacy: LocationPrivacy) => void;
}) {
  const options: { value: LocationPrivacy; label: string; desc: string; icon: string }[] = [
    { value: 'hidden', label: '公開しない', desc: '位置情報を誰にも表示しません', icon: '🚫' },
    { value: 'friends_only', label: 'フレンドのみ公開', desc: 'フレンドにのみ位置情報を表示します', icon: '👥' },
    { value: 'party_only', label: 'パーティー参加中のみ公開', desc: 'パーティーメンバーにのみ表示します', icon: '⚔️' },
  ];

  return (
    <div className="friends-privacy">
      <h3 className="friends-privacy__title">🔒 位置情報のプライバシー</h3>
      <p className="friends-privacy__desc">
        あなたの位置情報を誰に公開するかを設定します。
      </p>
      <div className="friends-privacy__options">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`friends-privacy__option${locationPrivacy === opt.value ? ' friends-privacy__option--active' : ''}`}
            onClick={() => onChange(opt.value)}
            aria-pressed={locationPrivacy === opt.value}
          >
            <span className="friends-privacy__option-icon">{opt.icon}</span>
            <div className="friends-privacy__option-text">
              <span className="friends-privacy__option-label">{opt.label}</span>
              <span className="friends-privacy__option-desc">{opt.desc}</span>
            </div>
            {locationPrivacy === opt.value && (
              <span className="friends-privacy__check">✓</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// プロフィール詳細
// ---------------------------------------------------------------------------

function ProfileDetail({
  profile,
  onBack,
}: {
  profile: UserProfile;
  onBack: () => void;
}) {
  return (
    <div className="friends-profile">
      <button type="button" className="friends-profile__back" onClick={onBack}>
        ← 戻る
      </button>

      <div className="friends-profile__header">
        <div className="friends-profile__avatar-lg">
          <span className="friends-profile__avatar-initials">
            {profile.username.slice(0, 1)}
          </span>
          <OnlineIndicator status={profile.onlineStatus} />
        </div>
        <h2 className="friends-profile__name">{profile.username}</h2>
        <span className="friends-profile__level-badge">Lv.{profile.level}</span>
        {profile.title && (
          <span className="friends-profile__title">👑 {profile.title}</span>
        )}
      </div>

      <div className="friends-profile__stats">
        <div className="friends-profile__stat">
          <span className="friends-profile__stat-icon">📍</span>
          <span className="friends-profile__stat-value">{profile.visitedSpotCount}</span>
          <span className="friends-profile__stat-label">訪問スポット</span>
        </div>
        <div className="friends-profile__stat">
          <span className="friends-profile__stat-icon">⚔️</span>
          <span className="friends-profile__stat-value">{profile.defeatedBossCount}</span>
          <span className="friends-profile__stat-label">ボス討伐</span>
        </div>
        <div className="friends-profile__stat">
          <span className="friends-profile__stat-icon">🚶</span>
          <span className="friends-profile__stat-value">
            {(profile.totalWalkMeters / 1000).toFixed(1)}km
          </span>
          <span className="friends-profile__stat-label">総歩行距離</span>
        </div>
      </div>

      {profile.favoritePhotoUrl && (
        <div className="friends-profile__photo">
          <h3>お気に入り写真</h3>
          <img src={profile.favoritePhotoUrl} alt="お気に入り" />
        </div>
      )}
    </div>
  );
}
