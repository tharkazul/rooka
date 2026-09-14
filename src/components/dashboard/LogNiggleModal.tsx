import { SheetGrabber } from '@/components/ui/SheetGrabber';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSheetDismiss } from '../../hooks/use-sheet-dismiss';
import { useHealth } from '../../context/HealthStore';
import { BODY_PARTS_LOOKUP } from '../progress/AnatomicalBodyMap';
import { Button } from '../ui/Button';
import { TextInput } from '../ui/TextInput';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface LogNiggleModalProps {
  visible: boolean;
  onClose: () => void;
  onSendToCoach: (description: string, severity: number, bodyPartId?: string, bodyPartName?: string) => void;
}

interface BodyRegion {
  key: string;
  name: string;
  isBilateral: boolean;
}

const BODY_REGIONS: BodyRegion[] = [
  { key: 'ankle_foot', name: 'Ankle & Foot / Heel', isBilateral: true },
  { key: 'calf', name: 'Calf & Shin', isBilateral: true },
  { key: 'knee', name: 'Knee', isBilateral: true },
  { key: 'hamstring', name: 'Hamstring', isBilateral: true },
  { key: 'quad', name: 'Quadricep', isBilateral: true },
  { key: 'glute', name: 'Glute & Hip', isBilateral: true },
  { key: 'lower_back', name: 'Lower Back', isBilateral: false },
  { key: 'upper_back', name: 'Upper Back', isBilateral: false },
  { key: 'shoulder', name: 'Shoulder', isBilateral: true },
  { key: 'arm', name: 'Arm & Elbow', isBilateral: true },
  { key: 'core', name: 'Core & Groin', isBilateral: false },
  { key: 'head_neck', name: 'Head & Neck', isBilateral: false },
];

const inferBodyPartFromText = (text: string): { baseKey: string; side: 'left' | 'right' } => {
  const lower = text.toLowerCase();
  const isRight = lower.includes('right') || lower.includes('rechts');
  const side: 'left' | 'right' = isRight ? 'right' : 'left';

  if (/heel|achilles|plantar|foot|feet|ankle|toe|voet|enkel|hiel/i.test(lower)) {
    return { baseKey: 'ankle_foot', side };
  }
  if (/calf|calves|shin|shins|soleus|kuit|scheen/i.test(lower)) {
    return { baseKey: 'calf', side };
  }
  if (/knee|kneecap|patella|meniscus|itb|it band|knie/i.test(lower)) {
    return { baseKey: 'knee', side };
  }
  if (/hamstring|hamstrings/i.test(lower)) {
    return { baseKey: 'hamstring', side };
  }
  if (/quad|quads|quadricep|thigh|bovenbeen/i.test(lower)) {
    return { baseKey: 'quad', side };
  }
  if (/glute|glutes|hip|hips|piriformis|butt|bil|heup/i.test(lower)) {
    return { baseKey: 'glute', side };
  }
  if (/lower back|lumbar|spine|onderrug/i.test(lower)) {
    return { baseKey: 'lower_back', side: 'left' };
  }
  if (/upper back|trap|traps|rhomboid|bovenrug/i.test(lower)) {
    return { baseKey: 'upper_back', side: 'left' };
  }
  if (/shoulder|rotator|deltoid|schouder/i.test(lower)) {
    return { baseKey: 'shoulder', side };
  }
  if (/arm|bicep|tricep|elbow|wrist|forearm|elleboog|pols/i.test(lower)) {
    return { baseKey: 'arm', side };
  }
  if (/chest|pec|borst/i.test(lower)) {
    return { baseKey: 'chest', side: 'left' };
  }
  if (/core|abs|abdominal|groin|lies|buik/i.test(lower)) {
    return { baseKey: 'core', side: 'left' };
  }
  if (/neck|cervical|head|nek|hoofd/i.test(lower)) {
    return { baseKey: 'head_neck', side: 'left' };
  }
  return { baseKey: 'ankle_foot', side };
};

