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
import * as Haptics from 'expo-haptics';
import { Card } from '../ui/Card';
import { useTheme } from '@/hooks/use-theme';
import { recurringTrainingsApi } from '../../services/apiServices';
import { RecurringTraining } from '../../types/user';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const QUICK_ACTIVITIES = [
  { title: 'Field Hockey', sport: 'Hockey', defaultMins: 90, intensity: 'hard' },
  { title: 'Spinning Class', sport: 'Spinning', defaultMins: 45, intensity: 'moderate' },
  { title: 'Tennis Match', sport: 'Tennis', defaultMins: 60, intensity: 'moderate' },
  { title: 'Football / Soccer', sport: 'Soccer', defaultMins: 90, intensity: 'hard' },
  { title: 'Padel Match', sport: 'Padel', defaultMins: 60, intensity: 'moderate' },
  { title: 'Pilates / Core', sport: 'Strength', defaultMins: 50, intensity: 'easy' },
  { title: 'Yoga Flow', sport: 'CrossTraining', defaultMins: 60, intensity: 'easy' },
  { title: 'CrossFit / WOD', sport: 'Strength', defaultMins: 60, intensity: 'hard' },
  { title: 'Swim Club / Masters', sport: 'Swim', defaultMins: 60, intensity: 'moderate' },
];

const DURATIONS = [30, 45, 60, 75, 90, 105, 120];
const INTENSITIES: Array<'easy' | 'moderate' | 'hard'> = ['easy', 'moderate', 'hard'];

