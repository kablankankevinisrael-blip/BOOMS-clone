import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Animated,
  Dimensions,
  Image
} from 'react-native';
import { InventoryItem } from '../services/purchase';
import { formatCurrencyValue, sanitizeCurrencyInput } from '../utils/currency';

const { width } = Dimensions.get('window');

interface InventoryBoxProps {
  title: string;
  icon: string;
  items: InventoryItem[];
  onObserveNFT: (item: InventoryItem) => void;
  onSendGift: (item: InventoryItem) => void;
  type?: 'collection' | 'rarity' | 'artist';
  defaultExpanded?: boolean;
}

const InventoryBox: React.FC<InventoryBoxProps> = ({
  title,
  icon,
  items,
  onObserveNFT,
  onSendGift,
  type = 'collection',
  defaultExpanded = false
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [animation] = useState(new Animated.Value(defaultExpanded ? 1 : 0));

  // 🔥 CORRECTION: Filtrer les items invalides ou supprimés
  const filteredItems = items?.filter(item => !!item?.bom_id) || [];

  console.log(`📦 [INVENTORY_BOX] Initialisation: "${title}"`, {
    itemsCount: items?.length || 0,
    filteredItemsCount: filteredItems.length,
    type: type,
    defaultExpanded: defaultExpanded
  });

  const toggleExpand = () => {
    console.log(`🔄 [INVENTORY_BOX] Toggle expansion pour "${title}"`);
    setIsExpanded(!isExpanded);
    Animated.timing(animation, {
      toValue: isExpanded ? 0 : 1,
      duration: 300,
      useNativeDriver: false,
    }).start();
  };

  // ✅ FONCTION POUR OBENIR LA MEILLEURE URL D'IMAGE
  const getBestImageUrl = (bomAsset: any): string => {
    if (!bomAsset) {
      return 'https://via.placeholder.com/100/667eea/ffffff?text=BOOM';
    }
    
    if (bomAsset.preview_image && bomAsset.preview_image.startsWith('http')) {
      return bomAsset.preview_image;
    }
    if (bomAsset.thumbnail_url && bomAsset.thumbnail_url.startsWith('http')) {
      return bomAsset.thumbnail_url;
    }
    if (bomAsset.media_url && bomAsset.media_url.startsWith('http')) {
      return bomAsset.media_url;
    }
    if (bomAsset.animation_url && bomAsset.animation_url.startsWith('http')) {
      return bomAsset.animation_url;
    }
    return 'https://via.placeholder.com/100/667eea/ffffff?text=BOOM';
  };

  // ✅ FONCTION POUR IDENTIFIER LE TYPE D'IMAGE
  const getImageType = (bomAsset: any): string => {
    if (!bomAsset) return 'IMAGE';
    
    if (bomAsset.preview_image) return 'PREVIEW';
    if (bomAsset.thumbnail_url) return 'THUMBNAIL';
    if (bomAsset.animation_url) {
      if (bomAsset.animation_url.includes('.gif')) return 'GIF';
      if (bomAsset.animation_url.includes('.mp4')) return 'VIDEO';
      return 'ANIMATION';
    }
    return 'IMAGE';
  };

  // ✅ ICONES DE RARETÉ
  const getRarityIcon = (editionType: string) => {
    switch (editionType) {
      case 'legendary': return '👑';
      case 'ultra_rare': return '💎';
      case 'rare': return '⭐';
      default: return '🔹';
    }
  };

  // ✅ FONCTION POUR CALCULER LA VALEUR TOTALE
  const getTotalValue = () => {
    return filteredItems.reduce((sum, item) => {
      const value = sanitizeCurrencyInput(item?.bom_asset?.value);
      return sum + value;
    }, 0);
  };

  const renderItem = ({ item, index }: { item: InventoryItem; index: number }) => {
    // 🔥 CORRECTION: Vérification renforcée des données
    if (!item || !item.bom_asset || !item.bom_id) {
      console.warn(`⚠️ [INVENTORY_BOX] Item invalide à l'index ${index} - ignoré`);
      return null;
    }

    const imageUrl = getBestImageUrl(item.bom_asset);
    const imageType = getImageType(item.bom_asset);
    
    console.log(`🎨 [INVENTORY_BOX] Rendu item ${index}: ${item.bom_asset.title}`, {
      imageType: imageType,
      hasPreview: !!item.bom_asset.preview_image,
      bomId: item.bom_id
    });
    
    // Valeur sécurisée avec chaînage optionnel
    const assetValue = sanitizeCurrencyInput(item?.bom_asset?.value);
    const editionType = item?.bom_asset?.edition_type ?? 'common';
    const artistName = item?.bom_asset?.artist;
    const assetTitle = item?.bom_asset?.title ?? 'NFT sans titre';
    
    return (
      <TouchableOpacity 
        style={styles.boxItem}
        onPress={() => onObserveNFT(item)}
        activeOpacity={0.7}
      >
        <View style={styles.itemContent}>
          {/* ✅ MINIATURE AVEC BADGE */}
          <View style={styles.thumbnailContainer}>
            <Image 
              source={{ uri: imageUrl }}
              style={styles.thumbnail}
              resizeMode="cover"
              onLoad={() => console.log(`✅ Thumbnail chargée: ${assetTitle}`)}
              onError={(e) => console.log(`❌ Erreur chargement thumbnail: ${assetTitle}`, e.nativeEvent.error)}
            />
            
            {/* BADGE TYPE D'IMAGE */}
            <View style={[styles.imageTypeBadge, 
              item.bom_asset.preview_image ? styles.previewBadge : 
              item.bom_asset.animation_url ? styles.animationBadge : 
              styles.defaultBadge
            ]}>
              <Text style={styles.imageTypeText}>
                {item.bom_asset.preview_image ? '🖼️' : 
                 item.bom_asset.animation_url ? '🎬' : '📷'}
              </Text>
            </View>
            
            {/* BADGE RARETÉ */}
            <View style={styles.rarityBadge}>
              <Text style={styles.rarityText}>
                {getRarityIcon(editionType)}
              </Text>
            </View>
          </View>
          
          <Text style={styles.itemTitle}>{assetTitle}</Text>
          
          {artistName && (
            <Text style={styles.itemArtist}>par {artistName}</Text>
          )}
          
          <View style={styles.itemDetails}>
            <Text style={styles.itemValue}>
              💎 {formatCurrencyValue(assetValue)}
            </Text>
            <Text style={styles.itemRarity}>
              {editionType}
            </Text>
          </View>
          
          <View style={styles.itemActions}>
            <TouchableOpacity
              style={[styles.itemActionButton, styles.observeButton]}
              onPress={() => onObserveNFT(item)}
            >
              <Text style={styles.itemActionText}>👁️ Observer</Text>
            </TouchableOpacity>
            
            {item.is_transferable !== false && (
              <TouchableOpacity
                style={[styles.itemActionButton, styles.giftButton]}
                onPress={() => onSendGift(item)}
              >
                <Text style={styles.itemActionText}>🎁 Offrir</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const boxColor = getBoxColor(type);
  const rotation = animation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg']
  });

  const height = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [0, Math.min(filteredItems.length * 180, 400)] // Limite de hauteur
  });

  const getIconForType = () => {
    switch (type) {
      case 'collection': return '📦';
      case 'rarity': return '💎';
      case 'artist': return '👤';
      default: return icon;
    }
  };

  // ✅ AFFICHAGE SI PAS D'ITEMS - CORRECTION RENFORCÉE
  const hasItems = filteredItems.length > 0;

  // 🔥 CORRECTION: Protection UI si aucun item valide
  if (!hasItems) {
    console.log(`📭 [INVENTORY_BOX] "${title}" - Aucun BOOM valide en inventaire`);
    return (
      <View style={[styles.container, { borderLeftColor: boxColor }]}>
        <View style={styles.header}>
          <View style={styles.headerContent}>
            <View style={[styles.iconContainer, { backgroundColor: boxColor }]}>
              <Text style={styles.icon}>{getIconForType()}</Text>
            </View>
            
            <View style={styles.headerText}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.count}>Aucun BOOM en inventaire</Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { borderLeftColor: boxColor }]}>
      {/* EN-TÊTE DE LA BOÎTE */}
      <TouchableOpacity 
        style={styles.header}
        onPress={toggleExpand}
        activeOpacity={0.8}
        disabled={!hasItems} // Désactive le toggle si pas d'items
      >
        <View style={styles.headerContent}>
          <View style={[styles.iconContainer, { backgroundColor: boxColor }]}>
            <Text style={styles.icon}>{getIconForType()}</Text>
          </View>
          
          <View style={styles.headerText}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.count}>
              {hasItems 
                ? `${filteredItems.length} BOOM${filteredItems.length > 1 ? 's' : ''} • Valeur: ${formatCurrencyValue(getTotalValue())}`
                : 'Aucun BOOM'
              }
            </Text>
          </View>
          
          {hasItems && (
            <Animated.View style={{ transform: [{ rotate: rotation }] }}>
              <Text style={styles.arrow}>▼</Text>
            </Animated.View>
          )}
        </View>
      </TouchableOpacity>

      {/* CONTENU DÉPLIABLE */}
      <Animated.View style={[styles.content, { height }]}>
        {isExpanded && hasItems ? (
          <FlatList
            data={filteredItems}
            renderItem={renderItem}
            keyExtractor={(item) => `${item?.id}-${item?.bom_asset?.id ?? 'unknown'}`}
            scrollEnabled={true}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.itemsList}
            ListEmptyComponent={
              <View style={styles.emptyListContainer}>
                <Text style={styles.emptyListText}>Aucun BOOM dans cette catégorie</Text>
              </View>
            }
          />
        ) : isExpanded && !hasItems ? (
          <View style={styles.emptyContent}>
            <Text style={styles.emptyText}>Cette catégorie est vide</Text>
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
};

