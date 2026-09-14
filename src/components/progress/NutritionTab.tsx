import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useLanguage } from '../../context/LanguageContext';
import { usePhysique } from '../../context/PhysiqueStore';
import { usePlan } from '../../context/PlanStore';
import { NutritionProtocol } from '../../types/physique';
import { NutritionProtocolCard } from '../dashboard/NutritionProtocolCard';
import { Card } from '../ui/Card';

import { useRouter } from 'expo-router';
import { useUser } from '../../context/UserStore';

interface TimingCardItem {
  phase: string;
  detail: string;
  iconName: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  bgClass: string;
  borderClass: string;
}

function resolveFuelingItems(
  nutrition: NutritionProtocol,
  todayWorkouts: any[] = [],
  tintColor: string
): TimingCardItem[] {
  // If backend provided custom timing items, map them directly
  if (nutrition.timing && Array.isArray(nutrition.timing) && nutrition.timing.length > 0) {
    return nutrition.timing.map((item, idx) => {
      const type = (item.type || (idx === 0 ? 'morning' : idx === 1 ? 'midday' : 'evening')).toLowerCase();

      if (type === 'pre' || type === 'morning' || type === 'time') {
        return {
          phase: item.phase,
          detail: item.detail,
          iconName: 'time-outline',
          iconColor: tintColor,
          bgClass: 'bg-theme-accent/20',
          borderClass: 'border-theme-accent/30',
        };
      }
      if (type === 'intra' || type === 'midday' || type === 'hydration' || type === 'flash') {
        return {
          phase: item.phase,
          detail: item.detail,
          iconName: 'flash-outline',
          iconColor: '#F9CF45',
          bgClass: 'bg-semantic-warning/15',
          borderClass: 'border-semantic-warning/30',
        };
      }
      return {
        phase: item.phase,
        detail: item.detail,
        iconName: 'fitness-outline',
        iconColor: '#34C759',
        bgClass: 'bg-theme-accent/15',
        borderClass: 'border-theme-accent/30',
      };
    });
  }

  // Fallback intelligent deduction matching the user's current plan & protocol
  const combinedContext = `${nutrition.focusTitle || ''} ${nutrition.rationale || ''}`.toLowerCase();

  const isRestOrCarbLoad =
    /rest|carb-?load|race eve|pre-?race|taper|recovery day|ironman|marathon|recovery protocol/i.test(
      combinedContext
    ) ||
    (todayWorkouts.length > 0 &&
      todayWorkouts.every((w) => w.type === 'REST' || !w.type || String(w.sport).toUpperCase() === 'REST'));

  if (isRestOrCarbLoad) {
    return [
      {
        phase: 'Morning Glycogen Primer',
        detail:
          'Low-fiber, easily digestible carbs (white rice, oatmeal, banana, honey) + 25–30g lean protein to start saturating muscle glycogen without GI bulk.',
        iconName: 'sunny-outline',
        iconColor: tintColor,
        bgClass: 'bg-theme-accent/20',
        borderClass: 'border-theme-accent/30',
      },
      {
        phase: 'Midday Grazing & Electrolytes',
        detail:
          'Consistent light carb snacking (rice cakes, pretzels, sports drink 500–750ml). Keep fats low to speed gastric emptying.',
        iconName: 'water-outline',
        iconColor: '#F9CF45',
        bgClass: 'bg-semantic-warning/15',
        borderClass: 'border-semantic-warning/30',
      },
      {
        phase: 'Evening Digestible Carb Dinner',
        detail:
          'Simple carb base (pasta or jasmine rice) with 30–35g lean protein (chicken/fish). Keep fiber and fats minimal for optimal overnight digestion.',
        iconName: 'moon-outline',
        iconColor: '#34C759',
        bgClass: 'bg-theme-accent/15',
        borderClass: 'border-theme-accent/30',
      },
    ];
  }

  const isBike =
    /bike|cycl|ride/i.test(combinedContext) ||
    todayWorkouts.some((w) => w.type === 'BIKE' || String(w.sport).toUpperCase() === 'BIKE');
  if (isBike) {
    return [
      {
        phase: 'Pre-Ride Fueling (60–90 mins prior)',
        detail: '60–90g complex & simple carbs (oats, toast with jam, banana) + 400ml electrolyte fluid.',
        iconName: 'time-outline',
        iconColor: tintColor,
        bgClass: 'bg-theme-accent/20',
        borderClass: 'border-theme-accent/30',
      },
      {
        phase: 'Intra-Ride Fueling (On the Bike)',
        detail:
          '60–90g carbs/hr via liquid carb mix, energy gels, or chews. Sip electrolytes every 15–20 mins.',
        iconName: 'flash-outline',
        iconColor: '#F9CF45',
        bgClass: 'bg-semantic-warning/15',
        borderClass: 'border-semantic-warning/30',
      },
      {
        phase: 'Post-Ride Recovery (within 45 mins)',
        detail:
          '30–35g fast whey protein + 75–90g carbs to jumpstart muscle repair and glycogen replenishment.',
        iconName: 'fitness-outline',
        iconColor: '#34C759',
        bgClass: 'bg-theme-accent/15',
        borderClass: 'border-theme-accent/30',
      },
    ];
  }

  const isSwim =
    /swim/i.test(combinedContext) ||
    todayWorkouts.some((w) => w.type === 'SWIM' || String(w.sport).toUpperCase() === 'SWIM');
  if (isSwim) {
    return [
      {
        phase: 'Pre-Swim Fueling (45–60 mins prior)',
        detail:
          'Light, low-acid carbs (1 banana or applesauce + 250ml water), avoiding heavy foods that cause reflux.',
        iconName: 'time-outline',
        iconColor: tintColor,
        bgClass: 'bg-theme-accent/20',
        borderClass: 'border-theme-accent/30',
      },
      {
        phase: 'Poolside Hydration',
        detail:
          'Electrolyte sports bottle at the lane edge; sip between set intervals to maintain cellular hydration.',
        iconName: 'water-outline',
        iconColor: '#F9CF45',
        bgClass: 'bg-semantic-warning/15',
        borderClass: 'border-semantic-warning/30',
      },
      {
        phase: 'Post-Swim Refuel (within 45 mins)',
        detail: '30g protein + 50–65g carbs (recovery shake or balanced warm meal).',
        iconName: 'fitness-outline',
        iconColor: '#34C759',
        bgClass: 'bg-theme-accent/15',
        borderClass: 'border-theme-accent/30',
      },
    ];
  }

  const isStrength =
    /strength|gym|lift|mobility/i.test(combinedContext) ||
    todayWorkouts.some(
      (w) =>
        w.type === 'STRENGTH' ||
        w.type === 'MOBILITY' ||
        String(w.sport).toUpperCase() === 'STRENGTH' ||
        String(w.sport).toUpperCase() === 'MOBILITY'
    );
  if (isStrength) {
    return [
      {
        phase: 'Pre-Strength Primer (45 mins prior)',
        detail:
          '20g protein + 30–40g moderate carbs (e.g. Greek yogurt with berries or rice cake with nut butter).',
        iconName: 'time-outline',
        iconColor: tintColor,
        bgClass: 'bg-theme-accent/20',
        borderClass: 'border-theme-accent/30',
      },
      {
        phase: 'Intra-Workout Hydration',
        detail: 'Electrolyte water to maintain cellular hydration and muscular power output during working sets.',
        iconName: 'flash-outline',
        iconColor: '#F9CF45',
        bgClass: 'bg-semantic-warning/15',
        borderClass: 'border-semantic-warning/30',
      },
      {
        phase: 'Post-Strength Protein (within 60 mins)',
        detail:
          '35–40g high-leucine protein (whey/plant) + moderate carbs to maximize muscle protein synthesis.',
        iconName: 'fitness-outline',
        iconColor: '#34C759',
        bgClass: 'bg-theme-accent/15',
        borderClass: 'border-theme-accent/30',
      },
    ];
  }

  // Default: Run / Aerobic Training Session
  return [
    {
      phase: 'Pre-Run Fueling (60 mins prior)',
      detail: '45–60g fast-acting carbs (banana + oats or toast) + 300ml water.',
      iconName: 'time-outline',
      iconColor: tintColor,
      bgClass: 'bg-theme-accent/20',
      borderClass: 'border-theme-accent/30',
    },
    {
      phase: 'Intra-Run Fueling',
      detail: '30–60g carbs/hr electrolyte gel or hydrogel drink mix if running over 60 mins.',
      iconName: 'flash-outline',
      iconColor: '#F9CF45',
      bgClass: 'bg-semantic-warning/15',
      borderClass: 'border-semantic-warning/30',
    },
    {
      phase: 'Post-Run Recovery (within 45 mins)',
      detail: '30–35g whey protein isolate + 60–75g carbs to protect lean muscle and restore glycogen.',
      iconName: 'fitness-outline',
      iconColor: '#34C759',
      bgClass: 'bg-theme-accent/15',
      borderClass: 'border-theme-accent/30',
    },
  ];
}

