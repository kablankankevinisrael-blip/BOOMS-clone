import api from './api';

export type WithdrawalProvider = 'wave' | 'orange_money' | 'mtn_momo' | 'stripe';

export interface WithdrawalValidation {
  is_approved: boolean;
  bom_title: string;
  bom_value: number;
  withdrawal_amount: number;
  fees: number;
  net_amount: number;
  security_checks: Record<string, boolean>;
  rejection_reason?: string;
}

export interface WithdrawalResult {
  success: boolean;
  transaction_id: string;
  withdrawal_amount: number;
  fees: number;
  net_amount: number;
  payout_channel?: string;
  payout_reference?: string;
  message?: string;
}

class WithdrawalService {
  async validateBomWithdrawal(userBomId: number): Promise<WithdrawalValidation> {
    const response = await api.post('/withdrawal/bom/validate', { user_bom_id: userBomId });
    return response.data;
  }

  async executeBomWithdrawal(params: {
    userBomId: number;
    phoneNumber: string;
    provider?: WithdrawalProvider;
  }): Promise<WithdrawalResult> {
    const response = await api.post('/withdrawal/bom/execute', {
      user_bom_id: params.userBomId,
      phone_number: params.phoneNumber,
      provider: params.provider
    });
    return response.data;
  }
}

export const withdrawalService = new WithdrawalService();