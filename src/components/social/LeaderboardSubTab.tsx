import React, { useState, useEffect } from 'react';
import { useTheme } from '@/hooks/use-theme';
import { View, Text, TouchableOpacity, ActivityIndicator, Animated, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { canAccessLeaderboard } from '../../utils/permissions';
import { useUser } from '../../context/UserStore';
import { useRouter } from 'expo-router';
import { socialApi } from '../../services/apiServices';
import { LeaderboardEntry } from '../../types/social';

/** Height of the switcher block, so a caller can animate it in without a jump. */
export const LEADERBOARD_SWITCHER_HEIGHT = 46;

export interface LeaderboardTypeSwitcherProps {
  /** Horizontal scroll offset of the pager holding the two leaderboard pages. */
  scrollX?: Animated.Value;
  /** Which list is showing, when there is no pager to read it from. */
  currentType?: 'rooka' | 'quests';
  onSwitchType?: (type: 'rooka' | 'quests') => void;
}

/**
 * The [rooka score | 7-Day Quests] switcher.
 *
 * Lives outside the pager. It used to be rendered inside each of the two
 * leaderboard pages, so swiping between them slid two copies of the header
 * across the screen — the header is a control for the pager, not content in it,
 * and a control that moves with the thing it controls is disorienting.
 */
export const LeaderboardTypeSwitcher: React.FC<LeaderboardTypeSwitcherProps> = ({
  scrollX,
  currentType = 'rooka',
  onSwitchType,
}) => {
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const subSegmentWidth = (SCREEN_WIDTH - 40 - 8) / 2;

  // Pages 2 and 3 of the Social pager are the two leaderboards.
  const track = (from: number, to: number) =>
    scrollX
      ? scrollX.interpolate({
          inputRange: [2 * SCREEN_WIDTH, 3 * SCREEN_WIDTH],
          outputRange: [from, to],
          extrapolate: 'clamp',
        })
      : currentType === 'rooka'
      ? from
      : to;

  const handlePress = (type: 'rooka' | 'quests') => {
    Haptics.selectionAsync();
    onSwitchType?.(type);
  };

  return (
    <View
      style={{ height: LEADERBOARD_SWITCHER_HEIGHT }}
      className="relative flex-row bg-theme-bg dark:bg-slate-800 rounded-xl p-1 overflow-hidden border border-theme-border"
    >
      <Animated.View
        className="absolute top-1 bottom-1 bg-theme-accent rounded-lg shadow-xs"
        style={{
          left: 4,
          width: subSegmentWidth,
          transform: [{ translateX: track(0, subSegmentWidth) }],
        }}
      />

      <TouchableOpacity
        onPress={() => handlePress('rooka')}
        className="flex-1 items-center justify-center z-10"
      >
        <View className="relative items-center justify-center">
          <Animated.Text
            style={{ opacity: track(1, 0) }}
            className="text-xs font-extrabold text-white absolute"
          >
            rooka score
          </Animated.Text>
          <Animated.Text
            style={{ opacity: track(0, 1) }}
            className="text-xs font-extrabold text-theme-muted"
          >
            rooka score
          </Animated.Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => handlePress('quests')}
        className="flex-1 items-center justify-center z-10"
      >
        <View className="relative items-center justify-center">
          <Animated.Text
            style={{ opacity: track(0, 1) }}
            className="text-xs font-extrabold text-white absolute"
          >
            7-Day Quests
          </Animated.Text>
          <Animated.Text
            style={{ opacity: track(1, 0) }}
            className="text-xs font-extrabold text-theme-muted"
          >
            7-Day Quests
          </Animated.Text>
        </View>
      </TouchableOpacity>
    </View>
  );
};

