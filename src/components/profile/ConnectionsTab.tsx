import React, { useState, useEffect } from 'react';
import { useTheme } from '@/hooks/use-theme';
import { View, Text, TouchableOpacity, Switch, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Card } from '../ui/Card';
import { useUser } from '../../context/UserStore';
import { useActivities } from '../../context/ActivityStore';
import { integrationsApi, StravaShareFlags } from '../../services/apiServices';
import { canHideRookaLink } from '../../utils/permissions';

interface ConnectionsTabProps {
  onOpenGarminModal: () => void;
  onConnectStrava: () => void;
  onDisconnectStrava: () => void;
  stravaLoading?: boolean;
}

// rooka's sport buckets, matching STRAVA_SHARE_SPORTS on the server. Strava's
// own sport_type list is much longer; the server collapses it onto these four.
export type SportType = 'Run' | 'Bike' | 'Swim' | 'Strength';

const ALL_ON: StravaShareFlags = {
  shareName: true,
  shareScore: true,
  shareStructure: true,
  shareLink: true,
};

const DEFAULT_TOGGLES: Record<SportType, StravaShareFlags> = {
  Run: { ...ALL_ON },
  Bike: { ...ALL_ON },
  Swim: { ...ALL_ON },
  Strength: { ...ALL_ON },
};

const SPORT_OPTIONS: { id: SportType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'Run', label: 'Run', icon: 'walk-outline' },
  { id: 'Bike', label: 'Cycle', icon: 'bicycle-outline' },
  { id: 'Swim', label: 'Swim', icon: 'water-outline' },
  { id: 'Strength', label: 'Strength', icon: 'barbell-outline' },
];

// `shareStructure` has no toggle: the planned steps go out whenever there is a
// plan. It rides along in the payload so saving never clears it.
const TOGGLE_ROWS: { key: keyof StravaShareFlags; title: string; subtitle: string }[] = [
  {
    key: 'shareScore',
    title: 'Include rooka score in Caption',
    subtitle: 'Add calculated rooka and TSS to caption',
  },
  {
    key: 'shareName',
    title: 'Post AI Workout Summary Title',
    subtitle: 'Auto-generate catchy workout title',
  },
  {
    key: 'shareLink',
    title: 'Include rooka.io Link',
    subtitle: 'Credit rooka at the end of the caption',
  },
];

