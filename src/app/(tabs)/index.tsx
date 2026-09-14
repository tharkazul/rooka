import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  DeviceEventEmitter,
  ScrollView,
  Text,
  TouchableOpacity,
  View
} from 'react-native';

import { goalsStorage } from '../../services/storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { calculateTargetCTL } from '../../components/profile/GoalsTab';
import { Card } from '../../components/ui/Card';
import { ScreenHeaderTitleRow } from '../../components/ui/ScreenHeaderTitleRow';
import { useActivities } from '../../context/ActivityStore';
import { useCoachChat } from '../../context/CoachChatStore';
import { useHeaderLayout } from '../../context/HeaderLayoutContext';
import { useLanguage } from '../../context/LanguageContext';
import { usePlan } from '../../context/PlanStore';
import { useTabBar } from '../../context/TabBarContext';
import { useUser } from '../../context/UserStore';
import { gamificationApi, planApi } from '../../services/apiServices';

import { DetailedDayCard } from '../../components/dashboard/DetailedDayCard';
import { SeasonRoadmapCard } from '../../components/dashboard/SeasonRoadmapCard';
import { SideBySideWeekBar } from '../../components/dashboard/SideBySideWeekBar';


import { AdaptPlanModal } from '../../components/dashboard/AdaptPlanModal';
import { AddWorkoutModal } from '../../components/dashboard/AddWorkoutModal';
import { InvitePartnerModal } from '../../components/dashboard/InvitePartnerModal';
import { LogActivityModal } from '../../components/dashboard/LogActivityModal';
import { LogNiggleModal } from '../../components/dashboard/LogNiggleModal';
import { LogWeightModal } from '../../components/dashboard/LogWeightModal';

import {
  DayAgenda,
  MacroPeriodInfo,
  WorkoutItem,
} from '../../types/dashboard';

// Date Helpers (Fixed to use local timezone date components instead of UTC ISO string)
function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setHours(0, 0, 0, 0);
  return new Date(d.setDate(diff));
}

