import React, { useState } from 'react';
import { useTheme } from '@/hooks/use-theme';
import { View, Text, TouchableOpacity, Switch, Alert } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Card } from '../ui/Card';
import { useUser } from '../../context/UserStore';
import { healthApi } from '../../services/apiServices';

interface CycleTrackingWidgetProps {
  avgCycleLength?: number;
}

export const CycleTrackingWidget: React.FC<CycleTrackingWidgetProps> = ({
  avgCycleLength = 28,
}) => {
    const theme = useTheme();
  const { user, updateUser } = useUser();
  const [loading, setLoading] = useState(false);

  // If gender is Male, cycle tracking is hidden completely
  if (user?.gender === 'Male') {
    return null;
  }

  // Determine if cycle tracking is active for current user (defaults to enabled for Female & Prefer not to share)
  const isEnabled = user?.cycle_tracking_enabled !== false;

  // Compute current cycle day & phase from user.last_cycle_start
  const todayStr = new Date().toISOString().split('T')[0];
  const lastStartStr = user?.last_cycle_start || todayStr;

  const startDate = new Date(lastStartStr);
  const todayDate = new Date();
  const diffTime = Math.abs(todayDate.getTime() - startDate.getTime());
  const rawDiffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  let cycleDay = (rawDiffDays % avgCycleLength) + 1;

  // Phase determination logic
  let phaseName = 'Follicular Phase';
  let phaseDesc = 'High energy capacity. Prime time for heavy strength and VO2 max intervals.';
  let phaseColor = '#10B981'; // Emerald
  let phaseIcon = 'flash-outline';

  if (cycleDay >= 1 && cycleDay <= 5) {
    phaseName = 'Menstrual Phase';
    phaseDesc = 'Hormones low. Focus on mobility, low-intensity aerobic recovery, and extra hydration.';
    phaseColor = '#EF4444'; // Red
    phaseIcon = 'water-outline';
  } else if (cycleDay >= 6 && cycleDay <= 13) {
    phaseName = 'Follicular Phase';
    phaseDesc = 'Estrogen rising. High energy & stamina capacity — prime for peak interval training.';
    phaseColor = '#3B82F6'; // Blue
    phaseIcon = 'trending-up-outline';
  } else if (cycleDay === 14) {
    phaseName = 'Ovulatory Phase';
    phaseDesc = 'Peak force production & neuromuscular response. Ideal for PR attempts.';
    phaseColor = '#F59E0B'; // Amber
    phaseIcon = 'sparkles-outline';
  } else {
    phaseName = 'Luteal Phase';
    phaseDesc = 'Progesterone rising. Steady-state aerobic zone recommended with longer warmups.';
    phaseColor = '#8B5CF6'; // Purple
    phaseIcon = 'moon-outline';
  }

  const handleLogPeriodToday = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setLoading(true);
    try {
      await healthApi.logCycleStart(todayStr);
      await updateUser({
        last_cycle_start: todayStr,
        cycle_tracking_enabled: true,
      });
    } catch (err: any) {
      // Fallback local update if offline
      await updateUser({
        last_cycle_start: todayStr,
        cycle_tracking_enabled: true,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleToggleEnable = async (val: boolean) => {
    Haptics.selectionAsync();
    try {
      await healthApi.logCycleStart(user?.last_cycle_start || todayStr);
    } catch (_) {}
    await updateUser({ cycle_tracking_enabled: val });
  };

  // SVG Progress Ring calculations
  const size = 110;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progressPct = Math.min(100, Math.max(0, (cycleDay / avgCycleLength) * 100));
  const strokeDashoffset = circumference - (circumference * progressPct) / 100;

  if (!isEnabled) {
    return (
      <Card className="mb-4 bg-theme-card p-4">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-x-3">
            <View className="w-9 h-9 rounded-full bg-theme-bg items-center justify-center mr-3">
              <Ionicons name="sparkles-outline" size={18} color="#8E9BA4" />
            </View>
            <View>
              <Text className="text-xs font-bold text-theme-muted">
                Hormonal Cycle Tracking
              </Text>
              <Text className="text-sm font-bold text-theme-text mt-0.5">
                Disabled / Off
              </Text>
            </View>
          </View>
          <Switch
            value={false}
            onValueChange={handleToggleEnable}
            trackColor={{ false: '#2A343D', true: theme.tint }}
          />
        </View>
      </Card>
    );
  }

  return (
    <Card className="mb-4 bg-theme-card">
      {/* Header */}
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center gap-x-2">
          <View className="w-2.5 h-2.5 rounded-full mr-2" style={{ backgroundColor: phaseColor }} />
          <Text className="text-xs font-bold text-theme-muted">
            Cycle Tracking & Coach Sync
          </Text>
        </View>

        <TouchableOpacity
          onPress={() => handleToggleEnable(false)}
          className="px-2 py-1 bg-theme-bg rounded-lg"
        >
          <Text className="text-xs font-bold text-theme-muted">Disable</Text>
        </TouchableOpacity>
      </View>

      {/* Main Gauge + Info */}
      <View className="flex-row items-center bg-theme-bg/60 p-4 rounded-2xl mb-3">
        {/* SVG Ring */}
        <View className="items-center justify-center relative mr-4">
          <Svg width={size} height={size}>
            <G rotation="-90" origin={`${size / 2}, ${size / 2}`}>
              <Circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke="#2A343D"
                strokeWidth={strokeWidth}
                fill="transparent"
              />
              <Circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke={phaseColor}
                strokeWidth={strokeWidth}
                strokeDasharray={`${circumference} ${circumference}`}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                fill="transparent"
              />
            </G>
          </Svg>

          <View className="absolute inset-0 items-center justify-center">
            <Text className="text-base font-extrabold text-theme-text">Day {cycleDay}</Text>
            <Text className="text-xs font-bold text-theme-muted">/ {avgCycleLength}</Text>
          </View>
        </View>

        {/* Details */}
        <View className="flex-1">
          <View className="flex-row items-center gap-x-1.5 mb-1">
            <Ionicons name={phaseIcon as any} size={15} color={phaseColor} style={{ marginRight: 4 }} />
            <Text className="text-sm font-extrabold text-theme-text">{phaseName}</Text>
          </View>
          <Text className="text-xs text-theme-muted leading-4 mb-2">{phaseDesc}</Text>

          <TouchableOpacity
            onPress={handleLogPeriodToday}
            disabled={loading}
            className="self-start px-3 py-1.5 bg-theme-accent/15 border border-theme-accent/30 rounded-lg flex-row items-center gap-x-1"
          >
            <Ionicons name="add-circle-outline" size={14} color={theme.tint} style={{ marginRight: 4 }} />
            <Text className="text-xs font-bold text-theme-accent">Log Period Start Today</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* AI Coach Integration Banner */}
      <View className="flex-row items-center bg-semantic-success/10 p-2.5 rounded-xl">
        <Ionicons name="analytics-outline" size={16} color="#10B981" style={{ marginRight: 6 }} />
        <Text className="text-xs font-semibold text-semantic-success flex-1 ml-1 font-rajdhani">
          Synced to Coach Knowledge: rooka AI automatically adjusts training volume and intensity for optimal recovery.
        </Text>
      </View>
    </Card>
  );
};
