import React from 'react';
import { View } from 'react-native';
import { CoachPersonaSettings } from '../CoachPersonaSettings';
import { BenchmarkSessionsCard } from './BenchmarkSessionsCard';
import { GoalsTab } from './GoalsTab';

export const CoachTab: React.FC = () => {
  return (
    <View className="gap-y-2 pb-6">
      {/* COACH PERSONA & STYLE SETTINGS */}
      <CoachPersonaSettings />

      {/* BENCHMARK SESSIONS & ASSESSMENTS */}
      <BenchmarkSessionsCard />

      {/* ATHLETE GOALS & SEASON CALENDAR */}
      <GoalsTab />
    </View>
  );
};

