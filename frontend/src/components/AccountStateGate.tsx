import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../contexts/AuthContext';
import supportService, { AccountStatusSnapshot } from '../services/support';
import { palette, gradients, fonts } from '../styles/theme';
import { navigationRef } from '../navigation/AppNavigator';

interface AccountStateGateProps {
  children: React.ReactNode;
}

const STATUS_LABELS: Record<string, { title: string; subtitle: string }> = {
  inactive: {
    title: 'Compte désactivé',
    subtitle: 'Votre compte est désactivé. Vous pouvez contacter le support pour obtenir plus d\'informations.'
  },
  suspended: {
    title: 'Compte temporairement désactivé',
    subtitle: 'Vous ne pouvez plus effectuer d\'opérations pendant la période indiquée.'
  },
  banned: {
    title: 'Compte désactivé définitivement',
    subtitle: 'Contacter l\'équipe support pour connaître les démarches possibles.'
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
  const { accountStatus, refreshAccountStatus, logout } = useAuth();
  const [localStatus, setLocalStatus] = useState<AccountStatusSnapshot | null>(accountStatus);
  const [appealMessage, setAppealMessage] = useState('');
  const [sendingAppeal, setSendingAppeal] = useState(false);
  const [appealFeedback, setAppealFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!accountStatus) {
      supportService
        .getAccountStatus()
        .then(setLocalStatus)
        .catch(() => undefined);
    } else {
      setLocalStatus(accountStatus);
    }
  }, [accountStatus]);

  const status = localStatus?.status?.toLowerCase();
  const isBlocking = Boolean(localStatus?.is_blocking) || status === 'inactive' || status === 'banned' || status === 'suspended';
  const countdown = useCountdown(localStatus?.suspended_until);

  const effectiveLabel = useMemo(() => {
    if (!status) return null;
    return STATUS_LABELS[status] || null;
  }, [status]);

  const handleAppeal = async () => {
    if (!appealMessage.trim()) {
      setAppealFeedback('Veuillez décrire brièvement votre situation.');
      return;
    }
    try {
      setSendingAppeal(true);
      setAppealFeedback(null);
      await supportService.submitBannedAppeal({ message: appealMessage.trim(), channel: 'mobile_app' });
      setAppealFeedback('Votre message a bien été transmis à l\'équipe support.');
      setAppealMessage('');
    } catch (error: any) {
      setAppealFeedback(error?.response?.data?.detail || 'Impossible d\'envoyer le message.');
    } finally {
      setSendingAppeal(false);
    }
  };

  const refreshStatus = async () => {
    await refreshAccountStatus();
  };

  const openSupportCenter = () => {
    if (navigationRef.isReady()) {
      navigationRef.navigate('SupportCenter');
    }
  };

  const handleSwitchAccount = async () => {
    await logout();
  };

  if (!status || status === 'active') {
    return <>{children}</>;
  }

  if (isBlocking && status !== 'suspended') {
    return (
        <LinearGradient colors={[...gradients.hero] as [string, string, ...string[]]} style={styles.blockWrapper}>
        <View style={styles.blockCard}>
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
            <Text style={styles.sectionLabel}>Contacter le support</Text>
            <TextInput
              style={styles.textArea}
              value={appealMessage}
              onChangeText={setAppealMessage}
              placeholder="Expliquez votre situation ou demandez des précisions"
              placeholderTextColor="rgba(255,255,255,0.6)"
              multiline
            />
            {appealFeedback && <Text style={styles.feedbackText}>{appealFeedback}</Text>}
            <TouchableOpacity style={styles.primaryButton} onPress={handleAppeal} disabled={sendingAppeal}>
              <Text style={styles.primaryButtonText}>{sendingAppeal ? 'Envoi en cours...' : 'Envoyer un message au support'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={openSupportCenter}>
              <Text style={styles.secondaryButtonText}>Ouvrir le support</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.ghostButton} onPress={handleSwitchAccount}>
              <Text style={styles.ghostButtonText}>Changer de compte</Text>
            </TouchableOpacity>
          </View>
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
    maxWidth: 420,
    backgroundColor: 'rgba(8,12,24,0.85)',
    borderRadius: 28,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)'
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
    minHeight: 100,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 14,
    color: palette.white,
    fontFamily: fonts.body,
    marginTop: 8,
  },
  feedbackText: {
    fontFamily: fonts.body,
    color: palette.amber,
    marginTop: 8,
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
