import { Ionicons } from '@expo/vector-icons';
import { RookaPoints } from '../ui/RookaPoints';
import { BrandColors, Colors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import * as Haptics from 'expo-haptics';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useActivities } from '../../context/ActivityStore';
import { useGamification } from '../../context/GamificationStore';
import { useUser } from '../../context/UserStore';
import { Activity } from '../../types/activity';
import { BottomSheetModal } from '../ui/BottomSheetModal';

interface MyLogSubTabProps {
  onOpenActivityModal?: (id: string | number, activity?: Partial<Activity>) => void;
}

function formatHumanizedDate(dateString?: string): string {
  if (!dateString) return 'Recent';
  try {
    const actDate = new Date(dateString);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(actDate.getFullYear(), actDate.getMonth(), actDate.getDate());
    const diffDays = Math.round((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays > 1 && diffDays < 7) {
      return actDate.toLocaleDateString('en-US', { weekday: 'short' });
    }

    return actDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch (e) {
    return dateString.substring(0, 10);
  }
}

function formatDuration(minutes?: number): string {
  if (!minutes || minutes <= 0) return '0:00';
  const totalSecs = Math.round(minutes * 60);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function getSportVisuals(sportType?: string, name?: string, accent = Colors.light.tint) {
  const sport = (sportType || '').toLowerCase();
  const n = (name || '').toLowerCase();

  if (
    sport.includes('bike') ||
    sport.includes('ride') ||
    sport.includes('cycl') ||
    n.includes('ride') ||
    n.includes('bike')
  ) {
    return {
      icon: 'bicycle-outline' as const,
      color: accent,
      label: 'Cycle',
    };
  }
  if (sport.includes('swim') || sport.includes('water') || n.includes('swim')) {
    return {
      icon: 'water-outline' as const,
      color: '#38BDF8',
      label: 'Swim',
    };
  }
  if (
    sport.includes('weight') ||
    sport.includes('strength') ||
    sport.includes('gym') ||
    sport.includes('barbell') ||
    sport.includes('lift') ||
    n.includes('lift') ||
    n.includes('strength')
  ) {
    return {
      icon: 'barbell-outline' as const,
      color: '#C084FC',
      label: 'Strength',
    };
  }
  if (
    sport.includes('yoga') ||
    sport.includes('pilates') ||
    sport.includes('mobility') ||
    sport.includes('stretch') ||
    n.includes('mobility') ||
    n.includes('yoga')
  ) {
    return {
      icon: 'body-outline' as const,
      color: '#34D399',
      label: 'Mobility',
    };
  }
  if (sport.includes('walk') || sport.includes('hike') || n.includes('walk') || n.includes('hike')) {
    return {
      icon: 'footsteps-outline' as const,
      color: '#F59E0B',
      label: 'Walk',
    };
  }
  // Default: Running / Workout
  return {
    icon: 'walk-outline' as const,
    color: accent,
    label: 'Ran',
  };
}

function CircularProgressChamber({
  progress = 0.75,
  icon,
  iconColor = BrandColors.primary,
  size = 54,
  strokeWidth = 3,
}: {
  progress?: number;
  icon: string;
  iconColor?: string;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - Math.min(1, Math.max(0.04, progress)) * circumference;

  return (
    <View
      style={{ width: size, height: size }}
      className="rounded-full items-center justify-center bg-slate-200/50 dark:bg-white/[0.08] border border-slate-300/60 dark:border-white/15 relative"
    >
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(148, 163, 184, 0.2)"
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={iconColor}
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
      <Ionicons name={icon as any} size={20} color={iconColor} />
    </View>
  );
}

// Calculate Real Consecutive Day Activity Streak
function calculateRealStreak(activities: Activity[]): number {
  if (!activities || activities.length === 0) return 0;

  const formatDateStr = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const activityDates = new Set(
    activities
      .filter((a) => a.start_date)
      .map((a) => a.start_date.substring(0, 10))
  );

  const now = new Date();
  const todayStr = formatDateStr(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = formatDateStr(yesterday);

  // If no activity today and no activity yesterday, streak is 0
  if (!activityDates.has(todayStr) && !activityDates.has(yesterdayStr)) {
    return 0;
  }

  let streak = 0;
  let checkDate = activityDates.has(todayStr) ? new Date(now) : new Date(yesterday);

  while (true) {
    const dateStr = formatDateStr(checkDate);
    if (activityDates.has(dateStr)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

export const MyLogSubTab: React.FC<MyLogSubTabProps> = ({ onOpenActivityModal }) => {
  const theme = useTheme();
  const { user } = useUser();
  const { activities, loading } = useActivities();
  const { quests, generateQuest: generateNewQuest, swapQuest: swapActiveQuest } = useGamification();

  const [isQuestModalOpen, setIsQuestModalOpen] = useState(false);
  const [questActionLoading, setQuestActionLoading] = useState(false);

  const activeQuest = quests?.find((q) => q.status === 'active') || null;
  const currentProgress = activeQuest
    ? Math.round(activeQuest.current_value !== undefined ? activeQuest.current_value : (activeQuest.progress || 0))
    : 0;
  const targetVal = activeQuest ? Math.round(activeQuest.target_value || 1) : 1;
  const questProgressPercent = activeQuest
    ? (activeQuest.progress_percent !== undefined
        ? activeQuest.progress_percent
        : Math.min(100, Math.round((currentProgress / targetVal) * 100)))
    : 0;

  // Real Streak Calculation
  const realStreak = useMemo(() => {
    return calculateRealStreak(activities);
  }, [activities]);

  const handleGenerateQuest = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setQuestActionLoading(true);
    try {
      if (activeQuest) {
        await swapActiveQuest(activeQuest.id);
      } else {
        await generateNewQuest();
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error('Generate quest error in MyLog:', err);
    } finally {
      setQuestActionLoading(false);
    }
  };

  return (
    <View className="gap-y-5 pb-6">
      {/* SECTION 1: GOAL CRUSHER CARDS */}
      <View>
        <View className="flex-row justify-between items-center mb-3 px-0.5">
          <Text className="text-lg font-extrabold text-theme-text tracking-tight">
            Quests
          </Text>
          <Text className="text-xs font-semibold text-theme-muted">
            Active
          </Text>
        </View>

        {/* 2-CARD FROSTED GLASS ROW */}
        <View className="flex-row gap-3">
          {/* CARD 1: ACTIVE QUEST */}
          <TouchableOpacity
            onPress={() => {
              Haptics.selectionAsync();
              setIsQuestModalOpen(true);
            }}
            activeOpacity={0.8}
            className="flex-1 bg-theme-card/90 dark:bg-white/[0.06] border border-theme-border dark:border-white/[0.1] rounded-card p-4 justify-between h-[152px] shadow-xs"
          >
            <View>
              <Text className="text-xs font-semibold text-theme-muted dark:text-theme-muted">
                Active Quest
              </Text>
              <Text className="text-xl font-extrabold text-theme-text tracking-tight mt-0.5 font-mono">
                {activeQuest ? `${currentProgress} / ${targetVal}` : 'No Quest'}
              </Text>
            </View>

            <View className="flex-row items-end justify-between">
              <View className="bg-slate-100 dark:bg-white/10 px-3 py-1 rounded-full border border-theme-border/80 dark:border-white/10">
                <Text className="text-xs font-bold text-theme-text font-mono">
                  {questProgressPercent}%
                </Text>
              </View>
              <CircularProgressChamber
                progress={questProgressPercent / 100}
                icon="trophy"
                iconColor="#F59E0B"
              />
            </View>
          </TouchableOpacity>

          {/* CARD 2: REAL STREAK */}
          <View className="flex-1 bg-theme-card/90 dark:bg-white/[0.06] border border-theme-border dark:border-white/[0.1] rounded-card p-4 justify-between h-[152px] shadow-xs">
            <View>
              <Text className="text-xs font-semibold text-theme-muted dark:text-theme-muted">
                Streak
              </Text>
              <Text className="text-xl font-extrabold text-theme-text tracking-tight mt-0.5 font-mono">
                {realStreak} {realStreak === 1 ? 'Day' : 'Days'}
              </Text>
            </View>

            <View className="flex-row items-end justify-between">
              <View className="bg-slate-100 dark:bg-white/10 px-2.5 py-1 rounded-full border border-theme-border/80 dark:border-white/10">
                <Text className="text-xs font-bold text-theme-text">
                  {realStreak > 0 ? 'Keep it up!' : 'Start today!'}
                </Text>
              </View>
              <CircularProgressChamber
                progress={realStreak > 0 ? Math.min(1, realStreak / 7) : 0.05}
                icon="flame"
                iconColor={theme.tint}
              />
            </View>
          </View>
        </View>
      </View>

      {/* SECTION 2: RECENT ACTIVITIES LIST */}
      <View>
        <View className="flex-row justify-between items-center mb-3 px-0.5">
          <Text className="text-lg font-extrabold text-theme-text tracking-tight">
            Recent Activities
          </Text>
          <Text className="text-xs font-semibold text-theme-muted">
            {activities.length} total
          </Text>
        </View>

        {/* Activity List Items */}
        {loading && activities.length === 0 ? (
          <View className="items-center justify-center p-8 bg-theme-card/80 dark:bg-white/[0.06] border border-theme-border dark:border-white/[0.1] rounded-card">
            <ActivityIndicator size="large" color={theme.tint} />
            <Text className="text-xs font-bold text-theme-muted mt-3">Loading activities...</Text>
          </View>
        ) : activities.length === 0 ? (
          <View className="p-8 items-center justify-center bg-theme-card/80 dark:bg-white/[0.06] border border-theme-border dark:border-white/[0.1] rounded-card">
            <Ionicons name="fitness-outline" size={32} color={theme.textSecondary} />
            <Text className="text-sm font-semibold text-theme-muted mt-2">No activity history recorded yet.</Text>
          </View>
        ) : (
          <View className="gap-y-2.5">
            {activities.map((act) => {
              const idStr = String(act.id);
              const visuals = getSportVisuals(act.sport_type, act.name, theme.tint);
              const dateStr = formatHumanizedDate(act.start_date);
              const hasDistance = typeof act.distance_km === 'number' && act.distance_km > 0;
              const primaryStat = hasDistance
                ? `${act.distance_km!.toFixed(1)}km`
                : `${Math.round(act.moving_time_min || 0)} mins`;
              const secondaryStat = hasDistance ? formatDuration(act.moving_time_min) : null;
              const secondaryPoints = hasDistance
                ? null
                : Math.round(act.rooka_score || act.tss || 0);

              return (
                <TouchableOpacity
                  key={`act-${idStr}`}
                  onPress={() => onOpenActivityModal && onOpenActivityModal(act.id, act)}
                  activeOpacity={0.75}
                  className="bg-theme-card/90 dark:bg-white/[0.06] border border-theme-border dark:border-white/[0.1] rounded-card p-3.5 flex-row items-center justify-between mb-2.5 shadow-xs"
                >
                  {/* Left: Circular Icon & Titles */}
                  <View className="flex-row items-center flex-1 pr-3">
                    <View className="w-12 h-12 rounded-full items-center justify-center bg-slate-100 dark:bg-white/10 border border-theme-border/60 dark:border-white/15 mr-3.5">
                      <Ionicons name={visuals.icon} size={22} color={visuals.color} />
                    </View>

                    <View className="flex-1">
                      <Text className="text-base font-bold text-theme-text" numberOfLines={1}>
                        {act.name || visuals.label}
                      </Text>
                      <Text className="text-xs font-medium text-theme-muted mt-0.5">
                        {dateStr}
                      </Text>
                    </View>
                  </View>

                  {/* Right: Big Metric & Duration/Score */}
                  <View className="items-end">
                    <Text className="text-base font-extrabold text-theme-text font-mono">
                      {primaryStat}
                    </Text>
                    {secondaryStat !== null ? (
                      <Text className="text-xs font-medium text-theme-muted font-mono mt-0.5">
                        {secondaryStat}
                      </Text>
                    ) : (
                      <View className="mt-0.5">
                        <RookaPoints value={secondaryPoints ?? 0} color={theme.textSecondary} />
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      {/* Quest Detail BottomSheetModal */}
      <BottomSheetModal
        visible={isQuestModalOpen}
        onClose={() => setIsQuestModalOpen(false)}
        showHandle
      >
        <View className="flex-row items-center justify-between mb-4">
          <View className="flex-row items-center gap-3">
            <View className="w-12 h-12 rounded-2xl bg-semantic-warning/15 items-center justify-center">
              <Ionicons name="trophy" size={26} color={theme.tint} />
            </View>
            <View>
              <Text className="text-lg font-extrabold text-theme-text">Active Quest</Text>
              <Text className="text-xs text-theme-muted font-bold">Weekly Challenge</Text>
            </View>
          </View>
          {activeQuest?.reward_points ? (
            <View className="bg-semantic-warning/15 px-3 py-1.5 rounded-full">
              <Text className="text-sm font-mono font-extrabold text-semantic-warning font-rajdhani">
                +{Math.round(activeQuest.reward_points)} rooka
              </Text>
            </View>
          ) : null}
        </View>

        <View className="bg-theme-bg p-4 rounded-2xl border border-theme-border/60 mb-5">
          <Text className="text-sm font-bold text-theme-text leading-relaxed font-rajdhani">
            {activeQuest?.description || 'Complete your active challenges this week to earn bonus rooka points.'}
          </Text>
        </View>

        <View className="mb-6">
          <View className="flex-row justify-between items-center mb-2">
            <Text className="text-xs font-bold text-theme-muted">
              Progress ({currentProgress} / {targetVal})
            </Text>
            <Text className="text-sm font-mono font-bold text-semantic-warning">
              {questProgressPercent}%
            </Text>
          </View>
          <View className="w-full h-3 bg-theme-bg rounded-full overflow-hidden">
            <View
              className="h-full bg-semantic-warning rounded-full"
              style={{ width: `${questProgressPercent}%` }}
            />
          </View>
        </View>

        <View className="flex-row gap-3">
          <TouchableOpacity
            onPress={handleGenerateQuest}
            disabled={questActionLoading}
            className="flex-1 py-3.5 bg-theme-bg border border-theme-border rounded-xl flex-row items-center justify-center gap-2"
          >
            {questActionLoading ? (
              <ActivityIndicator size="small" color={theme.tint} />
            ) : (
              <>
                <Ionicons name="refresh-outline" size={16} color={theme.textSecondary} />
                <Text className="text-xs font-bold text-theme-muted">Swap Challenge</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setIsQuestModalOpen(false)}
            className="flex-1 py-3.5 bg-theme-accent rounded-xl items-center justify-center"
          >
            <Text className="text-xs font-extrabold text-white">Got it</Text>
          </TouchableOpacity>
        </View>
      </BottomSheetModal>
    </View>
  );
};


