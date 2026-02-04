const PALIER_THRESHOLD = 1_000_000; // 1 M FCFA palier comme backend
const PALIER_COUNT = 8;             // suivi des 8 premiers paliers (1 M → 8 M)
const MICRO_IMPACT_RATE = 0.0002;   // +0.02 % par palier

const CAPITALIZATION_FLOOR = PALIER_THRESHOLD;
const CAPITALIZATION_CEIL = PALIER_THRESHOLD * PALIER_COUNT;
const CAPITALIZATION_SPREAD = CAPITALIZATION_CEIL - CAPITALIZATION_FLOOR;
const CAPITALIZATION_SEGMENTS = Math.max(1, PALIER_COUNT - 1);

const clamp = (value: number, min = 0, max = 1): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
};

export const computeCapProgress = (effectiveCap?: number | null): number => {
  if (effectiveCap === null || effectiveCap === undefined) {
    return 0;
  }
  if (!Number.isFinite(effectiveCap)) {
    return 0;
  }
  if (effectiveCap <= CAPITALIZATION_FLOOR) {
    return 0;
  }
  if (effectiveCap >= CAPITALIZATION_CEIL) {
    return 1;
  }
  return clamp((effectiveCap - CAPITALIZATION_FLOOR) / CAPITALIZATION_SPREAD);
};

export const getNextMilestone = (progress: number): number => {
  if (progress >= 1) {
    return CAPITALIZATION_CEIL;
  }
  if (progress <= 0) {
    return CAPITALIZATION_FLOOR;
  }
  const segmentSize = CAPITALIZATION_SPREAD / CAPITALIZATION_SEGMENTS;
  const achievedSegments = Math.floor(clamp(progress) * CAPITALIZATION_SEGMENTS);
  const nextMilestone = CAPITALIZATION_FLOOR + (achievedSegments + 1) * segmentSize;
  return Math.min(nextMilestone, CAPITALIZATION_CEIL);
};

export const formatCompactCurrency = (value?: number | null): string => {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return '0 FCFA';
  }
  if (value >= 1_000_000_000) {
    return `${parseFloat((value / 1_000_000_000).toFixed(2))} Mds FCFA`;
  }
  if (value >= 1_000_000) {
    return `${parseFloat((value / 1_000_000).toFixed(2))} M FCFA`;
  }
  if (value >= 1_000) {
    return `${parseFloat((value / 1_000).toFixed(2))} K FCFA`;
  }
  return `${parseFloat(value.toFixed(2)).toLocaleString('fr-FR')} FCFA`;
};

export const formatMicroImpact = (units?: number | null): string => {
  if (units === null || units === undefined || units <= 0 || !Number.isFinite(units)) {
    return 'Unités micro verrouillées';
  }
  if (units >= 1_000_000_000_000) {
    return `${parseFloat((units / 1_000_000_000_000).toFixed(4))} T unités`;
  }
  if (units >= 1_000_000_000) {
    return `${parseFloat((units / 1_000_000_000).toFixed(4))} G unités`;
  }
  if (units >= 1_000_000) {
    return `${parseFloat((units / 1_000_000).toFixed(4))} M unités`;
  }
  if (units >= 1_000) {
    return `${parseFloat((units / 1_000).toFixed(4))} K unités`;
  }
  return `${parseFloat(units.toFixed(4)).toLocaleString('fr-FR')} unités`;
};

export const describeMicroInfluence = (units?: number | null): string => {
  const palierLabel = formatCompactCurrency(PALIER_THRESHOLD);
  const ratePercent = (MICRO_IMPACT_RATE * 100).toFixed(2);
  return `Micro-impact +${ratePercent}% / ${palierLabel} · ${formatMicroImpact(units)}`;
};

export const CAPITALIZATION_CONSTANTS = {
  FLOOR: CAPITALIZATION_FLOOR,
  CEIL: CAPITALIZATION_CEIL,
  SPREAD: CAPITALIZATION_SPREAD,
  PALIER_THRESHOLD,
  PALIER_COUNT,
  MICRO_IMPACT_RATE
};
