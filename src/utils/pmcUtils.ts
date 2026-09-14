import { calculatePMC } from '../domain/pmc';
import { Activity } from '../types/activity';
import { PhysiqueEntry } from '../types/physique';

export interface PMCMetricsData {
  ctl: number;
  atl: number;
  tsb: number;
  readinessScore: number;
  weightKg: number;
  ctlDelta: number;
  atlDelta: number;
  ctlHistory: number[];
  atlHistory: number[];
  tsbHistory: number[];
  weightHistory: number[];
}

export interface ActivityForPMC {
  rooka_score?: number;
  start_date?: string;
  date?: string;
  daily_rooka?: number;
  rooka?: number;
  tss?: number;
}

/**
 * Calculates PMC (Performance Management Chart) Telemetry metrics & sparklines
 * using the domain pmc calculation module (src/domain/pmc.ts).
 */
export function calculatePMCMetrics(
  activities: ActivityForPMC[] = [],
  currentWeightKg: number = 0,
  physiqueLogs: PhysiqueEntry[] = []
): PMCMetricsData {
  const result = calculatePMC(activities as Activity[], physiqueLogs);

  const historyDays = 14;
  const history = result.history;

  const ctlHistory = history.slice(-historyDays).map((h) => Math.round(h.ctl * 10) / 10);
  const atlHistory = history.slice(-historyDays).map((h) => Math.round(h.atl * 10) / 10);
  const tsbHistory = history.slice(-historyDays).map((h) => Math.round(h.tsb * 10) / 10);

  const latestPhysiqueWeight = physiqueLogs.length > 0 ? physiqueLogs[0].weight_kg ?? currentWeightKg : currentWeightKg;

  // Build 90-day (3-month) weight history array to reflect realistic weekly weigh-ins
  const sortedLogs = [...physiqueLogs]
    .filter((p) => p.date && typeof p.weight_kg === 'number')
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const weightMap: Record<string, number> = {};
  sortedLogs.forEach((p) => {
    weightMap[p.date.split('T')[0]] = p.weight_kg;
  });

  const weightHistoryDays = 90; // 3-month timeframe
  const now = new Date();
  const weightHistory: number[] = [];

  const startWindowDate = new Date(now);
  startWindowDate.setDate(startWindowDate.getDate() - (weightHistoryDays - 1));
  const startWindowStr = startWindowDate.toISOString().split('T')[0];

  const initialEntry = [...sortedLogs].reverse().find((p) => p.date.split('T')[0] <= startWindowStr);
  let runningWeight = initialEntry?.weight_kg ?? (sortedLogs[0]?.weight_kg ?? latestPhysiqueWeight);

  for (let i = weightHistoryDays - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    if (weightMap[dateStr] !== undefined) {
      runningWeight = weightMap[dateStr];
    }
    weightHistory.push(Math.round(runningWeight * 10) / 10);
  }

  return {
    ctl: result.currentCtl,
    atl: result.currentAtl,
    tsb: result.currentTsb,
    readinessScore: result.readiness.score,
    weightKg: runningWeight,
    ctlDelta: result.trends.ctlDelta7,
    atlDelta: result.trends.atlDelta7,
    ctlHistory,
    atlHistory,
    tsbHistory,
    weightHistory,
  };
}