function formatDateToYYYYMMDD(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatShortDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function PlanningHomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user } = useUser();
  const { sendMessage, unreadCount } = useCoachChat();
  const { t } = useLanguage();
  const { headerHeight } = useHeaderLayout();
  const { plan, refreshPlan, addWorkout, updateWorkout, deleteWorkout } = usePlan();
  const { activities } = useActivities();

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isAdaptModalOpen, setIsAdaptModalOpen] = useState(false);
  const [isWeightModalOpen, setIsWeightModalOpen] = useState(false);
  const [isNiggleModalOpen, setIsNiggleModalOpen] = useState(false);
  const [isLogActivityOpen, setIsLogActivityOpen] = useState(false);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [workoutToInvite, setWorkoutToInvite] = useState<WorkoutItem | null>(null);

  useEffect(() => {
    refreshPlan();
    const sub = DeviceEventEmitter.addListener('openQuickActionModal', (action: string) => {
      if (action === 'weight') {
        setIsWeightModalOpen(true);
      } else if (action === 'workout') {
        setIsAddModalOpen(true);
      } else if (action === 'injury') {
        setIsNiggleModalOpen(true);
      } else if (action === 'activity') {
        setIsLogActivityOpen(true);
      }
    });
    return () => sub.remove();
  }, []);

  // Re-fetch the plan every time this tab regains focus (e.g. coming back from the
  // coach chat after a new workout was discussed). Tab screens stay mounted between
  // switches, so the mount-only effect above won't catch changes made elsewhere.
  useFocusEffect(
    useCallback(() => {
      refreshPlan();
    }, [refreshPlan])
  );

  const { tabBarOccupied, notifyScroll, notifyScrollEnd } = useTabBar();

  const part3ScrollViewRef = useRef<ScrollView>(null);
  const hasScrolledToTodayRef = useRef(false);

  const [recordedWeight, setRecordedWeight] = useState<number>(user?.athlete_metrics?.weight_kg || 0);
  const [selectedWorkoutForEdit, setSelectedWorkoutForEdit] = useState<WorkoutItem | null>(null);

  // Selected week start date (defaults to Monday of current week)
  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(new Date()));

  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(0);
  const [dayYPositions, setDayYPositions] = useState<Record<number, number>>({});

  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayYYYYMMDD = formatDateToYYYYMMDD(now);

  const dayOfWeekShort = now.toLocaleDateString('en-US', { weekday: 'short' });
  const dayOfWeekUpper = dayOfWeekShort.toUpperCase();
  const monthShort = now.toLocaleDateString('en-US', { month: 'short' });
  const dayNum = now.getDate();

  const todayDateStr = `${monthShort} ${dayNum}`;

  const [targetAddDay, setTargetAddDay] = useState<{ dayName: string; dateStr: string; fullDate?: string }>({
    dayName: dayOfWeekUpper,
    dateStr: todayDateStr,
    fullDate: todayYYYYMMDD,
  });

  const handlePrevWeek = () => {
    Haptics.selectionAsync();
    setWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() - 7);
      return d;
    });
  };

  const handleNextWeek = () => {
    Haptics.selectionAsync();
    setWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + 7);
      return d;
    });
  };

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekRangeLabel = `${formatShortDate(weekStart)} - ${formatShortDate(weekEnd)}`;

  const calculateDaysRemaining = (eventDateStr?: string): number => {
    if (!eventDateStr) return 0;
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const cleanEventDate = eventDateStr.split('T')[0];
      if (cleanEventDate === todayStr) return 0;
      const todayDate = new Date(todayStr + 'T00:00:00Z');
      const targetDate = new Date(cleanEventDate + 'T00:00:00Z');
      const diffTime = targetDate.getTime() - todayDate.getTime();
      return Math.round(diffTime / (1000 * 60 * 60 * 24));
    } catch {
      return 0;
    }
  };

  const [activeGoals, setActiveGoals] = useState<Array<{
    name: string;
    date: string;
    isMain: boolean;
    goalType: 'race' | 'physiological';
    targetCTL?: number;
  }>>([]);

  useEffect(() => {
    let isMounted = true;
    setActiveGoals([]);

    if (!user?.id) {
      return;
    }

    const loadGoals = async () => {
      try {
        const cached = await goalsStorage.getGoals(user.id);
        if (cached && isMounted && Array.isArray(cached) && cached.length > 0) {
          setActiveGoals(
            cached.map((m: any) => ({
              name: m.name || m.eventName || 'Goal',
              date: m.date || m.eventDate || new Date().toISOString().split('T')[0],
              isMain: m.is_main === 1 || Boolean(m.isARace),
              goalType: (m.goal_type || m.goalType || 'race') as 'race' | 'physiological',
              targetCTL: m.target_ctl || m.targetCtl || (m.name ? calculateTargetCTL(m.name) : 70),
            }))
          );
        }
      } catch (_) { }

      try {
        const milestones = await gamificationApi.getMilestones();
        if (isMounted && milestones && milestones.length > 0) {
          const mapped = milestones.map((m: any) => ({
            name: m.name || m.eventName || 'Goal',
            date: m.date || m.eventDate || new Date().toISOString().split('T')[0],
            isMain: m.is_main === 1 || Boolean(m.isARace),
            goalType: (m.goal_type || m.goalType || 'race') as 'race' | 'physiological',
            targetCTL: m.target_ctl || m.targetCtl || (m.name ? calculateTargetCTL(m.name) : 70),
          }));
          setActiveGoals(mapped);
          await goalsStorage.setGoals(milestones, user.id);
          return;
        }
      } catch (e) {
        console.log('Failed to fetch milestones in Planning screen:', e);
      }

      const hasEventGoal = Boolean(user?.target_event && user.target_event.trim().length > 0);
      const hasPhysGoal = Boolean(
        (user?.target_weight && Number(user.target_weight) > 0) ||
        (user?.target_vo2max && Number(user.target_vo2max) > 0)
      );

      if (isMounted && (hasEventGoal || hasPhysGoal)) {
        const isPhys = hasPhysGoal || (user as any)?.goal_type === 'physiological' || (user as any)?.goalType === 'physiological';
        setActiveGoals([
          {
            name: user?.target_event || (isPhys ? 'Health & Fitness Goal' : 'Target Goal'),
            date: user?.event_date || new Date().toISOString().split('T')[0],
            isMain: true,
            goalType: (isPhys ? 'physiological' : 'race') as 'race' | 'physiological',
            targetCTL: user?.target_ctl || 70,
          },
        ]);
      } else if (isMounted) {
        setActiveGoals([]);
        await goalsStorage.setGoals([], user.id);
      }
    };

    loadGoals();
    return () => {
      isMounted = false;
    };
  }, [user?.id, user?.target_event, user?.event_date, user?.target_weight, user?.target_vo2max, (user as any)?.goal_type, (user as any)?.goalType]);

  const nearestGoalInfo = useMemo(() => {
    if (!activeGoals || activeGoals.length === 0) {
      const hasEventGoal = Boolean(user?.target_event && user.target_event.trim().length > 0);
      const hasPhysGoal = Boolean(
        (user?.target_weight && Number(user.target_weight) > 0) ||
        (user?.target_vo2max && Number(user.target_vo2max) > 0)
      );

      if (hasEventGoal || hasPhysGoal) {
        const isPhys = hasPhysGoal || (user as any)?.goal_type === 'physiological' || (user as any)?.goalType === 'physiological';
        const gDate = user?.event_date || new Date().toISOString().split('T')[0];
        return {
          name: user?.target_event || (isPhys ? 'Health & Fitness Goal' : 'Target Goal'),
          date: gDate,
          isMain: true,
          goalType: (isPhys ? 'physiological' : ((user as any)?.goal_type || (user as any)?.goalType || 'race')) as 'race' | 'physiological',
          targetCTL: user?.target_ctl || 70,
          daysRemaining: calculateDaysRemaining(gDate),
        };
      }
      return null;
    }

    const goalsWithDays = activeGoals.map((g) => ({
      ...g,
      daysRemaining: calculateDaysRemaining(g.date),
    }));

    const upcomingGoals = goalsWithDays.filter((g) => g.daysRemaining >= -1);
    const pool = upcomingGoals.length > 0 ? upcomingGoals : goalsWithDays;

    pool.sort((a, b) => {
      const aFuture = a.daysRemaining >= -1;
      const bFuture = b.daysRemaining >= -1;
      if (aFuture && !bFuture) return -1;
      if (!aFuture && bFuture) return 1;

      if (Math.abs(a.daysRemaining) !== Math.abs(b.daysRemaining)) {
        return Math.abs(a.daysRemaining) - Math.abs(b.daysRemaining);
      }
      return a.isMain === b.isMain ? 0 : a.isMain ? -1 : 1;
    });

    return pool[0] || null;
  }, [activeGoals, user?.target_event, user?.event_date, user?.target_ctl, user?.target_weight, user?.target_vo2max]);

  const hasSeasonGoal = Boolean(nearestGoalInfo && nearestGoalInfo.name);
  const isPhysiologicalGoal = nearestGoalInfo?.goalType === 'physiological';

  const seasonInfo: MacroPeriodInfo = useMemo(() => {
    const goalName = nearestGoalInfo?.name || user?.target_event || 'Training Goal';
    const targetCtl = nearestGoalInfo?.targetCTL || user?.target_ctl || 70;
    const currentCtl = user?.current_ctl || 45;
    const daysLeft = nearestGoalInfo ? nearestGoalInfo.daysRemaining : 60;

    const totalCycleDays = Math.max(112, daysLeft > 0 ? daysLeft : 112);
    const elapsedTotalDays = Math.max(0, totalCycleDays - Math.max(0, daysLeft));
    const progressRatio = Math.min(1, Math.max(0, elapsedTotalDays / totalCycleDays));

    const phaseLengthDays = totalCycleDays / 4;
    const currentPhaseIndex = Math.min(3, Math.floor(progressRatio * 4));
    const phaseElapsedDays = Math.max(0, elapsedTotalDays - currentPhaseIndex * phaseLengthDays);
    const activePhaseProgress = Math.min(100, Math.max(0, Math.round((phaseElapsedDays / phaseLengthDays) * 100)));

    const goalLabel = nearestGoalInfo?.isMain
      ? isPhysiologicalGoal ? 'PRIMARY' : 'RACE'
      : isPhysiologicalGoal ? 'SECONDARY' : 'RACE';

    if (isPhysiologicalGoal) {
      return {
        raceTargetName: goalName,
        daysRemaining: daysLeft,
        currentPhaseIndex,
        targetCTL: targetCtl,
        currentCTL: currentCtl,
        goalType: 'physiological',
        isPrimaryGoal: nearestGoalInfo?.isMain,
        goalLabel,
        phases: [
          {
            name: 'ADAPT',
            weeks: 'Weeks 1-4',
            focus: 'Neuromuscular & Movement Baseline',
            description: 'Building workout consistency, structural integrity, and foundational movement efficiency with steady volume.',
            status: currentPhaseIndex > 0 ? 'completed' : currentPhaseIndex === 0 ? 'active' : 'upcoming',
            progressPercent: currentPhaseIndex === 0 ? activePhaseProgress : undefined,
          },
          {
            name: 'DEVELOP',
            weeks: 'Weeks 5-8',
            focus: 'Targeted Load & Volume',
            description: 'Incremental load increase, target energy system stimulus, and progressive overload across target disciplines.',
            status: currentPhaseIndex > 1 ? 'completed' : currentPhaseIndex === 1 ? 'active' : 'upcoming',
            progressPercent: currentPhaseIndex === 1 ? activePhaseProgress : undefined,
          },
          {
            name: 'CRUNCH',
            weeks: 'Weeks 9-12',
            focus: 'High-Efficiency Output',
            description: 'Stabilizing physiological adaptations, expanding threshold capacity, and performance benchmark assessments.',
            status: currentPhaseIndex > 2 ? 'completed' : currentPhaseIndex === 2 ? 'active' : 'upcoming',
            progressPercent: currentPhaseIndex === 2 ? activePhaseProgress : undefined,
          },
          {
            name: 'SUSTAIN',
            weeks: 'Weeks 13-16',
            focus: 'Continuous Growth & Maintenance',
            description: 'Sustaining peak fitness gains, long-term habit strength, and resilient baseline fitness maintenance.',
            status: currentPhaseIndex === 3 ? 'active' : 'upcoming',
            progressPercent: currentPhaseIndex === 3 ? activePhaseProgress : undefined,
          },
        ],
      };
    }

    return {
      raceTargetName: goalName,
      daysRemaining: daysLeft,
      currentPhaseIndex,
      targetCTL: targetCtl,
      currentCTL: currentCtl,
      goalType: 'race',
      isPrimaryGoal: nearestGoalInfo?.isMain,
      goalLabel,
      phases: [
        {
          name: 'BASE PHASE',
          weeks: 'Weeks 1-6',
          focus: 'Aerobic Volume & Technique',
          description: 'Building mitochondrial density & base aerobic capacity with low HR long rides and CSS swim threshold sets.',
          status: currentPhaseIndex > 0 ? 'completed' : currentPhaseIndex === 0 ? 'active' : 'upcoming',
          progressPercent: currentPhaseIndex === 0 ? activePhaseProgress : undefined,
        },
        {
          name: 'BUILD PHASE',
          weeks: 'Weeks 7-12',
          focus: 'Threshold Velocity & Power',
          description: 'High aerobic intervals, threshold swim pace, VO2 max bike intervals, and Saturday brick runs.',
          status: currentPhaseIndex > 1 ? 'completed' : currentPhaseIndex === 1 ? 'active' : 'upcoming',
          progressPercent: currentPhaseIndex === 1 ? activePhaseProgress : undefined,
        },
        {
          name: 'PEAK PHASE',
          weeks: 'Weeks 13-14',
          focus: 'Race Pace Intervals',
          description: 'Race-specific pacing simulation, sharp interval efforts, and high-intensity micro efforts.',
          status: currentPhaseIndex > 2 ? 'completed' : currentPhaseIndex === 2 ? 'active' : 'upcoming',
          progressPercent: currentPhaseIndex === 2 ? activePhaseProgress : undefined,
        },
        {
          name: 'TAPER PHASE',
          weeks: 'Weeks 15-16',
          focus: 'Glycogen Supercompensation',
          description: 'Volume reduction by 50% while maintaining sharp stride frequency to arrive fresh on race day.',
          status: currentPhaseIndex === 3 ? 'active' : 'upcoming',
          progressPercent: currentPhaseIndex === 3 ? activePhaseProgress : undefined,
        },
      ],
    };
  }, [nearestGoalInfo, user?.target_event, user?.target_ctl, user?.current_ctl, isPhysiologicalGoal]);

  // Compute 7-Day Agenda Dynamically from weekStart
  const DAYS_HEADER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const buildAgenda = (start: Date): DayAgenda[] => DAYS_HEADER.map((dayName, idx) => {
    const dayDate = new Date(start);
    dayDate.setDate(dayDate.getDate() + idx);
    dayDate.setHours(0, 0, 0, 0);

    const dateYYYYMMDD = formatDateToYYYYMMDD(dayDate);
    const dateStr = formatShortDate(dayDate);
    const isToday = dateYYYYMMDD === todayYYYYMMDD;
    const isPast = dayDate < todayMidnight;

    let workouts: WorkoutItem[] = [];

    if (plan && plan.length > 0) {
      const dbWorkouts = plan.filter((w) => w.date === dateYYYYMMDD);
      workouts = dbWorkouts.map((w) => {
        // calculate duration from steps_json if possible
        let durStr = '45 mins';
        if (w.steps_json && typeof w.steps_json === 'string' && w.steps_json !== '[]') {
          try {
            const steps = JSON.parse(w.steps_json);
            let totalMins = 0;
            const parseSteps = (sArr: any[]) => {
              for (const s of sArr) {
                if (s.condition_type === 'time' && s.condition_value) totalMins += s.condition_value;
                if (s.condition_type === 'time_sec' && s.condition_value) totalMins += s.condition_value / 60;
                if (s.type === 'repeat' && s.iterations && s.steps) {
                  let iterMins = 0;
                  for (const rs of s.steps) {
                    if (rs.condition_type === 'time' && rs.condition_value) iterMins += rs.condition_value;
                    if (rs.condition_type === 'time_sec' && rs.condition_value) iterMins += rs.condition_value / 60;
                  }
                  totalMins += (iterMins * s.iterations);
                }
                if (s.steps) parseSteps(s.steps);
              }
            };
            parseSteps(steps);
            if (totalMins > 0) durStr = `${Math.round(totalMins)} mins`;
          } catch (e) { }
        }

        let parsedSteps = [];
        if (w.steps_json && typeof w.steps_json === 'string') {
          try { parsedSteps = JSON.parse(w.steps_json); } catch (e) { }
        }

        return {
          id: String(w.id),
          day: w.day || dayName,
          dateStr: w.dateStr || dateStr,
          type: (w.sport as any) || 'RUN',
          title: w.title || w.description || 'Planned Workout',
          duration: w.duration || durStr,
          rookaPoints: w.target_rooka || 0,
          sparkPoints: w.target_spark || 0,
          isStructured: parsedSteps.length > 0,
          isCompleted: (() => {
            if (w.isCompleted) return true;
            const planSport = String(w.sport || (w as any).type).toUpperCase();
            if (planSport === 'REST') return false;
            // Check if there's any activity on this day of the same sport type
            const actsOnDay = activities.filter(a => {
              const d = a.start_date_local || a.start_date || (a as any).date;
              return d?.startsWith(dateYYYYMMDD);
            });
            const isMatch = actsOnDay.some(a => {
              const aSport = String(a.sport_type || (a as any).type).toUpperCase();
              return aSport === planSport;
            });
            return isMatch;
          })(),
          actualMetrics: w.actualMetrics,
          executionScore: w.executionScore,
          steps: parsedSteps,
          notes: w.details,
          // The coach's own description of the session. It reached Strava and
          // nowhere else before this. Rows written before micro_plan gained a
          // `source` column all came from plan generation, so an absent value
          // counts as the coach; a workout you built yourself has no coach to
          // quote and shows no note.
          isCoachCreated: w.source !== 'user',
          coachNote:
            w.source !== 'user' && w.details && w.details.trim().length > 0
              ? w.details.trim()
              : undefined,
        } as WorkoutItem;
      });
    }


    return {
      dayName,
      dateStr,
      isToday,
      isPast,
      workouts,
    };
  });

  const shiftWeeks = (d: Date, n: number) => {
    const out = new Date(d);
    out.setDate(out.getDate() + n * 7);
    return out;
  };

  const weeklyAgenda = buildAgenda(weekStart);
  // The strip renders its neighbours so a swipe has something real to drag in.
  // Both come from the plan already in memory, so this is two array maps rather
  // than two fetches.
  const prevWeekAgenda = buildAgenda(shiftWeeks(weekStart, -1));
  const nextWeekAgenda = buildAgenda(shiftWeeks(weekStart, 1));

  useEffect(() => {
    hasScrolledToTodayRef.current = false;
    const todayIdx = weeklyAgenda.findIndex((d) => d.isToday);
    setSelectedDayIndex(todayIdx >= 0 ? todayIdx : 0);
  }, [weekStart]);

  // Automatically scroll to Today's card when opening planning subtab or layout measures
  useEffect(() => {
    const todayIdx = weeklyAgenda.findIndex((d) => d.isToday);
    const targetIdx = todayIdx >= 0 ? todayIdx : 0;

    if (!hasScrolledToTodayRef.current && dayYPositions[targetIdx] !== undefined) {
      hasScrolledToTodayRef.current = true;
      setTimeout(() => {
        part3ScrollViewRef.current?.scrollTo({
          y: dayYPositions[targetIdx],
          animated: true,
        });
      }, 100);
    }
  }, [dayYPositions, weeklyAgenda]);

  const handleOpenAddModal = (dayName = dayOfWeekUpper, dateStr = todayDateStr) => {
    setSelectedWorkoutForEdit(null);
    const dayIdx = weeklyAgenda.findIndex((d) => d.dayName === dayName || d.dateStr === dateStr);
    let fullDate = todayYYYYMMDD;
    if (dayIdx >= 0) {
      const targetDate = new Date(weekStart);
      targetDate.setDate(targetDate.getDate() + dayIdx);
      fullDate = formatDateToYYYYMMDD(targetDate);
    }
    setTargetAddDay({ dayName, dateStr, fullDate });
    setIsAddModalOpen(true);
  };

  const handleSelectWorkoutForEdit = (workout: WorkoutItem) => {
    setSelectedWorkoutForEdit(workout);
    if (workout.day && workout.dateStr) {
      const dayIdx = weeklyAgenda.findIndex((d) => d.dayName === workout.day || d.dateStr === workout.dateStr);
      let fullDate = workout.date || todayYYYYMMDD;
      if (dayIdx >= 0) {
        const targetDate = new Date(weekStart);
        targetDate.setDate(targetDate.getDate() + dayIdx);
        fullDate = formatDateToYYYYMMDD(targetDate);
      }
      setTargetAddDay({ dayName: workout.day, dateStr: workout.dateStr, fullDate });
    }
    setIsAddModalOpen(true);
  };

  const handleSaveWorkout = async (workoutData: Omit<WorkoutItem, 'id'>, existingId?: string) => {
    const matchedDay = weeklyAgenda.find(
      (d) => d.dayName === workoutData.day || d.dateStr === workoutData.dateStr
    );
    const targetDateStr = matchedDay ? matchedDay.dateStr : targetAddDay.dateStr;

    const dayIdx = weeklyAgenda.findIndex((d) => d.dateStr === targetDateStr);
    const targetDate = new Date(weekStart);
    if (dayIdx >= 0) targetDate.setDate(targetDate.getDate() + dayIdx);
    const targetYYYYMMDD = formatDateToYYYYMMDD(targetDate);

    // Save to DB via usePlan
    try {
      const plannedWorkout = {
        date: targetYYYYMMDD,
        day: workoutData.day,
        sport: workoutData.type,
        description: workoutData.title,
        details: workoutData.notes || '',
        target_rooka: workoutData.rookaPoints || 0,
        steps_json: JSON.stringify(workoutData.steps || []),
      };

      if (existingId && !existingId.startsWith('w-')) {
        await updateWorkout(existingId, plannedWorkout);
      } else {
        await addWorkout(plannedWorkout);
      }
      await refreshPlan();
    } catch (err) {
      console.error('Failed to save workout to DB', err);
    }
  };

  /**
   * Deleting a planned workout is permanent and there is no undo, yet the only
   * thing standing between a mis-tap and a lost session was a 12pt trash icon
   * sitting flush beside "Invite". One confirmation step.
   */
  const handleDeleteWorkout = (workoutId: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(
      'Delete this workout?',
      'It will be removed from your plan. This cannot be undone.',
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void deleteWorkoutConfirmed(workoutId) },
      ],
    );
  };

  const deleteWorkoutConfirmed = async (workoutId: string) => {
    try {
      await deleteWorkout(workoutId);
      await refreshPlan();
    } catch (err) {
      console.error('Failed to delete workout from DB', err);
    }
  };

  const handleInvitePartner = (workout: WorkoutItem) => {
    setWorkoutToInvite(workout);
    setIsInviteModalOpen(true);
  };

  const handleConfirmAdaptation = async (type: string) => {
    if (type === 'MOVE_ALL_ONE_DAY') {
      try {
        const todayStr = formatDateToYYYYMMDD(new Date());
        await planApi.pushForward(todayStr);
        await refreshPlan();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (err) {
        console.error('Failed to push forward:', err);
      }
    } else {
      let prompt = '';
      if (type === 'TIME_CRUNCH') prompt = 'I only have 30 minutes today, please adapt my workout to a time crunch.';
      if (type === 'MOVE_INDOORS') prompt = 'I need to move my workout indoors today. Please adapt it for the trainer/treadmill.';
      if (type === 'CANCEL_COMPLETELY') prompt = 'I want to cancel my workout completely today. I need to rest.';

      if (prompt) {
        sendMessage(prompt);
      }
    }
  };

  const handleSaveWeight = (newWeight: number) => {
    setRecordedWeight(newWeight);
  };

  const handleSendInjuryToCoach = (description: string, severity: number, bodyPartId?: string, bodyPartName?: string) => {
    const areaPrefix = bodyPartName ? `[${bodyPartName}] ` : '';
    sendMessage(`I have a niggle / injury to report: ${areaPrefix}${description} (Severity: ${severity}/10). Can you provide recovery advice?`);
    router.push('/coach');
  };

  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-theme-bg" style={{ paddingTop: insets.top }}>
      {/* HEADER WITH TITLE */}
      <View className="px-5 pt-3 pb-2 bg-theme-bg">
        <ScreenHeaderTitleRow
          title="Planning"
          unreadCount={unreadCount}
          onCoachPress={() => router.push('/(tabs)/coach')}
        />
      </View>

      <View className="flex-1 px-5 pt-2">
        {/* Pinned plan context — Card matching TodaysPlanCard styling */}
        <Card className="p-4 md:p-5 border-theme-border shadow-sm mb-5">
          {hasSeasonGoal && (
            <>
              <SeasonRoadmapCard info={seasonInfo} />
              <View className="h-px bg-theme-border/50 my-3.5" />
            </>
          )}

          {/* Week Selector Bar with Interactive Chevrons */}
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-sm font-extrabold text-theme-muted">
              Week plan
            </Text>
            <View className="flex-row items-center bg-theme-card border border-theme-border px-2.5 py-1 rounded-full shadow-sm">
              <TouchableOpacity onPress={handlePrevWeek} activeOpacity={0.6} className="px-1.5 py-0.5">
                <Ionicons name="chevron-back" size={13} color={theme.tint} />
              </TouchableOpacity>
              <Text className="text-sm font-mono font-extrabold text-theme-text px-1">{weekRangeLabel}</Text>
              <TouchableOpacity onPress={handleNextWeek} activeOpacity={0.6} className="px-1.5 py-0.5">
                <Ionicons name="chevron-forward" size={13} color={theme.tint} />
              </TouchableOpacity>
            </View>
          </View>

          <SideBySideWeekBar
            agenda={weeklyAgenda}
            prevAgenda={prevWeekAgenda}
            nextAgenda={nextWeekAgenda}
            selectedDayIndex={selectedDayIndex}
            onSelectDay={(idx) => {
              setSelectedDayIndex(idx);
              if (dayYPositions[idx] !== undefined) {
                part3ScrollViewRef.current?.scrollTo({ y: dayYPositions[idx], animated: true });
              }
            }}
            onPrevWeek={handlePrevWeek}
            onNextWeek={handleNextWeek}
          />
        </Card>

        <ScrollView
          ref={part3ScrollViewRef}
          className="flex-1"
          contentContainerStyle={{ paddingBottom: tabBarOccupied + 20, gap: 12 }}
          showsVerticalScrollIndicator={false}
          onScrollBeginDrag={notifyScroll} onScrollEndDrag={notifyScrollEnd} onMomentumScrollEnd={notifyScrollEnd}
        >
          {weeklyAgenda.map((day, idx) => (
            <View key={`${day.dayName}-${day.dateStr}`} onLayout={(e) => {
              const y = e.nativeEvent.layout.y;
              setDayYPositions((prev) => ({ ...prev, [idx]: y }));
            }}>
              <DetailedDayCard
                day={day}
                onAdaptPress={() => setIsAdaptModalOpen(true)}
                onAddWorkout={(dayName, dateStr) => handleOpenAddModal(dayName, dateStr)}
                onSelectWorkout={handleSelectWorkoutForEdit}
                onDeleteWorkout={handleDeleteWorkout}
                onInvitePartner={handleInvitePartner}
              />
            </View>
          ))}


        </ScrollView>
      </View>

      <AddWorkoutModal
        visible={isAddModalOpen}
        targetDayName={targetAddDay.dayName}
        targetDateStr={targetAddDay.dateStr}
        targetFullDate={targetAddDay.fullDate}
        initialWorkout={selectedWorkoutForEdit}
        onClose={() => { setIsAddModalOpen(false); setSelectedWorkoutForEdit(null); }}
        onSave={handleSaveWorkout}
        onDelete={handleDeleteWorkout}
      />
      <AdaptPlanModal visible={isAdaptModalOpen} onClose={() => setIsAdaptModalOpen(false)} onConfirmAdapt={handleConfirmAdaptation} />
      <LogWeightModal visible={isWeightModalOpen} previousWeight={recordedWeight} onClose={() => setIsWeightModalOpen(false)} onSaveWeight={handleSaveWeight} />
      <LogNiggleModal visible={isNiggleModalOpen} onClose={() => setIsNiggleModalOpen(false)} onSendToCoach={handleSendInjuryToCoach} />
      <LogActivityModal visible={isLogActivityOpen} onClose={() => setIsLogActivityOpen(false)} />
      <InvitePartnerModal visible={isInviteModalOpen} onClose={() => { setIsInviteModalOpen(false); setWorkoutToInvite(null); }} workout={workoutToInvite} />
    </View>
  );
}
