import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import type ReactNativeWorkouts from 'react-native-workouts';
import type {
  ActivityType,
  AuthorizationStatus,
  CustomWorkoutConfig,
  DateComponents,
  IntervalBlock,
  IntervalStep,
  LocationType,
  WorkoutAlert,
  WorkoutGoal,
  WorkoutPlan,
  WorkoutStep as KitWorkoutStep,
} from 'react-native-workouts';
import { PlannedWorkout, WorkoutStep } from '../types/plan';

type WorkoutKitModule = typeof ReactNativeWorkouts;

let cachedModule: WorkoutKitModule | null | undefined;

/**
 * The native module is Apple-only, so `requireNativeModule` throws on Android
 * and in any client that was built without it. Resolving it lazily keeps a
 * missing module from taking down whichever screen imported this file.
 */
function getWorkoutKit(): WorkoutKitModule | null {
  if (cachedModule !== undefined) return cachedModule;

  if (Platform.OS !== 'ios') {
    cachedModule = null;
    return cachedModule;
  }

  try {
    const nativeModule = requireOptionalNativeModule('ReactNativeWorkouts');
    if (nativeModule) {
      cachedModule = (require('react-native-workouts').default as WorkoutKitModule) ?? (nativeModule as WorkoutKitModule);
    } else {
      cachedModule = null;
    }
  } catch (err) {
    cachedModule = null;
  }
  return cachedModule;
}

export interface HealthKitSyncResult {
  success: boolean;
  message: string;
  /** Set when the workout reached the Watch but some targets had to be dropped. */
  degraded?: boolean;
  scheduledId?: string;
  syncedCount?: number;
}

/**
 * WorkoutKit ships in iOS 17. `isAvailable` is a native constant that is false on
 * the Simulator and on devices where Health data is unavailable, so scheduling is
 * only ever attempted when both hold.
 */
export function isWorkoutKitSupported(): boolean {
  if (Platform.OS !== 'ios') return false;
  if (parseInt(String(Platform.Version), 10) < 17) return false;
  return getWorkoutKit()?.isAvailable === true;
}

/** Kept under the old name because callers across the app still import it. */
export const isHealthKitSupported = isWorkoutKitSupported;

export async function getWorkoutKitAuthorizationStatus(): Promise<AuthorizationStatus> {
  const kit = getWorkoutKit();
  if (!kit || !isWorkoutKitSupported()) return 'unknown';
  try {
    return await kit.getAuthorizationStatus();
  } catch (err) {
    console.log('[WorkoutKit] getAuthorizationStatus failed:', describeError(err));
    return 'unknown';
  }
}

/**
 * Prompts for the WorkoutKit scheduling permission. Note this is *not* the Health
 * app permission sheet: the athlete grants and revokes it in the Watch app on the
 * iPhone, under rooka.
 */
export async function requestWorkoutKitAuthorization(): Promise<AuthorizationStatus> {
  const kit = getWorkoutKit();
  if (!kit || !isWorkoutKitSupported()) return 'unknown';
  try {
    return await kit.requestAuthorization();
  } catch (err) {
    console.log('[WorkoutKit] requestAuthorization failed:', describeError(err));
    return 'unknown';
  }
}

/** Back-compat wrapper for callers that only want a yes/no. */
export async function requestAppleHealthPermissions(): Promise<boolean> {
  return (await requestWorkoutKitAuthorization()) === 'authorized';
}

/**
 * Pushes a planned workout into the Workout app on the athlete's Apple Watch.
 *
 * WorkoutKit rejects goals and alerts that the chosen activity does not support
 * (power on a run, pace on a swim, and so on). Rather than failing the whole push
 * for one bad target, an unsupported build is retried once with the alerts
 * stripped, and the caller is told the targets were dropped.
 */
