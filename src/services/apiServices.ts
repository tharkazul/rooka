import { apiClient } from './apiClient';
import { UserProfile, RecurringTraining, BenchmarkTest } from '../types/user';
import { Activity } from '../types/activity';
import { PlannedWorkout } from '../types/plan';
import { PhysiqueEntry, NutritionProtocol } from '../types/physique';
import { Quest, UserTitle } from '../types/gamification';
import { Niggle } from '../types/health';
import { ChatMessage, TokenUsage } from '../types/chat';
import { SocialFeedActivity, ActivityComment, SocialConnection, LeaderboardResponse, PublicAthleteProfile } from '../types/social';
import {
  ApplyDiscountResponse,
  DiscountValidationResult,
  MyDiscountResponse,
} from '../types/discount';

export const authApi = {
  login: (credentials: { email?: string; username?: string; password: string }) =>
    apiClient<{ token: string; message: string; user?: UserProfile }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    }),
  register: (data: { email?: string; username?: string; password: string }) =>
    apiClient<{ token: string; message: string; user?: UserProfile }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  forgotPassword: (data: { email?: string; username?: string }) =>
    apiClient<{ success: boolean; message: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  resetPassword: (data: { email?: string; username?: string; code: string; newPassword: string }) =>
    apiClient<{ success: boolean; token: string; message: string }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  appleLogin: (data: {
    identityToken: string;
    user: string;
    email?: string | null;
    fullName?: { givenName?: string | null; familyName?: string | null } | null;
  }) =>
    apiClient<{ success?: boolean; token: string; isNewUser?: boolean; message: string; user?: UserProfile }>(
      '/api/auth/apple',
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    ),
  googleLogin: (data: { idToken: string; user?: any }) =>
    apiClient<{ success?: boolean; token: string; isNewUser?: boolean; message: string; user?: UserProfile }>(
      '/api/auth/google',
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    ),
};

