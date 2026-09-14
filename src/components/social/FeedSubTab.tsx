import React, { useState, useEffect, useMemo } from 'react';
import { RookaMark } from '../ui/RookaPoints';
import { formatPaceOrSpeed } from '../../utils/paceFormat';
import { useTheme } from '@/hooks/use-theme';
import { View, Text, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { socialApi } from '../../services/apiServices';
import { wsService } from '../../services/websocket';
import { getFullProfilePhotoUrl } from '../../utils/avatarUtils';
import { getSportIconConfig } from '../../utils/sportIcons';
import { SocialFeedActivity } from '../../types/social';

interface FeedSubTabProps {
  onOpenActivityModal?: (id: string | number, activity?: Partial<SocialFeedActivity>) => void;
  onOpenAthleteProfile?: (userId: number | string) => void;
}

interface FeedDayGroup {
  id: string;
  user_id: number | string;
  username: string;
  profile_picture_url?: string | null;
  rooka_level?: number;
  dateStr: string;
  totalRooka: number;
  activities: SocialFeedActivity[];
  isMultiSport: boolean;
}

export const FeedSubTab: React.FC<FeedSubTabProps> = ({ onOpenActivityModal, onOpenAthleteProfile }) => {
    const theme = useTheme();
  const [loading, setLoading] = useState<boolean>(true);
  const [feedItems, setFeedItems] = useState<SocialFeedActivity[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);

  const fetchPending = async () => {
    try {
      const res = await socialApi.getConnections();
      if (res && res.connections) {
        const pending = res.connections.filter((c: any) => c.status === 'pending_received');
        setPendingRequests(pending);
      }
    } catch {}
  };

  useEffect(() => {
    let isMounted = true;

    const loadFeed = () => {
      fetchPending();
      return socialApi
        .getFeed()
        .then((res) => {
          if (!isMounted) return;
          if (res && Array.isArray(res.activities)) {
            setFeedItems(res.activities);
          }
        })
        .catch((err) => console.log('Feed fetch error:', err))
        .finally(() => {
          if (isMounted) setLoading(false);
        });
    };

    loadFeed();

    const unsubs = [
      wsService.subscribeToEvent('kudos_received', loadFeed),
      wsService.subscribeToEvent('comment_received', loadFeed),
      wsService.subscribeToEvent('connection_request', loadFeed),
      wsService.subscribeToEvent('connection_accepted', loadFeed),
    ];

    return () => {
      isMounted = false;
      unsubs.forEach((off) => off());
    };
  }, []);

  const handleAcceptRequest = async (friendId: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await socialApi.acceptUser(friendId);
      if (res && res.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setPendingRequests((prev) => prev.filter((r) => r.friend_id !== friendId && r.user_id !== friendId));
        socialApi.getFeed().then((feedRes) => {
          if (feedRes && Array.isArray(feedRes.activities)) {
            setFeedItems(feedRes.activities);
          }
        });
      }
    } catch {}
  };

  const handleToggleKudos = async (item: SocialFeedActivity) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const id = item.id;
    const nextHasKudosed = !item.has_kudosed;
    const nextKudosCount = nextHasKudosed ? item.kudos_count + 1 : Math.max(0, item.kudos_count - 1);

    setFeedItems((prev) =>
      prev.map((act) =>
        act.id === id
          ? {
              ...act,
              has_kudosed: nextHasKudosed,
              kudos_count: nextKudosCount,
            }
          : act
      )
    );

    try {
      await socialApi.toggleKudos(id);
    } catch (err) {
      console.error('Toggle kudos error:', err);
    }
  };

  // Group activities from the same user on the same date into a single Brick / Multi-Sport session card
  const groupedFeed = useMemo(() => {
    const groups: FeedDayGroup[] = [];
    const groupMap = new Map<string, FeedDayGroup>();

    feedItems.forEach((act) => {
      const uId = act.user_id || 'unknown';
      const dateKey = act.start_date ? act.start_date.substring(0, 10) : 'recent';
      const key = `${uId}_${dateKey}`;

      if (!groupMap.has(key)) {
        const group: FeedDayGroup = {
          id: key,
          user_id: act.user_id,
          username: act.username,
          profile_picture_url: act.profile_picture_url || (act as any).profilePictureUrl,
          rooka_level: act.rooka_level,
          dateStr: dateKey,
          totalRooka: Math.round(act.rooka_score || 0),
          activities: [act],
          isMultiSport: false,
        };
        groupMap.set(key, group);
        groups.push(group);
      } else {
        const group = groupMap.get(key)!;
        group.activities.push(act);
        group.totalRooka += Math.round(act.rooka_score || 0);
        group.isMultiSport = true;
      }
    });

    return groups;
  }, [feedItems]);

  if (loading && feedItems.length === 0 && pendingRequests.length === 0) {
    return (
      <View className="items-center justify-center p-8">
        <ActivityIndicator size="large" color={theme.tint} />
        <Text className="text-xs font-bold text-theme-muted mt-3">Loading social feed...</Text>
      </View>
    );
  }

  return (
    <View className="gap-y-3.5 pb-4">
      {/* PENDING FRIEND REQUESTS BANNER */}
      {pendingRequests.length > 0 && (
        <View className="bg-theme-accent/10 border border-theme-accent/30 rounded-2xl p-3.5 mb-3">
          <View className="flex-row items-center gap-x-2 mb-2.5">
            <Ionicons name="person-add" size={16} color={theme.tint} />
            <Text className="text-xs font-extrabold text-theme-accent">
              Friend Requests ({pendingRequests.length})
            </Text>
          </View>
          {pendingRequests.map((req) => {
            const reqAvatarUri = getFullProfilePhotoUrl(req.profile_picture_url || req.profilePictureUrl);
            return (
              <View
                key={`feed-req-${req.friend_id || req.user_id}`}
                className="flex-row items-center justify-between bg-theme-card p-3 rounded-tile border border-theme-border/50 mb-1.5"
              >
                <View className="flex-row items-center gap-x-3">
                  {reqAvatarUri ? (
                    <Image source={{ uri: reqAvatarUri }} className="w-8 h-8 rounded-full border border-theme-accent/40" />
                  ) : (
                    <View className="w-8 h-8 rounded-full bg-theme-accent/20 items-center justify-center">
                      <Text className="text-xs font-extrabold text-theme-accent">
                        {(req.username || 'A').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <Text className="text-sm font-extrabold text-theme-text">{req.username}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => handleAcceptRequest(req.friend_id || req.user_id)}
                  className="bg-semantic-success px-3.5 py-1.5 rounded-lg"
                >
                  <Text className="text-xs font-extrabold text-white">Accept</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}

      {groupedFeed.length === 0 ? (
        <View className="items-center justify-center p-8 bg-theme-card border border-theme-border/60 rounded-card my-2">
          <Ionicons name="people-outline" size={36} color={theme.textSecondary} style={{ marginBottom: 8 }} />
          <Text className="text-sm font-bold text-theme-text text-center">No Recent Activity</Text>
          <Text className="text-xs text-theme-muted text-center mt-1 px-4 leading-relaxed">
            No activity from your connections yet. Tap the + icon at the top right to find and add athlete friends!
          </Text>
        </View>
      ) : (
        groupedFeed.map((group) => {
          const itemAvatarUri = getFullProfilePhotoUrl(group.profile_picture_url);
          const primaryActivity = group.activities[0];
          const primaryPace = formatPaceOrSpeed(
            primaryActivity.distance_km,
            primaryActivity.moving_time_min,
            primaryActivity.sport_type,
            primaryActivity.name || primaryActivity.title,
          );
          const hasKudosed = group.activities.some((a) => a.has_kudosed);
          const totalKudos = group.activities.reduce((sum, a) => sum + (a.kudos_count || 0), 0);
          const totalComments = group.activities.reduce((sum, a) => sum + (a.comments_count || 0), 0);

          return (
            <View
              key={`feed-group-${group.id}`}
              className="bg-theme-card rounded-card p-4 shadow-sm mb-3.5 border border-slate-100 dark:border-slate-800/60"
            >
              {/* Tight Athlete Header */}
              <View className="flex-row justify-between items-center mb-2.5">
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => {
                    if (group.user_id && onOpenAthleteProfile) {
                      onOpenAthleteProfile(group.user_id);
                    }
                  }}
                  className="flex-row items-center flex-1 pr-2"
                >
                  {itemAvatarUri ? (
                    <Image source={{ uri: itemAvatarUri }} className="w-10 h-10 rounded-full mr-3" />
                  ) : (
                    <View className="w-10 h-10 rounded-full bg-theme-accent/20 items-center justify-center mr-3">
                      <Text className="text-sm font-extrabold text-theme-accent">
                        {group.username ? group.username.charAt(0).toUpperCase() : 'A'}
                      </Text>
                    </View>
                  )}
                  <View className="flex-1">
                    <View className="flex-row items-center gap-x-1.5 flex-wrap">
                      <Text className="text-sm font-extrabold text-theme-text">{group.username}</Text>
                      {group.rooka_level ? (
                        <View className="px-1.5 py-0.2 bg-theme-accent/15 rounded">
                          <Text className="text-xs font-extrabold text-theme-accent font-rajdhani">Lvl {group.rooka_level}</Text>
                        </View>
                      ) : null}
                      {group.isMultiSport && (
                        <View className="px-1.5 py-0.2 bg-theme-accent/15 rounded">
                          <Text className="text-xs font-extrabold text-theme-accent">Brick ({group.activities.length})</Text>
                        </View>
                      )}
                    </View>
                    <Text className="text-xs text-theme-muted mt-0.5">
                      {group.dateStr}
                    </Text>
                  </View>
                </TouchableOpacity>

                <View className="px-2.5 py-1 bg-theme-accent/15 rounded-full flex-row items-center">
                  <RookaMark size={11} />
                  <Text className="text-xs font-extrabold font-rajdhani text-theme-accent ml-1">
                    +{group.totalRooka} rooka
                  </Text>
                </View>
              </View>

              {/* Workout Body: Single Activity or Multi-Activity Brick Stack */}
              {group.activities.length === 1 ? (
                // Single Activity Card (Clean background, NO thick border)
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => onOpenActivityModal && onOpenActivityModal(primaryActivity.id, primaryActivity)}
                  className="bg-theme-bg p-3.5 rounded-xl mb-2.5"
                >
                  <View className="flex-row items-center justify-between mb-2">
                    <View className="flex-row items-center gap-x-2 flex-1 pr-2">
                      {(() => {
                        const iconConfig = getSportIconConfig(primaryActivity.sport_type, primaryActivity.name || primaryActivity.title);
                        return (
                          <View className={`w-7 h-7 rounded-lg items-center justify-center ${iconConfig.bgColor}`}>
                            <Ionicons name={iconConfig.name as any} size={15} color={iconConfig.color} />
                          </View>
                        );
                      })()}
                      <Text className="text-sm font-extrabold text-theme-text" numberOfLines={1}>
                        {primaryActivity.name || primaryActivity.title || 'Workout'}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={14} color={theme.textSecondary} />
                  </View>

                  <View className="flex-row items-center gap-x-4 pt-1.5 border border-theme-border/50">
                    {typeof primaryActivity.distance_km === 'number' && primaryActivity.distance_km > 0 && (
                      <View>
                        <Text className="text-xs text-theme-muted font-bold uppercase">Distance</Text>
                        <Text className="text-sm font-extrabold font-mono text-theme-text">{primaryActivity.distance_km.toFixed(1)} km</Text>
                      </View>
                    )}
                    {typeof primaryActivity.moving_time_min === 'number' && primaryActivity.moving_time_min > 0 && (
                      <View className={typeof primaryActivity.distance_km === 'number' && primaryActivity.distance_km > 0 ? 'pl-4 border-l border-theme-border/60' : ''}>
                        <Text className="text-xs text-theme-muted font-bold uppercase">Duration</Text>
                        <Text className="text-sm font-extrabold font-mono text-theme-text">{Math.round(primaryActivity.moving_time_min)} mins</Text>
                      </View>
                    )}
                    {/* Distance and duration alone told a runner nothing about
                        how the session actually went. Unit follows the sport. */}
                    {primaryPace && (
                      <View className="pl-4 border-l border-theme-border/60">
                        <Text className="text-xs text-theme-muted font-bold uppercase">
                          {primaryPace.endsWith('km/h') ? 'Speed' : 'Pace'}
                        </Text>
                        <Text className="text-sm font-extrabold font-mono text-theme-text">{primaryPace}</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              ) : (
                // Multi-Activity Stack (Brick Session / Triathlons)
                <View className="gap-y-1.5 mb-2.5">
                  {group.activities.map((act, actIdx) => {
                    const iconConfig = getSportIconConfig(act.sport_type, act.name || act.title);
                    return (
                      <TouchableOpacity
                        key={`brick-act-${act.id}-${actIdx}`}
                        activeOpacity={0.8}
                        onPress={() => onOpenActivityModal && onOpenActivityModal(act.id, act)}
                        className="bg-theme-bg p-2.5 rounded-xl flex-row items-center justify-between"
                      >
                        <View className="flex-row items-center gap-x-2.5 flex-1 pr-2">
                          <View className={`w-7 h-7 rounded-lg items-center justify-center ${iconConfig.bgColor}`}>
                            <Ionicons name={iconConfig.name as any} size={15} color={iconConfig.color} />
                          </View>
                          <View className="flex-1">
                            <Text className="text-xs font-extrabold text-theme-text" numberOfLines={1}>
                              {act.name || act.title || 'Workout'}
                            </Text>
                            <Text className="text-xs text-theme-muted font-medium">
                              {[
                                typeof act.distance_km === 'number' && act.distance_km > 0
                                  ? `${act.distance_km.toFixed(1)} km`
                                  : null,
                                typeof act.moving_time_min === 'number' && act.moving_time_min > 0
                                  ? `${Math.round(act.moving_time_min)} mins`
                                  : null,
                                // Pace was missing entirely, which for a runner
                                // is the one number that matters. Unit follows
                                // the sport; omitted when it has no meaning.
                                formatPaceOrSpeed(
                                  act.distance_km,
                                  act.moving_time_min,
                                  act.sport_type,
                                  act.name || act.title,
                                ),
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </Text>
                          </View>
                        </View>

                        <View className="flex-row items-center gap-x-1.5">
                          <Text className="text-xs font-extrabold font-rajdhani text-theme-accent">
                            +{Math.round(act.rooka_score || 0)}
                          </Text>
                          <Ionicons name="chevron-forward" size={13} color={theme.textSecondary} />
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {/* Footer Actions */}
              <View className="flex-row items-center justify-between pt-2.5 border-t border-slate-100 dark:border-slate-800/60">
                <TouchableOpacity
                  onPress={() => handleToggleKudos(primaryActivity)}
                  className={`flex-row items-center gap-x-1.5 px-3 py-1.5 rounded-full ${
                    hasKudosed ? 'bg-theme-accent/15' : 'bg-theme-bg'
                  }`}
                >
                  <Ionicons
                    name={hasKudosed ? 'flash' : 'flash-outline'}
                    size={15}
                    color={hasKudosed ? theme.tint : '#6F6F79'}
                  />
                  <Text className={`text-xs font-extrabold font-mono ${hasKudosed ? 'text-theme-accent' : 'text-theme-muted'}`}>
                    {totalKudos}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => onOpenActivityModal && onOpenActivityModal(primaryActivity.id, primaryActivity)}
                  className="flex-row items-center gap-x-1.5 px-3 py-1.5 rounded-full bg-theme-bg"
                >
                  <Ionicons name="chatbubble-outline" size={15} color={theme.textSecondary} />
                  {/* "0 Comments" as a button label read as a broken counter.
                      Show the count only once there is one, and pluralise it. */}
                  <Text className="text-xs font-bold text-theme-muted">
                    {totalComments > 0
                      ? `${totalComments} ${totalComments === 1 ? 'Comment' : 'Comments'}`
                      : 'Comment'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })
      )}
    </View>
  );
};