export async function deployWorkoutToAppleWatch(workout: PlannedWorkout): Promise<HealthKitSyncResult> {
  if (Platform.OS !== 'ios') {
    return { success: false, message: 'Apple Watch sync is only available on iPhone.' };
  }
  if (parseInt(String(Platform.Version), 10) < 17) {
    return { success: false, message: 'Sending workouts to Apple Watch needs iOS 17 or newer.' };
  }
  const kit = getWorkoutKit();
  if (!kit) {
    return {
      success: false,
      message:
        'This build of rooka does not include Apple Watch support. Reinstall the latest build and try again.',
    };
  }
  if (kit.isAvailable !== true) {
    return {
      success: false,
      message: 'Apple Health is unavailable on this device, so workouts cannot be sent to a Watch.',
    };
  }

  let status = await getWorkoutKitAuthorizationStatus();
  if (status === 'notDetermined' || status === 'unknown') {
    status = await requestWorkoutKitAuthorization();
  }
  if (status !== 'authorized') {
    return { success: false, message: WORKOUT_KIT_DENIED_MESSAGE };
  }

  const config = buildCustomWorkoutConfig(workout);
  if (!config) {
    return {
      success: false,
      message: `rooka cannot send "${workout.sport}" sessions to Apple Watch.`,
    };
  }

  const date = toDateComponents(workout.date);

  try {
    return await schedule(config, date, false);
  } catch (err) {
    if (!isValidationError(err)) {
      return { success: false, message: describeError(err) };
    }
    // Second pass without alerts: the structure and durations still make it over.
    try {
      return await schedule(stripAlerts(config), date, true);
    } catch (retryErr) {
      return { success: false, message: describeError(retryErr) };
    }
  }
}

/**
 * Opens Apple's own workout preview sheet so the athlete can eyeball the session
 * (and add it to the Watch) before it is scheduled.
 */
export async function previewWorkoutOnAppleWatch(workout: PlannedWorkout): Promise<HealthKitSyncResult> {
  if (!isWorkoutKitSupported()) {
    return { success: false, message: 'Apple Watch preview needs an iPhone on iOS 17 or newer.' };
  }

  const config = buildCustomWorkoutConfig(workout);
  if (!config) {
    return { success: false, message: `rooka cannot preview "${workout.sport}" sessions on Apple Watch.` };
  }

  const kit = getWorkoutKit();
  if (!kit) return { success: false, message: 'Apple Watch preview is unavailable in this build.' };

  let plan: WorkoutPlan | null = null;
  try {
    plan = await kit.createCustomWorkoutPlan(config);
    await plan.preview();
    return { success: true, message: 'Preview opened.' };
  } catch (err) {
    return { success: false, message: describeError(err) };
  } finally {
    plan?.release();
  }
}

export const WORKOUT_KIT_DENIED_MESSAGE =
  'rooka is not allowed to schedule workouts yet. Open the Watch app on your iPhone, tap rooka, and turn on workout scheduling.';

// -----------------------------------------------------------------------------
// rooka steps -> WorkoutKit CustomWorkout
// -----------------------------------------------------------------------------

/**
 * A WorkoutKit CustomWorkout is a single optional warmup, a list of interval
 * blocks, and a single optional cooldown — not the flat list rooka stores. A
 * rooka `repeat` step becomes a block with iterations; every other step becomes a
 * one-iteration block of its own.
 */
export function buildCustomWorkoutConfig(workout: PlannedWorkout): CustomWorkoutConfig | null {
  const activity = getAppleActivity(workout.sport);
  if (!activity) return null;

  const steps = parseSteps(workout);
  const { activityType, locationType } = activity;

  let warmup: KitWorkoutStep | undefined;
  let cooldown: KitWorkoutStep | undefined;
  const blocks: IntervalBlock[] = [];

  for (const step of steps) {
    if (step.type === 'warmup' && !warmup && blocks.length === 0) {
      warmup = toKitStep(step, activityType);
      continue;
    }

    if (step.type === 'repeat') {
      const nested = (step.steps || []).map((s) => toIntervalStep(s, activityType));
      if (nested.length > 0) {
        blocks.push({ iterations: Math.max(1, step.iterations || 1), steps: nested });
      }
      continue;
    }

    blocks.push({ iterations: 1, steps: [toIntervalStep(step, activityType)] });
  }

  // Only the trailing cooldown can move into the cooldown slot; an early one has
  // to stay in the blocks so the order the coach wrote is preserved.
  const last = blocks[blocks.length - 1];
  if (last && last.iterations === 1 && last.steps.length === 1) {
    const lastSource = steps[steps.length - 1];
    if (lastSource && lastSource.type === 'cooldown') {
      cooldown = { goal: last.steps[0].goal, alert: last.steps[0].alert };
      blocks.pop();
    }
  }

  if (blocks.length === 0) {
    // WorkoutKit needs something to run; fall back to the planned duration.
    blocks.push({
      iterations: 1,
      steps: [{ purpose: 'work', goal: { type: 'time', value: estimateMinutes(workout), unit: 'minutes' } }],
    });
  }

  return {
    activityType,
    locationType,
    displayName: workout.description || workout.title || `${workout.sport} Workout`,
    warmup,
    blocks,
    cooldown,
  };
}

