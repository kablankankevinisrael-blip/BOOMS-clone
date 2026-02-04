import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  StyleSheet,
  Linking,
} from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import {
  paymentService,
  MobileMoneyFinancialDetails,
  DepositInitiationResponse,
} from '../services/payment';
import api from '../services/api';
import { PaymentMethod } from '../types/payments';

type DepositScreenProps = {
  navigation: StackNavigationProp<any>;
};

type MethodConfig = {
  key: PaymentMethod;
  icon: string;
  label: string;
  description: string;
  helper: string;
  subHelper?: string;
  requiresPhone: boolean;
  phoneLabel?: string;
  phonePlaceholder?: string;
  phoneRegex?: RegExp;
  phoneHelper?: string;
  supportedOperators?: string[];
  feeHighlights: string[];
  ctaLabel: string;
  requiresStripeKey?: boolean;
};

const METHOD_CONFIG: Record<PaymentMethod, MethodConfig> = {
  wave: {
    key: 'wave',
    icon: '📱',
    label: "Wave Côte d'Ivoire",
    description: 'Paiement mobile money sécurisée',
    helper: 'Idéal pour dépôts rapides locaux',
    subHelper: 'Orange CI • MTN CI • Moov CI',
    requiresPhone: true,
    phoneLabel: "Numéro Wave Côte d'Ivoire",
    phonePlaceholder: '07 12 34 56 78',
    phoneRegex: /^(07|05|01)[0-9]{8}$/,
    phoneHelper: 'Formats acceptés: 07 / 05 / 01 + 8 chiffres',
    supportedOperators: ['Orange Côte d’Ivoire', 'MTN Côte d’Ivoire', 'Moov Africa CI'],
    feeHighlights: [
      'Frais Wave estimés à ~1.5% (inclus dans le récapitulatif)',
      'Commission Booms calculée automatiquement lors du webhook',
      'Crédit immédiat dès confirmation Wave',
    ],
    ctaLabel: '📱 Payer avec Wave',
  },
  orange_money: {
    key: 'orange_money',
    icon: '🟠',
    label: 'Orange Money',
    description: 'Cash-in via API Orange Money CI',
    helper: 'Parfait pour les marchands Orange',
    subHelper: 'Code pays +225 pris en charge',
    requiresPhone: true,
    phoneLabel: 'Numéro Orange Money',
    phonePlaceholder: '07 00 00 00 00',
    phoneRegex: /^(07|05|01|27)[0-9]{8}$/,
    phoneHelper: 'Formats acceptés: 07 / 05 / 01 / 27 + 8 chiffres',
    supportedOperators: ['Orange Money Côte d’Ivoire'],
    feeHighlights: [
      'Frais Orange Money (~2%) gérés côté API',
      'Commission Booms stockée avec la transaction',
      'Validation à confirmer depuis votre application Orange Money',
    ],
    ctaLabel: '🟠 Payer avec Orange Money',
  },
  mtn_momo: {
    key: 'mtn_momo',
    icon: '🟡',
    label: 'MTN MoMo',
    description: 'Mobile Money MTN homologué',
    helper: 'Pour les comptes MTN MoMo Business',
    subHelper: 'Confirmation USSD ou app MTN',
    requiresPhone: true,
    phoneLabel: 'Numéro MTN MoMo',
    phonePlaceholder: '05 00 00 00 00',
    phoneRegex: /^(05|07|01|27)[0-9]{8}$/,
    phoneHelper: 'Formats acceptés: 05 / 07 / 01 / 27 + 8 chiffres',
    supportedOperators: ['MTN Mobile Money Côte d’Ivoire'],
    feeHighlights: [
      'Frais MTN MoMo (~2.5%) calculés via FeesConfig',
      'Commission plateforme créditée uniquement après webhook',
      'Instructions envoyées directement sur votre mobile MTN',
    ],
    ctaLabel: '🟡 Payer avec MTN MoMo',
  },
  stripe: {
    key: 'stripe',
    icon: '💳',
    label: 'Carte bancaire (Stripe)',
    description: 'Visa, Mastercard, etc.',
    helper: 'Idéal pour paiements internationaux',
    subHelper: 'Nécessite une carte compatible 3D Secure',
    requiresPhone: false,
    supportedOperators: ['Paiement international via Stripe'],
    feeHighlights: [
      'Frais Stripe estimés à ~3%',
      'PaymentIntent généré côté Booms (webhook pour finaliser)',
      'Interface carte à intégrer côté mobile',
    ],
    ctaLabel: '💳 Payer par carte',
    requiresStripeKey: true,
  },
};

