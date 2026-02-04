// ================================================
// TYPES UNIFIÉS - NFT (ALIGNÉS AVEC BACKEND)
// ================================================

// === NFT TYPES (BACKEND COMPATIBLE) ===
export interface NFT {
  id: number;
  token_id: string;
  title: string;
  description: string | null;
  artist: string;
  category: string;
  animation_url: string;
  preview_image: string;
  audio_url: string | null;
  duration: number | null;
  value: number;
  purchase_price: number;
  royalty_percentage: number;
  collection_id: number | null;
  edition_type: 'common' | 'rare' | 'ultra_rare' | 'legendary';
  max_editions: number | null;
  available_editions: number | null;
  current_edition: number;
  tags: string[];
  attributes: Array<{ trait_type: string; value: string }>;
  nft_metadata: Record<string, any>;
  owner_id: number | null;
  creator_id: number;
  is_active: boolean;
  is_minted: boolean;
  minted_at: string;
  created_at: string;
  updated_at: string | null;
}

export interface NFTCreateData {
  title: string;
  description?: string | null;
  artist: string;
  category: string;
  animation_url: string;
  audio_url?: string | null;
  preview_image: string;
  duration?: number | null;
  value: number;
  purchase_price: number;
  royalty_percentage?: number;
  collection_id?: number | null;
  edition_type?: string;
  max_editions?: number | null;
  tags?: string[];
  attributes?: Array<{ trait_type: string; value: string }>;
  is_active?: boolean;
  is_tradable?: boolean;
}

// === COLLECTIONS ===
export interface NFTCollection {
  id: number;
  name: string;
  description: string | null;
  creator_id: number;
  banner_image: string | null;
  thumbnail_image: string | null;
  is_verified: boolean;
  total_items: number;
  floor_price: number | null;
  total_volume: number;
  collection_metadata: Record<string, any>;
  created_at: string;
}

export interface CollectionCreateData {
  name: string;
  description?: string | null;
  banner_image?: string | null;
  thumbnail_image?: string | null;
  category?: string;
}

// === USER TYPES & ACCOUNT STATUS ===
export type AccountStatus = 'active' | 'inactive' | 'banned' | 'deleted';

export interface User {
  id: number;
  phone: string;
  email: string;
  full_name: string | null;
  kyc_status: string;
  is_active: boolean;
  is_admin: boolean;
  created_at: string;
  wallet_balance?: number;
  total_boms_owned?: number;
  // Account status tracking (new fields for moderation)
  account_status?: AccountStatus;
  banned_at?: string | null;
  banned_by?: number | null;
  banned_reason?: string | null;
  ban_until?: string | null;  // Auto-delete after 72h from ban_time
  deactivated_at?: string | null;
  deactivated_reason?: string | null;
}

// === TRANSACTION TYPES ===
export interface Transaction {
  id: number;
  user_id: number;
  user_phone: string;
  user_full_name: string | null;
  amount: number;
  transaction_type: string;
  description: string;
  status: string;
  created_at: string;
}

// ================================================
// CORRECTION DEMANDÉE : PaymentTransaction avec Decimal en string
// ================================================

export interface PaymentTransaction {
  id: string;  // Format: "type_uuid"
  user_id: number;
  type: TransactionType;
  amount: string;  // CHANGÉ : string au lieu de number
  fees: string;    // CHANGÉ : string au lieu de number
  net_amount: string;  // CHANGÉ : string au lieu de number
  status: PaymentStatus;
  provider: string;  // "wave", "stripe", "orange_money", "mtn_momo", "system"
  provider_reference?: string;
  description?: string;
  user_bom_id?: number;
  created_at: string;
  metadata?: Record<string, any>;
  is_admin_operation?: boolean;
  currency?: string;  // Toujours "FCFA"
}

export type TransactionType = 
  | 'deposit' | 'withdrawal'
  | 'treasury_deposit' | 'treasury_withdrawal'
  | 'admin_treasury_deposit' | 'admin_treasury_withdrawal'
  | 'bom_purchase' | 'bom_withdrawal'
  | 'transfer_sent' | 'transfer_received'
  | 'royalties_received' | 'royalties_payout'
  | 'bonus_received' | 'bonus_payout'
  | 'refund_received' | 'refund_payout'
  | 'correction_received' | 'correction_payout'
  | 'gift_received' | 'gift_sent'
  | 'fee' | 'commission' | 'penalty';

