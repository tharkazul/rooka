import { Ionicons } from '@expo/vector-icons';
import { RookaMark } from '../ui/RookaPoints';
import { accentAlpha } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View
} from 'react-native';
import Reanimated, {
  Easing as REasing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_BASE_URL } from '../../constants/api';
import { useKeyboardMotionContext } from '../../context/KeyboardMotionContext';
import { dictionaries, useLanguage } from '../../context/LanguageContext';
import { useUser } from '../../context/UserStore';
import { useSubscription } from '../../context/SubscriptionStore';
import { apiClient } from '../../services/apiClient';
import { discountApi, integrationsApi } from '../../services/apiServices';
import { DiscountValidationResult, PricingBreakdown } from '../../types/discount';
import { DiscountCodeField } from '../subscription/DiscountCodeField';
import { getCoachAvatarSource } from '../../utils/avatarUtils';
import { MarkdownText } from '../chat/MarkdownText';
import { DurationRoller } from '../ui/DurationRoller';
import { EventDatePickerSheet } from '../ui/EventDatePickerSheet';
import { calculateTargetCTL } from '../profile/GoalsTab';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SUPPORTED_LANGUAGES: Array<{ code: string; label: string; flag: string; disabled?: boolean }> = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'nl', label: 'Nederlands', flag: '🇳🇱' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
];

export type ChatItemType =
  | 'welcome_hero'
  | 'coach_text'
  | 'coach_typing'
  | 'user_text'
  | 'card_language'
  | 'card_persona'
  | 'card_gender'
  | 'card_context_event'
  | 'card_schedule'
  | 'card_integrations'
  | 'card_paywall';

export interface ChatNode {
  id: string;
  type: ChatItemType;
  text?: string;
  subtext?: string;
  data?: any;
}

function TypingDots() {
  const dots = useRef([
    new Animated.Value(0.25),
    new Animated.Value(0.25),
    new Animated.Value(0.25),
  ]).current;

  useEffect(() => {
    const anims = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(dot, {
            toValue: 1,
            duration: 320,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0.25,
            duration: 320,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay((dots.length - 1 - i) * 160),
        ])
      )
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, []);

  return (
    <View className="flex-row items-center" style={{ gap: 5, height: 26 }}>
      {dots.map((dot, i) => (
        <Animated.View
          key={i}
          style={{
            width: 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: '#9CA3AF',
            opacity: dot,
          }}
        />
      ))}
    </View>
  );
}

