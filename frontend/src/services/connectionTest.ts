// frontend/src/services/connectionTest.ts
import { api } from './api';

export const testConnection = async () => {
  try {
    console.log('🧪 Test de connexion au backend...');
    
    const response = await api.get('/health');
    console.log('✅ Backend accessible:', response.data);
    
    return true;
  } catch (error) {
    console.error('❌ Backend inaccessible:', error);
    return false;
  }
};