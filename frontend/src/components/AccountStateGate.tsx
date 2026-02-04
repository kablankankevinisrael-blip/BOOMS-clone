import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../contexts/AuthContext';
import supportService, { AccountStatusSnapshot, BannedMessage } from '../services/support';
import { palette, gradients, fonts } from '../styles/theme';
import { navigationRef } from '../navigation/AppNavigator';
import SupportCenterScreen from '../screens/SupportCenterScreen';

interface AccountStateGateProps {
  children: React.ReactNode;
}

const STATUS_LABELS: Record<string, { title: string; subtitle: string }> = {
  inactive: {
    title: 'Compte désactivé (temporaire)',
    subtitle: 'Désactivation temporaire. L’admin peut réactiver à tout moment.'
  },
  suspended: {
    title: 'Compte temporairement désactivé',
    subtitle: 'Vous ne pouvez plus effectuer d\'opérations pendant la période indiquée.'
  },
  banned: {
    title: 'Compte banni (72h)',
    subtitle: 'Bannissement temporaire. Sans réactivation sous 72h, le compte est auto‑supprimé.'
  },
  deleted: {
    title: 'Compte supprimé',
    subtitle: 'Compte supprimé définitivement de la base de données.'
  },
  limited: {
    title: 'Compte limité',
    subtitle: 'Certaines fonctionnalités sont temporairement verrouillées.'
  },
  review: {
    title: 'Compte en révision',
    subtitle: 'Nos équipes vérifient vos activités pour garantir votre sécurité.'
  }
};

const formatDate = (value?: string | null) => {
  if (!value) return null;
  try {
    return new Date(value).toLocaleString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return value;
  }
};