export interface LeaderboardSubTabProps {
  type?: 'rooka' | 'quests';
  onSwitchType?: (type: 'rooka' | 'quests') => void;
  scrollX?: Animated.Value;
  loading?: boolean;
  rookaLeaderboard?: LeaderboardEntry[];
  questLeaderboard?: LeaderboardEntry[];
  hasAccess?: boolean;
  onOpenAthleteProfile?: (userId: number | string) => void;
  /**
   * Render the type switcher inline. Social passes false and renders
   * LeaderboardTypeSwitcher in its fixed header instead, so the control does not
   * slide away with the pages it controls.
   */
  showSwitcher?: boolean;
}

import { useSubscription } from '../../context/SubscriptionStore';

export const LeaderboardSubTab: React.FC<LeaderboardSubTabProps> = ({
  type,
  onSwitchType,
  scrollX,
  loading: controlledLoading,
  rookaLeaderboard: controlledRooka,
  questLeaderboard: controlledQuests,
  hasAccess: controlledHasAccess,
  onOpenAthleteProfile,
  showSwitcher = true,
}) => {
    const theme = useTheme();
  const { user } = useUser();
  const { presentPaywall } = useSubscription();
  const router = useRouter();

  const [internalActiveTab, setInternalActiveTab] = useState<'rooka' | 'quests'>('rooka');
  const [internalLoading, setInternalLoading] = useState<boolean>(true);
  const [internalRookaLeaderboard, setInternalRookaLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [internalQuestLeaderboard, setInternalQuestLeaderboard] = useState<LeaderboardEntry[]>([]);

  const isControlled = type !== undefined;
  const currentType = type ?? internalActiveTab;
  const hasAccess = controlledHasAccess !== undefined ? controlledHasAccess : canAccessLeaderboard(user?.subscription_tier);
  const loading = controlledLoading !== undefined ? controlledLoading : internalLoading;
  const rookaLeaderboard = controlledRooka ?? internalRookaLeaderboard;
  const questLeaderboard = controlledQuests ?? internalQuestLeaderboard;

  useEffect(() => {
    if (isControlled) return;
    if (!hasAccess) {
      setInternalLoading(false);
      return;
    }

    let isMounted = true;
    socialApi
      .getLeaderboard()
      .then((res) => {
        if (!isMounted) return;
        if (res?.leaderboard && Array.isArray(res.leaderboard)) {
          setInternalRookaLeaderboard(res.leaderboard.map((item, idx) => ({ ...item, rank: idx + 1 })));
        }
        if (res?.questLeaderboard && Array.isArray(res.questLeaderboard)) {
          setInternalQuestLeaderboard(res.questLeaderboard.map((item, idx) => ({ ...item, rank: idx + 1 })));
        }
      })
      .catch((err) => console.log('Leaderboard fetch error:', err))
      .finally(() => {
        if (isMounted) setInternalLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [hasAccess, isControlled]);

  const activeList = currentType === 'rooka' ? rookaLeaderboard : questLeaderboard;

  const handleTabSwitch = (newType: 'rooka' | 'quests') => {
    Haptics.selectionAsync();
    if (onSwitchType) {
      onSwitchType(newType);
    } else {
      setInternalActiveTab(newType);
    }
  };

  if (!hasAccess) {
    return (
      <View className="bg-theme-card border border-theme-border rounded-card p-6 items-center justify-center mt-4 shadow-sm">
        <Ionicons name="lock-closed-outline" size={48} color={theme.tint} />
        <Text className="text-lg font-extrabold text-theme-text mt-4 text-center">Leaderboard Locked</Text>
        <Text className="text-sm text-theme-muted mt-2 text-center leading-relaxed font-rajdhani">
          Upgrade to the rooka+ subscription to unlock global leaderboards and rank against your friends.
        </Text>
        <TouchableOpacity
          onPress={() => router.navigate({ pathname: '/profile', params: { subtab: 'account' } })}
          className="mt-6 bg-theme-accent px-6 py-3 rounded-full shadow-md"
        >
          <Text className="text-white font-extrabold text-center font-rajdhani">Upgrade to rooka+</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="gap-y-4 mb-8">
      {showSwitcher && (
        <View className="mb-4">
          <LeaderboardTypeSwitcher
            scrollX={scrollX}
            currentType={currentType}
            onSwitchType={handleTabSwitch}
          />
        </View>
      )}

      {/* Leaderboard Ranks List */}
      {loading ? (
        <View className="items-center justify-center p-8">
          <ActivityIndicator size="large" color={theme.tint} />
          <Text className="text-xs font-bold text-theme-muted mt-3">Fetching leaderboard rankings...</Text>
        </View>
      ) : (
        activeList.map((item) => {
          const isCurrentUser = user?.id ? item.user_id === user.id : item.username === user?.username;
          const questsCount = (item as any).completed_quests_count ?? item.quests_completed_7d ?? 0;

          return (
            <TouchableOpacity
              key={`rank-${item.user_id || item.rank}-${currentType}`}
              activeOpacity={0.75}
              onPress={() => {
                const athleteTargetId = item.user_id || (item as any).id;
                if (athleteTargetId && onOpenAthleteProfile) {
                  onOpenAthleteProfile(athleteTargetId);
                }
              }}
              className={`bg-theme-card border rounded-2xl p-4 mb-2.5 flex-row justify-between items-center shadow-sm ${
                isCurrentUser ? 'border-theme-accent bg-theme-accent/5' : 'border-theme-border'
              }`}
            >
              <View className="flex-row items-center gap-x-3">
                <View
                  className={`w-9 h-9 rounded-full items-center justify-center ${
                    item.rank === 1
                      ? 'bg-medal-gold border border-medal-gold'
                      : item.rank === 2
                      ? 'bg-medal-silver border border-medal-silver'
                      : item.rank === 3
                      ? 'bg-medal-bronze border border-medal-bronze'
                      : 'bg-theme-bg border border-theme-border'
                  }`}
                >
                  <Text
                    className={`text-xs font-extrabold ${
                      item.rank <= 3 ? 'text-slate-950' : 'text-theme-muted'
                    }`}
                  >
                    #{item.rank}
                  </Text>
                </View>

                <View>
                  <View className="flex-row items-center gap-x-1.5">
                    <Text className="text-sm font-extrabold text-theme-text">{item.username}</Text>
                    {isCurrentUser && (
                      <View className="bg-theme-accent px-1.5 py-0.5 rounded">
                        <Text className="text-xs font-extrabold text-white">YOU</Text>
                      </View>
                    )}
                  </View>
                  <Text className="text-xs text-theme-muted font-medium font-rajdhani">
                    Lvl {item.rooka_level || 1} · {questsCount}{' '}
                    {questsCount === 1 ? 'Quest' : 'Quests'} Completed
                  </Text>
                </View>
              </View>

              <View className="items-end">
                <Text className="text-base font-extrabold text-theme-accent font-mono font-rajdhani">
                  {currentType === 'rooka' ? Math.round(item.total_rooka_score || 0) : questsCount}
                </Text>
                <Text className="text-xs text-theme-muted font-bold font-rajdhani">
                  {currentType === 'rooka' ? 'Points' : 'Quests'}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })
      )}

      {/* A three-person board left roughly two thirds of the screen empty with
          nothing to do in it. The board is only interesting once you have
          people on it, so the empty space carries the action that fills it. */}
      {!loading && activeList.length < 5 && (
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => router.navigate({ pathname: '/profile', params: { subtab: 'connections' } })}
          className="mt-2 items-center bg-theme-card border border-dashed border-theme-border rounded-card p-6"
        >
          <Ionicons name="people-outline" size={28} color={theme.tint} />
          <Text className="text-sm font-extrabold text-theme-text mt-3 text-center">
            {activeList.length === 0 ? 'No one on the board yet' : 'Add more athletes'}
          </Text>
          <Text className="text-xs text-theme-muted mt-1 text-center leading-relaxed">
            A leaderboard needs rivals. Connect with athletes to see how your
            week stacks up.
          </Text>
          <View className="mt-4 px-4 py-2 bg-theme-accent rounded-control">
            <Text className="text-xs font-extrabold text-white">Find athletes</Text>
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
};
