import React from 'react';
import { useTheme } from '@/hooks/use-theme';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NutritionMacro } from '../../types/dashboard';
import { NutritionProtocol } from '../../types/physique';
import { MacroRingGauge } from './MacroRingGauge';
import { usePhysique } from '../../context/PhysiqueStore';

interface NutritionProtocolCardProps {
  nutrition: NutritionMacro | NutritionProtocol | any;
}

export function NutritionProtocolCard({ nutrition }: NutritionProtocolCardProps) {
    const theme = useTheme();
  const { clearLoggedNutrition } = usePhysique();

  const handleClearLoggedFood = async () => {
    try {
      await clearLoggedNutrition();
    } catch (err) {
      console.error('Failed to clear logged nutrition:', err);
    }
  };

  const rawItems = nutrition.loggedItems;
  const loggedItems: any[] = Array.isArray(rawItems)
    ? rawItems
    : typeof rawItems === 'string'
      ? rawItems
          .split(',')
          .map((s) => s.trim().replace(/^(and\s+a\s+|and\s+|also\s+had\s+|besides\s+that\s+)/i, '').trim())
          .filter(Boolean)
      : [];
  const hasLoggedFood = (nutrition.loggedCarbs || 0) > 0 || (nutrition.loggedProtein || 0) > 0 || (nutrition.loggedFat || 0) > 0;

  return (
    <View className="mb-4 rounded-card bg-theme-card border border-theme-border shadow-sm overflow-hidden">
      {/* Header Bar matching Quest Card header design */}
      <View className="px-4 py-3 flex-row justify-between items-center bg-theme-bg/50 border-b border-theme-border/30">
        <View className="flex-row items-center gap-2.5">
          <View className="w-8 h-8 rounded-xl bg-theme-accent/15 items-center justify-center">
            <Ionicons name="restaurant-outline" size={16} color={theme.tint} />
          </View>
          <View>
            <Text className="text-sm font-extrabold text-theme-text">Today's Fueling Plan</Text>
            <Text className="text-xs text-theme-muted font-bold">Macro Fueling & Meal Targets</Text>
          </View>
        </View>

        {hasLoggedFood && (
          <TouchableOpacity
            onPress={handleClearLoggedFood}
            className="flex-row items-center gap-1 bg-theme-card px-3 py-1.5 rounded-full border border-theme-border"
          >
            <Ionicons name="refresh-outline" size={12} color={theme.textSecondary} />
            <Text className="text-xs font-bold text-theme-muted">Reset Today</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Main Content Area matching Quest Card inner box styling */}
      <View className="p-3.5">
        <View className="p-4 bg-theme-bg/60 rounded-2xl border border-theme-border/40">
          {/* Rationale Banner */}
          <View className="p-3.5 bg-theme-accent/10 dark:bg-theme-accent/15 rounded-xl mb-4 border border-theme-accent/20">
            <Text className="text-xs font-extrabold text-theme-accent mb-1">{nutrition.focusTitle}</Text>
            <Text className="text-xs text-theme-text font-medium leading-relaxed">{nutrition.rationale}</Text>
          </View>

          {/* 3 Macro Rings Row (Carbs, Protein, Fat) */}
          <View className="flex-row items-center justify-around py-2">
            {/* Carbohydrates Ring */}
            <MacroRingGauge
              label="Carbs"
              target={nutrition.carbsTarget}
              logged={nutrition.loggedCarbs || 0}
            />

            {/* Protein Ring */}
            <MacroRingGauge
              label="Protein"
              target={nutrition.proteinTarget}
              logged={nutrition.loggedProtein || 0}
            />

            {/* Fat Ring */}
            <MacroRingGauge
              label="Fat"
              target={nutrition.fatTarget}
              logged={nutrition.loggedFat || 0}
            />
          </View>

          {/* Logged Meal Items List */}
          {loggedItems.length > 0 && (
            <View className="mt-4 pt-3 border border-theme-border/30">
              <Text className="text-xs font-extrabold text-theme-text mb-2">Logged Foods Today</Text>
              <View className="gap-y-1.5">
                {loggedItems.map((item: any, idx: number) => (
                  <View
                    key={`${item.name || item}-${idx}`}
                    className="flex-row items-center justify-between p-2.5 bg-theme-card rounded-tile border border-theme-border/40"
                  >
                    <Text className="text-xs font-bold text-theme-text">{typeof item === 'string' ? item : item.name}</Text>
                    {typeof item !== 'string' && item.calories && (
                      <Text className="text-xs font-mono font-bold text-theme-accent">{item.calories} kcal</Text>
                    )}
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
