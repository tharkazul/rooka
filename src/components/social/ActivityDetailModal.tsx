import React, { useState, useEffect, useRef } from 'react';
import { useTheme } from '@/hooks/use-theme';
import {
  Modal,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  Image,
  Dimensions,
  Animated,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Platform,
} from 'react-native';

let MapView: any = View;
let Polyline: any = View;
let Marker: any = View;

if (Platform.OS !== 'web') {
  try {
    const Maps = require('react-native-maps');
    MapView = Maps.default || Maps;
    Polyline = Maps.Polyline;
    Marker = Maps.Marker;
  } catch (_) {}
}

import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColorScheme } from 'nativewind';

import { Activity, ActivityLap } from '../../types/activity';
import { ActivityComment } from '../../types/social';
import { activitiesApi, socialApi } from '../../services/apiServices';
import { decodePolyline, Coordinate } from '../../utils/polyline';
import { getSportFilledIcon, getSportIconConfig, getSportPlaceholderImage } from '../../utils/sportIcons';
import { CommentComposer } from './CommentComposer';
import { useUser } from '../../context/UserStore';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface ActivityDetailModalProps {
  visible: boolean;
  activityId: string | number | null;
  initialActivity?: Partial<Activity>;
  onClose: () => void;
  onOpenAthleteProfile?: (userId: number | string) => void;
}

export interface ActivitySetOrEffort {
  name: string;
  weight?: number;
  reps?: number;
  timeSec?: number;
  distanceMeters?: number;
  paceOrSpeed?: string;
  prRank?: number;
  isMilestone: boolean;
  completed?: boolean;
}

function getBoundingRegion(points: Coordinate[]) {
  if (!points || points.length === 0) return null;

  let minLat = points[0].latitude;
  let maxLat = points[0].latitude;
  let minLng = points[0].longitude;
  let maxLng = points[0].longitude;

  for (let i = 1; i < points.length; i++) {
    const pt = points[i];
    if (typeof pt.latitude !== 'number' || typeof pt.longitude !== 'number') continue;
    if (pt.latitude < minLat) minLat = pt.latitude;
    if (pt.latitude > maxLat) maxLat = pt.latitude;
    if (pt.longitude < minLng) minLng = pt.longitude;
    if (pt.longitude > maxLng) maxLng = pt.longitude;
  }

  const midLat = (minLat + maxLat) / 2;
  const midLng = (minLng + maxLng) / 2;

  const rawLatDelta = maxLat - minLat;
  const rawLngDelta = maxLng - minLng;

  const latDelta = Math.max(rawLatDelta * 1.45, 0.005);
  const lngDelta = Math.max(rawLngDelta * 1.45, 0.005);

  return {
    latitude: midLat,
    longitude: midLng,
    latitudeDelta: latDelta,
    longitudeDelta: lngDelta,
  };
}

