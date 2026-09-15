import { BrandColors } from '@/constants/theme';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { useColorScheme } from 'nativewind';
import * as Haptics from 'expo-haptics';

/**
 * A horizontal snap roller for coarse durations.
 *
 * Typing a duration invites false precision — an athlete stalls over whether
 * they have 50 or 51 minutes free. Snapping to 15-minute steps makes the
 * answer a flick rather than a decision, and removes the keyboard entirely.
 *
 * The scroll position is deliberately *uncontrolled*. Driving it from the
 * `value` prop meant every reported change re-applied `contentOffset` mid-
 * gesture and fought the finger, so the roller drifted instead of tracking
 * the swipe. It is positioned once on mount and left alone after that.
 */

const ITEM_WIDTH = 52;
const VISIBLE_ITEMS = 3; // one either side of the selection

export const DEFAULT_DURATIONS = [0, 15, 30, 45, 60, 75, 90, 105, 120, 150, 180];

interface DurationRollerProps {
  value: number;
  onChange: (minutes: number) => void;
  options?: number[];
  disabled?: boolean;
  /** Rendered to the right of the roller, e.g. "minutes". */
  unitLabel?: string;
}

export function DurationRoller({
  value,
  onChange,
  options = DEFAULT_DURATIONS,
  disabled = false,
  unitLabel,
}: DurationRollerProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const scrollRef = useRef<ScrollView>(null);
  const hasPositioned = useRef(false);
  const lastReported = useRef<number>(value);

  const indexOfValue = useCallback(
    (v: number) => {
      const exact = options.indexOf(v);
      if (exact !== -1) return exact;
      let nearest = 0;
      options.forEach((opt, i) => {
        if (Math.abs(opt - v) < Math.abs(options[nearest] - v)) nearest = i;
      });
      return nearest;
    },
    [options]
  );

  // Styling follows the scroll so the highlight tracks the finger.
  const [displayIndex, setDisplayIndex] = useState(() => indexOfValue(value));

  // Colours are set explicitly rather than through utility classes: these sit
  // on a surface that flips with the theme, and an unresolved text colour here
  // renders invisible.
  const selectedColor = BrandColors.primary;
  const idleColor = isDark ? '#64748B' : '#94A3B8';
  const trackColor = isDark ? 'rgba(14, 165, 233,0.12)' : 'rgba(14, 165, 233,0.08)';
  const trackBorder = 'rgba(14, 165, 233,0.45)';

  const clampIndex = useCallback(
    (i: number) => Math.max(0, Math.min(options.length - 1, i)),
    [options.length]
  );

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const i = clampIndex(Math.round(e.nativeEvent.contentOffset.x / ITEM_WIDTH));
      setDisplayIndex((prev) => (prev === i ? prev : i));
    },
    [clampIndex]
  );

  const settle = useCallback(
    (offsetX: number) => {
      const next = options[clampIndex(Math.round(offsetX / ITEM_WIDTH))];
      if (next === lastReported.current) return;
      lastReported.current = next;
      try {
        Haptics.selectionAsync();
      } catch (_) {}
      onChange(next);
    },
    [clampIndex, onChange, options]
  );

  // Tapping a neighbouring number is often quicker than flicking to it, so the
  // roller accepts both: the tap scrolls the strip to that slot and selects it.
  const selectIndex = useCallback(
    (i: number) => {
      if (disabled) return;
      const clamped = clampIndex(i);
      scrollRef.current?.scrollTo({ x: clamped * ITEM_WIDTH, y: 0, animated: true });
      setDisplayIndex(clamped);
      settle(clamped * ITEM_WIDTH);
    },
    [clampIndex, disabled, settle]
  );

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => settle(e.nativeEvent.contentOffset.x),
    [settle]
  );

  // A drag released without flick produces no momentum event, so settle here
  // when the finger let go with effectively no velocity.
  const onDragEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const vx = e.nativeEvent.velocity?.x ?? 0;
      if (Math.abs(vx) < 0.05) settle(e.nativeEvent.contentOffset.x);
    },
    [settle]
  );

  const initialOffset = useMemo(() => indexOfValue(value) * ITEM_WIDTH, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View className="flex-row items-center gap-2">
      <View style={{ width: ITEM_WIDTH * VISIBLE_ITEMS, height: 38 }}>
        {/* Fixed centre well marking the selected slot. */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: ITEM_WIDTH,
            width: ITEM_WIDTH,
            top: 0,
            bottom: 0,
            borderRadius: 9,
            borderWidth: 1,
            borderColor: trackBorder,
            backgroundColor: trackColor,
          }}
        />

        <ScrollView
          ref={scrollRef}
          horizontal
          scrollEnabled={!disabled}
          showsHorizontalScrollIndicator={false}
          snapToInterval={ITEM_WIDTH}
          decelerationRate="fast"
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingHorizontal: ITEM_WIDTH }}
          onLayout={() => {
            if (hasPositioned.current) return;
            hasPositioned.current = true;
            scrollRef.current?.scrollTo({ x: initialOffset, y: 0, animated: false });
          }}
          onScroll={handleScroll}
          onMomentumScrollEnd={onMomentumEnd}
          onScrollEndDrag={onDragEnd}
        >
          {options.map((opt, i) => {
            const isSelected = i === displayIndex;
            return (
              <Pressable
                key={opt}
                onPress={() => selectIndex(i)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={`${opt}${unitLabel ? ` ${unitLabel}` : ''}`}
                accessibilityState={{ selected: isSelected }}
                style={{ width: ITEM_WIDTH, height: 38 }}
                className="items-center justify-center"
              >
                <Text
                  style={{
                    color: isSelected ? selectedColor : idleColor,
                    fontSize: isSelected ? 17 : 14,
                  }}
                  className="font-extrabold"
                >
                  {opt}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {unitLabel ? (
        <Text style={{ color: idleColor }} className="text-sm font-medium">
          {unitLabel}
        </Text>
      ) : null}
    </View>
  );
}
