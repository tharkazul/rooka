import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/use-theme';
import { getDisciplineConfig } from '../../utils/disciplineConfig';
import * as Haptics from 'expo-haptics';
import React from 'react';
import { Text, TouchableOpacity, View, useColorScheme } from 'react-native';
import { SportType, WorkoutItem } from '../../types/dashboard';
import { Card } from '../ui/Card';
import { DayAgenda } from './MicroPlanAgendaCard';

interface DetailedDayCardProps {
  day: DayAgenda;
  weatherTemp?: string;
  onAdaptPress: () => void;
  onAddWorkout: (dayName: string, dateStr: string) => void;
  onSelectWorkout: (workout: WorkoutItem) => void;
  onDeleteWorkout: (workoutId: string) => void;
  onInvitePartner: (workout: WorkoutItem) => void;
}

export function DetailedDayCard({
  day,
  weatherTemp = '22°C',
  onAdaptPress,
  onAddWorkout,
  onSelectWorkout,
  onDeleteWorkout,
  onInvitePartner,
}: DetailedDayCardProps) {
    const theme = useTheme();
    // One palette for every screen; see utils/disciplineConfig.
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';


  const isRest = (sport?: SportType | string) => String(sport).toUpperCase() === 'REST';

  /**
   * A REST entry is a placeholder for "nothing planned", so it stops being true
   * the moment something is planned. Adding a session to a rest day used to
   * leave both on the card -- a workout sitting directly beneath a badge saying
   * the day was a rest day. The placeholder now yields to real sessions.
   */
  const visibleWorkouts = day.workouts.some((w) => !isRest(w.type))
    ? day.workouts.filter((w) => !isRest(w.type))
    : day.workouts;

  const hasWorkouts = visibleWorkouts.length > 0;

  const formatHumanDuration = (durationStr?: string, sport?: SportType | string) => {
    if (String(sport).toUpperCase() === 'REST') return 'Rest day';
    if (!durationStr) return `45 min ${sport ? sport.toLowerCase() : 'session'}`;
    const cleanDur = durationStr.replace(/mins?/i, 'min').trim();
    const sportName = sport ? sport.toLowerCase() : 'session';
    return `${cleanDur} ${sportName}`;
  };

  // Sum across the day's workouts — this is the number the header was assumed
  // to be showing but never was.
  const dayTotalRooka = Math.round(
    (day.workouts || []).reduce((sum, w) => sum + (w.rookaPoints || 0), 0)
  );

  return (
    <Card
      className={`p-4 md:p-5 mb-5 border ${day.isToday
          ? 'border-theme-accent border-[1.5px] bg-theme-card'
          : 'border-theme-border bg-theme-card'
        }`}
    >
      {/* Day Header Row matching TodaysPlanCard header format */}
      <View className="flex-row items-center justify-between pb-3 mb-3.5 border-b border-theme-border/50">
        <View className="flex-row items-center gap-3">
          <View className="w-10 h-10 rounded-xl bg-theme-accent/15 items-center justify-center">
            <Ionicons name="calendar-outline" size={20} color={theme.tint} />
          </View>

          <View>
            <View className="flex-row items-center gap-2">
              <Text className="text-lg font-extrabold text-theme-text">{day.dayName} {day.dateStr}</Text>

              {day.isToday && (
                <View className="bg-theme-accent px-2 py-0.5 rounded-full">
                  <Text className="text-xs font-extrabold text-white">
                    Today
                  </Text>
                </View>
              )}
            </View>

            <Text className="text-sm text-theme-muted font-rajdhani">
              {weatherTemp}
              {dayTotalRooka > 0 ? ` · ${dayTotalRooka} total rooka` : ''}
            </Text>
          </View>
        </View>

        {/* Adapt Plan Trigger matching TodaysPlanCard ADAPT button styling */}
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onAdaptPress();
          }}
          activeOpacity={0.7}
          className="bg-theme-card px-3.5 py-1.5 rounded-full flex-row items-center gap-1.5"
        >
          <Ionicons name="flash-outline" size={13} color={theme.tint} />
          <Text className="text-xs font-bold text-semantic-warning">ADAPT</Text>
        </TouchableOpacity>
      </View>

      {/* Workouts List for this Day */}
      {!hasWorkouts ? (
        <View className="p-5 rounded-2xl border border-theme-border bg-theme-bg/60 flex-col items-center justify-center gap-2">
          <Ionicons name="moon-outline" size={24} color={theme.textSecondary} />
          <Text className="text-base font-bold text-theme-text">Rest & Recovery Day</Text>
          <Text className="text-sm text-theme-muted text-center px-4">
            No structured sessions scheduled for this day. Take time to stretch and refuel.
          </Text>

          <TouchableOpacity
            onPress={() => onAddWorkout(day.dayName, day.dateStr)}
            className="mt-2 flex-row items-center gap-1.5 px-4 py-2 rounded-xl bg-theme-accent"
          >
            <Ionicons name="add" size={16} color="#FFFFFF" />
            <Text className="text-sm font-extrabold text-white">Add workout</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View>
          {visibleWorkouts.map((workout, wIndex) => {
            const cfg = getDisciplineConfig(workout.type, scheme);
            const humanDuration = formatHumanDuration(workout.duration, workout.type);
            const isRestPlaceholder = isRest(workout.type);

            return (
              <TouchableOpacity
                key={workout.id}
                onPress={() => {
                  Haptics.selectionAsync();
                  onSelectWorkout(workout);
                }}
                activeOpacity={0.8}
                /* One card level per screen: the day. A workout used to be a
                   second bordered, rounded, padded box inside it — three
                   borders deep once you count the page card. It is now
                   separated by space and a hairline rule instead, and carries
                   its sport colour once, on the badge.

                   The rule only separates one workout from the NEXT one. Drawn
                   unconditionally it also fired after the last workout, boxing
                   in the Add button for no reason. */
                className={`py-3.5 flex-col gap-2 ${
                  wIndex < visibleWorkouts.length - 1 ? 'border-b border-theme-border/40' : ''
                }`}
              >
                {/* Top Discipline Line */}
                <View className="flex-row items-center justify-between">
                  <View
                    style={{ backgroundColor: cfg.tint }}
                    className="px-2.5 py-0.5 rounded-md flex-row items-center gap-1.5"
                  >
                    <Ionicons name={cfg.icon as any} size={13} color={cfg.color} />
                    <Text style={{ color: cfg.color }} className="text-xs font-extrabold">
                      {cfg.label}
                    </Text>
                  </View>

                  <View className="flex-row items-center gap-2 ml-2">
                    <Text className="text-sm font-mono font-bold text-theme-accent font-rajdhani">
                      +{Math.round(workout.rookaPoints || 0)} rooka
                    </Text>


                    {workout.isCompleted && (
                      <View className="flex-row items-center gap-1 bg-semantic-success/15 px-2 py-0.5 rounded-full">
                        <Ionicons name="checkmark-circle" size={12} color="#10B981" />
                        <Text className="text-xs font-extrabold text-semantic-success">DONE</Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Workout Title */}
                <Text className="text-base font-extrabold text-theme-text leading-snug">
                  {workout.title}
                </Text>

                {/* The coach's own description of the session. Stored on every
                    generated plan and pushed to Strava, but never shown here
                    until now. Only rendered for coach-written sessions — a
                    workout you built yourself has no coach to quote. */}
                {workout.coachNote && (
                  <View className="flex-row gap-2 p-2.5 rounded-xl bg-theme-accent/5 border-l-2 border-l-theme-accent">
                    <Ionicons
                      name="chatbubble-ellipses-outline"
                      size={13}
                      color={theme.tint}
                      style={{ marginTop: 1 }}
                    />
                    <Text className="flex-1 text-sm text-theme-muted leading-relaxed">
                      {workout.coachNote}
                    </Text>
                  </View>
                )}

                {/* Clean Subline & Quick Actions Bar
                    Skipped entirely for a REST placeholder: "Rest day" merely
                    restated the REST badge above it, and neither inviting a
                    partner to a rest day nor deleting one is a thing anyone
                    wants to do -- the placeholder clears itself as soon as a
                    real session lands on the day. */}
                {!isRestPlaceholder && (
                <View className="flex-row items-center justify-between pt-1">
                  {/* The badge above already states this workout's rooka; the
                      figure was simply printed twice on the same card. */}
                  <Text className="text-sm text-theme-muted">
                    {humanDuration}
                  </Text>

                  <View className="flex-row items-center gap-2 ml-2">
                    <TouchableOpacity
                      onPress={(e) => {
                        e.stopPropagation();
                        onInvitePartner(workout);
                      }}
                      className="flex-row items-center gap-1 px-2.5 py-1 bg-theme-card border border-theme-border rounded-control"
                    >
                      <Ionicons name="person-add-outline" size={12} color={theme.textSecondary} />
                      <Text className="text-xs font-bold text-theme-muted">Invite</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={(e) => {
                        e.stopPropagation();
                        onDeleteWorkout(workout.id);
                      }}
                      className="flex-row items-center gap-1 px-2 py-1 ml-1.5 bg-semantic-error/10 border border-semantic-error/30 rounded-control"
                    >
                      <Ionicons name="trash-outline" size={12} color="#F43F5E" />
                    </TouchableOpacity>
                  </View>
                </View>
                )}
              </TouchableOpacity>
            );
          })}

          {/* Add Workout Button for this Day */}
          <TouchableOpacity
            onPress={() => onAddWorkout(day.dayName, day.dateStr)}
            activeOpacity={0.8}
            className="w-full py-3 mt-1 flex-row items-center justify-center gap-1.5 active:opacity-60"
          >
            <Ionicons name="add-circle-outline" size={16} color={theme.tint} />
            <Text className="text-sm font-extrabold text-theme-accent">+ Add Exercise</Text>
          </TouchableOpacity>
        </View>
      )}
    </Card>
  );
}