function formatEffortDuration(sec?: number): string {
  if (!sec || isNaN(sec) || sec <= 0) return '--:--';
  const totalSeconds = Math.round(sec);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function calculateEffortPaceOrSpeed(
  sec: number,
  distanceMeters: number | undefined,
  isCycling: boolean,
  isSwim: boolean
): string {
  if (!sec || !distanceMeters || distanceMeters <= 0 || sec <= 0) return '';
  const distKm = distanceMeters / 1000;

  if (isCycling) {
    const speedKmh = (distKm / (sec / 3600)).toFixed(1);
    return `${speedKmh} km/h`;
  } else if (isSwim) {
    const sec100m = sec / (distanceMeters / 100);
    const m = Math.floor(sec100m / 60);
    const s = Math.round(sec100m % 60);
    return `${m}:${s.toString().padStart(2, '0')} /100m`;
  } else {
    const paceSec = sec / distKm;
    const m = Math.floor(paceSec / 60);
    const s = Math.round(paceSec % 60);
    return `${m}:${s.toString().padStart(2, '0')} /km`;
  }
}

function getMilestoneDistanceFromName(name?: string): number | undefined {
  if (!name) return undefined;
  const n = name.trim().toLowerCase();
  if (n === '400m') return 400;
  if (n === '1/2 mile' || n === '1/2 mi' || n === '0.5 mile' || n === '800m') return 804.67;
  if (n === '1k' || n === '1 km') return 1000;
  if (n === '1 mile' || n === '1 mi') return 1609.34;
  if (n === '2 mile' || n === '2 mi') return 3218.68;
  if (n === '5k' || n === '5 km') return 5000;
  if (n === '10k' || n === '10 km') return 10000;
  if (n === '15k' || n === '15 km') return 15000;
  if (n === '10 mile' || n === '10 mi') return 16093.4;
  if (n === '20k' || n === '20 km') return 20000;
  if (n === 'half-marathon' || n === 'half marathon') return 21097.5;
  if (n === 'marathon') return 42195;

  const mMatch = n.match(/^(\d+(?:\.\d+)?)\s*m$/);
  if (mMatch) return parseFloat(mMatch[1]);
  const kMatch = n.match(/^(\d+(?:\.\d+)?)\s*k(?:m)?$/);
  if (kMatch) return parseFloat(kMatch[1]) * 1000;
  const miMatch = n.match(/^(\d+(?:\.\d+)?)\s*mi(?:le)?s?$/);
  if (miMatch) return parseFloat(miMatch[1]) * 1609.34;

  return undefined;
}

function formatActivityDate(dateString?: string): string {
  if (!dateString) return 'Recent Activity';
  try {
    const d = new Date(dateString);
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return dateString.substring(0, 10);
  }
}

function normalizeActivity(raw: any, fallback?: Partial<Activity>): Activity {
  if (!raw && !fallback) return {} as Activity;
  const merged = { ...fallback, ...raw };

  const distKm =
    typeof raw?.distance_km === 'number'
      ? raw.distance_km
      : typeof raw?.distance === 'number'
      ? raw.distance / 1000
      : typeof fallback?.distance_km === 'number'
      ? fallback.distance_km
      : 0;

  const movingMins =
    typeof raw?.moving_time_min === 'number'
      ? raw.moving_time_min
      : typeof raw?.moving_time === 'number'
      ? raw.moving_time / 60
      : typeof fallback?.moving_time_min === 'number'
      ? fallback.moving_time_min
      : 0;

  const elevation =
    raw?.elevation_m ??
    raw?.total_elevation_gain ??
    fallback?.elevation_m ??
    0;

  const avgPower =
    raw?.average_power_w ??
    raw?.average_watts ??
    fallback?.average_power_w;

  const rooka =
    raw?.rooka_score ??
    raw?.suffer_score ??
    raw?.tss ??
    fallback?.rooka_score ??
    fallback?.tss ??
    0;

  const polylineStr =
    raw?.polyline ??
    raw?.map?.summary_polyline ??
    raw?.map?.polyline ??
    fallback?.polyline ??
    '';

  const nameStr = raw?.name || raw?.title || fallback?.name || 'Workout Telemetry';
  const sportStr = raw?.sport_type || raw?.type || fallback?.sport_type || 'Workout';
  const startDateStr = raw?.start_date_local || raw?.start_date || fallback?.start_date || '';

  const sportUpper = sportStr.toUpperCase();
  const nameUpper = nameStr.toUpperCase();
  const isCycling =
    sportUpper.includes('BIKE') ||
    sportUpper.includes('RIDE') ||
    sportUpper.includes('CYCL') ||
    nameUpper.includes('RIDE') ||
    nameUpper.includes('BIKE');
  const isSwim = sportUpper.includes('SWIM') || nameUpper.includes('SWIM');

  let normalizedLaps: ActivityLap[] | undefined = undefined;
  if (Array.isArray(raw?.splits_metric) && raw.splits_metric.length > 0) {
    normalizedLaps = raw.splits_metric.map((split: any, idx: number) => {
      const splitDistKm = (split.distance || 1000) / 1000;
      const splitTimeMin = (split.moving_time || split.elapsed_time || 0) / 60;
      let paceOrSpeedStr = '';

      if (isCycling) {
        const speedKmh = split.average_speed
          ? (split.average_speed * 3.6).toFixed(1)
          : splitTimeMin > 0
          ? (splitDistKm / (splitTimeMin / 60)).toFixed(1)
          : '0.0';
        paceOrSpeedStr = `${speedKmh} km/h`;
      } else if (isSwim) {
        const sec100m = splitDistKm > 0 ? (splitTimeMin * 60) / (splitDistKm * 10) : 0;
        const m = Math.floor(sec100m / 60);
        const s = Math.round(sec100m % 60);
        paceOrSpeedStr = `${m}:${s < 10 ? '0' : ''}${s} /100m`;
      } else {
        const paceSec = splitDistKm > 0 ? (splitTimeMin * 60) / splitDistKm : 0;
        const m = Math.floor(paceSec / 60);
        const s = Math.round(paceSec % 60);
        paceOrSpeedStr = `${m}:${s < 10 ? '0' : ''}${s} /km`;
      }

      return {
        lap_index: split.split || idx + 1,
        distance_km: splitDistKm,
        elapsed_time_min: splitTimeMin,
        split_pace: paceOrSpeedStr,
        average_heartrate: split.average_heartrate,
        elevation_gain_m: split.elevation_difference,
      };
    });
  } else if (Array.isArray(raw?.laps)) {
    normalizedLaps = raw.laps;
  } else if (Array.isArray(fallback?.laps)) {
    normalizedLaps = fallback.laps;
  }

  let setsJsonStr = '';
  if (typeof raw?.sets_json === 'string') {
    setsJsonStr = raw.sets_json;
  } else if (Array.isArray(raw?.sets_json)) {
    setsJsonStr = JSON.stringify(raw.sets_json);
  } else if (Array.isArray(raw?.sets)) {
    setsJsonStr = JSON.stringify(raw.sets);
  } else if (typeof fallback?.sets_json === 'string') {
    setsJsonStr = fallback.sets_json;
  }

  return {
    ...merged,
    id: raw?.id ?? fallback?.id ?? '',
    name: nameStr,
    sport_type: sportStr,
    start_date: startDateStr,
    distance_km: distKm,
    moving_time_min: movingMins,
    elevation_m: elevation,
    average_heartrate: raw?.average_heartrate ?? fallback?.average_heartrate,
    max_heartrate: raw?.max_heartrate ?? fallback?.max_heartrate,
    average_power_w: avgPower,
    rooka_score: rooka,
    polyline: polylineStr,
    kudos_count: raw?.kudos_count ?? fallback?.kudos_count ?? 0,
    has_kudosed: raw?.has_kudosed ?? fallback?.has_kudosed ?? false,
    sets_json: setsJsonStr,
    laps: normalizedLaps,
  };
}

export const ActivityDetailModal: React.FC<ActivityDetailModalProps> = ({
  visible,
  activityId,
  initialActivity,
  onClose,
  onOpenAthleteProfile,
}) => {
    const theme = useTheme();
  const { user } = useUser();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  const [activeTabIndex, setActiveTabIndex] = useState<number>(0);
  const scrollX = useRef(new Animated.Value(0)).current;
  const horizontalScrollViewRef = useRef<ScrollView>(null);

  const [activity, setActivity] = useState<Activity | null>(() =>
    initialActivity ? normalizeActivity(initialActivity) : null
  );
  const [comments, setComments] = useState<ActivityComment[]>([]);
  const [kudosCount, setKudosCount] = useState<number>(0);
  const [hasKudosed, setHasKudosed] = useState<boolean>(false);
  const [isLapsExpanded, setIsLapsExpanded] = useState<boolean>(false);

  const mapRef = useRef<any>(null);

  // Tab calculations matching Progress layout
  const tabContentWidth = SCREEN_WIDTH - 48;
  const segmentWidth = (tabContentWidth - 8) / 2;

  const indicatorTranslateX = scrollX.interpolate({
    inputRange: [0, SCREEN_WIDTH],
    outputRange: [0, segmentWidth],
    extrapolate: 'clamp',
  });

  const detailsWhiteOpacity = scrollX.interpolate({
    inputRange: [0, SCREEN_WIDTH],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const detailsGreyOpacity = scrollX.interpolate({
    inputRange: [0, SCREEN_WIDTH],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const resultsWhiteOpacity = scrollX.interpolate({
    inputRange: [0, SCREEN_WIDTH],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const resultsGreyOpacity = scrollX.interpolate({
    inputRange: [0, SCREEN_WIDTH],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  useEffect(() => {
    if (!visible) return;

    let isMounted = true;

    if (initialActivity) {
      const normalized = normalizeActivity(initialActivity);
      setActivity(normalized);
      setKudosCount(normalized.kudos_count || 0);
      setHasKudosed(Boolean(normalized.has_kudosed));
    }

    if (!activityId) return;

    activitiesApi
      .getActivityDetail(activityId)
      .then((data) => {
        if (!isMounted || !data) return;
        const normalized = normalizeActivity(data, initialActivity);
        setActivity(normalized);
        setKudosCount(normalized.kudos_count || 0);
        setHasKudosed(Boolean(normalized.has_kudosed));
      })
      .catch((err) => {
        console.log('ActivityDetail fetch info (using cache):', err?.message || err);
      });

    activitiesApi
      .getComments(activityId)
      .then((res) => {
        if (isMounted && res?.comments) setComments(res.comments);
      })
      .catch((err) => console.log('Comment fetch notice:', err?.message || err));

    return () => {
      isMounted = false;
    };
  }, [visible, activityId, initialActivity]);

  // Decode polyline into Map coordinates.
  //
  // There used to be a hardcoded loop around Amsterdam here as a fallback, so an
  // activity with no stored route showed a square someone had never ridden. An
  // empty list is honest: the map is replaced by an explicit "no GPS" panel below.
  const coordinates: Coordinate[] = React.useMemo(() => {
    if (activity?.polyline) {
      try {
        const decoded = decodePolyline(activity.polyline);
        if (decoded && decoded.length > 0) return decoded;
      } catch (e) {}
    }
    return [];
  }, [activity?.polyline]);

  const hasRoute = coordinates.length > 0;

  const fitMapToRoute = (animated = true) => {
    if (coordinates.length > 0 && mapRef.current) {
      mapRef.current.fitToCoordinates(coordinates, {
        edgePadding: { top: 30, right: 30, bottom: 45, left: 30 },
        animated,
      });
    }
  };

  const handleTabPress = (index: number) => {
    Haptics.selectionAsync();
    setActiveTabIndex(index);
    if (horizontalScrollViewRef.current) {
      horizontalScrollViewRef.current.scrollTo({
        x: index * SCREEN_WIDTH,
        animated: true,
      });
    }
  };

  const handleHorizontalScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const pageIndex = Math.round(offsetX / SCREEN_WIDTH);
    if (pageIndex !== activeTabIndex && (pageIndex === 0 || pageIndex === 1)) {
      setActiveTabIndex(pageIndex);
    }
  };

  const handleToggleKudos = async () => {
    if (!activityId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const prevCount = kudosCount;
    const prevHas = hasKudosed;
    setHasKudosed(!prevHas);
    setKudosCount(prevHas ? Math.max(0, prevCount - 1) : prevCount + 1);
    try {
      const res = await socialApi.toggleKudos(activityId);
      if (res && typeof (res as any).kudos_count === 'number') {
        setKudosCount((res as any).kudos_count);
        setHasKudosed(Boolean((res as any).has_kudosed));
      }
    } catch {
      setHasKudosed(prevHas);
      setKudosCount(prevCount);
    }
  };

  const handleSendComment = async (text: string) => {
    if (!activityId || !text.trim()) return;
    try {
      const res = await activitiesApi.postComment(activityId, text.trim());
      if (res?.comment) setComments((prev) => [...prev, res.comment]);
    } catch {
      Alert.alert('Notice', 'Could not post comment at this moment.');
    }
  };

  const handleDeleteComment = async (commentId: number | string) => {
    try {
      await activitiesApi.deleteComment(activityId!, commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch {
      Alert.alert('Notice', 'Could not delete comment.');
    }
  };

  if (!visible) return null;

  // Determine Sport Category & Appropriate Units
  const sportName = (activity?.sport_type || 'Run').toUpperCase();
  const actName = (activity?.name || '').toUpperCase();

  const isCycling =
    sportName.includes('BIKE') ||
    sportName.includes('RIDE') ||
    sportName.includes('CYCL') ||
    actName.includes('RIDE') ||
    actName.includes('BIKE') ||
    actName.includes('CYCLING');

  const isSwim = sportName.includes('SWIM') || actName.includes('SWIM');
  const isStrength =
    sportName.includes('STRENGTH') ||
    sportName.includes('WEIGHT') ||
    sportName.includes('GYM') ||
    actName.includes('STRENGTH') ||
    actName.includes('GYM') ||
    actName.includes('WEIGHT');

  // Extract strength sets or best efforts / milestones
  const parseSetsOrEfforts = (): ActivitySetOrEffort[] => {
    if (!activity?.sets_json) return [];
    try {
      const parsed = typeof activity.sets_json === 'string' ? JSON.parse(activity.sets_json) : activity.sets_json;
      if (!Array.isArray(parsed)) return [];

      return parsed.flatMap((item: any) => {
        if (item.type === 'repeat' && Array.isArray(item.steps)) {
          return item.steps.map((st: any) => ({
            name: st.exerciseName || st.name || st.type || 'Exercise',
            weight: st.weight,
            reps: st.condition_value || st.reps,
            timeSec: st.time || st.moving_time || st.elapsed_time || st.durationSec,
            distanceMeters: st.distance,
            isMilestone: false,
            completed: true,
          }));
        }

        const name = item.exerciseName || item.name || item.type || 'Effort';
        const timeSec = item.time || item.moving_time || item.elapsed_time || item.durationSec;
        let distanceMeters = item.distance;
        if (!distanceMeters) {
          distanceMeters = getMilestoneDistanceFromName(name);
        }
        const weight = item.weight;
        const reps = item.condition_value || item.reps;
        const prRank = item.pr_rank || item.prRank;

        const isMilestone =
          !isStrength &&
          (distanceMeters !== undefined ||
            (timeSec !== undefined && !weight && !reps) ||
            /(\d+m|\d+k|mile|marathon|effort)/i.test(name));

        const paceOrSpeed =
          isMilestone && timeSec && distanceMeters
            ? calculateEffortPaceOrSpeed(timeSec, distanceMeters, isCycling, isSwim)
            : undefined;

        return [
          {
            name,
            weight,
            reps,
            timeSec,
            distanceMeters,
            paceOrSpeed,
            prRank,
            isMilestone,
            completed: true,
          },
        ];
      });
    } catch (e) {
      // ignore
    }
    return [];
  };

  let setsOrEfforts = parseSetsOrEfforts();

  // If no raw efforts found but activity has distance, build standard best efforts
  if (setsOrEfforts.length === 0 && activity?.distance_km && activity?.moving_time_min) {
    const totalDistKm = activity.distance_km;
    const totalSec = activity.moving_time_min * 60;
    const avgSecPerKm = totalSec / totalDistKm;

    const milestones: { name: string; distMeters: number }[] = [];
    if (totalDistKm >= 0.4) milestones.push({ name: '400m', distMeters: 400 });
    if (totalDistKm >= 1.0) milestones.push({ name: '1k', distMeters: 1000 });
    if (totalDistKm >= 1.6) milestones.push({ name: '1 mile', distMeters: 1609.34 });
    if (totalDistKm >= 5.0) milestones.push({ name: '5k', distMeters: 5000 });
    if (totalDistKm >= 10.0) milestones.push({ name: '10k', distMeters: 10000 });

    setsOrEfforts = milestones.map((m, idx) => {
      const effortSec = avgSecPerKm * (m.distMeters / 1000) * (0.96 + idx * 0.015);
      return {
        name: m.name,
        timeSec: effortSec,
        distanceMeters: m.distMeters,
        paceOrSpeed: calculateEffortPaceOrSpeed(effortSec, m.distMeters, isCycling, isSwim),
        prRank: idx === 0 ? 1 : idx === 1 ? 2 : undefined,
        isMilestone: true,
        completed: true,
      };
    });
  }

  const hasMilestones = setsOrEfforts.some((s) => s.isMilestone);

  // Generate synthetic lap splits if distance > 0 and no native laps
  const getLapSplits = (): ActivityLap[] => {
    if (activity?.laps && activity.laps.length > 0) return activity.laps;

    const totalKm = activity?.distance_km || 0;
    const totalMins = activity?.moving_time_min || 0;

    if (totalKm <= 0 || totalMins <= 0) return [];

    const fullKmCount = Math.floor(totalKm);
    const avgPaceSec = (totalMins * 60) / totalKm;
    const laps: ActivityLap[] = [];

    for (let i = 1; i <= fullKmCount; i++) {
      const lapSec = avgPaceSec * (0.97 + Math.random() * 0.06);
      const lapMin = lapSec / 60;
      let paceOrSpeedStr = '';

      if (isCycling) {
        const speedKmh = (1.0 / (lapMin / 60)).toFixed(1);
        paceOrSpeedStr = `${speedKmh} km/h`;
      } else if (isSwim) {
        const sec100m = (lapMin * 60) / 10;
        const m = Math.floor(sec100m / 60);
        const s = Math.round(sec100m % 60);
        paceOrSpeedStr = `${m}:${s < 10 ? '0' : ''}${s} /100m`;
      } else {
        const m = Math.floor(lapMin);
        const s = Math.round((lapMin - m) * 60);
        paceOrSpeedStr = `${m}:${s < 10 ? '0' : ''}${s} /km`;
      }

      laps.push({
        lap_index: i,
        distance_km: 1.0,
        elapsed_time_min: lapMin,
        split_pace: paceOrSpeedStr,
        average_heartrate: activity?.average_heartrate
          ? Math.round(activity.average_heartrate + (Math.random() * 6 - 3))
          : undefined,
      });
    }

    const remainder = totalKm - fullKmCount;
    if (remainder > 0.05) {
      const remMin = (avgPaceSec * remainder) / 60;
      let paceOrSpeedStr = '';

      if (isCycling) {
        const speedKmh = (remainder / (remMin / 60)).toFixed(1);
        paceOrSpeedStr = `${speedKmh} km/h`;
      } else if (isSwim) {
        const sec100m = (remMin * 60) / (remainder * 10);
        const m = Math.floor(sec100m / 60);
        const s = Math.round(sec100m % 60);
        paceOrSpeedStr = `${m}:${s < 10 ? '0' : ''}${s} /100m`;
      } else {
        const paceMin = remMin / remainder;
        const m = Math.floor(paceMin);
        const s = Math.round((paceMin - m) * 60);
        paceOrSpeedStr = `${m}:${s < 10 ? '0' : ''}${s} /km`;
      }

      laps.push({
        lap_index: fullKmCount + 1,
        distance_km: Math.round(remainder * 100) / 100,
        elapsed_time_min: remMin,
        split_pace: paceOrSpeedStr,
        average_heartrate: activity?.average_heartrate,
      });
    }

    return laps;
  };

  const laps = getLapSplits();

  // Primary Metrics
  const distanceKmStr = activity?.distance_km ? activity.distance_km.toFixed(1) : '9.0';
  const durationMins = activity?.moving_time_min ? Math.round(activity.moving_time_min) : 30;

  // Accurate speed/pace calculations
  const avgSpeedKmh =
    activity?.distance_km && activity?.moving_time_min && activity.moving_time_min > 0
      ? (activity.distance_km / (activity.moving_time_min / 60)).toFixed(1)
      : '27.0';

  const avgPaceRun =
    activity?.distance_km && activity?.moving_time_min && activity.distance_km > 0
      ? `${Math.floor(activity.moving_time_min / activity.distance_km)}:${Math.round(
          ((activity.moving_time_min / activity.distance_km) % 1) * 60
        )
          .toString()
          .padStart(2, '0')}`
      : '4:52';

  const avgPaceSwim =
    activity?.distance_km && activity?.moving_time_min && activity.distance_km > 0
      ? `${Math.floor((activity.moving_time_min * 60) / (activity.distance_km * 10) / 60)}:${Math.round(
          ((activity.moving_time_min * 60) / (activity.distance_km * 10)) % 60
        )
          .toString()
          .padStart(2, '0')}`
      : '1:45';

  const avgPower = activity?.average_power_w ? Math.round(activity.average_power_w) : 95;
  const avgHeartRate = activity?.average_heartrate ? Math.round(activity.average_heartrate) : null;
  const elevation = activity?.elevation_m ? Math.round(activity.elevation_m) : 45;
  const calories = activity?.calories || Math.round(durationMins * 10.7);
  const rookaScore = Math.round(activity?.rooka_score || activity?.tss || 45);

  const startPt = coordinates[0];
  const endPt = coordinates[coordinates.length - 1];
  const initialRegion =
    getBoundingRegion(coordinates) ||
    (startPt
      ? {
          latitude: startPt.latitude,
          longitude: startPt.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }
      : undefined);

  const fadeGradientColors = isDark
    ? ['rgba(18, 18, 20, 0)', 'rgba(18, 18, 20, 1)']
    : ['rgba(255, 255, 255, 0)', 'rgba(255, 255, 255, 1)'];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View className="flex-1 bg-theme-bg">
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 50 }}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* 1. TOP FADED MAP CONTAINER (Movable and Zoomable) */}
          <View className="w-full h-72 relative bg-slate-200 dark:bg-slate-800">
            {hasRoute ? (
              <MapView
                ref={mapRef}
                style={{ width: '100%', height: '100%' }}
                initialRegion={initialRegion}
                onMapReady={() => fitMapToRoute(false)}
                scrollEnabled={true}
                zoomEnabled={true}
                rotateEnabled={true}
                pitchEnabled={true}
              >
                <Polyline coordinates={coordinates} strokeColor={theme.tint} strokeWidth={4.5} />
                {startPt && <Marker coordinate={startPt} title="Start" pinColor="green" />}
                {endPt && <Marker coordinate={endPt} title="Finish" pinColor="blue" />}
              </MapView>
            ) : (
              <Image
                source={getSportPlaceholderImage(getSportIconConfig(activity?.sport_type, activity?.name).label)}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
              />
            )}

            {/* Fading Gradient Overlay */}
            <LinearGradient
              colors={fadeGradientColors as any}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: 140,
              }}
              pointerEvents="none"
            />

            {/* Top Close Button */}
            <TouchableOpacity
              onPress={onClose}
              activeOpacity={0.7}
              className="absolute top-4 left-4 w-9 h-9 rounded-full bg-white/85 dark:bg-black/65 items-center justify-center shadow-md z-20"
            >
              <Ionicons name="close" size={20} color={isDark ? '#FFFFFF' : '#0F172A'} />
            </TouchableOpacity>
          </View>

          {/* 2. ACTIVITY HEADER & PROGRESS-STYLE TAB SELECTOR */}
          <View className="px-6 -mt-6">
            {/* Title & Sport Subtitle */}
            <Text className="text-2xl font-extrabold text-theme-text tracking-tight">
              {activity?.name || 'Workout Telemetry'}
            </Text>
            <View className="flex-row items-center gap-1.5 mt-1 mb-5">
              <Ionicons
                name={getSportFilledIcon(activity?.sport_type, activity?.name)}
                size={16}
                color="#3B82F6"
              />
              <Text className="text-sm font-semibold text-theme-muted dark:text-slate-400">
                {formatActivityDate(activity?.start_date)}
              </Text>
            </View>

            {/* 3. FULL-WIDTH PROGRESS-STYLE SUB-TAB SWITCHER (Sliding Orange Pill) */}
            <View className="relative flex-row bg-slate-100 dark:bg-slate-800/80 rounded-2xl p-1 overflow-hidden border border-theme-border dark:border-slate-800 mb-6">
              <Animated.View
                className="absolute top-1 bottom-1 bg-theme-accent rounded-xl"
                style={{
                  left: 4,
                  width: segmentWidth,
                  transform: [{ translateX: indicatorTranslateX }],
                }}
              />

              {/* DETAILS PILL */}
              <TouchableOpacity
                className="flex-1 py-2.5 items-center justify-center relative"
                onPress={() => handleTabPress(0)}
                activeOpacity={0.7}
              >
                <Animated.Text
                  className="absolute text-xs font-bold text-white uppercase tracking-wider"
                  style={{ opacity: detailsWhiteOpacity }}
                >
                  Details
                </Animated.Text>
                <Animated.Text
                  className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider"
                  style={{ opacity: detailsGreyOpacity }}
                >
                  Details
                </Animated.Text>
              </TouchableOpacity>

              {/* RESULTS PILL */}
              <TouchableOpacity
                className="flex-1 py-2.5 items-center justify-center relative"
                onPress={() => handleTabPress(1)}
                activeOpacity={0.7}
              >
                <Animated.Text
                  className="absolute text-xs font-bold text-white uppercase tracking-wider"
                  style={{ opacity: resultsWhiteOpacity }}
                >
                  Results
                </Animated.Text>
                <Animated.Text
                  className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider"
                  style={{ opacity: resultsGreyOpacity }}
                >
                  Results
                </Animated.Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* 4. SWIPABLE HORIZONTAL PAGES CONTAINER */}
          <Animated.ScrollView
            ref={horizontalScrollViewRef as any}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={Animated.event(
              [{ nativeEvent: { contentOffset: { x: scrollX } } }],
              { useNativeDriver: false, listener: handleHorizontalScroll }
            )}
            style={{ width: SCREEN_WIDTH }}
          >
            {/* PAGE 1: DETAILS */}
            <View style={{ width: SCREEN_WIDTH }} className="px-6 space-y-5">

              {/* 2x3 TELEMETRY STATS GRID */}
              <View className="py-2 space-y-4">
                {/* Row 1 */}
                <View className="flex-row justify-between items-center">
                  {/* Distance */}
                  <View className="w-1/3">
                    <Text className="text-xs font-semibold text-theme-muted dark:text-theme-muted">
                      Distance
                    </Text>
                    <Text className="text-lg font-extrabold text-theme-text font-mono mt-0.5">
                      {distanceKmStr} km
                    </Text>
                  </View>

                  {/* Pace / Speed */}
                  <View className="w-1/3 items-center">
                    <Text className="text-xs font-semibold text-theme-muted dark:text-theme-muted">
                      {isCycling ? 'Avg Speed' : isSwim ? 'Avg Pace' : 'Avg Pace'}
                    </Text>
                    <Text className="text-lg font-extrabold text-theme-text font-mono mt-0.5">
                      {isCycling
                        ? `${avgSpeedKmh} km/h`
                        : isSwim
                        ? `${avgPaceSwim}`
                        : `${avgPaceRun} /km`}
                    </Text>
                  </View>

                  {/* Power or Heart Rate */}
                  <View className="w-1/3 items-end">
                    <Text className="text-xs font-semibold text-theme-muted dark:text-theme-muted">
                      {avgHeartRate ? 'Avg HR' : 'Avg Power'}
                    </Text>
                    <Text className="text-lg font-extrabold text-theme-text font-mono mt-0.5">
                      {avgHeartRate ? `${avgHeartRate} bpm` : `${avgPower} W`}
                    </Text>
                  </View>
                </View>

                <View className="h-px bg-theme-border dark:bg-slate-800" />

                {/* Row 2 */}
                <View className="flex-row justify-between items-center">
                  {/* Moving Time */}
                  <View className="w-1/3">
                    <Text className="text-xs font-semibold text-theme-muted dark:text-theme-muted">
                      Moving Time
                    </Text>
                    <Text className="text-lg font-extrabold text-theme-text font-mono mt-0.5">
                      {durationMins} min
                    </Text>
                  </View>

                  {/* Elevation Gain */}
                  <View className="w-1/3 items-center">
                    <Text className="text-xs font-semibold text-theme-muted dark:text-theme-muted">
                      Elevation Gain
                    </Text>
                    <Text className="text-lg font-extrabold text-theme-text font-mono mt-0.5">
                      +{elevation} m
                    </Text>
                  </View>

                  {/* Calories */}
                  <View className="w-1/3 items-end">
                    <Text className="text-xs font-semibold text-theme-muted dark:text-theme-muted">
                      Calories
                    </Text>
                    <Text className="text-lg font-extrabold text-theme-text font-mono mt-0.5">
                      {calories} Cal
                    </Text>
                  </View>
                </View>
              </View>

              {/* Likes & Spark Points Bar */}
              <View className="flex-row justify-between items-center bg-slate-100 dark:bg-slate-800/60 rounded-2xl p-4 mt-2">
                <View className="flex-row items-center gap-3">
                  <View className="flex-row items-center gap-1.5">
                    <Ionicons name="sparkles" size={16} color={theme.tint} />
                    <Text className="text-sm font-bold text-theme-text font-mono font-rajdhani">
                      +{rookaScore} rooka
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-1">
                    <Ionicons name="flash" size={15} color={theme.tint} />
                    <Text className="text-sm font-bold text-theme-text font-mono">
                      {kudosCount}
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  onPress={handleToggleKudos}
                  activeOpacity={0.75}
                  className={`w-10 h-10 rounded-full items-center justify-center ${
                    hasKudosed ? 'bg-theme-accent' : 'bg-slate-200 dark:bg-slate-700'
                  }`}
                >
                  <Ionicons
                    name={hasKudosed ? 'flash' : 'flash-outline'}
                    size={18}
                    color={hasKudosed ? '#FFFFFF' : isDark ? '#E2E8F0' : '#475569'}
                  />
                </TouchableOpacity>
              </View>

              {/* Comments Section */}
              <View className="mt-2 space-y-2">
                <Text className="text-xs font-extrabold text-theme-muted">
                  Comments ({comments.length})
                </Text>
                {comments.map((c) => (
                  <View
                    key={`comm-${c.id}`}
                    className="bg-slate-100 dark:bg-slate-800/40 p-3 rounded-xl flex-row justify-between items-center"
                  >
                    <View className="flex-1">
                      <Text className="text-xs font-bold text-theme-text">{c.username}</Text>
                      <Text className="text-xs font-medium text-theme-text mt-0.5">{c.comment}</Text>
                    </View>
                    {c.user_id === user?.id && (
                      <TouchableOpacity onPress={() => handleDeleteComment(c.id)}>
                        <Ionicons name="trash-outline" size={13} color={theme.textSecondary} />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
                <CommentComposer onSendComment={handleSendComment} />
              </View>
            </View>

            {/* PAGE 2: RESULTS (BEST EFFORTS TABLE & COMPLETE LAP SPLITS TABLE) */}
            <View style={{ width: SCREEN_WIDTH }} className="px-6 space-y-4">
              {/* BEST EFFORTS & MILESTONES TABLE */}
              {setsOrEfforts.length > 0 && (
                <View className="bg-theme-card border border-theme-border dark:border-slate-800 rounded-card p-4">
                  <View className="flex-row justify-between items-center mb-3">
                    <Text className="text-xs font-extrabold text-theme-muted">
                      {hasMilestones ? 'Best Efforts & Milestones' : 'Strength Sets Breakdown'}
                    </Text>
                    <Text className="text-xs font-bold text-theme-accent">
                      {setsOrEfforts.length} Recorded
                    </Text>
                  </View>

                  {setsOrEfforts.map((item, idx) => (
                    <View
                      key={`effort-${idx}`}
                      className="flex-row justify-between items-center bg-theme-bg dark:bg-slate-800/40 p-3 rounded-xl mb-2 border border-theme-border dark:border-slate-800/60"
                    >
                      <View className="flex-row items-center flex-1 pr-2">
                        <View
                          className={`w-6 h-6 rounded-full items-center justify-center mr-2.5 ${
                            item.prRank === 1 ? 'bg-theme-accent/20' : 'bg-theme-accent/20'
                          }`}
                        >
                          <Text
                            className={`text-xs font-bold ${
                              item.prRank === 1 ? 'text-amber-600 dark:text-amber-400' : 'text-theme-accent'
                            }`}
                          >
                            {idx + 1}
                          </Text>
                        </View>
                        <View className="flex-row items-center flex-wrap">
                          <Text className="text-sm font-bold text-theme-text">{item.name}</Text>
                          {item.prRank === 1 && (
                            <View className="bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded ml-2">
                              <Text className="text-xs font-bold text-amber-600 dark:text-amber-300">PR</Text>
                            </View>
                          )}
                          {item.prRank === 2 && (
                            <View className="bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded ml-2">
                              <Text className="text-xs font-bold text-slate-600 dark:text-slate-300">2nd Best</Text>
                            </View>
                          )}
                          {item.prRank === 3 && (
                            <View className="bg-amber-900/20 dark:bg-amber-900/40 px-1.5 py-0.5 rounded ml-2">
                              <Text className="text-xs font-bold text-amber-700 dark:text-amber-400">3rd Best</Text>
                            </View>
                          )}
                        </View>
                      </View>

                      {item.isMilestone ? (
                        <View className="items-end">
                          <Text className="text-sm font-bold font-mono text-theme-text">
                            {formatEffortDuration(item.timeSec)}
                          </Text>
                          {item.paceOrSpeed ? (
                            <Text className="text-xs font-medium font-mono text-theme-muted dark:text-slate-400">
                              {item.paceOrSpeed}
                            </Text>
                          ) : null}
                        </View>
                      ) : (
                        <Text className="text-xs font-bold font-mono text-theme-accent">
                          {item.weight ? `${item.weight} kg × ` : ''}
                          {item.reps ? `${item.reps} reps` : 'Complete'}
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
              )}

              {/* LAP SPLITS TABLE */}
              {laps.length > 0 && (
                <View className="bg-theme-card border border-theme-border dark:border-slate-800 rounded-card p-4">
                  <View className="flex-row justify-between items-center mb-3">
                    <Text className="text-xs font-extrabold text-theme-muted">
                      {isCycling ? 'Speed by Lap' : 'Lap Splits Table'} ({laps.length})
                    </Text>
                    {laps.length > 5 && (
                      <TouchableOpacity
                        onPress={() => {
                          Haptics.selectionAsync();
                          setIsLapsExpanded(!isLapsExpanded);
                        }}
                        className="flex-row items-center"
                      >
                        <Text className="text-xs font-bold text-theme-accent mr-1">
                          {isLapsExpanded ? 'Show less' : `Expand all (${laps.length})`}
                        </Text>
                        <Ionicons
                          name={isLapsExpanded ? 'chevron-up' : 'chevron-down'}
                          size={14}
                          color={theme.tint}
                        />
                      </TouchableOpacity>
                    )}
                  </View>

                  <View className="flex-row justify-between pb-2 border-b border-theme-border dark:border-slate-800 px-1 mb-1">
                    <Text className="text-xs font-semibold text-theme-muted w-12">Lap</Text>
                    <Text className="text-xs font-semibold text-theme-muted w-20">Dist</Text>
                    <Text className="text-xs font-semibold text-theme-muted flex-1">
                      {isCycling ? 'Speed' : isSwim ? 'Pace' : 'Pace'}
                    </Text>
                    <Text className="text-xs font-semibold text-theme-muted w-16 text-right">Avg HR</Text>
                  </View>

                  {(isLapsExpanded ? laps : laps.slice(0, 5)).map((lap, idx) => (
                    <View
                      key={`lap-${lap.lap_index}`}
                      className={`flex-row justify-between items-center py-2.5 px-1 ${
                        idx !== (isLapsExpanded ? laps.length : 5) - 1
                          ? 'border-b border-theme-border dark:border-slate-800/60'
                          : ''
                      }`}
                    >
                      <Text className="text-xs font-semibold text-[#475569] dark:text-slate-300 w-12">
                        #{lap.lap_index}
                      </Text>
                      <Text className="text-xs font-semibold font-mono text-theme-text w-20">
                        {lap.distance_km.toFixed(2)} km
                      </Text>
                      <Text className="text-xs font-medium font-mono text-theme-muted dark:text-slate-400 flex-1">
                        {lap.split_pace || `${Math.round(lap.elapsed_time_min)} min`}
                      </Text>
                      <Text
                        className={`text-xs font-medium font-mono w-16 text-right ${
                          lap.average_heartrate ? 'text-rose-500' : 'text-theme-muted'
                        }`}
                      >
                        {lap.average_heartrate ? `${Math.round(lap.average_heartrate)} bpm` : '--'}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </Animated.ScrollView>
        </ScrollView>
      </View>
    </Modal>
  );
};