function toIntervalStep(step: WorkoutStep, activityType: ActivityType): IntervalStep {
  const kit = toKitStep(step, activityType);
  return {
    purpose: step.type === 'recovery' || step.type === 'rest' ? 'recovery' : 'work',
    goal: kit.goal,
    alert: kit.alert,
  };
}

function toKitStep(step: WorkoutStep, activityType: ActivityType): KitWorkoutStep {
  // Warmup steps are meant for ramping up from resting heart rate.
  // Attaching a strict heart rate zone alert to a warmup causes Apple Watch to chime
  // and vocalize "Below Zone" every 20 seconds while the athlete is still cold.
  const isColdWarmup = step.type === 'warmup' && step.target_type === 'heart.rate.zone';
  const alert = isColdWarmup ? undefined : toAlert(step, activityType);
  return { goal: toGoal(step), alert };
}

/**
 * rooka's units, matching the Garmin exporter on the server: `time` is minutes,
 * `time_sec` is seconds, `distance` is metres and `distance_km` is kilometres.
 */
function toGoal(step: WorkoutStep): WorkoutGoal {
  const value = step.condition_value;
  if (!value || value <= 0) return { type: 'open' };

  switch (step.condition_type) {
    case 'time':
      return { type: 'time', value, unit: 'minutes' };
    case 'time_sec':
      return { type: 'time', value, unit: 'seconds' };
    case 'distance':
      return { type: 'distance', value, unit: 'meters' };
    case 'distance_km':
      return { type: 'distance', value, unit: 'kilometers' };
    // WorkoutKit has no rep goal. An open step lets the athlete work through the
    // set and tap to advance, which is the closest honest equivalent.
    case 'reps':
      return { type: 'open' };
    default:
      return { type: 'time', value, unit: 'minutes' };
  }
}

/**
 * WorkoutKit validates alerts against the activity, so only the combinations it
 * accepts are offered: heart rate anywhere, pace on foot sports, power and speed
 * on the bike.
 */
function toAlert(step: WorkoutStep, activityType: ActivityType): WorkoutAlert | undefined {
  const onFoot = activityType === 'running' || activityType === 'walking' || activityType === 'hiking';
  const onBike = activityType === 'cycling';

  switch (step.target_type) {
    case 'heart.rate.zone': {
      const zone = Number(step.zone);
      if (!Number.isFinite(zone) || zone < 1 || zone > 5) return undefined;
      return { type: 'heartRate', zone };
    }

    case 'pace.exact':
    case 'pace.zone': {
      if (!onFoot) return undefined;
      const minPerKm = parsePaceMinutes(step.target_value);
      if (!minPerKm) return undefined;
      // ±5%, matching the band the Garmin exporter builds around an exact pace.
      return { type: 'pace', min: minPerKm * 0.95, max: minPerKm * 1.05, unit: 'minutesPerKilometer' };
    }

    case 'power.exact':
    case 'power.zone': {
      if (!onBike) return undefined;
      const watts = parseNumeric(step.target_value);
      if (!watts) return undefined;
      return { type: 'power', min: watts * 0.9, max: watts * 1.1 };
    }

    case 'speed.exact':
    case 'speed.zone': {
      if (!onBike) return undefined;
      const kph = parseNumeric(step.target_value);
      if (!kph) return undefined;
      return { type: 'speed', min: kph * 0.95, max: kph * 1.05, unit: 'kilometersPerHour' };
    }

    default:
      return undefined;
  }
}

