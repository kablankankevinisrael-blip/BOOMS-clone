import React from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { useAuth } from '../contexts/AuthContext';
import LoginScreen from '../screens/LoginScreen';
import DashboardScreen from '../screens/DashboardScreen';
import CatalogueScreen from '../screens/CatalogueScreen';
import BomDetailScreen from '../screens/BomDetailScreen';
import WalletScreen from '../screens/WalletScreen';
import PurchaseScreen from '../screens/PurchaseScreen';
import InventoryScreen from '../screens/InventoryScreen';
// ⬅️ AJOUT DES NOUVEAUX ÉCRANS PHASE 5
import SendGiftScreen from '../screens/SendGiftScreen';
import GiftInboxScreen from '../screens/GiftInboxScreen';
import ContactsScreen from '../screens/ContactsScreen';
import DepositScreen from '../screens/DepositScreen';
import WithdrawalScreen from '../screens/WithdrawalScreen';
import ProfileScreen from '../screens/ProfileScreen';
import GiftDetailsScreen from '../screens/GiftDetailsScreen';
import SupportCenterScreen from '../screens/SupportCenterScreen';

export type RootStackParamList = {
  Login: undefined;
  Dashboard: undefined;
  Catalogue: undefined;
  BomDetail: { bom: any };
  Wallet: undefined;
  Purchase: { bom: any };
  Inventory: undefined;
  // ⬅️ AJOUT DES NOUVELLES ROUTES PHASE 5
  SendGift: { bomId: number; bomTitle: string; bomImageUrl?: string };
  GiftInbox: undefined;
  Contacts: undefined;
  GiftDetails: { giftId: number } | undefined;
  Deposit: undefined;
  Withdrawal: undefined;
  Profile: undefined;
  SupportCenter: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export default function AppNavigator() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return null;
  }

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator 
        screenOptions={{
          headerStyle: {
            backgroundColor: '#fff4e6',
          },
          headerTintColor: '#b45309',
          headerTitleStyle: {
            fontWeight: 'bold',
            color: '#9a3412',
          },
        }}
      >
        {isAuthenticated ? (
          // ✅ Utilisateur CONNECTÉ
          <>
            <Stack.Screen 
              name="Dashboard" 
              component={DashboardScreen}
              options={{ 
                title: 'Tableau de Bord',
                headerLeft: () => null
              }}
            />
            <Stack.Screen 
              name="Wallet" 
              component={WalletScreen}
              options={{ title: 'Mon Portefeuille' }}
            />
            <Stack.Screen 
              name="Inventory" 
              component={InventoryScreen}
              options={{ title: 'Mon Inventaire' }}
            />
            <Stack.Screen 
              name="Catalogue" 
              component={CatalogueScreen}
              options={{ title: 'Catalogue Booms' }}
            />
            <Stack.Screen 
              name="BomDetail" 
              component={BomDetailScreen}
              options={{ title: 'Détails du Boom' }}
            />
            <Stack.Screen 
              name="Purchase" 
              component={PurchaseScreen}
              options={{ title: 'Acheter / Vendre un Boom' }}
            />
            {/* ⬅️ NOUVEAUX ÉCRANS PHASE 5 */}
            <Stack.Screen 
              name="SendGift" 
              component={SendGiftScreen}
              options={{ title: 'Envoyer un cadeau' }}
            />
            <Stack.Screen 
              name="GiftInbox" 
              component={GiftInboxScreen}
              options={{ title: 'Mes cadeaux' }}
            />
            <Stack.Screen 
              name="GiftDetails" 
              component={GiftDetailsScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen 
              name="Contacts" 
              component={ContactsScreen}
              options={{ title: 'Mes contacts' }}
            />
            <Stack.Screen 
              name="Deposit" 
              component={DepositScreen}
              options={{ title: 'Dépôt de fonds' }}
            />
            <Stack.Screen 
              name="Withdrawal" 
              component={WithdrawalScreen}
              options={{ title: 'Retrait' }}
            />
            <Stack.Screen 
              name="Profile" 
              component={ProfileScreen}
              options={{ title: 'Mon Profil' }}
            />
          </>
        ) : (
          // ❌ Utilisateur NON CONNECTÉ
          <Stack.Screen 
            name="Login" 
            component={LoginScreen}
            options={{ headerShown: false }}
          />
        )}
        <Stack.Screen 
          name="SupportCenter" 
          component={SupportCenterScreen}
          options={{ title: 'Assistance Booms' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}