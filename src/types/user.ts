export type SubscriptionTier = 'free' | 'subscription' | 'rooka_plus' | 'premium' | 'admin';

export interface UserProfile {
  id: number;
  username: string;
  email?: string;
  subscription_tier: SubscriptionTier;
  total_rooka: number;
  level: number;
  gender?: string;
  last_cycle_start?: string;
  cycle_tracking_enabled?: boolean;
  coach_tone: string;
  coach_name?: string;
  coach_context?: string;
  coach_avatar_neutral?: string;
  coach_avatar_hype?: string;
  coach_avatar_disappointed?: string;
  athlete_context?: string;
  long_term_memory?: string;
  profile_picture_url?: string;
  garmin_connected?: boolean;
  strava_connected?: boolean;
  target_event?: string;
  event_date?: string;
  target_ctl?: number;
  current_ctl?: number;
  goal_type?: 'race' | 'physiological';
  goalType?: 'race' | 'physiological';
  target_mode?: string;
  targetMode?: string;
  target_value?: string;
  targetValue?: string;
  target_weight?: number | string | null;
  targetWeight?: number | string | null;
  target_vo2max?: number | string | null;
  targetVo2max?: number | string | null;
  daily_availability?: Record<string, number>; // e.g. { MON: 45, TUE: 45, WED: 60, THU: 45, FRI: 60, SAT: 90, SUN: 45 }
  training_availability?: Record<string, { available: boolean; maxMinutes: number }> | string;
  trainingAvailability?: Record<string, { available: boolean; maxMinutes: number }> | string;
  athlete_metrics?: {
    max_hr?: number;
    resting_hr?: number;
    ftp?: number;
    weight_kg?: number;
  };
  daily_token_usage?: number;
  dailyTokenUsage?: number;
  daily_token_limit?: number;
  dailyTokenLimit?: number;
  onboarding_completed?: boolean;
  /** Set by the server when the athlete has no training zone table yet. */
  needsZoneSetup?: boolean;
  streak_days?: number;
}

export interface GoalMilestone {
  id: string;
  name: string;
  eventName?: string;
  date: string;
  eventDate?: string;
  target_ctl?: number;
  targetCtl?: number;
  is_main: boolean;
  isARace?: boolean;
  goal_type: 'race' | 'physiological';
  goalType?: 'race' | 'physiological';
  target_mode: 'finish' | 'time' | 'weight' | 'vo2max' | 'custom';
  targetMode?: 'finish' | 'time' | 'weight' | 'vo2max' | 'custom';
  target_value?: string;
  targetValue?: string;
  target_weight?: number | string;
  targetWeight?: number | string;
  target_vo2max?: number | string;
  targetVo2max?: number | string;
  artwork_url?: string;
}

export interface RecurringTraining {
  id: number | string;
  user_id?: number;
  title: string;
  day_of_week: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun' | string;
  start_time?: string;
  duration_minutes: number;
  sport: string;
  intensity?: 'easy' | 'moderate' | 'hard' | string;
  is_active?: boolean | number;
  created_at?: string;
}

export interface BenchmarkTest {
  id: number;
  user_id?: number;
  sport_type: string;
  test_name: string;
  metrics_json?: string | Record<string, any>;
  coach_notes?: string;
  completed_at?: string;
  created_at?: string;
}

