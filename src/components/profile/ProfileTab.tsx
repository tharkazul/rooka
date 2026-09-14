import { BrandColors } from '@/constants/theme';
import { RookaMark } from '../ui/RookaPoints';
import React, { useState, useEffect } from 'react';
import { useTheme } from '@/hooks/use-theme';
import { View, Text, Switch, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { Card } from '../ui/Card';
import { LanguageSelector } from '../LanguageSelector';
import { WeeklyAvailabilityCard } from './WeeklyAvailabilityCard';
import { RecurringTrainingsCard } from './RecurringTrainingsCard';
import { useLanguage } from '../../context/LanguageContext';
import { useUser } from '../../context/UserStore';
import { useColorScheme } from 'nativewind';
import { userApi, gamificationApi } from '../../services/apiServices';
import { API_BASE_URL } from '../../constants/api';
import { UserTitle } from '../../types/gamification';
import { TrainingZonesCard } from './TrainingZonesCard';

interface ProfileTabProps {
  username: string;
  email?: string;
  isRookaPlus: boolean;
  renderSettingRow: (
    icon: keyof typeof Ionicons.glyphMap,
    title: string,
    value?: React.ReactNode,
    onPress?: () => void
  ) => React.ReactNode;
}

export const ProfileTab: React.FC<ProfileTabProps> = ({
  username,
  email,
  isRookaPlus,
  renderSettingRow,
}) => {
    const theme = useTheme();
  const { t } = useLanguage();
  const { user, updateUser, refreshUser } = useUser();
  const { colorScheme, toggleColorScheme } = useColorScheme();

  const [titles, setTitles] = useState<UserTitle[]>([]);
  const [loadingTitles, setLoadingTitles] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [localPhotoUri, setLocalPhotoUri] = useState<string | null>(null);

  useEffect(() => {
    fetchTitles();
  }, []);

  const getFullPhotoUrl = (path?: string) => {
    if (!path) return null;
    if (path.startsWith('http') || path.startsWith('file://')) return path;
    return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  };

  const handlePickProfilePicture = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets[0]?.uri) {
        const fileUri = result.assets[0].uri;
        setLocalPhotoUri(fileUri);
        setUploadingPhoto(true);
        try {
          const res = await userApi.uploadProfilePicture(fileUri);
          if (res && res.url) {
            updateUser({ profile_picture_url: res.url });
          }
          await refreshUser();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (err: any) {
          console.error('Failed to upload profile picture:', err);
          setLocalPhotoUri(null);
        } finally {
          setUploadingPhoto(false);
        }
      }
    } catch (err: any) {
      console.error('Image picker error:', err);
    }
  };

  const fetchTitles = async () => {
    try {
      setLoadingTitles(true);
      const res = await gamificationApi.getGamificationData();
      if (res && Array.isArray(res.titles)) {
        setTitles(res.titles);
      } else {
        setTitles([]);
      }
    } catch (err) {
      setTitles([]);
    } finally {
      setLoadingTitles(false);
    }
  };

  const handleEquipTitle = async (id: number | string) => {
    try {
      setTitles((prev) =>
        prev.map((t) => {
          const isTarget = t.id === id;
          const wasEquipped = Boolean(t.is_equipped || t.is_active);
          const nextState = isTarget ? (wasEquipped ? 0 : 1) : 0;
          return {
            ...t,
            is_equipped: nextState,
            is_active: nextState,
          };
        })
      );
      await gamificationApi.equipTitle(id);
      await fetchTitles();
    } catch (err: any) {
      console.error('Equip title error:', err.message || err);
      await fetchTitles();
    }
  };

  const profilePicUrl = localPhotoUri || getFullPhotoUrl(user?.profile_picture_url || (user as any)?.profilePictureUrl);

  // The ⚡ used to be baked into these strings, which put an emoji (in its own
  // yellow, on an orange chip) into a UI that otherwise uses Ionicons
  // throughout. It is now the rooka R mark, rendered beside the label.
  const tier = user?.subscription_tier;
  let tierLabel = 'Free Member';
  if (tier === 'admin') {
    tierLabel = 'Admin Member';
  } else if (tier === 'premium') {
    tierLabel = 'rooka+ Premium';
  } else if (tier === 'rooka_plus' || tier === 'subscription') {
    tierLabel = 'rooka+ Member';
  }
  const isPaidTier = tier === 'admin' || tier === 'premium' || tier === 'rooka_plus' || tier === 'subscription';

  return (
    <View className="gap-y-6">
      {/* USER PROFILE HEADER */}
      <View className="items-center my-4">
        <View className="relative mb-3">
          <View className="w-24 h-24 rounded-full bg-theme-card items-center justify-center shadow-sm overflow-hidden border-2 border-theme-border/60">
            {profilePicUrl ? (
              <Image
                source={{ uri: profilePicUrl }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
                transition={200}
              />
            ) : (
              <Ionicons name="person" size={42} color={theme.textSecondary} />
            )}
            {uploadingPhoto && (
              <View className="absolute inset-0 bg-black/50 items-center justify-center">
                <ActivityIndicator size="small" color={theme.tint} />
              </View>
            )}
          </View>

          {/* Edit Camera Button Overlay */}
          <TouchableOpacity
            onPress={handlePickProfilePicture}
            disabled={uploadingPhoto}
            activeOpacity={0.8}
            className="absolute bottom-0 right-0 bg-theme-accent w-8 h-8 rounded-full items-center justify-center border-2 border-theme-bg shadow-md"
          >
            <Ionicons name="camera" size={15} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <Text className="text-theme-text text-2xl font-bold">{username}</Text>
        {email ? <Text className="text-theme-muted text-sm mt-0.5">{email}</Text> : null}
        <View className="mt-2 px-3 py-1 bg-theme-accent/10 rounded-full flex-row items-center gap-x-1">
          {isPaidTier ? <RookaMark size={13} color={theme.tint} /> : null}
          <Text className="text-theme-accent text-xs font-bold">
            {tierLabel}
          </Text>
        </View>
      </View>

      {/* PERSONAL TITLES MANAGER */}
      <Text className="text-theme-muted font-bold text-xs mb-2 ml-1">
        Personal Titles & Accolades
      </Text>
      {!isPaidTier ? (
        <Card className="p-5 mb-6 items-center text-center">
          <View className="w-10 h-10 rounded-full bg-theme-accent/15 items-center justify-center mb-2.5">
            <Ionicons name="ribbon-outline" size={20} color={theme.tint} />
          </View>
          <View className="flex-row items-center gap-x-1.5 mb-1">
            <RookaMark size={14} color={theme.tint} />
            <Text className="text-theme-text font-bold text-sm font-rajdhani">
              Rooka+ Exclusive
            </Text>
          </View>
          <Text className="text-theme-muted text-xs text-center px-4 mb-3">
            Earn custom athletic titles and accolades based on your races and endurance milestones.
          </Text>
          <View className="px-3 py-1 bg-theme-accent/10 rounded-full">
            <Text className="text-theme-accent text-xs font-bold font-rajdhani">Included with Rooka+</Text>
          </View>
        </Card>
      ) : (
        <Card className="p-4 mb-6">
          {loadingTitles ? (
            <Text className="text-theme-muted text-xs italic text-center py-2">Loading titles...</Text>
          ) : (
            <View className="gap-y-2">
              {(titles.length > 0
                ? titles
                : [
                    {
                      id: 'default_rooka_plus',
                      title: 'Rooka+ Athlete',
                      title_name: 'Rooka+ Athlete',
                      description: 'Official member of the Rooka+ endurance squad.',
                      is_equipped: 1,
                      is_active: 1,
                    },
                  ]
              ).map((item) => {
                const titleName = item.title_name || item.title || 'Rooka+ Athlete';
                const isEquipped = Boolean(item.is_equipped || item.is_active);

                return (
                  <TouchableOpacity
                    key={item.id}
                    onPress={() => handleEquipTitle(item.id)}
                    activeOpacity={0.7}
                    className={`flex-row items-center justify-between p-3 rounded-xl mb-1.5 ${
                      isEquipped
                        ? 'bg-theme-accent/15 border border-theme-accent/40'
                        : 'bg-theme-bg'
                    }`}
                  >
                    <View className="flex-row items-center gap-x-2.5 flex-1 mr-2">
                      <Ionicons
                        name={isEquipped ? 'ribbon' : 'ribbon-outline'}
                        size={18}
                        color={isEquipped ? BrandColors.primary : '#8E9BA4'}
                      />
                      <View className="flex-1">
                        <Text className="text-theme-text font-bold text-sm" numberOfLines={1}>
                          {titleName}
                        </Text>
                        {item.description ? (
                          <Text className="text-theme-muted text-[11px] mt-0.5" numberOfLines={2}>
                            {item.description}
                          </Text>
                        ) : null}
                      </View>
                    </View>

                    {isEquipped ? (
                      <View className="px-2.5 py-1 bg-theme-accent rounded-full">
                        <Text className="text-white text-xs font-bold">Equipped</Text>
                      </View>
                    ) : (
                      <Text className="text-theme-muted text-xs font-semibold">Tap to Equip</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </Card>
      )}

      {/* LANGUAGE SETTINGS */}
      <Text className="text-theme-muted font-bold text-xs mb-2 ml-1">
        {t('profile.languageSettingTitle')}
      </Text>
      <Card className="p-4 mb-6">
        <Text className="text-theme-muted text-xs mb-3">
          {t('profile.languageSettingDesc')}
        </Text>
        <LanguageSelector />
      </Card>

      {/* WEEKLY TRAINING AVAILABILITY */}
      <WeeklyAvailabilityCard />

      {/* RECURRING TRAININGS & CLUB SPORTS */}
      <RecurringTrainingsCard />

      {/* Zones drive every rooka score, so they sit with the athlete's
          own details rather than in a settings sub-menu. */}
      <TrainingZonesCard />

      {/* APP PREFERENCES */}
      <Text className="text-theme-muted font-bold text-xs mb-2 ml-1">
        {t('nav.profile')} Preferences
      </Text>
      <Card className="p-2 mb-6">
        {renderSettingRow(
          'moon',
          t('profile.darkMode'),
          <Switch
            value={colorScheme === 'dark'}
            onValueChange={toggleColorScheme}
            trackColor={{ false: '#DDE3E9', true: theme.tint }}
          />
        )}
        {renderSettingRow(
          'notifications',
          t('profile.pushNotifications'),
          <Switch value={true} trackColor={{ false: '#DDE3E9', true: theme.tint }} />
        )}
      </Card>
    </View>
  );
};
