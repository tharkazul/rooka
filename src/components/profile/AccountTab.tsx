import { BrandColors } from '@/constants/theme';
import { RookaMark } from '../ui/RookaPoints';
import React, { useState, useEffect } from 'react';
import { useTheme } from '@/hooks/use-theme';
import { View, Text, TouchableOpacity, Alert, ActivityIndicator, Platform, TextInput } from 'react-native';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Card } from '../ui/Card';
import { discountApi, userApi } from '../../services/apiServices';
import { useLanguage } from '../../context/LanguageContext';
import { useUser } from '../../context/UserStore';
import { useCoachChatStore } from '../../context/CoachChatStore';
import { useSubscription } from '../../context/SubscriptionStore';
import { AppliedDiscount, DiscountValidationResult, PricingBreakdown } from '../../types/discount';
import { DiscountCodeField } from '../subscription/DiscountCodeField';
import { formatDate, formatDiscountSummary } from '../../utils/discountFormat';

interface AccountTabProps {
  onLogout: () => void;
  isRookaPlus: boolean;
}

export const AccountTab: React.FC<AccountTabProps> = ({ onLogout, isRookaPlus }) => {
    const theme = useTheme();
  const { t } = useLanguage();
  const { user, refreshUser } = useUser();
  const { isSubscribed, presentPaywall, presentCustomerCenter, presentCodeRedemptionSheet } = useSubscription();
  const { tokenUsage } = useCoachChatStore();
  const [trackingUpgrade, setTrackingUpgrade] = useState(false);
  const [email, setEmail] = useState(user?.email || '');
  const [savingAccount, setSavingAccount] = useState(false);

  useEffect(() => {
    if (user?.email) {
      setEmail(user.email);
    }
  }, [user?.email]);

  useEffect(() => {
    refreshUser();
  }, []);

  const tier = user?.subscription_tier || 'free';
  const isMember = isRookaPlus || tier === 'admin' || tier === 'premium' || tier === 'rooka_plus' || tier === 'subscription';

  const dailyUsage =
    typeof tokenUsage?.daily_token_usage === 'number'
      ? tokenUsage.daily_token_usage
      : (typeof user?.daily_token_usage === 'number'
          ? user.daily_token_usage
          : (typeof (user as any)?.dailyTokenUsage === 'number'
              ? (user as any).dailyTokenUsage
              : 0));

  const dailyLimit =
    typeof tokenUsage?.daily_token_limit === 'number'
      ? tokenUsage.daily_token_limit
      : (typeof user?.daily_token_limit === 'number'
          ? user.daily_token_limit
          : (typeof (user as any)?.dailyTokenLimit === 'number'
              ? (user as any).dailyTokenLimit
              : (tier === 'admin' ? 500000 : isMember ? 50000 : 5000)));

  const handleSaveAccount = async () => {
    setSavingAccount(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await userApi.updateAccountDetails({ email });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Success", "Account details updated successfully.");
      await refreshUser();
    } catch (err: any) {
      console.error('Update account error:', err);
      Alert.alert("Error", err.response?.data?.error || err.message || "Failed to update account details.");
    } finally {
      setSavingAccount(false);
    }
  };

  const handleRookaPlusClick = async () => {
    setTrackingUpgrade(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      if (isMember) {
        await presentCustomerCenter();
      } else {
        userApi.trackRookaPlusClick().catch(() => {});
        await presentPaywall();
      }
    } catch (err) {
      console.error('Subscription UI error:', err);
    } finally {
      setTrackingUpgrade(false);
    }
  };

  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExportData = async () => {
    setExporting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await userApi.requestAccountData();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Data Export Requested", "Your personal account data summary has been compiled successfully.");
    } catch (err: any) {
      console.error('Export data error:', err);
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Delete Account?",
      "This action cannot be undone. All your workout history, physique logs, chat messages, and account settings will be permanently erased.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Permanently Delete",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            try {
              await userApi.deleteAccount();
              onLogout();
            } catch (err: any) {
              console.error('Deletion error:', err);
              Alert.alert("Error", err.message || "Failed to delete account.");
            } finally {
              setDeleting(false);
            }
          }
        }
      ]
    );
  };

  /* --- Discount code -------------------------------------------------------
   * The athlete holds at most one code. Editing means entering a different one,
   * which replaces it; the numbers shown are always the server's.
   * ---------------------------------------------------------------------- */
  const [discount, setDiscount] = useState<AppliedDiscount | null>(null);
  const [discountPricing, setDiscountPricing] = useState<PricingBreakdown | null>(null);
  const [loadingDiscount, setLoadingDiscount] = useState(true);
  const [editingDiscount, setEditingDiscount] = useState(false);
  const [pendingDiscount, setPendingDiscount] = useState<DiscountValidationResult | null>(null);
  const [savingDiscount, setSavingDiscount] = useState(false);

  const loadDiscount = async () => {
    try {
      const res = await discountApi.mine();
      setDiscount(res.discount);
      setDiscountPricing(res.pricing);
    } catch (err) {
      console.log('Could not load discount:', err);
    } finally {
      setLoadingDiscount(false);
    }
  };

  useEffect(() => {
    loadDiscount();
  }, []);

  const handleApplyDiscount = async () => {
    const code = pendingDiscount?.code?.code;
    if (!code) return;
    setSavingDiscount(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await discountApi.apply(code);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditingDiscount(false);
      setPendingDiscount(null);
      await loadDiscount();
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Discount Code', err?.data?.error || err?.message || 'Could not apply that code.');
    } finally {
      setSavingDiscount(false);
    }
  };

  const handleRemoveDiscount = () => {
    Alert.alert(
      'Remove Discount Code?',
      `Your subscription will go back to the standard price${
        discountPricing ? ` of ${discountPricing.currency}${discountPricing.yearly.original.toFixed(2)} per year` : ''
      }.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setSavingDiscount(true);
            try {
              await discountApi.remove();
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              setEditingDiscount(false);
              setPendingDiscount(null);
              await loadDiscount();
            } catch (err: any) {
              Alert.alert('Discount Code', err?.message || 'Could not remove the code.');
            } finally {
              setSavingDiscount(false);
            }
          },
        },
      ]
    );
  };

  const handleManageSubscription = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await presentCustomerCenter();
    } catch (err) {
      const url = Platform.OS === 'ios'
        ? 'https://apps.apple.com/account/subscriptions'
        : 'https://play.google.com/store/account/subscriptions';
      Linking.openURL(url).catch(() => {
        Alert.alert("Manage Subscription", `Please manage your subscription directly in your ${Platform.OS === 'ios' ? 'Apple ID' : 'Google Play Store'} account settings.`);
      });
    }
  };

  const handleOpenPrivacyPolicy = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Linking.openURL('https://rookaapp.fitness/privacy.html').catch(() => {
      Alert.alert("Privacy Policy", "Visit https://rookaapp.fitness/privacy.html to read our Privacy Policy.");
    });
  };

  const handleOpenTerms = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Linking.openURL('https://rookaapp.fitness/terms.html').catch(() => {
      Alert.alert("Terms of Service", "Visit https://rookaapp.fitness/terms.html to read our Terms of Service.");
    });
  };

  return (
    <View className="gap-y-6">
      {/* ACCOUNT INFORMATION */}
      <Card className="p-4 mb-6">
        <View className="flex-row items-center gap-2 pb-3 mb-3 border-b border-theme-border/20">
          <View className="w-2.5 h-2.5 rounded-full bg-semantic-info mr-2" />
          <Text className="text-theme-text font-bold text-sm">Account Information</Text>
        </View>

        <View className="gap-y-4">
          <View>
            <Text className="text-xs font-bold text-theme-muted uppercase mb-1">Username (Read-Only)</Text>
            <View className="bg-theme-bg rounded-xl p-3 border border-theme-border/30 opacity-70">
              <Text className="text-theme-text font-bold">{user?.username}</Text>
            </View>
          </View>
          
          <View>
            <Text className="text-xs font-bold text-theme-muted uppercase mb-1">Email Address</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Enter your email"
              placeholderTextColor="#8E8E93"
              keyboardType="email-address"
              autoCapitalize="none"
              className="bg-theme-bg rounded-xl p-3 border border-theme-border/30 text-theme-text font-bold"
            />
          </View>
          
          <TouchableOpacity
            onPress={handleSaveAccount}
            disabled={savingAccount || email === user?.email}
            className={`py-3 rounded-xl items-center ${email === user?.email ? 'bg-theme-accent/50' : 'bg-theme-accent'}`}
          >
            {savingAccount ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text className="text-white font-bold">Save Account Details</Text>
            )}
          </TouchableOpacity>
        </View>
      </Card>

      {/* USAGE STATISTICS */}
      <Card className="p-4 mb-6">
        <View className="flex-row items-center gap-2 pb-3 mb-3 border-b border-theme-border/20">
          <View className="w-2.5 h-2.5 rounded-full bg-purple-500 mr-2" />
          <Text className="text-theme-text font-bold text-sm">Usage Statistics</Text>
        </View>

        <View className="p-4 bg-theme-bg rounded-xl flex-row items-center justify-between">
          <View className="flex-1 pr-3">
            <Text className="text-xs font-bold text-theme-muted uppercase tracking-wider">
              Personal Daily Token Use Rate
            </Text>
            <Text className="text-xs text-theme-muted mt-1">
              Tokens consumed today by AI Coach interactions (Limit: {dailyLimit.toLocaleString()}/day)
            </Text>
          </View>
          <View className="px-3 py-1.5 bg-theme-accent/10 rounded-xl">
            <Text className="text-lg font-bold text-theme-accent">{dailyUsage.toLocaleString()}</Text>
          </View>
        </View>
      </Card>

      {/* ROOKA+ UPGRADE / MEMBER CARD */}
      <TouchableOpacity
        onPress={handleRookaPlusClick}
        activeOpacity={0.9}
        className="mb-6 rounded-2xl overflow-hidden shadow-lg border border-theme-border/30"
      >
        <LinearGradient
          colors={isMember ? ['#1E293B', '#0F172A'] : [BrandColors.primary, '#7C3AED']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ padding: 22, borderRadius: 16 }}
        >
          <View className="flex-row items-center justify-between mb-2.5">
            <View className="flex-row items-center">
              <RookaMark size={24} color="#FFFFFF" />
              <Text className="text-white text-xl font-extrabold tracking-tight ml-2 font-rajdhani">
                {isMember
                  ? (tier === 'admin' ? 'rooka Admin Access' : 'rooka+ Active')
                  : 'Upgrade to rooka+'}
              </Text>
            </View>
            <View className="px-2.5 py-1 bg-white/20 rounded-full">
              <Text className="text-white text-xs font-extrabold uppercase tracking-wider">
                {isMember ? (tier === 'admin' ? 'ADMIN' : 'ACTIVE') : 'PRO TIER'}
              </Text>
            </View>
          </View>

          <Text className="text-white/90 text-xs mb-4 leading-relaxed font-medium">
            {isMember
              ? (tier === 'admin'
                  ? 'Your account has full administrator access with a 500k daily token quota, advanced periodization, and direct integrations.'
                  : 'Your account has unlocked 50,000 daily coach tokens, priority workout adaptation, custom macro periodization, and direct Garmin sync.')
              : 'Unlock 50,000 daily coach tokens, priority workout adaptation, custom macro periodization, and deeper athletic insights.'}
          </Text>

          <View className="bg-white py-2.5 px-5 rounded-full self-start flex-row items-center shadow-sm">
            {trackingUpgrade ? (
              <ActivityIndicator size="small" color={theme.tint} />
            ) : (
              <Text className="text-theme-accent font-bold text-xs">
                {isMember ? 'View Member Benefits' : 'View Premium Benefits'}
              </Text>
            )}
          </View>
        </LinearGradient>
      </TouchableOpacity>

      {/* SUBSCRIPTIONS */}
      <Card className="p-4 mb-6">
        <View className="flex-row items-center gap-2 pb-3 mb-3 border-b border-theme-border/20">
          <View className="w-2.5 h-2.5 rounded-full bg-semantic-success mr-2" />
          <Text className="text-theme-text font-bold text-sm">Subscription Management</Text>
        </View>

        <TouchableOpacity
          onPress={handleManageSubscription}
          className="p-3 bg-theme-bg rounded-xl flex-row items-center justify-between mb-2"
        >
          <View className="flex-row items-center">
            <Ionicons name="card-outline" size={18} color={theme.textSecondary} />
            <View className="ml-3">
              <Text className="text-theme-text font-bold text-xs">Manage or Cancel Subscription</Text>
              <Text className="text-theme-muted text-xs mt-0.5">Customer center, plan switch & cancel</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
        </TouchableOpacity>

        {Platform.OS === 'ios' && (
          <TouchableOpacity
            onPress={async () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              await presentCodeRedemptionSheet();
            }}
            className="p-3 bg-theme-bg rounded-xl flex-row items-center justify-between mb-2"
          >
            <View className="flex-row items-center">
              <Ionicons name="gift-outline" size={18} color={theme.textSecondary} />
              <View className="ml-3">
                <Text className="text-theme-text font-bold text-xs">Redeem Apple Promo Code</Text>
                <Text className="text-theme-muted text-xs mt-0.5">Redeem official App Store offer code</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
          </TouchableOpacity>
        )}

        {/* MANAGE DISCOUNT CODE */}
        <View className="mt-3 p-3 bg-theme-bg rounded-xl">
          <View className="flex-row items-center justify-between mb-2">
            <View className="flex-row items-center flex-1 pr-2">
              <Ionicons name="pricetag-outline" size={18} color={theme.textSecondary} />
              <Text className="text-theme-text font-bold text-xs ml-3">Manage Discount Code</Text>
            </View>
            {loadingDiscount ? <ActivityIndicator size="small" color={theme.tint} /> : null}
          </View>

          {loadingDiscount ? null : discount && !editingDiscount ? (
            <>
              {/* The code currently on the account */}
              <View
                className={`p-3 rounded-xl border mb-2 ${
                  discount.active
                    ? 'bg-semantic-success/10 border-semantic-success/30'
                    : 'bg-semantic-warning/10 border-semantic-warning/30'
                }`}
              >
                <View className="flex-row items-center justify-between">
                  <Text
                    className={`font-extrabold text-sm tracking-wider ${
                      discount.active ? 'text-semantic-success' : 'text-semantic-warning'
                    }`}
                  >
                    {discount.code}
                  </Text>
                  <Text
                    className={`text-[10px] font-extrabold uppercase ${
                      discount.active ? 'text-semantic-success' : 'text-semantic-warning'
                    }`}
                  >
                    {discount.active ? 'Active' : discount.expired ? 'Expired' : 'Inactive'}
                  </Text>
                </View>
                <Text className="text-theme-text text-xs mt-1">
                  {formatDiscountSummary(discount, discountPricing?.currency || '€')}
                </Text>
                {discount.expiresAt ? (
                  <Text className="text-theme-muted text-[10px] mt-0.5">
                    {discount.expired
                      ? `Ended ${formatDate(discount.expiresAt)}`
                      : `Runs until ${formatDate(discount.expiresAt)}`}
                  </Text>
                ) : null}
              </View>

              {/* What they pay under it — server-computed, same as the paywall */}
              {discountPricing ? (
                <View className="flex-row justify-between p-3 bg-theme-card rounded-tile mb-2">
                  <View>
                    <Text className="text-[10px] font-bold text-theme-muted uppercase">Monthly</Text>
                    <View className="flex-row items-baseline gap-1.5">
                      <Text className="text-sm font-extrabold text-theme-text">
                        {discountPricing.currency}{discountPricing.monthly.final.toFixed(2)}
                      </Text>
                      {discountPricing.monthly.discounted ? (
                        <Text className="text-[10px] text-theme-muted line-through">
                          {discountPricing.currency}{discountPricing.monthly.original.toFixed(2)}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                  <View className="items-end">
                    <Text className="text-[10px] font-bold text-theme-muted uppercase">Yearly</Text>
                    <View className="flex-row items-baseline gap-1.5">
                      <Text className="text-sm font-extrabold text-theme-text">
                        {discountPricing.currency}{discountPricing.yearly.final.toFixed(2)}
                      </Text>
                      {discountPricing.yearly.discounted ? (
                        <Text className="text-[10px] text-theme-muted line-through">
                          {discountPricing.currency}{discountPricing.yearly.original.toFixed(2)}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </View>
              ) : null}

              <View className="flex-row gap-2">
                <TouchableOpacity
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setPendingDiscount(null);
                    setEditingDiscount(true);
                  }}
                  disabled={savingDiscount}
                  className="flex-1 py-2.5 rounded-xl bg-theme-accent/15 border border-theme-accent/30 items-center"
                >
                  <Text className="text-theme-accent font-bold text-xs">Change Code</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleRemoveDiscount}
                  disabled={savingDiscount}
                  className="flex-1 py-2.5 rounded-xl bg-semantic-error/10 border border-semantic-error/30 items-center"
                >
                  {savingDiscount ? (
                    <ActivityIndicator size="small" color="#EF4444" />
                  ) : (
                    <Text className="text-semantic-error font-bold text-xs">Remove</Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text className="text-theme-muted text-[11px] mb-2">
                {discount
                  ? `Enter a different code to replace ${discount.code}.`
                  : 'Have a discount code? Enter it here to lower your subscription price.'}
              </Text>
              <DiscountCodeField
                onResult={setPendingDiscount}
                disabled={savingDiscount}
                placeholder="DISCOUNT CODE"
              />
              <View className="flex-row gap-2 mt-2.5">
                <TouchableOpacity
                  onPress={handleApplyDiscount}
                  disabled={!pendingDiscount?.valid || savingDiscount}
                  className={`flex-1 py-2.5 rounded-xl items-center ${
                    pendingDiscount?.valid && !savingDiscount ? 'bg-theme-accent' : 'bg-theme-accent/40'
                  }`}
                >
                  {savingDiscount ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <Text className="text-white font-bold text-xs">Apply Code</Text>
                  )}
                </TouchableOpacity>
                {discount ? (
                  <TouchableOpacity
                    onPress={() => {
                      setEditingDiscount(false);
                      setPendingDiscount(null);
                    }}
                    disabled={savingDiscount}
                    className="flex-1 py-2.5 rounded-xl border border-theme-border items-center"
                  >
                    <Text className="text-theme-muted font-bold text-xs">Cancel</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </>
          )}
        </View>
      </Card>

      {/* LEGAL & PRIVACY */}
      <Card className="p-4 mb-6">
        <View className="flex-row items-center gap-2 pb-3 mb-3 border-b border-theme-border/20">
          <View className="w-2.5 h-2.5 rounded-full bg-semantic-info mr-2" />
          <Text className="text-theme-text font-bold text-sm">Legal & Privacy Disclosures</Text>
        </View>

        <View className="gap-y-3">
          <TouchableOpacity
            onPress={handleOpenPrivacyPolicy}
            className="p-3 bg-theme-bg rounded-xl flex-row items-center justify-between"
          >
            <View className="flex-row items-center">
              <Ionicons name="shield-checkmark-outline" size={18} color={theme.textSecondary} />
              <Text className="text-theme-text font-bold text-xs ml-3">Privacy Policy</Text>
            </View>
            <Ionicons name="open-outline" size={16} color={theme.textSecondary} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleOpenTerms}
            className="p-3 bg-theme-bg rounded-xl flex-row items-center justify-between"
          >
            <View className="flex-row items-center">
              <Ionicons name="document-text-outline" size={18} color={theme.textSecondary} />
              <Text className="text-theme-text font-bold text-xs ml-3">Terms of Service & EULA</Text>
            </View>
            <Ionicons name="open-outline" size={16} color={theme.textSecondary} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleExportData}
            disabled={exporting}
            className="p-3 bg-theme-bg rounded-xl flex-row items-center justify-between"
          >
            <View className="flex-row items-center">
              {exporting ? (
                <ActivityIndicator size="small" color={theme.tint} />
              ) : (
                <Ionicons name="download-outline" size={18} color={theme.textSecondary} />
              )}
              <Text className="text-theme-text font-bold text-xs ml-3">Export Account Data</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleDeleteAccount}
            disabled={deleting}
            className="p-3 bg-theme-bg rounded-xl flex-row items-center justify-between"
          >
            <View className="flex-row items-center">
              {deleting ? (
                <ActivityIndicator size="small" color="#EF4444" />
              ) : (
                <Ionicons name="trash-outline" size={18} color="#EF4444" />
              )}
              <Text className="text-semantic-error font-bold text-xs ml-3">Delete Account & Purge Data</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#EF4444" />
          </TouchableOpacity>
        </View>
      </Card>

      {/* LOG OUT BUTTON */}
      <TouchableOpacity
        onPress={() => onLogout()}
        className="p-4 bg-semantic-error/10 rounded-xl items-center mb-6"
      >
        <Text className="text-semantic-error font-bold text-base">{t('profile.logout')}</Text>
      </TouchableOpacity>
    </View>
  );
};
