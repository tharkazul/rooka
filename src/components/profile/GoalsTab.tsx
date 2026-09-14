import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { goalsStorage } from '../../services/storage';
import { useUser } from '../../context/UserStore';
import { gamificationApi, userApi } from '../../services/apiServices';
import { Card } from '../ui/Card';
import { EventDatePickerSheet } from '../ui/EventDatePickerSheet';

export interface MilestoneRow {
  id: string;
  isARace: boolean; // Primary (Main) vs Secondary
  goalType: 'race' | 'physiological'; // Goal type: Race / Physiological
  eventName: string;
  eventDate: string; // YYYY-MM-DD
  targetMode: 'finish' | 'time'; // Target mode for race
  targetValue: string; // e.g. "03:45:00" for time goal
  targetWeight: string; // e.g. "72" for weight
  targetVo2max: string; // e.g. "55" for vo2max
}

// Auto-calculate Target CTL based on Event Title and Distance Keywords
export function calculateTargetCTL(eventName: string): number {
  const name = (eventName || '').toLowerCase();

  if (name.includes('140.6') || name.includes('full ironman') || (name.includes('ironman') && !name.includes('half') && !name.includes('70.3'))) {
    return 130;
  }
  if (name.includes('70.3') || name.includes('half ironman') || name.includes('middle distance')) {
    return 95;
  }
  if (name.includes('marathon') || name.includes('42.2') || name.includes('42k') || name.includes('42 km')) {
    return 90;
  }
  if (name.includes('half marathon') || name.includes('21.1') || name.includes('21k') || name.includes('21 km') || name.includes('half')) {
    return 70;
  }
  if (name.includes('olympic') || name.includes('standard') || name.includes('10k') || name.includes('10 km')) {
    return 50;
  }
  if (name.includes('sprint') || name.includes('5k') || name.includes('5 km') || name.includes('park run') || name.includes('parkrun')) {
    return 35;
  }

  return 70; // Default target CTL
}

