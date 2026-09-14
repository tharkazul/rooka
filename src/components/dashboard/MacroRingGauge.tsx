import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

interface MacroRingGaugeProps {
  label: 'Protein' | 'Carbs' | 'Fat';
  target: number;
  logged: number;
  size?: number;
}

const CONFIG = {
  Protein: {
    trackColor: 'rgba(168, 85, 247, 0.20)', // purple-500
    progressColor: '#A855F7',
    textColor: '#A855F7',
    bgSoft: 'rgba(168, 85, 247, 0.12)',
  },
  Carbs: {
    trackColor: 'rgba(14, 165, 233, 0.20)', // sky-500 (theme blue)
    progressColor: '#0EA5E9',
    textColor: '#0EA5E9',
    bgSoft: 'rgba(14, 165, 233, 0.12)',
  },
  Fat: {
    trackColor: 'rgba(248, 113, 113, 0.20)', // red-400
    progressColor: '#F87171',
    textColor: '#F87171',
    bgSoft: 'rgba(248, 113, 113, 0.12)',
  },
};

export function MacroRingGauge({ label, target, logged, size = 96 }: MacroRingGaugeProps) {
  const cfg = CONFIG[label];
  const strokeWidth = Math.max(6, Math.floor(size * 0.11));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const hasData = logged > 0;
  const rawPct = target > 0 ? (logged / target) * 100 : 0;
  const actualPct = Math.round(rawPct);
  const clampedPct = Math.min(100, Math.max(0, actualPct));
  const strokeDashoffset = circumference - (circumference * clampedPct) / 100;

  // Percentage color styling for high/overflow intake
  let pctColor = cfg.textColor;
  if (actualPct >= 120) {
    pctColor = '#F87171'; // rose-400
  } else if (actualPct > 100) {
    pctColor = '#FBBF24'; // amber-400
  }

  const isSmall = size < 80;

  return (
    <View className="items-center justify-center relative">
      <View style={{ width: size, height: size }} className="items-center justify-center relative">
        <Svg width={size} height={size}>
          <G rotation="-90" origin={`${size / 2}, ${size / 2}`}>
            {/* Background Track Ring */}
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={cfg.trackColor}
              strokeWidth={strokeWidth}
              fill="transparent"
            />

            {/* Active Filled Progress Arc */}
            {hasData && (
              <Circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke={cfg.progressColor}
                strokeWidth={strokeWidth}
                strokeDasharray={`${circumference} ${circumference}`}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                fill="transparent"
              />
            )}
          </G>
        </Svg>

        {/* Center Content */}
        <View className="absolute inset-0 items-center justify-center p-1">
          <Text className={`${isSmall ? 'text-xs' : 'text-xs'} font-bold text-theme-text text-center`}>
            {label}
          </Text>

          {hasData ? (
            <>
              <Text
                style={{ color: pctColor }}
                className={`${isSmall ? 'text-xs my-0.5' : 'text-sm my-0.5'} font-extrabold font-mono text-center`}
                numberOfLines={1}
              >
                {actualPct}%
              </Text>
              <Text className={`${isSmall ? 'text-xs' : 'text-xs'} font-semibold font-mono text-theme-muted text-center`}>
                {logged}g / {target}g
              </Text>
            </>
          ) : (
            <Text className={`${isSmall ? 'text-xs mt-0.5' : 'text-xs mt-0.5'} font-semibold font-mono text-theme-muted text-center`}>
              {target}g
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}