export type PaymentStatus = 
  | 'pending' | 'completed' | 'failed' | 'cancelled';

// === GIFT TYPES ===
export interface Gift {
  id: number;
  sender_id: number;
  receiver_id: number;
  user_bom_id: number;
  message: string | null;
  status: string;
  sent_at: string;
  accepted_at: string | null;
  expires_at: string | null;
  sender_name: string;
  receiver_name: string;
  bom_title: string;
  bom_image_url: string | null;
}

// === ADMIN TYPES ===
export interface AdminStats {
  total_users: number;
  total_boms: number;
  active_boms: number;
  total_platform_value: number;
  total_transactions?: number;
  daily_active_users?: number;
  total_collections?: number;
  verified_collections?: number;
  categories?: string[];
}

// === COMPATIBILITÉ (ALIAS) ===
export type Bom = NFT;
export type BomCreateData = NFTCreateData;
export type Collection = NFTCollection;

// ================================================
// CORRECTION DEMANDÉE : Redistribution avec Decimal en string
// ================================================

export interface RedistributionRequest {
  from_user_id?: number;  // CHANGÉ : optionnel au lieu de required
  to_user_id: number;
  amount: string;  // CHANGÉ : string au lieu de number
  reason: 'royalties' | 'bonus' | 'refund' | 'correction' | 'other';
  description?: string;  // AJOUTÉ : champ optionnel
}

export interface RedistributionResponse {
  success: boolean;
  message: string;
  transaction_id: string;
  standard_transaction_id: number;
  redistribution_id?: number;
  amount: string;
  fees_applied: string;  // Toujours "0.00" pour admin
  from_user?: {
    id: number;
    old_balance: string;
    new_balance: string;
  };
  to_user: {
    id: number;
    old_balance: string;
    new_balance: string;
  };
  timestamp: string;
}

// === FONDS ET COMMISSIONS ===
export interface Commission {
  id: number;
  type: 'deposit' | 'withdrawal' | 'royalty' | 'market' | 'boom_purchase' | 'boom_sell';
  amount: number;
  user_id: number;
  bom_id?: number;
  description?: string;
  created_at: string;
}

export interface UserFunds {
  user_id: number;
  full_name: string | null;
  phone: string;
  cash_balance: number;
  wallet_balance: number;
  pending_withdrawals: number;
  total_commissions_earned: number;
  wallet_balance_stored?: number;
  has_discrepancy?: boolean;
  discrepancy_amount?: number;
  last_transaction_date?: string | null;
}

export interface CommissionSummary {
  date: string;
  deposit_commissions: number;
  withdrawal_commissions: number;
  total_commissions: number;
  deposit_count: number;
  withdrawal_count: number;
}

// === TRÉSORERIE ===
export interface TreasuryBalance {
  balance: string;
  currency: string;
  updated_at?: string;
}

export interface TreasuryTransaction {
  id: number;
  user_id: number;
  user_phone?: string;
  user_full_name?: string;
  amount: string;
  transaction_type: string;
  description: string;
  created_at: string;
}

export interface TreasuryStats {
  current_balance: number;
  currency: string;
  created_at?: string;
  updated_at?: string;
  fees_by_category: Record<string, number>;
  total_fees_collected: number;
  transaction_count: number;
}

export interface TreasuryDepositRequest {
  amount: number;
  method: string;
  reference?: string;
}

export interface TreasuryWithdrawRequest {
  amount: number;
  method: string;
  recipient_phone?: string;
  recipient_account?: string;
  reference?: string;
}

// === BALANCE DÉTAILLÉE (Nouveau) ===
export interface DetailedBalance {
  liquid_balance: string;
  bom_value: string;
  total_balance: string;
  currency: string;  // "FCFA"
}

// === SUPPORT & INCIDENT RESPONSE ===
export type SupportThreadStatus =
  | 'open'
  | 'pending'
  | 'waiting_user'
  | 'resolved'
  | 'closed'
  | 'escalated';

