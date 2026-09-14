import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { UserProfile } from '../types/user';
import { userApi, authApi } from '../services/apiServices';
import { ApiError, setAuthToken, setOnUnauthorizedHandler, setOnRateLimitHandler } from '../services/apiClient';
import { tokenStorage, chatStorage, briefingStorage, profileStorage, goalsStorage } from '../services/storage';
import { unregisterPushNotificationsAsync } from '../services/notificationService';
import { wsService } from '../services/websocket';
import { realtimeEngine } from '../realtime/realtimeEngine';
import { getGoogleSignin } from '../services/googleAuth';

interface UserContextType {
  user: UserProfile | null;
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
  login: (emailOrUsername: string, password: string) => Promise<void>;
  register: (email: string, password: string, username?: string) => Promise<void>;
  loginWithToken: (token: string) => Promise<void>;
  loginWithApple: (appleData: {
    identityToken: string;
    user: string;
    email?: string | null;
    fullName?: { givenName?: string | null; familyName?: string | null } | null;
  }) => Promise<{ isNewUser?: boolean }>;
  loginWithGoogle: () => Promise<{ isNewUser?: boolean } | undefined>;
  resetPassword: (email: string, code: string, newPassword: string) => Promise<void>;
  logout: (reason?: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  updateUser: (data: Partial<UserProfile>) => Promise<void>;
  trackRookaPlus: () => Promise<void>;
}

/**
 * Normalises the server profile payload (which mixes camelCase and snake_case)
 * into a UserProfile.
 *
 * There is deliberately no "fallback user" here. Fabricating a profile when the
 * server could not be reached made the app show a signed-in shell with
 * strava_connected/garmin_connected forced to false and a hardcoded id, which
 * is what made working integrations look like they had vanished after a reboot.
 */
const normalizeProfile = (data: any, prev?: UserProfile | null): UserProfile => {
  const isSameUser = Boolean(prev && data && prev.id === data.id);
  const onboardingVal = data?.onboardingCompleted ?? data?.onboarding_completed ?? (isSameUser ? prev?.onboarding_completed : false);

  return {
    ...(data as UserProfile),
    total_rooka: data?.total_rooka ?? data?.totalRooka ?? (isSameUser ? prev?.total_rooka : 0) ?? 0,
    level: data?.level ?? data?.sparkLevel?.level ?? (isSameUser ? prev?.level : 1) ?? 1,
    subscription_tier:
      data?.subscriptionTier ?? data?.subscription_tier ?? (isSameUser ? prev?.subscription_tier : 'free') ?? 'free',
    daily_token_usage: data?.dailyTokenUsage ?? data?.daily_token_usage ?? (isSameUser ? prev?.daily_token_usage : 0) ?? 0,
    daily_token_limit:
      data?.dailyTokenLimit ?? data?.daily_token_limit ?? (isSameUser ? prev?.daily_token_limit : 50000) ?? 50000,
    athlete_context: data?.athleteContext ?? data?.athlete_context ?? (isSameUser ? prev?.athlete_context : undefined),
    coach_tone: data?.coachTone ?? data?.coach_tone ?? (isSameUser ? prev?.coach_tone : undefined),
    coach_name: data?.coachName ?? data?.coach_name ?? 'Rooka',
    coach_context: data?.coachContext ?? data?.coach_context ?? '',
    coach_avatar_neutral: data?.coachAvatarNeutral ?? data?.coach_avatar_neutral,
    coach_avatar_hype: data?.coachAvatarHype ?? data?.coach_avatar_hype,
    coach_avatar_disappointed: data?.coachAvatarDisappointed ?? data?.coach_avatar_disappointed,
    profile_picture_url:
      data?.profilePictureUrl ?? data?.profile_picture_url ?? (isSameUser ? prev?.profile_picture_url : undefined),
    garmin_connected: data?.hasGarmin ?? data?.garmin_connected ?? false,
    strava_connected: data?.hasStrava ?? data?.strava_connected ?? false,
    onboarding_completed: onboardingVal === true || onboardingVal === 1,
    needsZoneSetup: Boolean(data?.needsZoneSetup ?? (isSameUser ? prev?.needsZoneSetup : false)),
    target_event: data?.targetEvent ?? data?.target_event ?? (isSameUser ? prev?.target_event : undefined),
    event_date: data?.eventDate ?? data?.event_date ?? (isSameUser ? prev?.event_date : undefined),
    target_ctl: data?.targetCtl ?? data?.target_ctl ?? (isSameUser ? prev?.target_ctl : undefined),
    goal_type: data?.goalType ?? data?.goal_type ?? (isSameUser ? prev?.goal_type : undefined),
    goalType: data?.goalType ?? data?.goal_type ?? (isSameUser ? prev?.goalType : undefined),
    target_mode: data?.targetMode ?? data?.target_mode ?? (isSameUser ? prev?.target_mode : undefined),
    targetMode: data?.targetMode ?? data?.target_mode ?? (isSameUser ? prev?.targetMode : undefined),
    target_value: data?.targetValue ?? data?.target_value ?? (isSameUser ? prev?.target_value : undefined),
    targetValue: data?.targetValue ?? data?.target_value ?? (isSameUser ? prev?.targetValue : undefined),
    target_weight: data?.targetWeight ?? data?.target_weight ?? (isSameUser ? prev?.target_weight : undefined),
    targetWeight: data?.targetWeight ?? data?.target_weight ?? (isSameUser ? prev?.targetWeight : undefined),
    target_vo2max: data?.targetVo2max ?? data?.target_vo2max ?? (isSameUser ? prev?.target_vo2max : undefined),
    targetVo2max: data?.targetVo2max ?? data?.target_vo2max ?? (isSameUser ? prev?.targetVo2max : undefined),
    training_availability: data?.training_availability ?? data?.trainingAvailability ?? (isSameUser ? (prev as any)?.training_availability : undefined),
    trainingAvailability: data?.trainingAvailability ?? data?.training_availability ?? (isSameUser ? (prev as any)?.trainingAvailability : undefined),
  };
};

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserStore: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const loggingOutRef = useRef<boolean>(false);

