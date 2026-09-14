import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Quest, UserTitle } from '../types/gamification';
import { gamificationApi } from '../services/apiServices';
import { wsService } from '../services/websocket';
import { useUser } from './UserStore';
import { canAccessQuests } from '../utils/permissions';

interface GamificationContextType {
  quests: Quest[];
  titles: UserTitle[];
  loading: boolean;
  error: string | null;
  refreshGamification: () => Promise<void>;
  generateQuest: () => Promise<void>;
  swapQuest: (questId?: number | string) => Promise<void>;
  claimQuest: (id: number | string) => void;
}

const defaultQuests: Quest[] = [];

const GamificationContext = createContext<GamificationContextType | undefined>(undefined);

export const GamificationStore: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { isAuthenticated, user } = useUser();
  const [quests, setQuests] = useState<Quest[]>(defaultQuests);
  const [titles, setTitles] = useState<UserTitle[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const refreshGamification = React.useCallback(async () => {
    if (!isAuthenticated) return;
    if (!canAccessQuests(user?.subscription_tier)) {
      setQuests([]);
    }
    setLoading(true);
    try {
      const data = await gamificationApi.getGamificationData();
      if (canAccessQuests(user?.subscription_tier) && data && data.quests && Array.isArray(data.quests)) {
        const normalizedQuests = data.quests.map((q: Quest) => {
          const currentVal = q.current_value !== undefined ? q.current_value : (q.progress ?? 0);
          const targetVal = q.target_value || 1;
          const progressPercent = q.progress_percent !== undefined
            ? q.progress_percent
            : Math.min(100, Math.round((currentVal / targetVal) * 100));
          return {
            ...q,
            current_value: currentVal,
            progress: currentVal,
            progress_percent: progressPercent,
          };
        });
        setQuests(normalizedQuests);
      } else if (!canAccessQuests(user?.subscription_tier)) {
        setQuests([]);
      }
      if (data && data.titles) {
        setTitles(data.titles);
      }
      setError(null);
    } catch (err: any) {
      console.log('GamificationStore fetch info:', err.message || err);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, user?.subscription_tier]);

  const swapQuest = React.useCallback(async (questId?: number | string) => {
    if (!canAccessQuests(user?.subscription_tier)) {
      setQuests([]);
      return;
    }
    setLoading(true);
    try {
      const activeQ = quests.find((q) => q.status === 'active');
      const targetId = questId || activeQ?.id || 0;
      const res = await gamificationApi.refreshQuest(targetId);
      if (res && res.quest) {
        const currentVal = res.quest.current_value !== undefined ? res.quest.current_value : (res.quest.progress ?? 0);
        const normalized = {
          ...res.quest,
          current_value: currentVal,
          progress: currentVal,
          progress_percent: res.quest.progress_percent ?? 0,
        };
        setQuests((prev) => [normalized, ...prev.filter((q) => q.id !== normalized.id && q.id !== targetId)]);
      }
      await refreshGamification();
    } catch (err: any) {
      console.warn('Swap quest warning:', err.message || err);
      try {
        const res = await gamificationApi.generateQuest();
        if (res && res.quest) {
          setQuests((prev) => [res.quest, ...prev.filter((q) => q.id !== res.quest.id)]);
        }
        await refreshGamification();
      } catch (_) {}
    } finally {
      setLoading(false);
    }
  }, [quests, refreshGamification]);

  const generateQuest = React.useCallback(async () => {
    if (!canAccessQuests(user?.subscription_tier)) {
      setQuests([]);
      return;
    }
    setLoading(true);
    try {
      // Check if user already has an active quest; if so, swap/refresh it instead of failing
      const activeQuest = quests.find((q) => q.status === 'active');
      if (activeQuest) {
        await swapQuest(activeQuest.id);
        return;
      }

      const res = await gamificationApi.generateQuest();
      if (res && res.quest) {
        const currentVal = res.quest.current_value !== undefined ? res.quest.current_value : (res.quest.progress ?? 0);
        const normalized = {
          ...res.quest,
          current_value: currentVal,
          progress: currentVal,
          progress_percent: res.quest.progress_percent ?? 0,
        };
        setQuests((prev) => [normalized, ...prev.filter((q) => q.id !== normalized.id)]);
      }
      await refreshGamification();
    } catch (err: any) {
      console.error('Generate quest error:', err.message || err);
      // If error indicates active quest exists, fallback to refresh
      const activeQuest = quests.find((q) => q.status === 'active');
      if (activeQuest && err.message?.includes('already have an active quest')) {
        await swapQuest(activeQuest.id);
      }
    } finally {
      setLoading(false);
    }
  }, [quests, refreshGamification, swapQuest, user?.subscription_tier]);

  const claimQuest = React.useCallback((id: number | string) => {
    setQuests((prev) =>
      prev.map((q) => (q.id === id ? { ...q, status: 'claimed' } : q))
    );
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setQuests(defaultQuests);
      setTitles([]);
      return;
    }
    if (!canAccessQuests(user?.subscription_tier)) {
      setQuests(defaultQuests);
    }
    refreshGamification();

    const unsubQuestUpdated = wsService.subscribeToEvent('quest_updated', () => refreshGamification());
    const unsubQuestCompleted = wsService.subscribeToEvent('quest_completed', () => refreshGamification());
    const unsubTitleUnlocked = wsService.subscribeToEvent('title_unlocked', () => refreshGamification());
    const unsubActivityLogged = wsService.subscribeToEvent('activity_logged', () => refreshGamification());
    const unsubActivitySynced = wsService.subscribeToEvent('activity_synced', () => refreshGamification());

    return () => {
      unsubQuestUpdated();
      unsubQuestCompleted();
      unsubTitleUnlocked();
      unsubActivityLogged();
      unsubActivitySynced();
    };
  }, [isAuthenticated, refreshGamification]);

  return (
    <GamificationContext.Provider
      value={{
        quests,
        titles,
        loading,
        error,
        refreshGamification,
        generateQuest,
        swapQuest,
        claimQuest,
      }}
    >
      {children}
    </GamificationContext.Provider>
  );
};

export const useGamification = (): GamificationContextType => {
  const context = useContext(GamificationContext);
  if (!context) {
    throw new Error('useGamification must be used within a GamificationStore');
  }
  return context;
};
