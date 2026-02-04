import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import AdminLayout from '@/components/Layout/AdminLayout';
import { supportService } from '@/services/support';
import { AccountStatus, BannedMessage, SupportThreadDetail, SupportThreadListItem } from '@/types';
import {
  AlertTriangle,
  Inbox,
  LayoutGrid,
  Mail,
  RefreshCw,
  Send,
  ShieldAlert,
  X,
} from 'lucide-react';

type BannedFilter = 'pending' | 'responded' | 'all';
type ModerationAction = 'deactivate' | 'ban' | 'delete' | null;
type SupportMode = 'banned' | 'threads' | 'guests';

type ChatItem = {
  id: string;
  role: 'user' | 'admin';
  text: string;
  at: string;
  status?: string;
  messageRef?: BannedMessage;
};

export default function SupportCommandCenter() {
  const [supportMode, setSupportMode] = useState<SupportMode>('banned');
  const [bannedMessages, setBannedMessages] = useState<BannedMessage[]>([]);
  const [bannedFilter, setBannedFilter] = useState<BannedFilter>('pending');
  const [bannedLoading, setBannedLoading] = useState(false);
  const [pendingBannedCount, setPendingBannedCount] = useState(0);
  const [selectedBannedKey, setSelectedBannedKey] = useState<string | null>(null);
  const [respondingMessage, setRespondingMessage] = useState<BannedMessage | null>(null);
  const [responseDraft, setResponseDraft] = useState('');
  const [responding, setResponding] = useState(false);
  const [deletingConversation, setDeletingConversation] = useState(false);

  const [guestMessages, setGuestMessages] = useState<BannedMessage[]>([]);
  const [guestFilter, setGuestFilter] = useState<BannedFilter>('pending');
  const [guestLoading, setGuestLoading] = useState(false);
  const [pendingGuestCount, setPendingGuestCount] = useState(0);
  const [selectedGuestKey, setSelectedGuestKey] = useState<string | null>(null);

  const [threads, setThreads] = useState<SupportThreadListItem[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(null);
  const [selectedThread, setSelectedThread] = useState<SupportThreadDetail | null>(null);
  const [threadReply, setThreadReply] = useState('');
  const [sendingThreadReply, setSendingThreadReply] = useState(false);

  const [moderationUser, setModerationUser] = useState<{ id: number; phone?: string } | null>(null);
  const [moderationAction, setModerationAction] = useState<ModerationAction>(null);
  const [moderationReason, setModerationReason] = useState('');
  const [isModerating, setIsModerating] = useState(false);
  const [accountStatus, setAccountStatus] = useState<AccountStatus | null>(null);

  useEffect(() => {
    loadBannedMessages('pending', true);
  }, []);

  useEffect(() => {
    loadBannedMessages(bannedFilter);
  }, [bannedFilter]);

  useEffect(() => {
    if (supportMode === 'guests') {
      loadGuestMessages(guestFilter);
    }
  }, [supportMode, guestFilter]);

  useEffect(() => {
    if (supportMode === 'threads') {
      loadThreads(true);
    }
  }, [supportMode]);

  const loadBannedMessages = async (filter: BannedFilter, silent = false) => {
    if (!silent) {
      setBannedLoading(true);
    }
    try {
      const data = await supportService.getBannedMessages(filter === 'all' ? undefined : filter, 'mobile_app');
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

  const loadGuestMessages = async (filter: BannedFilter, silent = false) => {
    if (!silent) {
      setGuestLoading(true);
    }
    try {
      const data = await supportService.getBannedMessages(filter === 'all' ? undefined : filter, 'guest');
      setGuestMessages(data);
      setPendingGuestCount(
        filter === 'responded'
          ? 0
          : data.filter((item) => (item.status || 'pending') !== 'responded').length,
      );
    } catch (error) {
      console.error(error);
      toast.error('Impossible de charger les messages invités.');
    } finally {
      if (!silent) {
        setGuestLoading(false);
      }
    }
  };

  const loadThreads = async (silent = false) => {
    if (!silent) {
      setThreadsLoading(true);
    }
    try {
      const data = await supportService.getThreads({ scope: 'all' });
      const ordered = [...data].sort((a, b) => {
        const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return bTime - aTime;
      });
      setThreads(ordered);
      const nextId = selectedThreadId || ordered[0]?.id || null;
      if (nextId) {
        await loadThreadDetail(nextId);
      } else {
        setSelectedThreadId(null);
        setSelectedThread(null);
      }
    } catch (error) {
      console.error(error);
      toast.error('Impossible de charger les conversations support.');
    } finally {
      if (!silent) {
        setThreadsLoading(false);
      }
    }
  };

  const loadThreadDetail = async (threadId: number) => {
    try {
      const detail = await supportService.getThreadById(threadId);
      setSelectedThread(detail);
      setSelectedThreadId(threadId);
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id === threadId
            ? { ...thread, unread_admin_count: 0, last_message_at: detail.last_message_at }
            : thread,
        ),
      );
    } catch (error) {
      console.error(error);
      toast.error('Conversation introuvable.');
    }
  };

  const openResponseModal = (message: BannedMessage) => {
    setRespondingMessage(message);
    setResponseDraft(message.admin_response || '');
  };

  const confirmDeleteConversation = async (options: {
    channel: 'mobile_app' | 'guest';
    user_id?: number | null;
    user_phone?: string | null;
    user_email?: string | null;
  }) => {
    if (deletingConversation) return;
    if (!window.confirm('Supprimer définitivement cette conversation ?')) {
      return;
    }
    setDeletingConversation(true);
    try {
      await supportService.deleteBannedConversation(options);
      toast.success('Conversation supprimée');
      if (options.channel === 'guest') {
        await loadGuestMessages(guestFilter);
      } else {
        await loadBannedMessages(bannedFilter);
      }
    } catch (error) {
      console.error(error);
      toast.error('Suppression impossible.');
    } finally {
      setDeletingConversation(false);
    }
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

  const sendQuickBannedResponse = async (message: BannedMessage) => {
    if (!responseDraft.trim()) {
      toast.warning('La réponse est vide.');
      return;
    }
    setResponding(true);
    try {
      await supportService.respondToBannedMessage(message.id, responseDraft.trim());
      toast.success('Réponse envoyée');
      setResponseDraft('');
      await loadBannedMessages(bannedFilter);
    } catch (error) {
      console.error(error);
      toast.error('Impossible d’envoyer la réponse.');
    } finally {
      setResponding(false);
    }
  };

  const openModerationModal = (action: ModerationAction, userId: number, phone?: string) => {
    setModerationUser({ id: userId, phone });
    setModerationAction(action);
    setModerationReason('');
    loadAccountStatus(userId);
  };

  const sendThreadReply = async () => {
    if (!selectedThread || !threadReply.trim()) {
      toast.warning('La réponse est vide.');
      return;
    }
    setSendingThreadReply(true);
    try {
      await supportService.sendMessage(selectedThread.id, { message: threadReply.trim() });
      setThreadReply('');
      await loadThreadDetail(selectedThread.id);
    } catch (error) {
      console.error(error);
      toast.error('Impossible d’envoyer la réponse.');
    } finally {
      setSendingThreadReply(false);
    }
  };

  const deleteThreadConversation = async (threadId: number) => {
    if (deletingConversation) return;
    if (!window.confirm('Supprimer définitivement cette conversation ?')) {
      return;
    }
    setDeletingConversation(true);
    try {
      await supportService.deleteThread(threadId);
      toast.success('Conversation supprimée');
      setSelectedThread(null);
      setSelectedThreadId(null);
      await loadThreads();
    } catch (error) {
      console.error(error);
      toast.error('Suppression impossible.');
    } finally {
      setDeletingConversation(false);
    }
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

      setModerationUser(null);
      setModerationAction(null);
      await loadBannedMessages(bannedFilter);
    } catch (error) {
      console.error(error);
      toast.error("Erreur lors de l'action de modération");
    } finally {
      setIsModerating(false);
    }
  };

  const accountStatusBadge = (status?: AccountStatus | null) => {
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

  const accountStatusDescription = (status?: AccountStatus | null) => {
    if (!status) return null;

    if (status === 'inactive') {
      return 'Désactivation temporaire. L’admin peut réactiver à tout moment.';
    }

    if (status === 'banned') {
      return 'Bannissement temporaire. Si non réactivé sous 72h, le compte est auto‑supprimé.';
    }

    if (status === 'deleted') {
      return 'Compte supprimé définitivement de la base de données.';
    }

    return 'Compte actif.';
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

  const bannedUsers = useMemo(() => {
    const grouped = new Map<
      string,
      {
        key: string;
        label: string;
        contact: string;
        messages: BannedMessage[];
        lastMessage: BannedMessage;
        pendingCount: number;
        status?: AccountStatus;
        userId?: number | null;
        phone?: string | null;
      }
    >();

    const inferStatus = (message: BannedMessage): AccountStatus | undefined => {
      if (message.current_account_status) {
        return message.current_account_status;
      }
      if (message.action_type === 'inactive') {
        return 'inactive';
      }
      if (message.action_type === 'banned') {
        return 'banned';
      }
      if (message.action_type === 'deleted') {
        return 'deleted';
      }
      return undefined;
    };

    bannedMessages.forEach((message) => {
      const contact =
        message.user_phone ||
        message.user_email ||
        (message.user_id ? `Utilisateur #${message.user_id}` : 'Contact inconnu');
      const key =
        message.user_phone ||
        message.user_email ||
        (message.user_id ? `user:${message.user_id}` : `msg:${message.id}`);
      const existing = grouped.get(key);
      const derivedStatus = inferStatus(message);
      if (!existing) {
        grouped.set(key, {
          key,
          label: contact,
          contact,
          messages: [message],
          lastMessage: message,
          pendingCount: (message.status || 'pending') !== 'responded' ? 1 : 0,
          status: derivedStatus,
          userId: message.user_id,
          phone: message.user_phone,
        });
      } else {
        existing.messages.push(message);
        if (new Date(message.created_at).getTime() > new Date(existing.lastMessage.created_at).getTime()) {
          existing.lastMessage = message;
          existing.status = derivedStatus || existing.status;
          existing.userId = message.user_id;
          existing.phone = message.user_phone;
        }
        if ((message.status || 'pending') !== 'responded') {
          existing.pendingCount += 1;
        }
      }
    });

    return Array.from(grouped.values())
      .map((entry) => ({
        ...entry,
        messages: entry.messages.sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        ),
      }))
      .sort((a, b) => new Date(b.lastMessage.created_at).getTime() - new Date(a.lastMessage.created_at).getTime());
  }, [bannedMessages]);

  const guestUsers = useMemo(() => {
    const grouped = new Map<
      string,
      {
        key: string;
        label: string;
        contact: string;
        messages: BannedMessage[];
        lastMessage: BannedMessage;
        pendingCount: number;
      }
    >();

    guestMessages.forEach((message) => {
      const contact =
        message.user_phone ||
        message.user_email ||
        (message.user_id ? `Utilisateur #${message.user_id}` : 'Contact invité');
      const key =
        message.user_phone ||
        message.user_email ||
        (message.user_id ? `user:${message.user_id}` : `msg:${message.id}`);
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, {
          key,
          label: contact,
          contact,
          messages: [message],
          lastMessage: message,
          pendingCount: (message.status || 'pending') !== 'responded' ? 1 : 0,
        });
      } else {
        existing.messages.push(message);
        if (new Date(message.created_at).getTime() > new Date(existing.lastMessage.created_at).getTime()) {
          existing.lastMessage = message;
        }
        if ((message.status || 'pending') !== 'responded') {
          existing.pendingCount += 1;
        }
      }
    });

    return Array.from(grouped.values())
      .map((entry) => ({
        ...entry,
        messages: entry.messages.sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        ),
      }))
      .sort((a, b) => new Date(b.lastMessage.created_at).getTime() - new Date(a.lastMessage.created_at).getTime());
  }, [guestMessages]);

  const selectedBanned = useMemo(() => {
    if (!selectedBannedKey) {
      return null;
    }
    return bannedUsers.find((item) => item.key === selectedBannedKey) || null;
  }, [bannedUsers, selectedBannedKey]);

  const selectedGuest = useMemo(() => {
    if (!selectedGuestKey) {
      return null;
    }
    return guestUsers.find((item) => item.key === selectedGuestKey) || null;
  }, [guestUsers, selectedGuestKey]);

  useEffect(() => {
    if (!bannedUsers.length) {
      setSelectedBannedKey(null);
      return;
    }
    if (!selectedBannedKey || !bannedUsers.some((item) => item.key === selectedBannedKey)) {
      setSelectedBannedKey(bannedUsers[0].key);
    }
  }, [bannedUsers, selectedBannedKey]);

  useEffect(() => {
    if (!guestUsers.length) {
      setSelectedGuestKey(null);
      return;
    }
    if (!selectedGuestKey || !guestUsers.some((item) => item.key === selectedGuestKey)) {
      setSelectedGuestKey(guestUsers[0].key);
    }
  }, [guestUsers, selectedGuestKey]);

  const moderationContext = useMemo(() => {
    if (!selectedBanned?.messages?.length) {
      return null;
    }
    return selectedBanned.messages.find((msg) => msg.action_type) || null;
  }, [selectedBanned?.messages]);

  const chatItems = useMemo<ChatItem[]>(() => {
    if (!selectedBanned?.messages?.length) {
      return [];
    }
    return selectedBanned.messages
      .slice()
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
      .flatMap((message) => {
        const items: ChatItem[] = [
          {
            id: `user-${message.id}`,
            role: 'user',
            text: message.message,
            at: message.created_at,
            status: message.status || 'pending',
            messageRef: message,
          },
        ];
        if (message.admin_response) {
          items.push({
            id: `admin-${message.id}`,
            role: 'admin',
            text: message.admin_response,
            at: message.responded_at || message.created_at,
            status: 'responded',
          });
        }
        return items;
      });
  }, [selectedBanned?.messages]);

  const guestChatItems = useMemo<ChatItem[]>(() => {
    if (!selectedGuest?.messages?.length) {
      return [];
    }
    return selectedGuest.messages
      .slice()
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
      .flatMap((message) => {
        const items: ChatItem[] = [
          {
            id: `guest-user-${message.id}`,
            role: 'user',
            text: message.message,
            at: message.created_at,
            status: message.status || 'pending',
            messageRef: message,
          },
        ];
        if (message.admin_response) {
          items.push({
            id: `guest-admin-${message.id}`,
            role: 'admin',
            text: message.admin_response,
            at: message.responded_at || message.created_at,
            status: 'responded',
          });
        }
        return items;
      });
  }, [selectedGuest?.messages]);

  const latestBannedMessage = useMemo(() => {
    if (!selectedBanned?.messages?.length) return null;
    return selectedBanned.messages
      .slice()
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  }, [selectedBanned?.messages]);

  const latestPendingBannedMessage = useMemo(() => {
    if (!selectedBanned?.messages?.length) return null;
    return selectedBanned.messages
      .filter((msg) => (msg.status || 'pending') !== 'responded')
      .slice()
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  }, [selectedBanned?.messages]);

  const latestGuestMessage = useMemo(() => {
    if (!selectedGuest?.messages?.length) return null;
    return selectedGuest.messages
      .slice()
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  }, [selectedGuest?.messages]);

  const latestPendingGuestMessage = useMemo(() => {
    if (!selectedGuest?.messages?.length) return null;
    return selectedGuest.messages
      .filter((msg) => (msg.status || 'pending') !== 'responded')
      .slice()
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  }, [selectedGuest?.messages]);

  const threadChatItems = useMemo<ChatItem[]>(() => {
    if (!selectedThread?.messages?.length) {
      return [];
    }
    return selectedThread.messages
      .filter((message) => !message.is_internal)
      .slice()
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
      .map((message) => ({
        id: `thread-${message.id}`,
        role: message.sender_type === 'admin' ? 'admin' : 'user',
        text: message.body,
        at: message.created_at,
      }));
  }, [selectedThread?.messages]);

  const heroMetrics = [
    {
      label: 'Alertes bannies',
      value: pendingBannedCount.toString(),
      sub: 'En attente de réponse',
      icon: ShieldAlert,
      accent: 'from-rose-500/40 via-red-400/30 to-purple-400/30',
    },
    {
      label: 'Contacts bannis',
      value: bannedUsers.length.toString(),
      sub: 'Conversations actives',
      icon: AlertTriangle,
      accent: 'from-amber-500/40 via-orange-400/30 to-pink-400/30',
    },
    {
      label: 'Réponses envoyées',
      value: bannedMessages.filter((item) => (item.status || 'pending') === 'responded').length.toString(),
      sub: 'Sur l’ensemble du filtre',
      icon: Mail,
      accent: 'from-blue-500/40 via-blue-400/30 to-cyan-400/30',
    },
    {
      label: 'Conversations actives',
      value: threads.length.toString(),
      sub: 'Comptes authentifiés',
      icon: Inbox,
      accent: 'from-slate-500/40 via-slate-400/30 to-slate-300/30',
    },
    {
      label: 'Invités',
      value: guestUsers.length.toString(),
      sub: 'Contacts non connectés',
      icon: Mail,
      accent: 'from-emerald-500/40 via-teal-400/30 to-cyan-400/30',
    },
  ];

  return (
    <AdminLayout>
      <div className="space-y-8">
        <section className="rounded-3xl bg-gradient-to-r from-slate-900 via-blue-900 to-cyan-900 text-white p-8 shadow-2xl border border-white/10">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8">
            <div className="space-y-4 max-w-2xl">
              <div className="inline-flex items-center space-x-2 text-xs uppercase tracking-[0.35em] text-white/70">
                <ShieldAlert className="w-4 h-4" />
                <span>Support bannis</span>
              </div>
              <div>
                <h1 className="text-3xl font-semibold">Support & conformité Booms</h1>
                <p className="text-white/70 text-sm mt-2">
                  Pilotage temps-réel des alertes envoyées par les comptes bannis.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {['SLA 24h', 'Analyse risque', 'Modération'].map((label) => (
                  <span key={label} className="px-3 py-1 rounded-full bg-white/10 text-xs font-semibold">
                    {label}
                  </span>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 flex-1">
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
            <button
              onClick={() => {
                if (supportMode === 'threads') {
                  loadThreads();
                } else if (supportMode === 'guests') {
                  loadGuestMessages(guestFilter);
                } else {
                  loadBannedMessages(bannedFilter);
                }
              }}
              className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 text-white text-sm font-medium border border-white/20 hover:bg-white/20"
            >
              <RefreshCw className="w-4 h-4" />
              Actualiser
            </button>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">Vue support</p>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  onClick={() => setSupportMode('banned')}
                  className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                    supportMode === 'banned'
                      ? 'bg-rose-600 text-white border-rose-600'
                      : 'bg-white text-rose-700 border-rose-200'
                  }`}
                >
                  Comptes bloqués
                </button>
                <button
                  onClick={() => setSupportMode('threads')}
                  className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                    supportMode === 'threads'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200'
                  }`}
                >
                  Utilisateurs actifs
                </button>
                <button
                  onClick={() => setSupportMode('guests')}
                  className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                    supportMode === 'guests'
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white text-emerald-700 border-emerald-200'
                  }`}
                >
                  Invités
                </button>
              </div>
            </div>

            {supportMode === 'banned' && (
              <div className="rounded-2xl border border-rose-100 bg-white shadow-sm p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-rose-900 flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4" />
                    Alertes bannies
                  </p>
                  <button
                    onClick={() => loadBannedMessages(bannedFilter)}
                    className="inline-flex items-center gap-2 text-xs text-rose-700"
                  >
                    <RefreshCw className="w-3 h-3" /> Rafraîchir
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-3">
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
              </div>
            )}

            {supportMode === 'guests' && (
              <div className="rounded-2xl border border-emerald-100 bg-white shadow-sm p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-emerald-900 flex items-center gap-2">
                    <Mail className="w-4 h-4" />
                    Messages invités
                  </p>
                  <button
                    onClick={() => loadGuestMessages(guestFilter)}
                    className="inline-flex items-center gap-2 text-xs text-emerald-700"
                  >
                    <RefreshCw className="w-3 h-3" /> Rafraîchir
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  {(['pending', 'responded', 'all'] as BannedFilter[]).map((option) => (
                    <button
                      key={option}
                      onClick={() => setGuestFilter(option)}
                      className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                        guestFilter === option
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white text-emerald-700 border-emerald-200'
                      }`}
                    >
                      {option === 'pending' ? 'En attente' : option === 'responded' ? 'Répondu' : 'Tous'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {supportMode === 'banned'
                      ? `Utilisateurs (${bannedUsers.length})`
                      : `Conversations (${threads.length})`}
                  </p>
                  <p className="text-xs text-slate-500">
                    {supportMode === 'banned'
                      ? 'Organisés par dernière activité'
                      : 'Threads authentifiés actifs'}
                  </p>
                </div>
                <LayoutGrid className="w-4 h-4 text-slate-400" />
              </div>
              <div className="max-h-[calc(100vh-360px)] overflow-y-auto divide-y divide-slate-100">
                {supportMode === 'banned' && bannedLoading && (
                  <div className="p-6 text-center text-sm text-slate-500">Chargement...</div>
                )}
                {supportMode === 'banned' && !bannedLoading && !bannedUsers.length && (
                  <div className="p-6 text-center text-sm text-slate-500">
                    Aucune alerte pour ce filtre.
                  </div>
                )}
                {supportMode === 'banned' && bannedUsers.map((user) => (
                  <button
                    key={user.key}
                    onClick={() => setSelectedBannedKey(user.key)}
                    className={`w-full text-left px-4 py-3 transition ${
                      selectedBannedKey === user.key
                        ? 'bg-rose-50/80 border-l-4 border-rose-500'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900 truncate">{user.label}</p>
                      <div className="flex items-center gap-2">
                        {user.pendingCount > 0 && (
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">
                            {user.pendingCount} en attente
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            confirmDeleteConversation({
                              channel: 'mobile_app',
                              user_id: user.userId ?? undefined,
                              user_phone: user.phone ?? undefined,
                              user_email: user.messages[0]?.user_email ?? undefined,
                            });
                          }}
                          className="text-xs text-rose-500 hover:text-rose-700"
                          title="Supprimer la conversation"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 mt-1 truncate">{user.lastMessage.message}</p>
                    <div className="flex items-center gap-2 mt-2">
                      {user.status && accountStatusBadge(user.status)}
                      <span className="text-[11px] text-slate-400">
                        {formattedRelative(user.lastMessage.created_at)}
                      </span>
                    </div>
                  </button>
                ))}

                {supportMode === 'guests' && guestLoading && (
                  <div className="p-6 text-center text-sm text-slate-500">Chargement...</div>
                )}
                {supportMode === 'guests' && !guestLoading && !guestUsers.length && (
                  <div className="p-6 text-center text-sm text-slate-500">
                    Aucun message invité pour ce filtre.
                  </div>
                )}
                {supportMode === 'guests' && guestUsers.map((user) => (
                  <button
                    key={user.key}
                    onClick={() => setSelectedGuestKey(user.key)}
                    className={`w-full text-left px-4 py-3 transition ${
                      selectedGuestKey === user.key
                        ? 'bg-emerald-50/80 border-l-4 border-emerald-500'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900 truncate">{user.label}</p>
                      <div className="flex items-center gap-2">
                        {user.pendingCount > 0 && (
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                            {user.pendingCount} en attente
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            confirmDeleteConversation({
                              channel: 'guest',
                              user_id: user.messages[0]?.user_id ?? undefined,
                              user_phone: user.messages[0]?.user_phone ?? undefined,
                              user_email: user.messages[0]?.user_email ?? undefined,
                            });
                          }}
                          className="text-xs text-emerald-500 hover:text-emerald-700"
                          title="Supprimer la conversation"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 mt-1 truncate">{user.lastMessage.message}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[11px] text-slate-400">
                        {formattedRelative(user.lastMessage.created_at)}
                      </span>
                    </div>
                  </button>
                ))}

                {supportMode === 'threads' && threadsLoading && (
                  <div className="p-6 text-center text-sm text-slate-500">Chargement...</div>
                )}
                {supportMode === 'threads' && !threadsLoading && !threads.length && (
                  <div className="p-6 text-center text-sm text-slate-500">
                    Aucune conversation authentifiée.
                  </div>
                )}
                {supportMode === 'threads' && threads.map((thread) => (
                  <button
                    key={thread.id}
                    onClick={() => loadThreadDetail(thread.id)}
                    className={`w-full text-left px-4 py-3 transition ${
                      selectedThreadId === thread.id
                        ? 'bg-slate-50 border-l-4 border-slate-900'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {thread.user_phone || thread.user_email || `Utilisateur #${thread.user_id || thread.id}`}
                      </p>
                      <div className="flex items-center gap-2">
                        {!!thread.unread_admin_count && thread.unread_admin_count > 0 && (
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-900 text-white">
                            {thread.unread_admin_count} non lus
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteThreadConversation(thread.id);
                          }}
                          className="text-xs text-slate-500 hover:text-slate-700"
                          title="Supprimer la conversation"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 mt-1 truncate">
                      {thread.reference} • {thread.subject || 'Conversation support'}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[11px] text-slate-400">
                        {formattedRelative(thread.last_message_at || thread.created_at)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <section className="rounded-3xl border border-slate-200 bg-white shadow-xl p-6 space-y-6 min-h-[640px]">
            {supportMode === 'banned' && bannedLoading && (
              <div className="flex flex-col items-center justify-center h-64 text-slate-500 gap-3">
                <div className="w-12 h-12 rounded-full border-4 border-slate-200 border-t-rose-500 animate-spin" />
                <p>Chargement des alertes...</p>
              </div>
            )}

            {supportMode === 'banned' && !bannedLoading && !selectedBanned && (
              <div className="flex flex-col items-center justify-center h-64 text-center text-slate-500 gap-3">
                <Inbox className="w-10 h-10" />
                <p>Sélectionnez un utilisateur pour afficher la conversation.</p>
              </div>
            )}

            {supportMode === 'banned' && !bannedLoading && selectedBanned && (
              <>
                <div className="flex flex-wrap items-start gap-4 justify-between">
                  <div className="space-y-1">
                    <p className="text-xs uppercase text-slate-400 tracking-wide">Statut du compte</p>
                    <h2 className="text-2xl font-semibold text-slate-900">{selectedBanned.label}</h2>
                    <div className="flex items-center gap-2 flex-wrap">
                      {selectedBanned.status ? (
                        accountStatusBadge(selectedBanned.status)
                      ) : (
                        <span className="px-3 py-1 text-xs font-semibold rounded-full bg-slate-100 text-slate-600">
                          Statut inconnu
                        </span>
                      )}
                      <span className="text-xs text-slate-400">
                        Dernier message {formattedRelative(selectedBanned.lastMessage.created_at)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 max-w-xl">
                      {accountStatusDescription(selectedBanned.status) || 'Statut non renseigné pour ce compte.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedBanned.userId && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openModerationModal('deactivate', selectedBanned.userId!, selectedBanned.phone || undefined)}
                          className="px-3 py-2 rounded-full border border-amber-200 bg-amber-50 text-amber-800 text-xs font-semibold"
                        >
                          ⏸️ Désactiver
                        </button>
                        <button
                          onClick={() => openModerationModal('ban', selectedBanned.userId!, selectedBanned.phone || undefined)}
                          className="px-3 py-2 rounded-full border border-orange-200 bg-orange-50 text-orange-800 text-xs font-semibold"
                        >
                          🚫 Bannir
                        </button>
                        <button
                          onClick={() => openModerationModal('delete', selectedBanned.userId!, selectedBanned.phone || undefined)}
                          className="px-3 py-2 rounded-full border border-red-200 bg-red-50 text-red-800 text-xs font-semibold"
                        >
                          💀 Supprimer
                        </button>
                      </div>
                    )}
                    <button
                      onClick={() => loadBannedMessages(bannedFilter)}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-slate-200 text-sm text-slate-600 hover:border-slate-400"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Rafraîchir
                    </button>
                  </div>
                </div>

                {moderationContext && (
                  <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4">
                    <div className="flex items-center gap-2 text-rose-700 text-sm mb-2">
                      <AlertTriangle className="w-4 h-4" />
                      Contexte de modération
                    </div>
                    <div className="text-sm text-rose-900 font-semibold">
                      {moderationContext.action_type === 'banned'
                        ? '🚫 Compte banni'
                        : moderationContext.action_type === 'inactive'
                          ? '⏸️ Compte désactivé'
                          : '💀 Compte supprimé'}
                    </div>
                    {moderationContext.action_reason && (
                      <p className="text-xs text-rose-700 mt-1">
                        Raison: {moderationContext.action_reason}
                      </p>
                    )}
                    {moderationContext.action_at && (
                      <p className="text-xs text-rose-600 mt-1">
                        {formatDistanceToNow(new Date(moderationContext.action_at), {
                          addSuffix: true,
                          locale: fr,
                        })}
                      </p>
                    )}
                    {moderationContext.ban_until && moderationContext.action_type === 'banned' && (
                      <p className="text-xs text-orange-700 font-semibold mt-1">
                        ⏰ Auto-suppression: {formatDistanceToNow(new Date(moderationContext.ban_until), {
                          addSuffix: true,
                          locale: fr,
                        })}
                      </p>
                    )}
                  </div>
                )}

                <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1">
                  {chatItems.map((item) => (
                    <div
                      key={item.id}
                      className={`rounded-2xl border p-4 max-w-[80%] ${
                        item.role === 'admin'
                          ? 'ml-auto bg-rose-50 border-rose-100'
                          : 'bg-white border-slate-100'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-700">
                          {item.role === 'admin' ? 'Booms' : 'Client'}
                        </span>
                        <span className="text-xs text-slate-400">{formattedRelative(item.at)}</span>
                      </div>
                      <p className="text-sm text-slate-700 mt-2 whitespace-pre-line">{item.text}</p>
                      {item.role === 'user' && item.status !== 'responded' && item.messageRef && (
                        <div className="flex items-center justify-between mt-3">
                          <span className="text-[11px] text-rose-600 font-semibold">⏳ En attente</span>
                          <button
                            onClick={() => openResponseModal(item.messageRef as BannedMessage)}
                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 transition"
                          >
                            <Mail className="w-3 h-3" />
                            Répondre
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase text-rose-500">Répondre (compte bloqué)</p>
                    <span className="text-[11px] text-rose-500">
                      {latestPendingBannedMessage
                        ? 'Message en attente'
                        : latestBannedMessage
                          ? 'Dernier message sélectionné'
                          : 'Aucun message'}
                    </span>
                  </div>
                  <textarea
                    value={responseDraft}
                    onChange={(event) => setResponseDraft(event.target.value)}
                    className="w-full min-h-[140px] rounded-2xl border border-rose-200 focus:ring-2 focus:ring-rose-200 focus:border-rose-400 text-sm p-4"
                    placeholder="Rédigez une réponse..."
                  />
                  <div className="flex items-center justify-end">
                    <button
                      onClick={() => {
                        const target = latestPendingBannedMessage || latestBannedMessage;
                        if (!target) {
                          toast.warning('Aucun message à traiter.');
                          return;
                        }
                        sendQuickBannedResponse(target);
                      }}
                      disabled={responding || !responseDraft.trim() || !(latestPendingBannedMessage || latestBannedMessage)}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-rose-600 text-white text-sm font-semibold disabled:opacity-40"
                    >
                      <Send className="w-4 h-4" />
                      {responding ? 'Envoi...' : 'Envoyer'}
                    </button>
                  </div>
                </div>
              </>
            )}

            {supportMode === 'threads' && threadsLoading && (
              <div className="flex flex-col items-center justify-center h-64 text-slate-500 gap-3">
                <div className="w-12 h-12 rounded-full border-4 border-slate-200 border-t-slate-900 animate-spin" />
                <p>Chargement des conversations...</p>
              </div>
            )}

            {supportMode === 'threads' && !threadsLoading && !selectedThread && (
              <div className="flex flex-col items-center justify-center h-64 text-center text-slate-500 gap-3">
                <Inbox className="w-10 h-10" />
                <p>Sélectionnez une conversation pour afficher le chat.</p>
              </div>
            )}

            {supportMode === 'threads' && !threadsLoading && selectedThread && (
              <>
                <div className="flex flex-wrap items-start gap-4 justify-between">
                  <div className="space-y-1">
                    <p className="text-xs uppercase text-slate-400 tracking-wide">Conversation authentifiée</p>
                    <h2 className="text-2xl font-semibold text-slate-900">{selectedThread.subject}</h2>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-3 py-1 text-xs font-semibold rounded-full bg-slate-100 text-slate-600">
                        {selectedThread.reference}
                      </span>
                      <span className="text-xs text-slate-400">
                        Dernier message {formattedRelative(selectedThread.last_message_at || selectedThread.created_at)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 max-w-xl">
                      {selectedThread.user_phone || selectedThread.user_email || `Utilisateur #${selectedThread.user_id}`}
                    </p>
                  </div>
                  <button
                    onClick={() => loadThreads()}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-slate-200 text-sm text-slate-600 hover:border-slate-400"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Rafraîchir
                  </button>
                </div>

                <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1">
                  {threadChatItems.length === 0 && (
                    <p className="text-sm text-slate-500">Aucun message pour le moment.</p>
                  )}
                  {threadChatItems.map((item) => (
                    <div
                      key={item.id}
                      className={`rounded-2xl border p-4 max-w-[80%] ${
                        item.role === 'admin'
                          ? 'ml-auto bg-slate-50 border-slate-200'
                          : 'bg-white border-slate-100'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-700">
                          {item.role === 'admin' ? 'Booms' : 'Client'}
                        </span>
                        <span className="text-xs text-slate-400">{formattedRelative(item.at)}</span>
                      </div>
                      <p className="text-sm text-slate-700 mt-2 whitespace-pre-line">{item.text}</p>
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                  <p className="text-xs uppercase text-slate-400">Répondre</p>
                  <textarea
                    value={threadReply}
                    onChange={(event) => setThreadReply(event.target.value)}
                    className="w-full min-h-[140px] rounded-2xl border border-slate-200 focus:ring-2 focus:ring-slate-300 focus:border-slate-400 text-sm p-4"
                    placeholder="Rédigez une réponse..."
                  />
                  <div className="flex items-center justify-end">
                    <button
                      onClick={sendThreadReply}
                      disabled={sendingThreadReply || !threadReply.trim()}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-slate-900 text-white text-sm font-semibold disabled:opacity-40"
                    >
                      <Send className="w-4 h-4" />
                      {sendingThreadReply ? 'Envoi...' : 'Envoyer'}
                    </button>
                  </div>
                </div>
              </>
            )}

            {supportMode === 'guests' && guestLoading && (
              <div className="flex flex-col items-center justify-center h-64 text-slate-500 gap-3">
                <div className="w-12 h-12 rounded-full border-4 border-slate-200 border-t-emerald-500 animate-spin" />
                <p>Chargement des messages invités...</p>
              </div>
            )}

            {supportMode === 'guests' && !guestLoading && !selectedGuest && (
              <div className="flex flex-col items-center justify-center h-64 text-center text-slate-500 gap-3">
                <Inbox className="w-10 h-10" />
                <p>Sélectionnez un contact invité pour afficher la conversation.</p>
              </div>
            )}

            {supportMode === 'guests' && !guestLoading && selectedGuest && (
              <>
                <div className="flex flex-wrap items-start gap-4 justify-between">
                  <div className="space-y-1">
                    <p className="text-xs uppercase text-slate-400 tracking-wide">Conversation invitée</p>
                    <h2 className="text-2xl font-semibold text-slate-900">{selectedGuest.label}</h2>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-3 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-700">
                        Invité
                      </span>
                      <span className="text-xs text-slate-400">
                        Dernier message {formattedRelative(selectedGuest.lastMessage.created_at)}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => loadGuestMessages(guestFilter)}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-emerald-200 text-sm text-emerald-700 hover:border-emerald-400"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Rafraîchir
                  </button>
                </div>

                <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1">
                  {guestChatItems.map((item) => (
                    <div
                      key={item.id}
                      className={`rounded-2xl border p-4 max-w-[80%] ${
                        item.role === 'admin'
                          ? 'ml-auto bg-emerald-50 border-emerald-100'
                          : 'bg-white border-slate-100'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-700">
                          {item.role === 'admin' ? 'Booms' : 'Invité'}
                        </span>
                        <span className="text-xs text-slate-400">{formattedRelative(item.at)}</span>
                      </div>
                      <p className="text-sm text-slate-700 mt-2 whitespace-pre-line">{item.text}</p>
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase text-emerald-600">Répondre (invité)</p>
                    <span className="text-[11px] text-emerald-600">
                      {latestPendingGuestMessage
                        ? 'Message en attente'
                        : latestGuestMessage
                          ? 'Dernier message sélectionné'
                          : 'Aucun message'}
                    </span>
                  </div>
                  <textarea
                    value={responseDraft}
                    onChange={(event) => setResponseDraft(event.target.value)}
                    className="w-full min-h-[140px] rounded-2xl border border-emerald-200 focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 text-sm p-4"
                    placeholder="Rédigez une réponse..."
                  />
                  <div className="flex items-center justify-end">
                    <button
                      onClick={() => {
                        const target = latestPendingGuestMessage || latestGuestMessage;
                        if (!target) {
                          toast.warning('Aucun message à traiter.');
                          return;
                        }
                        sendQuickBannedResponse(target);
                      }}
                      disabled={responding || !responseDraft.trim() || !(latestPendingGuestMessage || latestGuestMessage)}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-emerald-600 text-white text-sm font-semibold disabled:opacity-40"
                    >
                      <Send className="w-4 h-4" />
                      {responding ? 'Envoi...' : 'Envoyer'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>
        </section>
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
                {accountStatus && (
                  <div className="mt-2">{accountStatusBadge(accountStatus)}</div>
                )}
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

            {moderationAction === 'delete' && (
              <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-4">
                <p className="text-sm font-semibold text-red-900 flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                  <span>⚠️ Cette action est IRRÉVERSIBLE!</span>
                </p>
                <ul className="text-xs text-red-800 mt-2 space-y-1 ml-7">
                  <li>✓ Suppression complète de l'utilisateur</li>
                  <li>✓ Suppression de tous ses assets</li>
                  <li>✓ Suppression de toutes ses transactions</li>
                  <li>✓ Suppression de toutes ses données</li>
                </ul>
              </div>
            )}

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
