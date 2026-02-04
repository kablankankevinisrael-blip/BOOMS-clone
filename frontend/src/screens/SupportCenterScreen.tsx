import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../contexts/AuthContext';
import supportService, {
  SupportThread,
  SuggestedTemplate,
} from '../services/support';
import { gradients, palette, fonts } from '../styles/theme';

const CATEGORY_OPTIONS = [
  { value: 'general', label: 'Question générale' },
  { value: 'account', label: 'Compte & accès' },
  { value: 'payment', label: 'Paiements' },
  { value: 'technical', label: 'Technique' },
  { value: 'ban_appeal', label: 'Contestation' },
];

export default function SupportCenterScreen() {
  const { accountStatus, isAuthenticated, user } = useAuth();
  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [selectedThread, setSelectedThread] = useState<SupportThread | null>(null);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [creatingThread, setCreatingThread] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [composer, setComposer] = useState('');
  const [suggestions, setSuggestions] = useState<SuggestedTemplate[]>([]);
  const [draft, setDraft] = useState({ subject: '', category: 'general', message: '' });

  const badgeConfig = useMemo(() => {
    const normalize = (value?: string | null) => (value || '').toLowerCase();
    if (!isAuthenticated) {
      return {
        heading: 'Mode invité',
        primary: 'Accès limité',
        secondary: 'Connectez-vous pour consulter votre statut',
        variant: 'guest' as const,
      };
    }

    if (accountStatus) {
      const status = normalize(accountStatus.status);
      const isCritical = status === 'banned' || status === 'suspended';
      const isPending = status.includes('pending') || status.includes('review') || status.includes('waiting');
      return {
        heading: 'Statut compte',
        primary: accountStatus.status_label || 'Statut en cours',
        secondary: accountStatus.status_message || accountStatus.status_reason || (isPending ? 'Validation en cours' : 'Compte opérationnel'),
        variant: isCritical ? ('critical' as const) : isPending ? ('warning' as const) : ('standard' as const),
      };
    }

    const kyc = normalize(user?.kyc_status);
    if (kyc === 'verified' || kyc === 'approved' || kyc === 'active') {
      return {
        heading: 'Statut compte',
        primary: 'Actif',
        secondary: 'Compte vérifié et prêt à l’emploi',
        variant: 'standard' as const,
      };
    }
    if (!kyc || kyc === 'unverified' || kyc === 'not_started') {
      return {
        heading: 'Statut compte',
        primary: 'Statut à compléter',
        secondary: 'Soumettez vos documents pour activer votre compte',
        variant: 'warning' as const,
      };
    }
    return {
      heading: 'Statut compte',
      primary: 'En attente',
      secondary: 'Validation en cours par nos équipes',
      variant: 'warning' as const,
    };
  }, [accountStatus, isAuthenticated, user?.kyc_status]);

  const openTickets = useMemo(() => threads.filter(t => t.status === 'open' || t.status === 'pending').length, [threads]);

  const loadThreads = useCallback(async (threadId?: number) => {
    try {
      setLoadingThreads(true);
      const data = await supportService.listThreads('mine');
      setThreads(data);
      const first = threadId || data[0]?.id;
      if (first) {
        const detail = await supportService.getThread(first);
        setSelectedThread(detail);
      } else {
        setSelectedThread(null);
      }
    } catch (error) {
      console.error('❌ [SUPPORT] Erreur chargement threads', error);
    } finally {
      setLoadingThreads(false);
    }
  }, []);

  useEffect(() => {
    supportService.getSuggestedMessages().then(setSuggestions).catch(() => setSuggestions([]));
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setThreads([]);
      setSelectedThread(null);
      setLoadingThreads(false);
      return;
    }
    loadThreads();
  }, [isAuthenticated, loadThreads]);

  const selectThread = async (threadId: number) => {
    try {
      setLoadingThreads(true);
      const detail = await supportService.getThread(threadId);
      setSelectedThread(detail);
    } catch (error) {
      console.error('❌ [SUPPORT] Erreur récupération thread', error);
    } finally {
      setLoadingThreads(false);
    }
  };

  const handleCreateThread = async () => {
    if (!draft.subject.trim() || !draft.message.trim()) {
      return;
    }
    try {
      setCreatingThread(true);
      const created = await supportService.createThread({
        subject: draft.subject.trim(),
        category: draft.category,
        message: draft.message.trim(),
      });
      setDraft({ subject: '', category: draft.category, message: '' });
      await loadThreads(created.id);
    } catch (error) {
      console.error('❌ [SUPPORT] Erreur création ticket', error);
    } finally {
      setCreatingThread(false);
    }
  };

  const handleSendMessage = async () => {
    if (!selectedThread || !composer.trim()) return;
    try {
      setSendingMessage(true);
      await supportService.postMessage(selectedThread.id, { message: composer.trim() });
      setComposer('');
      await selectThread(selectedThread.id);
    } catch (error) {
      console.error('❌ [SUPPORT] Erreur envoi message', error);
    } finally {
      setSendingMessage(false);
    }
  };

  const applyTemplate = (template: string) => {
    setComposer(template);
  };

  return (
    <LinearGradient colors={[...gradients.hero] as [string, string, ...string[]]} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <View>
            <Text style={styles.heroEyebrow}>Support & Sécurité</Text>
            <Text style={styles.heroTitle}>Assistance personnalisée</Text>
            <Text style={styles.heroSubtitle}>
              Nos équipes répondent en moins de 24h ouvrées. Consultez vos tickets, suivez les réponses et
              envoyez de nouveaux messages directement depuis l'application.
            </Text>
          </View>
          <View
            style={[
              styles.heroBadge,
              badgeConfig.variant === 'guest' && styles.heroBadgeGuest,
              badgeConfig.variant === 'warning' && styles.heroBadgeWarning,
              badgeConfig.variant === 'critical' && styles.heroBadgeCritical,
            ]}
          >
            <Text style={styles.heroBadgeLabel}>{badgeConfig.heading}</Text>
            <Text
              style={[
                styles.heroBadgeValue,
                badgeConfig.variant === 'guest' && styles.heroBadgeGuestValue,
                badgeConfig.variant === 'warning' && styles.heroBadgeWarningValue,
                badgeConfig.variant === 'critical' && styles.heroBadgeCriticalValue,
              ]}
            >
              {badgeConfig.primary}
            </Text>
            {!!badgeConfig.secondary && (
              <Text
                style={[
                  styles.heroBadgeHint,
                  badgeConfig.variant === 'guest' && styles.heroBadgeHintGuest,
                  badgeConfig.variant === 'warning' && styles.heroBadgeHintWarning,
                  badgeConfig.variant === 'critical' && styles.heroBadgeHintCritical,
                ]}
              >
                {badgeConfig.secondary}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Tickets ouverts</Text>
            <Text style={styles.metricValue}>{openTickets}</Text>
            <Text style={styles.metricHint}>En attente de réponse</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Délai moyen</Text>
            <Text style={styles.metricValue}>24-48h</Text>
            <Text style={styles.metricHint}>Support 24/24 hors week-end</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Priorité</Text>
            <Text style={styles.metricValue}>
              {isAuthenticated && accountStatus
                ? accountStatus.status === 'banned'
                  ? 'Critique'
                  : 'Standard'
                : 'Invité'}
            </Text>
            <Text style={styles.metricHint}>
              {isAuthenticated ? 'Suivi personnalisé' : 'Connectez-vous pour un suivi prioritaire'}
            </Text>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Nouveau ticket</Text>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Objet</Text>
            <TextInput
              style={styles.input}
              value={draft.subject}
              onChangeText={value => setDraft(prev => ({ ...prev, subject: value }))}
              placeholder="Ajouter un objet"
              placeholderTextColor="rgba(255,255,255,0.4)"
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Catégorie</Text>
            <View style={styles.categoryRow}>
              {CATEGORY_OPTIONS.map(option => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.categoryPill,
                    draft.category === option.value && styles.categoryPillActive,
                  ]}
                  onPress={() => setDraft(prev => ({ ...prev, category: option.value }))}
                >
                  <Text
                    style={[
                      styles.categoryPillText,
                      draft.category === option.value && styles.categoryPillTextActive,
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Message</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              multiline
              value={draft.message}
              onChangeText={value => setDraft(prev => ({ ...prev, message: value }))}
              placeholder="Expliquez votre demande"
              placeholderTextColor="rgba(255,255,255,0.4)"
            />
          </View>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleCreateThread}
            disabled={creatingThread}
          >
            <Text style={styles.primaryButtonText}>
              {creatingThread ? 'Création en cours...' : 'Envoyer au support'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Tickets précédents</Text>
            <Text style={styles.sectionHint}>{threads.length} échanges</Text>
          </View>
          {loadingThreads && (
            <ActivityIndicator color={palette.white} style={{ marginBottom: 16 }} />
          )}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
            {threads.map(thread => (
              <TouchableOpacity
                key={thread.id}
                style={[
                  styles.threadChip,
                  selectedThread?.id === thread.id && styles.threadChipActive,
                ]}
                onPress={() => selectThread(thread.id)}
              >
                <Text style={styles.threadChipTitle}>{thread.subject}</Text>
                <Text style={styles.threadChipMeta}>{thread.status.toUpperCase()}</Text>
                <Text style={styles.threadChipMeta}>#{thread.reference}</Text>
              </TouchableOpacity>
            ))}
            {threads.length === 0 && !loadingThreads && (
              <Text style={styles.emptyState}>Aucun échange pour le moment.</Text>
            )}
          </ScrollView>

          {selectedThread && (
            <View style={styles.threadPanel}>
              <View style={styles.threadHeader}>
                <View>
                  <Text style={styles.threadTitle}>{selectedThread.subject}</Text>
                  <Text style={styles.threadMeta}>#{selectedThread.reference}</Text>
                </View>
                <Text style={styles.threadStatus}>{selectedThread.status.toUpperCase()}</Text>
              </View>

              <View style={styles.messageList}>
                {selectedThread.messages?.map(message => (
                  <View
                    key={message.id}
                    style={[
                      styles.messageBubble,
                      message.sender_type === 'admin' ? styles.adminBubble : styles.userBubble,
                    ]}
                  >
                    <Text style={styles.messageBody}>{message.body}</Text>
                    <Text style={styles.messageMeta}>
                      {new Date(message.created_at).toLocaleString('fr-FR')}
                    </Text>
                  </View>
                )) || (
                  <Text style={styles.emptyState}>Aucun message pour l'instant.</Text>
                )}
              </View>

              <View style={styles.composerWrapper}>
                <TextInput
                  style={styles.composerInput}
                  value={composer}
                  multiline
                  onChangeText={setComposer}
                  placeholder="Écrire une réponse"
                  placeholderTextColor="rgba(255,255,255,0.4)"
                />
                <TouchableOpacity style={styles.primaryButton} onPress={handleSendMessage} disabled={sendingMessage}>
                  <Text style={styles.primaryButtonText}>{sendingMessage ? 'Envoi...' : 'Envoyer'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Suggestions de messages</Text>
          <View style={styles.suggestionsGrid}>
            {suggestions.map(template => (
              <TouchableOpacity key={template.title} style={styles.suggestionCard} onPress={() => applyTemplate(template.template)}>
                <Text style={styles.suggestionTitle}>{template.title}</Text>
                <Text style={styles.suggestionBody}>{template.template}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 64,
  },
  heroCard: {
    backgroundColor: 'rgba(10,16,30,0.85)',
    borderRadius: 28,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    marginBottom: 24,
  },
  heroEyebrow: {
    fontFamily: fonts.bodyMedium,
    color: palette.teal,
    textTransform: 'uppercase',
    letterSpacing: 2,
    fontSize: 12,
  },
  heroTitle: {
    fontFamily: fonts.heading,
    color: palette.white,
    fontSize: 24,
    marginTop: 8,
  },
  heroSubtitle: {
    fontFamily: fonts.body,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 8,
    lineHeight: 20,
  },
  heroBadge: {
    marginTop: 16,
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(36,209,181,0.12)',
  },
  heroBadgeGuest: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  heroBadgeWarning: {
    backgroundColor: 'rgba(246,193,68,0.16)',
  },
  heroBadgeCritical: {
    backgroundColor: 'rgba(255,123,110,0.18)',
  },
  heroBadgeLabel: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
  },
  heroBadgeValue: {
    fontFamily: fonts.heading,
    fontSize: 18,
    color: palette.teal,
  },
  heroBadgeGuestValue: {
    color: palette.white,
    fontSize: 16,
  },
  heroBadgeWarningValue: {
    color: palette.amber,
  },
  heroBadgeCriticalValue: {
    color: palette.coral,
  },
  heroBadgeHint: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: 'rgba(255,255,255,0.65)',
    marginTop: 4,
  },
  heroBadgeHintGuest: {
    color: 'rgba(255,255,255,0.85)',
  },
  heroBadgeHintWarning: {
    color: 'rgba(246,193,68,0.9)',
  },
  heroBadgeHintCritical: {
    color: 'rgba(255,123,110,0.9)',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  metricCard: {
    flex: 1,
    borderRadius: 20,
    padding: 18,
    backgroundColor: 'rgba(14,18,32,0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  metricLabel: {
    fontFamily: fonts.body,
    color: 'rgba(255,255,255,0.7)',
  },
  metricValue: {
    fontFamily: fonts.heading,
    color: palette.white,
    fontSize: 26,
    marginVertical: 6,
  },
  metricHint: {
    fontFamily: fonts.body,
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
  },
  sectionCard: {
    backgroundColor: 'rgba(13,18,30,0.85)',
    borderRadius: 28,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    marginBottom: 24,
  },
  sectionTitle: {
    fontFamily: fonts.heading,
    color: palette.white,
    fontSize: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionHint: {
    fontFamily: fonts.body,
    color: 'rgba(255,255,255,0.6)',
  },
  fieldGroup: {
    marginTop: 16,
  },
  fieldLabel: {
    fontFamily: fonts.bodyMedium,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
    letterSpacing: 1,
    marginBottom: 8,
  },
  input: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    padding: 14,
    color: palette.white,
    fontFamily: fonts.body,
  },
  textArea: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryPill: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  categoryPillActive: {
    backgroundColor: 'rgba(75,99,246,0.25)',
    borderColor: palette.indigo,
  },
  categoryPillText: {
    fontFamily: fonts.body,
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
  },
  categoryPillTextActive: {
    color: palette.white,
  },
  primaryButton: {
    backgroundColor: palette.teal,
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 18,
  },
  primaryButtonText: {
    fontFamily: fonts.bodyMedium,
    color: palette.obsidian,
    fontSize: 16,
  },
  threadChip: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginRight: 12,
    minWidth: 150,
  },
  threadChipActive: {
    borderColor: palette.indigo,
    backgroundColor: 'rgba(75,99,246,0.15)',
  },
  threadChipTitle: {
    fontFamily: fonts.bodyMedium,
    color: palette.white,
  },
  threadChipMeta: {
    fontFamily: fonts.body,
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
  },
  emptyState: {
    fontFamily: fonts.body,
    color: 'rgba(255,255,255,0.6)',
  },
  threadPanel: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 18,
    backgroundColor: 'rgba(9,12,24,0.7)',
  },
  threadHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  threadTitle: {
    fontFamily: fonts.heading,
    color: palette.white,
    fontSize: 18,
  },
  threadMeta: {
    fontFamily: fonts.body,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
  },
  threadStatus: {
    fontFamily: fonts.bodyMedium,
    color: palette.amber,
  },
  messageList: {
    maxHeight: 240,
    marginVertical: 8,
  },
  messageBubble: {
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
  },
  adminBubble: {
    backgroundColor: 'rgba(75,99,246,0.15)',
    alignSelf: 'flex-start',
  },
  userBubble: {
    backgroundColor: 'rgba(36,209,181,0.12)',
    alignSelf: 'flex-end',
  },
  messageBody: {
    fontFamily: fonts.body,
    color: palette.white,
  },
  messageMeta: {
    fontFamily: fonts.body,
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    marginTop: 4,
  },
  composerWrapper: {
    marginTop: 12,
  },
  composerInput: {
    minHeight: 80,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 12,
    color: palette.white,
    fontFamily: fonts.body,
    textAlignVertical: 'top',
  },
  suggestionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  suggestionCard: {
    flexBasis: '48%',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 14,
    backgroundColor: 'rgba(10,14,26,0.7)',
  },
  suggestionTitle: {
    fontFamily: fonts.bodyMedium,
    color: palette.white,
    marginBottom: 6,
  },
  suggestionBody: {
    fontFamily: fonts.body,
    color: 'rgba(255,255,255,0.65)',
    fontSize: 13,
  },
});