const getBoxColor = (type: string) => {
  switch (type) {
    case 'collection': return '#667eea'; // Bleu
    case 'rarity': return '#9B59B6'; // Violet
    case 'artist': return '#2ECC71'; // Vert
    default: return '#FFD700'; // Or
  }
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginVertical: 8,
    marginHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
    borderLeftWidth: 6,
    overflow: 'hidden',
  },
  header: {
    padding: 20,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  icon: {
    fontSize: 24,
    color: '#fff',
    fontWeight: 'bold',
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  count: {
    fontSize: 12,
    color: '#666',
  },
  arrow: {
    fontSize: 18,
    color: '#999',
    paddingHorizontal: 10,
  },
  content: {
    overflow: 'hidden',
  },
  itemsList: {
    padding: 16,
  },
  boxItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    backgroundColor: '#fafafa',
    borderRadius: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  itemContent: {
    flex: 1,
  },
  thumbnailContainer: {
    position: 'relative',
    marginBottom: 12,
    height: 80,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#f5f5f5',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
  },
  imageTypeBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  previewBadge: {
    backgroundColor: 'rgba(255, 193, 7, 0.95)',
  },
  animationBadge: {
    backgroundColor: 'rgba(155, 89, 182, 0.95)',
  },
  defaultBadge: {
    backgroundColor: 'rgba(102, 126, 234, 0.95)',
  },
  imageTypeText: {
    fontSize: 10,
    color: '#fff',
    fontWeight: 'bold',
  },
  rarityBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fff',
  },
  rarityText: {
    fontSize: 10,
    color: '#fff',
    fontWeight: 'bold',
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  itemArtist: {
    fontSize: 12,
    color: '#667eea',
    marginBottom: 8,
    fontWeight: '500',
  },
  itemDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  itemValue: {
    fontSize: 14,
    color: '#28a745',
    fontWeight: '600',
  },
  itemRarity: {
    fontSize: 12,
    color: '#9B59B6',
    fontWeight: '600',
    backgroundColor: '#f3e6ff',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  itemActions: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  itemActionButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  observeButton: {
    backgroundColor: '#4CAF50',
  },
  giftButton: {
    backgroundColor: '#FFD700',
  },
  itemActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
  },
  emptyListContainer: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyListText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
  emptyContent: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
});

export default InventoryBox;