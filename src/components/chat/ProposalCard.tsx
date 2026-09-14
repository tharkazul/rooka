import React from 'react';
import { useTheme } from '@/hooks/use-theme';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ProposedWorkoutItem } from '../../types/chat';

interface ProposalCardProps {
  plan: ProposedWorkoutItem[];
  status?: 'pending' | 'accepted' | 'rejected';
  onAccept: () => void;
  onReject: () => void;
}

export const ProposalCard: React.FC<ProposalCardProps> = ({
  plan,
  status = 'pending',
  onAccept,
  onReject,
}) => {
    const theme = useTheme();
  if (!plan || plan.length === 0) return null;

  const isAccepted = status === 'accepted';
  const isRejected = status === 'rejected';

  return (
    <View className="mt-3 p-4 rounded-tile bg-theme-card border border-theme-accent/40 shadow-sm">
      <View className="flex-row items-center mb-3">
        <View className="w-8 h-8 rounded-full bg-theme-accent/20 items-center justify-center mr-2">
          <Ionicons name="calendar-outline" size={18} color={theme.tint} />
        </View>
        <View className="flex-1">
          <Text className="text-theme-text font-bold text-sm font-rajdhani">rooka Workout Proposal</Text>
          <Text className="text-theme-muted text-xs">{plan.length} workout change{plan.length > 1 ? 's' : ''} suggested</Text>
        </View>
      </View>

      <View className="gap-2 mb-3">
        {plan.map((item, idx) => (
          <View key={`prop-item-${idx}`} className="p-2.5 rounded-lg bg-theme-bg/60 flex-row items-center justify-between">
            <View className="flex-1 mr-2">
              <Text className="text-theme-accent font-bold text-xs">{item.date} • {item.sport.toUpperCase()}</Text>
              <Text className="text-theme-text text-xs font-medium" numberOfLines={1}>{item.description}</Text>
            </View>
            {item.target_rooka ? (
              <View className="bg-theme-accent/20 px-2 py-1 rounded-md">
                <Text className="text-theme-accent font-bold font-rajdhani text-xs">+{Math.round(item.target_rooka)} rooka</Text>
              </View>
            ) : null}
          </View>
        ))}
      </View>

      {isAccepted ? (
        <View className="flex-row items-center justify-center p-2 rounded-lg bg-semantic-success/20">
          <Ionicons name="checkmark-circle" size={18} color="#10B981" />
          <Text className="text-semantic-success font-bold text-xs ml-2">Plan Proposal Accepted</Text>
        </View>
      ) : isRejected ? (
        <View className="flex-row items-center justify-center p-2 rounded-lg bg-semantic-error/20">
          <Ionicons name="close-circle" size={18} color="#EF4444" />
          <Text className="text-semantic-error font-bold text-xs ml-2">Proposal Rejected</Text>
        </View>
      ) : (
        <View className="flex-row gap-2">
          <TouchableOpacity
            onPress={onReject}
            className="flex-1 py-2.5 rounded-lg bg-theme-bg items-center justify-center"
          >
            <Text className="text-theme-muted font-bold text-xs">Reject</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onAccept}
            className="flex-1 py-2.5 rounded-lg bg-theme-accent items-center justify-center flex-row gap-1"
          >
            <Ionicons name="checkmark" size={16} color="white" />
            <Text className="text-white font-bold text-xs">Accept Plan</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};
