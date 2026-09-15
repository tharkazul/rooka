import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { RookaMark } from '../ui/RookaPoints';
import { BrandColors, accentAlpha } from '@/constants/theme';
import { View, Text, StyleSheet, Platform, useColorScheme, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Markdown from 'react-native-markdown-display';
import FitImage from 'react-native-fit-image';
import { API_BASE_URL } from '../../constants/api';
import { wsService } from '../../services/websocket';
import { chatApi } from '../../services/apiServices';

interface MarkdownTextProps {
  content: string;
  isUser?: boolean;
  isStreaming?: boolean;
  textColorOverride?: string;
  onImagePress?: (uri: string) => void;
  onLinkPress?: (url: string) => boolean | void;
}

const getFullImageUrl = (src?: string) => {
  if (!src) return '';
  if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) {
    return src;
  }
  return `${API_BASE_URL}${src.startsWith('/') ? src : `/${src}`}`;
};

export const hasRenderableText = (content?: string) => {
  if (!content) return false;
  if (!content.includes('```json')) return content.trim().length > 0;
  return !!content.replace(/```json[\s\S]*?```/gi, '').trim();
};

const LoadingImagePlaceholder: React.FC<{
  pendingKey: string;
  alt?: string;
  isDark: boolean;
  textColor: string;
  mutedColor: string;
  onImagePress?: (uri: string) => void;
}> = ({ pendingKey, alt, isDark, textColor, mutedColor, onImagePress }) => {
  const [resolvedUri, setResolvedUri] = useState<string | null>(null);

  useEffect(() => {
    // 1. Listen to real-time WebSocket event
    const unsub = wsService.subscribeToEvent('chat_image_ready', (data: any) => {
      if (data?.pendingKey === pendingKey && data?.imageUrl) {
        setResolvedUri(getFullImageUrl(data.imageUrl));
      }
    });

    // 2. Self-resolving backup poller every 1.5s
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      try {
        const historyRes = await chatApi.getHistory();
        const historyList = Array.isArray(historyRes) ? historyRes : (historyRes?.history || []);
        for (const msg of historyList) {
          if (msg.content && msg.content.includes('/api/images/chat/') && !msg.content.includes(`loading://${pendingKey}`)) {
            const match = msg.content.match(/!\[.*?\]\(((\/api\/images\/chat\/[^\s)]+))\)/);
            if (match && match[1]) {
              setResolvedUri(getFullImageUrl(match[1]));
              clearInterval(interval);
              break;
            }
          }
        }
      } catch (_) {}
      if (attempts >= 10) clearInterval(interval);
    }, 1500);

    return () => {
      unsub();
      clearInterval(interval);
    };
  }, [pendingKey]);

  if (resolvedUri) {
    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => onImagePress?.(resolvedUri)}
        style={{ width: '100%', marginVertical: 8 }}
      >
        <FitImage
          source={{ uri: resolvedUri }}
          indicator={false}
          style={{ borderRadius: 12, overflow: 'hidden' }}
          accessible={!!alt}
          accessibilityLabel={alt || undefined}
        />
      </TouchableOpacity>
    );
  }

  return (
    <View
      style={{
        width: '100%',
        marginVertical: 10,
        padding: 16,
        borderRadius: 16,
        backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)',
        borderWidth: 1,
        borderColor: isDark ? 'rgba(14, 165, 233, 0.3)' : 'rgba(14, 165, 233, 0.25)',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
        <RookaMark size={16} color={BrandColors.primary} />
        <Text style={{ color: textColor, fontWeight: '700', fontSize: 14 }}>
          Developing Visual Coaching Guide...
        </Text>
      </View>
      <ActivityIndicator size="small" color={BrandColors.primary} style={{ marginVertical: 8 }} />
      <Text style={{ color: mutedColor, fontSize: 12, textAlign: 'center' }}>
        {alt || 'High-resolution technique photo is generating in the background...'}
      </Text>
    </View>
  );
};

