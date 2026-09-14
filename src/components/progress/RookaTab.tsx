import React, { useState } from 'react';
import { useTheme } from '@/hooks/use-theme';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Card } from '../ui/Card';
import { RookaMark } from '../ui/RookaPoints';
import { AthleteRadarChart } from './AthleteRadarChart';
import { PMCMetricsCard } from '../dashboard/PMCMetricsCard';
import { BottomSheetModal } from '../ui/BottomSheetModal';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useUser } from '../../context/UserStore';
import { useActivities } from '../../context/ActivityStore';
import { usePhysique } from '../../context/PhysiqueStore';
import { useGamification } from '../../context/GamificationStore';
import { canAccessQuests } from '../../utils/permissions';
import { getRookaLevelInfo } from '../../utils/gamification';
import { calculateAthleteArchetype, ArchetypeData } from '../../utils/archetypeUtils';
import { calculatePMCMetrics } from '../../utils/pmcUtils';
import { useLanguage } from '../../context/LanguageContext';

interface RookaTabProps {
  levelInfo?: {
    level: number;
    currentXp: number;
    nextLevelXp: number;
    progressPercent?: number;
  };
  archetypeData?: ArchetypeData;
}

export const RookaTab: React.FC<RookaTabProps> = ({
  levelInfo: customLevelInfo,
  archetypeData: customArchetypeData,
}) => {
  const theme = useTheme();
  const { t } = useLanguage();
  const { user } = useUser();
  const { activities } = useActivities();
  const { physiqueLogs } = usePhysique();
  const { quests, generateQuest: generateNewQuest, swapQuest: swapActiveQuest } = useGamification();

  const [isQuestModalOpen, setIsQuestModalOpen] = useState(false);
  const [questActionLoading, setQuestActionLoading] = useState(false);

  const activeQuest = quests?.find((q) => q.status === 'active') || null;
  const currentVal = activeQuest
    ? Math.round(activeQuest.current_value !== undefined ? activeQuest.current_value : (activeQuest.progress || 0))
    : 0;
  const targetVal = activeQuest ? Math.round(activeQuest.target_value || 1) : 1;
  const progressPercent = activeQuest
    ? (activeQuest.progress_percent !== undefined
        ? activeQuest.progress_percent
        : Math.min(100, Math.round((currentVal / targetVal) * 100)))
    : 0;

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
      console.error('Generate quest error in RookaTab:', err);
    } finally {
      setQuestActionLoading(false);
    }
  };

  const activitiesTotalRooka = Math.round(
    activities.reduce((sum, a) => sum + (a.rooka_score || 0), 0)
  );
  const effectiveTotalRooka = (user?.total_rooka && user.total_rooka > 0)
    ? user.total_rooka
    : activitiesTotalRooka;
  const computedInfo = getRookaLevelInfo(effectiveTotalRooka);
  const activeLevelInfo = customLevelInfo || {
    level: computedInfo.level,
    currentXp: computedInfo.totalRooka,
    nextLevelXp: computedInfo.nextLevelThreshold,
    progressPercent: computedInfo.progressPercent,
  };

  const computedArchetype = calculateAthleteArchetype(activities, user?.athlete_metrics);
  const activeArchetypeData = customArchetypeData || computedArchetype;
  const activeArchetypeTitle = customArchetypeData?.title || computedArchetype.title;
  // The radar is only meaningful once there is something to shape it.
  const hasArchetypeData = Boolean(customArchetypeData) || (activities?.length ?? 0) > 0;

  const pmcMetrics = calculatePMCMetrics(
    activities,
    user?.athlete_metrics?.weight_kg || 0,
    physiqueLogs
  );

  const xpPercent = activeLevelInfo.progressPercent !== undefined
    ? activeLevelInfo.progressPercent
    : Math.min(
        100,
        Math.round((activeLevelInfo.currentXp / (activeLevelInfo.nextLevelXp || 1)) * 100)
      );

  return (
    <View className="gap-y-4">
      {/* ROOKA LEVEL CARD */}
      <Card className="mb-4 bg-theme-card">
        <View className="flex-row items-center justify-between mb-2">
          <View className="flex-row items-center gap-x-2">
            <View className="w-8 h-8 rounded-full bg-theme-accent/20 items-center justify-center">
              <RookaMark size={18} />
            </View>
            <View className="flex-row items-baseline gap-x-1.5">
              <Text className="text-xs font-bold text-theme-muted">
                {t('dashboard.sparkLevel')}
              </Text>
              <Text className="text-theme-accent text-xl font-extrabold font-rajdhani leading-tight">
                {Math.round(activeLevelInfo.level)}
              </Text>
            </View>
          </View>
          <Text className="text-xs font-semibold text-theme-muted font-rajdhani leading-tight">
            {Math.round(activeLevelInfo.currentXp)} <Text className="text-theme-text font-bold">/ {Math.round(activeLevelInfo.nextLevelXp)} XP</Text>
          </Text>
        </View>

        {/* Progress Fill Bar */}
        <View className="w-full h-3 bg-theme-bg rounded-full overflow-hidden my-2">
          <View
            style={{ width: `${xpPercent}%` }}
            className="h-full bg-theme-accent rounded-full"
          />
        </View>

        <View className="flex-row justify-between items-center mt-1">
          <Text className="text-xs text-theme-muted">{t('dashboard.progressNextLevel')}</Text>
          <Text className="text-xs font-bold text-theme-accent">{xpPercent}%</Text>
        </View>
      </Card>

      {/* ATHLETE ARCHETYPE CARD */}
      <Card className="mb-4 bg-theme-card">
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-xs font-bold text-theme-muted">
            {t('dashboard.athleteArchetype')}
          </Text>
          {hasArchetypeData && (
            <View className="px-2.5 py-1 bg-theme-accent/15 rounded-full">
              <Text className="text-xs font-bold text-theme-accent">{activeArchetypeTitle}</Text>
            </View>
          )}
        </View>

        {hasArchetypeData ? (
          <>
            <AthleteRadarChart data={activeArchetypeData} size={260} />
            {activeArchetypeData.description ? (
              <View className="mt-3 pt-3 border border-theme-border/40">
                <Text className="text-xs text-theme-muted text-center leading-relaxed">
                  {activeArchetypeData.description}
                </Text>
              </View>
            ) : null}
          </>
        ) : (
          /* With no sessions every axis floors at 25%, drawing a perfect
             pentagon that looks like a real measurement of nothing. Say what
             is needed instead. */
          <View className="items-center justify-center py-10 px-6">
            <Ionicons name="analytics-outline" size={34} color={theme.textSecondary} />
            <Text className="text-theme-text font-bold text-base mt-3 text-center">
              No sessions yet
            </Text>
            <Text className="text-theme-muted text-sm mt-1.5 text-center">
              Log or sync a workout and your athlete profile will build itself from
              what you actually train.
            </Text>
          </View>
        )}
      </Card>

      {/* PMC TELEMETRY METRICS CARDS WITH SPARKLINES */}
      <PMCMetricsCard
        ctl={pmcMetrics.ctl}
        atl={pmcMetrics.atl}
        tsb={pmcMetrics.tsb}
        readinessScore={pmcMetrics.readinessScore}
        weightKg={pmcMetrics.weightKg}
        ctlDelta={pmcMetrics.ctlDelta}
        atlDelta={pmcMetrics.atlDelta}
        ctlHistory={pmcMetrics.ctlHistory}
        atlHistory={pmcMetrics.atlHistory}
        tsbHistory={pmcMetrics.tsbHistory}
        weightHistory={pmcMetrics.weightHistory}
        tier={user?.subscription_tier || 'free'}
      />

      {/* QUESTS LOG */}
      {canAccessQuests(user?.subscription_tier) && (
        <Card className="mb-6 bg-theme-card">
          <View className="flex-row items-center gap-x-2 mb-3">
            <View className="w-2.5 h-2.5 rounded-full bg-theme-accent" />
            <Text className="text-xs font-bold text-theme-muted">
              {t('dashboard.questsLog')}
            </Text>
          </View>

          {activeQuest ? (
            <TouchableOpacity
              onPress={() => {
                Haptics.selectionAsync();
                setIsQuestModalOpen(true);
              }}
              activeOpacity={0.8}
              className="bg-theme-bg/70 rounded-xl p-4"
            >
              <View className="flex-row justify-between items-start mb-1">
                <Text className="text-sm font-bold text-theme-text flex-1 mr-2" numberOfLines={2}>
                  {activeQuest.description || 'Active Weekly Quest'}
                </Text>
                <View className="bg-semantic-warning/15 px-2 py-0.5 rounded-md">
                  <View className="flex-row items-center gap-x-1">
                    <Text className="text-[11px] font-mono font-bold text-semantic-warning">
                      +{Math.round(activeQuest.reward_points || 0)}
                    </Text>
                    <RookaMark size={11} color="#F5A623" />
                  </View>
                </View>
              </View>

              {/* Progress bar */}
              <View className="my-2.5">
                <View className="flex-row justify-between items-center mb-1">
                  <Text className="text-xs text-theme-muted font-rajdhani">
                    {currentVal} of {targetVal} {activeQuest.unit || ''}
                  </Text>
                  <Text className="text-xs font-bold text-theme-accent font-mono">
                    {progressPercent}%
                  </Text>
                </View>
                <View className="w-full h-2.5 bg-theme-card rounded-full overflow-hidden">
                  <View
                    style={{ width: `${progressPercent}%` }}
                    className="h-full bg-theme-accent rounded-full"
                  />
                </View>
              </View>

              <View className="flex-row justify-between items-center pt-1">
                <View className="flex-row items-center gap-x-1">
                  <Ionicons name="time-outline" size={13} color={theme.textSecondary} />
                  <Text className="text-[11px] font-medium text-theme-muted">
                    {activeQuest.time_remaining_str || 'Expires Sunday midnight'}
                  </Text>
                </View>

                <View className="px-2.5 py-1 bg-theme-accent/15 border border-theme-accent/30 rounded-lg">
                  <Text className="text-xs font-bold text-theme-accent">{t('dashboard.active')}</Text>
                </View>
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={handleGenerateQuest}
              disabled={questActionLoading}
              activeOpacity={0.8}
              className="bg-theme-bg/70 rounded-xl p-5 items-center justify-center"
            >
              <Ionicons name="trophy-outline" size={28} color={theme.tint} />
              <Text className="text-sm font-bold text-theme-text mt-2">No Active Quest</Text>
              <Text className="text-xs text-theme-muted mt-0.5 text-center">
                Tap to start a new weekly fitness challenge
              </Text>
              <View className="mt-3 px-4 py-2 bg-theme-accent rounded-xl flex-row items-center gap-1.5">
                {questActionLoading ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <>
                    <Ionicons name="add-circle-outline" size={16} color="white" />
                    <Text className="text-xs font-bold text-white">Start Challenge</Text>
                  </>
                )}
              </View>
            </TouchableOpacity>
          )}
        </Card>
      )}

      {/* Quest Detail Modal */}
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
              Progress ({currentVal} / {targetVal} {activeQuest?.unit || ''})
            </Text>
            <Text className="text-sm font-mono font-bold text-semantic-warning">
              {progressPercent}%
            </Text>
          </View>
          <View className="w-full h-3 bg-theme-bg rounded-full overflow-hidden">
            <View
              className="h-full bg-semantic-warning rounded-full"
              style={{ width: `${progressPercent}%` }}
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
