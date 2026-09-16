import React, { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, DeviceEventEmitter } from 'react-native';
import { chatApi, planApi, socialApi } from '../services/apiServices';
import { clearBadgeCountAsync, setBadgeCountAsync, setNotificationChatActive } from '../services/notificationService';
import { chatReadStorage, chatStorage } from '../services/storage';
import { wsService } from '../services/websocket';
import { ChatMessage, ProposedWorkoutItem, TokenUsage } from '../types/chat';
import { useActivities } from './ActivityStore';
import { useHealth } from './HealthStore';
import { usePhysique } from './PhysiqueStore';
import { usePlan } from './PlanStore';
import { useUser } from './UserStore';

interface CoachChatContextType {
  messages: ChatMessage[];
  sending: boolean;
  loading: boolean;
  error: string | null;
  tokenUsage: TokenUsage | null;
  unreadCount: number;
  isChatActive: boolean;
  setChatActive: (active: boolean) => void;
  markAsRead: () => Promise<void>;
  refreshMessages: () => Promise<void>;
  sendMessage: (text: string, imagesBase64?: string[]) => Promise<void>;
  resendMessage: (messageId: string | number) => Promise<void>;
  clearHistory: () => Promise<void>;
  acceptProposal: (messageId: string | number, plan: ProposedWorkoutItem[]) => Promise<void>;
  rejectProposal: (messageId: string | number) => void;
  acceptInvite: (inviteId: string) => Promise<void>;
  declineInvite: (inviteId: string) => Promise<void>;
  acceptConnection: (friendId: number | string) => Promise<void>;
  declineConnection: (friendId: number | string) => Promise<void>;
  checkin: () => Promise<void>;
}

const defaultWelcomeMessage: ChatMessage = {
  id: 'welcome-msg',
  content: `Welcome to your personalized endurance journey! ⚡️ I'm your AI endurance coach.

🎯 **Your First Step: Baseline Assessment Test**
Before we dial in high-load workouts, we need to calibrate your baseline fitness. Your initial benchmark test is scheduled in your plan to calculate your exact heart rate, power, and pace training zones.

📅 **First Week Overview**:
- **Days 1–2**: 🏁 **Baseline Assessment Workout** (record your max sustained effort)
- **Following Days**: Active recovery, controlled Zone 2 aerobic base building, and foundational training.

🧭 **Next Steps**:
1. Check your **Today** / **Plan** tab to view your scheduled benchmark workout and its specific intervals.
2. Connect your heart rate monitor or smartwatch before starting.
3. Complete the assessment effort so I can analyze your metrics and calculate your training zones!`,
  role: 'coach',
  timestamp: '2024-01-01T00:00:00.000Z',
  mood: 'motivated',
};

const splitCoachReply = (text?: string): string[] => {
  if (!text) return [];
  const parts = text
    .split(/(?:\r?\n)?(?:---(?:MSG|SPLIT|BREAK)---|\[\[SPLIT\]\]|<break\s*\/?>|<br\s*\/?>)(?:\r?\n)?/gi)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts : [text.trim()];
};

const parseWorkoutProposals = (content: string): ProposedWorkoutItem[] | undefined => {
  if (!content) return undefined;
  const jsonMatch = content.match(/```json\n?([\s\S]*?)```/i);
  if (jsonMatch && jsonMatch[1]) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim());
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].date && parsed[0].sport) {
        return parsed as ProposedWorkoutItem[];
      }
    } catch (e) {
      // ignore JSON parse error
    }
  }
  return undefined;
};

const parseConnectionRequestFromContent = (content?: string): any | undefined => {
  if (!content) return undefined;
  const match = content.match(/(.+?)\s+wants to connect with you on rooka!/i);
  if (match && match[1]) {
    return {
      type: 'connection_request',
      username: match[1].trim(),
      status: 'pending',
    };
  }
  return undefined;
};

const parsePayloadJson = (msg: ChatMessage): any | undefined => {
  if (msg.payload_json) {
    if (typeof msg.payload_json === 'object') return msg.payload_json;
    try {
      return JSON.parse(msg.payload_json);
    } catch (e) {
      return undefined;
    }
  }
  return parseConnectionRequestFromContent(msg.content);
};

