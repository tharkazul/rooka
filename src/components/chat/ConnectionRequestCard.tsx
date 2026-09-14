import { BrandColors } from '@/constants/theme';
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { socialApi } from '../../services/apiServices';

interface ConnectionRequestCardProps {
  payload: {
    type: 'connection_request' | 'connection_accepted';
    friend_id?: number | string;
    fromUserId?: number | string;
    username?: string;
    status?: string;
  };
  onAccept?: (friendId: number | string) => Promise<void> | void;
  onDecline?: (friendId: number | string) => Promise<void> | void;
  onConnectionAccepted?: () => void;
}

export const ConnectionRequestCard: React.FC<ConnectionRequestCardProps> = ({
  payload,
  onAccept,
  onDecline,
  onConnectionAccepted,
}) => {
  const targetId = payload.friend_id || payload.fromUserId;
  const initialStatus =
    payload.type === 'connection_accepted' || payload.status === 'accepted'
      ? 'accepted'
      : payload.status === 'declined' || payload.status === 'rejected'
      ? 'declined'
      : 'pending';

  const [status, setStatus] = useState<'pending' | 'accepted' | 'declined' | string>(initialStatus);
  const [loading, setLoading] = useState<'accept' | 'decline' | null>(null);

  const handleAccept = async () => {
    if (!targetId || status === 'accepted' || loading !== null) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading('accept');
    try {
      if (onAccept) {
        await onAccept(targetId);
      } else {
        await socialApi.acceptUser(targetId);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStatus('accepted');
      if (onConnectionAccepted) onConnectionAccepted();
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(null);
    }
  };

  const handleDecline = async () => {
    if (!targetId || status === 'declined' || loading !== null) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLoading('decline');
    try {
      if (onDecline) {
        await onDecline(targetId);
      } else {
        await socialApi.declineUser(targetId);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setStatus('declined');
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(null);
    }
  };

  const isAccepted = status === 'accepted';
  const isDeclined = status === 'declined' || status === 'rejected';
  const isPending = !isAccepted && !isDeclined;

  return (
    <View className="mt-3 p-3.5 bg-theme-bg border border-theme-border/70 rounded-2xl shadow-xs">
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center flex-1 mr-2">
          <View
            className={`w-9 h-9 rounded-full items-center justify-center border ${
              isAccepted
                ? 'bg-semantic-success/20 border-semantic-success/40'
                : isDeclined
                ? 'bg-semantic-error/20 border-semantic-error/40'
                : 'bg-theme-accent/20 border-theme-accent/40'
            }`}
          >
            <Ionicons
              name={isAccepted ? 'checkmark-circle' : isDeclined ? 'close-circle' : 'person-add'}
              size={18}
              color={isAccepted ? '#10B981' : isDeclined ? '#EF4444' : BrandColors.primary}
            />
          </View>
          <View className="ml-2.5 flex-1">
            <Text className="text-sm font-extrabold text-theme-text font-rajdhani" numberOfLines={1}>
              {payload.username || 'rooka Athlete'}
            </Text>
            <Text className="text-xs text-theme-muted font-medium">
              {isAccepted
                ? 'Connected Athlete'
                : isDeclined
                ? 'Connection Declined'
                : 'Sent you a connection request'}
            </Text>
          </View>
        </View>

        {!isPending && (
          <View
            className={`flex-row items-center px-2.5 py-1 rounded-full border ${
              isAccepted
                ? 'bg-semantic-success/15 border-semantic-success/30'
                : 'bg-semantic-error/15 border-semantic-error/30'
            }`}
          >
            <Ionicons
              name={isAccepted ? 'checkmark-circle' : 'close-circle'}
              size={12}
              color={isAccepted ? '#10B981' : '#EF4444'}
            />
            <Text
              className={`text-xs font-extrabold ml-1 ${
                isAccepted ? 'text-semantic-success' : 'text-semantic-error'
              }`}
            >
              {isAccepted ? 'Connected' : 'Declined'}
            </Text>
          </View>
        )}
      </View>

      {isPending && (
        <View className="flex-row items-center gap-2 pt-2 border border-theme-border/50 mt-1">
          <TouchableOpacity
            onPress={handleAccept}
            disabled={loading !== null}
            activeOpacity={0.8}
            className="flex-1 bg-semantic-success py-2 rounded-xl items-center justify-center flex-row shadow-xs"
          >
            {loading === 'accept' ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="checkmark" size={15} color="#FFFFFF" />
                <Text className="text-xs font-extrabold text-white ml-1">Accept</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleDecline}
            disabled={loading !== null}
            activeOpacity={0.8}
            className="flex-1 bg-theme-card border border-theme-border py-2 rounded-control items-center justify-center flex-row"
          >
            {loading === 'decline' ? (
              <ActivityIndicator size="small" color="#9CA3AF" />
            ) : (
              <>
                <Ionicons name="close" size={15} color="#9CA3AF" />
                <Text className="text-xs font-bold text-theme-muted ml-1">Reject</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};
