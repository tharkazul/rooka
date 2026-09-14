import React, { useCallback, useState } from 'react';
import { RookaMark } from '../ui/RookaPoints';
import { useTheme } from '@/hooks/use-theme';
import { getDisciplineConfig } from '../../utils/disciplineConfig';
import { View, Text, TouchableOpacity, useColorScheme, LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { DayAgenda } from './MicroPlanAgendaCard';
import { SportType } from '../../types/dashboard';

interface SideBySideWeekBarProps {
  agenda: DayAgenda[];
  selectedDayIndex?: number;
  onSelectDay: (index: number, dayName: string) => void;
  /** The weeks either side, so a swipe drags in real content rather than a gap. */
  prevAgenda?: DayAgenda[];
  nextAgenda?: DayAgenda[];
  /** Swiping the strip steps weeks, the same action as the chevrons above it. */
  onPrevWeek?: () => void;
  onNextWeek?: () => void;
}

/** How far the finger must travel before a swipe commits to a week change. */
const SWIPE_DISTANCE = 48;
/** ...or how fast, so a short flick still counts. */
const SWIPE_VELOCITY = 450;
/** Long enough to read as motion, short enough not to feel like waiting. */
const SETTLE_MS = 170;

interface WeekStripProps {
  agenda: DayAgenda[];
  selectedDayIndex?: number;
  onSelectDay?: (index: number, dayName: string) => void;
}

/**
 * One week of seven day chips.
 *
 * Split out because the bar renders three of these at once — the current week
 * plus its neighbours — so a swipe has somewhere to go. Only the middle one
 * takes taps; the neighbours are there to be looked at while they slide past.
 */
function WeekStrip({ agenda, selectedDayIndex, onSelectDay }: WeekStripProps) {
  const theme = useTheme();
  // One palette for every screen; see utils/disciplineConfig.
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const getSportIcon = (type: SportType | string) => getDisciplineConfig(String(type), scheme);

  return (
    <View className="flex-row gap-1.5">
      {agenda.map((day, idx) => {
        const isSelected = selectedDayIndex === idx;
        const isToday = day.isToday;
        const totalRooka = Math.round(day.workouts.reduce((acc, w) => acc + (w.rookaPoints || 0), 0));
        const hasWorkouts = day.workouts.length > 0;

        /* One icon per DISTINCT sport. Two bike sessions on a Saturday said
           "bike, bike", which is noise -- what the strip is scanned for is
           which sports a day contains, not how many entries it has. */
        const sports = Array.from(
          new Set(day.workouts.map((w) => String(w.type).toUpperCase())),
        );
        const shownSports = sports.slice(0, 4);
        /* A day column is ~33pt wide inside its padding, which fits two 14px
           icons and no more -- three across overflows however small you make
           them, and by the time they fit they are illegible. So a third sport
           wraps onto a second row instead, which the cell has room for. */
        const sportIconSize = shownSports.length > 1 ? 14 : 16;

        return (
          <TouchableOpacity
            key={`${day.dayName}-${day.dateStr}`}
            disabled={!onSelectDay}
            onPress={() => {
              Haptics.selectionAsync();
              onSelectDay?.(idx, day.dayName);
            }}
            activeOpacity={0.8}
            className="flex-1 rounded-xl overflow-hidden bg-theme-bg"
          >
            <View
              className={`py-1 items-center justify-center ${
                isToday ? 'bg-theme-accent' : isSelected ? 'bg-theme-text' : 'bg-theme-muted/25'
              }`}
            >
              <Text
                className={`text-xs font-extrabold ${
                  isToday || isSelected ? 'text-white' : 'text-theme-muted'
                }`}
              >
                {day.dayName}
              </Text>
            </View>

            <View className="p-1 items-center justify-between min-h-[66px] bg-theme-bg">
              {/* Across, not down. Stacked vertically, a swim+bike+run day
                  needed 84px of icons in a 66px box and overlapped the day
                  header above it. */}
              <View className="flex-row flex-wrap items-center justify-center gap-0.5 my-1 flex-1">
                {hasWorkouts ? (
                  <>
                    {shownSports.map((sport) => {
                      const cfg = getSportIcon(sport);
                      return (
                        /* The icon sat in its own rounded box inside the day
                           chip inside the week card — three nested surfaces to
                           show one glyph. The glyph alone reads better. */
                        <Ionicons
                          key={sport}
                          name={cfg.icon as any}
                          size={sportIconSize}
                          color={cfg.color}
                        />
                      );
                    })}
                    {sports.length > shownSports.length && (
                      <Text className="text-[9px] font-mono font-extrabold text-theme-muted">
                        +{sports.length - shownSports.length}
                      </Text>
                    )}
                  </>
                ) : (
                  <Ionicons name="moon-outline" size={16} color={getSportIcon('REST').color} />
                )}
              </View>

              {/* rooka points or Completion Check */}
              <View className="items-center justify-center pt-1 pb-1 border border-theme-border/40 w-full h-[24px]">
                {hasWorkouts && day.workouts.every((w) => w.isCompleted) ? (
                  <Ionicons name="checkmark-circle" size={12} color="#10B981" />
                ) : totalRooka > 0 ? (
                  <View className="flex-row items-center justify-center gap-0.5">
                    <Text className="text-[10px] font-mono font-extrabold text-theme-accent font-rajdhani">
                      {totalRooka}
                    </Text>
                    <RookaMark size={12} color={theme.tint} />
                  </View>
                ) : (
                  <Text className="text-[10px] font-mono font-extrabold text-theme-accent">
                    Rest
                  </Text>
                )}
              </View>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function SideBySideWeekBar({
  agenda,
  selectedDayIndex,
  onSelectDay,
  prevAgenda,
  nextAgenda,
  onPrevWeek,
  onNextWeek,
}: SideBySideWeekBarProps) {
  const [width, setWidth] = useState(0);
  /* The neighbouring weeks only exist while a finger is down. At rest this
     screen renders seven day chips; mounted permanently it rendered twenty-one
     plus their icons, three times the views for two weeks nobody can see. */
  const [dragging, setDragging] = useState(false);
  const translateX = useSharedValue(0);
  /* onFinalize fires straight after onEnd, before the settle animation has
     run. Without this flag it would tear the neighbours out from under the
     very animation that is sliding one of them into place. */
  const settling = useSharedValue(false);
  /* The gesture runs on the UI thread, where React state is a stale snapshot
     captured when the worklet was built. Mirroring the measured width into a
     shared value means the swipe always animates against the current one. */
  const widthSV = useSharedValue(0);

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const next = e.nativeEvent.layout.width;
      widthSV.value = next;
      setWidth(next);
    },
    [widthSV],
  );

  /*
   * Hand the week change to the parent and drop the strip back to centre in the
   * same tick.
   *
   * The reset is invisible by construction rather than by timing: the slots are
   * always [week-1, week, week+1]. After a forward swipe the view sits on slot 3
   * (week+1); once the parent advances, slot 2 IS week+1. Same content, so
   * snapping the offset back to zero shows the identical strip.
   */
  const commitWeek = useCallback(
    (direction: 1 | -1) => {
      translateX.value = 0;
      setDragging(false);
      // handlePrevWeek / handleNextWeek fire their own haptic.
      (direction === 1 ? onNextWeek : onPrevWeek)?.();
    },
    [onNextWeek, onPrevWeek, translateX],
  );

  /*
   * `activeOffsetX` is what keeps the day buttons tappable: the pan only takes
   * over after 20px of horizontal travel, so a tap is still a tap. `failOffsetY`
   * hands the gesture back the moment the finger goes vertical, so the day list
   * below still scrolls when a drag starts on the strip.
   */
  const weekSwipe = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-18, 18])
    /* Touch-down, not activation. The pan needs 20px before it takes over, so
       mounting here gives the neighbours a head start of a whole gesture's
       worth of frames before either could become visible. */
    .onBegin(() => {
      runOnJS(setDragging)(true);
    })
    .onUpdate((e) => {
      translateX.value = e.translationX;
    })
    .onEnd((e) => {
      const committed =
        Math.abs(e.translationX) > SWIPE_DISTANCE || Math.abs(e.velocityX) > SWIPE_VELOCITY;
      // Drag left = forward in time, the direction the content travels.
      const direction: 1 | -1 = e.translationX < 0 ? 1 : -1;

      if (committed && widthSV.value > 0) {
        // Carry the strip the rest of the way, then swap the week underneath.
        const target = -direction * widthSV.value;
        settling.value = true;
        translateX.value = withTiming(target, { duration: SETTLE_MS }, (finished) => {
          settling.value = false;
          if (finished) runOnJS(commitWeek)(direction);
          else runOnJS(setDragging)(false);
        });
      } else {
        // Not far enough — spring back so a half-swipe reads as "no".
        settling.value = true;
        translateX.value = withSpring(0, { damping: 20, stiffness: 220 }, () => {
          settling.value = false;
          runOnJS(setDragging)(false);
        });
      }
    })
    /* Always fires — including for a tap, which never reaches onEnd. Without
       it a tap would mount the neighbours and leave them there. */
    .onFinalize(() => {
      if (!settling.value) runOnJS(setDragging)(false);
    });

  const trackStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const canSlide = width > 0 && !!prevAgenda && !!nextAgenda;
  const showNeighbours = canSlide && dragging;

  return (
    <GestureDetector gesture={weekSwipe}>
      {/* overflow-hidden is what stops the neighbouring weeks showing at rest. */}
      <View className="overflow-hidden" onLayout={onLayout}>
        {canSlide ? (
          <Animated.View
            style={[
              { flexDirection: 'row', width: width * 3, marginLeft: -width },
              trackStyle,
            ]}
          >
            {/* Empty at rest; the slot keeps its width so the track geometry
                never changes and translateX stays meaningful. */}
            <View style={{ width }}>
              {showNeighbours ? <WeekStrip agenda={prevAgenda!} /> : null}
            </View>
            <View style={{ width }}>
              <WeekStrip
                agenda={agenda}
                selectedDayIndex={selectedDayIndex}
                onSelectDay={onSelectDay}
              />
            </View>
            <View style={{ width }}>
              {showNeighbours ? <WeekStrip agenda={nextAgenda!} /> : null}
            </View>
          </Animated.View>
        ) : (
          // First paint, before onLayout has a width to work with.
          <WeekStrip
            agenda={agenda}
            selectedDayIndex={selectedDayIndex}
            onSelectDay={onSelectDay}
          />
        )}
      </View>
    </GestureDetector>
  );
}
