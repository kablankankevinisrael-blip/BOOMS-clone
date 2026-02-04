import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { Contact, contactsService, UserSearchResult } from '../services/contacts';

const ContactsScreen: React.FC = () => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [addingContact, setAddingContact] = useState<string | null>(null);

  useEffect(() => {
    loadContacts();
  }, []);

  useEffect(() => {
    if (searchTerm.length >= 3) {
      searchUsers();
    } else {
      setSearchResults([]);
    }
  }, [searchTerm]);

  const loadContacts = async () => {
    try {
      setLoading(true);
      const data = await contactsService.getContacts();
      setContacts(data);
    } catch (error) {
      console.error('Erreur chargement contacts:', error);
      Alert.alert('Erreur', 'Impossible de charger les contacts');
    } finally {
      setLoading(false);
    }
  };

  const searchUsers = async () => {
    setSearching(true);
    try {
      const results = await contactsService.searchUsers(searchTerm);
      // Filtrer les utilisateurs déjà en contacts
      const existingContactIds = new Set(contacts.map(c => c.contact_user_id));
      const filteredResults = results.filter(user => !existingContactIds.has(user.id));
      setSearchResults(filteredResults);
    } catch (error) {
      console.error('Erreur recherche:', error);
    } finally {
      setSearching(false);
    }
  };

  const addContact = async (user: UserSearchResult) => {
    setAddingContact(user.phone);
    try {
      await contactsService.addContact({
        contact_phone: user.phone,
        nickname: user.full_name || undefined,
      });
      Alert.alert('Succès', 'Contact ajouté avec succès');
      setSearchTerm('');
      setSearchResults([]);
      loadContacts();
    } catch (error: any) {
      Alert.alert('Erreur', error.response?.data?.detail || 'Erreur lors de l\'ajout');
    } finally {
      setAddingContact(null);
    }
  };

  const removeContact = async (contactId: number, contactName: string) => {
    Alert.alert(
      'Supprimer le contact',
      `Êtes-vous sûr de vouloir supprimer ${contactName} de vos contacts?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            try {
              await contactsService.removeContact(contactId);
              Alert.alert('Succès', 'Contact supprimé');
              loadContacts();
            } catch (error: any) {
              Alert.alert('Erreur', error.response?.data?.detail || 'Erreur lors de la suppression');
            }
          },
        },
      ]
    );
  };

  const renderContactItem = ({ item }: { item: Contact }) => (
    <View style={styles.contactCard}>
      <View style={styles.contactInfo}>
        <Text style={styles.contactName}>
          {item.nickname || item.contact_name || 'Contact'}
        </Text>
        <Text style={styles.contactPhone}>{item.contact_phone}</Text>
        <Text style={styles.contactDate}>
          Ajouté le {new Date(item.created_at).toLocaleDateString('fr-FR')}
        </Text>
      </View>
      <TouchableOpacity
        style={styles.removeButton}
        onPress={() => removeContact(item.id, item.nickname || item.contact_name || 'ce contact')}
      >
        <Text style={styles.removeButtonText}>✕</Text>
      </TouchableOpacity>
    </View>
  );

  const renderSearchResult = ({ item }: { item: UserSearchResult }) => (
    <View style={styles.searchResultCard}>
      <View style={styles.searchResultInfo}>
        <Text style={styles.searchResultName}>
          {item.full_name || 'Utilisateur'}
        </Text>
        <Text style={styles.searchResultPhone}>{item.phone}</Text>
      </View>
      <TouchableOpacity
        style={[
          styles.addButton,
          addingContact === item.phone && styles.addButtonDisabled,
        ]}
        onPress={() => addContact(item)}
        disabled={addingContact === item.phone}
      >
        {addingContact === item.phone ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.addButtonText}>Ajouter</Text>
        )}
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Barre de recherche */}
      <View style={styles.searchSection}>
        <TextInput
          style={styles.searchInput}
          placeholder="Rechercher par téléphone ou nom..."
          value={searchTerm}
          onChangeText={setSearchTerm}
        />
        {searching && <ActivityIndicator size="small" style={styles.searchIndicator} />}
      </View>

      {/* Résultats de recherche */}
      {searchResults.length > 0 && (
        <View style={styles.searchResultsSection}>
          <Text style={styles.sectionTitle}>Résultats de recherche</Text>
          <FlatList
            data={searchResults}
            renderItem={renderSearchResult}
            keyExtractor={(item) => item.id.toString()}
            scrollEnabled={false}
          />
        </View>
      )}

      {/* Liste des contacts */}
      <View style={styles.contactsSection}>
        <Text style={styles.sectionTitle}>
          Mes contacts ({contacts.length})
        </Text>
        {loading ? (
          <ActivityIndicator size="large" color="#007AFF" />
        ) : (
          <FlatList
            data={contacts}
            renderItem={renderContactItem}
            keyExtractor={(item) => item.id.toString()}
            refreshControl={
              <RefreshControl refreshing={loading} onRefresh={loadContacts} />
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>
                  Aucun contact pour le moment
                </Text>
                <Text style={styles.emptySubtext}>
                  Utilisez la barre de recherche pour ajouter des contacts
                </Text>
              </View>
            }
          />
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 16,
  },
  searchSection: {
    marginBottom: 20,
  },
  searchInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  searchIndicator: {
    position: 'absolute',
    right: 12,
    top: 12,
  },
  searchResultsSection: {
    marginBottom: 20,
  },
  contactsSection: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    color: '#333',
  },
  searchResultCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  searchResultInfo: {
    flex: 1,
  },
  searchResultName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
    marginBottom: 4,
  },
  searchResultPhone: {
    fontSize: 14,
    color: '#666',
  },
  addButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  addButtonDisabled: {
    backgroundColor: '#ccc',
  },
  addButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  contactCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
    marginBottom: 4,
  },
  contactPhone: {
    fontSize: 14,
    color: '#666',
    marginBottom: 2,
  },
  contactDate: {
    fontSize: 12,
    color: '#999',
  },
  removeButton: {
    padding: 8,
  },
  removeButtonText: {
    fontSize: 18,
    color: '#FF3B30',
    fontWeight: 'bold',
  },
  emptyContainer: {
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
});

export default ContactsScreen;