const formatCurrency = (value: number): string =>
  `${parseFloat(value.toFixed(4)).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} FCFA`;

const prettyPhoneNumber = (value: string): string =>
  value.replace(/\s+/g, '').replace(/(.{2})/g, '$1 ').trim();

const formatFinancialDetails = (details?: MobileMoneyFinancialDetails): string => {
  if (!details) {
    return '';
  }

  const labelMap: Record<string, string> = {
    amount: 'Montant initial',
    net_to_user: 'Net crédité',
    provider_fee: 'Frais opérateur',
    orange_fee: 'Frais Orange',
    momo_fee: 'Frais MTN',
    your_commission: 'Commission Booms',
    total_fees: 'Total des frais',
  };

  const rows = Object.entries(details)
    .filter(([, value]) => typeof value === 'number' && !Number.isNaN(value))
    .map(([key, value]) => {
      const label = labelMap[key] || key.replace(/_/g, ' ');
      return `${label}: ${formatCurrency(value as number)}`;
    });

  if (!rows.length) {
    return '';
  }

  return `\n\nDétails financiers:\n${rows.join('\n')}`;
};

const sanitizePhone = (value: string): string => value.replace(/\s+/g, '');

const DepositScreen: React.FC<DepositScreenProps> = ({ navigation }) => {
  const [providerStatus, setProviderStatus] = useState<Record<PaymentMethod, boolean>>({
    wave: true,
    orange_money: true,
    mtn_momo: true,
    stripe: true,
  });
  const [stripePublishableKey, setStripePublishableKey] = useState('');

  const methodList = useMemo(() => Object.values(METHOD_CONFIG), []);

  const methodIsEnabled = useCallback(
    (method: PaymentMethod) => {
          if (method === 'stripe') {
        return providerStatus.stripe && Boolean(stripePublishableKey);
      }
      return providerStatus[method];
    },
    [providerStatus, stripePublishableKey]
  );

  const enabledMethods = useMemo(
    () => methodList.filter((method) => methodIsEnabled(method.key)),
    [methodList, methodIsEnabled]
  );
  const initialMethod = enabledMethods[0]?.key ?? methodList[0].key;

  const [amount, setAmount] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>(initialMethod);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchProviderStatus = async () => {
      try {
        const response = await api.get('/debug/payment-status');
        const availability = response.data?.payment_methods as
          | Partial<Record<PaymentMethod, boolean>>
          | undefined;

        if (availability) {
          setProviderStatus((prev) => ({ ...prev, ...availability }));
        }

        if (typeof response.data?.stripe_publishable_key === 'string') {
          setStripePublishableKey(response.data.stripe_publishable_key);
        }
      } catch (error) {
        console.warn('Impossible de récupérer la configuration des paiements', error);
      }
    };

    fetchProviderStatus();
  }, []);

  useEffect(() => {
    if (!methodIsEnabled(selectedMethod) && enabledMethods.length > 0) {
      setSelectedMethod(enabledMethods[0].key);
    }
  }, [enabledMethods, selectedMethod, methodIsEnabled]);

  useEffect(() => {
    setPhoneNumber('');
  }, [selectedMethod]);

  const currentMethod = methodIsEnabled(selectedMethod)
    ? selectedMethod
    : initialMethod;
  const currentConfig = METHOD_CONFIG[currentMethod];
  const requiresPhone = currentConfig.requiresPhone;
  const noMethodAvailable = enabledMethods.length === 0;
  const formattedAmount = amount ? formatCurrency(parseFloat(amount)) : '0 FCFA';

  const handleMethodPress = (method: MethodConfig) => {
    if (!methodIsEnabled(method.key)) {
      Alert.alert(
        'Service temporairement indisponible',
        `${method.label} est momentanément indisponible. Merci de réessayer un peu plus tard.`
      );
      return;
    }
    setSelectedMethod(method.key);
  };

  const handleProviderResponse = (
    response: DepositInitiationResponse,
    depositAmount: number,
    phone: string
  ) => {
    switch (response.method) {
      case 'wave': {
        const fees = formatFinancialDetails(
          (response as any).fees_analysis as MobileMoneyFinancialDetails
        );
        Alert.alert(
          "Wave Côte d'Ivoire",
          `Dépôt initié pour ${formatCurrency(depositAmount)}.\n\n` +
            `📱 Numéro: ${prettyPhoneNumber(phone)}\n` +
            'Confirmez la demande depuis l’application Wave.' +
            fees,
          [
            {
              text: 'Ouvrir Wave',
              onPress: () => {
                if (response.payment_url) {
                  Linking.openURL(response.payment_url).catch(() => {
                    Alert.alert(
                      'Lien indisponible',
                      "Impossible d'ouvrir le lien Wave. Copiez-le manuellement depuis votre historique."
                    );
                  });
                }
              },
            },
            {
              text: 'OK',
              onPress: () => navigation.goBack(),
            },
          ],
          { cancelable: false }
        );
        break;
      }
      case 'orange_money': {
        const message =
          `Dépôt Orange Money initié pour ${formatCurrency(depositAmount)}.` +
          `\n\n${response.instructions ?? 'Confirmez le paiement sur votre mobile Orange.'}` +
          formatFinancialDetails(response.financial_details);
        Alert.alert('Orange Money', message, [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
        break;
      }
      case 'mtn_momo': {
        const message =
          `Dépôt MTN MoMo initié pour ${formatCurrency(depositAmount)}.` +
          `\n\n${response.instructions ?? 'Validez la demande depuis MTN MoMo.'}` +
          formatFinancialDetails(response.financial_details);
        Alert.alert('MTN Mobile Money', message, [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
        break;
      }
      case 'stripe':
      default: {
        Alert.alert(
          'Paiement carte',
          'PaymentIntent Stripe créé. Le flux carte complet sera affiché dès l’intégration du widget Stripe dans cette application.'
        );
        break;
      }
    }
  };

  const handleDeposit = async () => {
    if (noMethodAvailable) {
      Alert.alert(
        'Service indisponible',
        'Aucun moyen de dépôt n’est disponible pour le moment. Merci de réessayer ultérieurement.'
      );
      return;
    }

    const depositAmount = parseFloat(amount);
    if (!depositAmount || Number.isNaN(depositAmount) || depositAmount <= 0) {
      Alert.alert('Montant invalide', 'Veuillez saisir un montant valide.');
      return;
    }

    if (depositAmount < 1000) {
      Alert.alert('Montant trop faible', 'Le montant minimum est de 1 000 FCFA.');
      return;
    }

    if (depositAmount > 1000000) {
      Alert.alert('Montant trop élevé', 'Le montant maximum est de 1 000 000 FCFA.');
      return;
    }

    const sanitizedPhone = sanitizePhone(phoneNumber);
    if (requiresPhone) {
      if (!sanitizedPhone) {
        Alert.alert('Numéro manquant', 'Merci de renseigner votre numéro mobile.');
        return;
      }

      if (currentConfig.phoneRegex && !currentConfig.phoneRegex.test(sanitizedPhone)) {
        Alert.alert('Format invalide', currentConfig.phoneHelper ?? 'Numéro mobile invalide.');
        return;
      }
    }

    setLoading(true);
    try {
      const response = await paymentService.initiateDeposit({
        amount: depositAmount,
        method: currentMethod,
        phone_number: requiresPhone ? sanitizedPhone : undefined,
      });

      handleProviderResponse(response, depositAmount, sanitizedPhone);
    } catch (error: any) {
      Alert.alert('Erreur', error.message || 'Échec du dépôt.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Alimenter mon portefeuille</Text>
        <Text style={styles.subtitle}>Choisissez la méthode qui vous convient</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Montant à déposer (FCFA)</Text>
        <TextInput
          style={styles.amountInput}
          placeholder="0"
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          maxLength={9}
        />
        <Text style={styles.helperText}>
          Minimum: 1 000 FCFA — Maximum: 1 000 000 FCFA
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Méthode de paiement</Text>
        {methodList.map((method) => {
          const enabled = methodIsEnabled(method.key);
          const isSelected = currentMethod === method.key && enabled;
          return (
            <TouchableOpacity
              key={method.key}
              style={[
                styles.methodButton,
                isSelected && styles.methodButtonSelected,
                !enabled && styles.methodButtonDisabled,
              ]}
              onPress={() => handleMethodPress(method)}
              disabled={loading}
            >
              <Text style={styles.methodIcon}>{method.icon}</Text>
              <View style={styles.methodInfo}>
                <Text style={styles.methodText}>{method.label}</Text>
                <Text style={styles.methodDescription}>{method.description}</Text>
                {method.helper && (
                  <Text style={styles.methodDescription}>{method.helper}</Text>
                )}
                {method.subHelper && (
                  <Text style={styles.waveInfo}>{method.subHelper}</Text>
                )}
                {method.supportedOperators && (
                  <Text style={styles.waveInfo}>
                    {method.supportedOperators.join(' • ')}
                  </Text>
                )}
                {!enabled && (
                  <Text style={styles.disabledReason}>
                    {method.label} est momentanément indisponible
                  </Text>
                )}
              </View>
              {isSelected && <Text style={styles.selectedIcon}>✅</Text>}
            </TouchableOpacity>
          );
        })}
      </View>

      {requiresPhone && (
        <View style={styles.section}>
          <Text style={styles.label}>{currentConfig.phoneLabel}</Text>
          <TextInput
            style={styles.input}
            placeholder={currentConfig.phonePlaceholder}
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            keyboardType="phone-pad"
            maxLength={12}
          />
          {currentConfig.phoneHelper && (
            <Text style={styles.helperText}>{currentConfig.phoneHelper}</Text>
          )}
          {currentConfig.supportedOperators && (
            <View style={styles.operatorInfo}>
              <Text style={styles.operatorTitle}>📶 Opérateurs supportés</Text>
              {currentConfig.supportedOperators.map((operator) => (
                <Text key={operator} style={styles.operatorText}>
                  • {operator}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}

      {noMethodAvailable && (
        <View style={styles.alertBox}>
          <Text style={styles.alertTitle}>Aucune méthode active</Text>
          <Text style={styles.alertText}>
            Aucun service de dépôt n’est disponible actuellement. Nous travaillons à rétablir la situation.
          </Text>
        </View>
      )}

      <View style={styles.feesInfo}>
        <Text style={styles.feesTitle}>💡 Informations frais</Text>
        {currentConfig.feeHighlights.map((line) => (
          <Text key={line} style={styles.feesText}>
            • {line}
          </Text>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.depositButton, (loading || noMethodAvailable) && styles.buttonDisabled]}
        onPress={handleDeposit}
        disabled={loading || noMethodAvailable || !amount}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.depositButtonText}>
            {currentConfig.ctaLabel} — {formattedAmount}
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.cancelButton}
        onPress={() => navigation.goBack()}
        disabled={loading}
      >
        <Text style={styles.cancelButtonText}>Annuler</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
    padding: 16,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
    marginTop: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
    color: '#333',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  section: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333',
  },
  amountInput: {
    fontSize: 32,
    fontWeight: 'bold',
    textAlign: 'center',
    color: '#667eea',
    borderBottomWidth: 2,
    borderBottomColor: '#667eea',
    paddingVertical: 8,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  helperText: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  methodButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    marginBottom: 8,
  },
  methodButtonSelected: {
    borderColor: '#667eea',
    backgroundColor: '#f0f4ff',
  },
  methodButtonDisabled: {
    opacity: 0.5,
  },
  methodIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  methodInfo: {
    flex: 1,
  },
  methodText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
  },
  methodDescription: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  waveInfo: {
    fontSize: 10,
    color: '#888',
    marginTop: 2,
    fontStyle: 'italic',
  },
  disabledReason: {
    fontSize: 12,
    color: '#b02a37',
    marginTop: 6,
  },
  selectedIcon: {
    fontSize: 16,
    color: '#28a745',
  },
  operatorInfo: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#ff6b35',
  },
  operatorTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 6,
  },
  operatorText: {
    fontSize: 12,
    color: '#666',
    marginBottom: 2,
  },
  alertBox: {
    backgroundColor: '#fff4e6',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#ff9f43',
  },
  alertTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#a76300',
    marginBottom: 4,
  },
  alertText: {
    fontSize: 14,
    color: '#7a5b25',
    lineHeight: 20,
  },
  feesInfo: {
    backgroundColor: '#e7f3ff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#1890ff',
  },
  feesTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1890ff',
    marginBottom: 8,
  },
  feesText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  depositButton: {
    backgroundColor: '#28a745',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  depositButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  cancelButton: {
    padding: 16,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#667eea',
    fontSize: 16,
    fontWeight: '500',
  },
});

export default DepositScreen;