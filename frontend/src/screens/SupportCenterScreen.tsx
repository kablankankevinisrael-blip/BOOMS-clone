import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../contexts/AuthContext';
import supportService, {
  SupportThread,
  SuggestedTemplate,
  BannedMessage,
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
  const { accountStatus, isAuthenticated, user, token } = useAuth();
  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [selectedThread, setSelectedThread] = useState<SupportThread | null>(null);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [composer, setComposer] = useState('');
  const [suggestions, setSuggestions] = useState<SuggestedTemplate[]>([]);
  const [draft, setDraft] = useState({ subject: '', category: 'general', message: '' });
  const [supportFeedback, setSupportFeedback] = useState<string | null>(null);
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [publicResponses, setPublicResponses] = useState<BannedMessage[]>([]);
  const [refreshingPublic, setRefreshingPublic] = useState(false);
  const [refreshingThreads, setRefreshingThreads] = useState(false);
  const threadChatRef = useRef<ScrollView | null>(null);
  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(null);

  const normalize = (value?: string | null) => (value || '').toLowerCase();
  const isAccountBlocked =
    Boolean(accountStatus?.is_blocking) ||
    ['banned', 'suspended', 'inactive', 'deleted'].includes(normalize(accountStatus?.status));
  const canUseThreads = Boolean(token) && isAuthenticated && !isAccountBlocked;
  const isGuestSupport = !token && !isAccountBlocked;

  const badgeConfig = useMemo(() => {
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
      const isCritical = status === 'banned' || status === 'suspended' || status === 'deleted';
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

  const chatItems = useMemo(() => {
    if (!canUseThreads) {
      return publicResponses
        .slice()
        .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
        .flatMap((msg) => {
          const items = [{ id: `u-${msg.id}`, role: 'user', text: msg.message, at: msg.created_at }];
          if (msg.admin_response) {
            items.push({ id: `a-${msg.id}`, role: 'admin', text: msg.admin_response, at: msg.created_at });
          }
          return items;
        });
    }

    if (!selectedThread?.messages?.length) {
      return [] as Array<{ id: string; role: 'user' | 'admin'; text: string; at: string }>;
    }

    return selectedThread.messages
      .slice()
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
      .map((message) => ({
        id: `t-${message.id}`,
        role: message.sender_type === 'admin' ? 'admin' : 'user',
        text: message.body,
        at: message.created_at,
      }));
  }, [canUseThreads, publicResponses, selectedThread?.messages]);

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

  const refreshThreads = useCallback(async () => {
    if (!canUseThreads) return;
    try {
      setRefreshingThreads(true);
      const data = await supportService.listThreads('mine');
      setThreads(data);
      const nextId = selectedThread?.id || data[0]?.id;
      if (nextId) {
        const detail = await supportService.getThread(nextId);
        setSelectedThread(detail);
      }
    } catch (error) {
      console.error('❌ [SUPPORT] Erreur refresh threads', error);
    } finally {
      setRefreshingThreads(false);
    }
  }, [canUseThreads, selectedThread?.id]);

  useEffect(() => {
    supportService.getSuggestedMessages().then(setSuggestions).catch(() => setSuggestions([]));
  }, []);

  const refreshPublicResponses = useCallback(async () => {
    const phone = contactPhone.trim();
    const email = contactEmail.trim();
    const channel = isAccountBlocked ? 'mobile_app' : 'guest';
    if (!phone && !email) return;
    try {
      setRefreshingPublic(true);
      const data = await supportService.getPublicBannedMessages({ phone, email, channel });
      setPublicResponses(data);
    } catch {
      // silencieux
    } finally {
      setRefreshingPublic(false);
    }
  }, [contactPhone, contactEmail]);

  useEffect(() => {
    if (!canUseThreads) {
      refreshPublicResponses();
    }
  }, [canUseThreads, refreshPublicResponses]);

  useEffect(() => {
    if (canUseThreads) return;
    const phone = contactPhone.trim();
    const email = contactEmail.trim();
    if (!phone && !email) return;

    const interval = setInterval(() => {
      refreshPublicResponses();
    }, 30000);

    return () => clearInterval(interval);
  }, [canUseThreads, contactPhone, contactEmail, refreshPublicResponses]);

  useEffect(() => {
    const loadContact = async () => {
      try {
        if (isAuthenticated && token) {
          const storedUser = await AsyncStorage.getItem('booms_user');
          if (storedUser) {
            const parsed = JSON.parse(storedUser);
            setContactPhone(parsed?.phone || '');
            setContactEmail(parsed?.email || '');
            return;
          }
        }

        const storedContact = await AsyncStorage.getItem('booms_contact');
        if (storedContact) {
          const parsed = JSON.parse(storedContact);
          setContactPhone(parsed?.phone || '');
          setContactEmail(parsed?.email || '');
        }
      } catch {
        // silencieux
      }
    };
    loadContact();
  }, [isAuthenticated, token]);

  useEffect(() => {
    if (!canUseThreads) {
      setThreads([]);
      setSelectedThread(null);
      setLoadingThreads(false);
      return;
    }
    loadThreads();
  }, [canUseThreads, loadThreads]);

  useEffect(() => {
    if (!canUseThreads) return;
    const interval = setInterval(() => {
      refreshThreads();
    }, 30000);
    return () => clearInterval(interval);
  }, [canUseThreads, refreshThreads]);

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

  const handleSendChat = async () => {
    if (!composer.trim()) return;
    try {
      setSendingMessage(true);
      setSupportFeedback(null);

      if (!canUseThreads) {
        let userPhone: string | undefined = contactPhone.trim();
        let userEmail: string | undefined = contactEmail.trim();
        try {
          if (!userPhone && !userEmail) {
            const storedContact = await AsyncStorage.getItem('booms_contact');
            if (storedContact) {
              const parsed = JSON.parse(storedContact);
              userPhone = parsed?.phone;
              userEmail = parsed?.email;
            }
          }
        } catch {
          // silencieux
        }

        if (!userPhone && !userEmail) {
          setSupportFeedback('Téléphone ou email requis pour contacter le support.');
          return;
        }

        try {
          await AsyncStorage.setItem('booms_contact', JSON.stringify({ phone: userPhone, email: userEmail }));
        } catch {
          // silencieux
        }

        const created = await supportService.submitBannedAppeal({
          message: composer.trim(),
          channel: isAccountBlocked ? 'mobile_app' : 'guest',
          user_phone: userPhone,
          user_email: userEmail,
        });
        if (created?.id) {
          setPublicResponses((prev) => {
            const merged = [...prev, created];
            return merged.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
          });
        }
        setComposer('');
        setSupportFeedback('Votre message a bien été transmis à l\'équipe support.');
        await refreshPublicResponses();
        return;
      }

      if (selectedThread) {
        await supportService.postMessage(selectedThread.id, { message: composer.trim() });
        setComposer('');
        await selectThread(selectedThread.id);
        return;
      }

      const created = await supportService.createThread({
        subject: 'Support mobile',
        category: 'general',
        message: composer.trim(),
      });
      setComposer('');
      await loadThreads(created.id);
    } catch (error) {
      console.error('❌ [SUPPORT] Erreur envoi message', (error as any)?.response?.data || error);
      const detail = (error as any)?.response?.data?.detail;
      setSupportFeedback(
        typeof detail === 'string' ? detail : 'Impossible d\'envoyer le message.'
      );
    } finally {
      setSendingMessage(false);
    }
  };

  const handleSendMessage = async () => {
    if (!selectedThread || !composer.trim()) return;
      if (!canUseThreads) {
      setSupportFeedback('Connexion requise pour répondre à un ticket.');
      return;
    }
    try {
      setSendingMessage(true);
      await supportService.postMessage(selectedThread.id, { message: composer.trim() });
      setComposer('');
      await selectThread(selectedThread.id);
    } catch (error) {
      console.error('❌ [SUPPORT] Erreur envoi message', error);
      const detail = (error as any)?.response?.data?.detail;
      setSupportFeedback(
        typeof detail === 'string' ? detail : 'Impossible d\'envoyer le message.'
      );
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

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Support (chat)</Text>
            {!canUseThreads && (
              <TouchableOpacity
                onPress={refreshPublicResponses}
                style={styles.refreshButton}
                disabled={refreshingPublic}
              >
                {refreshingPublic ? (
                  <ActivityIndicator size="small" color={palette.white} />
                ) : (
                  <Text style={styles.refreshButtonText}>Actualiser</Text>
                )}
              </TouchableOpacity>
            )}
            {canUseThreads && (
              <TouchableOpacity
                onPress={refreshThreads}
                style={styles.refreshButton}
                disabled={refreshingThreads}
              >
                {refreshingThreads ? (
                  <ActivityIndicator size="small" color={palette.white} />
                ) : (
                  <Text style={styles.refreshButtonText}>Actualiser</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
          {!canUseThreads && (
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Contact (téléphone ou email)</Text>
              {isGuestSupport && (
                <Text style={styles.guestHint}>Accès invité : vos messages seront traités par le support.</Text>
              )}
              <TextInput
                style={styles.input}
                value={contactPhone}
                onChangeText={setContactPhone}
                placeholder="Téléphone"
                placeholderTextColor="rgba(255,255,255,0.4)"
                keyboardType="phone-pad"
              />
              <TextInput
                style={[styles.input, { marginTop: 10 }]}
                value={contactEmail}
                onChangeText={setContactEmail}
                placeholder="Email"
                placeholderTextColor="rgba(255,255,255,0.4)"
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>
          )}

          <ScrollView
            ref={threadChatRef}
            style={styles.chatContainer}
            contentContainerStyle={styles.chatContent}
            nestedScrollEnabled
            onContentSizeChange={() => threadChatRef.current?.scrollToEnd({ animated: true })}
          >
            {chatItems.length === 0 && (
              <Text style={styles.chatEmpty}>Aucun message pour le moment.</Text>
            )}
            {chatItems.map((msg) => (
              <View key={msg.id}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() =>
                    setExpandedMessageId((current) =>
                      current === msg.id ? null : msg.id
                    )
                  }
                  style={[
                    styles.chatBubble,
                    msg.role === 'admin' ? styles.chatBubbleAdmin : styles.chatBubbleUser,
                  ]}
                >
                  <Text style={styles.chatText}>{msg.text}</Text>
                  <Text style={styles.chatMeta}>{msg.role === 'admin' ? 'Support' : 'Vous'}</Text>
                  {expandedMessageId === msg.id && (
                    <Text style={styles.chatMeta}>
                      {new Date(msg.at).toLocaleString('fr-FR')}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>

          <View style={styles.chatComposer}>
            <TextInput
              style={styles.textArea}
              value={composer}
              multiline
              onChangeText={setComposer}
              placeholder="Écrire un message"
              placeholderTextColor="rgba(255,255,255,0.4)"
            />
            {supportFeedback && (
              <Text style={styles.feedbackText}>{supportFeedback}</Text>
            )}
            <View style={styles.chatFooter}>
              {!!suggestions.length && (
                <View style={styles.suggestionRow}>
                  {suggestions.slice(0, 4).map((template) => (
                    <TouchableOpacity key={template.title} onPress={() => applyTemplate(template.template)}>
                      <Text style={styles.suggestionPill}>{template.title}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <TouchableOpacity style={[styles.primaryButton, styles.sendButton]} onPress={handleSendChat} disabled={sendingMessage}>
                <Text style={styles.primaryButtonText}>{sendingMessage ? 'Envoi...' : 'Envoyer'}</Text>
              </TouchableOpacity>
            </View>
          </View>
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
    backgroundColor: 'transparent',
    borderRadius: 28,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
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
  refreshButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  refreshButtonText: {
    fontFamily: fonts.bodyMedium,
    color: palette.white,
    fontSize: 12,
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
  guestHint: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    marginBottom: 8,
  },
  textArea: {
    minHeight: 88,
    textAlignVertical: 'top',
    color: palette.white,
    fontFamily: fonts.body,
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
  feedbackText: {
    fontFamily: fonts.body,
    color: palette.amber,
    marginTop: 12,
  },
  chatContainer: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    padding: 14,
    marginTop: 12,
    height: 420,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  chatContent: {
    paddingBottom: 8,
  },
  chatEmpty: {
    fontFamily: fonts.body,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    paddingVertical: 12,
  },
  chatBubble: {
    maxWidth: '85%',
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  chatBubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(0, 199, 167, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(0, 199, 167, 0.35)',
  },
  chatBubbleAdmin: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  chatText: {
    fontFamily: fonts.body,
    color: palette.white,
    fontSize: 14,
    lineHeight: 20,
  },
  chatMeta: {
    marginTop: 6,
    fontFamily: fonts.body,
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
  },
  chatComposer: {
    marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  chatFooter: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sendButton: {
    alignSelf: 'flex-end',
    paddingHorizontal: 18,
  },
  suggestionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    flex: 1,
  },
  suggestionPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    fontFamily: fonts.bodyMedium,
  },
  responseCard: {
    marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  responseText: {
    fontFamily: fonts.body,
    color: palette.white,
    marginTop: 6,
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
