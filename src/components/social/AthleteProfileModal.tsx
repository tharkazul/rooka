import { SheetGrabber } from '@/components/ui/SheetGrabber';
import { RookaMark } from '../ui/RookaPoints';
import React, { useState, useEffect } from 'react';
import { useTheme } from '@/hooks/use-theme';
import {
  Modal,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { Card } from '../ui/Card';
import { AthleteRadarChart } from '../progress/AthleteRadarChart';
import { Sparkline } from '../common/Sparkline';
import { calculateAthleteArchetype } from '../../utils/archetypeUtils';
import { calculatePMCMetrics } from '../../utils/pmcUtils';
import { getRookaLevelInfo } from '../../utils/gamification';
import { getSportFilledIcon } from '../../utils/sportIcons';
import { getFullProfilePhotoUrl } from '../../utils/avatarUtils';
import { useUser } from '../../context/UserStore';
import { useActivities } from '../../context/ActivityStore';
import { socialApi } from '../../services/apiServices';
import { PublicAthleteProfile } from '../../types/social';
import { Activity } from '../../types/activity';

interface AthleteProfileModalProps {
  visible: boolean;
  athleteId: number | string | null;
  onClose: () => void;
  onOpenActivityModal?: (id: string | number, activity?: Partial<Activity>) => void;
}

export const AthleteProfileModal: React.FC<AthleteProfileModalProps> = ({
  visible,
  athleteId,
  onClose,
  onOpenActivityModal,
}) => {
    const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user: currentUser } = useUser();
  const { activities: currentActivities } = useActivities();
  const [loading, setLoading] = useState<boolean>(true);
  const [profile, setProfile] = useState<PublicAthleteProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<boolean>(false);

  useEffect(() => {
    if (!visible || !athleteId) {
      setProfile(null);
      setError(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    socialApi
      .getProfile(athleteId)
      .then((data) => {
        if (!isMounted) return;
        if (data) {
          setProfile(data);
        } else {
          setError('Athlete profile not found');
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error('Error loading athlete profile:', err);
        setError('Failed to load athlete profile');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [visible, athleteId]);

  const handleConnect = async () => {
    if (!profile || !profile.id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setConnecting(true);
    try {
      if (profile.connectionStatus === 'pending_received') {
        const res = await socialApi.acceptUser(profile.id);
        if (res && res.success) {
          setProfile((prev) => (prev ? { ...prev, connectionStatus: 'accepted' } : null));
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      } else if (profile.connectionStatus === 'none' || !profile.connectionStatus) {
        const res = await socialApi.connectUser(profile.id);
        if (res && res.success) {
          setProfile((prev) => (prev ? { ...prev, connectionStatus: 'pending' } : null));
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      }
    } catch (e) {
      console.error('Connection action error:', e);
    } finally {
      setConnecting(false);
    }
  };

  const isSelf = Boolean(
    (profile?.id && currentUser?.id && String(profile.id) === String(currentUser.id)) ||
    (profile?.username && currentUser?.username && profile.username.toLowerCase() === currentUser.username.toLowerCase()) ||
    profile?.connectionStatus === 'self' ||
    (athleteId && currentUser?.id && String(athleteId) === String(currentUser.id))
  );

  const activities =
    isSelf && (currentActivities?.length || 0) >= (profile?.activities?.length || 0)
      ? currentActivities
      : profile?.activities || [];

  const metrics =
    isSelf && currentUser?.athlete_metrics
      ? currentUser.athlete_metrics
      : profile?.athlete_metrics;

  const archetype = calculateAthleteArchetype(activities, metrics);
  const hasActivities = activities.length > 0;

  const activitiesTotalRooka = Math.round(
    activities.reduce((sum, a) => sum + (a.rooka_score || 0), 0)
  );

  const serverTotalRooka = isSelf
    ? (currentUser?.total_rooka || profile?.total_rooka || 0)
    : (profile?.total_rooka || 0);

  const effectiveTotalRooka = serverTotalRooka > 0 ? serverTotalRooka : activitiesTotalRooka;

  const levelInfo = (() => {
    if (profile?.levelInfo && !isSelf) {
      return profile.levelInfo;
    }
    const info = getRookaLevelInfo(effectiveTotalRooka);
    return {
      level: info.level,
      currentXp: info.totalRooka,
      nextLevelXp: info.nextLevelThreshold,
      progressPercent: info.progressPercent,
    };
  })();

  const xpPercent =
    levelInfo.progressPercent !== undefined
      ? levelInfo.progressPercent
      : Math.min(
          100,
          Math.round((levelInfo.currentXp / (levelInfo.nextLevelXp || 1)) * 100)
        );

  const pmcMetrics = calculatePMCMetrics(activities, metrics?.weight_kg || 0);

  const ctlHistory =
    pmcMetrics.ctlHistory?.length >= 2
      ? pmcMetrics.ctlHistory
      : profile?.trends?.ctl && profile.trends.ctl.length >= 2
      ? profile.trends.ctl
      : [];

  const atlHistory =
    pmcMetrics.atlHistory?.length >= 2
      ? pmcMetrics.atlHistory
      : profile?.trends?.atl && profile.trends.atl.length >= 2
      ? profile.trends.atl
      : [];

  const tsbHistory =
    pmcMetrics.tsbHistory?.length >= 2
      ? pmcMetrics.tsbHistory
      : profile?.trends?.tsb && profile.trends.tsb.length >= 2
      ? profile.trends.tsb
      : [];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View className="flex-1 bg-theme-bg">
        {/* Top Pull Handle (Pill Tab) */}
        <View className="items-center pt-2.5 pb-1">
          <SheetGrabber />
        </View>

        {loading ? (
          <View className="flex-1 items-center justify-center p-8">
            <ActivityIndicator size="large" color={theme.tint} />
            <Text className="text-xs font-bold text-theme-muted mt-3">Loading athlete profile...</Text>
          </View>
        ) : error || !profile ? (
          <View className="flex-1 items-center justify-center p-8">
            <Ionicons name="alert-circle-outline" size={44} color="#EF4444" />
            <Text className="text-base font-bold text-theme-text mt-3 text-center">
              {error || 'Unable to load profile'}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              className="mt-6 bg-theme-accent px-6 py-2.5 rounded-full"
            >
              <Text className="text-white font-extrabold text-sm">Close</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 24) + 20 }}
          >
            {/* HERO / IDENTITY CARD */}
            <Card className="mb-4 bg-theme-card p-5">
              <View className="flex-row items-center gap-x-4">
                {(() => {
                  const avatarUri = getFullProfilePhotoUrl(
                    profile.profilePictureUrl || (profile as any).profile_picture_url
                  );
                  return avatarUri ? (
                    <Image
                      source={{ uri: avatarUri }}
                      className="w-16 h-16 rounded-full"
                    />
                  ) : (
                    <View className="w-16 h-16 rounded-full bg-theme-accent/20 items-center justify-center">
                      <Text className="text-2xl font-extrabold text-theme-accent">
                        {(profile.username || 'A').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  );
                })()}

                <View className="flex-1">
                  <View className="flex-row items-center gap-x-2">
                    <Text className="text-lg font-extrabold text-theme-text" numberOfLines={1}>
                      {profile.username}
                    </Text>
                  </View>

                  {profile.activeTitle && (
                    <View className="self-start px-2 py-0.5 mt-1 bg-semantic-warning/15 border border-semantic-warning/30 rounded-md">
                      <Text className="text-xs font-extrabold text-semantic-warning">
                        {profile.activeTitle.title}
                      </Text>
                    </View>
                  )}

                  {profile.public_description ? (
                    <Text className="text-xs text-theme-muted mt-1.5 leading-relaxed" numberOfLines={3}>
                      {profile.public_description}
                    </Text>
                  ) : null}
                </View>
              </View>

              {/* Connection Status / Action Button (Only show if NOT viewing self) */}
              {!isSelf && (
                <View className="mt-4 pt-3 border border-theme-border/40 flex-row items-center justify-between">
                  <Text className="text-xs font-bold text-theme-muted">
                    {profile.connectionStatus === 'accepted'
                      ? 'Connected Friends'
                      : profile.connectionStatus === 'pending'
                      ? 'Request Sent'
                      : profile.connectionStatus === 'pending_received'
                      ? 'Wants to Connect'
                      : 'Not Connected'}
                  </Text>

                  <TouchableOpacity
                    onPress={handleConnect}
                    disabled={connecting || profile.connectionStatus === 'accepted' || profile.connectionStatus === 'pending'}
                    className={`px-4 py-2 rounded-xl flex-row items-center gap-x-1.5 ${
                      profile.connectionStatus === 'accepted'
                        ? 'bg-semantic-success/15 border border-semantic-success/30'
                        : profile.connectionStatus === 'pending'
                        ? 'bg-theme-bg border border-theme-border'
                        : profile.connectionStatus === 'pending_received'
                        ? 'bg-semantic-success'
                        : 'bg-theme-accent'
                    }`}
                  >
                    {connecting ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <>
                        <Ionicons
                          name={
                            profile.connectionStatus === 'accepted'
                              ? 'checkmark-circle'
                              : profile.connectionStatus === 'pending'
                              ? 'time-outline'
                              : profile.connectionStatus === 'pending_received'
                              ? 'person-add'
                              : 'person-add'
                          }
                          size={15}
                          color={
                            profile.connectionStatus === 'accepted'
                              ? '#10B981'
                              : profile.connectionStatus === 'pending'
                              ? '#94A3B8'
                              : '#FFFFFF'
                          }
                        />
                        <Text
                          className={`text-xs font-extrabold ${
                            profile.connectionStatus === 'accepted'
                              ? 'text-semantic-success'
                              : profile.connectionStatus === 'pending'
                              ? 'text-theme-muted'
                              : 'text-white'
                          }`}
                        >
                          {profile.connectionStatus === 'accepted'
                            ? 'Friends'
                            : profile.connectionStatus === 'pending'
                            ? 'Pending'
                            : profile.connectionStatus === 'pending_received'
                            ? 'Accept'
                            : 'Connect'}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </Card>

            {/* SPARK LEVEL CARD (Identical to Progress tab) */}
            <Card className="mb-4 bg-theme-card">
              <View className="flex-row items-center justify-between mb-2">
                <View className="flex-row items-center gap-x-2">
                  <View className="w-8 h-8 rounded-full bg-theme-accent/20 items-center justify-center">
                    <RookaMark size={18} />
                  </View>
                  <View className="flex-row items-baseline gap-x-1.5">
                    <Text className="text-xs font-bold text-theme-muted uppercase font-rajdhani">
                      ROOKA LEVEL
                    </Text>
                    <Text className="text-theme-accent text-xl font-extrabold font-rajdhani leading-tight">
                      {Math.round(levelInfo.level)}
                    </Text>
                  </View>
                </View>
                <Text className="text-xs font-semibold text-theme-muted font-rajdhani leading-tight">
                  {Math.round(levelInfo.currentXp)}{' '}
                  <Text className="text-theme-text font-bold">/ {Math.round(levelInfo.nextLevelXp)} XP</Text>
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
                <Text className="text-xs text-theme-muted">Progress to next level</Text>
                <Text className="text-xs font-bold text-theme-accent">{xpPercent}%</Text>
              </View>
            </Card>

            {/* ATHLETE ARCHETYPE CARD (Identical to Progress tab + Daily Archetype Description) */}
            <Card className="mb-4 bg-theme-card">
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-xs font-bold text-theme-muted uppercase">
                  ATHLETE ARCHETYPE
                </Text>
                {hasActivities && (
                  <View className="px-2.5 py-1 bg-theme-accent/15 rounded-full">
                    <Text className="text-xs font-bold text-theme-accent">{archetype.title}</Text>
                  </View>
                )}
              </View>

              {hasActivities ? (
                <>
                  <AthleteRadarChart data={archetype} size={260} />
                  {archetype.description ? (
                    <View className="mt-3 pt-3 border border-theme-border/40">
                      <Text className="text-xs text-theme-muted text-center leading-relaxed">
                        {archetype.description}
                      </Text>
                    </View>
                  ) : null}
                </>
              ) : (
                <View className="items-center justify-center py-10 px-6">
                  <Ionicons name="analytics-outline" size={34} color={theme.textSecondary} />
                  <Text className="text-theme-text font-bold text-base mt-3 text-center">
                    No sessions yet
                  </Text>
                  <Text className="text-theme-muted text-sm mt-1.5 text-center leading-relaxed">
                    {"Log or sync a workout and your athlete profile will build itself from what you actually train."}
                  </Text>
                </View>
              )}
            </Card>

            {/* PMC TELEMETRY SPARKLINES (NO NUMBERS - PRIVATE) */}
            {hasActivities && (
              <Card className="mb-4 bg-theme-card p-4">
                <View className="flex-row items-center gap-x-2 mb-3 px-1">
                  <Ionicons name="pulse-outline" size={16} color={theme.tint} />
                  <Text className="text-xs font-bold text-theme-muted uppercase tracking-wider">
                    Performance Telemetry
                  </Text>
                </View>

                <View className="gap-y-3.5">
                  {/* Fitness (CTL) Sparkline - Green / Emerald */}
                  <View className="bg-theme-bg p-3.5 rounded-2xl flex-row items-center justify-between">
                    <View className="flex-1 pr-3">
                      <Text className="text-xs font-extrabold text-theme-text">Fitness Trajectory</Text>
                      <Text className="text-xs text-theme-muted mt-0.5">Chronic training load (CTL)</Text>
                    </View>
                    <Sparkline
                      data={ctlHistory.length >= 2 ? ctlHistory : [10, 12, 14, 15, 18, 20]}
                      color="#10B981"
                      gradientFrom="#10B98133"
                      gradientTo="#10B98100"
                      width={110}
                      height={32}
                      strokeWidth={2}
                    />
                  </View>

                  {/* Fatigue (ATL) Sparkline - Amber / Orange */}
                  <View className="bg-theme-bg p-3.5 rounded-2xl flex-row items-center justify-between">
                    <View className="flex-1 pr-3">
                      <Text className="text-xs font-extrabold text-theme-text">Fatigue Load</Text>
                      <Text className="text-xs text-theme-muted mt-0.5">Acute training load (ATL)</Text>
                    </View>
                    <Sparkline
                      data={atlHistory.length >= 2 ? atlHistory : [8, 15, 12, 22, 19, 25]}
                      color="#F59E0B"
                      gradientFrom="#F59E0B33"
                      gradientTo="#F59E0B00"
                      width={110}
                      height={32}
                      strokeWidth={2}
                    />
                  </View>

                  {/* Form & Readiness (TSB) Sparkline - Blue */}
                  <View className="bg-theme-bg p-3.5 rounded-2xl flex-row items-center justify-between">
                    <View className="flex-1 pr-3">
                      <Text className="text-xs font-extrabold text-theme-text">Form & Readiness</Text>
                      <Text className="text-xs text-theme-muted mt-0.5">Freshness balance (TSB)</Text>
                    </View>
                    <Sparkline
                      data={tsbHistory.length >= 2 ? tsbHistory : [5, 2, -4, -2, 4, 6]}
                      color="#208AEF"
                      gradientFrom="#208AEF33"
                      gradientTo="#208AEF00"
                      width={110}
                      height={32}
                      strokeWidth={2}
                    />
                  </View>
                </View>
              </Card>
            )}

            {/* RECENT ACTIVITIES */}
            {profile.recentActivities && profile.recentActivities.length > 0 && (
              <View className="mb-6">
                <Text className="text-xs font-bold text-theme-muted uppercase tracking-wider mb-3 px-1">
                  Recent Activities ({profile.recentActivities.length})
                </Text>

                {profile.recentActivities.map((act: any) => {
                  const sportIcon = getSportFilledIcon(act.sport_type || 'Run');
                  return (
                    <TouchableOpacity
                      key={`profile-act-${act.id}`}
                      activeOpacity={0.8}
                      onPress={() => {
                        if (onOpenActivityModal) {
                          onOpenActivityModal(act.id, act);
                        }
                      }}
                      className="bg-theme-card border border-theme-border rounded-tile p-4 mb-2.5 flex-row items-center justify-between shadow-xs"
                    >
                      <View className="flex-row items-center gap-x-3 flex-1 pr-2">
                        <View className="w-10 h-10 rounded-xl bg-theme-accent/15 items-center justify-center">
                          <Ionicons name={sportIcon as any} size={20} color={theme.tint} />
                        </View>
                        <View className="flex-1">
                          <Text className="text-sm font-bold text-theme-text" numberOfLines={1}>
                            {act.name || act.title || 'Workout'}
                          </Text>
                          <Text className="text-xs text-theme-muted mt-0.5">
                            {act.start_date ? act.start_date.substring(0, 10) : 'Recent'}
                            {typeof act.distance_km === 'number' && act.distance_km > 0
                              ? ` · ${act.distance_km.toFixed(1)} km`
                              : ''}
                            {typeof act.moving_time_min === 'number' && act.moving_time_min > 0
                              ? ` · ${Math.round(act.moving_time_min)} min`
                              : ''}
                          </Text>
                        </View>
                      </View>

                      {act.rooka_score || act.spark_score ? (
                        <View className="px-2.5 py-1 bg-theme-accent/15 rounded-full flex-row items-center">
                          <RookaMark size={11} color={theme.tint} />
                          <Text className="text-xs font-extrabold font-rajdhani text-theme-accent ml-1">
                            +{Math.round(act.rooka_score || act.spark_score || 0)}
                          </Text>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
};