export const NutritionTab: React.FC = () => {
  const theme = useTheme();
  const { t } = useLanguage();
  const { nutrition } = usePhysique();
  const { plan } = usePlan();
  const { user } = useUser();
  const router = useRouter();

  if (user?.subscription_tier === 'free') {
    return (
      <View className="bg-theme-card border border-theme-border rounded-card p-6 items-center justify-center mt-4 shadow-sm">
        <Ionicons name="lock-closed-outline" size={48} color={theme.tint} />
        <Text className="text-lg font-extrabold text-theme-text mt-4 text-center">Nutrition Locked</Text>
        <Text className="text-sm text-theme-muted mt-2 text-center leading-relaxed font-rajdhani">
          Upgrade to the rooka+ subscription to unlock daily AI nutrition protocols.
        </Text>
        <TouchableOpacity
          onPress={() => router.navigate({ pathname: '/profile', params: { subtab: 'account' } })}
          className="bg-theme-accent px-6 py-3 rounded-2xl w-full mt-6 shadow-sm shadow-theme-accent/30"
          activeOpacity={0.8}
        >
          <Text className="text-white font-black text-center font-rajdhani">Upgrade to rooka+</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const now = new Date();
  const todayDateStr = now.toISOString().split('T')[0];
  const todayDayName = now.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
  const todayWorkouts = (plan || []).filter(
    (w: any) =>
      w.date === todayDateStr ||
      w.dateStr?.toUpperCase().includes(todayDayName) ||
      w.day?.toUpperCase() === todayDayName
  );

  const fuelingItems = resolveFuelingItems(nutrition, todayWorkouts, theme.tint);

  return (
    <View className="gap-y-4">
      {/* DAILY AI NUTRITION PROTOCOL CARD */}
      <NutritionProtocolCard nutrition={nutrition} />

      {/* DYNAMIC FUELING STRATEGY & TIMING */}
      <Card className="mb-4 bg-theme-card border-theme-border">
        <Text className="text-xs font-bold text-theme-muted mb-3">
          {t('dashboard.fuelingSchedule')}
        </Text>

        <View className="gap-y-3">
          {fuelingItems.map((item, index) => (
            <View
              key={`${item.phase}-${index}`}
              className="flex-row items-center bg-theme-bg/60 border border-theme-border rounded-xl p-3 mb-2"
            >
              <View
                className={`w-10 h-10 rounded-full items-center justify-center mr-3 border ${item.bgClass} ${item.borderClass}`}
              >
                <Ionicons name={item.iconName} size={20} color={item.iconColor} />
              </View>
              <View className="flex-1">
                <Text className="text-xs font-bold text-theme-text">{item.phase}</Text>
                <Text className="text-xs text-theme-muted mt-0.5 leading-relaxed">{item.detail}</Text>
              </View>
            </View>
          ))}
        </View>
      </Card>

    </View>
  );
};
