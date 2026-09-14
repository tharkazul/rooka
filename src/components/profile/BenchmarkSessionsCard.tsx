import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  ScrollView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Card } from '../ui/Card';
import { useTheme } from '@/hooks/use-theme';
import { benchmarksApi } from '../../services/apiServices';
import { BenchmarkTest } from '../../types/user';
import { useCoachChat } from '../../context/CoachChatStore';

interface BenchmarkPreset {
  id: string;
  sport: string;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  prompt: string;
}

const PRESET_TESTS: BenchmarkPreset[] = [
  {
    id: 'run_5k',
    sport: 'Run',
    title: '5k Pace & HR Benchmark Run',
    subtitle: 'Calibrate threshold pace and max aerobic heart rate zones.',
    icon: 'walk-outline',
    color: '#10B981',
    prompt: 'Please plan a new running benchmark session for me: 5k Pace & HR Baseline Test. I want to test my threshold pace and calibrate my heart rate zones.',
  },
  {
    id: 'bike_ftp',
    sport: 'Bike',
    title: '20-Min FTP Baseline Test',
    subtitle: 'Functional Threshold Power test to establish cycling wattage zones.',
    icon: 'bicycle-outline',
    color: '#F59E0B',
    prompt: 'Please plan a new cycling benchmark session for me: 20-Min FTP Baseline Test. I want to test my 20-minute functional threshold power and recalibrate my cycling wattage zones.',
  },
  {
    id: 'swim_css',
    sport: 'Swim',
    title: '400m CSS Swim Test',
    subtitle: 'Critical Swim Speed assessment to set pace per 100m zones.',
    icon: 'water-outline',
    color: '#06B6D4',
    prompt: 'Please plan a new swim benchmark session for me: 400m CSS (Critical Swim Speed) Test. I want to establish my swim pace per 100m zones.',
  },
  {
    id: 'hyrox_func',
    sport: 'Strength',
    title: 'Hyrox Functional Fitness Test',
    subtitle: 'Multi-station functional test (sled, burpees, rowing, wall balls).',
    icon: 'barbell-outline',
    color: '#EC4899',
    prompt: 'Please plan a new functional endurance benchmark session for me: Hyrox Benchmark Assessment (sled push, burpees, rowing, wall balls) to test my functional capacity.',
  },
  {
    id: 'general_all',
    sport: 'Other',
    title: 'Custom Baseline Assessment',
    subtitle: 'Ask your coach to design an assessment based on your current phase.',
    icon: 'speedometer-outline',
    color: '#8B5CF6',
    prompt: 'Please plan a new benchmark session for me to test my current fitness levels and calibrate my training zones.',
  },
];

