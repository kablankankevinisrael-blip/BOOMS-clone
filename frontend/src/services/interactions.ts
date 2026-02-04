import api from './api';

export type InteractionAction = 'like' | 'share' | 'view' | 'comment';

export interface InteractionResponse {
  success: boolean;
  interaction_id?: number;
  action?: InteractionAction | 'unlike';
  boom_id?: number;
  boom_title?: string;
  old_social_value?: number;
  new_social_value?: number;
  delta?: number;
  total_value?: number;
  interaction_count?: number;
  share_count?: number;
  message?: string;
  error?: string;
}

export interface RawInteractionStats {
  boom_id: number;
  total?: Record<string, number>;
  last_24h?: Record<string, number>;
  unique_users?: number;
}

export interface InteractionStatsSummary {
  boomId: number;
  totals: Record<string, number>;
  last24h: Record<string, number>;
  totalInteractions: number;
  last24hInteractions: number;
  totalLikes: number;
  totalShares: number;
  totalSocialShares: number;
  totalInternalShares: number;
  totalViews: number;
  totalComments: number;
  last24hShares: number;
  last24hSocialShares: number;
  last24hInternalShares: number;
  uniqueUsers: number;
}

const sumCounts = (counts: Record<string, number>): number => {
  return Object.values(counts || {}).reduce((acc, value) => acc + (Number.isFinite(value) ? value : 0), 0);
};

const toSafeCounts = (counts?: Record<string, number>): Record<string, number> => {
  if (!counts || typeof counts !== 'object') {
    return {};
  }
  return Object.keys(counts).reduce<Record<string, number>>((acc, key) => {
    const value = counts[key];
    acc[key] = Number.isFinite(value) ? Number(value) : 0;
    return acc;
  }, {});
};

const normalizeStats = (stats: RawInteractionStats): InteractionStatsSummary => {
  const totals = toSafeCounts(stats.total);
  const last24h = toSafeCounts(stats.last_24h);
  const socialShareKeys = ['share', 'share_social'];
  const sumKeys = (keys: string[], source: Record<string, number>) =>
    keys.reduce((acc, key) => acc + (source[key] || 0), 0);
  const totalSocialShares = sumKeys(socialShareKeys, totals);
  const totalInternalShares = totals.share_internal || 0;
  const last24hSocialShares = sumKeys(socialShareKeys, last24h);
  const last24hInternalShares = last24h.share_internal || 0;
  const totalShares = totalSocialShares + totalInternalShares;
  const last24hShares = last24hSocialShares + last24hInternalShares;
  return {
    boomId: stats.boom_id,
    totals,
    last24h,
    totalInteractions: sumCounts(totals),
    last24hInteractions: sumCounts(last24h),
    totalLikes: totals.like || 0,
    totalShares,
    totalSocialShares,
    totalInternalShares,
    totalViews: totals.view || 0,
    totalComments: totals.comment || 0,
    last24hShares,
    last24hSocialShares,
    last24hInternalShares,
    uniqueUsers: stats.unique_users || 0
  };
};

const serializeMetadata = (metadata?: unknown): string | undefined => {
  if (metadata === undefined || metadata === null) {
    return undefined;
  }
  if (typeof metadata === 'string') {
    return metadata;
  }
  try {
    return JSON.stringify(metadata);
  } catch (error) {
    console.warn('[interactionsService] Impossible de sérialiser les métadonnées', error);
    return undefined;
  }
};

export const interactionsService = {
  async recordInteraction(
    boomId: number,
    actionType: InteractionAction,
    metadata?: unknown
  ): Promise<InteractionResponse> {
    const payload = {
      boom_id: boomId,
      action_type: actionType,
      metadata: serializeMetadata(metadata)
    };
    const response = await api.post('/interactions', payload);
    return response.data;
  },

  async getStats(boomId: number): Promise<RawInteractionStats> {
    const response = await api.get(`/interactions/boom/${boomId}/stats`);
    return response.data as RawInteractionStats;
  },

  async getStatsSummary(boomId: number): Promise<InteractionStatsSummary> {
    const raw = await this.getStats(boomId);
    return normalizeStats(raw);
  },

  async hasLiked(boomId: number): Promise<boolean> {
    const response = await api.get(`/interactions/boom/${boomId}/has-liked`);
    return Boolean(response.data?.has_liked);
  }
};

export default interactionsService;