export const sortMessagesChronological = (messagesList: ChatMessage[]): ChatMessage[] => {
  if (!messagesList || messagesList.length <= 1) return messagesList || [];

  return [...messagesList].sort((a, b) => {
    // welcome-msg is always pinned to the very beginning
    if (a.id === 'welcome-msg') return -1;
    if (b.id === 'welcome-msg') return 1;

    const timeA = new Date(a.timestamp || 0).getTime();
    const timeB = new Date(b.timestamp || 0).getTime();

    // If more than 1 second apart, sort chronologically by timestamp
    if (!isNaN(timeA) && !isNaN(timeB) && Math.abs(timeA - timeB) >= 1000) {
      return timeA - timeB;
    }

    // Secondary sort: if both have database IDs (e.g. 25, 26 or "25-0", "25-1")
    const numIdA = parseFloat(String(a.id).replace('-', '.'));
    const numIdB = parseFloat(String(b.id).replace('-', '.'));
    if (!isNaN(numIdA) && !isNaN(numIdB) && numIdA !== numIdB) {
      return numIdA - numIdB;
    }

    // Strict tie-breaker for same second: user prompt always precedes coach response
    if (a.role === 'user' && (b.role === 'coach' || b.role === 'assistant')) {
      return -1;
    }
    if ((a.role === 'coach' || a.role === 'assistant') && b.role === 'user') {
      return 1;
    }

    // Sub-part tie-breaker for coach parts with same id or timestamp
    if (!isNaN(timeA) && !isNaN(timeB) && timeA !== timeB) {
      return timeA - timeB;
    }

    return 0;
  });
};

const CoachChatContext = createContext<CoachChatContextType | undefined>(undefined);

