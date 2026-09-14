import { BrandColors } from '@/constants/theme';
import { RookaMark } from '../ui/RookaPoints';
import React from 'react';
import { useTheme } from '@/hooks/use-theme';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SubscriptionTier } from '../../types/user';
import { Sparkline } from '../common/Sparkline';
import { useLanguage } from '../../context/LanguageContext';

interface PMCMetricsProps {
  ctl?: number;
  atl?: number;
  tsb?: number;
  readinessScore?: number;
  weightKg?: number;
  ctlDelta?: number;
  atlDelta?: number;
  ctlHistory?: number[];
  atlHistory?: number[];
  tsbHistory?: number[];
  weightHistory?: number[];
  tier?: SubscriptionTier;
}

export const PMCMetricsCard: React.FC<PMCMetricsProps> = ({
  ctl = 0,
  atl = 0,
  tsb = 0,
  readinessScore,
  weightKg = 0,
  ctlDelta = 0,
  atlDelta = 0,
  ctlHistory = [],
  atlHistory = [],
  tsbHistory = [],
  weightHistory = [],
  tier = 'free',
}) => {
    const theme = useTheme();
  const { t } = useLanguage();

  // With no sessions logged, CTL/ATL/TSB are all zero and every derived label
  // below is a statement about nothing. Track that explicitly so the card can
  // say "no data" instead of asserting a training state.
  // Check for a non-zero *value*, not merely a non-empty series: the PMC
  // helpers return a full 42-day window padded with zeros, so a length check
  // is true even when nothing has ever been logged.
  const hasAnyValue = (series: number[]) => series.some((n) => Number(n) > 0);
  const hasTrainingData = ctl > 0 || atl > 0 || hasAnyValue(ctlHistory) || hasAnyValue(atlHistory);
  const hasWeightData = weightKg > 0 || hasAnyValue(weightHistory);

  // Calculate Readiness score if not provided directly
  const computedReadiness = readinessScore !== undefined 
    ? readinessScore 
    : Math.max(0, Math.min(100, Math.round(50 + Math.max(-20, Math.min(20, tsb * 0.5)))));

  let readinessBadge = { text: t('dashboard.optimalBuilding'), color: 'text-semantic-success', bg: 'bg-semantic-success/10', border: '' };
  if (computedReadiness < 40 || tsb < -30) {
    readinessBadge = { text: t('dashboard.highFatigueRest'), color: 'text-semantic-error', bg: 'bg-semantic-error/10', border: '' };
  } else if (computedReadiness < 65 || tsb < -10) {
    readinessBadge = { text: t('dashboard.productiveBuild'), color: 'text-theme-accent', bg: 'bg-theme-accent/10', border: '' };
  } else if (tsb > 10) {
    readinessBadge = { text: t('dashboard.raceReadyFresh'), color: 'text-semantic-success', bg: 'bg-semantic-success/10', border: '' };
  }

  return (
    <View className="mb-4">
      {/* Metric Section Header */}
      <View className="flex-row items-center justify-between mb-3 px-1">
        <View className="flex-row items-center gap-x-2">
          <Ionicons name="pulse-outline" size={18} color={theme.tint} />
          <Text className="text-xs font-bold text-theme-text">
            {t('dashboard.performanceManagement')}
          </Text>
        </View>
        {tier === 'rooka_plus' && (
          <View className="bg-theme-accent/15 px-2 py-0.5 rounded-full flex-row items-center gap-x-1">
            <RookaMark size={12} color={theme.tint} />
            <Text className="text-xs text-theme-accent font-bold font-rajdhani">rooka+ AI</Text>
          </View>
        )}
      </View>

      {/* 4 Grid Metric Cards with Sparklines */}
      <View className="flex-row flex-wrap gap-2.5">
        {/* CTL Card */}
        <View className="flex-1 min-w-[45%] bg-theme-card rounded-tile p-3.5 shadow-sm">
          <View className="flex-row justify-between items-start mb-1">
            <Text className="text-xs font-bold text-theme-muted">
              {t('dashboard.fitness')}
            </Text>
            {/* A "+0.0" under an up-arrow is decoration dressed as a
                measurement. Show a delta only when one actually exists. */}
            {Math.abs(ctlDelta) >= 0.05 && (
              <View className={`flex-row items-center px-1.5 py-0.5 rounded-md ${ctlDelta > 0 ? 'bg-semantic-success/10' : 'bg-slate-500/10'}`}>
                <Ionicons name={ctlDelta > 0 ? 'arrow-up' : 'arrow-down'} size={10} color={ctlDelta > 0 ? '#10b981' : '#64748b'} />
                <Text className={`text-xs font-bold ml-0.5 ${ctlDelta > 0 ? 'text-semantic-success' : 'text-theme-muted'}`}>
                  {ctlDelta > 0 ? '+' : ''}{ctlDelta.toFixed(1)}
                </Text>
              </View>
            )}
          </View>
          <Text className="text-2xl font-extrabold text-theme-text font-barlow tracking-tight mb-2">
            {ctl.toFixed(1)}
          </Text>

          {/* Sparkline Graph */}
          <Sparkline
            data={ctlHistory}
            color="#10b981"
            gradientFrom="#10b98144"
            gradientTo="#10b98100"
            height={32}
            width={120}
          />
          <Text className="text-xs text-theme-muted mt-1">{t('dashboard.chronicLoad')}</Text>
        </View>

        {/* ATL Card */}
        <View className="flex-1 min-w-[45%] bg-theme-card rounded-tile p-3.5 shadow-sm">
          <View className="flex-row justify-between items-start mb-1">
            <Text className="text-xs font-bold text-theme-muted">
              {t('dashboard.fatigue')}
            </Text>
            {Math.abs(atlDelta) >= 0.05 && (
              <View className={`flex-row items-center px-1.5 py-0.5 rounded-md ${atlDelta > 0 ? 'bg-theme-accent/10' : 'bg-slate-500/10'}`}>
                <Ionicons name={atlDelta > 0 ? 'arrow-up' : 'arrow-down'} size={10} color={atlDelta > 0 ? '#f59e0b' : '#64748b'} />
                <Text className={`text-xs font-bold ml-0.5 ${atlDelta > 0 ? 'text-theme-accent' : 'text-theme-muted'}`}>
                  {atlDelta > 0 ? '+' : ''}{atlDelta.toFixed(1)}
                </Text>
              </View>
            )}
          </View>
          <Text className="text-2xl font-extrabold text-theme-text font-barlow tracking-tight mb-2">
            {atl.toFixed(1)}
          </Text>

          {/* Sparkline Graph */}
          <Sparkline
            data={atlHistory}
            color="#f59e0b"
            gradientFrom="#f59e0b44"
            gradientTo="#f59e0b00"
            height={32}
            width={120}
          />
          <Text className="text-xs text-theme-muted mt-1">{t('dashboard.acuteLoad')}</Text>
        </View>

        {/* Readiness (TSB) Card */}
        <View className="flex-1 min-w-[45%] bg-theme-card rounded-tile p-3.5 shadow-sm">
          <View className="flex-row justify-between items-start mb-1">
            <Text className="text-xs font-bold text-theme-muted flex-1 mr-1.5" numberOfLines={1}>
              {t('dashboard.readiness')}
            </Text>
            {/* Label and chip previously overlapped: both were unconstrained in
                one row, and the chip repeated "TSB" already in the label. */}
            {hasTrainingData && (
              <Text className={`text-xs font-bold shrink-0 ${tsb >= 0 ? 'text-semantic-success' : 'text-theme-accent'}`}>
                TSB {tsb > 0 ? `+${tsb.toFixed(1)}` : tsb.toFixed(1)}
              </Text>
            )}
          </View>
          <Text className={`text-2xl font-extrabold font-barlow tracking-tight mb-2 ${hasTrainingData ? readinessBadge.color : 'text-theme-muted'}`}>
            {hasTrainingData ? computedReadiness : '--'}
            <Text className="text-xs text-theme-muted">/100</Text>
          </Text>

          {/* Sparkline Graph */}
          <Sparkline
            data={tsbHistory}
            color={tsb >= 0 ? '#10b981' : '#3b82f6'}
            gradientFrom={tsb >= 0 ? '#10b98144' : '#3b82f644'}
            gradientTo="#3b82f600"
            height={32}
            width={120}
          />
          {/* "Productive Build" over zero activities reads as a verdict the
              app has not earned. */}
          <View className={`self-start mt-1.5 px-2 py-0.5 rounded-full ${hasTrainingData ? readinessBadge.bg : 'bg-slate-500/10'}`}>
            <Text className={`text-xs font-bold ${hasTrainingData ? readinessBadge.color : 'text-theme-muted'}`}>
              {hasTrainingData ? readinessBadge.text : t('dashboard.noDataYet')}
            </Text>
          </View>
        </View>

        {/* Body Weight Trend Card */}
        <View className="flex-1 min-w-[45%] bg-theme-card rounded-tile p-3.5 shadow-sm">
          <View className="flex-row justify-between items-start mb-1">
            <Text className="text-xs font-bold text-theme-muted">
              {t('physique.weightInput')}
            </Text>
            <Ionicons name="scale-outline" size={12} color={theme.tint} />
          </View>
          <Text className="text-2xl font-extrabold text-theme-text font-barlow tracking-tight mb-2">
            {weightKg > 0 ? `${weightKg.toFixed(1)} ` : '-- '}
            <Text className="text-xs text-theme-muted font-normal">kg</Text>
          </Text>

          {/* Sparkline Graph */}
          {hasWeightData ? (
            <>
              <Sparkline
                data={weightHistory}
                color={theme.tint}
                gradientFrom={`${BrandColors.primary}44`}
                gradientTo={`${BrandColors.primary}00`}
                height={32}
                width={120}
              />
              <Text className="text-xs text-theme-muted mt-1">{t('dashboard.emaTrendline')}</Text>
            </>
          ) : (
            <View style={{ height: 32 }} className="justify-center">
              <Text className="text-xs text-theme-muted">{t('dashboard.logWeightPrompt')}</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
};
