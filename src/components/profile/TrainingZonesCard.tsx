import React, { useCallback, useEffect, useState } from 'react';
import { useTheme } from '@/hooks/use-theme';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Card } from '../ui/Card';
import { zonesApi, ZoneBandDto } from '../../services/apiServices';

/**
 * Editor for the athlete's heart-rate and power zones.
 *
 * Every rooka score is minutes x a zone multiplier, so these boundaries are the
 * one input the whole scoring model rests on. They are seeded from 220 - age
 * (and FTP) during onboarding, and can be overridden here — per sport, because
 * heart rate in the water sits well below the same effort on the bike.
 */

const SPORTS = ['default', 'Run', 'Bike', 'Swim'] as const;
type SportKey = (typeof SPORTS)[number];

const SPORT_LABEL: Record<SportKey, string> = {
  default: 'All sports',
  Run: 'Run',
  Bike: 'Bike',
  Swim: 'Swim',
};

interface ZoneTableProps {
  title: string;
  unit: string;
  zones: ZoneBandDto[];
  onChange: (zones: ZoneBandDto[]) => void;
  disabled?: boolean;
}

function ZoneTable({ title, unit, zones, onChange, disabled }: ZoneTableProps) {
    const theme = useTheme();
  const setBound = (index: number, key: 'min' | 'max', raw: string) => {
    const digits = raw.replace(/[^0-9]/g, '');
    const next = zones.map((z, i) =>
      i === index ? { ...z, [key]: digits === '' ? (key === 'max' ? null : 0) : parseInt(digits, 10) } : z
    );
    onChange(next);
  };

  return (
    <View className="gap-1.5">
      <Text className="text-xs font-bold text-theme-muted">{title}</Text>
      {zones.map((z, i) => (
        <View
          key={z.zone}
          className="flex-row items-center justify-between bg-theme-bg border border-theme-border rounded-xl px-3 py-2"
        >
          <Text className="text-sm font-bold text-theme-text w-10">Z{z.zone}</Text>
          <View className="flex-row items-center gap-1.5">
            <TextInput
              editable={!disabled}
              value={String(z.min ?? '')}
              onChangeText={(v) => setBound(i, 'min', v)}
              keyboardType="number-pad"
              style={{ color: theme.tint }}
              className="w-14 text-sm font-bold text-center bg-theme-card border border-theme-border rounded-control py-1.5"
            />
            <Text className="text-theme-muted text-sm">–</Text>
            <TextInput
              editable={!disabled}
              value={z.max == null ? '' : String(z.max)}
              onChangeText={(v) => setBound(i, 'max', v)}
              placeholder="max"
              placeholderTextColor={theme.textSecondary}
              keyboardType="number-pad"
              style={{ color: theme.tint }}
              className="w-14 text-sm font-bold text-center bg-theme-card border border-theme-border rounded-control py-1.5"
            />
            <Text className="text-theme-muted text-sm ml-1 w-10">{unit}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export function TrainingZonesCard() {
  const theme = useTheme();
  const [sport, setSport] = useState<SportKey>('default');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hrZones, setHrZones] = useState<ZoneBandDto[]>([]);
  const [powerZones, setPowerZones] = useState<ZoneBandDto[]>([]);
  const [maxHr, setMaxHr] = useState<number | null>(null);
  const [ftp, setFtp] = useState<number | null>(null);
  const [overriddenSports, setOverriddenSports] = useState<string[]>([]);

  const load = useCallback(async (target: SportKey) => {
    setLoading(true);
    try {
      const res = await zonesApi.get(target);
      setHrZones(res.hrZones || []);
      setPowerZones(res.powerZones || []);
      setMaxHr(res.maxHr);
      setFtp(res.ftp);
      setOverriddenSports(
        Array.from(new Set((res.tables || []).map((t) => t.sport).filter((sp) => sp !== 'default')))
      );
    } catch (err: any) {
      console.log('Zones load failed:', err?.message || err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(sport);
  }, [sport, load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (hrZones.length) await zonesApi.save(sport, 'hr', hrZones);
      if (powerZones.length) await zonesApi.save(sport, 'power', powerZones);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await load(sport);
      Alert.alert(
        'Zones saved',
        sport === 'default'
          ? 'These zones now apply to every sport without its own table.'
          : `These zones now apply to ${SPORT_LABEL[sport]} only.`
      );
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Could not save zones', err?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    Alert.alert(
      'Rebuild from max HR and FTP?',
      'This replaces your edits for this sport with the standard percentage bands.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rebuild',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              const res = await zonesApi.reset(sport);
              setHrZones(res.hrZones || []);
              setPowerZones(res.powerZones || []);
            } catch (err: any) {
              Alert.alert('Could not rebuild zones', err?.message || 'Please try again.');
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  };

  const handleRemoveOverride = () => {
    Alert.alert(
      `Remove the ${SPORT_LABEL[sport]} table?`,
      `${SPORT_LABEL[sport]} will fall back to your all-sports zones.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await zonesApi.remove(sport).catch(() => {});
            await load(sport);
          },
        },
      ]
    );
  };

  const hasOverride = sport !== 'default' && overriddenSports.includes(sport);

  return (
    <Card className="mb-4 bg-theme-card">
      <View className="flex-row items-center justify-between mb-1">
        <View className="flex-row items-center gap-2">
          <Ionicons name="speedometer-outline" size={18} color={theme.tint} />
          <Text className="text-base font-extrabold text-theme-text">Training Zones</Text>
        </View>
        <TouchableOpacity onPress={handleReset} disabled={saving}>
          <Text className="text-xs font-bold text-theme-accent">Rebuild</Text>
        </TouchableOpacity>
      </View>

      <Text className="text-xs text-theme-muted mb-3 font-rajdhani">
        Every rooka score is your time multiplied by the zone you trained in, so these
        boundaries decide what a session is worth.
        {maxHr ? ` Max HR ${maxHr} bpm.` : ''}
        {ftp ? ` FTP ${ftp} W.` : ''}
      </Text>

      {/* Sport selector — a sport without its own table inherits the all-sports one. */}
      <View className="flex-row gap-1.5 mb-3">
        {SPORTS.map((s) => {
          const active = s === sport;
          const custom = s !== 'default' && overriddenSports.includes(s);
          return (
            <TouchableOpacity
              key={s}
              onPress={() => {
                Haptics.selectionAsync();
                setSport(s);
              }}
              className="flex-1 py-2 rounded-lg items-center justify-center border"
              style={
                active
                  ? { backgroundColor: theme.tint, borderColor: theme.tint }
                  : { borderColor: 'rgba(148,163,184,0.35)' }
              }
            >
              <Text
                className="text-xs font-bold"
                style={{ color: active ? '#FFFFFF' : '#94A3B8' }}
              >
                {SPORT_LABEL[s]}
              </Text>
              {custom && !active ? (
                <View className="w-1.5 h-1.5 rounded-full bg-theme-accent mt-1" />
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>

      {sport !== 'default' && !hasOverride ? (
        <View className="bg-theme-bg border border-theme-border rounded-xl px-3 py-2 mb-3">
          <Text className="text-xs text-theme-muted">
            {SPORT_LABEL[sport]} currently uses your all-sports zones. Edit and save below to
            give it its own table.
          </Text>
        </View>
      ) : null}

      {loading ? (
        <View className="py-8 items-center">
          <ActivityIndicator color={theme.tint} />
        </View>
      ) : hrZones.length === 0 && powerZones.length === 0 ? (
        <View className="py-6 items-center px-4">
          <Ionicons name="help-circle-outline" size={30} color={theme.textSecondary} />
          <Text className="text-theme-text font-bold text-sm mt-2 text-center">
            No zones yet
          </Text>
          <Text className="text-theme-muted text-xs mt-1 text-center font-rajdhani">
            Add your age and FTP to your athlete details and rooka will build these for you.
          </Text>
        </View>
      ) : (
        <View className="gap-4">
          {hrZones.length > 0 && (
            <ZoneTable
              title="Heart rate"
              unit="bpm"
              zones={hrZones}
              onChange={setHrZones}
              disabled={saving}
            />
          )}
          {powerZones.length > 0 && (
            <ZoneTable
              title="Power"
              unit="W"
              zones={powerZones}
              onChange={setPowerZones}
              disabled={saving}
            />
          )}

          <View className="flex-row gap-2">
            <TouchableOpacity
              onPress={handleSave}
              disabled={saving}
              className="flex-1 bg-theme-accent py-3 rounded-xl items-center justify-center"
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text className="text-white font-bold text-sm">
                  {sport === 'default' ? 'Save zones' : `Save ${SPORT_LABEL[sport]} zones`}
                </Text>
              )}
            </TouchableOpacity>

            {hasOverride && (
              <TouchableOpacity
                onPress={handleRemoveOverride}
                disabled={saving}
                className="px-4 py-3 rounded-xl items-center justify-center border border-theme-border"
              >
                <Ionicons name="trash-outline" size={18} color="#EF4444" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
    </Card>
  );
}