export const CoachChatStore: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [messages, setMessagesState] = useState<ChatMessage[]>([defaultWelcomeMessage]);
  const [sending, setSending] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastReadTimestamp, setLastReadTimestamp] = useState<number>(0);
  const [isReadInitialized, setIsReadInitialized] = useState<boolean>(false);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | null>(null);

  const { refreshPlan } = usePlan();
  const { refreshPhysique } = usePhysique();
  const { refreshNiggles } = useHealth();
  const { refreshActivities } = useActivities();
  const { user, isAuthenticated, refreshUser } = useUser();

  const messagesRef = useRef<ChatMessage[]>(messages);
  const isChatActiveRef = useRef<boolean>(false);
  const isAppActiveRef = useRef<boolean>(AppState.currentState === 'active');
  const [isChatActive, setIsChatActiveState] = useState<boolean>(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const markAsRead = useCallback(async () => {
    let maxMsgTime = 0;
    for (const m of messagesRef.current) {
      if (m.id === 'welcome-msg') continue;
      const t = new Date(m.timestamp || 0).getTime();
      if (!isNaN(t) && t > maxMsgTime) maxMsgTime = t;
    }
    const now = Math.max(Date.now(), maxMsgTime + 1000);
    setLastReadTimestamp((prev) => (now > prev ? now : prev));
    setUnreadCount(0);
    if (user?.id) {
      await chatReadStorage.setLastReadTimestamp(now, user.id);
    }
    await clearBadgeCountAsync();
  }, [user?.id]);

  const setChatActive = useCallback((active: boolean) => {
    isChatActiveRef.current = active;
    setIsChatActiveState(active);
    setNotificationChatActive(active);
    if (active && isAppActiveRef.current) {
      markAsRead();
    }
  }, [markAsRead]);


  // Load last read timestamp and chat history when user changes or signs out
  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      setMessagesState([defaultWelcomeMessage]);
      messagesRef.current = [defaultWelcomeMessage];
      setLastReadTimestamp(0);
      setIsReadInitialized(false);
      setUnreadCount(0);
      setTokenUsage(null);
      setError(null);
      clearBadgeCountAsync();
      return;
    }

    // A valid user is logged in
    setMessagesState([defaultWelcomeMessage]);
    messagesRef.current = [defaultWelcomeMessage];
    setIsReadInitialized(false);

    chatReadStorage.getLastReadTimestamp(user.id).then((savedTs) => {
      if (!savedTs || savedTs === 0) {
        // First run on this device: seed baseline timestamp to now so historical
        // messages don't suddenly trigger ghost unread badges
        const seedTs = Date.now();
        chatReadStorage.setLastReadTimestamp(seedTs, user.id);
        setLastReadTimestamp(seedTs);
      } else {
        setLastReadTimestamp(savedTs);
      }
      setIsReadInitialized(true);
    });

    chatStorage.getChatHistory(user.id).then((local) => {
      if (local && Array.isArray(local) && local.length > 0) {
        setMessagesState(sortMessagesChronological(local.map(processMessageItem)));
      }
    });
    refreshMessages();
  }, [user?.id, isAuthenticated]);

  // Compute unread count whenever messages or lastReadTimestamp change (once initialized)
  useEffect(() => {
    if (!isReadInitialized) {
      return;
    }
    if (!messages || messages.length === 0) {
      setUnreadCount(0);
      clearBadgeCountAsync();
      return;
    }

    // If the user is actively viewing the chat screen in the foreground,
    // all incoming messages are instantly marked as read in real time.
    if (isChatActiveRef.current && isAppActiveRef.current) {
      let maxMsgTime = 0;
      for (const m of messages) {
        if (m.id === 'welcome-msg') continue;
        const t = new Date(m.timestamp || 0).getTime();
        if (!isNaN(t) && t > maxMsgTime) maxMsgTime = t;
      }
      const now = Math.max(Date.now(), maxMsgTime + 1000);
      setLastReadTimestamp((prev) => (now > prev ? now : prev));
      setUnreadCount(0);
      if (user?.id) {
        chatReadStorage.setLastReadTimestamp(now, user.id);
      }
      clearBadgeCountAsync();
      return;
    }

    const unread = messages.filter((m) => {
      if (m.id === 'welcome-msg') return false;
      if (m.role !== 'coach' && m.role !== 'assistant') return false;
      const msgTime = new Date(m.timestamp || 0).getTime();
      return !isNaN(msgTime) && msgTime > lastReadTimestamp;
    }).length;

    setUnreadCount(unread);
    if (unread === 0) {
      clearBadgeCountAsync();
    } else {
      setBadgeCountAsync(unread);
    }
  }, [messages, lastReadTimestamp, isReadInitialized, isChatActive, user?.id]);

  const setMessages = useCallback((action: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    setMessagesState((prev) => {
      const raw = typeof action === 'function' ? action(prev) : action;
      const sorted = sortMessagesChronological(raw);
      if (user?.id) {
        chatStorage.setChatHistory(sorted, user.id);
      }
      return sorted;
    });
  }, [user?.id]);

  const processMessageItem = useCallback((msg: ChatMessage): ChatMessage => {
    let images: string[] = [];
    if ((msg as any).image_path) {
      try {
        const parsed = JSON.parse((msg as any).image_path);
        if (Array.isArray(parsed)) images = parsed;
      } catch (_) {
        if (typeof (msg as any).image_path === 'string') {
          images = [(msg as any).image_path];
        }
      }
    }
    const proposedPlan = parseWorkoutProposals(msg.content);
    const payload = parsePayloadJson(msg);

    // Ensure SQLite timestamp is parsed as UTC
    let safeTimestamp = msg.timestamp || new Date().toISOString();
    if (safeTimestamp && typeof safeTimestamp === 'string' && !safeTimestamp.includes('Z') && !safeTimestamp.includes('T')) {
      safeTimestamp = safeTimestamp.replace(' ', 'T') + 'Z';
    }

    return {
      ...msg,
      timestamp: safeTimestamp,
      images: msg.images || images,
      proposedPlan: msg.proposedPlan || proposedPlan,
      proposalStatus: msg.proposalStatus || (proposedPlan ? 'pending' : undefined),
      payload_json: payload || (typeof msg.payload_json === 'object' ? msg.payload_json : undefined),
    };
  }, []);

  const refreshMessages = useCallback(async () => {
    if (!isAuthenticated || !user?.id) return;
    setLoading(true);
    try {
      const response = await chatApi.getHistory();
      if (response) {
        if (Array.isArray(response) && response.length > 0) {
          const processed: ChatMessage[] = [];
          response.forEach((m) => {
            const parts = splitCoachReply(m.content);
            if (parts.length > 1 && (m.role === 'coach' || m.role === 'assistant')) {
              parts.forEach((part, idx) => {
                processed.push(
                  processMessageItem({
                    ...m,
                    id: `${m.id}-${idx}`,
                    content: part,
                    timestamp: m.timestamp || (m as any).created_at || new Date().toISOString(),
                  })
                );
              });
            } else {
              processed.push(
                processMessageItem({
                  ...m,
                  id: m.id?.toString(),
                  timestamp: m.timestamp || (m as any).created_at || new Date().toISOString(),
                })
              );
            }
          });
          setMessages(sortMessagesChronological(processed));
        } else if ('history' in response && response.history && Array.isArray(response.history) && response.history.length > 0) {
          const processed: ChatMessage[] = [];
          response.history.forEach((m) => {
            const parts = splitCoachReply(m.content);
            if (parts.length > 1 && (m.role === 'coach' || m.role === 'assistant')) {
              parts.forEach((part, idx) => {
                processed.push(
                  processMessageItem({
                    ...m,
                    id: `${m.id}-${idx}`,
                    content: part,
                    timestamp: m.timestamp || (m as any).created_at || new Date().toISOString(),
                  })
                );
              });
            } else {
              processed.push(
                processMessageItem({
                  ...m,
                  id: m.id?.toString(),
                  timestamp: m.timestamp || (m as any).created_at || new Date().toISOString(),
                })
              );
            }
          });
          setMessages(sortMessagesChronological(processed));
          if (response.tokenUsage) {
            setTokenUsage(response.tokenUsage);
          }
        } else {
          setMessagesState([defaultWelcomeMessage]);
        }
      }
      setError(null);
    } catch (err: any) {
      console.log('CoachChatStore fetch info:', err.message || err);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, user?.id, processMessageItem, setMessages]);

  // Synchronize chat messages, active status, and unread state across app state transitions
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextAppState) => {
      const isNowActive = nextAppState === 'active';
      isAppActiveRef.current = isNowActive;
      if (isNowActive) {
        if (isAuthenticated && user?.id) {
          refreshMessages();
          if (isChatActiveRef.current) {
            markAsRead();
          }
        }
      } else {
        // App is moving to background or becoming inactive
        if (isChatActiveRef.current) {
          markAsRead();
          clearBadgeCountAsync();
        }
      }
    });
    return () => sub.remove();
  }, [isAuthenticated, user?.id, markAsRead, refreshMessages]);

  const sendMessage = async (text: string, imagesBase64?: string[]) => {
    if (!text.trim() && (!imagesBase64 || imagesBase64.length === 0)) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      clientId: `c-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      content: text,
      role: 'user',
      timestamp: new Date().toISOString(),
      images: imagesBase64,
    };

    setMessages((prev) => [...prev, userMsg]);
    setSending(true);

    try {
      const requestStart = Date.now();
      const res = await chatApi.sendMessage(text, imagesBase64);
      if (res && (res.replies || res.reply)) {
        const rawReplies: string[] = res.replies && res.replies.length > 0
          ? res.replies
          : splitCoachReply(res.reply);

        if (res.tokenUsage) {
          setTokenUsage(res.tokenUsage);
        }
        if (res.planUpdated) {
          refreshPlan();
          refreshNiggles();
          // The coach can log an activity, which also awards rooka points and
          // can level the athlete up. Neither the activity list nor the header
          // total was refreshed here, so a session logged in chat stayed
          // invisible on the dashboard until the app was relaunched.
          refreshActivities();
          refreshUser();
        }
        refreshPhysique();
        refreshNiggles();

        // Ensure typing indicator was shown for at least 800ms during API request
        const elapsed = Date.now() - requestStart;
        if (elapsed < 800) {
          await new Promise((resolve) => setTimeout(resolve, 800 - elapsed));
        }

        const baseTimestamp = Date.now();
        for (let i = 0; i < rawReplies.length; i++) {
          const replyPart = rawReplies[i];

          // If this is a subsequent bubble (2nd, 3rd, etc.), pause and show the typing indicator
          // so the user has time to read the preceding message and sees the coach "typing..." the next part.
          if (i > 0) {
            setSending(true);
            const typingDelay = Math.min(2800, Math.max(900, Math.round(replyPart.length * 14)));
            await new Promise((resolve) => setTimeout(resolve, typingDelay));
          }

          const partId = `coach-${baseTimestamp}-${i}`;
          const coachMsg: ChatMessage = processMessageItem({
            id: partId,
            clientId: `c-coach-${baseTimestamp}-${i}-${Math.random().toString(36).slice(2, 8)}`,
            content: replyPart,
            role: 'coach',
            mood: res.mood || 'default',
            timestamp: new Date(baseTimestamp + (i + 1) * 1000).toISOString(),
          });

          // WhatsApp style: drop full message bubble without typewriter effect
          setMessages((prev) => [...prev, coachMsg]);

          // Turn off typing indicator if this was the last bubble
          if (i === rawReplies.length - 1) {
            setSending(false);
          }
        }
      } else {
        setSending(false);
      }
    } catch (err: any) {
      console.error('Send message error:', err);
      setError(null);
      setMessages((prev) =>
        prev.map(m => (m.id === userMsg.id || m.clientId === userMsg.clientId) ? { ...m, isError: true } : m)
      );
      if (err.status === 429) {
        const fallbackText = "You have run out of tokens today, if you are eager to chat more, consider subscribing [Upgrade Page](rooka://profile?subtab=account)";
        const fallbackParts = splitCoachReply(fallbackText);
        const baseErrTimestamp = Date.now();
        for (let i = 0; i < fallbackParts.length; i++) {
          if (i > 0) {
            setSending(true);
            const typingDelay = Math.min(2800, Math.max(900, Math.round(fallbackParts[i].length * 14)));
            await new Promise((resolve) => setTimeout(resolve, typingDelay));
          }
          const fallbackCoachMsg: ChatMessage = processMessageItem({
            id: `coach-fallback-${baseErrTimestamp}-${i}`,
            clientId: `c-fallback-${baseErrTimestamp}-${i}-${Math.random().toString(36).slice(2, 8)}`,
            content: fallbackParts[i],
            role: 'coach',
            timestamp: new Date(baseErrTimestamp + (i + 1) * 1000).toISOString(),
          });
          setMessages((prev) => [...prev, fallbackCoachMsg]);
          if (i === fallbackParts.length - 1) {
            setSending(false);
          }
        }
      }
    } finally {
      setSending(false);
      if (isChatActiveRef.current && isAppActiveRef.current) {
        markAsRead();
      }
    }
  };

  const resendMessage = async (messageId: string | number) => {
    const msgIndex = messages.findIndex(m => m.id === messageId);
    if (msgIndex === -1) return;

    const msgToResend = messages[msgIndex];

    setMessages((prev) => {
      const idx = prev.findIndex(m => m.id === messageId);
      if (idx === -1) return prev;
      return prev.slice(0, idx);
    });

    await sendMessage(msgToResend.content, msgToResend.images);
  };

  const clearHistory = async () => {
    try {
      await chatApi.clearHistory();
      await chatStorage.clearChatHistory();
    } catch (e) {
      console.log('Clear history server call fallback:', e);
    }
    setMessages([defaultWelcomeMessage]);
  };

  const acceptProposal = async (messageId: string | number, plan: ProposedWorkoutItem[]) => {
    try {
      await planApi.acceptSuggestion(plan);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId ? { ...msg, proposalStatus: 'accepted' } : msg
        )
      );

      const confirmMsg: ChatMessage = {
        id: `user-accept-${Date.now()}`,
        content: `Accepted proposed plan changes!`,
        role: 'user',
        timestamp: new Date().toISOString(),
      };
      const ackMsg: ChatMessage = {
        id: `coach-ack-${Date.now()}`,
        content: `Awesome! I've updated your schedule. Let's make it count! 🚀`,
        role: 'coach',
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, confirmMsg, ackMsg]);
      await refreshPlan();
    } catch (err) {
      console.error('Failed to accept proposal:', err);
    }
  };

  const rejectProposal = (messageId: string | number) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId ? { ...msg, proposalStatus: 'rejected' } : msg
      )
    );
  };

  const acceptInvite = async (inviteId: string) => {
    try {
      setMessages((prev) =>
        prev.map((msg) => {
          const payload = msg.payload_json as any;
          if (payload && (String(payload.invite_id) === String(inviteId) || String(payload.id) === String(inviteId))) {
            return {
              ...msg,
              payload_json: { ...payload, status: 'accepted' },
            };
          }
          return msg;
        })
      );
      await socialApi.acceptInvite(inviteId);
    } catch (e) {
      console.error('Failed to accept invite:', e);
    }
  };

  const declineInvite = async (inviteId: string) => {
    try {
      setMessages((prev) =>
        prev.map((msg) => {
          const payload = msg.payload_json as any;
          if (payload && (String(payload.invite_id) === String(inviteId) || String(payload.id) === String(inviteId))) {
            return {
              ...msg,
              payload_json: { ...payload, status: 'declined' },
            };
          }
          return msg;
        })
      );
      await socialApi.declineInvite(inviteId);
    } catch (e) {
      console.error('Failed to decline invite:', e);
    }
  };

  const acceptConnection = async (friendId: number | string) => {
    try {
      await socialApi.acceptUser(friendId);
      setMessages((prev) =>
        prev.map((msg) => {
          const payload = msg.payload_json as any;
          if (
            payload &&
            (String(payload.friend_id) === String(friendId) ||
              String(payload.fromUserId) === String(friendId) ||
              String(payload.id) === String(friendId))
          ) {
            return {
              ...msg,
              payload_json: { ...payload, status: 'accepted' },
            };
          }
          return msg;
        })
      );
    } catch (e) {
      console.error('Failed to accept connection:', e);
      throw e;
    }
  };

  const declineConnection = async (friendId: number | string) => {
    try {
      await socialApi.declineUser(friendId);
      setMessages((prev) =>
        prev.map((msg) => {
          const payload = msg.payload_json as any;
          if (
            payload &&
            (String(payload.friend_id) === String(friendId) ||
              String(payload.fromUserId) === String(friendId) ||
              String(payload.id) === String(friendId))
          ) {
            return {
              ...msg,
              payload_json: { ...payload, status: 'declined' },
            };
          }
          return msg;
        })
      );
    } catch (e) {
      console.error('Failed to decline connection:', e);
      throw e;
    }
  };

  const checkin = async () => {
    if (!isAuthenticated || !user?.id) return;
    try {
      const res = await chatApi.checkin();
      const msgContent = (res as any)?.reply || (res as any)?.message;
      if (msgContent) {
        await refreshMessages();
      }
    } catch (err: any) {
      console.error('Checkin error:', err);
    }
  };

  const lastCheckinAttemptRef = useRef<string | null>(null);

  useEffect(() => {
    if (user) {
      setTokenUsage((prev) => ({
        daily_token_usage: prev?.daily_token_usage ?? user.daily_token_usage ?? (user as any).dailyTokenUsage ?? 0,
        daily_token_limit: prev?.daily_token_limit ?? user.daily_token_limit ?? (user as any).dailyTokenLimit ?? (user.subscription_tier === 'admin' ? 500000 : user.subscription_tier === 'rooka_plus' ? 50000 : 5000),
        subscription_tier: user.subscription_tier || 'free',
      }));
    }
  }, [user]);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;

    const initChat = async () => {
      await refreshMessages();

      // Check once per day to catch up on morning message if 08:00 cron was missed (08:00 - 13:00 only)
      const now = new Date();
      const currentHour = now.getHours();
      const todayStr = now.toISOString().split('T')[0];
      if (lastCheckinAttemptRef.current !== todayStr && currentHour >= 8 && currentHour < 13) {
        lastCheckinAttemptRef.current = todayStr;
        // If there is already any message today, do not run catch-up
        const hasTodayMsg = messagesRef.current.some((m) => {
          if (!m.timestamp) return false;
          try {
            return new Date(m.timestamp).toISOString().split('T')[0] === todayStr;
          } catch (_) {
            return false;
          }
        });

        if (!hasTodayMsg) {
          await checkin();
        }
      }
    };

    initChat();

    const unsubCoachResponse = wsService.subscribeToEvent('coach_response', (data: any) => {
      const content = typeof data === 'string' ? data : data.content || data.reply || data.message;
      if (content) {
        const parts = splitCoachReply(content);
        const baseTs = Date.now();
        const newMsgs = parts.map((part, idx) =>
          processMessageItem({
            id: (data.id ? `${data.id}-${idx}` : `coach-ws-${baseTs}-${idx}`).toString(),
            content: part,
            role: 'coach',
            timestamp: data.timestamp || new Date(baseTs + idx * 500).toISOString(),
            payload_json: data.payload_json,
          })
        );
        setMessages((prev) => [...prev, ...newMsgs]);
      }
    });

    const unsubChatMessage = wsService.subscribeToEvent('chat_message', (data: any) => {
      if (data && data.content && data.role) {
        const parts = data.role === 'coach' || data.role === 'assistant' ? splitCoachReply(data.content) : [data.content];
        const baseTs = Date.now();
        const newMsgs = parts.map((part, idx) =>
          processMessageItem({
            id: (data.id ? `${data.id}-${idx}` : `chat-ws-${baseTs}-${idx}`).toString(),
            content: part,
            role: data.role === 'user' ? 'user' : 'coach',
            timestamp: data.timestamp || new Date(baseTs + idx * 500).toISOString(),
            payload_json: data.payload_json,
          })
        );
        setMessages((prev) => [...prev, ...newMsgs]);
      }
    });

    const unsubStreamChunk = wsService.subscribeToEvent('chat_stream_chunk', (data: any) => {
      const chunk = typeof data === 'string' ? data : data.chunk || data.text || '';
      if (!chunk) return;

      const messageId = data.messageId || 'streaming_coach_msg';

      setMessagesState((prev) => {
        const lastMsg = prev[prev.length - 1];
        if (
          lastMsg &&
          lastMsg.role === 'coach' &&
          (String(lastMsg.id) === String(messageId) || String(lastMsg.id).startsWith('streaming_'))
        ) {
          const updatedContent = (lastMsg.content || '') + chunk;
          return [
            ...prev.slice(0, -1),
            {
              ...lastMsg,
              content: updatedContent,
              isStreaming: true,
            },
          ];
        } else {
          return [
            ...prev,
            {
              id: messageId,
              content: chunk,
              role: 'coach',
              isStreaming: true,
              timestamp: new Date().toISOString(),
            },
          ];
        }
      });
    });

    const unsubChatImageReady = wsService.subscribeToEvent('chat_image_ready', (data: any) => {
      if (data?.pendingKey && data?.imageUrl) {
        setMessagesState((prev) =>
          prev.map((msg) => {
            if (msg.content && msg.content.includes(`loading://${data.pendingKey}`)) {
              return {
                ...msg,
                content: msg.content.replace(`loading://${data.pendingKey}`, data.imageUrl),
              };
            }
            return msg;
          })
        );
      }
    });

    const unsubChatImageFailed = wsService.subscribeToEvent('chat_image_failed', (data: any) => {
      if (data?.pendingKey) {
        setMessagesState((prev) =>
          prev.map((msg) => {
            if (msg.content && msg.content.includes(`loading://${data.pendingKey}`)) {
              return {
                ...msg,
                content: msg.content.replace(new RegExp(`!\\[.*?\\]\\(loading://${data.pendingKey}\\)`, 'g'), '').trim(),
              };
            }
            return msg;
          })
        );
      }
    });

    const unsubUnreadMessage = wsService.subscribeToEvent('unread_message', (_data: any) => {
      refreshMessages();
    });

    const subNotification = DeviceEventEmitter.addListener('COACH_NOTIFICATION_RECEIVED', () => {
      refreshMessages();
    });

    return () => {
      unsubCoachResponse();
      unsubChatMessage();
      unsubStreamChunk();
      unsubChatImageReady();
      unsubChatImageFailed();
      unsubUnreadMessage();
      subNotification.remove();
    };
  }, [isAuthenticated]);

  return (
    <CoachChatContext.Provider
      value={{
        messages,
        sending,
        loading,
        error,
        tokenUsage,
        unreadCount,
        isChatActive,
        setChatActive,
        markAsRead,
        refreshMessages,
        sendMessage,
        resendMessage,
        clearHistory,
        acceptProposal,
        rejectProposal,
        acceptInvite,
        declineInvite,
        acceptConnection,
        declineConnection,
        checkin,
      }}
    >
      {children}
    </CoachChatContext.Provider>
  );
};

export const useCoachChat = (): CoachChatContextType => {
  const context = useContext(CoachChatContext);
  if (!context) {
    throw new Error('useCoachChat must be used within a CoachChatStore');
  }
  return context;
};

export const useCoachChatStore = useCoachChat;

