import api from './api';

export interface Contact {
  id: number;
  contact_user_id: number;
  nickname?: string;
  is_favorite: boolean;
  created_at: string;
  contact_phone: string;
  contact_name?: string;
}

export interface ContactCreate {
  contact_phone: string;
  nickname?: string;
}

export interface UserSearchResult {
  id: number;
  phone: string;
  full_name?: string;
}

export const contactsService = {
  // Ajouter un contact
  async addContact(contactData: ContactCreate): Promise<Contact> {
    const response = await api.post('/contacts', contactData);
    return response.data;
  },

  // Récupérer la liste des contacts
  async getContacts(): Promise<Contact[]> {
    const response = await api.get('/contacts');
    return response.data;
  },

  // Rechercher des utilisateurs
  async searchUsers(searchTerm: string): Promise<UserSearchResult[]> {
    const response = await api.get(`/contacts/search?search_term=${encodeURIComponent(searchTerm)}`);
    return response.data;
  },

  // Supprimer un contact
  async removeContact(contactId: number): Promise<{ message: string }> {
    const response = await api.delete(`/contacts/${contactId}`);
    return response.data;
  },
};