export const RecurringTrainingsCard: React.FC = () => {
  const theme = useTheme();

  const [trainings, setTrainings] = useState<RecurringTraining[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);

  // Form State
  const [title, setTitle] = useState('');
  const [sport, setSport] = useState('Other');
  const [selectedDay, setSelectedDay] = useState('Tue');
  const [durationMins, setDurationMins] = useState(60);
  const [intensity, setIntensity] = useState<'easy' | 'moderate' | 'hard'>('moderate');
  const [startTime, setStartTime] = useState('');
  const [savingNew, setSavingNew] = useState(false);

  useEffect(() => {
    fetchTrainings();
  }, []);

  const fetchTrainings = async () => {
    setLoading(true);
    try {
      const data = await recurringTrainingsApi.getRecurringTrainings();
      if (Array.isArray(data)) {
        setTrainings(data);
      }
    } catch (err: any) {
      console.error('Failed to load recurring trainings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAddModal = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTitle('');
    setSport('Other');
    setSelectedDay('Tue');
    setDurationMins(60);
    setIntensity('moderate');
    setStartTime('');
    setModalVisible(true);
  };

  const handleSelectQuick = (item: typeof QUICK_ACTIVITIES[0]) => {
    Haptics.selectionAsync();
    setTitle(item.title);
    setSport(item.sport);
    setDurationMins(item.defaultMins);
    setIntensity(item.intensity as any);
  };

  const handleSaveActivity = async () => {
    if (!title.trim()) {
      Alert.alert('Title Required', 'Please enter a name for this recurring activity (e.g. Field Hockey, Spinning).');
      return;
    }

    setSavingNew(true);
    try {
      await recurringTrainingsApi.saveRecurringTraining({
        title: title.trim(),
        sport: sport || 'Other',
        day_of_week: selectedDay,
        duration_minutes: durationMins,
        intensity: intensity,
        start_time: startTime.trim(),
        is_active: 1,
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setModalVisible(false);
      await fetchTrainings();
    } catch (err: any) {
      console.error('Failed to save recurring training:', err);
      Alert.alert('Save Failed', err.message || 'Could not save recurring training.');
    } finally {
      setSavingNew(false);
    }
  };

  const handleDelete = (item: RecurringTraining) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Remove Recurring Activity',
      `Are you sure you want to remove "${item.title}"? Your AI Coach will no longer automatically put this on your schedule.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await recurringTrainingsApi.deleteRecurringTraining(item.id);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              setTrainings((prev) => prev.filter((t) => t.id !== item.id));
            } catch (err: any) {
              console.error('Failed to delete recurring training:', err);
              Alert.alert('Error', 'Failed to delete activity.');
            }
          },
        },
      ]
    );
  };

  const getIntensityBadgeColor = (int?: string) => {
    if (int === 'hard') return 'text-semantic-error bg-semantic-error/15';
    if (int === 'easy') return 'text-semantic-success bg-semantic-success/15';
    return 'text-semantic-warning bg-semantic-warning/15';
  };

  return (
    <Card className="p-4 mb-6">
      <View className="flex-row items-center justify-between pb-2 mb-1 border-b border-theme-border/30">
        <View className="flex-row items-center gap-x-2">
          <Ionicons name="repeat-outline" size={18} color={theme.tint} />
          <Text className="text-sm font-bold text-theme-text font-rajdhani">
            Recurring Trainings & Club Sports
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleOpenAddModal}
          activeOpacity={0.7}
          className="px-2.5 py-1 bg-theme-accent/15 rounded-full flex-row items-center gap-x-1"
        >
          <Ionicons name="add" size={13} color={theme.tint} />
          <Text className="text-xs font-bold text-theme-accent">Add</Text>
        </TouchableOpacity>
      </View>

      <Text className="text-xs text-theme-muted mb-3">
        Activities outside Rooka (e.g. hockey training, spinning class, tennis). Your AI Coach automatically places them in your calendar and plans the rest of your weekly volume around them.
      </Text>

      {loading ? (
        <ActivityIndicator size="small" color={theme.tint} className="py-4" />
      ) : trainings.length === 0 ? (
        <View className="p-4 bg-theme-bg rounded-xl items-center border border-theme-border/50 my-1">
          <Ionicons name="calendar-outline" size={24} color={theme.textSecondary} className="mb-1.5 opacity-60" />
          <Text className="text-xs font-bold text-theme-text mb-0.5">No Recurring Activities Added</Text>
          <Text className="text-[11px] text-theme-muted text-center px-2 mb-2.5">
            Do you play hockey, attend a weekly spinning class, or have club football? Add them here so your AI coach schedules them.
          </Text>
          <TouchableOpacity
            onPress={handleOpenAddModal}
            className="px-3 py-1.5 bg-theme-accent rounded-lg flex-row items-center gap-x-1"
          >
            <Ionicons name="add-circle-outline" size={14} color="#FFFFFF" />
            <Text className="text-white text-xs font-bold">Add Recurring Activity</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View className="gap-y-2">
          {trainings.map((item) => {
            const badgeClasses = getIntensityBadgeColor(item.intensity);
            return (
              <View
                key={item.id}
                className="p-3 bg-theme-bg rounded-xl border border-theme-border/60 flex-row items-center justify-between"
              >
                <View className="flex-row items-center gap-x-3 flex-1 mr-2">
                  <View className="w-10 h-10 rounded-xl bg-theme-accent/15 items-center justify-center">
                    <Text className="text-xs font-bold text-theme-accent uppercase font-rajdhani">
                      {item.day_of_week}
                    </Text>
                  </View>

                  <View className="flex-1">
                    <Text className="text-xs font-bold text-theme-text" numberOfLines={1}>
                      {item.title}
                    </Text>
                    <View className="flex-row items-center gap-x-2 mt-1 flex-wrap">
                      <Text className="text-[11px] text-theme-muted">
                        {item.duration_minutes} min{item.start_time ? ` • ${item.start_time}` : ''}
                      </Text>
                      <View className={`px-1.5 py-0.5 rounded ${badgeClasses}`}>
                        <Text className="text-[10px] font-bold uppercase">
                          {item.intensity || 'moderate'}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>

                <TouchableOpacity
                  onPress={() => handleDelete(item)}
                  activeOpacity={0.7}
                  className="p-1.5 rounded-lg bg-theme-card border border-theme-border/40"
                >
                  <Ionicons name="trash-outline" size={15} color="#EF4444" />
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}

      {/* ADD RECURRING ACTIVITY MODAL */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
      >
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-theme-card rounded-t-3xl p-5 max-h-[85%] border-t border-theme-border">
            {/* Header */}
            <View className="flex-row items-center justify-between pb-3 border-b border-theme-border/40">
              <View className="flex-row items-center gap-x-2">
                <Ionicons name="add-circle" size={20} color={theme.tint} />
                <Text className="text-base font-bold text-theme-text font-rajdhani">
                  Add Recurring Activity
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setModalVisible(false)}
                className="p-1"
              >
                <Ionicons name="close" size={20} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} className="pt-3">
              {/* Quick Presets */}
              <Text className="text-xs font-bold text-theme-muted mb-1.5">
                Quick Suggestions
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3.5">
                <View className="flex-row gap-x-1.5">
                  {QUICK_ACTIVITIES.map((qa, i) => (
                    <TouchableOpacity
                      key={i}
                      onPress={() => handleSelectQuick(qa)}
                      activeOpacity={0.7}
                      className="px-3 py-1.5 bg-theme-bg rounded-lg border border-theme-border/60"
                    >
                      <Text className="text-xs text-theme-text font-medium">{qa.title}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              {/* Title Input */}
              <Text className="text-xs font-bold text-theme-muted mb-1">
                Activity Name *
              </Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Field Hockey, Tennis, Spinning..."
                placeholderTextColor={theme.textSecondary}
                className="bg-theme-bg rounded-xl p-3 text-xs text-theme-text font-bold border border-theme-border/60 mb-3.5"
              />

              {/* Day of Week */}
              <Text className="text-xs font-bold text-theme-muted mb-1.5">
                Day of Week *
              </Text>
              <View className="flex-row justify-between mb-3.5">
                {DAYS.map((d) => {
                  const isSel = selectedDay === d;
                  return (
                    <TouchableOpacity
                      key={d}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setSelectedDay(d);
                      }}
                      activeOpacity={0.8}
                      className={`px-2.5 py-2 rounded-xl border ${
                        isSel
                          ? 'bg-theme-accent border-theme-accent'
                          : 'bg-theme-bg border-theme-border/60'
                      }`}
                    >
                      <Text className={`text-xs font-bold ${isSel ? 'text-white' : 'text-theme-text'}`}>
                        {d}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Duration */}
              <Text className="text-xs font-bold text-theme-muted mb-1.5">
                Duration (minutes) *
              </Text>
              <View className="flex-row flex-wrap gap-1.5 mb-3.5">
                {DURATIONS.map((dur) => {
                  const isSel = durationMins === dur;
                  return (
                    <TouchableOpacity
                      key={dur}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setDurationMins(dur);
                      }}
                      activeOpacity={0.8}
                      className={`px-3 py-1.5 rounded-lg border ${
                        isSel
                          ? 'bg-theme-accent border-theme-accent'
                          : 'bg-theme-bg border-theme-border/60'
                      }`}
                    >
                      <Text className={`text-xs font-bold ${isSel ? 'text-white' : 'text-theme-text'}`}>
                        {dur} min
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Intensity */}
              <Text className="text-xs font-bold text-theme-muted mb-1.5">
                Estimated Intensity
              </Text>
              <View className="flex-row gap-2 mb-3.5">
                {INTENSITIES.map((lvl) => {
                  const isSel = intensity === lvl;
                  return (
                    <TouchableOpacity
                      key={lvl}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setIntensity(lvl);
                      }}
                      activeOpacity={0.8}
                      className={`flex-1 py-2 rounded-xl border items-center capitalize ${
                        isSel
                          ? 'bg-theme-accent border-theme-accent'
                          : 'bg-theme-bg border-theme-border/60'
                      }`}
                    >
                      <Text className={`text-xs font-bold capitalize ${isSel ? 'text-white' : 'text-theme-text'}`}>
                        {lvl}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Optional Start Time */}
              <Text className="text-xs font-bold text-theme-muted mb-1">
                Typical Start Time (optional)
              </Text>
              <TextInput
                value={startTime}
                onChangeText={setStartTime}
                placeholder="e.g. 19:30 or 08:00"
                placeholderTextColor={theme.textSecondary}
                className="bg-theme-bg rounded-xl p-3 text-xs text-theme-text font-bold border border-theme-border/60 mb-5"
              />

              {/* Save Button */}
              <TouchableOpacity
                onPress={handleSaveActivity}
                disabled={savingNew}
                activeOpacity={0.8}
                className="w-full py-3.5 bg-theme-accent rounded-xl items-center justify-center shadow-md mb-6"
              >
                {savingNew ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text className="text-white font-bold text-xs">
                    Save Recurring Activity
                  </Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Card>
  );
};
