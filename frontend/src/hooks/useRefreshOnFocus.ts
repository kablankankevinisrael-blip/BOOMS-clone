// frontend/src/hooks/useRefreshOnFocus.ts
import { useFocusEffect } from '@react-navigation/native';
import { useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';

export const useRefreshOnFocus = () => {
  const { refreshUserInfo, isAuthenticated } = useAuth();
  
  useFocusEffect(
    useCallback(() => {
      if (isAuthenticated) {
        console.log('📱 [HOOK] Écran focus - rafraîchissement des données');
        refreshUserInfo();
      }
    }, [isAuthenticated, refreshUserInfo])
  );
};