  useEffect(() => {
    try {
      const googleSignin = getGoogleSignin();
      if (googleSignin) {
        googleSignin.configure({
          webClientId: '226225996905-91f8dpuh4hn6rvpqgkfo36mcdc9n22rd.apps.googleusercontent.com',
          iosClientId: '226225996905-cmhh8e7hdon643oliukl5bl7vta26hf6.apps.googleusercontent.com',
        });
      }
    } catch (e) {
      console.warn('GoogleSignin.configure error:', e);
    }
  }, []);


  const logout = React.useCallback(async (reason?: string) => {
    // A 401 arriving while we are already tearing the session down must not
    // start a second logout.
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;

    // Detach this device from the account so it stops receiving this phone's
    // daily notifications. Best-effort and time-boxed: signing out must never
    // wait on (or be blocked by) the network — the endpoint may not even exist
    // on an older server build, which simply 404s.
    try {
      await Promise.race([
        unregisterPushNotificationsAsync(),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    } catch (_) {}

    const currentUserId = user?.id;
    wsService.disconnect();
    setAuthToken(null);
    await tokenStorage.removeToken();
    await profileStorage.removeProfile();
    if (chatStorage.clearChatHistory) await chatStorage.clearChatHistory(currentUserId);
    if (briefingStorage.clearBriefing) await briefingStorage.clearBriefing();
    if (goalsStorage.clearGoals) await goalsStorage.clearGoals(currentUserId);
    setUser(null);
    setIsAuthenticated(false);
    setError(typeof reason === 'string' ? reason : null);
    loggingOutRef.current = false;
  }, [user?.id]);

  const login = React.useCallback(async (emailOrUsername: string, password: string) => {
    setLoading(true);
    setError(null);
    const identifier = emailOrUsername.trim();
    try {
      // No implicit account creation here. Auto-registering on "Athlete not
      // found" quietly produced a second, empty account whenever the identifier
      // was typed differently, which reads as "my Strava connection and
      // workouts disappeared". Registration is an explicit action on the login
      // screen.
      const res = await authApi.login({ username: identifier, password });

      if (!res || !res.token) {
        throw new Error('Sign in failed: no session token returned.');
      }

      setAuthToken(res.token);

      // Load the profile *before* persisting the token, so a token that cannot
      // actually authenticate is never written to storage.
      const profileData = await userApi.getProfile();
      await tokenStorage.setToken(res.token);
      
      const normalizedProfile = normalizeProfile(profileData);
      await profileStorage.setProfile(normalizedProfile);

      setUser(normalizedProfile);
      setIsAuthenticated(true);
    } catch (err: any) {
      // Never fabricate a session. A fake token guarantees a 401 on the next
      // request, which wipes the stored token and sends the user back to the
      // login screen on every launch.
      setAuthToken(null);
      setUser(null);
      setIsAuthenticated(false);
      const message = err?.message || 'Sign in failed. Please try again.';
      setError(message);
      throw err instanceof Error ? err : new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const register = React.useCallback(async (email: string, password: string, username?: string) => {
    setLoading(true);
    setError(null);
    const cleanEmail = email.trim().toLowerCase();
    const cleanUsername = (username || email).trim();
    try {
      await authApi.register({ username: cleanUsername, email: cleanEmail, password });
    } catch (err: any) {
      // Only an existing username falls through to sign-in. A network failure
      // must surface as a failed registration rather than silently attempting a
      // login against an account that may never have been created.
      if (err.message && err.message.toLowerCase().includes('already exist')) {
        console.log('Register notice, account exists — proceeding to sign in...');
      } else {
        setError(err.message || 'Registration failed.');
        setLoading(false);
        throw err;
      }
    }

    try {
      await login(cleanEmail || cleanUsername, password);
    } catch (loginErr: any) {
      setError(loginErr.message || 'Auto-login failed.');
      throw loginErr;
    } finally {
      setLoading(false);
    }
  }, [login]);

  const loginWithToken = React.useCallback(async (token: string) => {
    setLoading(true);
    setError(null);
    try {
      setAuthToken(token);
      const profileData = await userApi.getProfile();
      await tokenStorage.setToken(token);

      const normalizedProfile = normalizeProfile(profileData);
      await profileStorage.setProfile(normalizedProfile);

      setUser(normalizedProfile);
      setIsAuthenticated(true);
    } catch (err: any) {
      setAuthToken(null);
      setUser(null);
      setIsAuthenticated(false);
      const message = err?.message || 'Authentication failed. Please sign in.';
      setError(message);
      throw err instanceof Error ? err : new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const resetPassword = React.useCallback(
    async (email: string, code: string, newPassword: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await authApi.resetPassword({
          email: email.trim().toLowerCase(),
          code: code.trim(),
          newPassword,
        });
        if (res && res.token) {
          await loginWithToken(res.token);
        }
      } catch (err: any) {
        setError(err.message || 'Password reset failed.');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [loginWithToken]
  );

  const loginWithApple = React.useCallback(
    async (appleData: {
      identityToken: string;
      user: string;
      email?: string | null;
      fullName?: { givenName?: string | null; familyName?: string | null } | null;
    }) => {
      setLoading(true);
      setError(null);
      try {
        const res = await authApi.appleLogin(appleData);
        if (res && res.token) {
          await loginWithToken(res.token);
          return { isNewUser: res.isNewUser };
        }
        throw new Error('No authentication token returned by server.');
      } catch (err: any) {
        const msg = err?.message || 'Apple Sign-In failed.';
        setError(msg);
        throw err instanceof Error ? err : new Error(msg);
      } finally {
        setLoading(false);
      }
    },
    [loginWithToken]
  );

  const loginWithGoogle = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const googleSignin = getGoogleSignin();
      if (!googleSignin) {
        throw new Error(
          'Google Sign-In is not supported in Expo Go. Please use a development build or sign in with email/password.'
        );
      }
      await googleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const response = await googleSignin.signIn();
      const idToken = response?.data?.idToken || (response as any)?.idToken;
      if (!idToken) {
        throw new Error('Google Sign-In failed: No ID token returned.');
      }

      const res = await authApi.googleLogin({
        idToken,
        user: response?.data?.user || (response as any)?.user,
      });

      if (res && res.token) {
        await loginWithToken(res.token);
        return { isNewUser: res.isNewUser };
      }
      throw new Error('No authentication token returned by server.');
    } catch (err: any) {
      if (
        err?.code === 'SIGN_IN_CANCELLED' ||
        err?.code === '13' ||
        err?.message?.toLowerCase().includes('cancelled')
      ) {
        return;
      }
      const msg = err?.message || 'Google Sign-In failed.';
      setError(msg);
      throw err instanceof Error ? err : new Error(msg);
    } finally {
      setLoading(false);
    }
  }, [loginWithToken]);

  const refreshUser = React.useCallback(async () => {
    try {
      const data = await userApi.getProfile();
      if (data) {
        setUser((prev) => {
          const newProfile = normalizeProfile(data, prev);
          profileStorage.setProfile(newProfile).catch(() => {});
          return newProfile;
        });
      }
      setError(null);
    } catch (err: any) {
      // A transient refresh failure must not clobber the profile we already
      // hold — that is what used to flip garmin_connected/strava_connected
      // back to false and make live connections look disconnected.
      console.log('UserStore refreshUser info:', err.message || err);
    }
  }, []);

  const updateUser = React.useCallback(async (data: Partial<UserProfile>) => {
    setUser((prev) => {
      const newProfile = prev ? { ...prev, ...data } : prev;
      if (newProfile) {
        profileStorage.setProfile(newProfile).catch(() => {});
      }
      return newProfile;
    });
    try {
      await userApi.updateSettings(data);
    } catch (err: any) {
      console.warn('Failed to sync user settings:', err?.message || err);
    }
  }, []);

  const trackRookaPlus = React.useCallback(async () => {
    try {
      await userApi.trackRookaPlusClick();
    } catch (err) {
      console.log('Track rooka+ error:', err);
    }
  }, []);

  useEffect(() => {
    // Only a genuine rejection of the session ends it. Anything else (server
    // down, flaky network) must leave the stored token alone, otherwise a
    // single failed request signs the user out for good.
    setOnUnauthorizedHandler((reason) => {
      if (reason === 'NO_TOKEN' || reason === 'No token provided') {
        return;
      }
      const message =
        reason === 'ACCOUNT_DELETED'
          ? 'This account has been deleted.'
          : 'Your session has expired. Please sign in again.';
      logout(message);
    });

    setOnRateLimitHandler((msg) => {
      console.warn('[Rate Limit Warning]', msg);
    });

    const initAuth = async () => {
      setLoading(true);
      try {
        const storedToken = await tokenStorage.getToken();
        if (!storedToken) {
          return;
        }

        setAuthToken(storedToken);
        
        // Immediately load the cached profile to unblock the UI
        const cachedProfile = await profileStorage.getProfile();
        if (cachedProfile) {
          setUser(cachedProfile);
          setIsAuthenticated(true);
          setLoading(false); // Unblock the layout router immediately!
        }

        try {
          // A cold start can race the network coming up. Retry transient
          // failures a couple of times before giving up.
          let profile: UserProfile | null = null;
          let lastErr: any = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              profile = await userApi.getProfile();
              lastErr = null;
              break;
            } catch (attemptErr: any) {
              lastErr = attemptErr;
              if (attemptErr instanceof ApiError) break;
              await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
            }
          }
          if (lastErr) throw lastErr;
          
          const normalizedProfile = normalizeProfile(profile, cachedProfile);
          await profileStorage.setProfile(normalizedProfile);
          setUser(normalizedProfile);
          if (!cachedProfile) {
            setIsAuthenticated(true);
          }
        } catch (err: any) {
          if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            // Session really is dead (expired, or the account was deleted).
            await logout(
              err.data?.code === 'ACCOUNT_DELETED'
                ? 'This account has been deleted.'
                : 'Your session has expired. Please sign in again.'
            );
            return;
          }

          console.log('Auth initialization deferred (server unreachable):', err?.message || err);
          // If we had no cached profile, we can't let them in.
          if (!cachedProfile) {
            setAuthToken(null);
            setError('Could not reach rooka. Check your connection and try again.');
          }
        }
      } catch (err) {
        console.log('Auth initialization failed:', err);
      } finally {
        setLoading(false);
      }
    };

    initAuth();
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      realtimeEngine.cleanup();
      return;
    }

    tokenStorage.getToken().then((token) => {
      realtimeEngine.init(token || undefined);
    });

    const unsubRooka = realtimeEngine.subscribe('rooka_updated', (data: any) => {
      const added = typeof data.rooka === 'number' ? data.rooka : typeof data.points === 'number' ? data.points : 0;
      const total = typeof data.total_rooka === 'number' ? data.total_rooka : undefined;
      setUser((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          total_rooka: total !== undefined ? total : prev.total_rooka + added,
        };
      });
    });

    const unsubLevel = realtimeEngine.subscribe('level_up', (data: any) => {
      const newLevel = data.level || data.new_level;
      if (newLevel) {
        setUser((prev) => (prev ? { ...prev, level: newLevel } : null));
      }
    });

    return () => {
      unsubRooka();
      unsubLevel();
    };
  }, [isAuthenticated]);

  return (
    <UserContext.Provider
      value={{
        user,
        isAuthenticated,
        loading,
        error,
        login,
        register,
        loginWithToken,
        loginWithApple,
        loginWithGoogle,
        resetPassword,
        logout,
        refreshUser,
        updateUser,
        trackRookaPlus,
      }}
    >
      {children}
    </UserContext.Provider>
  );
};

export const useUser = (): UserContextType => {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useUser must be used within a UserStore');
  }
  return context;
};