export const userApi = {
  getProfile: () => apiClient<UserProfile>('/api/user/settings'),
  updateSettings: (data: Partial<UserProfile>) =>
    apiClient<{ success: boolean }>('/api/user/settings/coach', {
      method: 'POST',
      body: JSON.stringify({
        coachTone: data.coach_tone,
        coachName: data.coach_name,
        coachContext: data.coach_context,
        athleteContext: data.athlete_context,
        targetEvent: data.target_event,
        eventDate: data.event_date,
        targetCtl: data.target_ctl,
        goalType: data.goalType || data.goal_type,
        goal_type: data.goal_type || data.goalType,
        targetWeight: data.targetWeight ?? data.target_weight,
        target_weight: data.target_weight ?? data.targetWeight,
        targetVo2max: data.targetVo2max ?? data.target_vo2max,
        target_vo2max: data.target_vo2max ?? data.targetVo2max,
        targetMode: data.targetMode ?? data.target_mode,
        target_mode: data.target_mode ?? data.targetMode,
        targetValue: data.targetValue ?? data.target_value,
        target_value: data.target_value ?? data.targetValue,
        onboardingCompleted: data.onboarding_completed,
        gender: data.gender,
        trainingAvailability: (data as any).training_availability ?? (data as any).trainingAvailability,
      }),
      skipAuthInterceptor: true,
    }),
  updateAccountDetails: (data: { email?: string; username?: string }) =>
    apiClient<{ success: boolean; message: string }>('/api/user/settings/account', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  syncSubscription: (hasActiveEntitlement: boolean) =>
    apiClient<{ success: boolean; tier?: string }>('/api/user/sync-subscription', {
      method: 'POST',
      body: JSON.stringify({ hasActiveEntitlement, entitlementId: 'rooka' }),
    }),
  uploadProfilePicture: async (fileUri: string) => {
    const formData = new FormData();
    const filename = fileUri.split('/').pop() || 'profile.jpg';
    const match = /\.(\w+)$/.exec(filename);
    const type = match ? `image/${match[1]}` : 'image/jpeg';

    formData.append('photo', { uri: fileUri, name: filename, type } as any);

    return apiClient<{ success: boolean; url: string }>('/api/settings/profile-picture', {
      method: 'POST',
      body: formData,
    });
  },
  uploadCoachAvatar: async (mood: string, fileUri: string) => {
    const formData = new FormData();
    const filename = fileUri.split('/').pop() || `avatar_${mood}.jpg`;
    const match = /\.(\w+)$/.exec(filename);
    const type = match ? `image/${match[1]}` : 'image/jpeg';

    formData.append('photo', { uri: fileUri, name: filename, type } as any);
    formData.append('mood', mood);

    return apiClient<{ success: boolean; url: string; mood: string }>('/api/settings/coach-avatar', {
      method: 'POST',
      body: formData,
    });
  },
  trackRookaPlusClick: () =>
    apiClient<{ success: boolean }>('/api/track-rooka-plus-click', { method: 'POST' }),
  requestAccountData: () =>
    apiClient<{ success: boolean; message: string }>('/api/request-account-data', { method: 'POST' }),
  deleteAccount: () =>
    apiClient<{ success: boolean; message: string }>('/api/user/account', { method: 'DELETE' }),
};

export const activitiesApi = {
  getActivities: () => apiClient<Activity[]>('/api/history'),
  getActivityDetail: (id: string | number) => apiClient<Activity>(`/api/activity/${id}`),
  logActivity: (data: Partial<Activity>) =>
    apiClient<{ success: boolean; activity?: Activity; completedQuests?: any[] }>('/api/activities', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getDashboardData: () => apiClient<any>('/api/dashboard-data'),
  syncGarmin: (workouts?: any[]) => apiClient<{ success: boolean; message?: string }>('/api/sync-garmin', { method: 'POST', body: JSON.stringify({ workouts }) }),
  syncStrava: () => apiClient<{ success: boolean; message?: string; count?: number }>('/api/sync-strava', { method: 'POST' }),
  getComments: (activityId: string | number) => apiClient<{ comments: ActivityComment[] }>(`/api/activities/${activityId}/comments`),
  postComment: (activityId: string | number, comment: string) =>
    apiClient<{ success: boolean; comment: ActivityComment }>(`/api/activities/${activityId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ comment }),
    }),
  deleteComment: (activityId: string | number, commentId: string | number) =>
    apiClient<{ success: boolean; deletedId: string | number }>(`/api/activities/${activityId}/comments/${commentId}`, {
      method: 'DELETE',
    }),
};

// Keyed by rooka sport bucket ('Run' | 'Bike' | 'Swim' | 'Strength') to match
// STRAVA_SHARE_SPORTS in server/services/utils.js.
export interface StravaShareFlags {
  shareName: boolean;
  shareScore: boolean;
  shareStructure: boolean;
  shareLink: boolean;
}

export interface StravaShareSettingsResponse {
  shareSettings: Record<string, StravaShareFlags>;
  // False on free accounts, where the rooka.io credit is always posted.
  linkIsOptional: boolean;
}

export const integrationsApi = {
  saveGarminCredentials: (credentials: { garminUsername: string; garminPassword: string }) =>
    apiClient<{ success?: boolean; message: string }>('/api/user/settings/garmin', {
      method: 'POST',
      body: JSON.stringify(credentials),
    }),
  disconnectGarmin: () =>
    apiClient<{ success?: boolean; message: string }>('/api/user/disconnect/garmin', {
      method: 'POST',
    }),
  // allowShared confirms connecting a Strava account that is already linked to
  // another rooka account. Each account keeps its own copy of the activities.
  exchangeStravaCode: (code: string, allowShared: boolean = false) =>
    apiClient<{ success?: boolean; message: string }>('/api/user/settings/strava-exchange', {
      method: 'POST',
      body: JSON.stringify({ code, allowShared }),
    }),
  saveStravaRefreshToken: (stravaRefreshToken: string) =>
    apiClient<{ success?: boolean; message: string }>('/api/user/settings/strava', {
      method: 'POST',
      body: JSON.stringify({ stravaRefreshToken }),
    }),
  disconnectStrava: () =>
    apiClient<{ success?: boolean; message: string }>('/api/user/disconnect/strava', {
      method: 'POST',
    }),
  syncGarmin: (workouts?: any[]) =>
    apiClient<{ success: boolean; message?: string }>('/api/sync-garmin', {
      method: 'POST',
      body: JSON.stringify({ workouts }),
    }),
  syncStrava: () =>
    apiClient<{ success: boolean; message?: string; count?: number }>('/api/sync-strava', {
      method: 'POST',
    }),
  getStravaShareSettings: () =>
    apiClient<StravaShareSettingsResponse>('/api/user/strava-share-settings'),
  saveStravaShareSettings: (shareSettings: Record<string, StravaShareFlags>) =>
    apiClient<StravaShareSettingsResponse & { success: boolean }>(
      '/api/user/strava-share-settings',
      { method: 'POST', body: JSON.stringify({ shareSettings }) },
    ),
};

export const planApi = {
  getMicroPlan: () => apiClient<PlannedWorkout[]>('/api/micro-plan'),
  generatePlan: (params: any) =>
    apiClient<{ reply?: string; mood?: string; planUpdated?: boolean }>('/api/generate-plan', {
      method: 'POST',
      body: JSON.stringify(params),
    }),
  pushForward: (dateStr: string) =>
    apiClient<{ success: boolean; message?: string }>('/api/micro-plan/push-forward', {
      method: 'POST',
      body: JSON.stringify({ date: dateStr }),
    }),
  addWorkout: (data: Partial<PlannedWorkout>) =>
    apiClient<{ success: boolean }>('/api/micro-plan', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateWorkout: (id: string | number, data: Partial<PlannedWorkout>) =>
    apiClient<{ success: boolean }>(`/api/micro-plan/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteWorkout: (id: string | number) =>
    apiClient<{ success: boolean }>(`/api/micro-plan/${id}`, {
      method: 'DELETE',
    }),
  updateDayWorkouts: (date: string, workouts: Partial<PlannedWorkout>[]) =>
    apiClient<{ success: boolean }>('/api/micro-plan/day', {
      method: 'POST',
      body: JSON.stringify({ date, workouts }),
    }),
  acceptSuggestion: (plan: any[]) =>
    apiClient<{ success: boolean; message?: string }>('/api/micro-plan/accept-suggestion', {
      method: 'POST',
      body: JSON.stringify({ plan }),
    }),
};

export const physiqueApi = {
  getPhysiqueLogs: () => apiClient<PhysiqueEntry[]>('/api/physique'),
  getNutritionProtocol: () =>
    apiClient<{
      title?: string;
      rationale?: string;
      carbs?: number;
      protein?: number;
      fat?: number;
      carbsTarget?: number;
      proteinTarget?: number;
      fatTarget?: number;
      loggedCarbs?: number;
      loggedProtein?: number;
      loggedFat?: number;
      loggedItems?: string[];
    }>('/api/physique/nutrition'),
  clearLoggedNutrition: () =>
    apiClient<{ success: boolean }>('/api/physique/nutrition/clear', {
      method: 'POST',
    }),
  logWeight: (data: Partial<PhysiqueEntry>) =>
    apiClient<{ success: boolean }>('/api/weight', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  logPhysique: (data: Partial<PhysiqueEntry>) =>
    apiClient<{ success: boolean }>('/api/physique', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

export const gamificationApi = {
  getGamificationData: () => apiClient<{ quests: Quest[]; titles: UserTitle[]; total_rooka: number }>('/api/gamification'),
  getMilestones: () => apiClient<any[]>('/api/milestones'),
  saveMilestones: (milestones: any[]) =>
    apiClient<{ success: boolean; message: string }>('/api/milestones', {
      method: 'POST',
      body: JSON.stringify({ milestones }),
    }),
  generateQuest: () => apiClient<{ success: boolean; quest: Quest }>('/api/gamification/generate_quest', { method: 'POST' }),
  refreshQuest: (quest_id: number | string) =>
    apiClient<{ success: boolean; quest: Quest }>('/api/gamification/refresh_quest', {
      method: 'POST',
      body: JSON.stringify({ quest_id }),
    }),
  generateTitle: () => apiClient<{ success: boolean; title: UserTitle }>('/api/gamification/generate_title', { method: 'POST' }),
  equipTitle: (id: number | string) =>
    apiClient<{ success: boolean; equipped: boolean; activeTitleId: any }>(`/api/titles/${id}/equip`, { method: 'POST' }),
};

export const healthApi = {
  getActiveNiggles: () => apiClient<Niggle[]>('/api/niggles/active'),
  getNiggles: () => apiClient<Niggle[]>('/api/niggles'),
  saveNiggle: (data: Partial<Niggle>) =>
    apiClient<{ success: boolean; id: number }>('/api/niggles', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  resolveNiggle: (id: number | string) =>
    apiClient<{ success: boolean }>(`/api/niggles/${id}/resolve`, { method: 'POST' }),
  logCycleStart: (cycleStartDate: string) =>
    apiClient<{ success: boolean }>('/api/user/cycle/log', {
      method: 'POST',
      body: JSON.stringify({ cycleStartDate }),
    }),
};


export const chatApi = {
  getHistory: () => apiClient<ChatMessage[] | { history: ChatMessage[]; tokenUsage?: TokenUsage }>('/api/chat/history'),
  sendMessage: (message: string, imagesBase64?: string[]) =>
    apiClient<{ reply: string; replies?: string[]; mood?: string; planUpdated?: boolean; tokenUsage?: TokenUsage }>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message, imagesBase64 }),
    }),
  clearHistory: () =>
    apiClient<{ success: boolean; message?: string }>('/api/chat/clear', {
      method: 'POST',
    }),
  checkin: () => apiClient<{ message: string }>('/api/chat/checkin', { method: 'POST' }),
};

export const adminApi = {
  getUsage: () => apiClient<any[]>('/api/admin/usage'),
  simulate24h: () => apiClient<{ success: boolean; message?: string }>('/api/admin/simulate-24h', { method: 'POST' }),
  triggerMorning: () => apiClient<{ success: boolean; message?: string }>('/api/admin/trigger-morning', { method: 'POST' }),
  addTokens: (targetUsername: string) =>
    apiClient<{ success: boolean; message?: string }>('/api/admin/add-tokens', {
      method: 'POST',
      body: JSON.stringify({ targetUsername }),
    }),
  setTier: (targetUsername: string, tier: string) =>
    apiClient<{ success: boolean; message?: string }>('/api/admin/set-tier', {
      method: 'POST',
      body: JSON.stringify({ targetUsername, tier }),
    }),
  deleteUser: (targetUsername: string) =>
    apiClient<{ success: boolean; message?: string }>(`/api/admin/delete-user/${encodeURIComponent(targetUsername)}`, {
      method: 'DELETE',
    }),
};

export const discountApi = {
  /**
   * Price preview with no side effects — safe to call on every keystroke, and
   * it will not burn a one-time code before the athlete commits.
   */
  validate: (code: string) =>
    apiClient<DiscountValidationResult>('/api/discounts/validate', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  apply: (code: string) =>
    apiClient<ApplyDiscountResponse>('/api/discounts/apply', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  mine: () => apiClient<MyDiscountResponse>('/api/discounts/mine'),
  remove: () =>
    apiClient<{ success: boolean; removed: boolean } & MyDiscountResponse>('/api/discounts/mine', {
      method: 'DELETE',
    }),
};

export const socialApi = {
  getFeed: () => apiClient<{ activities: SocialFeedActivity[] }>('/api/social/feed'),
  toggleKudos: (activityId: string | number) =>
    apiClient<{ success: boolean; added: boolean }>('/api/social/kudos', {
      method: 'POST',
      body: JSON.stringify({ activityId }),
    }),
  getLeaderboard: () => apiClient<LeaderboardResponse>('/api/social/leaderboard'),
  getConnections: () => apiClient<{ connections: SocialConnection[] }>('/api/social/connections'),
  invite: (micro_plan_id: string | number, invitee_ids: number[], location?: string, time?: string) =>
    apiClient('/api/social/invite', {
      method: 'POST',
      body: JSON.stringify({ micro_plan_id, invitee_ids, location, time }),
    }),
  getEventInvites: (micro_plan_id: string | number) =>
    apiClient<{ invites: { invitee_id: number; status: string }[] }>(`/api/social/invite/${micro_plan_id}`),
  searchUser: (username: string) =>
    apiClient<{
      found: boolean;
      user?: { id: number; username: string; profile_picture_url?: string; subscription_tier?: string; role?: string; status?: string };
      users?: Array<{ id: number; username: string; profile_picture_url?: string; subscription_tier?: string; role?: string; status?: string }>;
    }>('/api/social/search', {
      method: 'POST',
      body: JSON.stringify({ username }),
    }),
  connectUser: (friendId: number | string) =>
    apiClient<{ success: boolean }>('/api/social/connect', {
      method: 'POST',
      body: JSON.stringify({ friendId }),
    }),
  acceptUser: (friendId: number | string) =>
    apiClient<{ success: boolean }>('/api/social/accept', {
      method: 'POST',
      body: JSON.stringify({ friendId }),
    }),
  declineUser: (friendId: number | string) =>
    apiClient<{ success: boolean }>('/api/social/decline', {
      method: 'POST',
      body: JSON.stringify({ friendId }),
    }),
  rejectUser: (friendId: number | string) =>
    apiClient<{ success: boolean }>('/api/social/decline', {
      method: 'POST',
      body: JSON.stringify({ friendId }),
    }),
  getProfile: (userId: number | string) => apiClient<PublicAthleteProfile>(`/api/social/profile/${userId}`),
  acceptInvite: (inviteId: number | string) =>
    apiClient<{ success: boolean; message?: string }>(`/api/social/invite/${inviteId}/accept`, {
      method: 'POST',
    }),
  declineInvite: (inviteId: number | string) =>
    apiClient<{ success: boolean; message?: string }>(`/api/social/invite/${inviteId}/decline`, {
      method: 'POST',
    }),
};

export interface ZoneBandDto {
  zone: number;
  min: number;
  max: number | null;
}

export interface ZonesResponse {
  sport: string;
  hrZones: ZoneBandDto[] | null;
  powerZones: ZoneBandDto[] | null;
  maxHr: number | null;
  ftp: number | null;
  tables: { sport: string; kind: 'hr' | 'power'; source: string; updatedAt: string; zones: ZoneBandDto[] }[];
}

export const zonesApi = {
  get: (sport: string = 'default') =>
    apiClient<ZonesResponse>(`/api/user/zones?sport=${encodeURIComponent(sport)}`),
  save: (sport: string, kind: 'hr' | 'power', zones: ZoneBandDto[]) =>
    apiClient<{ success: boolean }>('/api/user/zones', {
      method: 'PUT',
      body: JSON.stringify({ sport, kind, zones }),
    }),
  remove: (sport: string) =>
    apiClient<{ success: boolean }>(`/api/user/zones/${encodeURIComponent(sport)}`, {
      method: 'DELETE',
    }),
  reset: (sport: string = 'default') =>
    apiClient<ZonesResponse>('/api/user/zones/reset', {
      method: 'POST',
      body: JSON.stringify({ sport }),
    }),
};

export const notificationsApi = {
  registerToken: (token: string, deviceType: string = 'ios') =>
    apiClient<{ success: boolean; message: string }>('/api/notifications/register-token', {
      method: 'POST',
      body: JSON.stringify({ token, deviceType }),
    }),
  // skipAuthInterceptor: this runs during logout (including after the account
  // was deleted), so a 401 here must not re-trigger the global logout handler.
  unregisterToken: (token: string) =>
    apiClient<{ success: boolean; message: string }>('/api/notifications/unregister-token', {
      method: 'POST',
      body: JSON.stringify({ token }),
      skipAuthInterceptor: true,
    }),
  sendTestNotification: (title?: string, body?: string) =>
    apiClient<{ success: boolean; result?: any }>('/api/notifications/test', {
      method: 'POST',
      body: JSON.stringify({ title, body }),
    }),
};

export const recurringTrainingsApi = {
  getRecurringTrainings: () =>
    apiClient<RecurringTraining[]>('/api/user/recurring-trainings'),
  saveRecurringTraining: (data: Partial<RecurringTraining>) =>
    apiClient<{ success: boolean; id: number; message: string }>('/api/user/recurring-trainings', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteRecurringTraining: (id: number | string) =>
    apiClient<{ success: boolean; message: string }>(`/api/user/recurring-trainings/${id}`, {
      method: 'DELETE',
    }),
};

export const benchmarksApi = {
  getBenchmarks: () =>
    apiClient<BenchmarkTest[]>('/api/benchmarks'),
  createBenchmark: (data: Partial<BenchmarkTest>) =>
    apiClient<{ success: boolean; id: number }>('/api/benchmarks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateBenchmark: (id: number | string, data: Partial<BenchmarkTest>) =>
    apiClient<{ success: boolean; message?: string }>(`/api/benchmarks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteBenchmark: (id: number | string) =>
    apiClient<{ success: boolean; message?: string }>(`/api/benchmarks/${id}`, {
      method: 'DELETE',
    }),
};