export type SupportPriority = 'low' | 'normal' | 'high' | 'urgent';

export type SupportSenderType = 'user' | 'admin' | 'system';

export interface SupportMessage {
  id: number;
  thread_id: number;
  sender_id?: number | null;
  sender_type: SupportSenderType;
  body: string;
  attachments: Array<Record<string, any>>;
  is_internal: boolean;
  context_snapshot?: Record<string, any> | null;
  created_at: string;
  updated_at?: string | null;
}

export interface SupportThreadListItem {
  id: number;
  reference: string;
  subject: string;
  category: string;
  status: SupportThreadStatus;
  priority: SupportPriority;
  user_phone?: string | null;
  user_email?: string | null;
  user_full_name?: string | null;
  last_message_preview?: string | null;
  last_message_at?: string | null;
  created_at: string;
  updated_at?: string | null;
  unread_admin_count?: number;
  unread_user_count?: number;
}

export interface SupportThreadDetail extends SupportThreadListItem {
  user_id: number;
  user_phone?: string | null;  // Pour identifier l'utilisateur
  user_email?: string | null;
  user_full_name?: string | null;
  assigned_admin_id?: number | null;
  context_payload?: Record<string, any> | null;
  tags?: string[] | null;
  messages: SupportMessage[];
  // Account status context
  user_account_status?: AccountStatus;
  user_is_active?: boolean;
}

export interface SupportMessagePayload {
  message: string;
  attachments?: Array<Record<string, any>>;
  is_internal?: boolean;
}

export interface SupportStatusUpdatePayload {
  status: SupportThreadStatus;
  reason?: string;
  assign_to_admin_id?: number | null;
  message?: string;
  notify_user?: boolean;
}

export interface SuggestedMessage {
  category: string;
  title: string;
  template: string;
}

export interface BannedMessage {
  id: number;
  user_id?: number | null;
  user_phone?: string | null;
  user_email?: string | null;
  message: string;
  admin_response?: string | null;
  status: string;
  channel?: string | null;
  created_at: string;
  responded_at?: string | null;
  responded_by?: number | null;
  metadata: Record<string, any>;
  
  // Moderation context (new fields)
  action_type?: 'inactive' | 'banned' | 'deleted';  // Pourquoi il a contacté
  action_reason?: string | null;  // Raison du bannissement/désactivation
  action_at?: string | null;  // Quand a été pris l'action
  action_by?: number | null;  // Qui a pris l'action
  ban_until?: string | null;  // Quand sera auto-supprimé (72h après bannissement)
  current_account_status?: AccountStatus;  // Statut actuel du compte
}

// ================================================
// NOUVELLES INTERFACES BOMs/NFTs - AUDIT & TRANSFERT
// ================================================

export interface NFTAuditLog {
  id: number;
  bom_id: number;
  action: 'create' | 'update' | 'delete' | 'transfer' | 'toggle_active' | 'toggle_tradable' | 'mint' | 'burn' | 'edit_editions';
  performed_by: number;  // Admin ID
  old_values?: Record<string, any>;  // Valeurs avant changement
  new_values?: Record<string, any>;  // Nouvelles valeurs
  raison?: string;  // Justification de l'action
  timestamp: string;
  ip_address?: string;
  user_agent?: string;
}

export interface BomTransfer {
  id: number;
  bom_id: number;
  from_user_id: number;
  to_user_id: number;
  transfer_date: string;
  confirmed_date?: string;
  status: 'pending' | 'confirmed' | 'cancelled';
  raison?: string;
  transfer_type: 'manual' | 'purchase' | 'gift' | 'admin_transfer';
  admin_id?: number;  // ID admin si transfert manuel
  notes?: string;
}

export interface BulkAction {
  id: string;
  action_type: 'toggle_active' | 'transfer' | 'toggle_tradable' | 'delete' | 'edit_editions';
  bom_ids: number[];
  status: 'pending' | 'processing' | 'completed' | 'failed';
  requested_by: number;  // Admin ID
  requested_at: string;
  completed_at?: string;
  raison?: string;
  results?: {
    successful: number[];
    failed: Array<{ bom_id: number; error: string }>;
  };
}