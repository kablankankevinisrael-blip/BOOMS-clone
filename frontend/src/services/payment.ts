import { Alert } from 'react-native';
import api from './api';
import { PaymentMethod } from '../types/payments';

export interface DepositRequest {
  amount: number;
  method: PaymentMethod;
  phone_number?: string;
}

export interface WavePaymentResponse {
  payment_url: string;
  transaction_id: string;
  qr_code_data?: string;
  fees_analysis?: MobileMoneyFinancialDetails;
  merchant_reference?: string;
}

export interface StripePaymentResponse {
  client_secret: string;
  payment_intent_id: string;
}

export interface MobileMoneyFinancialDetails {
  amount: number;
  net_to_user?: number;
  provider_fee?: number;
  orange_fee?: number;
  momo_fee?: number;
  your_commission?: number;
  total_fees?: number;
  [key: string]: number | undefined;
}

export interface OrangeMoneyDepositResponse {
  success: boolean;
  transaction_id: number | string;
  orange_transaction_id?: string;
  merchant_reference?: string;
  status: string;
  instructions?: string;
  financial_details?: MobileMoneyFinancialDetails;
}

export interface MTNMomoDepositResponse {
  success: boolean;
  transaction_id: number | string;
  external_id?: string;
  status: string;
  instructions?: string;
  financial_details?: MobileMoneyFinancialDetails;
}

export type DepositInitiationResponse =
  | ({ method: 'wave' } & WavePaymentResponse)
  | ({ method: 'stripe' } & StripePaymentResponse)
  | ({ method: 'orange_money' } & OrangeMoneyDepositResponse)
  | ({ method: 'mtn_momo' } & MTNMomoDepositResponse);

export interface DetailedBalance {
  liquid_balance: number;
  virtual_balance: number;
  bom_value: number;
  social_value: number;
  total_balance: number;
  currency: string;
}

class PaymentService {
  async initiateDeposit(data: DepositRequest): Promise<DepositInitiationResponse> {
    try {
      const response = await api.post('/payments/deposit/initiate', data);
      return {
        method: data.method,
        ...response.data,
      };
    } catch (error: any) {
      console.error('❌ Erreur dépôt:', error);
      
      // Gestion spécifique des erreurs de configuration
      if (error.response?.status === 503) {
        const errorData = error.response.data;
        
        Alert.alert(
          'Service indisponible',
          errorData.message ||
            'Ce moyen de paiement est momentanément indisponible. Réessayez plus tard.',
          [{ text: 'OK' }]
        );

        throw new Error(errorData.error || 'SERVICE_INDISPONIBLE');
      }
      
      // Autres erreurs
      if (error.response?.status === 500) {
        Alert.alert(
          '❌ Erreur Temporaire',
          'Le service de paiement rencontre des difficultés techniques. Réessayez ultérieurement.',
          [{ text: 'OK' }]
        );
      }
      
      throw error;
    }
  }

  async getDetailedBalance(): Promise<DetailedBalance> {
    const response = await api.get('/payments/balance/detailed');
    return response.data;
  }
}

// Export unique de l'instance de PaymentService
export const paymentService = new PaymentService();