export function LogNiggleModal({
  visible,
  onClose,
  onSendToCoach,
}: LogNiggleModalProps) {
  const insets = useSafeAreaInsets();
  const { saveNiggle } = useHealth();
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<number>(3); // 1-10
  const [selectedBaseKey, setSelectedBaseKey] = useState<string>('ankle_foot');
  const [selectedSide, setSelectedSide] = useState<'left' | 'right'>('left');
  const [isManuallySelected, setIsManuallySelected] = useState<boolean>(false);

  const [showModal, setShowModal] = useState(visible);
  const { dragY, panHandlers } = useSheetDismiss(onClose);
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setShowModal(true);
      slideAnim.setValue(SCREEN_HEIGHT);
      backdropOpacity.setValue(0);
      setIsManuallySelected(false);

      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          damping: 25,
          stiffness: 220,
          mass: 0.8,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 160,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: SCREEN_HEIGHT,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setShowModal(false);
      });
    }
  }, [visible, slideAnim, backdropOpacity]);

  const handleDescriptionChange = (text: string) => {
    setDescription(text);
    if (!isManuallySelected && text.trim().length > 2) {
      const inferred = inferBodyPartFromText(text);
      setSelectedBaseKey(inferred.baseKey);
      setSelectedSide(inferred.side);
    }
  };

  const getFullBodyPartId = (baseKey: string, side: 'left' | 'right'): string => {
    const region = BODY_REGIONS.find((r) => r.key === baseKey);
    if (region?.isBilateral) {
      return `${side}_${baseKey}`;
    }
    return baseKey;
  };

  const currentBodyPartId = getFullBodyPartId(selectedBaseKey, selectedSide);
  const currentDisplayName = BODY_PARTS_LOOKUP[currentBodyPartId] || currentBodyPartId;
  const currentRegion = BODY_REGIONS.find((r) => r.key === selectedBaseKey);

  const handleSend = async () => {
    if (!description.trim()) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Map 1-10 severity to 1-5 scale for health store & anatomical mannequin
    const healthSeverity = Math.max(1, Math.min(5, Math.ceil(severity / 2)));

    // 1. Immediately save to HealthStore so the Health Tracker / Heatmap is updated
    await saveNiggle({
      body_part: currentBodyPartId,
      severity: healthSeverity,
      notes: description.trim(),
    });

    // 2. Notify Coach
    onSendToCoach(description.trim(), severity, currentBodyPartId, currentDisplayName);

    setDescription('');
    setIsManuallySelected(false);
    onClose();
  };

  const getSeverityBadge = (level: number) => {
    if (level <= 3) return { label: 'Mild / Stiffness', color: 'text-semantic-success', bg: 'bg-semantic-success/15' };
    if (level <= 6) return { label: 'Moderate Discomfort', color: 'text-semantic-warning', bg: 'bg-semantic-warning/15' };
    return { label: 'Severe Pain / Injury', color: 'text-semantic-error', bg: 'bg-semantic-error/15' };
  };

  const badge = getSeverityBadge(severity);

  if (!showModal) return null;

  return (
    <Modal
      visible={showModal}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end', position: 'relative' }}>
          {/* Static Fullscreen Backdrop: Fades In Simultaneously */}
          <Animated.View
            style={[
              StyleSheet.absoluteFillObject,
              { backgroundColor: 'rgba(0,0,0,0.6)', opacity: backdropOpacity },
            ]}
          >
            <TouchableOpacity
              activeOpacity={1}
              onPress={onClose}
              style={{ flex: 1 }}
            />
          </Animated.View>

          {/* Bottom Sheet Modal Container */}
          <Animated.View
            style={[
              {
                transform: [{ translateY: Animated.add(slideAnim, dragY) }],
                paddingBottom: Math.max(insets.bottom, 20),
              },
            ]}
            className="bg-theme-card rounded-t-[32px] rounded-b-none px-6 pt-3 border-t border-theme-border/50 shadow-2xl flex-col max-h-[90%]"
          >
            {/* TOP PULL HANDLE INDICATOR — drag-to-dismiss grab area */}
            <View {...panHandlers} className="items-center pb-3 pt-1">
              <SheetGrabber />
            </View>

            {/* Header */}
            <View className="flex-row items-center justify-between pb-3 mb-2 border-b border-theme-border/50">
              <View className="flex-row items-center gap-2.5">
                <View className="w-9 h-9 rounded-xl bg-semantic-error/15 items-center justify-center">
                  <Ionicons name="bandage-outline" size={18} color="#F43F5E" />
                </View>
                <View>
                  <Text className="text-lg font-bold text-theme-text">Report Injury / Niggle</Text>
                  <Text className="text-xs text-theme-muted font-rajdhani">Records to Health Tracker & alerts rooka Coach</Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={onClose}
                className="w-8 h-8 rounded-full bg-theme-bg items-center justify-center"
              >
                <Ionicons name="close" size={18} color="#8E9BA4" />
              </TouchableOpacity>
            </View>

            {/* Scrollable Form Content */}
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 10 }}
            >
              {/* Description Text Input */}
              <View className="mb-3.5">
                <Text className="text-xs font-bold text-theme-muted mb-1.5">
                  What hurts or feels tight?
                </Text>
                <TextInput
                  value={description}
                  onChangeText={handleDescriptionChange}
                  placeholder="e.g. My heel hurts, achilles tightness after run..."
                  multiline
                  numberOfLines={2}
                  style={{ height: 60, textAlignVertical: 'top' }}
                />
              </View>

              {/* Body Part Selection */}
              <View className="mb-3.5">
                <View className="flex-row justify-between items-center mb-1.5">
                  <Text className="text-xs font-bold text-theme-muted">
                    Affected Area: <Text className="text-theme-accent font-extrabold">{currentDisplayName}</Text>
                  </Text>
                  {currentRegion?.isBilateral && (
                    <View className="flex-row bg-theme-bg rounded-lg p-0.5 border border-theme-border/60">
                      <TouchableOpacity
                        onPress={() => {
                          Haptics.selectionAsync();
                          setSelectedSide('left');
                          setIsManuallySelected(true);
                        }}
                        className={`px-2.5 py-0.5 rounded-md ${selectedSide === 'left' ? 'bg-theme-accent' : ''}`}
                      >
                        <Text className={`text-xs font-bold ${selectedSide === 'left' ? 'text-white' : 'text-theme-muted'}`}>Left</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          Haptics.selectionAsync();
                          setSelectedSide('right');
                          setIsManuallySelected(true);
                        }}
                        className={`px-2.5 py-0.5 rounded-md ${selectedSide === 'right' ? 'bg-theme-accent' : ''}`}
                      >
                        <Text className={`text-xs font-bold ${selectedSide === 'right' ? 'text-white' : 'text-theme-muted'}`}>Right</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                {/* Horizontal Scroll of Body Regions */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 6, paddingVertical: 2 }}
                >
                  {BODY_REGIONS.map((region) => {
                    const isSelected = selectedBaseKey === region.key;
                    return (
                      <TouchableOpacity
                        key={region.key}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setSelectedBaseKey(region.key);
                          setIsManuallySelected(true);
                        }}
                        className={`px-3 py-1.5 rounded-xl border ${isSelected
                            ? 'bg-semantic-error/15 border-semantic-error'
                            : 'bg-theme-bg border-theme-border/60'
                          }`}
                      >
                        <Text
                          className={`text-xs font-semibold ${isSelected ? 'text-semantic-error font-bold' : 'text-theme-text'
                            }`}
                        >
                          {region.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              {/* 1-10 Severity Rating Row */}
              <View className="mb-2">
                <View className="flex-row justify-between items-center mb-2">
                  <Text className="text-xs font-bold text-theme-muted">
                    Severity Rating ({severity}/10)
                  </Text>
                  <View className={`px-2.5 py-0.5 rounded-full ${badge.bg}`}>
                    <Text className={`text-xs font-extrabold ${badge.color}`}>{badge.label}</Text>
                  </View>
                </View>

                {/* 1-10 Rating Buttons Row */}
                <View className="flex-row justify-between gap-1">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => {
                    const isSelected = severity === num;
                    return (
                      <TouchableOpacity
                        key={num}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setSeverity(num);
                        }}
                        className={`flex-1 py-2 rounded-xl items-center justify-center ${isSelected
                            ? num <= 3
                              ? 'bg-semantic-success'
                              : num <= 6
                                ? 'bg-semantic-warning'
                                : 'bg-semantic-error'
                            : 'bg-theme-bg'
                          }`}
                      >
                        <Text
                          className={`text-xs font-mono font-extrabold ${isSelected ? 'text-white' : 'text-theme-text'
                            }`}
                        >
                          {num}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </ScrollView>

            {/* Pinned Action Buttons at Bottom */}
            <View className="flex-row gap-3 pt-3 border border-theme-border/30">
              <View className="flex-1">
                <Button label="Cancel" variant="outline" onPress={onClose} />
              </View>
              <View className="flex-1">
                <Button
                  label="Save"
                  variant="primary"
                  onPress={handleSend}
                  disabled={!description.trim()}
                />
              </View>
            </View>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