function getAppleActivity(sport: string): { activityType: ActivityType; locationType: LocationType } | null {
  switch ((sport || '').toUpperCase()) {
    case 'RUN':
      return { activityType: 'running', locationType: 'outdoor' };
    case 'BIKE':
      return { activityType: 'cycling', locationType: 'outdoor' };
    // WorkoutKit reads `indoor` as pool swimming, which is what rooka's
    // metre-based swim steps describe.
    case 'SWIM':
      return { activityType: 'swimming', locationType: 'indoor' };
    case 'STRENGTH':
      return { activityType: 'traditionalStrengthTraining', locationType: 'indoor' };
    case 'MOBILITY':
      return { activityType: 'yoga', locationType: 'indoor' };
    default:
      return null;
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

async function schedule(
  config: CustomWorkoutConfig,
  date: DateComponents,
  degraded: boolean,
): Promise<HealthKitSyncResult> {
  const kit = getWorkoutKit();
  if (!kit) throw new Error('Apple Watch support is unavailable in this build.');

  let plan: WorkoutPlan | null = null;
  try {
    plan = await kit.createCustomWorkoutPlan(config);
    const result = await plan.scheduleAndSync(date);
    return {
      success: true,
      degraded,
      scheduledId: result.id,
      message: degraded
        ? `"${config.displayName}" is on your Apple Watch, but Apple does not support those targets for this sport, so the steps went over without them.`
        : `"${config.displayName}" is on your Apple Watch.`,
    };
  } finally {
    plan?.release();
  }
}

function stripAlerts(config: CustomWorkoutConfig): CustomWorkoutConfig {
  return {
    ...config,
    warmup: config.warmup ? { goal: config.warmup.goal } : undefined,
    cooldown: config.cooldown ? { goal: config.cooldown.goal } : undefined,
    blocks: config.blocks.map((block) => ({
      iterations: block.iterations,
      steps: block.steps.map((step) => ({ purpose: step.purpose, goal: step.goal })),
    })),
  };
}

function parseSteps(workout: PlannedWorkout): WorkoutStep[] {
  const raw = workout.steps_json ?? workout.steps;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** WorkoutKit schedules against calendar components, not an instant in time. */
function toDateComponents(dateStr: string): DateComponents {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr || '');
  const base = match
    ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
    : (() => {
        const now = new Date();
        return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
      })();

  // rooka plans days, not clock times. Scheduling at 06:00 keeps the session at
  // the top of the Watch's Workout list for the whole training day.
  return { ...base, hour: 6, minute: 0 };
}

function estimateMinutes(workout: PlannedWorkout): number {
  const points = workout.target_rooka || workout.rookaPoints || 55;
  return Math.max(5, Math.round((points / 55) * 60));
}

/** rooka stores exact paces as "M:SS" per kilometre, with no unit suffix. */
function parsePaceMinutes(value?: string): number | null {
  if (!value) return null;
  const match = /(\d+):(\d{1,2})/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) + Number(match[2]) / 60;
  return minutes > 0 ? minutes : null;
}

function parseNumeric(value?: string): number | null {
  if (!value) return null;
  const match = /(\d+(?:\.\d+)?)/.exec(value);
  if (!match) return null;
  const num = Number(match[1]);
  return num > 0 ? num : null;
}

function isValidationError(err: any): boolean {
  const text = `${err?.code || ''} ${err?.name || ''} ${err?.message || ''}`;
  return /ValidationError|Unsupported|InvalidAlert/i.test(text);
}

function describeError(err: any): string {
  if (!err) return 'Something went wrong sending this workout to your Apple Watch.';
  if (typeof err === 'string') return err;
  return err.message || err.code || 'Something went wrong sending this workout to your Apple Watch.';
}
