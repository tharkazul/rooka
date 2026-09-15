import { BrandColors } from '@/constants/theme';
import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  shadowHost: {
    marginVertical: 4,
    borderRadius: 16,
  },
});

export const CARD_COLORS = {
  warmup: {
    bar: '#10B981', // Emerald
    bg: 'rgba(16, 185, 129, 0.05)',
    border: 'rgba(16, 185, 129, 0.3)',
    text: '#059669',
    badgeBg: 'rgba(16, 185, 129, 0.15)',
  },
  interval: {
    bar: '#3B82F6', // Royal Blue
    bg: 'rgba(59, 130, 246, 0.05)',
    border: 'rgba(59, 130, 246, 0.3)',
    text: '#2563EB',
    badgeBg: 'rgba(59, 130, 246, 0.15)',
  },
  recovery: {
    bar: '#F59E0B', // Amber
    bg: 'rgba(245, 158, 11, 0.05)',
    border: 'rgba(245, 158, 11, 0.3)',
    text: '#D97706',
    badgeBg: 'rgba(245, 158, 11, 0.15)',
  },
  cooldown: {
    bar: '#8B5CF6', // Purple
    bg: 'rgba(139, 92, 246, 0.05)',
    border: 'rgba(139, 92, 246, 0.3)',
    text: '#7C3AED',
    badgeBg: 'rgba(139, 92, 246, 0.15)',
  },
  repeat: {
    bar: BrandColors.primary, // Theme Accent
    bg: 'rgba(14, 165, 233, 0.05)',
    border: 'rgba(14, 165, 233, 0.3)',
    text: BrandColors.primary,
    badgeBg: 'rgba(14, 165, 233, 0.15)',
  },
  default: {
    bar: '#94A3B8', // Slate
    bg: '#F8FAFC',
    border: '#E2E8F0',
    text: '#64748B',
    badgeBg: '#F1F5F9',
  },
} as const;