export const GoalsTab: React.FC = () => {
  const theme = useTheme();
  const { user, refreshUser } = useUser();

  const [guideExpanded, setGuideExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const [dateModalVisible, setDateModalVisible] = useState(false);
  const [activeMilestoneId, setActiveMilestoneId] = useState<string | null>(null);
  const [pickerInitialDate, setPickerInitialDate] = useState<string>('');

  const [milestones, setMilestones] = useState<MilestoneRow[]>([]);

  useEffect(() => {
    let isMounted = true;
    setMilestones([]);

    if (!user?.id) {
      return;
    }

    const loadMilestones = async () => {
      try {
        const cached = await goalsStorage.getGoals(user.id);
        if (cached && isMounted && Array.isArray(cached) && cached.length > 0) {
          setMilestones(
            cached.map((m: any) => ({
              id: m.id?.toString() || Date.now().toString() + Math.random(),
              isARace: m.is_main === 1 || Boolean(m.isARace),
              goalType: (m.goal_type || m.goalType || 'race') as 'race' | 'physiological',
              eventName: m.name || m.eventName || '',
              eventDate: m.date || m.eventDate || new Date().toISOString().split('T')[0],
              targetMode: (m.target_mode || m.targetMode || 'finish') as 'finish' | 'time',
              targetValue: m.target_value || m.targetValue || '',
              targetWeight: m.target_weight ? m.target_weight.toString() : m.targetWeight ? m.targetWeight.toString() : '',
              targetVo2max: m.target_vo2max ? m.target_vo2max.toString() : m.targetVo2max ? m.targetVo2max.toString() : '',
            }))
          );
        }
      } catch (_) {}

      try {
        const rows = await gamificationApi.getMilestones();
        if (isMounted && rows && rows.length > 0) {
          const mapped = rows.map((m: any) => ({
            id: m.id?.toString() || Date.now().toString() + Math.random(),
            isARace: m.is_main === 1,
            goalType: (m.goal_type || m.goalType || 'race') as 'race' | 'physiological',
            eventName: m.name || '',
            eventDate: m.date || new Date().toISOString().split('T')[0],
            targetMode: (m.target_mode || 'finish') as 'finish' | 'time',
            targetValue: m.target_value || '',
            targetWeight: m.target_weight ? m.target_weight.toString() : '',
            targetVo2max: m.target_vo2max ? m.target_vo2max.toString() : '',
          }));
          setMilestones(mapped);
          await goalsStorage.setGoals(rows, user.id);
          return;
        }
      } catch (err) {
        console.log('Failed to fetch milestones from server, fallback to user profile:', err);
      }

      // Check if user has an actual profile fallback goal (with non-empty name or real weight/vo2max)
      const hasEventGoal = Boolean(user?.target_event && user.target_event.trim().length > 0);
      const hasPhysGoal = Boolean(
        (user?.target_weight && Number(user.target_weight) > 0) ||
        (user?.target_vo2max && Number(user.target_vo2max) > 0)
      );

      if (isMounted && (hasEventGoal || hasPhysGoal)) {
        const isPhys = hasPhysGoal || (user as any)?.goal_type === 'physiological' || (user as any)?.goalType === 'physiological';
        const fallback = [
          {
            id: '1',
            isARace: true,
            goalType: (isPhys ? 'physiological' : 'race') as 'race' | 'physiological',
            eventName: user?.target_event || (isPhys ? 'Health & Fitness Goal' : ''),
            eventDate: user?.event_date || new Date().toISOString().split('T')[0],
            targetMode: (((user as any)?.target_mode || (user as any)?.targetMode || 'finish') as 'finish' | 'time'),
            targetValue: (user as any)?.target_value || (user as any)?.targetValue || '',
            targetWeight: (user as any)?.target_weight ? (user as any).target_weight.toString() : (user as any)?.targetWeight ? (user as any).targetWeight.toString() : '',
            targetVo2max: (user as any)?.target_vo2max ? (user as any).target_vo2max.toString() : (user as any)?.targetVo2max ? (user as any).targetVo2max.toString() : '',
          },
        ];
        setMilestones(fallback);
        await goalsStorage.setGoals(fallback, user.id);
      } else if (isMounted) {
        // Explicitly clear milestones and storage when server has 0 rows and user has no profile target!
        setMilestones([]);
        await goalsStorage.setGoals([], user.id);
      }
    };

    loadMilestones();
    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  const handleAddMilestone = () => {
    Haptics.selectionAsync();
    const todayStr = new Date().toISOString().split('T')[0];
    const newRow: MilestoneRow = {
      id: Date.now().toString(),
      isARace: milestones.length === 0,
      goalType: 'race',
      eventName: '',
      eventDate: todayStr,
      targetMode: 'finish',
      targetValue: '',
      targetWeight: '',
      targetVo2max: '',
    };
    setMilestones((prev) => [...prev, newRow]);
  };

  const handleRemoveMilestone = (id: string) => {
    Haptics.selectionAsync();
    setMilestones((prev) => prev.filter((m) => m.id !== id));
  };

  const handleToggleARace = (id: string) => {
    Haptics.selectionAsync();
    setMilestones((prev) =>
      prev.map((m) => ({
        ...m,
        isARace: m.id === id,
      }))
    );
  };

  const handleUpdateMilestone = (id: string, field: keyof MilestoneRow, value: any) => {
    setMilestones((prev) =>
      prev.map((m) => (m.id === id ? { ...m, [field]: value } : m))
    );
  };

  const handleOpenDatePicker = (milestone: MilestoneRow) => {
    Haptics.selectionAsync();
    setActiveMilestoneId(milestone.id);
    setPickerInitialDate(milestone.eventDate || '');
    setDateModalVisible(true);
  };

  const handleConfirmDate = (dateStr: string) => {
    if (activeMilestoneId) {
      handleUpdateMilestone(activeMilestoneId, 'eventDate', dateStr);
    }
  };

  const handleSaveCalendar = async () => {
    setSaving(true);
    setSavedSuccess(false);

    const payload = milestones.map((m) => ({
      id: m.id,
      name: m.eventName,
      date: m.eventDate,
      target_ctl: calculateTargetCTL(m.eventName),
      is_main: m.isARace ? 1 : 0,
      goal_type: m.goalType,
      target_mode: m.targetMode,
      target_value: m.targetValue,
      target_weight: m.targetWeight ? parseFloat(m.targetWeight) : null,
      target_vo2max: m.targetVo2max ? parseFloat(m.targetVo2max) : null,
    }));

    const primaryGoal = milestones.find((m) => m.isARace) || milestones[0];

    try {
      await gamificationApi.saveMilestones(payload);
      await goalsStorage.setGoals(payload, user?.id);

      if (primaryGoal) {
        const calculatedCTL = calculateTargetCTL(primaryGoal.eventName);
        await userApi.updateSettings({
          target_event: primaryGoal.eventName,
          event_date: primaryGoal.eventDate,
          target_ctl: calculatedCTL,
          goal_type: primaryGoal.goalType,
          goalType: primaryGoal.goalType,
          target_weight: primaryGoal.targetWeight ? parseFloat(primaryGoal.targetWeight) : undefined,
          targetWeight: primaryGoal.targetWeight ? parseFloat(primaryGoal.targetWeight) : undefined,
          target_vo2max: primaryGoal.targetVo2max ? parseFloat(primaryGoal.targetVo2max) : undefined,
          targetVo2max: primaryGoal.targetVo2max ? parseFloat(primaryGoal.targetVo2max) : undefined,
          target_mode: primaryGoal.targetMode,
          targetMode: primaryGoal.targetMode,
          target_value: primaryGoal.targetValue,
          targetValue: primaryGoal.targetValue,
        });
      } else {
        await userApi.updateSettings({
          target_event: '',
          event_date: '',
          target_ctl: 70,
          goal_type: 'race',
          goalType: 'race',
          target_weight: null,
          targetWeight: null,
          target_vo2max: null,
          targetVo2max: null,
          target_mode: 'finish',
          targetMode: 'finish',
          target_value: '',
          targetValue: '',
        });
      }

      await refreshUser();
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      console.error('Failed to save goals & calendar:', err);
    } finally {
      setSaving(false);
    }
  };

  const formatDateDisplay = (dateStr: string) => {
    if (!dateStr) return 'Select Date';
    try {
      const parts = dateStr.split('-').map(Number);
      if (parts.length === 3) {
        const d = new Date(parts[0], parts[1] - 1, parts[2]);
        return d.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
      }
    } catch (e) { }
    return dateStr;
  };

  return (
    <View className="gap-y-6">
      {/* RACE CALENDAR & GOALS CARD */}
      <Card className="p-4 mb-6">
        <View className="flex-row justify-between items-center pb-3 mb-4 border-b border-theme-border/50">
          <View className="flex-row items-center gap-2">
            <View className="w-2.5 h-2.5 rounded-full bg-semantic-warning" />
            <Text className="text-theme-text font-bold text-sm">Goals & Race Calendar</Text>
          </View>
          <TouchableOpacity
            onPress={handleAddMilestone}
            className="px-3 py-1.5 bg-theme-accent/10 rounded-lg flex-row items-center"
          >
            <Ionicons name="add" size={14} color={theme.tint} />
            <Text className="text-theme-accent font-bold text-xs ml-1">Add Goal</Text>
          </TouchableOpacity>
        </View>

        {/* CTL TARGET REFERENCE GUIDE (COLLAPSIBLE) */}
        <TouchableOpacity
          onPress={() => setGuideExpanded(!guideExpanded)}
          activeOpacity={0.8}
          className="p-3 bg-theme-bg rounded-xl mb-4 flex-row items-center justify-between"
        >
          <View className="flex-row items-center flex-1 pr-2">
            <Ionicons name="information-circle-outline" size={18} color={theme.tint} />
            <Text className="text-theme-text font-bold text-xs ml-2">
              CTL Target Reference Guide
            </Text>
          </View>
          <Ionicons
            name={guideExpanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={theme.textSecondary}
          />
        </TouchableOpacity>

        {guideExpanded && (
          <View className="p-3 bg-theme-bg/60 rounded-xl mb-4 gap-y-2">
            <View className="flex-row flex-wrap gap-2">
              <View className="w-[48%] p-2 rounded-control bg-theme-card">
                <Text className="text-theme-text font-bold text-xs">5K / Sprint Tri</Text>
                <Text className="text-theme-muted text-xs">Target: 30 - 45 CTL</Text>
              </View>
              <View className="w-[48%] p-2 rounded-control bg-theme-card">
                <Text className="text-theme-text font-bold text-xs">10K / Olympic Tri</Text>
                <Text className="text-theme-muted text-xs">Target: 45 - 60 CTL</Text>
              </View>
              <View className="w-[48%] p-2 rounded-control bg-theme-card">
                <Text className="text-theme-text font-bold text-xs">Half Marathon</Text>
                <Text className="text-theme-muted text-xs">Target: 60 - 80 CTL</Text>
              </View>
              <View className="w-[48%] p-2 rounded-control bg-theme-card">
                <Text className="text-theme-text font-bold text-xs">70.3 Half Ironman</Text>
                <Text className="text-theme-muted text-xs">Target: 80 - 110 CTL</Text>
              </View>
              <View className="w-[48%] p-2 rounded-control bg-theme-card">
                <Text className="text-theme-text font-bold text-xs">Full Marathon</Text>
                <Text className="text-theme-muted text-xs">Target: 80 - 100+ CTL</Text>
              </View>
              <View className="w-[48%] p-2 rounded-control bg-theme-card">
                <Text className="text-theme-text font-bold text-xs">140.6 Full Ironman</Text>
                <Text className="text-theme-muted text-xs">Target: 110 - 150+ CTL</Text>
              </View>
            </View>
            <Text className="text-xs text-theme-muted italic mt-1 leading-relaxed">
              *CTL (Fitness) is auto-calculated based on race type, distance, and preparation window.
            </Text>
          </View>
        )}

        {/* GOALS LIST */}
        {milestones.length === 0 ? (
          <View className="p-4 bg-theme-bg/60 rounded-xl items-center justify-center my-2">
            <Ionicons name="flag-outline" size={24} color={theme.textSecondary} />
            <Text className="text-theme-text font-bold text-xs mt-2 text-center">
              No active goals or milestones set
            </Text>
            <Text className="text-theme-muted text-xs mt-1 text-center">
              Tap "+ Add Goal" above to add your primary race or physiological target.
            </Text>
          </View>
        ) : (
          <View className="gap-y-4">
            {milestones.map((row) => {
              const isRace = row.goalType === 'race';
              return (
                <View
                  key={row.id}
                  className="p-3 bg-theme-bg rounded-xl gap-y-3 border border-theme-border/40"
                >
                  {/* HEADER ROW: MAIN vs SECONDARY BADGE & DELETE BUTTON */}
                  <View className="flex-row items-center justify-between">
                    <TouchableOpacity
                      onPress={() => handleToggleARace(row.id)}
                      className={`px-2.5 py-1 rounded-full flex-row items-center ${row.isARace ? 'bg-semantic-warning/20' : 'bg-theme-card'
                        }`}
                    >
                      <Ionicons
                        name={row.isARace ? 'trophy' : 'trophy-outline'}
                        size={12}
                        color={row.isARace ? '#EAB308' : '#8E8E93'}
                      />
                      <Text
                        className={`text-xs font-bold ml-1 ${row.isARace ? 'text-semantic-warning' : 'text-theme-muted'
                          }`}
                      >
                        {row.isARace ? 'PRIMARY (MAIN GOAL)' : 'SECONDARY GOAL'}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => handleRemoveMilestone(row.id)}
                      className="p-1"
                    >
                      <Ionicons name="trash-outline" size={16} color="#EF4444" />
                    </TouchableOpacity>
                  </View>

                  {/* GOAL TYPE SELECTOR: RACE vs PHYSIOLOGICAL */}
                  <View className="flex-row bg-theme-card p-1 rounded-xl border border-theme-border/40">
                    <TouchableOpacity
                      onPress={() => handleUpdateMilestone(row.id, 'goalType', 'race')}
                      className={`flex-1 py-1.5 rounded-lg items-center flex-row justify-center ${isRace ? 'bg-theme-accent' : 'bg-transparent'
                        }`}
                    >
                      <Ionicons name="flag-outline" size={13} color={isRace ? '#FFFFFF' : theme.textSecondary} />
                      <Text className={`text-xs font-bold ml-1.5 ${isRace ? 'text-white' : 'text-theme-muted'}`}>
                        Race Goal
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => handleUpdateMilestone(row.id, 'goalType', 'physiological')}
                      className={`flex-1 py-1.5 rounded-lg items-center flex-row justify-center ${!isRace ? 'bg-theme-accent' : 'bg-transparent'
                        }`}
                    >
                      <Ionicons name="fitness-outline" size={13} color={!isRace ? '#FFFFFF' : theme.textSecondary} />
                      <Text className={`text-xs font-bold ml-1.5 ${!isRace ? 'text-white' : 'text-theme-muted'}`}>
                        Physiological
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* FORM FIELDS BASED ON GOAL TYPE */}
                  <View className="gap-y-3">
                    {isRace ? (
                      /* RACE GOAL FIELDS */
                      <>
                        <View>
                          <Text className="text-xs font-bold text-theme-muted mb-1">
                            Race Event Name
                          </Text>
                          <TextInput
                            value={row.eventName}
                            onChangeText={(val) => handleUpdateMilestone(row.id, 'eventName', val)}
                            placeholder="e.g. Amsterdam Marathon, 70.3 Ironman..."
                            placeholderTextColor={theme.textSecondary}
                            className="bg-theme-card rounded-control p-3 text-xs text-theme-text font-bold border border-theme-border/50"
                          />
                        </View>

                        {/* EVENT DATE */}
                        <View>
                          <Text className="text-xs font-bold text-theme-muted mb-1">
                            Race Date
                          </Text>
                          <TouchableOpacity
                            onPress={() => handleOpenDatePicker(row)}
                            activeOpacity={0.8}
                            className="bg-theme-card rounded-tile p-3 flex-row items-center justify-between border border-theme-border/50"
                          >
                            <Text
                              className={`text-xs font-bold ${row.eventDate ? 'text-theme-text' : 'text-theme-muted'
                                }`}
                            >
                              {formatDateDisplay(row.eventDate)}
                            </Text>
                            <Ionicons name="calendar-outline" size={15} color={theme.tint} />
                          </TouchableOpacity>
                        </View>

                        {/* TARGET SELECTION: FINISH RACE vs TIME GOAL */}
                        <View>
                          <Text className="text-xs font-bold text-theme-muted mb-1.5">
                            Race Target
                          </Text>
                          <View className="flex-row gap-2">
                            <TouchableOpacity
                              onPress={() => handleUpdateMilestone(row.id, 'targetMode', 'finish')}
                              className={`flex-1 p-2.5 rounded-xl border flex-row items-center justify-center ${row.targetMode === 'finish'
                                  ? 'bg-theme-accent/15 border-theme-accent'
                                  : 'bg-theme-card border-theme-border/50'
                                }`}
                            >
                              <Ionicons
                                name="checkmark-circle-outline"
                                size={14}
                                color={row.targetMode === 'finish' ? theme.tint : theme.textSecondary}
                              />
                              <Text
                                className={`text-xs font-bold ml-1.5 ${row.targetMode === 'finish' ? 'text-theme-accent' : 'text-theme-muted'
                                  }`}
                              >
                                Finish the Race
                              </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              onPress={() => handleUpdateMilestone(row.id, 'targetMode', 'time')}
                              className={`flex-1 p-2.5 rounded-xl border flex-row items-center justify-center ${row.targetMode === 'time'
                                  ? 'bg-theme-accent/15 border-theme-accent'
                                  : 'bg-theme-card border-theme-border/50'
                                }`}
                            >
                              <Ionicons
                                name="time-outline"
                                size={14}
                                color={row.targetMode === 'time' ? theme.tint : theme.textSecondary}
                              />
                              <Text
                                className={`text-xs font-bold ml-1.5 ${row.targetMode === 'time' ? 'text-theme-accent' : 'text-theme-muted'
                                  }`}
                              >
                                Time Goal
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </View>

                        {/* IF TIME GOAL IS SELECTED */}
                        {row.targetMode === 'time' && (
                          <View>
                            <Text className="text-xs font-bold text-theme-muted mb-1">
                              Target Time
                            </Text>
                            <TextInput
                              value={row.targetValue}
                              onChangeText={(val) => handleUpdateMilestone(row.id, 'targetValue', val)}
                              placeholder="e.g. 03:45:00 or 3h 45m"
                              placeholderTextColor={theme.textSecondary}
                              className="bg-theme-card rounded-control p-3 text-xs text-theme-text font-bold border border-theme-border/50"
                            />
                          </View>
                        )}
                      </>
                    ) : (
                      /* PHYSIOLOGICAL GOAL FIELDS */
                      <>
                        <View>
                          <Text className="text-xs font-bold text-theme-muted mb-1">
                            Goal Title
                          </Text>
                          <TextInput
                            value={row.eventName}
                            onChangeText={(val) => handleUpdateMilestone(row.id, 'eventName', val)}
                            placeholder="e.g. Body Composition & Target Weight"
                            placeholderTextColor={theme.textSecondary}
                            className="bg-theme-card rounded-control p-3 text-xs text-theme-text font-bold border border-theme-border/50"
                          />
                        </View>

                        <View>
                          <Text className="text-xs font-bold text-theme-muted mb-1">
                            Target Date
                          </Text>
                          <TouchableOpacity
                            onPress={() => handleOpenDatePicker(row)}
                            activeOpacity={0.8}
                            className="bg-theme-card rounded-tile p-3 flex-row items-center justify-between border border-theme-border/50"
                          >
                            <Text
                              className={`text-xs font-bold ${row.eventDate ? 'text-theme-text' : 'text-theme-muted'
                                }`}
                            >
                              {formatDateDisplay(row.eventDate)}
                            </Text>
                            <Ionicons name="calendar-outline" size={15} color={theme.tint} />
                          </TouchableOpacity>
                        </View>

                        <View>
                          <Text className="text-xs font-bold text-theme-muted mb-1">
                            Goal Weight (kg)
                          </Text>
                          <TextInput
                            value={row.targetWeight}
                            onChangeText={(val) => handleUpdateMilestone(row.id, 'targetWeight', val)}
                            placeholder="e.g. 72"
                            placeholderTextColor={theme.textSecondary}
                            keyboardType="numeric"
                            className="bg-theme-card rounded-control p-3 text-xs text-theme-text font-bold border border-theme-border/50"
                          />
                        </View>
                      </>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* SAVE BUTTON */}
        <TouchableOpacity
          onPress={handleSaveCalendar}
          disabled={saving}
          className="bg-theme-accent py-3.5 rounded-xl items-center mt-5 shadow-sm"
        >
          <Text className="text-white font-bold text-sm">
            {saving ? 'Saving Goals...' : 'Save Goals & Calendar'}
          </Text>
        </TouchableOpacity>

        {savedSuccess && (
          <View className="p-3 bg-semantic-success/10 rounded-xl mt-3 items-center">
            <Text className="text-semantic-success font-bold text-xs">
              Goals saved successfully!
            </Text>
          </View>
        )}
      </Card>

      <EventDatePickerSheet
        visible={dateModalVisible}
        value={pickerInitialDate}
        onClose={() => setDateModalVisible(false)}
        onConfirm={handleConfirmDate}
      />
    </View>
  );
};
