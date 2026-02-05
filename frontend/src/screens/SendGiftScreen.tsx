import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RouteProp } from '@react-navigation/native';
import { giftService, GiftRequest } from '../services/gift';
import { contactsService, UserSearchResult } from '../services/contacts';
import { useAuth } from '../contexts/AuthContext';
import { boomsService, Boom } from '../services/boms';

type RootStackParamList = {
  SendGift: { bomId: number; bomTitle: string; bomImageUrl?: string };
};

type SendGiftScreenNavigationProp = StackNavigationProp<RootStackParamList, 'SendGift'>;
type SendGiftScreenRouteProp = RouteProp<RootStackParamList, 'SendGift'>;

interface Props {
  navigation: SendGiftScreenNavigationProp;
  route: SendGiftScreenRouteProp;
}

const SendGiftScreen: React.FC<Props> = ({ navigation, route }) => {
  const { bomId, bomTitle, bomImageUrl } = route.params;
  const { user } = useAuth();
  const scrollRef = useRef<ScrollView>(null);
  const [messageFocused, setMessageFocused] = useState(false);
  
  const [receiverPhone, setReceiverPhone] = useState('');
  const [message, setMessage] = useState('');
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [contacts, setContacts] = useState<UserSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [boomDetails, setBoomDetails] = useState<Boom | null>(null);
  const [loadingBoom, setLoadingBoom] = useState(true);

  useEffect(() => {
    loadContacts();
  }, []);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => {
      setMessageFocused(true);
      setTimeout(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      }, 50);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setMessageFocused(false);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    const fetchBoomDetails = async () => {
      try {
        setLoadingBoom(true);
        const boom = await boomsService.getBoomDetails(bomId);
        setBoomDetails(boom);
      } catch (error) {
        console.error('Erreur chargement BOOM:', error);
        setBoomDetails(null);
      } finally {
        setLoadingBoom(false);
      }
    };

    fetchBoomDetails();
  }, [bomId]);

  const loadContacts = async () => {
    try {
      const userContacts = await contactsService.getContacts();
      const contactsData = userContacts.map(contact => ({
        id: contact.contact_user_id,
        phone: contact.contact_phone,
        full_name: contact.contact_name,
      }));
      setContacts(contactsData);
    } catch (error) {
      console.error('Erreur chargement contacts:', error);
    }
  };

  const searchUsers = async (phone: string) => {
    if (phone.length < 3) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const results = await contactsService.searchUsers(phone);
      setSearchResults(results.filter(result => result.phone !== user?.phone));
    } catch (error) {
      console.error('Erreur recherche:', error);
    } finally {
      setSearching(false);
    }
  };

  const handleSendGift = async () => {
    setErrorMessage(null);
    if (!receiverPhone.trim()) {
      setErrorMessage('Veuillez saisir un numéro de téléphone valide pour le destinataire.');
      return;
    }

    setLoading(true);
    try {
      const giftData: GiftRequest = {
        receiver_phone: receiverPhone.trim(),
        bom_id: bomId,
        quantity: 1,
        message: message.trim() || undefined,
      };

      await giftService.sendGift(giftData);
      
      Alert.alert(
        'Succès',
        'Cadeau envoyé avec succès!',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message;
      let messageText = 'Erreur lors de l\'envoi du cadeau';
      if (typeof detail === 'string') {
        const normalized = detail.toLowerCase();
        if (normalized.includes('destinataire') && normalized.includes('actif')) {
          messageText =
            'Le destinataire est inactif ou supprimé et ne peut pas recevoir de cadeau pour le moment.\n\n' +
            'Vérifiez que :\n' +
            '• le numéro est correct,\n' +
            '• le compte est bien actif,\n' +
            '• le destinataire n’a pas été supprimé.\n\n' +
            'Si besoin, demandez au destinataire de se reconnecter ou contactez le support.';
        } else {
          messageText = detail;
        }
      }
      setErrorMessage(messageText);
    } finally {
      setLoading(false);
    }
  };

  const selectUser = (user: UserSearchResult) => {
    setReceiverPhone(user.phone);
    setSearchResults([]);
  };

  const safeNumber = (value?: number | null) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  };

  const formatCurrency = (value: number) => {
    const amount = safeNumber(value);
    return `${parseFloat(amount.toFixed(4)).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} FCFA`;
  };

  const handleMessageFocus = () => {
    setMessageFocused(true);
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 150);
  };

  const handleMessageBlur = () => {
    setMessageFocused(false);
  };

  const microUnitValue = boomDetails
    ? safeNumber(
        boomDetails.current_social_value ??
        boomDetails.social_delta ??
        boomDetails.social_value
      )
    : 0;
  const baseUnitValue = boomDetails
    ? safeNumber(
        boomDetails.base_value ??
        boomDetails.purchase_price ??
        (boomDetails.value - microUnitValue)
      )
    : 0;
  const totalUnitValue = baseUnitValue + microUnitValue;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 30}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.container}
        contentContainerStyle={[styles.scrollContent, messageFocused && styles.keyboardSpacer]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
        <Text style={styles.title}>Envoyer un cadeau</Text>

        {errorMessage && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorTitle}>Envoi impossible</Text>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        )}
        
        {/* Produit */}
        <View style={styles.productInfo}>
          {bomImageUrl && (
            <Image source={{ uri: bomImageUrl }} style={styles.productImage} />
          )}
          <View style={styles.productDetails}>
            <Text style={styles.productTitle}>{bomTitle}</Text>
            <Text style={styles.productId}>ID: {bomId}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Valeur du cadeau</Text>
          {loadingBoom ? (
            <View style={styles.valueLoadingRow}>
              <ActivityIndicator size="small" color="#667eea" />
              <Text style={styles.valueLoadingText}>Calcul des montants...</Text>
            </View>
          ) : (
            <View style={styles.valueBreakdownRow}>
              <View style={styles.valueBadge}>
                <Text style={styles.valueBadgeLabel}>Valeur de base</Text>
                <Text style={styles.valueBadgeValue}>{formatCurrency(baseUnitValue)}</Text>
              </View>
              <View style={styles.valueBadge}>
                <Text style={styles.valueBadgeLabel}>Bonus social</Text>
                <Text style={styles.valueBadgeValue}>{formatCurrency(microUnitValue)}</Text>
              </View>
              <View style={[styles.valueBadge, styles.valueBadgeHighlight]}>
                <Text style={styles.valueBadgeLabel}>Total</Text>
                <Text style={styles.valueBadgeValue}>{formatCurrency(totalUnitValue)}</Text>
              </View>
            </View>
          )}
          {boomDetails && !loadingBoom && (
            <Text style={styles.valueHint}>
              {microUnitValue > 0
                ? 'Chaque BOOM inclut automatiquement le bonus micro-impact actif.'
                : 'Ce BOOM ne possède pas encore de bonus social actif.'}
            </Text>
          )}
          <Text style={styles.uniqueHint}>Chaque transfert porte sur un exemplaire unique – pas de multi-transfert.</Text>
        </View>

        {/* Destinataire */}
        <View style={styles.section}>
          <Text style={styles.label}>Destinataire *</Text>
          <TextInput
            style={styles.input}
            placeholder="Numéro de téléphone"
            value={receiverPhone}
            onChangeText={(text) => {
              setReceiverPhone(text);
              searchUsers(text);
            }}
            keyboardType="phone-pad"
          />
          
          {/* Résultats de recherche */}
          {searching && <ActivityIndicator size="small" style={styles.searchIndicator} />}
          {searchResults.length > 0 && (
            <View style={styles.searchResults}>
              {searchResults.map((user) => (
                <TouchableOpacity
                  key={user.id}
                  style={styles.searchResultItem}
                  onPress={() => selectUser(user)}
                >
                  <Text style={styles.searchResultName}>
                    {user.full_name || 'Utilisateur'}
                  </Text>
                  <Text style={styles.searchResultPhone}>{user.phone}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Contacts fréquents */}
          {contacts.length > 0 && (
            <View style={styles.contactsSection}>
              <Text style={styles.contactsTitle}>Contacts fréquents</Text>
              {contacts.map((contact) => (
                <TouchableOpacity
                  key={contact.id}
                  style={styles.contactItem}
                  onPress={() => selectUser(contact)}
                >
                  <Text style={styles.contactName}>
                    {contact.full_name || 'Contact'}
                  </Text>
                  <Text style={styles.contactPhone}>{contact.phone}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Message */}
        <View style={styles.section}>
          <Text style={styles.label}>Message (optionnel)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Ajouter un message personnel..."
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            onFocus={handleMessageFocus}
            onBlur={handleMessageBlur}
          />
        </View>

        {/* Bouton d'envoi */}
        <TouchableOpacity
          style={[styles.sendButton, loading && styles.sendButtonDisabled]}
          onPress={handleSendGift}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.sendButtonText}>Envoyer le cadeau</Text>
          )}
        </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollContent: {
    paddingBottom: 40,
  },
  keyboardSpacer: {
    paddingBottom: 320,
  },
  card: {
    backgroundColor: '#fff',
    margin: 16,
    padding: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  errorBanner: {
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
    marginTop: 12,
    marginBottom: 12,
  },
  errorTitle: {
    color: '#991B1B',
    fontWeight: '700',
    marginBottom: 4,
  },
  errorText: {
    color: '#7F1D1D',
    lineHeight: 18,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
    color: '#333',
  },
  productInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    padding: 15,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
  },
  productImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 15,
  },
  productDetails: {
    flex: 1,
  },
  productTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  productId: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  section: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  textArea: {
    minHeight: 80,
  },
  valueLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  valueLoadingText: {
    fontSize: 13,
    color: '#6b7280',
  },
  valueBreakdownRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  valueBadge: {
    flex: 1,
    minWidth: 100,
    backgroundColor: '#f3f4f6',
    padding: 12,
    borderRadius: 8,
  },
  valueBadgeHighlight: {
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  valueBadgeLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  valueBadgeValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
  },
  valueHint: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 6,
  },
  uniqueHint: {
    fontSize: 12,
    color: '#111827',
    marginTop: 8,
    fontWeight: '600',
  },
  searchIndicator: {
    marginTop: 8,
  },
  searchResults: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  searchResultItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  searchResultName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
  },
  searchResultPhone: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  contactsSection: {
    marginTop: 16,
  },
  contactsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },
  contactItem: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: '#fafafa',
  },
  contactName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
  },
  contactPhone: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  sendButton: {
    backgroundColor: '#007AFF',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  sendButtonDisabled: {
    backgroundColor: '#ccc',
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});

export default SendGiftScreen;