export const BenchmarkSessionsCard: React.FC = () => {
  const theme = useTheme();
  const router = useRouter();
  const { sendMessage } = useCoachChat();

  const [benchmarks, setBenchmarks] = useState<BenchmarkTest[]>([]);
  const [loading, setLoading] = useState(false);

  // Request Modal State
  const [requestModalVisible, setRequestModalVisible] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<BenchmarkPreset>(PRESET_TESTS[0]);
  const [customAthleteNote, setCustomAthleteNote] = useState('');
  const [sendingRequest, setSendingRequest] = useState(false);

  // Manual Log Modal State
  const [logModalVisible, setLogModalVisible] = useState(false);
  const [logSport, setLogSport] = useState('Run');
  const [logTestName, setLogTestName] = useState('');
  const [logPace, setLogPace] = useState('');
  const [logPower, setLogPower] = useState('');
  const [logAvgHr, setLogAvgHr] = useState('');
  const [logMaxHr, setLogMaxHr] = useState('');
  const [logNotes, setLogNotes] = useState('');
  const [savingLog, setSavingLog] = useState(false);

  useEffect(() => {
    fetchBenchmarks();
  }, []);

  const fetchBenchmarks = async () => {
    setLoading(true);
    try {
      const data = await benchmarksApi.getBenchmarks();
      if (Array.isArray(data)) {
        setBenchmarks(data);
      }
    } catch (err: any) {
      console.error('Failed to load benchmark tests:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenRequestModal = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCustomAthleteNote('');
    setRequestModalVisible(true);
  };

  const handleSendRequestToCoach = async () => {
    setSendingRequest(true);
    try {
      let finalPrompt = selectedPreset.prompt;
      if (customAthleteNote.trim()) {
        finalPrompt += `\n\nAthlete Note / Timing Preference: "${customAthleteNote.trim()}".`;
      }

      await sendMessage(finalPrompt);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setRequestModalVisible(false);

      // Navigate athlete straight to Coach Chat
      router.push('/(tabs)/coach');
    } catch (err: any) {
      console.error('Failed to dispatch benchmark request:', err);
      Alert.alert('Request Error', 'Could not send benchmark request to coach. Please try again.');
    } finally {
      setSendingRequest(false);
    }
  };

  const handleOpenLogModal = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLogSport('Run');
    setLogTestName('');
    setLogPace('');
    setLogPower('');
    setLogAvgHr('');
    setLogMaxHr('');
    setLogNotes('');
    setLogModalVisible(true);
  };

  const handleSaveManualLog = async () => {
    if (!logTestName.trim()) {
      Alert.alert('Test Name Required', 'Please enter a test name (e.g. 5k Pace Test, 20-Min FTP).');
      return;
    }

    setSavingLog(true);
    try {
      const metricsObj: Record<string, any> = {};
      if (logPace.trim()) metricsObj.pace = logPace.trim();
      if (logPower.trim()) metricsObj.ftp_watts = logPower.trim();
      if (logAvgHr.trim()) metricsObj.avg_hr = logAvgHr.trim();
      if (logMaxHr.trim()) metricsObj.max_hr = logMaxHr.trim();

      await benchmarksApi.createBenchmark({
        sport_type: logSport,
        test_name: logTestName.trim(),
        metrics_json: metricsObj,
        coach_notes: logNotes.trim() || 'Manually logged benchmark baseline',
        completed_at: new Date().toISOString(),
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setLogModalVisible(false);
      await fetchBenchmarks();
    } catch (err: any) {
      console.error('Failed to log benchmark result:', err);
      Alert.alert('Save Failed', err.message || 'Could not record benchmark result.');
    } finally {
      setSavingLog(false);
    }
  };

  const handleDelete = (item: BenchmarkTest) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Remove Benchmark',
      `Are you sure you want to remove "${item.test_name}"? This baseline assessment will no longer be referenced in your fitness profile.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await benchmarksApi.deleteBenchmark(item.id);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              setBenchmarks((prev) => prev.filter((b) => b.id !== item.id));
            } catch (err: any) {
              console.error('Failed to delete benchmark:', err);
              Alert.alert('Error', 'Failed to delete benchmark test.');
            }
          },
        },
      ]
    );
  };

  const getSportDetails = (sport: string) => {
    const s = (sport || '').toLowerCase();
    if (s.includes('run')) return { icon: 'walk-outline' as const, color: '#10B981', label: 'Run' };
    if (s.includes('bike') || s.includes('cycl')) return { icon: 'bicycle-outline' as const, color: '#F59E0B', label: 'Bike' };
    if (s.includes('swim')) return { icon: 'water-outline' as const, color: '#06B6D4', label: 'Swim' };
    if (s.includes('strength') || s.includes('hyrox')) return { icon: 'barbell-outline' as const, color: '#EC4899', label: 'Hyrox' };
    return { icon: 'speedometer-outline' as const, color: '#8B5CF6', label: sport || 'Assessment' };
  };

  const parseMetrics = (metricsJson?: string | Record<string, any>): Record<string, any> => {
    if (!metricsJson) return {};
    if (typeof metricsJson === 'object') return metricsJson;
    try {
      return JSON.parse(metricsJson);
    } catch {
      return { summary: metricsJson };
    }
  };

  const formatTestDate = (dateStr?: string) => {
    if (!dateStr) return 'Recorded';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return dateStr.slice(0, 10);
    }
  };

  return (
    <Card className="p-4 mb-6">
      {/* Header */}
      <View className="flex-row items-center justify-between pb-2 mb-1 border-b border-theme-border/30">
        <View className="flex-row items-center gap-x-2">
          <Ionicons name="speedometer-outline" size={18} color={theme.tint} />
          <Text className="text-sm font-bold text-theme-text font-rajdhani">
            Benchmark Sessions & Assessments
          </Text>
        </View>
        <View className="flex-row items-center gap-x-1.5">
          <TouchableOpacity
            onPress={handleOpenLogModal}
            activeOpacity={0.7}
            className="px-2 py-1 bg-theme-border/40 rounded-full flex-row items-center gap-x-1"
          >
            <Ionicons name="create-outline" size={12} color={theme.textSecondary} />
            <Text className="text-[11px] font-medium text-theme-muted">Log</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleOpenRequestModal}
            activeOpacity={0.7}
            className="px-2.5 py-1 bg-theme-accent/15 rounded-full flex-row items-center gap-x-1"
          >
            <Ionicons name="chatbubble-ellipses-outline" size={12} color={theme.tint} />
            <Text className="text-xs font-bold text-theme-accent">Request</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text className="text-xs text-theme-muted mb-3">
        Calibrate your training zones and baseline fitness. Request new benchmark tests directly from your coach or review past results.
      </Text>

      {loading ? (
        <ActivityIndicator size="small" color={theme.tint} className="py-4" />
      ) : benchmarks.length === 0 ? (
        <View className="p-4 bg-theme-bg rounded-xl items-center border border-theme-border/50 my-1">
          <Ionicons name="speedometer-outline" size={26} color={theme.textSecondary} className="mb-1.5 opacity-60" />
          <Text className="text-xs font-bold text-theme-text mb-0.5">No Benchmark Tests Recorded</Text>
          <Text className="text-[11px] text-theme-muted text-center px-3 mb-3">
            Benchmark tests calibrate your FTP, CSS, threshold heart rate, and training zones. Request a test from your coach to schedule one.
          </Text>
          <TouchableOpacity
            onPress={handleOpenRequestModal}
            className="px-3.5 py-2 bg-theme-accent rounded-lg flex-row items-center gap-x-1.5 shadow-sm"
          >
            <Ionicons name="chatbubble-ellipses" size={14} color="#FFFFFF" />
            <Text className="text-white text-xs font-bold font-rajdhani">Request Benchmark Session</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View className="gap-y-2.5">
          {benchmarks.map((item) => {
            const sportInfo = getSportDetails(item.sport_type);
            const metrics = parseMetrics(item.metrics_json);
            const metricKeys = Object.keys(metrics);

            return (
              <View
                key={item.id}
                className="p-3 bg-theme-bg rounded-xl border border-theme-border/60"
              >
                <View className="flex-row items-center justify-between mb-1.5">
                  <View className="flex-row items-center gap-x-2.5 flex-1 mr-2">
                    <View
                      style={{ backgroundColor: `${sportInfo.color}20` }}
                      className="w-8 h-8 rounded-lg items-center justify-center"
                    >
                      <Ionicons name={sportInfo.icon} size={16} color={sportInfo.color} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-xs font-bold text-theme-text font-rajdhani" numberOfLines={1}>
                        {item.test_name}
                      </Text>
                      <Text className="text-[10px] text-theme-muted">
                        {sportInfo.label} • {formatTestDate(item.completed_at || item.created_at)}
                      </Text>
                    </View>
                  </View>

                  <TouchableOpacity
                    onPress={() => handleDelete(item)}
                    className="p-1 opacity-50 active:opacity-100"
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="trash-outline" size={15} color={theme.textSecondary} />
                  </TouchableOpacity>
                </View>

                {/* Metrics Badges */}
                {metricKeys.length > 0 && (
                  <View className="flex-row flex-wrap gap-1.5 mb-1 mt-1">
                    {metricKeys.map((key) => {
                      const val = metrics[key];
                      if (val === null || val === undefined || val === '') return null;
                      const label = key.replace(/_/g, ' ').toUpperCase();
                      return (
                        <View
                          key={key}
                          className="px-2 py-0.5 rounded-md bg-theme-card border border-theme-border/40 flex-row items-center gap-x-1"
                        >
                          <Text className="text-[9px] font-bold text-theme-muted uppercase tracking-wider">
                            {label}:
                          </Text>
                          <Text className="text-[10px] font-semibold text-theme-text font-rajdhani">
                            {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                )}

                {/* Coach Notes */}
                {Boolean(item.coach_notes) && (
                  <View className="mt-1.5 p-2 rounded-lg bg-theme-card/60 border-l-2 border-theme-accent">
                    <Text className="text-[10px] text-theme-muted italic">
                      "{item.coach_notes}"
                    </Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* REQUEST BENCHMARK MODAL */}
      <Modal
        visible={requestModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setRequestModalVisible(false)}
      >
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-theme-card rounded-t-3xl p-5 max-h-[85%] border-t border-theme-border">
            <View className="flex-row items-center justify-between pb-3 border-b border-theme-border/40 mb-3">
              <View className="flex-row items-center gap-x-2">
                <Ionicons name="chatbubble-ellipses-outline" size={20} color={theme.tint} />
                <Text className="text-base font-bold text-theme-text font-rajdhani">
                  Request Benchmark Session
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setRequestModalVisible(false)}
                className="w-8 h-8 rounded-full bg-theme-bg items-center justify-center"
              >
                <Ionicons name="close" size={18} color={theme.text} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text className="text-xs text-theme-muted mb-3">
                Choose an assessment to request. Your AI Coach will prepare the protocol, adjust your week's training volume, and schedule it in your calendar.
              </Text>

              {/* Presets List */}
              <View className="gap-y-2 mb-4">
                {PRESET_TESTS.map((preset) => {
                  const isSelected = selectedPreset.id === preset.id;
                  return (
                    <TouchableOpacity
                      key={preset.id}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setSelectedPreset(preset);
                      }}
                      activeOpacity={0.7}
                      className={`p-3 rounded-xl border flex-row items-center justify-between ${
                        isSelected
                          ? 'bg-theme-accent/15 border-theme-accent'
                          : 'bg-theme-bg border-theme-border/50'
                      }`}
                    >
                      <View className="flex-row items-center gap-x-3 flex-1 mr-2">
                        <View
                          style={{ backgroundColor: `${preset.color}25` }}
                          className="w-9 h-9 rounded-lg items-center justify-center"
                        >
                          <Ionicons name={preset.icon} size={18} color={preset.color} />
                        </View>
                        <View className="flex-1">
                          <Text
                            className={`text-xs font-bold font-rajdhani ${
                              isSelected ? 'text-theme-accent' : 'text-theme-text'
                            }`}
                          >
                            {preset.title}
                          </Text>
                          <Text className="text-[10px] text-theme-muted mt-0.5">
                            {preset.subtitle}
                          </Text>
                        </View>
                      </View>

                      <Ionicons
                        name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                        size={18}
                        color={isSelected ? theme.tint : theme.textSecondary}
                      />
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Optional Athlete Note */}
              <Text className="text-xs font-bold text-theme-text mb-1 font-rajdhani">
                Timing Preference or Note (Optional)
              </Text>
              <TextInput
                value={customAthleteNote}
                onChangeText={setCustomAthleteNote}
                placeholder="e.g., Prefer doing this on Saturday morning on a running track..."
                placeholderTextColor={theme.textSecondary}
                multiline
                numberOfLines={2}
                className="bg-theme-bg border border-theme-border rounded-xl px-3 py-2 text-xs text-theme-text mb-5 min-h-[60px]"
                textAlignVertical="top"
              />

              {/* Send Button */}
              <TouchableOpacity
                onPress={handleSendRequestToCoach}
                disabled={sendingRequest}
                activeOpacity={0.8}
                className="bg-theme-accent py-3.5 rounded-xl items-center justify-center flex-row gap-x-2 shadow-sm mb-4"
              >
                {sendingRequest ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="paper-plane" size={16} color="#FFFFFF" />
                    <Text className="text-white font-bold text-sm font-rajdhani uppercase tracking-wider">
                      Send to AI Coach
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* LOG BENCHMARK RESULT MODAL */}
      <Modal
        visible={logModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setLogModalVisible(false)}
      >
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-theme-card rounded-t-3xl p-5 max-h-[85%] border-t border-theme-border">
            <View className="flex-row items-center justify-between pb-3 border-b border-theme-border/40 mb-3">
              <View className="flex-row items-center gap-x-2">
                <Ionicons name="create-outline" size={20} color={theme.tint} />
                <Text className="text-base font-bold text-theme-text font-rajdhani">
                  Log Benchmark Baseline
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setLogModalVisible(false)}
                className="w-8 h-8 rounded-full bg-theme-bg items-center justify-center"
              >
                <Ionicons name="close" size={18} color={theme.text} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Sport Selector */}
              <Text className="text-xs font-bold text-theme-text mb-1 font-rajdhani">
                Sport
              </Text>
              <View className="flex-row gap-x-2 mb-3">
                {['Run', 'Bike', 'Swim', 'Strength', 'Other'].map((s) => {
                  const isSel = logSport === s;
                  return (
                    <TouchableOpacity
                      key={s}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setLogSport(s);
                      }}
                      className={`px-3 py-1.5 rounded-lg border flex-1 items-center ${
                        isSel ? 'bg-theme-accent border-theme-accent' : 'bg-theme-bg border-theme-border'
                      }`}
                    >
                      <Text
                        className={`text-xs font-bold font-rajdhani ${
                          isSel ? 'text-white' : 'text-theme-muted'
                        }`}
                      >
                        {s}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Test Name */}
              <Text className="text-xs font-bold text-theme-text mb-1 font-rajdhani">
                Assessment Name
              </Text>
              <TextInput
                value={logTestName}
                onChangeText={setLogTestName}
                placeholder="e.g., 5k Time Trial, 20-Min FTP Test"
                placeholderTextColor={theme.textSecondary}
                className="bg-theme-bg border border-theme-border rounded-xl px-3 py-2 text-xs text-theme-text mb-3"
              />

              {/* Metrics Row 1: Pace & Power */}
              <View className="flex-row gap-x-2 mb-3">
                <View className="flex-1">
                  <Text className="text-xs font-bold text-theme-text mb-1 font-rajdhani">
                    Pace / CSS (e.g. 4:15/km)
                  </Text>
                  <TextInput
                    value={logPace}
                    onChangeText={setLogPace}
                    placeholder="4:15 /km"
                    placeholderTextColor={theme.textSecondary}
                    className="bg-theme-bg border border-theme-border rounded-xl px-3 py-2 text-xs text-theme-text"
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-xs font-bold text-theme-text mb-1 font-rajdhani">
                    FTP / Power (Watts)
                  </Text>
                  <TextInput
                    value={logPower}
                    onChangeText={setLogPower}
                    placeholder="265 W"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="numeric"
                    className="bg-theme-bg border border-theme-border rounded-xl px-3 py-2 text-xs text-theme-text"
                  />
                </View>
              </View>

              {/* Metrics Row 2: Heart Rate */}
              <View className="flex-row gap-x-2 mb-3">
                <View className="flex-1">
                  <Text className="text-xs font-bold text-theme-text mb-1 font-rajdhani">
                    Avg HR (bpm)
                  </Text>
                  <TextInput
                    value={logAvgHr}
                    onChangeText={setLogAvgHr}
                    placeholder="168"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="numeric"
                    className="bg-theme-bg border border-theme-border rounded-xl px-3 py-2 text-xs text-theme-text"
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-xs font-bold text-theme-text mb-1 font-rajdhani">
                    Max HR (bpm)
                  </Text>
                  <TextInput
                    value={logMaxHr}
                    onChangeText={setLogMaxHr}
                    placeholder="184"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="numeric"
                    className="bg-theme-bg border border-theme-border rounded-xl px-3 py-2 text-xs text-theme-text"
                  />
                </View>
              </View>

              {/* Notes */}
              <Text className="text-xs font-bold text-theme-text mb-1 font-rajdhani">
                Notes & Conditions
              </Text>
              <TextInput
                value={logNotes}
                onChangeText={setLogNotes}
                placeholder="e.g., Felt strong, steady pacing on flat course"
                placeholderTextColor={theme.textSecondary}
                multiline
                numberOfLines={2}
                className="bg-theme-bg border border-theme-border rounded-xl px-3 py-2 text-xs text-theme-text mb-5 min-h-[50px]"
                textAlignVertical="top"
              />

              {/* Save Log Button */}
              <TouchableOpacity
                onPress={handleSaveManualLog}
                disabled={savingLog}
                activeOpacity={0.8}
                className="bg-theme-accent py-3 rounded-xl items-center justify-center flex-row gap-x-2 shadow-sm mb-4"
              >
                {savingLog ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={16} color="#FFFFFF" />
                    <Text className="text-white font-bold text-sm font-rajdhani uppercase tracking-wider">
                      Save Benchmark Result
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Card>
  );
};