export const ConnectionsTab: React.FC<ConnectionsTabProps> = ({
  onOpenGarminModal,
  onConnectStrava,
  onDisconnectStrava,
  stravaLoading = false,
}) => {
    const theme = useTheme();
  const { user } = useUser();
  const { syncGarmin, syncStrava } = useActivities();

  const isGarminConnected = !!user?.garmin_connected;
  const isStravaConnected = !!user?.strava_connected;

  const [garminSyncing, setGarminSyncing] = useState(false);
  const [stravaSyncing, setStravaSyncing] = useState(false);
  const [appleSyncing, setAppleSyncing] = useState(false);
  const [isAppleConnected, setIsAppleConnected] = useState(false);
  const [appleSupported, setAppleSupported] = useState(false);

  // Strava Automation Toggles per sport type
  const [selectedSport, setSelectedSport] = useState<SportType>('Run');
  const [sportToggles, setSportToggles] = useState<Record<SportType, StravaShareFlags>>(DEFAULT_TOGGLES);
  const [togglesLoading, setTogglesLoading] = useState(true);
  // The server is the authority here; this is the optimistic local view of it.
  const [linkIsOptional, setLinkIsOptional] = useState(canHideRookaLink(user?.subscription_tier));

  // iOS is the authority on whether rooka may schedule workouts, so the badge
  // reads the live WorkoutKit status rather than a flag we wrote ourselves.
  useEffect(() => {
    let cancelled = false;
    const {
      isWorkoutKitSupported,
      getWorkoutKitAuthorizationStatus,
    } = require('../../services/appleHealthService');

    setAppleSupported(isWorkoutKitSupported());
    getWorkoutKitAuthorizationStatus().then((status: string) => {
      if (!cancelled) setIsAppleConnected(status === 'authorized');
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Granting happens in the Watch app, outside rooka, so there has to be a way
  // back here to re-read the status once the athlete has done it.
  const handleRefreshAppleStatus = async () => {
    setAppleSyncing(true);
    try {
      const {
        isWorkoutKitSupported,
        getWorkoutKitAuthorizationStatus,
      } = require('../../services/appleHealthService');

      setAppleSupported(isWorkoutKitSupported());
      const status = await getWorkoutKitAuthorizationStatus();
      const authorized = status === 'authorized';
      setIsAppleConnected(authorized);
      Haptics.notificationAsync(
        authorized
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning
      );
    } catch (err: any) {
      console.error('Apple Watch status refresh error:', err);
    } finally {
      setAppleSyncing(false);
    }
  };

  const handleConnectAppleHealth = async () => {
    try {
      const {
        isWorkoutKitSupported,
        requestWorkoutKitAuthorization,
        WORKOUT_KIT_DENIED_MESSAGE,
      } = require('../../services/appleHealthService');

      if (!isWorkoutKitSupported()) {
        Alert.alert(
          'Not Supported',
          'Sending workouts to an Apple Watch needs an iPhone running iOS 17 or newer. It is also unavailable in the Simulator.'
        );
        return;
      }

      const status = await requestWorkoutKitAuthorization();
      setIsAppleConnected(status === 'authorized');

      if (status === 'authorized') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        // The scheduling permission lives in the Watch app under rooka, not in
        // Settings or the Health app, so point people at the right place.
        Alert.alert('Permission Required', WORKOUT_KIT_DENIED_MESSAGE);
      }
    } catch (err: any) {
      console.error('Apple Health connect error:', err);
      Alert.alert('Error', err?.message || 'Failed to request Apple Watch permissions.');
    }
  };

  // These used to live in AsyncStorage only, under different names, so nothing
  // the athlete set here ever reached the captions the server writes.
  useEffect(() => {
    let cancelled = false;
    integrationsApi
      .getStravaShareSettings()
      .then((res) => {
        if (cancelled) return;
        setSportToggles((prev) => {
          const next = { ...prev };
          for (const sport of SPORT_OPTIONS) {
            const fromServer = res.shareSettings?.[sport.id];
            if (fromServer) next[sport.id] = { ...ALL_ON, ...fromServer };
          }
          return next;
        });
        setLinkIsOptional(!!res.linkIsOptional);
      })
      .catch((err) => {
        console.log('Strava share settings load failed:', err?.message || err);
      })
      .finally(() => {
        if (!cancelled) setTogglesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggleChange = (toggleKey: keyof StravaShareFlags, value: boolean) => {
    if (toggleKey === 'shareLink' && !linkIsOptional) return;

    const previous = sportToggles;
    const updated = {
      ...previous,
      [selectedSport]: { ...previous[selectedSport], [toggleKey]: value },
    };
    setSportToggles(updated);
    Haptics.selectionAsync();

    integrationsApi.saveStravaShareSettings(updated).catch((err) => {
      // Put the switch back rather than leaving the UI claiming a setting the
      // server never accepted.
      console.log('Strava share settings save failed:', err?.message || err);
      setSportToggles(previous);
      Alert.alert('Could not save', 'Your Strava caption settings were not updated. Please try again.');
    });
  };

  const handleSyncGarmin = async () => {
    setGarminSyncing(true);
    try {
      await syncGarmin();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      console.error('Garmin sync error:', err);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Garmin Sync Failed', err?.message || 'Could not sync with Garmin. Please try again later.');
    } finally {
      setGarminSyncing(false);
    }
  };

  const handleSyncStrava = async () => {
    setStravaSyncing(true);
    try {
      await syncStrava();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      console.error('Strava sync error:', err);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Strava Sync Failed', err?.message || 'Could not sync with Strava. Please try again later.');
    } finally {
      setStravaSyncing(false);
    }
  };

  const currentToggles = sportToggles[selectedSport] || DEFAULT_TOGGLES[selectedSport];

  return (
    <View className="gap-y-6">
      {/* APPLE HEALTH & WORKOUTKIT INTEGRATION */}
      <Card className="p-4 mb-6">
        <View className="flex-row justify-between items-center pb-3 mb-3">
          <View className="flex-row items-center gap-2">
            <Ionicons name="logo-apple" size={20} color="#FF2D55" />
            <Text className="text-theme-text font-bold text-sm">Apple Health & Watch</Text>
          </View>
          <View
            className={`px-2 py-0.5 rounded ${
              isAppleConnected
                ? 'bg-semantic-success/10'
                : 'bg-semantic-error/10'
            }`}
          >
            <Text
              className={`text-xs font-bold ${
                isAppleConnected ? 'text-semantic-success' : 'text-semantic-error'
              }`}
            >
              {isAppleConnected ? 'Active' : appleSupported ? 'Disconnected' : 'Unavailable'}
            </Text>
          </View>
        </View>

        <Text className="text-theme-muted text-xs mb-4 leading-relaxed font-rajdhani">
          Sends your planned rooka sessions — warmup, intervals, targets and cooldown — straight
          into the Workout app on your Apple Watch. Needs iPhone on iOS 17 or newer with a paired
          Watch. Completed sessions still come back to rooka through Strava.
        </Text>

        <View className="flex-row flex-wrap gap-2">
          <TouchableOpacity
            onPress={handleConnectAppleHealth}
            className="bg-semantic-error px-4 py-2.5 rounded-xl flex-row items-center justify-center shadow-sm"
          >
            <Ionicons name="shield-checkmark-outline" size={16} color="#FFF" />
            <Text className="text-white font-bold text-xs ml-2">
              Connect
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleRefreshAppleStatus}
            disabled={appleSyncing}
            className="bg-theme-bg px-4 py-2.5 rounded-xl flex-row items-center justify-center"
          >
            {appleSyncing ? (
              <ActivityIndicator size="small" color="#FF2D55" />
            ) : (
              <>
                <Ionicons name="sync-outline" size={16} color={theme.textSecondary} />
                <Text className="text-theme-text font-bold text-xs ml-2">Refresh Status</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </Card>

      {/* GARMIN CONNECT INTEGRATION */}
      <Card className="p-4 mb-6">
        <View className="flex-row justify-between items-center pb-3 mb-3">
          <View className="flex-row items-center gap-2">
            <Ionicons name="watch-outline" size={20} color={theme.tint} />
            <Text className="text-theme-text font-bold text-sm">Garmin Connect Integration</Text>
          </View>
          <View
            className={`px-2 py-0.5 rounded ${
              isGarminConnected
                ? 'bg-semantic-success/10'
                : 'bg-semantic-error/10'
            }`}
          >
            <Text
              className={`text-xs font-bold ${
                isGarminConnected ? 'text-semantic-success' : 'text-semantic-error'
              }`}
            >
              {isGarminConnected ? 'Connected' : 'Disconnected'}
            </Text>
          </View>
        </View>

        <Text className="text-theme-muted text-xs mb-4 leading-relaxed">
          Required to automatically push micro-plan workouts directly to your Garmin watch calendar. Credentials are secure and encrypted.
        </Text>

        <View className="flex-row flex-wrap gap-2">
          <TouchableOpacity
            onPress={onOpenGarminModal}
            className="bg-semantic-info px-4 py-2.5 rounded-xl flex-row items-center justify-center shadow-sm"
          >
            <Ionicons name="settings-outline" size={16} color="#FFF" />
            <Text className="text-white font-bold text-xs ml-2">
              {isGarminConnected ? 'Manage Garmin' : 'Connect Garmin'}
            </Text>
          </TouchableOpacity>

          {isGarminConnected && (
            <TouchableOpacity
              onPress={handleSyncGarmin}
              disabled={garminSyncing}
              className="bg-theme-bg px-4 py-2.5 rounded-xl flex-row items-center justify-center"
            >
              {garminSyncing ? (
                <ActivityIndicator size="small" color={theme.tint} />
              ) : (
                <>
                  <Ionicons name="sync-outline" size={16} color={theme.textSecondary} />
                  <Text className="text-theme-text font-bold text-xs ml-2">Sync Workouts</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </Card>

      {/* STRAVA INTEGRATION */}
      <Card className="p-4 mb-6">
        <View className="flex-row justify-between items-center pb-3 mb-3">
          <View className="flex-row items-center gap-2">
            <Ionicons name="fitness-outline" size={20} color={theme.tint} />
            <Text className="text-theme-text font-bold text-sm">Strava Integration</Text>
          </View>
          <View
            className={`px-2 py-0.5 rounded ${
              isStravaConnected
                ? 'bg-semantic-success/10'
                : 'bg-semantic-error/10'
            }`}
          >
            <Text
              className={`text-xs font-bold ${
                isStravaConnected ? 'text-semantic-success' : 'text-semantic-error'
              }`}
            >
              {isStravaConnected ? 'Connected' : 'Disconnected'}
            </Text>
          </View>
        </View>

        <Text className="text-theme-muted text-xs mb-4 leading-relaxed">
          Required to pull completed activities automatically and push personalized AI Coach captions to your Strava profile.
        </Text>

        <View className="flex-row flex-wrap gap-2">
          {!isStravaConnected ? (
            <TouchableOpacity
              onPress={onConnectStrava}
              disabled={stravaLoading}
              className="bg-theme-accent px-4 py-2.5 rounded-xl flex-row items-center justify-center shadow-sm"
            >
              {stravaLoading ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Ionicons name="fitness-outline" size={16} color="#FFF" />
                  <Text className="text-white font-bold text-xs ml-2">Connect with Strava</Text>
                </>
              )}
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                onPress={handleSyncStrava}
                disabled={stravaSyncing}
                className="bg-theme-accent px-4 py-2.5 rounded-xl flex-row items-center justify-center shadow-sm"
              >
                {stravaSyncing ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Ionicons name="sync-outline" size={16} color="#FFF" />
                    <Text className="text-white font-bold text-xs ml-2">Sync Activities</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={onDisconnectStrava}
                disabled={stravaLoading}
                className="bg-semantic-error/10 border border-semantic-error/30 px-4 py-2.5 rounded-xl flex-row items-center justify-center"
              >
                <Text className="text-semantic-error font-bold text-xs">Disconnect</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </Card>

      {/* STRAVA AUTOMATIONS PER SPORT TYPE */}
      <Card className="p-4 mb-6">
        <View className="flex-row items-center gap-2 pb-3 mb-3 border-b border-theme-border">
          <View className="w-2.5 h-2.5 rounded-full bg-theme-accent" />
          <Text className="text-theme-text font-bold text-sm">Strava Automations</Text>
        </View>

        <Text className="text-theme-muted text-xs mb-3 leading-relaxed font-rajdhani">
          Customize what details rooka AI Coach posts to your Strava captions for each individual sport type.
        </Text>

        {/* SPORT SELECTOR TABS */}
        <View className="flex-row bg-theme-bg p-1 rounded-xl mb-4 border border-theme-border">
          {SPORT_OPTIONS.map((sport) => {
            const isSelected = selectedSport === sport.id;
            return (
              <TouchableOpacity
                key={sport.id}
                onPress={() => setSelectedSport(sport.id)}
                className={`flex-1 flex-row items-center justify-center py-2 rounded-lg gap-1 ${
                  isSelected ? 'bg-theme-accent' : 'bg-transparent'
                }`}
              >
                <Ionicons
                  name={sport.icon}
                  size={14}
                  color={isSelected ? '#FFFFFF' : '#8E8E93'}
                />
                <Text
                  className={`text-xs font-bold ${
                    isSelected ? 'text-white' : 'text-theme-muted'
                  }`}
                >
                  {sport.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* TOGGLES FOR SELECTED SPORT */}
        {togglesLoading ? (
          <View className="py-6 items-center">
            <ActivityIndicator size="small" color={theme.tint} />
          </View>
        ) : (
          <View className="gap-y-3">
            {TOGGLE_ROWS.map((row, index) => {
              const isLocked = row.key === 'shareLink' && !linkIsOptional;
              const isLast = index === TOGGLE_ROWS.length - 1;
              return (
                <View
                  key={row.key}
                  className={`flex-row items-center justify-between py-2 ${
                    isLast ? '' : 'border-b border-theme-border'
                  }`}
                >
                  <View className="flex-1 pr-3">
                    <View className="flex-row items-center gap-1">
                      <Text className="text-theme-text font-bold text-xs">{row.title}</Text>
                      {isLocked && (
                        <View className="px-1.5 py-0.5 rounded bg-theme-accent/10">
                          <Text className="text-theme-accent text-[10px] font-bold font-rajdhani">rooka+</Text>
                        </View>
                      )}
                    </View>
                    <Text className="text-theme-muted text-xs font-rajdhani">
                      {isLocked ? 'Upgrade to rooka+ to remove the credit' : row.subtitle}
                    </Text>
                  </View>
                  <Switch
                    value={currentToggles[row.key]}
                    disabled={isLocked}
                    onValueChange={(val) => handleToggleChange(row.key, val)}
                    trackColor={{ false: '#DDE3E9', true: theme.tint }}
                  />
                </View>
              );
            })}
          </View>
        )}
      </Card>
    </View>
  );
};