export const MarkdownText: React.FC<MarkdownTextProps> = React.memo(({ content, isUser, textColorOverride, onImagePress, onLinkPress }) => {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const router = useRouter();

  const displayContent = useMemo(() => {
    if (!content) return '';
    let text = content;
    if (text.includes('```json')) {
      text = text.replace(/```json[\s\S]*?```/gi, '');
    }
    // Auto-link token exhaustion upgrade placeholders if they don't have a markdown url target
    if (text.includes('[link to upgrade page]')) {
      text = text.replace(/\[link to upgrade page\](?!\()/gi, '[Upgrade Page](rooka://profile?subtab=account)');
    }
    return text.trim();
  }, [content]);

  const handleLinkPress = useCallback((url: string): boolean => {
    if (onLinkPress) {
      const res = onLinkPress(url);
      if (res === false) return false;
    }

    if (!url) return false;

    const lower = url.toLowerCase();
    if (
      lower.includes('subtab=account') ||
      lower.includes('profile') ||
      lower.includes('account') ||
      lower.includes('upgrade')
    ) {
      router.navigate({
        pathname: '/(tabs)/profile',
        params: { subtab: 'account' },
      });
      return false;
    }

    if (url.startsWith('/(tabs)/') || url.startsWith('/')) {
      router.push(url as any);
      return false;
    }

    if (url.startsWith('http://') || url.startsWith('https://')) {
      Linking.openURL(url).catch((err) => console.warn('Failed to open link:', err));
      return false;
    }

    return false;
  }, [onLinkPress, router]);

  const defaultCoachColor = isDark ? '#F8FAFC' : '#0F172A';
  const textColor = textColorOverride || (isUser ? '#FFFFFF' : defaultCoachColor);
  const accentColor = isUser ? '#FFFFFF' : BrandColors.primary;
  const mutedColor = isUser ? 'rgba(255,255,255,0.7)' : isDark ? '#94A3B8' : '#64748B';

  const markdownRules = useMemo(() => ({
    image: (node: any) => {
      const { src, alt } = node.attributes;
      if (src && src.startsWith('loading://')) {
        const pendingKey = src.replace('loading://', '');
        return (
          <LoadingImagePlaceholder
            key={node.key}
            pendingKey={pendingKey}
            alt={alt}
            isDark={isDark}
            textColor={textColor}
            mutedColor={mutedColor}
            onImagePress={onImagePress}
          />
        );
      }

      const uri = getFullImageUrl(src);
      if (!uri) return null;

      return (
        <TouchableOpacity
          key={node.key}
          activeOpacity={0.9}
          onPress={() => onImagePress?.(uri)}
          style={{ width: '100%', marginVertical: 8 }}
        >
          <FitImage
            source={{ uri }}
            indicator={false}
            style={{ borderRadius: 12, overflow: 'hidden' }}
            accessible={!!alt}
            accessibilityLabel={alt || undefined}
          />
        </TouchableOpacity>
      );
    },
  }), [onImagePress, textColor, mutedColor, isDark]);

  const styles = useMemo(() => StyleSheet.create({
    body: {
      color: textColor,
      fontSize: 15,
      lineHeight: 22,
    },
    heading1: {
      color: textColor,
      fontSize: 20,
      fontWeight: '800',
      marginTop: 8,
      marginBottom: 4,
    },
    heading2: {
      color: textColor,
      fontSize: 18,
      fontWeight: '700',
      marginTop: 6,
      marginBottom: 4,
    },
    heading3: {
      color: textColor,
      fontSize: 16,
      fontWeight: '700',
      marginTop: 4,
      marginBottom: 2,
    },
    paragraph: {
      color: textColor,
      marginTop: 0,
      marginBottom: 6,
    },
    strong: {
      fontWeight: '700',
      color: textColor,
    },
    em: {
      fontStyle: 'italic',
      color: textColor,
    },
    link: {
      color: accentColor,
      textDecorationLine: 'underline',
    },
    code_inline: {
      backgroundColor: isUser ? 'rgba(255, 255, 255, 0.2)' : isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.06)',
      color: accentColor,
      borderRadius: 4,
      paddingHorizontal: 4,
      paddingVertical: 1,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 13,
    },
    code_block: {
      backgroundColor: isUser ? 'rgba(0, 0, 0, 0.2)' : isDark ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.05)',
      borderRadius: 8,
      padding: 10,
      marginVertical: 6,
      borderWidth: 1,
      borderColor: isUser ? 'rgba(255, 255, 255, 0.2)' : isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.1)',
    },
    fence: {
      backgroundColor: isUser ? 'rgba(0, 0, 0, 0.2)' : isDark ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.05)',
      borderRadius: 8,
      padding: 10,
      marginVertical: 6,
      borderWidth: 1,
      borderColor: isUser ? 'rgba(255, 255, 255, 0.2)' : isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.1)',
    },
    bullet_list: {
      marginVertical: 2,
    },
    ordered_list: {
      marginVertical: 2,
    },
    bullet_list_icon: {
      color: accentColor,
      fontSize: 16,
      lineHeight: 22,
      marginRight: 6,
    },
    ordered_list_icon: {
      color: accentColor,
      fontSize: 14,
      lineHeight: 22,
      fontWeight: 'bold',
      marginRight: 6,
    },
    list_item: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginVertical: 1,
    },
    table: {
      borderWidth: 1,
      borderColor: isUser ? 'rgba(255, 255, 255, 0.3)' : isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
      borderRadius: 6,
      marginVertical: 6,
    },
    tableHeader: {
      backgroundColor: isUser ? 'rgba(255, 255, 255, 0.15)' : accentAlpha(0.15),
    },
    tableRow: {
      borderBottomWidth: 1,
      borderColor: isUser ? 'rgba(255, 255, 255, 0.2)' : isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
    },
    tableCell: {
      padding: 6,
      color: textColor,
      fontSize: 13,
    },
    hr: {
      backgroundColor: mutedColor,
      height: 1,
      marginVertical: 8,
    },
  }), [textColor, accentColor, mutedColor, isUser, isDark]);

  if (!displayContent) return null;

  return (
    <View className="w-full">
      <Markdown rules={markdownRules} style={styles} onLinkPress={handleLinkPress}>
        {displayContent}
      </Markdown>
    </View>
  );
});
