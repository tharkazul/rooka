import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Card } from '../ui/Card';
import { DurationRoller } from '../ui/DurationRoller';
import { useUser } from '../../context/UserStore';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '@/hooks/use-theme';
import { userApi } from '../../services/apiServices';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const WeeklyAvailabilityCard: React.FC = () => {
  const theme = useTheme();
  const { t } = useLanguage();
  const { user, updateUser, refreshUser } = useUser();

  const [availability, setAvailability] = useState<{ [day: string]: { available: boolean; maxMinutes: number } }>({
    Mon: { available: true, maxMinutes: 60 },
    Tue: { available: true, maxMinutes: 60 },
    Wed: { available: true, maxMinutes: 60 },
    Thu: { available: true, maxMinutes: 60 },
    Fri: { available: true, maxMinutes: 60 },
    Sat: { available: true, maxMinutes: 60 },
    Sun: { available: true, maxMinutes: 60 },
  });

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    const raw = (user as any)?.trainingAvailability || (user as any)?.training_availability;
    if (raw) {
      let parsed = typeof raw === 'string' ? null : raw;
      if (typeof raw === 'string') {
        try {
          parsed = JSON.parse(raw);
        } catch (_) {}
      }
      if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
        const normalized: { [day: string]: { available: boolean; maxMinutes: number } } = {};
        DAYS.forEach((d) => {
          const match = parsed[d] || parsed[d.toLowerCase()] || parsed[d.toUpperCase()];
          if (match) {
            const isAvail = match.available !== false && match.status !== 'blocked';
            const mins = match.maxMinutes !== undefined ? match.maxMinutes : (match.max_minutes !== undefined ? match.max_minutes : 60);
            normalized[d] = { available: isAvail && mins > 0, maxMinutes: mins };
          } else {
            normalized[d] = { available: true, maxMinutes: 60 };
          }
        });
        setAvailability(normalized);
      }
    }
  }, [user?.id]);

  const handleDayDurationChange = (day: string, minutes: number) => {
    Haptics.selectionAsync();
    setHasChanges(true);
    setAvailability((prev) => ({
      ...prev,
      [day]: {
        available: minutes > 0,
        maxMinutes: minutes,
      },
    }));
  };

  const handleSave = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSaving(true);
    setSaveSuccess(false);
    try {
      await userApi.updateSettings({
        training_availability: availability,
        trainingAvailability: availability,
      } as any);

      updateUser({
        training_availability: availability,
        trainingAvailability: availability,
      } as any);

      await refreshUser();
      setSaveSuccess(true);
      setHasChanges(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      console.error('Failed to update training availability:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-4 mb-6">
      <View className="flex-row items-center justify-between pb-2 mb-1 border-b border-theme-border/30">
        <View className="flex-row items-center gap-x-2">
          <Ionicons name="calendar-outline" size={18} color={theme.tint} />
          <Text className="text-sm font-bold text-theme-text font-rajdhani">
            Weekly Training Availability
          </Text>
        </View>
        {hasChanges && !saving && (
          <View className="px-2 py-0.5 rounded-full bg-semantic-warning/15">
            <Text className="text-[11px] font-bold text-semantic-warning">Unsaved</Text>
          </View>
        )}
      </View>

      <Text className="text-xs text-theme-muted mb-3">
        Set the maximum workout duration you have available per day. Your AI Coach builds your weekly plan around these boundaries.
      </Text>

      <View className="gap-2 pt-1">
        {DAYS.map((day) => {
          const currentVal = availability[day]?.maxMinutes || 0;
          const isRest = currentVal === 0;
          return (
            <View
              key={day}
              className="bg-theme-bg px-3 py-2.5 rounded-xl border border-theme-border/60 flex-row items-center justify-between"
            >
              <Text className="text-theme-text font-bold text-xs w-12">{day}</Text>

              <DurationRoller
                value={currentVal}
                onChange={(minutes) => handleDayDurationChange(day, minutes)}
                disabled={saving}
                unitLabel={isRest ? t('onboarding.restDay') || 'Rest Day' : t('onboarding.minutesUnit') || 'min'}
              />
            </View>
          );
        })}
      </View>

      <TouchableOpacity
        onPress={handleSave}
        disabled={saving || !hasChanges}
        activeOpacity={0.8}
        className={`w-full py-3 rounded-xl items-center justify-center mt-4 shadow-sm flex-row gap-x-2 ${
          hasChanges ? 'bg-theme-accent' : 'bg-theme-border/50'
        }`}
      >
        {saving ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <>
            <Ionicons name="checkmark-sharp" size={15} color={hasChanges ? '#FFFFFF' : theme.textSecondary} />
            <Text className={`font-bold text-xs ${hasChanges ? 'text-white' : 'text-theme-muted'}`}>
              Save Weekly Availability
            </Text>
          </>
        )}
      </TouchableOpacity>

      {saveSuccess && (
        <View className="p-2.5 bg-semantic-success/10 rounded-xl mt-3 items-center flex-row justify-center gap-x-1.5 border border-semantic-success/20">
          <Ionicons name="checkmark-circle" size={14} color="#22C55E" />
          <Text className="text-semantic-success font-bold text-xs">
            Availability saved successfully!
          </Text>
        </View>
      )}
    </Card>
  );
};