const useCountdown = (target?: string | null) => {
  const [remaining, setRemaining] = useState<string>('');
  useEffect(() => {
    if (!target) {
      setRemaining('');
      return;
    }
    const update = () => {
      const targetDate = new Date(target).getTime();
      const now = Date.now();
      const diff = Math.max(targetDate - now, 0);
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      setRemaining(`${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m ${seconds
        .toString()
        .padStart(2, '0')}s`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [target]);
  return remaining;
};

const InlineBanner = ({ status }: { status: AccountStatusSnapshot }) => {
  if (!status || ['active'].includes(status.status)) {
    return null;
  }

  const label = STATUS_LABELS[status.status] || STATUS_LABELS.limited;
  return (
    <View style={styles.inlineBanner}>
      <Text style={styles.inlineTitle}>{label.title}</Text>
      <Text style={styles.inlineSubtitle}>{status.status_message || label.subtitle}</Text>
    </View>
  );
};

export default function AccountStateGate({ children }: AccountStateGateProps) {
  const { accountStatus, refreshAccountStatus, logout, token } = useAuth();
  const [localStatus, setLocalStatus] = useState<AccountStatusSnapshot | null>(accountStatus);
  const [appealMessage, setAppealMessage] = useState('');
  const [sendingAppeal, setSendingAppeal] = useState(false);
  const [appealFeedback, setAppealFeedback] = useState<string | null>(null);
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [bannedMessages, setBannedMessages] = useState<BannedMessage[]>([]);
  const [loadingResponses, setLoadingResponses] = useState(false);
  const chatScrollRef = useRef<ScrollView | null>(null);
  const lastResponseSignatureRef = useRef<string>('');
  const [showSupportCenter, setShowSupportCenter] = useState(false);
  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(null);

  useEffect(() => {
    if (!accountStatus) {
      if (token) {
        refreshAccountStatus().catch(() => undefined);
      }
      return;
    }
    setLocalStatus(accountStatus);
  }, [accountStatus, refreshAccountStatus, token]);

  useEffect(() => {
    const loadContact = async () => {
      try {
        const storedUser = await AsyncStorage.getItem('booms_user');
        if (storedUser) {
          const parsed = JSON.parse(storedUser);
          if (parsed?.phone) setContactPhone(parsed.phone);
          if (parsed?.email) setContactEmail(parsed.email);
        }
        if (!contactPhone && !contactEmail) {
          const storedContact = await AsyncStorage.getItem('booms_contact');
          if (storedContact) {
            const parsed = JSON.parse(storedContact);
            if (parsed?.phone) setContactPhone(parsed.phone);
            if (parsed?.email) setContactEmail(parsed.email);
          }
        }
      } catch {
        // silencieux
      }
    };
    loadContact();
  }, []);

  const status = localStatus?.status?.toLowerCase();
  const isBlocking =
    Boolean(localStatus?.is_blocking) ||
    status === 'inactive' ||
    status === 'banned' ||
    status === 'suspended' ||
    status === 'deleted';
  const countdown = useCountdown(localStatus?.suspended_until);

  const effectiveLabel = useMemo(() => {
    if (!status) return null;
    return STATUS_LABELS[status] || null;
  }, [status]);

  const sortedMessages = useMemo(() => {
    return [...bannedMessages].sort((a, b) => {
      const aTime = a.created_at ? Date.parse(a.created_at) : 0;
      const bTime = b.created_at ? Date.parse(b.created_at) : 0;
      return aTime - bTime;
    });
  }, [bannedMessages]);

  const loadResponses = async () => {
    const phone = contactPhone.trim();
    const email = contactEmail.trim();
    if (!phone && !email) return;
    try {
      setLoadingResponses(true);
      const data = await supportService.getPublicBannedMessages({ phone, email });
      const signature = data
        .map((msg) => `${msg.id}:${msg.admin_response || ''}`)
        .join('|');
      if (signature !== lastResponseSignatureRef.current) {
        lastResponseSignatureRef.current = signature;
        setBannedMessages(data);
      }
    } catch {
      // silencieux
    } finally {
      setLoadingResponses(false);
    }
  };

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isBlocking) {
      loadResponses();
      interval = setInterval(loadResponses, 30000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isBlocking, contactPhone, contactEmail]);

  const handleAppeal = async () => {
    if (!appealMessage.trim()) {
      setAppealFeedback('Veuillez décrire brièvement votre situation.');
      return;
    }
    try {
      console.log('📨 [SUPPORT-PANEL] Préparation envoi message');
      setSendingAppeal(true);
      setAppealFeedback(null);
      let userPhone: string | undefined;
      let userEmail: string | undefined;
      try {
        const storedUser = await AsyncStorage.getItem('booms_user');
        if (storedUser) {
          const parsed = JSON.parse(storedUser);
          userPhone = parsed?.phone;
          userEmail = parsed?.email;
        }
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

      userPhone = (userPhone || contactPhone.trim()).trim();
      userEmail = (userEmail || contactEmail.trim()).trim();

      console.log('📨 [SUPPORT-PANEL] Contact résolu', {
        hasPhone: !!userPhone,
        hasEmail: !!userEmail,
        phonePreview: userPhone ? `${userPhone}` : null,
        emailPreview: userEmail ? `${userEmail}` : null,
      });

      if (!userPhone && !userEmail) {
        setAppealFeedback('Téléphone ou email requis pour contacter le support.');
        return;
      }

      try {
        await AsyncStorage.setItem('booms_contact', JSON.stringify({ phone: userPhone, email: userEmail }));
      } catch {
        // silencieux
      }

      console.log('📨 [SUPPORT-PANEL] Envoi vers /support/banned-messages');
      await supportService.submitBannedAppeal({
        message: appealMessage.trim(),
        channel: 'mobile_app',
        user_phone: userPhone,
        user_email: userEmail,
      });
      setAppealFeedback('Votre message a bien été transmis à l\'équipe support.');
      setAppealMessage('');
      await loadResponses();
      console.log('✅ [SUPPORT-PANEL] Message envoyé');
    } catch (error: any) {
      console.error('❌ [SUPPORT-PANEL] Erreur envoi', error?.response?.data || error?.message);
      const detail = error?.response?.data?.detail;
      setAppealFeedback(
        typeof detail === 'string'
          ? detail
          : 'Impossible d\'envoyer le message.'
      );
    } finally {
      setSendingAppeal(false);
    }
  };

  const refreshStatus = async () => {
    await refreshAccountStatus();
  };

  const openSupportCenter = () => {
    setShowSupportCenter(true);
  };

  const handleSwitchAccount = async () => {
    await logout();
  };

  if (showSupportCenter) {
    return (
      <View style={styles.supportWrapper}>
        <SupportCenterScreen />
        <TouchableOpacity style={styles.supportBackButton} onPress={() => setShowSupportCenter(false)}>
          <Text style={styles.supportBackText}>Retour</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!status || status === 'active') {
    return <>{children}</>;
  }

  if (isBlocking && status !== 'suspended') {
    return (
        <LinearGradient colors={[...gradients.hero] as [string, string, ...string[]]} style={styles.blockWrapper}>
        <View style={styles.blockCard}>
          <ScrollView contentContainerStyle={styles.blockScrollContent} showsVerticalScrollIndicator={false}>
            <Text style={styles.blockEmoji}>{status === 'banned' || status === 'inactive' ? '⛔' : '⚠️'}</Text>
            <Text style={styles.blockTitle}>{effectiveLabel?.title || localStatus?.status_label || 'Compte désactivé'}</Text>
            <Text style={styles.blockSubtitle}>{localStatus?.status_message || effectiveLabel?.subtitle}</Text>
            <View style={styles.blockSection}>
              <Text style={styles.sectionLabel}>Motif communiqué</Text>
              <Text style={styles.sectionValue}>{localStatus?.status_reason || 'Non communiqué'}</Text>
              {localStatus?.last_status_changed_at && (
                <Text style={styles.sectionMeta}>Décision mise à jour le {formatDate(localStatus.last_status_changed_at)}</Text>
              )}
            </View>
            <View style={styles.blockSection}>
              <Text style={styles.sectionLabel}>Support (chat)</Text>
              <View style={styles.chatHeader}>
                <TextInput
                  style={styles.input}
                  value={contactPhone}
                  onChangeText={setContactPhone}
                  placeholder="Téléphone"
                  placeholderTextColor="rgba(255,255,255,0.6)"
                  keyboardType="phone-pad"
                  editable={!contactPhone}
                />
                <TextInput
                  style={[styles.input, { marginTop: 10 }]}
                  value={contactEmail}
                  onChangeText={setContactEmail}
                  placeholder="Email"
                  placeholderTextColor="rgba(255,255,255,0.6)"
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>

              <ScrollView
                ref={chatScrollRef}
                style={styles.chatContainer}
                contentContainerStyle={styles.chatContent}
                nestedScrollEnabled
                onContentSizeChange={() => chatScrollRef.current?.scrollToEnd({ animated: true })}
              >
                {sortedMessages.length === 0 && (
                  <Text style={styles.chatEmpty}>Aucun message pour le moment.</Text>
                )}
                {sortedMessages.map((msg) => (
                  <View key={msg.id}>
                    <TouchableOpacity
                      onPress={() =>
                        setExpandedMessageId((current) =>
                          current === `u-${msg.id}` ? null : `u-${msg.id}`
                        )
                      }
                      style={[styles.chatBubble, styles.chatBubbleUser]}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.chatText}>{msg.message}</Text>
                      <Text style={styles.chatMeta}>Vous</Text>
                      {expandedMessageId === `u-${msg.id}` && msg.created_at && (
                        <Text style={styles.chatMeta}>
                          {new Date(msg.created_at).toLocaleString('fr-FR')}
                        </Text>
                      )}
                    </TouchableOpacity>
                    {msg.admin_response && (
                      <TouchableOpacity
                        onPress={() =>
                          setExpandedMessageId((current) =>
                            current === `a-${msg.id}` ? null : `a-${msg.id}`
                          )
                        }
                        style={[styles.chatBubble, styles.chatBubbleAdmin]}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.chatText}>{msg.admin_response}</Text>
                        <Text style={styles.chatMeta}>Support</Text>
                        {expandedMessageId === `a-${msg.id}` && msg.created_at && (
                          <Text style={styles.chatMeta}>
                            {new Date(msg.created_at).toLocaleString('fr-FR')}
                          </Text>
                        )}
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </ScrollView>
              <View style={styles.chatComposer}>
                <TextInput
                  style={styles.textArea}
                  value={appealMessage}
                  onChangeText={setAppealMessage}
                  placeholder="Écrivez votre message..."
                  placeholderTextColor="rgba(255,255,255,0.6)"
                  multiline
                />
                {appealFeedback && <Text style={styles.feedbackText}>{appealFeedback}</Text>}
                <View style={styles.chatActions}>
                  <TouchableOpacity style={styles.primaryButton} onPress={handleAppeal} disabled={sendingAppeal}>
                    <Text style={styles.primaryButtonText}>{sendingAppeal ? 'Envoi...' : 'Envoyer'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.secondaryButton} onPress={loadResponses} disabled={loadingResponses}>
                    <Text style={styles.secondaryButtonText}>
                      {loadingResponses ? 'Actualisation...' : 'Actualiser'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.chatActionsRow}>
                <TouchableOpacity style={[styles.secondaryButton, styles.actionButton]} onPress={openSupportCenter}>
                  <Text style={styles.secondaryButtonText}>Ouvrir le support</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.ghostButton, styles.actionButton]} onPress={handleSwitchAccount}>
                  <Text style={styles.ghostButtonText}>Changer de compte</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </LinearGradient>
    );
  }

  if (status === 'suspended') {
    return (
        <LinearGradient colors={[...gradients.hero] as [string, string, ...string[]]} style={styles.blockWrapper}>
        <View style={styles.blockCard}>
          <Text style={styles.blockEmoji}>🕒</Text>
          <Text style={styles.blockTitle}>{effectiveLabel?.title || 'Compte suspendu'}</Text>
          <Text style={styles.blockSubtitle}>{localStatus?.status_message || effectiveLabel?.subtitle}</Text>
          <View style={styles.countdownCard}>
            <Text style={styles.sectionLabel}>Réactivation automatique</Text>
            <Text style={styles.countdownText}>{countdown || 'En attente...'}</Text>
            {localStatus?.suspended_until && (
              <Text style={styles.sectionMeta}>Fin prévue le {formatDate(localStatus.suspended_until)}</Text>
            )}
          </View>
          <TouchableOpacity style={styles.secondaryButton} onPress={refreshStatus}>
            <Text style={styles.secondaryButtonText}>Actualiser le statut</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.primaryButton} onPress={openSupportCenter}>
            <Text style={styles.primaryButtonText}>Contacter le support</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.ghostButton} onPress={handleSwitchAccount}>
            <Text style={styles.ghostButtonText}>Changer de compte</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.graphite }}>
      {localStatus && <InlineBanner status={localStatus} />}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  blockWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  blockCard: {
    width: '100%',
    maxWidth: 560,
    backgroundColor: 'transparent',
    borderRadius: 28,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    maxHeight: '92%'
  },
  blockScrollContent: {
    paddingBottom: 16,
  },
  blockEmoji: {
    fontSize: 42,
    textAlign: 'center',
    marginBottom: 12,
  },
  blockTitle: {
    fontFamily: fonts.heading,
    fontSize: 24,
    color: palette.white,
    textAlign: 'center',
  },
  blockSubtitle: {
    fontFamily: fonts.body,
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  blockSection: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
  },
  sectionLabel: {
    fontFamily: fonts.bodyMedium,
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontSize: 12,
    marginBottom: 6,
  },
  sectionValue: {
    fontFamily: fonts.heading,
    color: palette.white,
    fontSize: 16,
    lineHeight: 22,
  },
  sectionMeta: {
    fontFamily: fonts.body,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    marginTop: 8,
  },
  textArea: {
    minHeight: 80,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 14,
    color: palette.white,
    fontFamily: fonts.body,
    marginTop: 8,
  },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 14,
    color: palette.white,
    fontFamily: fonts.body,
    marginTop: 8,
  },
  chatHeader: {
    marginBottom: 10,
  },
  chatContainer: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 16,
    padding: 14,
    marginTop: 10,
    height: 300,
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
  chatActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
    justifyContent: 'space-between',
  },
  chatActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    alignItems: 'stretch',
    flexWrap: 'wrap',
  },
  supportWrapper: {
    flex: 1,
  },
  supportBackButton: {
    position: 'absolute',
    top: 48,
    left: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  supportBackText: {
    color: palette.white,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
  },
  actionButton: {
    flexGrow: 1,
    flexBasis: '48%',
    minWidth: 140,
  },
  chatComposer: {
    marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  feedbackText: {
    fontFamily: fonts.body,
    color: palette.amber,
    marginTop: 8,
  },
  responseCard: {
    marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  responseText: {
    fontFamily: fonts.body,
    color: palette.white,
    marginTop: 6,
  },
  responseCard: {
    marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  responseText: {
    fontFamily: fonts.body,
    color: palette.white,
    marginTop: 6,
  },
  primaryButton: {
    backgroundColor: palette.teal,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  primaryButtonText: {
    fontFamily: fonts.bodyMedium,
    color: palette.obsidian,
    fontSize: 16,
  },
  secondaryButton: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    marginBottom: 12,
  },
  ghostButton: {
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    marginTop: 8,
  },
  secondaryButtonText: {
    fontFamily: fonts.bodyMedium,
    color: palette.white,
    fontSize: 16,
  },
  ghostButtonText: {
    fontFamily: fonts.bodyMedium,
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
  },
  countdownCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 16,
    marginBottom: 18,
  },
  countdownText: {
    fontFamily: fonts.heading,
    color: palette.amber,
    fontSize: 28,
  },
  inlineBanner: {
    backgroundColor: '#1E2A44',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)'
  },
  inlineTitle: {
    fontFamily: fonts.heading,
    color: palette.amber,
    fontSize: 15,
  },
  inlineSubtitle: {
    fontFamily: fonts.body,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 4,
    fontSize: 13,
  },
});
