import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { format, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import AdminLayout from '@/components/Layout/AdminLayout';
import { supportService } from '@/services/support';
import {
  AccountStatus,
  BannedMessage,
  SuggestedMessage,
  SupportPriority,
  SupportThreadDetail,
  SupportThreadListItem,
  SupportThreadStatus,
} from '@/types';
import {
  MessageSquare,
  ShieldAlert,
  AlertTriangle,
  RefreshCw,
  Send,
  Filter,
  Clock,
  UserCheck,
  Mail,
  LayoutGrid,
  X,
  Sparkles,
  Inbox,
  Headphones,
  AlertCircle,
} from 'lucide-react';

const statusFilterOptions: Array<{ label: string; value: SupportThreadStatus | 'all' }> = [
  { label: 'Tous', value: 'all' },
  { label: 'Ouverts', value: 'open' },
  { label: 'En cours', value: 'pending' },
  { label: 'En attente client', value: 'waiting_user' },
  { label: 'Résolus', value: 'resolved' },
  { label: 'Escaladés', value: 'escalated' },
];

const priorityOptions: Array<{ label: string; value: SupportPriority | 'all' }> = [
  { label: 'Toutes', value: 'all' },
  { label: 'Normales', value: 'normal' },
  { label: 'Haute', value: 'high' },
  { label: 'Urgente', value: 'urgent' },
];

type ViewMode = 'threads' | 'banned';
type BannedFilter = 'pending' | 'responded' | 'all';
type ModerationAction = 'deactivate' | 'ban' | 'delete' | null;

export default function SupportCommandCenter() {
  const [view, setView] = useState<ViewMode>('threads');
  const [statusFilter, setStatusFilter] = useState<SupportThreadStatus | 'all'>('open');
  const [priorityFilter, setPriorityFilter] = useState<SupportPriority | 'all'>('all');
  const [threads, setThreads] = useState<SupportThreadListItem[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(null);
  const [selectedThread, setSelectedThread] = useState<SupportThreadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [messageBody, setMessageBody] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [templates, setTemplates] = useState<SuggestedMessage[]>([]);
  const [bannedMessages, setBannedMessages] = useState<BannedMessage[]>([]);
  const [bannedFilter, setBannedFilter] = useState<BannedFilter>('pending');
  const [bannedLoading, setBannedLoading] = useState(false);
  const [pendingBannedCount, setPendingBannedCount] = useState(0);
  const [respondingMessage, setRespondingMessage] = useState<BannedMessage | null>(null);
  const [responseDraft, setResponseDraft] = useState('');
  const [responding, setResponding] = useState(false);

  // Moderation states
  const [moderationUser, setModerationUser] = useState<{ id: number; phone?: string } | null>(null);
  const [moderationAction, setModerationAction] = useState<ModerationAction>(null);
  const [moderationReason, setModerationReason] = useState('');
  const [isModerating, setIsModerating] = useState(false);
  const [accountStatus, setAccountStatus] = useState<AccountStatus | null>(null);

  useEffect(() => {
    supportService.getTemplates().then(setTemplates);
    loadBannedMessages('pending', true); // Pré-charger le volume pour les métriques
  }, []);

  useEffect(() => {
    if (view === 'threads') {
      loadThreads();
    }
  }, [view, statusFilter, priorityFilter]);

  useEffect(() => {
    if (view === 'banned') {
      loadBannedMessages(bannedFilter);
    }
  }, [view, bannedFilter]);

  useEffect(() => {
    if (!selectedThreadId) {
      setSelectedThread(null);
      return;
    }
    loadThreadDetail(selectedThreadId);
  }, [selectedThreadId]);

  const loadThreads = async () => {
    setThreadsLoading(true);
    setThreadError(null);
    try {
      const data = await supportService.getThreads({
        scope: 'all',
        status: statusFilter === 'all' ? undefined : statusFilter,
        priority: priorityFilter === 'all' ? undefined : priorityFilter,
      });
      setThreads(data);

      if (!data.length) {
        setSelectedThreadId(null);
        return;
      }

      const stillVisible = data.some((thread) => thread.id === selectedThreadId);
      if (!stillVisible) {
        setSelectedThreadId(data[0].id);
      }
    } catch (error) {
      console.error(error);
      setThreadError("Impossible de charger les tickets");
      toast.error('Le centre de support est indisponible.');
    } finally {
      setThreadsLoading(false);
    }
  };

  const loadThreadDetail = async (threadId: number) => {
    setDetailLoading(true);
    try {
      const detail = await supportService.getThreadById(threadId);
      setSelectedThread(detail);
    } catch (error) {
      console.error(error);
      toast.error('Ticket introuvable ou accès refusé.');
    } finally {
      setDetailLoading(false);
    }
  };

  const loadBannedMessages = async (filter: BannedFilter, silent = false) => {
    if (!silent) {
      setBannedLoading(true);
    }
    try {
      const data = await supportService.getBannedMessages(filter === 'all' ? undefined : filter);
      setBannedMessages(data);
      setPendingBannedCount(
        filter === 'responded'
          ? 0
          : data.filter((item) => (item.status || 'pending') !== 'responded').length,
      );
    } catch (error) {
      console.error(error);
      toast.error('Impossible de charger les alertes bannies.');
    } finally {
      if (!silent) {
        setBannedLoading(false);
      }
    }
  };

  const handleSendMessage = async () => {
    if (!selectedThread || !messageBody.trim()) {
      return;
    }
    try {
      await supportService.sendMessage(selectedThread.id, {
        message: messageBody.trim(),
        is_internal: isInternalNote,
      });
      setMessageBody('');
      setIsInternalNote(false);
      toast.success('Message envoyé');
      await loadThreadDetail(selectedThread.id);
      await loadThreads();
    } catch (error) {
      console.error(error);
      toast.error("Impossible d'envoyer le message");
    }
  };

  const handleStatusChange = async (status: SupportThreadStatus, reason?: string) => {
    if (!selectedThread) {
      return;
    }
    try {
      const updated = await supportService.updateThreadStatus(selectedThread.id, {
        status,
        reason,
        notify_user: status !== 'waiting_user',
      });
      setSelectedThread(updated);
      toast.success('Statut mis à jour');
      await loadThreads();
    } catch (error) {
      console.error(error);
      toast.error('Mise à jour du statut impossible');
    }
  };

  const openResponseModal = (message: BannedMessage) => {
    setRespondingMessage(message);
    setResponseDraft(message.admin_response || '');
  };

  const submitBannedResponse = async () => {
    if (!respondingMessage || !responseDraft.trim()) {
      toast.warning('La réponse est vide.');
      return;
    }
    setResponding(true);
    try {
      await supportService.respondToBannedMessage(respondingMessage.id, responseDraft.trim());
      toast.success('Réponse envoyée');
      setRespondingMessage(null);
      setResponseDraft('');
      await loadBannedMessages(bannedFilter);
    } catch (error) {
      console.error(error);
      toast.error('Impossible de répondre à ce message.');
    } finally {
      setResponding(false);
    }
  };

  const insertTemplate = (template: string) => {
    setMessageBody((prev) => (prev ? `${prev}\n\n${template}` : template));
  };

  // ===== MODERATION ACTIONS =====
  const openModerationModal = (action: ModerationAction, userId: number, phone?: string) => {
    setModerationUser({ id: userId, phone });
    setModerationAction(action);
    setModerationReason('');
    loadAccountStatus(userId);
  };

  const loadAccountStatus = async (userId: number) => {
    try {
      const status = await supportService.getAccountStatus(userId);
      setAccountStatus(status.status);
    } catch (error) {
      console.error('Erreur lors du chargement du statut', error);
      setAccountStatus('active');
    }
  };

  const handleModerationAction = async () => {
    if (!moderationUser || !moderationAction || !moderationReason.trim()) {
      toast.warning('Veuillez fournir une raison pour cette action');
      return;
    }

    setIsModerating(true);
    try {
      if (moderationAction === 'deactivate') {
        await supportService.deactivateUserFromSupport(moderationUser.id, moderationReason);
        toast.success('Compte désactivé');
      } else if (moderationAction === 'ban') {
        await supportService.banUserFromSupport(moderationUser.id, moderationReason, 72);
        toast.success('Compte banni pour 72h (auto-suppression après)');
      } else if (moderationAction === 'delete') {
        await supportService.deleteUserFromSupport(moderationUser.id, moderationReason);
        toast.success('Utilisateur complètement supprimé');
      }

      // Refresh data
      setModerationUser(null);
      setModerationAction(null);
      if (selectedThreadId) {
        await loadThreadDetail(selectedThreadId);
      }
      await loadThreads();
    } catch (error) {
      console.error(error);
      toast.error('Erreur lors de l\'action de modération');
    } finally {
      setIsModerating(false);
    }
  };

  const accountStatusBadge = (status?: AccountStatus) => {
    if (!status) return null;

    const map: Record<AccountStatus, { label: string; classes: string; icon: string }> = {
      active: { label: 'Actif', classes: 'bg-emerald-100 text-emerald-700', icon: '✅' },
      inactive: { label: 'Désactivé', classes: 'bg-amber-100 text-amber-700', icon: '⏸️' },
      banned: { label: 'Banni', classes: 'bg-orange-100 text-orange-700', icon: '🚫' },
      deleted: { label: 'Supprimé', classes: 'bg-red-100 text-red-700', icon: '💀' },
    };

    const conf = map[status];
    return (
      <span className={`px-3 py-1 text-xs font-semibold rounded-full ${conf.classes}`}>
        {conf.icon} {conf.label}
      </span>
    );
  };

  const messageCountByPriority = useMemo(() => {
    return threads.reduce(
      (acc, thread) => {
        if (thread.priority === 'high' || thread.priority === 'urgent') {
          acc.high += 1;
        }
        if (thread.status === 'escalated') {
          acc.escalated += 1;
        }
        if (thread.status === 'waiting_user') {
          acc.waiting += 1;
        }
        return acc;
      },
      { high: 0, escalated: 0, waiting: 0 },
    );
  }, [threads]);

  const statusBadge = (status?: SupportThreadStatus) => {
    if (!status) {
      return null;
    }
    const map: Record<SupportThreadStatus, { label: string; classes: string }> = {
      open: { label: 'Ouvert', classes: 'bg-emerald-100 text-emerald-700' },
      pending: { label: 'En cours', classes: 'bg-blue-100 text-blue-700' },
      waiting_user: { label: 'Attente client', classes: 'bg-amber-100 text-amber-700' },
      resolved: { label: 'Résolu', classes: 'bg-teal-100 text-teal-700' },
      closed: { label: 'Clôturé', classes: 'bg-slate-100 text-slate-600' },
      escalated: { label: 'Escaladé', classes: 'bg-purple-100 text-purple-700' },
    };
    const conf = map[status];
    return (
      <span className={`px-3 py-1 text-xs font-semibold rounded-full ${conf.classes}`}>
        {conf.label}
      </span>
    );
  };

  const priorityBadge = (priority?: SupportPriority) => {
    if (!priority) {
      return null;
    }
    const map: Record<SupportPriority, { label: string; classes: string }> = {
      low: { label: 'Faible', classes: 'bg-slate-100 text-slate-600' },
      normal: { label: 'Normal', classes: 'bg-gray-200 text-gray-700' },
      high: { label: 'Élevée', classes: 'bg-orange-100 text-orange-700' },
      urgent: { label: 'Urgente', classes: 'bg-red-100 text-red-700' },
    };
    const conf = map[priority];
    return (
      <span className={`px-3 py-1 text-xs font-semibold rounded-full ${conf.classes}`}>
        {conf.label}
      </span>
    );
  };

  const formattedRelative = (value?: string | null) => {
    if (!value) {
      return '—';
    }
    try {
      return formatDistanceToNow(new Date(value), { addSuffix: true, locale: fr });
    } catch {
      return '—';
    }
  };

  const heroMetrics = [
    {
      label: 'Tickets actifs',
      value: (threads.filter((t) => ['open', 'pending', 'waiting_user'].includes(t.status)).length || 0).toString(),
      sub: `${messageCountByPriority.high} prioritaires`,
      icon: MessageSquare,
      accent: 'from-blue-500/40 via-blue-400/30 to-cyan-400/30',
    },
    {
      label: 'Escalades',
      value: messageCountByPriority.escalated.toString(),
      sub: 'Priorité niveau 2',
      icon: AlertTriangle,
      accent: 'from-amber-500/40 via-orange-400/30 to-pink-400/30',
    },
    {
      label: 'Alertes bannies',
      value: pendingBannedCount.toString(),
      sub: 'En attente de réponse',
      icon: ShieldAlert,
      accent: 'from-rose-500/40 via-red-400/30 to-purple-400/30',
    },
  ];

  return (
    <AdminLayout>
      <div className="space-y-8">
        <section className="rounded-3xl bg-gradient-to-r from-slate-900 via-blue-900 to-cyan-900 text-white p-8 shadow-2xl border border-white/10">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8">
            <div className="space-y-4 max-w-2xl">
              <div className="inline-flex items-center space-x-2 text-xs uppercase tracking-[0.35em] text-white/70">
                <Headphones className="w-4 h-4" />
                <span>Command Center</span>
              </div>
              <div>
                <h1 className="text-3xl font-semibold">Support & conformité Booms</h1>
                <p className="text-white/70 text-sm mt-2">
                  Pilotage temps-réel des tickets, escalades et alertes envoyées par les comptes bannis.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {['SLA 24h', 'Escalade N2', 'Analyse risque'].map((label) => (
                  <span key={label} className="px-3 py-1 rounded-full bg-white/10 text-xs font-semibold">
                    {label}
                  </span>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 flex-1">
              {heroMetrics.map((metric) => (
                <div
                  key={metric.label}
                  className={`rounded-2xl p-4 bg-gradient-to-br ${metric.accent} backdrop-blur-lg border border-white/10 text-white shadow-lg`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-white/70">{metric.label}</span>
                    <metric.icon className="w-4 h-4 text-white/80" />
                  </div>
                  <p className="text-3xl font-semibold mt-2">{metric.value}</p>
                  <p className="text-xs text-white/70 mt-1">{metric.sub}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            {([
              { label: 'Tickets', value: 'threads', icon: MessageSquare },
              { label: 'Alertes bannies', value: 'banned', icon: ShieldAlert },
            ] as const).map((tab) => (
              <button
                key={tab.value}
                onClick={() => setView(tab.value)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all border border-white/20 backdrop-blur ${
                  view === tab.value ? 'bg-white text-slate-900' : 'text-white/80 hover:bg-white/10'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
            <button
              onClick={() => (view === 'threads' ? loadThreads() : loadBannedMessages(bannedFilter))}
              className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 text-white text-sm font-medium border border-white/20 hover:bg-white/20"
            >
              <RefreshCw className="w-4 h-4" />
              Actualiser
            </button>
          </div>
        </section>

        {view === 'threads' ? (
          <section className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
            <aside className="space-y-6">
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-slate-500" />
                    <p className="text-sm font-semibold text-slate-900">Filtrer les tickets</p>
                  </div>
                  <button
                    onClick={() => {
                      setStatusFilter('open');
                      setPriorityFilter('all');
                    }}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Réinitialiser
                  </button>
                </div>
                <div className="space-y-3">
                  <label className="text-xs font-semibold uppercase text-slate-400">Statut</label>
                  <div className="flex flex-wrap gap-2">
                    {statusFilterOptions.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => setStatusFilter(option.value)}
                        className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                          statusFilter === option.value
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-400'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-3 mt-6">
                  <label className="text-xs font-semibold uppercase text-slate-400">Priorité</label>
                  <div className="flex flex-wrap gap-2">
                    {priorityOptions.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => setPriorityFilter(option.value)}
                        className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                          priorityFilter === option.value
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-blue-200'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Tickets ({threads.length})</p>
                    <p className="text-xs text-slate-500">Triés par dernière activité</p>
                  </div>
                  <LayoutGrid className="w-4 h-4 text-slate-400" />
                </div>
                <div className="max-h-[calc(100vh-380px)] overflow-y-auto divide-y divide-slate-100">
                  {threadsLoading && (
                    <div className="p-6 text-center text-sm text-slate-500">Chargement...</div>
                  )}
                  {!threadsLoading && !threads.length && (
                    <div className="p-6 text-center text-sm text-slate-500">
                      Aucun ticket ne correspond aux filtres.
                    </div>
                  )}
                  {threads.map((thread) => (
                    <button
                      key={thread.id}
                      onClick={() => setSelectedThreadId(thread.id)}
                      className={`w-full text-left px-4 py-3 transition ${
                        selectedThreadId === thread.id
                          ? 'bg-blue-50/80 border-l-4 border-blue-500'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-slate-900 truncate">{thread.subject}</p>
                        {statusBadge(thread.status as SupportThreadStatus)}
                      </div>
                      <p className="text-xs text-slate-500 mt-1">Ref {thread.reference}</p>
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2">{thread.last_message_preview}</p>
                      <div className="flex items-center gap-2 mt-2">
                        {priorityBadge(thread.priority as SupportPriority)}
                        <span className="text-[11px] text-slate-400">{formattedRelative(thread.last_message_at)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </aside>

            <section className="rounded-3xl border border-slate-200 bg-white shadow-xl p-6 space-y-6 min-h-[640px]">
              {detailLoading && (
                <div className="flex flex-col items-center justify-center h-64 text-slate-500 gap-3">
                  <div className="w-12 h-12 rounded-full border-4 border-slate-200 border-t-blue-500 animate-spin" />
                  <p>Chargement du ticket...</p>
                </div>
              )}

              {!detailLoading && !selectedThread && (
                <div className="flex flex-col items-center justify-center h-64 text-center text-slate-500 gap-3">
                  <Inbox className="w-10 h-10" />
                  <p>Sélectionnez un ticket pour commencer.</p>
                </div>
              )}

              {!detailLoading && selectedThread && (
                <>
                  <div className="flex flex-wrap items-start gap-4 justify-between">
                    <div className="space-y-1">
                      <p className="text-xs uppercase text-slate-400 tracking-wide">Ticket #{selectedThread.reference}</p>
                      <h2 className="text-2xl font-semibold text-slate-900">{selectedThread.subject}</h2>
                      <div className="flex items-center gap-2 flex-wrap">
                        {statusBadge(selectedThread.status)}
                        {priorityBadge(selectedThread.priority)}
                        <span className="text-xs text-slate-400">Créé le {format(new Date(selectedThread.created_at), 'dd MMM yyyy', { locale: fr })}</span>
                      </div>
                      {/* User info */}
                      {(selectedThread.user_phone || selectedThread.user_email) && (
                        <div className="text-xs text-slate-600 mt-2">
                          📱 {selectedThread.user_phone || selectedThread.user_email}
                          {selectedThread.user_full_name && ` · ${selectedThread.user_full_name}`}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => loadThreadDetail(selectedThread.id)}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-slate-200 text-sm text-slate-600 hover:border-slate-400"
                      >
                        <RefreshCw className="w-4 h-4" />
                        Rafraîchir
                      </button>
                    </div>
                  </div>

                  {/* Account Status Section */}
                  {selectedThread.user_account_status && (
                    <div className={`rounded-2xl border-2 p-4 ${
                      selectedThread.user_account_status === 'active'
                        ? 'bg-emerald-50 border-emerald-200'
                        : selectedThread.user_account_status === 'banned'
                          ? 'bg-orange-50 border-orange-200'
                          : selectedThread.user_account_status === 'deleted'
                            ? 'bg-red-50 border-red-200'
                            : 'bg-amber-50 border-amber-200'
                    }`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="w-5 h-5" />
                          <div>
                            <p className="font-semibold text-sm">Statut du compte</p>
                            <div className="flex items-center gap-2 mt-1">
                              {accountStatusBadge(selectedThread.user_account_status as AccountStatus)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                      <p className="text-xs text-slate-500">Catégorie</p>
                      <p className="font-semibold text-slate-900">{selectedThread.category}</p>
                    </div>
                    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                      <p className="text-xs text-slate-500">Non lus admin</p>
                      <p className="font-semibold text-slate-900">{selectedThread.unread_admin_count || 0}</p>
                    </div>
                    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                      <p className="text-xs text-slate-500">Dernière activité</p>
                      <p className="font-semibold text-slate-900">{formattedRelative(selectedThread.last_message_at)}</p>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <div className="flex items-center gap-2 text-slate-500 text-sm mb-3">
                      <Sparkles className="w-4 h-4" />
                      Accélérer ce ticket
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {[{
                        label: 'Mettre en attente client',
                        status: 'waiting_user' as SupportThreadStatus,
                        tone: 'bg-amber-100 text-amber-800 border-amber-200',
                      }, {
                        label: 'Escalader',
                        status: 'escalated' as SupportThreadStatus,
                        tone: 'bg-purple-100 text-purple-800 border-purple-200',
                      }, {
                        label: 'Marquer résolu',
                        status: 'resolved' as SupportThreadStatus,
                        tone: 'bg-emerald-100 text-emerald-800 border-emerald-200',
                      }, {
                        label: 'Clôturer',
                        status: 'closed' as SupportThreadStatus,
                        tone: 'bg-slate-200 text-slate-800 border-slate-300',
                      }].map((action) => (
                        <button
                          key={action.status}
                          onClick={() => handleStatusChange(action.status)}
                          className={`px-4 py-3 rounded-2xl border text-sm font-semibold flex items-center justify-between ${action.tone}`}
                        >
                          <span>{action.label}</span>
                          <UserCheck className="w-4 h-4" />
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Moderation Actions */}
                  {selectedThread.user_id && (
                    <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4">
                      <div className="flex items-center gap-2 text-rose-700 text-sm mb-3">
                        <ShieldAlert className="w-4 h-4" />
                        Actions de modération
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <button
                          onClick={() =>
                            openModerationModal(
                              'deactivate',
                              selectedThread.user_id,
                              selectedThread.user_phone,
                            )
                          }
                          className="px-4 py-3 rounded-2xl border border-amber-200 bg-amber-100 text-amber-800 text-sm font-semibold hover:bg-amber-200 transition"
                        >
                          ⏸️ Désactiver
                        </button>
                        <button
                          onClick={() =>
                            openModerationModal(
                              'ban',
                              selectedThread.user_id,
                              selectedThread.user_phone,
                            )
                          }
                          className="px-4 py-3 rounded-2xl border border-orange-200 bg-orange-100 text-orange-800 text-sm font-semibold hover:bg-orange-200 transition"
                        >
                          🚫 Bannir
                        </button>
                        <button
                          onClick={() =>
                            openModerationModal(
                              'delete',
                              selectedThread.user_id,
                              selectedThread.user_phone,
                            )
                          }
                          className="px-4 py-3 rounded-2xl border border-red-200 bg-red-100 text-red-800 text-sm font-semibold hover:bg-red-200 transition"
                        >
                          💀 Supprimer
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-slate-500">
                      <MessageSquare className="w-4 h-4" />
                      <p className="text-sm font-semibold text-slate-700">Fil de conversation</p>
                    </div>
                    <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1">
                      {selectedThread.messages.map((message) => (
                        <div
                          key={message.id}
                          className={`rounded-2xl border p-4 ${
                            message.sender_type === 'admin' ? 'bg-blue-50 border-blue-100' : 'bg-white border-slate-100'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-slate-900">
                                {message.sender_type === 'admin' ? 'Booms' : 'Client'}
                              </span>
                              {message.is_internal && (
                                <span className="text-[10px] uppercase tracking-wide bg-slate-800 text-white px-2 py-0.5 rounded-full">
                                  Note interne
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-slate-400">{formattedRelative(message.created_at)}</span>
                          </div>
                          <p className="text-sm text-slate-700 mt-2 whitespace-pre-line">{message.body}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-slate-500">
                      <Mail className="w-4 h-4" />
                      <p className="text-sm font-semibold text-slate-700">Composer une réponse</p>
                    </div>
                    <textarea
                      value={messageBody}
                      onChange={(event) => setMessageBody(event.target.value)}
                      placeholder="Rédigez un message clair et professionnel..."
                      className="w-full min-h-[140px] rounded-2xl border border-slate-200 focus:ring-2 focus:ring-blue-200 focus:border-blue-400 text-sm p-4"
                    />
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                        <input
                          type="checkbox"
                          checked={isInternalNote}
                          onChange={(event) => setIsInternalNote(event.target.checked)}
                          className="rounded border-slate-300 text-slate-900 focus:ring-slate-500"
                        />
                        Note interne (non visible côté client)
                      </label>
                      <div className="flex-1" />
                      <button
                        onClick={handleSendMessage}
                        disabled={!messageBody.trim()}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-slate-900 text-white text-sm font-semibold disabled:opacity-40"
                      >
                        <Send className="w-4 h-4" />
                        Envoyer
                      </button>
                    </div>
                    {!!templates.length && (
                      <div className="flex flex-wrap gap-2">
                        {templates.slice(0, 4).map((template) => (
                          <button
                            key={template.title}
                            onClick={() => insertTemplate(template.template)}
                            className="px-3 py-1 rounded-full border border-slate-200 text-xs text-slate-600 hover:border-slate-400"
                          >
                            {template.title}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </section>
          </section>
        ) : (
          <section className="space-y-6">
            <div className="rounded-3xl border border-rose-100 bg-white shadow-xl p-6">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm font-semibold text-rose-900 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4" />
                  Alertes provenant de comptes bannis
                </p>
                <div className="flex items-center gap-2">
                  {(['pending', 'responded', 'all'] as BannedFilter[]).map((option) => (
                    <button
                      key={option}
                      onClick={() => setBannedFilter(option)}
                      className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                        bannedFilter === option
                          ? 'bg-rose-600 text-white border-rose-600'
                          : 'bg-white text-rose-700 border-rose-200'
                      }`}
                    >
                      {option === 'pending' ? 'En attente' : option === 'responded' ? 'Répondu' : 'Tous'}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => loadBannedMessages(bannedFilter)}
                  className="ml-auto inline-flex items-center gap-2 text-sm text-rose-700"
                >
                  <RefreshCw className="w-4 h-4" /> Rafraîchir
                </button>
              </div>
            </div>

            {bannedLoading && (
              <div className="rounded-2xl border border-rose-100 bg-white p-8 text-center text-rose-500">
                Chargement des alertes...
              </div>
            )}

            {!bannedLoading && !bannedMessages.length && (
              <div className="rounded-2xl border border-rose-100 bg-white p-8 text-center text-rose-600">
                Aucune alerte pour ce filtre.
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              {bannedMessages.map((message) => (
                <div
                  key={message.id}
                  className={`rounded-2xl border-2 shadow-sm p-5 flex flex-col gap-3 ${
                    message.current_account_status === 'banned'
                      ? 'border-orange-200 bg-orange-50'
                      : message.current_account_status === 'deleted'
                        ? 'border-red-200 bg-red-50'
                        : message.current_account_status === 'inactive'
                          ? 'border-amber-200 bg-amber-50'
                          : 'border-rose-100 bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {message.user_phone || message.user_email || 'Contact inconnu'}
                      </p>
                      <p className="text-xs text-slate-500">
                        Canal · {message.channel || 'inconnu'} · #{message.id}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span
                        className={`text-xs font-semibold px-2 py-1 rounded-full ${
                          (message.status || 'pending') === 'responded'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-rose-100 text-rose-700'
                        }`}
                      >
                        {(message.status || 'pending') === 'responded' ? '✅ Répondu' : '⏳ En attente'}
                      </span>
                      {message.current_account_status && (
                        <span className="text-[11px] font-semibold">
                          {accountStatusBadge(message.current_account_status as AccountStatus)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Action context */}
                  {message.action_type && (
                    <div className="rounded-lg bg-white/60 p-3 border border-white/40 text-xs space-y-1">
                      <p className="font-semibold text-slate-700">
                        {message.action_type === 'banned'
                          ? '🚫 Compte banni'
                          : message.action_type === 'inactive'
                            ? '⏸️ Compte désactivé'
                            : '💀 Compte supprimé'}
                      </p>
                      {message.action_reason && (
                        <p className="text-slate-600">
                          <strong>Raison:</strong> {message.action_reason}
                        </p>
                      )}
                      {message.action_at && (
                        <p className="text-slate-500">
                          {formatDistanceToNow(new Date(message.action_at), {
                            addSuffix: true,
                            locale: fr,
                          })}
                        </p>
                      )}
                      {message.ban_until && message.action_type === 'banned' && (
                        <p className="text-orange-700 font-semibold">
                          ⏰ Auto-suppression: {formatDistanceToNow(new Date(message.ban_until), {
                            addSuffix: true,
                            locale: fr,
                          })}
                        </p>
                      )}
                    </div>
                  )}

                  <p className="text-sm text-slate-700 whitespace-pre-line flex-1 bg-slate-50 p-3 rounded-lg">
                    {message.message}
                  </p>

                  <div className="text-xs text-slate-400 flex items-center gap-2">
                    <Clock className="w-3 h-3" />
                    {formatDistanceToNow(new Date(message.created_at), {
                      addSuffix: true,
                      locale: fr,
                    })}
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <div className="text-[11px] text-slate-500">Message #{message.id}</div>
                    {(message.status || 'pending') !== 'responded' ? (
                      <button
                        onClick={() => openResponseModal(message)}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 transition"
                      >
                        <Mail className="w-3 h-3" />
                        Répondre
                      </button>
                    ) : (
                      <p className="text-xs text-emerald-600 font-medium">✅ Réponse envoyée</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {respondingMessage && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-2xl p-6 space-y-4 shadow-2xl border border-slate-100">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase text-slate-400 tracking-wide">Répondre au contact banni</p>
                <h3 className="text-xl font-semibold text-slate-900">
                  {respondingMessage.user_phone || respondingMessage.user_email || 'Contact'}
                </h3>
                <p className="text-xs text-slate-500">Message #{respondingMessage.id}</p>
              </div>
              <button
                onClick={() => setRespondingMessage(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <p className="text-xs uppercase text-slate-400 mb-2">Message reçu</p>
              <p className="text-sm text-slate-700 whitespace-pre-line">{respondingMessage.message}</p>
            </div>
            <textarea
              value={responseDraft}
              onChange={(event) => setResponseDraft(event.target.value)}
              className="w-full min-h-[160px] rounded-2xl border border-slate-200 focus:ring-2 focus:ring-rose-200 focus:border-rose-400 text-sm p-4"
              placeholder="Rédigez une réponse professionnelle..."
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">
                La réponse sera notifiée par email/SMS selon les métadonnées disponibles.
              </p>
              <button
                onClick={submitBannedResponse}
                disabled={responding || !responseDraft.trim()}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-rose-600 text-white text-sm font-semibold disabled:opacity-40"
              >
                <Send className="w-4 h-4" />
                {responding ? 'Envoi...' : 'Envoyer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Moderation Modal */}
      {moderationUser && moderationAction && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            className={`bg-white rounded-3xl w-full max-w-2xl p-6 space-y-6 shadow-2xl border-2 ${
              moderationAction === 'delete'
                ? 'border-red-200 bg-gradient-to-br from-white to-red-50'
                : moderationAction === 'ban'
                  ? 'border-orange-200 bg-gradient-to-br from-white to-orange-50'
                  : 'border-amber-200 bg-gradient-to-br from-white to-amber-50'
            }`}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase text-slate-400 tracking-wide">Action de modération</p>
                <h3 className="text-2xl font-semibold text-slate-900 mt-2">
                  {moderationAction === 'delete'
                    ? '💀 Supprimer cet utilisateur'
                    : moderationAction === 'ban'
                      ? '🚫 Bannir cet utilisateur'
                      : '⏸️ Désactiver cet utilisateur'}
                </h3>
                <p className="text-sm text-slate-600 mt-1">
                  {moderationUser.phone || `ID: ${moderationUser.id}`}
                </p>
              </div>
              <button
                onClick={() => {
                  setModerationUser(null);
                  setModerationAction(null);
                  setModerationReason('');
                }}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Warning for delete */}
            {moderationAction === 'delete' && (
              <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-4">
                <p className="text-sm font-semibold text-red-900 flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                  <span>⚠️ Cette action est IRRÉVERSIBLE!</span>
                </p>
                <ul className="text-xs text-red-800 mt-2 space-y-1 ml-7">
                  <li>✓ Suppression complète de l'utilisateur</li>
                  <li>✓ Suppression de tous ses assets</li>
                  <li>✓ Suppression de tous ses transactions</li>
                  <li>✓ Suppression de toutes ses données</li>
                </ul>
              </div>
            )}

            {/* Warning for ban */}
            {moderationAction === 'ban' && (
              <div className="rounded-2xl border-2 border-orange-300 bg-orange-50 p-4">
                <p className="text-sm font-semibold text-orange-900">
                  ⏰ Le compte sera automatiquement supprimé après 72 heures
                </p>
                <p className="text-xs text-orange-800 mt-2">
                  L'utilisateur pourra réactiver son compte dans ce délai (contact par email).
                </p>
              </div>
            )}

            {/* Warning for deactivate */}
            {moderationAction === 'deactivate' && (
              <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-900">
                  ℹ️ Compte suspendu temporairement
                </p>
                <p className="text-xs text-amber-800 mt-2">
                  Vous pourrez réactiver ce compte à tout moment via la page utilisateurs.
                </p>
              </div>
            )}

            <div className="space-y-3">
              <label className="block">
                <p className="text-sm font-semibold text-slate-900 mb-2">
                  Raison de cette action *
                </p>
                <textarea
                  value={moderationReason}
                  onChange={(e) => setModerationReason(e.target.value)}
                  placeholder="Expliquez clairement la raison de cette modération..."
                  className="w-full min-h-[120px] rounded-2xl border border-slate-300 focus:ring-2 focus:ring-slate-500 focus:border-slate-500 text-sm p-3"
                />
              </label>
              <p className="text-xs text-slate-500">
                Cette raison sera enregistrée dans les logs d'audit et notifiée à l'utilisateur.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
              <button
                onClick={() => {
                  setModerationUser(null);
                  setModerationAction(null);
                  setModerationReason('');
                }}
                disabled={isModerating}
                className="px-6 py-2.5 rounded-full border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50 transition disabled:opacity-40"
              >
                Annuler
              </button>
              <button
                onClick={handleModerationAction}
                disabled={isModerating || !moderationReason.trim()}
                className={`px-6 py-2.5 rounded-full text-white font-semibold flex items-center gap-2 transition disabled:opacity-40 ${
                  moderationAction === 'delete'
                    ? 'bg-red-600 hover:bg-red-700'
                    : moderationAction === 'ban'
                      ? 'bg-orange-600 hover:bg-orange-700'
                      : 'bg-amber-600 hover:bg-amber-700'
                }`}
              >
                {isModerating && (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                {moderationAction === 'delete'
                  ? 'Supprimer'
                  : moderationAction === 'ban'
                    ? 'Bannir'
                    : 'Désactiver'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
