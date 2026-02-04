import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import AuthService from '../services/auth';
import { performCompleteLogout } from '../utils/authCleanup'; // AJOUT IMPORT
import { boomsWebSocket } from '../services/websocket';
import AsyncStorage from '@react-native-async-storage/async-storage'; // AJOUT IMPORT

const PASSWORD_MIN_LENGTH = 10;
const COMMON_PASSWORD_PATTERN = /(123456|password|azerty|qwerty)/i;
const passwordRules = [
  'Minimum 10 caractères',
  'Inclure une majuscule et une minuscule',
  'Inclure un chiffre',
  'Inclure un symbole (!@#$, etc.)',
];

type SignupValidationPayload = {
  phone: string;
  email: string;
  fullName: string;
  password: string;
};

const sanitizePhoneInput = (value: string) => value.replace(/\s+/g, '');
const isSecurePhoneNumber = (value: string) => /^\+?[0-9]{10,14}$/.test(value);
const isValidEmail = (value: string) => /^[^\s@]+@gmail\.com$/i.test(value.trim());
const isValidFullName = (value: string) => value.length >= 5 && value.includes(' ');
const isStrongPassword = (value: string) => {
  if (COMMON_PASSWORD_PATTERN.test(value)) {
    return false;
  }

  return (
    value.length >= PASSWORD_MIN_LENGTH &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /\d/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
};

const getSignupValidationError = ({
  phone,
  email,
  fullName,
  password,
}: SignupValidationPayload) => {
  if (!isSecurePhoneNumber(phone)) {
    return 'Le numéro de téléphone doit contenir entre 10 et 14 chiffres (code pays inclus).';
  }

  if (!isValidFullName(fullName)) {
    return 'Veuillez indiquer votre nom complet (prénom et nom).';
  }

  if (!isValidEmail(email)) {
    return 'Seules les adresses @gmail.com sont autorisées.';
  }

  if (!isStrongPassword(password)) {
    return 'Le mot de passe doit respecter toutes les règles de sécurité listées.';
  }

  return null;
};

export default function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  const navigation = useNavigation<any>();
  const { login } = useAuth();

  const handleAuth = async () => {
    // 🚨 ÉTAPE 0 : Cleanup GARANTI AVEC DÉLAI
    console.log('🧹 [LOGIN] Cleanup pré-connexion...');
    try {
      // 1. Déconnecter WebSocket proprement
      boomsWebSocket.disconnect();
      
      // 2. Petit délai pour laisser le serveur nettoyer
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // 3. Reset complet WebSocket
      boomsWebSocket.resetForNewUser();
      
      // 4. Cleanup storage
      await AsyncStorage.multiRemove(['booms_token', 'booms_user']);
      
      // 5. Délai supplémentaire
      await new Promise(resolve => setTimeout(resolve, 500));
      
      console.log('✅ [LOGIN] Cleanup complet terminé');
    } catch (error) {
      console.log('⚠️ Cleanup préventif:', error);
    }

    // Validation basique
    const trimmedPhone = phone.trim();
    const trimmedEmail = email.trim();
    const trimmedFullName = fullName.trim();
    const sanitizedPassword = password.trim();
    const sanitizedPhone = sanitizePhoneInput(trimmedPhone);

    if (!trimmedPhone || !sanitizedPassword) {
      Alert.alert('Erreur', 'Le numéro de téléphone et le mot de passe sont requis');
      return;
    }

    if (!isLogin && (!trimmedEmail || !trimmedFullName)) {
      Alert.alert('Erreur', 'Tous les champs sont requis pour l\'inscription');
      return;
    }

    if (!isLogin) {
      const securityError = getSignupValidationError({
        phone: sanitizedPhone,
        email: trimmedEmail,
        fullName: trimmedFullName,
        password: sanitizedPassword,
      });

      if (securityError) {
        Alert.alert('Sécurité requise', securityError);
        return;
      }
    }

    setIsLoading(true);

    try {
      if (isLogin) {
        // 🚨 Login avec cleanup garanti
        console.log('🔐 [LOGIN] Appel login()...');
        await login(trimmedPhone, password);
        console.log('✅ [LOGIN] Login réussi');
      } else {
        await AuthService.register({
          phone: sanitizedPhone,
          email: trimmedEmail,
          password: sanitizedPassword,
          full_name: trimmedFullName
        });
        
        Alert.alert('Succès', 'Compte créé avec succès! Vous pouvez maintenant vous connecter.');
        setIsLogin(true);
        // Reset des champs
        setEmail('');
        setFullName('');
        setPassword('');
      }
    } catch (error: any) {
      console.error('❌ [LOGIN] Erreur:', error);
      const errorMessage = error.message || 'Erreur de connexion au serveur';
      Alert.alert('Erreur', errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView 
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.title}>🎁 BOOMS</Text>
          <Text style={styles.subtitle}>
            {isLogin ? 'Connectez-vous à votre compte' : 'Créez votre compte'}
          </Text>
        </View>

        <View style={styles.form}>
          {!isLogin && (
            <>
              <TextInput
                style={styles.input}
                placeholder="Nom complet"
                placeholderTextColor="#999"
                value={fullName}
                onChangeText={setFullName}
                autoCapitalize="words"
              />
              <TextInput
                style={styles.input}
                placeholder="Adresse email"
                placeholderTextColor="#999"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />
            </>
          )}

          <TextInput
            style={styles.input}
            placeholder="Numéro de téléphone"
            placeholderTextColor="#999"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
          />

          <View style={styles.passwordField}>
            <TextInput
              style={[styles.input, styles.passwordInput]}
              placeholder="Mot de passe"
              placeholderTextColor="#999"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoComplete="password"
            />
            <TouchableOpacity
              style={styles.passwordToggle}
              onPress={() => setShowPassword((prev) => !prev)}
            >
              <Text style={styles.passwordToggleText}>
                {showPassword ? 'Masquer' : 'Afficher'}
              </Text>
            </TouchableOpacity>
          </View>

          {!isLogin && (
            <View style={styles.securityBox}>
              <Text style={styles.securityTitle}>Sécurité obligatoire</Text>
              <Text style={styles.securityIntro}>
                Les nouveaux comptes doivent respecter ces règles :
              </Text>
              {passwordRules.map((rule) => (
                <Text key={rule} style={styles.securityRule}>
                  • {rule}
                </Text>
              ))}
            </View>
          )}

          <TouchableOpacity 
            style={[styles.button, isLoading && styles.buttonDisabled]} 
            onPress={handleAuth}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>
                {isLogin ? 'Se connecter' : 'Créer un compte'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity 
            onPress={() => {
              setIsLogin(!isLogin);
              // Reset des champs quand on change de mode
              if (isLogin) {
                setEmail('');
                setFullName('');
              }
            }}
            style={styles.switchButton}
            disabled={isLoading}
          >
            <Text style={styles.switchText}>
              {isLogin ? 'Pas de compte ? S\'inscrire' : 'Déjà un compte ? Se connecter'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.supportAssistButton}
            onPress={() => navigation.navigate('SupportCenter')}
            disabled={isLoading}
          >
            <Text style={styles.supportAssistText}>{"🤝 Besoin d'aide ? Contacter le support"}</Text>
          </TouchableOpacity>
        </View>

        {/* Section informations */}
        <View style={styles.infoSection}>
          <Text style={styles.infoTitle}>🎁 Qu'est-ce que Booms ?</Text>
          <Text style={styles.infoText}>
            Envoyez et recevez des cadeaux digitaux avec valeur réelle. 
            Achetez, collectionnez et partagez des Booms avec vos proches.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontSize: 48,
    fontWeight: 'bold',
    textAlign: 'center',
    color: '#667eea',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    color: '#6c757d',
    lineHeight: 22,
  },
  form: {
    width: '100%',
    marginBottom: 30,
  },
  input: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e9ecef',
    fontSize: 16,
    color: '#333',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  button: {
    backgroundColor: '#667eea',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#667eea',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  switchButton: {
    padding: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  switchText: {
    color: '#667eea',
    fontSize: 16,
    fontWeight: '500',
  },
  supportAssistButton: {
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ffd7ba',
  },
  supportAssistText: {
    color: '#f97316',
    fontSize: 15,
    fontWeight: '600',
  },
  infoSection: {
    backgroundColor: 'rgba(102, 126, 234, 0.05)',
    padding: 20,
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#667eea',
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#667eea',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#6c757d',
    lineHeight: 20,
  },
  securityBox: {
    backgroundColor: '#fff7e6',
    borderWidth: 1,
    borderColor: '#ffb347',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  securityTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#c66a00',
    marginBottom: 8,
  },
  securityIntro: {
    fontSize: 14,
    color: '#7a6100',
    marginBottom: 6,
  },
  securityRule: {
    fontSize: 14,
    color: '#7a6100',
    lineHeight: 20,
  },
  passwordField: {
    position: 'relative',
    width: '100%',
  },
  passwordInput: {
    paddingRight: 120,
  },
  passwordToggle: {
    position: 'absolute',
    right: 16,
    top: 16,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  passwordToggleText: {
    color: '#667eea',
    fontWeight: '600',
    fontSize: 14,
  },
});