export default function OnboardingWizard() {
    const theme = useTheme();

  const { user, refreshUser, updateUser } = useUser();
  const { packages, purchasePackage, refreshSubscription } = useSubscription();
  const { t, language, setLanguage } = useLanguage();

  // Onboarding Step Flow (0 = Welcome Hero, 1 = Language, 2 = Persona, 3 = Gender, 4 = Context/Event, 5 = Schedule, 6 = Integrations, 7 = Paywall)
  const [currentStep, setCurrentStep] = useState(0);
  const totalSteps = 7;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { height: keyboardHeight } = useKeyboardMotionContext();

  const keyboardStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(0, keyboardHeight.value - (Platform.OS === 'ios' ? 34 : 0))
  }));

  // Chat Feed timeline nodes
  const [timeline, setTimeline] = useState<ChatNode[]>([
    { id: 'node_welcome', type: 'welcome_hero' },
  ]);

  const chatScrollViewRef = useRef<ScrollView>(null);

  const scrollToBottom = () => {
    setTimeout(() => {
      chatScrollViewRef.current?.scrollToEnd({ animated: true });
    }, 150);
  };

  // --- Hero -> Chat handoff animation ---
  // The hero avatar visually "flies" from its big centered spot into the small
  // top-left slot it occupies as the first chat avatar, shrinking as it goes.
  // The headline/button/terms fade + drift up and out at the same time.
  const heroAvatarBoxRef = useRef<View>(null);
  // Invisible probe kept exactly where the small chat avatar will render
  // (same top/left as the first chat row's avatar), so we can measure the
  // real landing spot instead of guessing header height + padding.
  const chatAvatarProbeRef = useRef<View>(null);
  // The real first chat-row avatar, once it mounts — used to snap the clone
  // onto its exact final position/size right before fading, so any tiny
  // discrepancy between the probe estimate and reality can't show as a ghost.
  const firstChatAvatarRef = useRef<View>(null);
  const [isHeroTransitioning, setIsHeroTransitioning] = useState(false);

  const heroT = useSharedValue(0);
  const overlayOpacity = useSharedValue(0);
  const heroContentOpacity = useSharedValue(1);
  const heroContentTranslateY = useSharedValue(0);

  const avatarFromX = useSharedValue(0);
  const avatarFromY = useSharedValue(0);
  const avatarFromSize = useSharedValue(112);
  const avatarToX = useSharedValue(24);
  const avatarToY = useSharedValue(80);
  const avatarToSize = useSharedValue(40);

  const heroContentStyle = useAnimatedStyle(() => ({
    opacity: heroContentOpacity.value,
    transform: [{ translateY: heroContentTranslateY.value }],
  }));

  const avatarOverlayStyle = useAnimatedStyle(() => {
    const size = interpolate(heroT.value, [0, 1], [avatarFromSize.value, avatarToSize.value]);
    return {
      opacity: overlayOpacity.value,
      top: interpolate(heroT.value, [0, 1], [avatarFromY.value, avatarToY.value]),
      left: interpolate(heroT.value, [0, 1], [avatarFromX.value, avatarToX.value]),
      width: size,
      height: size,
      borderRadius: size / 2,
    };
  });

  const finalizeHeroHandoff = () => {
    startChatOnboarding();
    // Wait for the real chat avatar to actually commit to the native layout
    // (one rAF is often not enough on its own), then snap the clone onto its
    // exact measured rect before fading — removes any residual few-px offset
    // between the probe's estimate and where the real avatar actually lands.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (firstChatAvatarRef.current) {
          firstChatAvatarRef.current.measureInWindow((x, y, w) => {
            avatarToX.value = x;
            avatarToY.value = y;
            avatarToSize.value = w;
            overlayOpacity.value = withDelay(80, withTiming(0, { duration: 140 }));
          });
        } else {
          overlayOpacity.value = withDelay(80, withTiming(0, { duration: 140 }));
        }
      });
    });
  };

  const handleBeginPress = () => {
    if (isHeroTransitioning) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (!heroAvatarBoxRef.current || !chatAvatarProbeRef.current) {
      startChatOnboarding();
      return;
    }

    setIsHeroTransitioning(true);

    heroAvatarBoxRef.current.measureInWindow((fromX, fromY, fromWidth) => {
      avatarFromX.value = fromX;
      avatarFromY.value = fromY;
      avatarFromSize.value = fromWidth;

      chatAvatarProbeRef.current?.measureInWindow((toX, toY, toWidth) => {
        avatarToX.value = toX;
        avatarToY.value = toY;
        avatarToSize.value = toWidth;

        overlayOpacity.value = 1;
        heroContentOpacity.value = withTiming(0, { duration: 200, easing: REasing.out(REasing.quad) });
        heroContentTranslateY.value = withTiming(-14, { duration: 220, easing: REasing.out(REasing.quad) });

        heroT.value = withTiming(
          1,
          { duration: 480, easing: REasing.out(REasing.cubic) },
          (finished) => {
            if (finished) {
              runOnJS(finalizeHeroHandoff)();
            }
          }
        );
      });
    });
  };

  const WELCOME_MESSAGE = t('onboarding.welcomeMessage');
  const [typedText, setTypedText] = useState('');

  useEffect(() => {
    if (currentStep === 0) {
      setTypedText('');
      const words = WELCOME_MESSAGE.split(' ');
      let wordIndex = 0;

      const timer = setInterval(() => {
        if (wordIndex < words.length) {
          wordIndex++;
          setTypedText(words.slice(0, wordIndex).join(' '));
        } else {
          clearInterval(timer);
        }
      }, 100);

      return () => clearInterval(timer);
    }
  }, [currentStep, WELCOME_MESSAGE]);

  const [coachTone, setCoachTone] = useState(
    user?.coach_tone || ''
  );
  const [gender, setGender] = useState<string>(user?.gender || 'Prefer not to share');
  const [athleteContext, setAthleteContext] = useState(user?.athlete_context || '');
  const [coachReaction, setCoachReaction] = useState<string | null>(null);
  const contextDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [metrics, setMetrics] = useState<{ label: string; value: string }[]>([
    { label: 'FTP (Watts)', value: user?.athlete_metrics?.ftp?.toString() || '' },
    { label: '5k PB Time', value: (user?.athlete_metrics as any)?.five_k?.toString() || (user?.athlete_metrics as any)?.['5k']?.toString() || '' },
    { label: 'Resting HR', value: user?.athlete_metrics?.resting_hr?.toString() || '' },
  ]);

  // Returning athletes are walked back through the wizard to supply an age for
  // their training zones, so their saved availability is prefilled — this is a
  // review, not a re-entry.
  const savedAvailability = (user as any)?.trainingAvailability || (user as any)?.training_availability;
  const [availability, setAvailability] = useState<{ [day: string]: { available: boolean; maxMinutes: number } }>(() => {
    const parsed =
      typeof savedAvailability === 'string'
        ? (() => { try { return JSON.parse(savedAvailability); } catch { return null; } })()
        : savedAvailability;
    if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) return parsed;
    return {
    Mon: { available: true, maxMinutes: 60 },
    Tue: { available: true, maxMinutes: 60 },
    Wed: { available: true, maxMinutes: 60 },
    Thu: { available: true, maxMinutes: 60 },
    Fri: { available: true, maxMinutes: 60 },
    Sat: { available: true, maxMinutes: 60 },
    Sun: { available: true, maxMinutes: 60 },
  };
  });

  const isPastDateString = (dateStr?: string) => {
    if (!dateStr) return false;
    const parts = dateStr.split('-').map(Number);
    if (parts.length < 3 || parts.some(isNaN)) return false;
    const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return dateObj < today;
  };

  const [garminEmail, setGarminEmail] = useState(
    (user as any)?.garmin_username || (user as any)?.garminUsername || ''
  );
  const [garminPassword, setGarminPassword] = useState('');
  const [showGarmin, setShowGarmin] = useState(!!user?.garmin_connected);
  const [isGarminSaved, setIsGarminSaved] = useState(!!user?.garmin_connected);
  const [isSavingGarmin, setIsSavingGarmin] = useState(false);
  const [garminSaveSuccessMsg, setGarminSaveSuccessMsg] = useState<string | null>(null);
  const [garminError, setGarminError] = useState<string | null>(null);

  const [isConnectingStrava, setIsConnectingStrava] = useState(false);
  const [stravaSuccessMsg, setStravaSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (user?.garmin_connected) {
      setIsGarminSaved(true);
      setShowGarmin(true);
      if ((user as any)?.garmin_username || (user as any)?.garminUsername) {
        setGarminEmail((user as any)?.garmin_username || (user as any)?.garminUsername);
      }
    }
  }, [user?.garmin_connected]);
  const [goalType, setGoalType] = useState<'race' | 'physiological'>('race');
  const [raceName, setRaceName] = useState(user?.target_event || '');
  const [raceDate, setRaceDate] = useState(() => {
    const existing = user?.event_date || '';
    return isPastDateString(existing) ? '' : existing;
  });
  const [targetMode, setTargetMode] = useState<'finish' | 'time'>('finish');
  const [targetValue, setTargetValue] = useState('');
  const [targetWeight, setTargetWeight] = useState('');
  const [targetCtl, setTargetCtl] = useState(user?.target_ctl?.toString() || '75');
  // Age drives max HR (220 - age) and therefore the whole heart-rate zone
  // table, which is what every rooka score is now weighted by.
  const [age, setAge] = useState('');

  const formatDateDisplay = (dateStr: string) => {
    if (!dateStr) return t('onboarding.raceDatePlaceholder') || 'Select Date';
    try {
      const parts = dateStr.split('-').map(Number);
      if (parts.length === 3) {
        const d = new Date(parts[0], parts[1] - 1, parts[2]);
        const loc = language === 'nl' ? 'nl-NL' : language === 'de' ? 'de-DE' : language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-US';
        return d.toLocaleDateString(loc, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
      }
    } catch (e) {}
    return dateStr;
  };

  // The three-column month/day/year roller that used to live here has been
  // replaced by the Goals sheet (year stepper, month grid, day strip, quick
  // presets), so there is one event-date picker in the app rather than two.
  const [showDatePicker, setShowDatePicker] = useState(false);
  const currentYearNum = new Date().getFullYear();
  const startYear = Math.max(2026, currentYearNum);

  const handleConfirmDate = (dateStr: string) => {
    setRaceDate(dateStr);
  };

  const openDatePickerModal = () => {
    setShowDatePicker(true);
  };

  const raceDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleRaceNameChange = (text: string) => {
    setRaceName(text);
    if (raceDebounceRef.current) clearTimeout(raceDebounceRef.current);
    if (!text.trim() || text.trim().length < 3) {
      return;
    }
    raceDebounceRef.current = setTimeout(() => {
      const estimated = calculateTargetCTL(text);
      setTargetCtl(estimated.toString());
    }, 500);
  };

  const handleAthleteContextChange = (text: string) => {
    setAthleteContext(text);
    if (contextDebounceRef.current) clearTimeout(contextDebounceRef.current);
    if (!text.trim() || text.trim().length < 6) {
      setCoachReaction(null);
      return;
    }
    contextDebounceRef.current = setTimeout(() => {
      const lower = text.toLowerCase();
      let reaction = t('onboarding.contextFeedbackDefault');
      setCoachReaction(reaction);
    }, 600);
  };

  const addMetricRow = () => {
    setMetrics([...metrics, { label: '', value: '' }]);
  };

  const handleDayDurationChange = (day: string, duration: number) => {
    setAvailability((prev) => ({
      ...prev,
      [day]: {
        available: duration > 0,
        maxMinutes: duration,
      },
    }));
  };

  const [isStreamingMessage, setIsStreamingMessage] = useState(false);
  const TYPING_NODE_ID = 'coach_typing_indicator';
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const intervalsRef = useRef<ReturnType<typeof setInterval>[]>([]);

  useEffect(() => () => {
    timeoutsRef.current.forEach(clearTimeout);
    intervalsRef.current.forEach(clearInterval);
  }, []);

  const streamCoachMessage = (
    message: string,
    opts: { thinkingMs?: number; wordMs?: number; onDone?: () => void } = {}
  ) => {
    const { thinkingMs = 750, wordMs = 55, onDone } = opts;

    setTimeline((prev) => [...prev, { id: TYPING_NODE_ID, type: 'coach_typing' }]);
    scrollToBottom();

    const t = setTimeout(() => {
      const coachNodeId = `coach_stream_${Date.now()}`;

      setTimeline((prev) => [
        ...prev.filter((n) => n.id !== TYPING_NODE_ID),
        { id: coachNodeId, type: 'coach_text', text: '' },
      ]);
      scrollToBottom();

      const words = message.split(' ');
      let i = 0;

      const timer = setInterval(() => {
        if (i < words.length) {
          i++;
          const slice = words.slice(0, i).join(' ');
          setTimeline((prev) =>
            prev.map((n) => (n.id === coachNodeId ? { ...n, text: slice } : n))
          );
          scrollToBottom();
        } else {
          clearInterval(timer);
          onDone?.();
        }
      }, wordMs);

      intervalsRef.current.push(timer);
    }, thinkingMs);

    timeoutsRef.current.push(t);
  };

  const appendCoachPromptAndCard = (
    userText: string | null,
    coachMessage: string,
    cardType: ChatItemType,
    dataToMarkPrevious?: { type: ChatItemType; key: string; val: any }
  ) => {
    setIsStreamingMessage(true);

    setTimeline((prev) => {
      let updated = [...prev];
      if (dataToMarkPrevious) {
        updated = updated.map((item) =>
          item.type === dataToMarkPrevious.type
            ? { ...item, data: { ...item.data, [dataToMarkPrevious.key]: dataToMarkPrevious.val } }
            : item
        );
      }
      if (userText) {
        updated.push({ id: `user_${Date.now()}`, type: 'user_text', text: userText });
      }
      return updated;
    });
    scrollToBottom();

    streamCoachMessage(coachMessage, {
      onDone: () => {
        const t = setTimeout(() => {
          setTimeline((prev) => [
            ...prev,
            { id: `card_${cardType}_${Date.now()}`, type: cardType },
          ]);
          scrollToBottom();
          setIsStreamingMessage(false);
        }, 300);
        timeoutsRef.current.push(t);
      },
    });
  };

  const appendCoachAckOnly = (userText: string, coachAck: string) => {
    setIsStreamingMessage(true);
    setTimeline((prev) => [
      ...prev,
      { id: `user_${Date.now()}`, type: 'user_text', text: userText },
    ]);
    scrollToBottom();
    streamCoachMessage(coachAck, { thinkingMs: 550, onDone: () => setIsStreamingMessage(false) });
  };

  const startChatOnboarding = () => {
    setCurrentStep(1);
    setTimeline([
      {
        id: 'node_welcome_banner',
        type: 'coach_text',
        text: WELCOME_MESSAGE,
      },
    ]);
    scrollToBottom();

    appendCoachPromptAndCard(null, t('onboarding.selectLanguagePrompt'), 'card_language');
  };

  const handleSelectLanguageChoice = (langCode: string, langName: string) => {
    if (isStreamingMessage) return;
    setLanguage(langCode as any);

    const targetDict = dictionaries[langCode as keyof typeof dictionaries] || dictionaries.en;
    const userLabel = (targetDict.onboarding?.selectedLanguageUser || 'Language: {lang}').replace('{lang}', langName);
    const coachPrompt = (targetDict.onboarding?.coachLanguageAck || 'Thank you! I will communicate with you in {lang}. 👋 First, how would you like me to talk to you during workouts and chat?').replace('{lang}', langName);

    if (currentStep === 1) {
      setCurrentStep(2);
      appendCoachPromptAndCard(
        userLabel,
        coachPrompt,
        'card_persona',
        { type: 'card_language', key: 'selected', val: langCode }
      );
    } else {
      setTimeline((prev) =>
        prev.map((item) => (item.type === 'card_language' ? { ...item, data: { selected: langCode } } : item))
      );
      const updatedUser = (targetDict.onboarding?.updatedLanguageUser || 'Updated Language: {lang}').replace('{lang}', langName);
      const updatedAck = (targetDict.onboarding?.updatedLanguageAck || 'Got it! Updated your preferred language to {lang}. 👋').replace('{lang}', langName);
      appendCoachAckOnly(updatedUser, updatedAck);
    }
  };

  const handleSelectPersonaChoice = (toneString: string, toneTitle: string) => {
    if (isStreamingMessage) return;
    setCoachTone(toneString);

    if (currentStep === 2) {
      setCurrentStep(3);
      appendCoachPromptAndCard(
        t('onboarding.selectedPersonaUser', { tone: toneTitle }),
        t('onboarding.genderPrompt'),
        'card_gender',
        { type: 'card_persona', key: 'selected', val: toneTitle }
      );
    } else {
      setTimeline((prev) =>
        prev.map((item) => (item.type === 'card_persona' ? { ...item, data: { selected: toneTitle } } : item))
      );
      appendCoachAckOnly(
        t('onboarding.updatedPersonaUser', { tone: toneTitle }),
        t('onboarding.updatedPersonaAck', { tone: toneTitle })
      );
    }
  };

  const handleSelectGenderChoice = (genderVal: string, genderLabel: string) => {
    if (isStreamingMessage) return;
    setGender(genderVal);

    if (currentStep === 3) {
      setCurrentStep(4);
      appendCoachPromptAndCard(
        t('onboarding.selectedGenderUser', { gender: genderLabel }),
        t('onboarding.contextPrompt'),
        'card_context_event',
        { type: 'card_gender', key: 'selected', val: genderVal }
      );
    } else {
      setTimeline((prev) =>
        prev.map((item) => (item.type === 'card_gender' ? { ...item, data: { selected: genderVal } } : item))
      );
      appendCoachAckOnly(
        t('onboarding.updatedGenderUser', { gender: genderLabel }),
        t('onboarding.updatedGenderAck', { gender: genderLabel })
      );
    }
  };

  const handleConfirmContextAndEvent = () => {
    if (isStreamingMessage) return;

    const eventDesc =
      goalType === 'race'
        ? raceName
          ? targetMode === 'time' && targetValue
            ? `${raceName} (${targetValue})`
            : raceName
          : ''
        : raceName
          ? targetWeight
            ? `${raceName} (${targetWeight} kg)`
            : raceName
          : targetWeight
            ? `Target Weight: ${targetWeight} kg`
            : 'Physiological Goal';

    if (currentStep === 4) {
      setCurrentStep(5);
      const feedback = coachReaction || t('onboarding.contextFeedbackDefault');
      appendCoachPromptAndCard(
        eventDesc
          ? t('onboarding.contextUserEvent', { name: eventDesc, date: raceDate || 'TBD' })
          : t('onboarding.contextUserBackground'),
        `${feedback} ${t('onboarding.schedulePrompt')}`,
        'card_schedule',
        { type: 'card_context_event', key: 'completed', val: true }
      );
    } else {
      setTimeline((prev) =>
        prev.map((item) => (item.type === 'card_context_event' ? { ...item, data: { completed: true } } : item))
      );
      appendCoachAckOnly(
        eventDesc
          ? t('onboarding.contextUserEvent', { name: eventDesc, date: raceDate || 'TBD' })
          : t('onboarding.contextUserBackground'),
        t('onboarding.contextFeedbackDefault')
      );
    }
  };

  const handleConfirmScheduleChoice = () => {
    if (isStreamingMessage) return;

    if (currentStep === 5) {
      setCurrentStep(6);
      appendCoachPromptAndCard(
        t('onboarding.selectedScheduleUser'),
        t('onboarding.integrationsPrompt'),
        'card_integrations',
        { type: 'card_schedule', key: 'completed', val: true }
      );
    } else {
      setTimeline((prev) =>
        prev.map((item) => (item.type === 'card_schedule' ? { ...item, data: { completed: true } } : item))
      );
      appendCoachAckOnly(
        t('onboarding.selectedScheduleUser'),
        t('onboarding.updateScheduleBtn')
      );
    }
  };

  const handleSaveGarmin = async (): Promise<boolean> => {
    if (!garminEmail.trim() || !garminPassword.trim()) {
      setGarminError(t('onboarding.garminFillError'));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return false;
    }
    setIsSavingGarmin(true);
    setGarminError(null);
    setGarminSaveSuccessMsg(null);
    try {
      const res = await integrationsApi.saveGarminCredentials({
        garminUsername: garminEmail.trim(),
        garminPassword: garminPassword.trim(),
      });
      await refreshUser();
      setIsGarminSaved(true);
      setGarminSaveSuccessMsg(res?.message || t('onboarding.garminSavedSuccess'));
      setGarminPassword('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return true;
    } catch (err: any) {
      setGarminError(err?.message || 'Failed to save Garmin credentials');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return false;
    } finally {
      setIsSavingGarmin(false);
    }
  };

  const handleDisconnectGarmin = async () => {
    setIsSavingGarmin(true);
    try {
      await integrationsApi.disconnectGarmin();
      await refreshUser();
      setIsGarminSaved(false);
      setShowGarmin(false);
      setGarminEmail('');
      setGarminPassword('');
      setGarminSaveSuccessMsg(null);
      setGarminError(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      console.error('Garmin disconnect error:', err);
    } finally {
      setIsSavingGarmin(false);
    }
  };

  const handleConnectStravaOAuth = async () => {
    setIsConnectingStrava(true);
    setStravaSuccessMsg(null);
    try {
      const clientId = '208765';
      const stravaRedirectUri = `${API_BASE_URL}/oauthredirect`;
      const appDeepLink = Linking.createURL('oauthredirect');
      const authUrl = `https://www.strava.com/oauth/mobile/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(
        stravaRedirectUri
      )}&scope=activity:read_all,activity:write&approval_prompt=force`;

      const result = await WebBrowser.openAuthSessionAsync(authUrl, appDeepLink);
      if (result.type === 'success' && result.url) {
        let code: string | undefined;
        try {
          code = new URL(result.url).searchParams.get('code') || undefined;
        } catch (_) {
          const match = result.url.match(/[?&]code=([^&]+)/);
          if (match) code = match[1];
        }
        if (code) {
          const res = await integrationsApi.exchangeStravaCode(code);
          await refreshUser();
          setStravaSuccessMsg(res?.message || t('onboarding.stravaSuccessMsg'));
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert(
            t('onboarding.stravaTitle'),
            t('onboarding.stravaSuccessMsg')
          );
        }
      }
    } catch (err: any) {
      console.error('Onboarding Strava OAuth error:', err);
      Alert.alert(t('onboarding.stravaTitle'), t('onboarding.stravaErrorMsg'));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } finally {
      setIsConnectingStrava(false);
    }
  };

  const handleDisconnectStrava = async () => {
    setIsConnectingStrava(true);
    try {
      await integrationsApi.disconnectStrava();
      await refreshUser();
      setStravaSuccessMsg(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      console.error('Strava disconnect error:', err);
    } finally {
      setIsConnectingStrava(false);
    }
  };

  const handleConfirmIntegrationsChoice = async () => {
    if (isStreamingMessage) return;

    // If user filled in credentials and has not yet saved, save automatically
    if (showGarmin && garminEmail.trim() && garminPassword.trim() && !isGarminSaved) {
      const saved = await handleSaveGarmin();
      if (!saved) return;
    }

    if (currentStep === 6) {
      setCurrentStep(7);
      appendCoachPromptAndCard(
        t('onboarding.selectedIntegrationsUser'),
        t('onboarding.paywallPrompt'),
        'card_paywall',
        { type: 'card_integrations', key: 'completed', val: true }
      );
    } else {
      setTimeline((prev) =>
        prev.map((item) => (item.type === 'card_integrations' ? { ...item, data: { completed: true } } : item))
      );
      appendCoachAckOnly(
        t('onboarding.selectedIntegrationsUser'),
        t('onboarding.updateIntegrationsBtn')
      );
    }
  };

  /* --- Paywall pricing -----------------------------------------------------
   * Every number in the two price boxes comes from the server, so the discount
   * code field only has to hand over the breakdown it was given and the boxes
   * follow. `pricing === null` means it has not arrived yet, and the boxes fall
   * back to the static locale strings for that moment.
   * ---------------------------------------------------------------------- */
  const [basePricing, setBasePricing] = useState<PricingBreakdown | null>(null);
  const [discountResult, setDiscountResult] = useState<DiscountValidationResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    discountApi
      .mine()
      .then((res) => {
        if (!cancelled) setBasePricing(res.pricing);
      })
      .catch(() => {
        // Offline or an older server build: the boxes keep their locale strings.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const validDiscount = discountResult?.valid ? discountResult : null;
  const pricing = validDiscount?.pricing || basePricing;
  const money = (amount: number) =>
    `${pricing?.currency || '€'}${amount.toFixed(2)}`;

  const handleCompleteSetup = async (isTrial: boolean) => {
    setIsSubmitting(true);
    let subscribedToPlus = false;

    try {
      // If user chooses trial/subscription, prompt RevenueCat in-app purchase
      if (isTrial && Platform.OS !== 'web') {
        let targetPkg = selectedPlan === 'annual' ? packages.yearly : packages.monthly;

        // If packages are not loaded yet, attempt a refresh
        if (!targetPkg && refreshSubscription) {
          try {
            await refreshSubscription();
            targetPkg = selectedPlan === 'annual' ? packages.yearly : packages.monthly;
          } catch (_) {}
        }

        if (targetPkg) {
          const purchaseSuccess = await purchasePackage(targetPkg);
          if (!purchaseSuccess) {
            // User cancelled or purchase failed — keep them on the paywall screen without finalizing
            setIsSubmitting(false);
            return;
          }
          subscribedToPlus = true;
        } else {
          // Packages could not be retrieved from RevenueCat / StoreKit
          setIsSubmitting(false);
          Alert.alert(
            'Trial Unavailable',
            'Unable to connect to the App Store subscription service to activate your trial. Would you like to retry, or continue with the Free Tier for now?',
            [
              { text: 'Retry', style: 'cancel' },
              {
                text: 'Continue with Free',
                onPress: () => handleCompleteSetup(false),
              },
            ]
          );
          return;
        }
      }

      const formattedMetricsContext = metrics
        .filter((m) => m.label.trim() && m.value.trim())
        .map((m) => `${m.label}: ${m.value}`)
        .join(', ');

      let cleanContext = athleteContext.trim();
      if (cleanContext.startsWith('Endurance athlete.')) {
        cleanContext = cleanContext.replace(/^Endurance athlete\.\s*/, '');
      }
      if (cleanContext.includes('[Metrics:')) {
        cleanContext = cleanContext.replace(/\s*\[Metrics:.*?\]/, '');
        cleanContext = cleanContext.trim();
      }
      if (cleanContext === 'Endurance athlete.') {
        cleanContext = '';
      }

      const fullContext = cleanContext
        ? `${cleanContext}${formattedMetricsContext ? `\n[Metrics: ${formattedMetricsContext}]` : ''}`
        : formattedMetricsContext
          ? `Endurance athlete. [Metrics: ${formattedMetricsContext}]`
          : 'Endurance athlete.';

      try {
        await apiClient('/api/onboarding/finalize', {
          method: 'POST',
          body: JSON.stringify({
            coachTone,
            athleteContext: fullContext,
            trainingAvailability: availability,
            gender,
            subscriptionTier: subscribedToPlus ? 'rooka_plus' : 'free',
            targetEvent: raceName || (goalType === 'physiological' ? 'Physiological Goal' : undefined),
            eventDate: raceDate || undefined,
            targetCtl: targetCtl ? parseFloat(targetCtl) : undefined,
            goalType,
            goal_type: goalType,
            targetMode,
            target_mode: targetMode,
            targetValue: targetValue || undefined,
            target_value: targetValue || undefined,
            targetWeight: targetWeight ? parseFloat(targetWeight) : undefined,
            target_weight: targetWeight ? parseFloat(targetWeight) : undefined,
            age: age ? parseInt(age, 10) : undefined,
            language: language || 'en',
          }),
        });
      } catch (e) {
        console.warn('Finalize onboarding call warning:', e);
        await updateUser({
          coach_tone: coachTone,
          athlete_context: fullContext,
          training_availability: availability as any,
          gender: gender,
          subscription_tier: subscribedToPlus ? 'rooka_plus' : 'free',
          target_event: raceName || (goalType === 'physiological' ? 'Physiological Goal' : undefined),
          event_date: raceDate || undefined,
          target_ctl: targetCtl ? parseFloat(targetCtl) : undefined,
          goal_type: goalType,
          target_mode: targetMode,
          target_value: targetValue || undefined,
          target_weight: targetWeight ? parseFloat(targetWeight) : undefined,
          onboarding_completed: true,
        } as any);
      }

      // Commit the discount code now that the athlete has actually signed up.
      // Applying it earlier — while they were still typing it — would consume a
      // one-time code for somebody who never finished onboarding.
      if (isTrial && validDiscount?.code?.code) {
        try {
          await discountApi.apply(validDiscount.code.code);
        } catch (err: any) {
          // Losing the discount must not lose the whole onboarding. The code can
          // be entered again under Account -> Subscription.
          console.warn('Could not apply discount code during onboarding:', err);
          Alert.alert(
            t('onboarding.discountFailedTitle'),
            err?.data?.error || err?.message || t('onboarding.discountFailedBody')
          );
        }
      }

      if (showGarmin && garminEmail && garminPassword && !isGarminSaved) {
        try {
          await integrationsApi.saveGarminCredentials({
            garminUsername: garminEmail.trim(),
            garminPassword: garminPassword.trim(),
          });
        } catch (_) { }
      }

      try {
        await updateUser({ onboarding_completed: true } as any);
      } catch (_) {}

      await refreshUser();
      router.replace('/(tabs)/coach');
    } catch (err: any) {
      console.error('Onboarding save error:', err);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } finally {
      setIsSubmitting(false);
    }
  };

  const [selectedPlan, setSelectedPlan] = useState<'annual' | 'monthly'>('annual');

  return (
    <View style={{ flex: 1 }}>
      <SafeAreaView className="flex-1 bg-theme-bg" edges={['top', 'bottom']}>
        {/* Event date picker — the same sheet the Goals tab uses. */}
        <EventDatePickerSheet
          visible={showDatePicker}
          value={raceDate}
          onClose={() => setShowDatePicker(false)}
          onConfirm={handleConfirmDate}
          title={t('onboarding.selectTargetDateModalTitle')}
          previewLabel={t('onboarding.selectTargetDateModalTitle')}
          confirmLabel={t('onboarding.confirmDateBtn')}
          pastWarning={t('onboarding.dateInPastWarning')}
          disallowPast
          minYear={startYear}
        />

        {/* Header Stepper Bar */}
        <View className="px-6 pt-4 pb-3 border-b border-theme-border flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <View className="w-9 h-9 rounded-xl overflow-hidden shadow-md">
              <Image
                source={require('../../../assets/images/logo-mark.png')}
                className="w-full h-full"
                resizeMode="contain"
              />
            </View>
            <View>
              <Text className="text-theme-text text-xl font-bold font-barlow tracking-tight">rooka</Text>
              <Text className="text-theme-muted text-xs">
                {currentStep === 0 ? 'AI Endurance Coach' : t('onboarding.stepOf', { current: currentStep, total: totalSteps })}
              </Text>
            </View>
          </View>

          {currentStep >= 1 && (
            <View className="flex-row gap-1">
              {Array.from({ length: totalSteps }).map((_, idx) => (
                <View
                  key={idx}
                  style={
                    idx + 1 === currentStep
                      ? { backgroundColor: theme.tint }
                      : idx + 1 < currentStep
                        ? { backgroundColor: accentAlpha(0.5) }
                        : undefined
                  }
                  className={`h-2 rounded-full bg-theme-border ${idx + 1 === currentStep ? 'w-6' : 'w-2'
                    }`}
                />
              ))}
            </View>
          )}
        </View>

        {/* Main Chat Scroll Container */}
        <Reanimated.View
          style={[{ flex: 1 }, keyboardStyle]}
          className="flex-1"
        >
          {/* Invisible probe marking exactly where the first chat row's avatar
            renders (px-6 pt-4, 40x40) — measured live so the hero avatar has
            an accurate landing target instead of a guessed offset. */}
          <View
            ref={chatAvatarProbeRef}
            pointerEvents="none"
            style={{ position: 'absolute', top: 16, left: 24, width: 40, height: 40, opacity: 0 }}
          />
          <ScrollView
            ref={chatScrollViewRef}
            className="flex-1 px-6 pt-4"
            contentContainerStyle={{ paddingBottom: 140 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {timeline.map((node) => {
              if (node.type === 'welcome_hero' && currentStep === 0) {
                return (
                  <View key={node.id} className="items-center justify-center py-10 my-auto">
                    <View className="relative mb-6" style={{ opacity: isHeroTransitioning ? 0 : 1 }}>
                      <View
                        ref={heroAvatarBoxRef}
                        className="w-28 h-28 rounded-full items-center justify-center overflow-hidden bg-theme-bg"
                      >
                        <Image
                          source={getCoachAvatarSource(coachTone)}
                          className="w-full h-full"
                        />
                      </View>
                    </View>

                    <Reanimated.View style={heroContentStyle} className="w-full items-center">
                      <View className="w-full mb-8">
                        <Text className="text-theme-text text-xl leading-[32px] font-semibold">
                          {typedText}
                          {typedText.length < WELCOME_MESSAGE.length && (
                            <Text className="text-theme-accent">▌</Text>
                          )}
                        </Text>
                      </View>

                      <Pressable
                        onPress={handleBeginPress}
                        disabled={isHeroTransitioning}
                        className="w-full py-4 rounded-2xl bg-theme-accent items-center justify-center flex-row gap-2 active:opacity-90"
                      >
                        <Text className="text-white font-extrabold text-lg">{t('onboarding.meetCoachBegin')}</Text>
                        <Ionicons name="arrow-forward" size={22} color="#FFFFFF" />
                      </Pressable>

                      <View className="mt-6 px-2 items-center">
                        <Text className="text-theme-muted text-xs text-center leading-relaxed">
                          {t('onboarding.agreeToTerms')}{' '}
                          <Text
                            onPress={() => Linking.openURL('https://rooka.io/terms.html')}
                            className="text-theme-accent font-semibold underline"
                          >
                            {t('onboarding.termsOfService')}
                          </Text>
                          {' '}{t('onboarding.andAcknowledge')}{' '}
                          <Text
                            onPress={() => Linking.openURL('https://rooka.io/privacy')}
                            className="text-theme-accent font-semibold underline"
                          >
                            {t('onboarding.privacyPolicy')}
                          </Text>
                          {t('onboarding.termsDisclaimer')}
                        </Text>
                      </View>
                    </Reanimated.View>
                  </View>
                );
              }

              if (node.type === 'coach_typing') {
                return (
                  <View key={node.id} className="flex-row items-start gap-3 mb-4 pr-4">
                    <View className="relative">
                      <Image
                        source={getCoachAvatarSource(coachTone)}
                        className="w-10 h-10 rounded-full"
                      />
                    </View>
                    <View className="flex-1 mt-1 justify-center min-h-[40px]">
                      <View className="flex-row items-center gap-1.5 mb-1">
                        <Text className="text-theme-text font-extrabold text-xs font-rajdhani">rooka</Text>
                      </View>
                      <TypingDots />
                    </View>
                  </View>
                );
              }

              if (node.type === 'coach_text') {
                if (!node.text?.trim()) return null;
                return (
                  <View key={node.id} className="flex-row items-start gap-3 mb-4 pr-4">
                    <View className="relative" ref={node.id === 'node_welcome_banner' ? firstChatAvatarRef : undefined}>
                      <Image
                        source={getCoachAvatarSource(coachTone)}
                        className="w-10 h-10 rounded-full"
                      />
                    </View>
                    <View className="flex-1 mt-1">
                      <View className="flex-row items-center gap-1.5 mb-1">
                        <Text className="text-theme-text font-extrabold text-xs font-rajdhani">rooka</Text>
                      </View>
                      <MarkdownText content={node.text || ''} isUser={false} />
                    </View>
                  </View>
                );
              }

              if (node.type === 'user_text') {
                return (
                  <View key={node.id} className="flex-row justify-end mb-7 pl-12">
                    <View className="bg-theme-accent rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[80%] shadow-sm">
                      <Text className="text-white font-medium text-base leading-[24px]">{node.text}</Text>
                    </View>
                  </View>
                );
              }

              if (node.type === 'card_language') {
                const isSelected = !!node.data?.selected;
                const languagesList = [
                  ...SUPPORTED_LANGUAGES,
                  { code: 'more', label: t('onboarding.moreSoon'), flag: '🌐', disabled: true },
                ];
                return (
                  <View
                    key={node.id}
                    className="bg-theme-card border border-theme-border rounded-card p-4 mb-5 gap-3 shadow-sm"
                    style={!isSelected ? { borderColor: accentAlpha(0.5) } : undefined}
                  >
                    <View className="flex-row items-center gap-2">
                      <Ionicons name="language" size={20} color={theme.tint} />
                      <Text className="text-theme-text font-bold text-sm">{t('onboarding.selectLanguageTitle')}</Text>
                    </View>

                    <View className="flex-row flex-wrap justify-between gap-y-2.5 pt-1">
                      {languagesList.map((lang) => {
                        if (lang.disabled) {
                          return (
                            <View
                              key="more"
                              style={{ width: '48.5%' }}
                              className="py-3 px-3 rounded-xl border border-dashed border-theme-border/60 bg-theme-bg/40 flex-row items-center justify-center gap-2 opacity-60"
                            >
                              <Text className="text-base">🌐</Text>
                              <Text className="text-xs font-semibold text-theme-muted">{lang.label}</Text>
                            </View>
                          );
                        }
                        const active = node.data?.selected === lang.code;
                        return (
                          <Pressable
                            key={lang.code}
                            disabled={isStreamingMessage}
                            style={[
                              { width: '48.5%' },
                              active && { backgroundColor: theme.tint, borderColor: theme.tint },
                            ]}
                            onPress={() => handleSelectLanguageChoice(lang.code, lang.label)}
                            className="py-3 px-3 rounded-control border flex-row items-center justify-center gap-2 active:bg-theme-card bg-theme-bg border-theme-border shadow-sm"
                          >
                            <Text className="text-base">{lang.flag}</Text>
                            <Text
                              className="text-xs font-bold text-theme-text"
                              style={active ? { color: '#FFFFFF' } : undefined}
                            >
                              {lang.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                );
              }

              if (node.type === 'card_persona') {
                const isSelected = !!node.data?.selected;
                return (
                  <View
                    key={node.id}
                    className="bg-theme-card border border-theme-border rounded-card p-4 mb-5 gap-3 shadow-sm"
                    style={!isSelected ? { borderColor: accentAlpha(0.5) } : undefined}
                  >
                    <Text className="text-theme-text font-bold text-sm">{t('onboarding.chooseToneTitle')}</Text>

                    <Pressable
                      disabled={isStreamingMessage}
                      onPress={() =>
                        handleSelectPersonaChoice(
                          'Empathetic but demanding elite endurance coach.',
                          t('onboarding.toneEmpatheticShort')
                        )
                      }
                      className="p-3.5 rounded-xl border border-theme-border bg-theme-bg"
                      style={
                        node.data?.selected === t('onboarding.toneEmpatheticShort')
                          ? { borderColor: theme.tint, backgroundColor: accentAlpha(0.1) }
                          : undefined
                      }
                    >
                      <View className="flex-row items-center">
                        <View className="w-10 h-10 rounded-full overflow-hidden border border-theme-border mr-3 bg-theme-bg">
                          <Image
                            source={getCoachAvatarSource('Empathetic but demanding elite endurance coach.')}
                            className="w-full h-full"
                          />
                        </View>
                        <View className="flex-1">
                          <Text className="text-theme-text font-bold text-xs">{t('onboarding.toneEmpatheticTitle')}</Text>
                          <Text className="text-theme-muted text-xs mt-0.5">
                            {t('onboarding.toneEmpatheticDesc')}
                          </Text>
                        </View>
                      </View>
                    </Pressable>

                    <Pressable
                      disabled={isStreamingMessage}
                      onPress={() =>
                        handleSelectPersonaChoice(
                          'Strict with data, but with a dry, snarky British sense of humor.',
                          t('onboarding.toneStrictShort')
                        )
                      }
                      className="p-3.5 rounded-xl border border-theme-border bg-theme-bg"
                      style={
                        node.data?.selected === t('onboarding.toneStrictShort')
                          ? { borderColor: theme.tint, backgroundColor: accentAlpha(0.1) }
                          : undefined
                      }
                    >
                      <View className="flex-row items-center">
                        <View className="w-10 h-10 rounded-full overflow-hidden border border-theme-border mr-3 bg-theme-bg">
                          <Image
                            source={getCoachAvatarSource('Strict with data, but with a dry, snarky British sense of humor.')}
                            className="w-full h-full"
                          />
                        </View>
                        <View className="flex-1">
                          <Text className="text-theme-text font-bold text-xs">{t('onboarding.toneStrictTitle')}</Text>
                          <Text className="text-theme-muted text-xs mt-0.5">
                            {t('onboarding.toneStrictDesc')}
                          </Text>
                        </View>
                      </View>
                    </Pressable>

                    <Pressable
                      disabled={isStreamingMessage}
                      onPress={() =>
                        handleSelectPersonaChoice(
                          'Enthusiastic cheerleader, extremely positive and forgiving.',
                          t('onboarding.toneCheerleaderShort')
                        )
                      }
                      className="p-3.5 rounded-xl border border-theme-border bg-theme-bg"
                      style={
                        node.data?.selected === t('onboarding.toneCheerleaderShort')
                          ? { borderColor: theme.tint, backgroundColor: accentAlpha(0.1) }
                          : undefined
                      }
                    >
                      <View className="flex-row items-center">
                        <View className="w-10 h-10 rounded-full overflow-hidden border border-theme-border mr-3 bg-theme-bg">
                          <Image
                            source={getCoachAvatarSource('Enthusiastic cheerleader, extremely positive and forgiving.')}
                            className="w-full h-full"
                          />
                        </View>
                        <View className="flex-1">
                          <Text className="text-theme-text font-bold text-xs">{t('onboarding.toneCheerleaderTitle')}</Text>
                          <Text className="text-theme-muted text-xs mt-0.5">
                            {t('onboarding.toneCheerleaderDesc')}
                          </Text>
                        </View>
                      </View>
                    </Pressable>
                  </View>
                );
              }

              if (node.type === 'card_gender') {
                const selectedGender = node.data?.selected || gender;
                return (
                  <View
                    key={node.id}
                    className="bg-theme-card border border-theme-border rounded-card p-4 mb-5 gap-3 shadow-sm"
                  >
                    <Text className="text-theme-text font-bold text-sm">{t('onboarding.genderTitle')}</Text>
                    <Text className="text-theme-muted text-xs">
                      {t('onboarding.genderSubtitle')}
                    </Text>

                    <View className="gap-2.5 mt-1">
                      {[
                        { label: t('onboarding.genderMale'), val: 'Male', icon: 'male-outline', desc: t('onboarding.genderMaleDesc') },
                        { label: t('onboarding.genderFemale'), val: 'Female', icon: 'female-outline', desc: t('onboarding.genderFemaleDesc') },
                        { label: t('onboarding.genderPreferNot'), val: 'Prefer not to share', icon: 'shield-outline', desc: t('onboarding.genderPreferNotDesc') },
                      ].map((opt) => (
                        <Pressable
                          key={opt.val}
                          disabled={isStreamingMessage}
                          onPress={() => handleSelectGenderChoice(opt.val, opt.label)}
                          className="p-3.5 rounded-xl border border-theme-border bg-theme-bg"
                          style={
                            selectedGender === opt.val
                              ? { borderColor: theme.tint, backgroundColor: accentAlpha(0.1) }
                              : undefined
                          }
                        >
                          <View className="flex-row items-center">
                            <View className="w-9 h-9 rounded-full bg-theme-accent/20 items-center justify-center mr-3">
                              <Ionicons name={opt.icon as any} size={18} color={theme.tint} />
                            </View>
                            <View className="flex-1">
                              <Text className="text-theme-text font-bold text-xs">{opt.label}</Text>
                              <Text className="text-theme-muted text-xs mt-0.5">{opt.desc}</Text>
                            </View>
                            {selectedGender === opt.val && (
                              <Ionicons name="checkmark-circle" size={18} color={theme.tint} />
                            )}
                          </View>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                );
              }

              if (node.type === 'card_context_event') {
                const isCompleted = !!node.data?.completed;
                return (
                  <View
                    key={node.id}
                    className="bg-theme-card border border-theme-border rounded-card p-4 mb-5 gap-4 shadow-sm"
                    style={!isCompleted ? { borderColor: accentAlpha(0.5) } : undefined}
                  >
                    <Text className="text-theme-text font-bold text-sm">{t('onboarding.contextTitle')}</Text>

                    <TextInput
                      editable={!isStreamingMessage}
                      multiline
                      numberOfLines={4}
                      value={athleteContext}
                      onChangeText={handleAthleteContextChange}
                      placeholder={t('onboarding.contextPlaceholder')}
                      placeholderTextColor={theme.textSecondary}
                      className="p-4 bg-theme-bg border border-theme-border rounded-xl text-theme-text text-xs min-h-[90px]"
                      style={{ textAlignVertical: 'top' }}
                    />

                    {/* Age — required for heart-rate zones */}
                    <View className="bg-theme-bg border border-theme-border rounded-xl p-3 gap-2">
                      <Text className="text-theme-text font-bold text-xs">
                        {t('onboarding.ageTitle')}
                      </Text>
                      <Text className="text-theme-muted text-xs">
                        {t('onboarding.ageSubtitle')}
                      </Text>
                      <View className="flex-row items-center gap-2">
                        <TextInput
                          editable={!isStreamingMessage}
                          placeholder="35"
                          placeholderTextColor={theme.textSecondary}
                          value={age}
                          onChangeText={(v) => setAge(v.replace(/[^0-9]/g, '').slice(0, 3))}
                          keyboardType="number-pad"
                          style={{ color: theme.tint }}
                          className="w-16 p-2.5 bg-theme-card border border-theme-border rounded-control text-sm font-bold text-center"
                        />
                        <Text className="text-theme-muted text-sm">
                          {t('onboarding.ageYears')}
                        </Text>
                        {age && Number(age) > 0 && Number(age) < 120 ? (
                          <Text className="text-theme-muted text-xs ml-1">
                            {t('onboarding.ageMaxHr', { bpm: String(220 - Number(age)) })}
                          </Text>
                        ) : null}
                      </View>
                    </View>

                    {/* Physiological Baselines */}
                    <View className="bg-theme-bg border border-theme-border rounded-xl p-3 gap-2">
                      <Text className="text-theme-muted text-xs font-bold">
                        {t('onboarding.baselinesTitle')}
                      </Text>
                      {metrics.map((item, idx) => (
                        <View key={idx} className="flex-row gap-2">
                          <TextInput
                            editable={!isStreamingMessage}
                            placeholder={t('onboarding.baselinePlaceholderLabel')}
                            placeholderTextColor={theme.textSecondary}
                            value={item.label}
                            onChangeText={(val) => {
                              const updated = [...metrics];
                              updated[idx].label = val;
                              setMetrics(updated);
                            }}
                            className="flex-1 p-2.5 bg-theme-card border border-theme-border rounded-control text-theme-text text-xs"
                          />
                          <TextInput
                            editable={!isStreamingMessage}
                            placeholder={t('onboarding.baselinePlaceholderValue')}
                            placeholderTextColor={theme.textSecondary}
                            value={item.value}
                            onChangeText={(val) => {
                              const updated = [...metrics];
                              updated[idx].value = val;
                              setMetrics(updated);
                            }}
                            className="w-24 p-2.5 bg-theme-card border border-theme-border rounded-control text-theme-text text-xs"
                          />
                        </View>
                      ))}
                      <Pressable
                        disabled={isStreamingMessage}
                        onPress={addMetricRow}
                        className="py-1.5 items-center bg-theme-accent/10 border border-theme-accent/30 rounded-lg mt-1"
                      >
                        <Text className="text-theme-accent text-xs font-bold">{t('onboarding.addMetric')}</Text>
                      </Pressable>
                    </View>

                    {/* Main Goal & Target Setup */}
                    <View className="bg-theme-bg border border-theme-border rounded-xl p-3 gap-3">
                      <Text className="text-theme-muted text-xs font-bold">
                        {t('onboarding.targetEventTitle')}
                      </Text>

                      {/* GOAL TYPE SELECTOR: RACE vs PHYSIOLOGICAL */}
                      <View className="flex-row bg-theme-card p-1 rounded-xl border border-theme-border/50">
                        <Pressable
                          disabled={isStreamingMessage}
                          onPress={() => {
                            Haptics.selectionAsync();
                            setGoalType('race');
                          }}
                          className={`flex-1 py-1.5 rounded-lg items-center flex-row justify-center ${
                            goalType === 'race' ? 'bg-theme-accent' : 'bg-transparent'
                          }`}
                        >
                          <Ionicons
                            name="flag-outline"
                            size={13}
                            color={goalType === 'race' ? '#FFFFFF' : theme.textSecondary}
                          />
                          <Text
                            className={`text-xs font-bold ml-1.5 ${
                              goalType === 'race' ? 'text-white' : 'text-theme-muted'
                            }`}
                          >
                            {t('onboarding.goalTypeRace')}
                          </Text>
                        </Pressable>

                        <Pressable
                          disabled={isStreamingMessage}
                          onPress={() => {
                            Haptics.selectionAsync();
                            setGoalType('physiological');
                          }}
                          className={`flex-1 py-1.5 rounded-lg items-center flex-row justify-center ${
                            goalType === 'physiological' ? 'bg-theme-accent' : 'bg-transparent'
                          }`}
                        >
                          <Ionicons
                            name="fitness-outline"
                            size={13}
                            color={goalType === 'physiological' ? '#FFFFFF' : theme.textSecondary}
                          />
                          <Text
                            className={`text-xs font-bold ml-1.5 ${
                              goalType === 'physiological' ? 'text-white' : 'text-theme-muted'
                            }`}
                          >
                            {t('onboarding.goalTypePhysiological')}
                          </Text>
                        </Pressable>
                      </View>

                      {goalType === 'race' ? (
                        <>
                          {/* Race Event Name */}
                          <View className="gap-1">
                            <Text className="text-xs font-bold text-theme-muted">
                              {t('onboarding.raceNameLabel')}
                            </Text>
                            <TextInput
                              editable={!isStreamingMessage}
                              placeholder={t('onboarding.raceNamePlaceholder')}
                              placeholderTextColor={theme.textSecondary}
                              value={raceName}
                              onChangeText={handleRaceNameChange}
                              className="p-2.5 bg-theme-card border border-theme-border rounded-control text-theme-text text-xs font-bold"
                            />
                          </View>

                          {/* Race Date */}
                          <View className="gap-1">
                            <Text className="text-xs font-bold text-theme-muted">
                              {t('onboarding.raceDateLabel')}
                            </Text>
                            <Pressable
                              disabled={isStreamingMessage}
                              onPress={openDatePickerModal}
                              className="w-full p-2.5 bg-theme-card border border-theme-border rounded-control flex-row items-center justify-between"
                            >
                              <Text
                                className={
                                  raceDate
                                    ? 'text-theme-text text-xs font-bold'
                                    : 'text-theme-muted text-xs font-bold'
                                }
                              >
                                {formatDateDisplay(raceDate)}
                              </Text>
                              <Ionicons name="calendar-outline" size={15} color={theme.tint} />
                            </Pressable>
                          </View>

                          {/* Target Selection: Finish vs Time */}
                          <View className="gap-1.5">
                            <Text className="text-xs font-bold text-theme-muted">
                              {t('onboarding.raceTargetLabel')}
                            </Text>
                            <View className="flex-row gap-2">
                              <Pressable
                                disabled={isStreamingMessage}
                                onPress={() => {
                                  Haptics.selectionAsync();
                                  setTargetMode('finish');
                                }}
                                className={`flex-1 p-2.5 rounded-xl border flex-row items-center justify-center ${
                                  targetMode === 'finish'
                                    ? 'bg-theme-accent/15 border-theme-accent'
                                    : 'bg-theme-card border-theme-border/50'
                                }`}
                              >
                                <Ionicons
                                  name="checkmark-circle-outline"
                                  size={14}
                                  color={targetMode === 'finish' ? theme.tint : theme.textSecondary}
                                />
                                <Text
                                  className={`text-xs font-bold ml-1.5 ${
                                    targetMode === 'finish' ? 'text-theme-accent' : 'text-theme-muted'
                                  }`}
                                >
                                  {t('onboarding.finishRace')}
                                </Text>
                              </Pressable>

                              <Pressable
                                disabled={isStreamingMessage}
                                onPress={() => {
                                  Haptics.selectionAsync();
                                  setTargetMode('time');
                                }}
                                className={`flex-1 p-2.5 rounded-xl border flex-row items-center justify-center ${
                                  targetMode === 'time'
                                    ? 'bg-theme-accent/15 border-theme-accent'
                                    : 'bg-theme-card border-theme-border/50'
                                }`}
                              >
                                <Ionicons
                                  name="time-outline"
                                  size={14}
                                  color={targetMode === 'time' ? theme.tint : theme.textSecondary}
                                />
                                <Text
                                  className={`text-xs font-bold ml-1.5 ${
                                    targetMode === 'time' ? 'text-theme-accent' : 'text-theme-muted'
                                  }`}
                                >
                                  {t('onboarding.timeGoal')}
                                </Text>
                              </Pressable>
                            </View>
                          </View>

                          {/* If Time Goal Selected */}
                          {targetMode === 'time' && (
                            <View className="gap-1">
                              <Text className="text-xs font-bold text-theme-muted">
                                {t('onboarding.targetTimeLabel')}
                              </Text>
                              <TextInput
                                editable={!isStreamingMessage}
                                value={targetValue}
                                onChangeText={setTargetValue}
                                placeholder={t('onboarding.targetTimePlaceholder')}
                                placeholderTextColor={theme.textSecondary}
                                className="p-2.5 bg-theme-card border border-theme-border rounded-control text-theme-text text-xs font-bold"
                              />
                            </View>
                          )}
                        </>
                      ) : (
                        <>
                          {/* Physiological Goal Title */}
                          <View className="gap-1">
                            <Text className="text-xs font-bold text-theme-muted">
                              {t('onboarding.physiologicalGoalTitleLabel')}
                            </Text>
                            <TextInput
                              editable={!isStreamingMessage}
                              value={raceName}
                              onChangeText={handleRaceNameChange}
                              placeholder={t('onboarding.physiologicalGoalTitlePlaceholder')}
                              placeholderTextColor={theme.textSecondary}
                              className="p-2.5 bg-theme-card border border-theme-border rounded-control text-theme-text text-xs font-bold"
                            />
                          </View>

                          {/* Target Date */}
                          <View className="gap-1">
                            <Text className="text-xs font-bold text-theme-muted">
                              {t('onboarding.targetDateLabel')}
                            </Text>
                            <Pressable
                              disabled={isStreamingMessage}
                              onPress={openDatePickerModal}
                              className="w-full p-2.5 bg-theme-card border border-theme-border rounded-control flex-row items-center justify-between"
                            >
                              <Text
                                className={
                                  raceDate
                                    ? 'text-theme-text text-xs font-bold'
                                    : 'text-theme-muted text-xs font-bold'
                                }
                              >
                                {formatDateDisplay(raceDate)}
                              </Text>
                              <Ionicons name="calendar-outline" size={15} color={theme.tint} />
                            </Pressable>
                          </View>

                          {/* Goal Weight (kg) */}
                          <View className="gap-1">
                            <Text className="text-xs font-bold text-theme-muted">
                              {t('onboarding.targetWeightLabel')}
                            </Text>
                            <TextInput
                              editable={!isStreamingMessage}
                              value={targetWeight}
                              onChangeText={setTargetWeight}
                              placeholder={t('onboarding.targetWeightPlaceholder')}
                              placeholderTextColor={theme.textSecondary}
                              keyboardType="numeric"
                              className="p-2.5 bg-theme-card border border-theme-border rounded-control text-theme-text text-xs font-bold"
                            />
                          </View>
                        </>
                      )}
                    </View>

                    <Pressable
                      disabled={isStreamingMessage}
                      onPress={handleConfirmContextAndEvent}
                      className="w-full py-3 bg-theme-accent rounded-xl items-center justify-center shadow-md"
                    >
                      <Text className="text-white font-bold text-xs">
                        {isCompleted ? t('onboarding.updateContextEventBtn') : t('onboarding.confirmContextEventBtn')}
                      </Text>
                    </Pressable>
                  </View>
                );
              }

              if (node.type === 'card_schedule') {
                const isCompleted = !!node.data?.completed;
                return (
                  <View
                    key={node.id}
                    className="bg-theme-card border border-theme-border rounded-card p-4 mb-5 gap-3 shadow-sm"
                    style={!isCompleted ? { borderColor: accentAlpha(0.5) } : undefined}
                  >
                    <Text className="text-theme-text font-bold text-sm">{t('onboarding.scheduleTitle')}</Text>
                    <Text className="text-theme-muted text-xs">
                      {t('onboarding.scheduleSubtitle')}
                    </Text>

                    {/* One row per day: the day, then how long they can train,
                        with the unit spelled out. The previous 0m / 30m / 45m
                        pills were read as metres rather than minutes. */}
                    <View className="gap-2 pt-1">
                      {DAYS.map((day) => {
                        const currentVal = availability[day]?.maxMinutes || 0;
                        const isRest = currentVal === 0;
                        return (
                          <View
                            key={day}
                            className="bg-theme-bg px-3 py-2.5 rounded-xl border border-theme-border flex-row items-center justify-between"
                          >
                            <Text className="text-theme-text font-bold text-sm w-12">{day}</Text>

                            <DurationRoller
                              value={currentVal}
                              onChange={(minutes) => handleDayDurationChange(day, minutes)}
                              disabled={isStreamingMessage}
                              unitLabel={isRest ? t('onboarding.restDay') : t('onboarding.minutesUnit')}
                            />
                          </View>
                        );
                      })}
                    </View>

                    <Pressable
                      disabled={isStreamingMessage}
                      onPress={handleConfirmScheduleChoice}
                      className="w-full py-3 bg-theme-accent rounded-xl items-center justify-center shadow-md mt-2"
                    >
                      <Text className="text-white font-bold text-xs">
                        {isCompleted ? t('onboarding.updateScheduleBtn') : t('onboarding.confirmScheduleBtn')}
                      </Text>
                    </Pressable>
                  </View>
                );
              }

              if (node.type === 'card_integrations') {
                const isCompleted = !!node.data?.completed;
                const isGarminActive = isGarminSaved || !!user?.garmin_connected;
                const isStravaActive = !!user?.strava_connected;

                return (
                  <View
                    key={node.id}
                    className="bg-theme-card border border-theme-border rounded-card p-4 mb-5 gap-3 shadow-sm"
                    style={!isCompleted ? { borderColor: accentAlpha(0.5) } : undefined}
                  >
                    <Text className="text-theme-text font-bold text-sm">{t('onboarding.integrationsTitle')}</Text>

                    {/* Garmin Connect */}
                    <View className="bg-theme-bg border border-theme-border rounded-xl p-3.5 gap-3">
                      <View className="flex-row items-center justify-between">
                        <View className="flex-row items-center gap-3 flex-1 mr-2">
                          <Ionicons name="watch-outline" size={20} color="#007ACC" />
                          <View className="flex-1">
                            <View className="flex-row items-center gap-1.5 flex-wrap">
                              <Text className="text-theme-text font-bold text-xs">{t('onboarding.garminTitle')}</Text>
                              {isGarminActive && (
                                <View className="bg-semantic-success/10 px-1.5 py-0.5 rounded flex-row items-center gap-1">
                                  <Ionicons name="checkmark-circle" size={10} color="#22C55E" />
                                  <Text className="text-semantic-success text-xs font-bold">
                                    {t('onboarding.garminConnectedBadge')}
                                  </Text>
                                </View>
                              )}
                            </View>
                            <Text className="text-theme-muted text-xs">{t('onboarding.garminSubtitle')}</Text>
                          </View>
                        </View>
                        <Switch
                          disabled={isStreamingMessage || isSavingGarmin}
                          value={showGarmin}
                          onValueChange={(val) => {
                            setShowGarmin(val);
                          }}
                          trackColor={{ false: '#3A3A3C', true: theme.tint }}
                        />
                      </View>

                      {showGarmin && (
                        <View className="pt-2 gap-2 border border-theme-border">
                          {isGarminActive && (
                            <View className="bg-semantic-success/10 border border-semantic-success/20 rounded-lg p-2.5 flex-row items-center justify-between">
                              <View className="flex-row items-center gap-2 flex-1 mr-2">
                                <Ionicons name="checkmark-circle" size={16} color="#22C55E" />
                                <View className="flex-1">
                                  <Text className="text-semantic-success font-bold text-xs">
                                    {garminSaveSuccessMsg || t('onboarding.garminSavedSuccess')}
                                  </Text>
                                  <Text className="text-theme-muted text-xs" numberOfLines={1}>
                                    {t('onboarding.garminConnectedStatus')}: {garminEmail || (user as any)?.garmin_username || (user as any)?.garminUsername || 'Garmin User'}
                                  </Text>
                                </View>
                              </View>
                              <Pressable
                                disabled={isSavingGarmin}
                                onPress={handleDisconnectGarmin}
                                className="px-2 py-1 bg-theme-bg/60 rounded border border-theme-border"
                              >
                                <Text className="text-semantic-error font-medium text-xs">
                                  {t('onboarding.garminDisconnectBtn')}
                                </Text>
                              </Pressable>
                            </View>
                          )}

                          <TextInput
                            editable={!isStreamingMessage && !isSavingGarmin}
                            placeholder={t('onboarding.garminUserPlaceholder')}
                            placeholderTextColor={theme.textSecondary}
                            value={garminEmail}
                            onChangeText={(text) => {
                              setGarminEmail(text);
                              setIsGarminSaved(false);
                              setGarminError(null);
                              setGarminSaveSuccessMsg(null);
                            }}
                            autoCapitalize="none"
                            className="p-2.5 bg-theme-card border border-theme-border rounded-control text-theme-text text-xs"
                          />
                          <TextInput
                            editable={!isStreamingMessage && !isSavingGarmin}
                            placeholder={t('onboarding.garminPassPlaceholder')}
                            placeholderTextColor={theme.textSecondary}
                            secureTextEntry
                            value={garminPassword}
                            onChangeText={(text) => {
                              setGarminPassword(text);
                              setIsGarminSaved(false);
                              setGarminError(null);
                              setGarminSaveSuccessMsg(null);
                            }}
                            autoCapitalize="none"
                            className="p-2.5 bg-theme-card border border-theme-border rounded-control text-theme-text text-xs"
                          />

                          {garminError && (
                            <View className="flex-row items-center gap-1.5 px-1">
                              <Ionicons name="alert-circle" size={13} color="#EF4444" />
                              <Text className="text-semantic-error text-xs flex-1">{garminError}</Text>
                            </View>
                          )}

                          <Pressable
                            disabled={isStreamingMessage || isSavingGarmin || !garminEmail.trim() || !garminPassword.trim()}
                            onPress={handleSaveGarmin}
                            className={`py-2 px-3 rounded-lg flex-row items-center justify-center gap-1.5 ${!garminEmail.trim() || !garminPassword.trim()
                                ? 'bg-[#007ACC]/50 opacity-60'
                                : 'bg-[#007ACC]'
                              }`}
                          >
                            {isSavingGarmin ? (
                              <>
                                <ActivityIndicator size="small" color="#FFFFFF" />
                                <Text className="text-white font-bold text-xs">{t('onboarding.garminSavingBtn')}</Text>
                              </>
                            ) : (
                              <>
                                <Ionicons name="cloud-upload-outline" size={14} color="#FFFFFF" />
                                <Text className="text-white font-bold text-xs">{t('onboarding.garminSaveBtn')}</Text>
                              </>
                            )}
                          </Pressable>
                        </View>
                      )}
                    </View>

                    {/* Strava Connect */}
                    <View className="bg-theme-bg border border-theme-border rounded-xl p-3.5 gap-2">
                      <View className="flex-row items-center justify-between">
                        <View className="flex-row items-center gap-2 flex-1 mr-2">
                          <Ionicons name="bicycle" size={18} color="#FC4C02" />
                          <View className="flex-1">
                            <View className="flex-row items-center gap-1.5 flex-wrap">
                              <Text className="text-theme-text font-bold text-xs">{t('onboarding.stravaTitle')}</Text>
                              {isStravaActive && (
                                <View className="bg-semantic-success/10 px-1.5 py-0.5 rounded flex-row items-center gap-1">
                                  <Ionicons name="checkmark-circle" size={10} color="#22C55E" />
                                  <Text className="text-semantic-success text-xs font-bold">
                                    {t('onboarding.stravaConnectedBadge')}
                                  </Text>
                                </View>
                              )}
                            </View>
                            <Text className="text-theme-muted text-xs">{t('onboarding.stravaSubtitle')}</Text>
                          </View>
                        </View>

                        {isStravaActive ? (
                          <View className="flex-row items-center gap-1.5">
                            <Pressable
                              disabled={isStreamingMessage || isConnectingStrava}
                              onPress={handleConnectStravaOAuth}
                              className="bg-theme-card border border-theme-border px-2.5 py-1.5 rounded-control flex-row items-center gap-1"
                            >
                              {isConnectingStrava ? (
                                <ActivityIndicator size="small" color={theme.textSecondary} />
                              ) : (
                                <Text className="text-theme-muted text-xs font-semibold">
                                  {t('onboarding.stravaReconnectBtn')}
                                </Text>
                              )}
                            </Pressable>
                            <Pressable
                              disabled={isStreamingMessage || isConnectingStrava}
                              onPress={handleDisconnectStrava}
                              className="px-2 py-1.5 bg-theme-card border border-theme-border rounded-control"
                            >
                              <Text className="text-semantic-error font-medium text-xs">
                                {t('onboarding.stravaDisconnectBtn')}
                              </Text>
                            </Pressable>
                          </View>
                        ) : (
                          <Pressable
                            disabled={isStreamingMessage || isConnectingStrava}
                            onPress={handleConnectStravaOAuth}
                            className="bg-[#FC4C02] px-3 py-1.5 rounded-lg flex-row items-center gap-1.5"
                          >
                            {isConnectingStrava ? (
                              <>
                                <ActivityIndicator size="small" color="#FFFFFF" />
                                <Text className="text-white font-bold text-xs">
                                  {t('onboarding.stravaConnecting')}
                                </Text>
                              </>
                            ) : (
                              <Text className="text-white font-bold text-xs">
                                {t('onboarding.connectStrava')}
                              </Text>
                            )}
                          </Pressable>
                        )}
                      </View>

                      {stravaSuccessMsg && isStravaActive && (
                        <View className="bg-semantic-success/10 border border-semantic-success/20 rounded-lg p-2 flex-row items-center gap-1.5 mt-1">
                          <Ionicons name="checkmark-circle" size={14} color="#22C55E" />
                          <Text className="text-semantic-success font-semibold text-xs flex-1">
                            {stravaSuccessMsg}
                          </Text>
                        </View>
                      )}
                    </View>

                    <Pressable
                      disabled={isStreamingMessage || isSavingGarmin || isConnectingStrava}
                      onPress={handleConfirmIntegrationsChoice}
                      className="w-full py-3 bg-theme-accent rounded-xl items-center justify-center shadow-md mt-2"
                    >
                      <Text className="text-white font-bold text-xs">
                        {isCompleted ? t('onboarding.updateIntegrationsBtn') : t('onboarding.confirmIntegrationsBtn')}
                      </Text>
                    </Pressable>
                  </View>
                );
              }

              if (node.type === 'card_paywall') {
                return (
                  <View key={node.id} className="bg-theme-card border border-theme-border rounded-card p-5 mb-6 gap-4 shadow-sm">
                    <View className="items-center my-1">
                      <View className="w-12 h-12 rounded-2xl bg-theme-accent items-center justify-center mb-2 shadow-lg">
                        <RookaMark size={24} color="#FFFFFF" />
                      </View>
                      <Text className="text-theme-text font-extrabold text-lg text-center">{t('onboarding.paywallTitle')}</Text>
                      <Text className="text-theme-muted text-xs text-center mt-1">
                        {t('onboarding.paywallSubtitle')}
                      </Text>
                    </View>

                    {/* Pricing Tiers — every figure below comes from the server
                        (see server/services/pricing.js), so entering a discount
                        code re-renders these boxes with the real charge rather
                        than an estimate computed here. The locale strings are
                        the fallback for the moment before pricing arrives. */}
                    <View className="flex-row gap-3">
                      <Pressable
                        onPress={() => setSelectedPlan('annual')}
                        className="flex-1 p-3.5 rounded-2xl border border-theme-border bg-theme-bg"
                        style={
                          selectedPlan === 'annual'
                            ? { borderColor: theme.tint, backgroundColor: accentAlpha(0.1) }
                            : undefined
                        }
                      >
                        {!pricing || pricing.annualSavingsPercent > 0 ? (
                          <View className="self-start px-2 py-0.5 bg-theme-accent rounded-full mb-1.5">
                            <Text className="text-white font-bold text-xs">
                              {pricing
                                ? t('onboarding.savePercentValue', { percent: pricing.annualSavingsPercent })
                                : t('onboarding.savePercent')}
                            </Text>
                          </View>
                        ) : (
                          <View className="mb-1.5 h-[19px]" />
                        )}
                        <Text className="text-theme-text font-bold text-sm">{t('onboarding.annual')}</Text>
                        <Text className="text-theme-accent font-bold text-lg mt-0.5">
                          {pricing ? money(pricing.yearly.perMonth) : t('onboarding.annualPrice')}
                          <Text className="text-xs text-theme-muted">{t('onboarding.annualPeriod')}</Text>
                        </Text>
                        {pricing?.yearly.discounted ? (
                          <Text className="text-theme-muted text-xs line-through">
                            {money(pricing.yearly.originalPerMonth)}{t('onboarding.annualPeriod')}
                          </Text>
                        ) : null}
                        <Text className="text-theme-muted text-xs mt-0.5">
                          {pricing
                            ? t('onboarding.annualBilledValue', { price: money(pricing.yearly.final) })
                            : t('onboarding.annualBilled')}
                        </Text>
                      </Pressable>

                      <Pressable
                        onPress={() => setSelectedPlan('monthly')}
                        className="flex-1 p-3.5 rounded-2xl border border-theme-border bg-theme-bg"
                        style={
                          selectedPlan === 'monthly'
                            ? { borderColor: theme.tint, backgroundColor: accentAlpha(0.1) }
                            : undefined
                        }
                      >
                        <View className="mb-1.5 h-[19px]" />
                        <Text className="text-theme-text font-bold text-sm">{t('onboarding.monthly')}</Text>
                        <Text className="text-theme-text font-bold text-lg mt-0.5">
                          {pricing ? money(pricing.monthly.final) : t('onboarding.monthlyPrice')}
                          <Text className="text-xs text-theme-muted">{t('onboarding.monthlyPeriod')}</Text>
                        </Text>
                        {pricing?.monthly.discounted ? (
                          <Text className="text-theme-muted text-xs line-through">
                            {money(pricing.monthly.original)}{t('onboarding.monthlyPeriod')}
                          </Text>
                        ) : null}
                        <Text className="text-theme-muted text-xs mt-0.5">{t('onboarding.monthlyBilled')}</Text>
                      </Pressable>
                    </View>

                    {/* Discount code — validated live, committed only when the
                        athlete finishes setup, so an abandoned onboarding never
                        burns a one-time code. */}
                    <View>
                      <DiscountCodeField
                        label={t('onboarding.discountLabel')}
                        placeholder={t('onboarding.discountPlaceholder')}
                        disabled={isSubmitting}
                        onResult={setDiscountResult}
                      />
                      {validDiscount?.code?.durationMonths ? (
                        <Text className="text-[11px] text-theme-muted mt-1.5">
                          {t('onboarding.discountDuration', {
                            months: validDiscount.code.durationMonths,
                          })}
                        </Text>
                      ) : null}
                    </View>

                    {/* Feature Checklist */}
                    <View className="bg-theme-bg border border-theme-border rounded-xl p-3.5 gap-2">
                      {[
                        t('onboarding.feat1'),
                        t('onboarding.feat2'),
                        t('onboarding.feat3'),
                        t('onboarding.feat4'),
                      ].map((feat, idx) => (
                        <View key={idx} className="flex-row items-center gap-2">
                          <Ionicons name="checkmark-circle" size={16} color={theme.tint} />
                          <Text className="text-theme-text text-xs flex-1">{feat}</Text>
                        </View>
                      ))}
                    </View>

                    <View className="gap-2 pt-2">
                      <Pressable
                        onPress={() => handleCompleteSetup(true)}
                        disabled={isSubmitting}
                        className="w-full py-4 rounded-xl bg-theme-accent items-center justify-center shadow-lg"
                      >
                        {isSubmitting ? (
                          <ActivityIndicator color="white" />
                        ) : (
                          <Text className="text-white font-extrabold text-sm">{t('onboarding.startTrialBtn')}</Text>
                        )}
                      </Pressable>

                      <Pressable
                        onPress={() => handleCompleteSetup(false)}
                        disabled={isSubmitting}
                        className="w-full py-3 rounded-xl border border-theme-border bg-theme-bg items-center justify-center"
                      >
                        <Text className="text-theme-muted text-xs font-bold">{t('onboarding.freeTierBtn')}</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              }

              return null;
            })}
          </ScrollView>
        </Reanimated.View>
      </SafeAreaView>

      {/* Floating clone of the coach avatar used purely for the hero -> chat handoff animation.
          Deliberately rendered OUTSIDE the SafeAreaView, in this padding-free wrapper, so its
          absolute top/left line up 1:1 with the raw measureInWindow() coordinates below —
          no need to reason about how RN treats a positioned ancestor's own padding. */}
      <Reanimated.View
        pointerEvents="none"
        style={[{ position: 'absolute', overflow: 'hidden' }, avatarOverlayStyle]}
      >
        <Image
          source={getCoachAvatarSource(coachTone)}
          style={{ width: '100%', height: '100%' }}
        />
      </Reanimated.View>
    </View>
  );
}
