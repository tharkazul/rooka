import React, { useState, useEffect } from 'react';
import { useTheme } from '@/hooks/use-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useUser } from '../context/UserStore';
import { useLanguage } from '../context/LanguageContext';

function GoogleIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <Path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <Path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      />
      <Path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </Svg>
  );
}

export default function LoginScreen() {
  const theme = useTheme();
  const colorScheme = useColorScheme();
  const router = useRouter();
  const {
    login,
    register,
    loginWithApple,
    loginWithGoogle,
    resetPassword,
    loading: storeLoading,
    error: sessionError,
  } = useUser();
  const { t } = useLanguage();

  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [appleAuthAvailable, setAppleAuthAvailable] = useState(false);

  useEffect(() => {
    AppleAuthentication.isAvailableAsync()
      .then(setAppleAuthAvailable)
      .catch(() => setAppleAuthAvailable(false));
  }, []);

  // Forgot password state
  const [forgotStep, setForgotStep] = useState<1 | 2>(1);
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  // When the session is dropped (expired token, deleted account, server
  // unreachable) the store records why. Without surfacing it here the user
  // just lands on a bare login screen with no explanation for why they were
  // signed out — which reads as "the app is broken".
  const rawNotice = errorMessage ?? sessionError;
  const notice = typeof rawNotice === 'string' ? rawNotice : null;

  const handleSubmit = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (mode === 'login') {
      if (!email || !password) {
        setErrorMessage('Enter your email or username, and your password.');
        return;
      }
      setSubmitting(true);
      try {
        await login(email, password);
        router.replace('/(tabs)/coach');
      } catch (err: any) {
        setErrorMessage(err.message || 'Failed to sign in.');
      } finally {
        setSubmitting(false);
      }
    } else if (mode === 'register') {
      if (!email || !password) {
        setErrorMessage('Please fill in both email and password.');
        return;
      }
      if (password.length < 6) {
        setErrorMessage('Password must be at least 6 characters.');
        return;
      }
      setSubmitting(true);
      try {
        await register(email, password, username || undefined);
        router.replace('/(tabs)/coach');
      } catch (err: any) {
        setErrorMessage(err.message || 'Failed to create account.');
      } finally {
        setSubmitting(false);
      }
    }
  };

  const handleSendResetCode = async () => {
    const target = (resetEmail || email || '').trim();
    if (!target) {
      setErrorMessage(t('auth.enterEmail'));
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const { authApi } = await import('../services/apiServices');
      await authApi.forgotPassword({ email: target });
      setResetEmail(target);
      setForgotStep(2);
      setSuccessMessage(t('auth.resetCodeSent'));
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to send verification code.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetCode.trim() || !newPassword) {
      setErrorMessage(t('auth.enterCodeAndPassword'));
      return;
    }
    if (newPassword.length < 6) {
      setErrorMessage('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage(t('auth.passwordsDontMatch'));
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await resetPassword(resetEmail, resetCode, newPassword);
      setSuccessMessage(t('auth.resetSuccess'));
      setTimeout(() => {
        router.replace('/(tabs)/coach');
      }, 500);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to reset password.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAppleSignIn = async () => {
    try {
      setErrorMessage(null);
      setSuccessMessage(null);
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) {
        throw new Error('Apple Sign-In failed: No identity token received.');
      }

      setSubmitting(true);
      await loginWithApple({
        identityToken: credential.identityToken,
        user: credential.user,
        email: credential.email,
        fullName: credential.fullName,
      });

      router.replace('/(tabs)/coach');
    } catch (e: any) {
      if (e.code === 'ERR_REQUEST_CANCELED') {
        return;
      }
      setErrorMessage(e.message || 'Failed to sign in with Apple.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setErrorMessage(null);
      setSuccessMessage(null);
      setSubmitting(true);
      const result = await loginWithGoogle();
      if (result !== undefined) {
        router.replace('/(tabs)/coach');
      }
    } catch (e: any) {
      if (
        e.code === 'SIGN_IN_CANCELLED' ||
        e.code === '13' ||
        e.message?.toLowerCase().includes('cancelled')
      ) {
        return;
      }
      setErrorMessage(e.message || 'Failed to sign in with Google.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle = {
    fontSize: 16,
    lineHeight: 22,
    paddingTop: Platform.OS === 'ios' ? 10 : 8,
    paddingBottom: Platform.OS === 'ios' ? 12 : 10,
    minHeight: 46,
    includeFontPadding: false,
  };

  return (
    <SafeAreaView className="flex-1 bg-theme-bg">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingTop: 16, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          className="px-6"
        >
          {/* Header branding */}
          <View className="items-center mb-8">
            <View className="w-16 h-16 rounded-2xl overflow-hidden items-center justify-center mb-3 bg-white border border-theme-border/60 shadow-lg">
              <Image
                source={require('../../assets/images/logo-mark.png')}
                className="w-full h-full"
                resizeMode="contain"
                accessibilityLabel="rooka"
              />
            </View>
            <Text className="text-3xl font-extrabold text-theme-text tracking-tight font-rajdhani">rooka</Text>
            <Text className="text-sm font-medium text-theme-muted mt-1">
              {t('auth.subtitle')}
            </Text>
          </View>

          {/* Mode Switcher */}
          {mode !== 'forgot' ? (
            <View className="flex-row bg-theme-card p-1 rounded-control mb-6">
              <TouchableOpacity
                onPress={() => {
                  setMode('login');
                  setErrorMessage(null);
                  setSuccessMessage(null);
                }}
                className={`flex-1 py-3 rounded-lg items-center ${
                  mode === 'login' ? 'bg-theme-accent' : 'bg-transparent'
                }`}
              >
                <Text
                  className={`font-semibold text-sm ${
                    mode === 'login' ? 'text-white' : 'text-theme-muted'
                  }`}
                >
                  {t('auth.signIn')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setMode('register');
                  setErrorMessage(null);
                  setSuccessMessage(null);
                }}
                className={`flex-1 py-3 rounded-lg items-center ${
                  mode === 'register' ? 'bg-theme-accent' : 'bg-transparent'
                }`}
              >
                <Text
                  className={`font-semibold text-sm ${
                    mode === 'register' ? 'text-white' : 'text-theme-muted'
                  }`}
                >
                  {t('auth.register')}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View className="items-center mb-6">
              <Text className="text-xl font-bold text-theme-text">
                {t('auth.forgotPasswordTitle')}
              </Text>
              <Text className="text-xs text-theme-muted text-center mt-1 px-4">
                {forgotStep === 1
                  ? t('auth.forgotPasswordDesc')
                  : t('auth.resetCodeSent')}
              </Text>
            </View>
          )}

          {/* Error / session notice */}
          {notice && (
            <View className="bg-semantic-error/10 rounded-xl p-3 mb-4 flex-row items-center">
              <Ionicons name="alert-circle" size={20} color="#EF4444" className="mr-2" />
              <Text className="text-semantic-error text-xs font-medium flex-1 ml-2">{notice}</Text>
            </View>
          )}

          {/* Success notice */}
          {successMessage && (
            <View className="bg-emerald-500/10 rounded-xl p-3 mb-4 flex-row items-center border border-emerald-500/20">
              <Ionicons name="checkmark-circle" size={20} color="#10B981" className="mr-2" />
              <Text className="text-emerald-500 text-xs font-medium flex-1 ml-2">
                {successMessage}
              </Text>
            </View>
          )}

          {/* Form Fields: Login & Register */}
          {mode !== 'forgot' && (
            <View className="gap-y-4">
              {mode === 'register' && (
                <View className="mb-4">
                  <Text className="text-xs font-semibold text-theme-muted mb-2">
                    {t('auth.chooseUsername')}
                  </Text>
                  <View className="flex-row items-center bg-theme-card rounded-control px-4 min-h-[56px]">
                    <Ionicons name="person-outline" size={20} color={theme.textSecondary} />
                    <TextInput
                      placeholder="Athlete Username"
                      placeholderTextColor={theme.textSecondary}
                      value={username}
                      onChangeText={setUsername}
                      autoCapitalize="none"
                      style={inputStyle}
                      className="flex-1 ml-3 text-theme-text"
                    />
                  </View>
                  <Text className="text-xs text-theme-muted mt-1.5">
                    {t('auth.usernameOptionalHint')}
                  </Text>
                </View>
              )}

              <View className="mb-4">
                <Text className="text-xs font-semibold text-theme-muted mb-2">
                  {mode === 'login' ? t('auth.signInIdentifier') : t('auth.enterEmail')}
                </Text>
                <View className="flex-row items-center bg-theme-card rounded-control px-4 min-h-[56px]">
                  <Ionicons
                    name={mode === 'login' ? 'person-outline' : 'mail-outline'}
                    size={20}
                    color={theme.textSecondary}
                  />
                  <TextInput
                    placeholder={
                      mode === 'login'
                        ? t('auth.signInIdentifierPlaceholder')
                        : 'athlete@rooka.com'
                    }
                    placeholderTextColor={theme.textSecondary}
                    value={email}
                    onChangeText={setEmail}
                    keyboardType={mode === 'login' ? 'default' : 'email-address'}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={inputStyle}
                    className="flex-1 ml-3 text-theme-text"
                  />
                </View>
              </View>

              <View className="mb-2">
                <Text className="text-xs font-semibold text-theme-muted mb-2">
                  {t('auth.enterPassword')}
                </Text>
                <View className="flex-row items-center bg-theme-card rounded-control px-4 min-h-[56px]">
                  <Ionicons name="lock-closed-outline" size={20} color={theme.textSecondary} />
                  <TextInput
                    placeholder="••••••••"
                    placeholderTextColor={theme.textSecondary}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    style={inputStyle}
                    className="flex-1 ml-3 text-theme-text"
                  />
                  <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                    <Ionicons
                      name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={20}
                      color={theme.textSecondary}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Forgot password trigger in login mode */}
              {mode === 'login' && (
                <TouchableOpacity
                  onPress={() => {
                    setResetEmail(email);
                    setForgotStep(1);
                    setErrorMessage(null);
                    setSuccessMessage(null);
                    setMode('forgot');
                  }}
                  className="self-end py-1 mb-4"
                >
                  <Text className="text-xs font-semibold text-theme-accent">
                    {t('auth.forgotPassword')}
                  </Text>
                </TouchableOpacity>
              )}

              {/* Submit Button */}
              <TouchableOpacity
                onPress={handleSubmit}
                disabled={submitting || storeLoading}
                className="bg-theme-accent rounded-xl py-4 items-center justify-center shadow-md shadow-blue-500/20 active:opacity-90 mt-2"
              >
                {submitting || storeLoading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text className="text-white text-base font-bold">
                    {mode === 'login' ? t('auth.signIn') : t('auth.register')}
                  </Text>
                )}
              </TouchableOpacity>

              {/* Social Logins Divider */}
              <View className="flex-row items-center my-4">
                <View className="flex-1 h-[1px] bg-theme-border/60" />
                <Text className="mx-3 text-[11px] font-bold text-theme-muted uppercase tracking-widest">
                  OR
                </Text>
                <View className="flex-1 h-[1px] bg-theme-border/60" />
              </View>

              {/* Apple Sign-In (iOS only) */}
              {appleAuthAvailable && (
                <View className="mb-3">
                  <AppleAuthentication.AppleAuthenticationButton
                    buttonType={
                      mode === 'login'
                        ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
                        : AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
                    }
                    buttonStyle={
                      colorScheme === 'dark'
                        ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                        : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                    }
                    cornerRadius={14}
                    style={{ width: '100%', height: 52 }}
                    onPress={handleAppleSignIn}
                  />
                </View>
              )}

              {/* Google Sign-In */}
              <TouchableOpacity
                onPress={handleGoogleSignIn}
                disabled={submitting || storeLoading}
                className="flex-row items-center justify-center bg-theme-card border border-theme-border/80 rounded-[14px] h-[52px] px-4 active:opacity-80"
              >
                <GoogleIcon size={20} />
                <Text className="text-theme-text font-bold text-base ml-3">
                  {mode === 'login' ? 'Sign in with Google' : 'Sign up with Google'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Forgot Password Flow */}
          {mode === 'forgot' && (
            <View className="gap-y-4">
              {forgotStep === 1 ? (
                <>
                  <View className="mb-4">
                    <Text className="text-xs font-semibold text-theme-muted mb-2">
                      {t('auth.enterEmail')}
                    </Text>
                    <View className="flex-row items-center bg-theme-card rounded-control px-4 min-h-[56px]">
                      <Ionicons name="mail-outline" size={20} color={theme.textSecondary} />
                      <TextInput
                        placeholder="athlete@rooka.com"
                        placeholderTextColor={theme.textSecondary}
                        value={resetEmail}
                        onChangeText={setResetEmail}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        style={inputStyle}
                        className="flex-1 ml-3 text-theme-text"
                      />
                    </View>
                  </View>

                  <TouchableOpacity
                    onPress={handleSendResetCode}
                    disabled={submitting}
                    className="bg-theme-accent rounded-xl py-4 items-center justify-center shadow-md shadow-blue-500/20 active:opacity-90"
                  >
                    {submitting ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Text className="text-white text-base font-bold">
                        {t('auth.sendResetCode')}
                      </Text>
                    )}
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <View className="mb-3">
                    <Text className="text-xs font-semibold text-theme-muted mb-2">
                      {t('auth.enterResetCode')}
                    </Text>
                    <View className="flex-row items-center bg-theme-card rounded-control px-4 min-h-[56px]">
                      <Ionicons name="key-outline" size={20} color={theme.textSecondary} />
                      <TextInput
                        placeholder="123456"
                        placeholderTextColor={theme.textSecondary}
                        value={resetCode}
                        onChangeText={setResetCode}
                        keyboardType="number-pad"
                        maxLength={6}
                        style={[inputStyle, { letterSpacing: 4, fontWeight: '700' }]}
                        className="flex-1 ml-3 text-theme-text text-lg"
                      />
                    </View>
                  </View>

                  <View className="mb-3">
                    <Text className="text-xs font-semibold text-theme-muted mb-2">
                      {t('auth.enterNewPassword')}
                    </Text>
                    <View className="flex-row items-center bg-theme-card rounded-control px-4 min-h-[56px]">
                      <Ionicons name="lock-closed-outline" size={20} color={theme.textSecondary} />
                      <TextInput
                        placeholder="••••••••"
                        placeholderTextColor={theme.textSecondary}
                        value={newPassword}
                        onChangeText={setNewPassword}
                        secureTextEntry={!showNewPassword}
                        autoCapitalize="none"
                        style={inputStyle}
                        className="flex-1 ml-3 text-theme-text"
                      />
                      <TouchableOpacity onPress={() => setShowNewPassword(!showNewPassword)}>
                        <Ionicons
                          name={showNewPassword ? 'eye-off-outline' : 'eye-outline'}
                          size={20}
                          color={theme.textSecondary}
                        />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View className="mb-4">
                    <Text className="text-xs font-semibold text-theme-muted mb-2">
                      {t('auth.confirmNewPassword')}
                    </Text>
                    <View className="flex-row items-center bg-theme-card rounded-control px-4 min-h-[56px]">
                      <Ionicons name="lock-closed-outline" size={20} color={theme.textSecondary} />
                      <TextInput
                        placeholder="••••••••"
                        placeholderTextColor={theme.textSecondary}
                        value={confirmPassword}
                        onChangeText={setConfirmPassword}
                        secureTextEntry={!showNewPassword}
                        autoCapitalize="none"
                        style={inputStyle}
                        className="flex-1 ml-3 text-theme-text"
                      />
                    </View>
                  </View>

                  <TouchableOpacity
                    onPress={handleResetPassword}
                    disabled={submitting}
                    className="bg-theme-accent rounded-xl py-4 items-center justify-center shadow-md shadow-blue-500/20 active:opacity-90"
                  >
                    {submitting ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Text className="text-white text-base font-bold">
                        {t('auth.resetPasswordSubmit')}
                      </Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={handleSendResetCode}
                    disabled={submitting}
                    className="py-2 items-center"
                  >
                    <Text className="text-xs text-theme-muted">
                      Didn't receive a code? <Text className="text-theme-accent font-semibold">Resend code</Text>
                    </Text>
                  </TouchableOpacity>
                </>
              )}

              {/* Back to sign in */}
              <TouchableOpacity
                onPress={() => {
                  setMode('login');
                  setForgotStep(1);
                  setErrorMessage(null);
                  setSuccessMessage(null);
                }}
                className="items-center py-3 mt-2"
              >
                <Text className="text-sm font-semibold text-theme-muted">
                  {t('auth.backToSignIn')}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}


