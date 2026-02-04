import React, { useState, useRef, useEffect } from 'react';
import { 
  View, 
  TouchableOpacity, 
  StyleSheet, 
  ActivityIndicator,
  Text,
  Image,
  Animated
} from 'react-native';
import { Video, ResizeMode, Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';

interface NFTAnimationPlayerProps {
  animationUrl: string;        // URL GIF/MP4
  audioUrl?: string | null;    // Audio optionnel
  previewImage?: string | null;// Image statique (fallback)
  animationType?: 'gif' | 'mp4' | 'webm'; // Type d'animation
  autoPlay?: boolean;
  showControls?: boolean;
  style?: any;
  loop?: boolean;
  showNFTBadge?: boolean;      // Badge NFT
  tokenId?: string;            // ID unique NFT
  showTypeIndicator?: boolean; // Bulle "GIF/Vidéo"
}

export const NFTAnimationPlayer: React.FC<NFTAnimationPlayerProps> = ({ 
  animationUrl, 
  audioUrl, 
  previewImage,
  animationType = 'mp4',
  autoPlay = false,
  showControls = true,
  style,
  loop = true,
  showNFTBadge = true,
  tokenId,
  showTypeIndicator = true
}) => {
  const videoRef = useRef<Video>(null);
  const [status, setStatus] = useState<any>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isMuted, setIsMuted] = useState(!audioUrl);
  const [hasError, setHasError] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(animationUrl);
  const [retryCount, setRetryCount] = useState(0);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [useGifFallback, setUseGifFallback] = useState(false);
  
  // Animation pour le badge NFT
  const badgeScale = useRef(new Animated.Value(1)).current;

  // ✅ Détecter le type d'animation
  const detectAnimationType = (url: string): 'gif' | 'mp4' | 'image' => {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('.gif') || lowerUrl.includes('giphy')) {
      return 'gif';
    } else if (lowerUrl.match(/\.(mp4|mov|avi|mkv|webm|m4v)$/)) {
      return 'mp4';
    } else {
      return 'image';
    }
  };

  // ✅ Valider et corriger l'URL
  const validateAndFixUrl = (url: string): string => {
    if (!url || !url.startsWith('http')) {
      console.warn('URL animation invalide:', url);
      
      // Essayer avec l'image de preview
      if (previewImage && previewImage.startsWith('http')) {
        console.log('🔄 Utilisation preview_image comme fallback');
        return previewImage;
      }
      
      // Fallback par défaut (GIF animé de test)
      return 'https://media.giphy.com/media/3o7abAHdYvZdBNnGZq/giphy.gif';
    }
    
    return url;
  };

  useEffect(() => {
    // Corriger l'URL au chargement
    const fixedUrl = validateAndFixUrl(animationUrl);
    if (fixedUrl !== animationUrl) {
      console.log('✅ URL corrigée:', fixedUrl);
      setCurrentUrl(fixedUrl);
    }
    
    // Détecter le type
    const detectedType = detectAnimationType(fixedUrl);
    setUseGifFallback(detectedType === 'gif');
    
    // Animation du badge NFT
    if (showNFTBadge) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(badgeScale, {
            toValue: 1.1,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(badgeScale, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [animationUrl, showNFTBadge]);

  const handlePlaybackStatusUpdate = (playbackStatus: any) => {
    setStatus(playbackStatus);
    
    if (playbackStatus.isLoaded) {
      setIsLoading(false);
      setHasError(false);
      setIsPlaying(playbackStatus.isPlaying);
    }
    
    if (playbackStatus.error) {
      console.error('Erreur animation:', playbackStatus.error);
      
      // Tentative de rechargement
      if (retryCount < 2) {
        setTimeout(() => {
          if (videoRef.current) {
            videoRef.current.loadAsync(
              { uri: currentUrl },
              { shouldPlay: autoPlay }
            );
          }
          setRetryCount(prev => prev + 1);
        }, 1000);
      } else {
        // Basculer vers GIF si MP4 échoue
        if (!useGifFallback && previewImage) {
          console.log('🔄 Basculer vers GIF/Image de fallback');
          setUseGifFallback(true);
          setCurrentUrl(previewImage);
          setRetryCount(0);
        } else {
          setHasError(true);
          setIsLoading(false);
        }
      }
    }
  };

  const togglePlayPause = async () => {
    if (!videoRef.current) return;
    
    if (isPlaying) {
      await videoRef.current.pauseAsync();
      setIsPlaying(false);
    } else {
      await videoRef.current.playAsync();
      setIsPlaying(true);
    }
  };

  const toggleMute = async () => {
    if (!audioUrl || !videoRef.current) return;
    
    setIsMuted(!isMuted);
    await videoRef.current.setIsMutedAsync(!isMuted);
  };

  const retryPlayback = async () => {
    setHasError(false);
    setIsLoading(true);
    setRetryCount(0);
    
    if (videoRef.current) {
      await videoRef.current.loadAsync(
        { uri: currentUrl },
        { shouldPlay: autoPlay }
      );
    }
  };

  const renderNFTBadge = () => {
    if (!showNFTBadge) return null;
    
    return (
      <Animated.View style={[styles.nftBadge, { transform: [{ scale: badgeScale }] }]}>
        <Text style={styles.nftBadgeText}>🎨 NFT</Text>
        {tokenId && (
          <Text style={styles.nftTokenId}>#{tokenId.substring(0, 8)}</Text>
        )}
      </Animated.View>
    );
  };

  const renderAnimationType = () => {
    if (!showTypeIndicator) {
      return null;
    }
    return (
      <View style={styles.typeIndicator}>
        <Text style={styles.typeText}>
          {useGifFallback ? '🔄 GIF' : '🎬 VIDÉO'}
          {audioUrl && ' 🔊'}
        </Text>
      </View>
    );
  };

  if (hasError) {
    return (
      <View style={[styles.container, style, styles.errorContainer]}>
        <Text style={styles.errorIcon}>❌</Text>
        <Text style={styles.errorText}>Animation non disponible</Text>
        <Text style={styles.errorSubtext}>Vérifiez votre connexion</Text>
        <TouchableOpacity style={styles.retryButton} onPress={retryPlayback}>
          <Text style={styles.retryButtonText}>🔄 Réessayer</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Si c'est un GIF ou fallback image
  if (useGifFallback || detectAnimationType(currentUrl) === 'gif') {
    return (
      <View style={[styles.container, style]}>
        <Image
          source={{ uri: currentUrl }}
          style={styles.gifImage}
          resizeMode="cover"
          onLoadStart={() => setIsLoading(true)}
          onLoadEnd={() => setIsLoading(false)}
          onError={() => {
            console.error('Erreur chargement GIF');
            setHasError(true);
          }}
        />
        
        {isLoading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#667eea" />
            <Text style={styles.loadingText}>Chargement GIF...</Text>
          </View>
        )}
        
        {renderNFTBadge()}
        {renderAnimationType()}
      </View>
    );
  }

  // Sinon, c'est une vidéo
  return (
    <View style={[styles.container, style]}>
      <Video
        ref={videoRef}
        source={{ uri: currentUrl }}
        style={styles.video}
        resizeMode={ResizeMode.COVER}
        isLooping={loop}
        isMuted={isMuted}
        shouldPlay={autoPlay}
        usePoster={!!previewImage}
        posterSource={previewImage ? { uri: previewImage } : undefined}
        onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
        onLoadStart={() => setIsLoading(true)}
      />

      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#667eea" />
          <Text style={styles.loadingText}>Chargement NFT...</Text>
        </View>
      )}

      {showControls && !isLoading && !hasError && (
        <View style={styles.controlsOverlay}>
          <TouchableOpacity style={styles.controlButton} onPress={togglePlayPause}>
            <Text style={styles.controlIcon}>
              {isPlaying ? '⏸️' : '▶️'}
            </Text>
          </TouchableOpacity>

          {audioUrl && (
            <TouchableOpacity style={styles.controlButton} onPress={toggleMute}>
              <Text style={styles.controlIcon}>
                {isMuted ? '🔇' : '🔊'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {renderNFTBadge()}
      {renderAnimationType()}

      {showControls && status.isLoaded && (
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View 
              style={[
                styles.progressFill, 
                { width: `${(status.positionMillis / (status.durationMillis || 1)) * 100}%` }
              ]} 
            />
          </View>
          <Text style={styles.timeText}>
            {formatTime(status.positionMillis)} / {formatTime(status.durationMillis)}
          </Text>
        </View>
      )}
    </View>
  );
};

const formatTime = (millis: number) => {
  if (!millis || millis <= 0) return '0:00';
  const minutes = Math.floor(millis / 60000);
  const seconds = Math.floor((millis % 60000) / 1000);
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000',
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 2,
    borderColor: '#333',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  gifImage: {
    width: '100%',
    height: '100%',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: 'white',
    marginTop: 12,
    fontSize: 14,
    fontWeight: '500',
  },
  controlsOverlay: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 25,
    padding: 10,
    alignItems: 'center',
  },
  controlButton: {
    padding: 10,
    marginHorizontal: 5,
  },
  controlIcon: {
    fontSize: 22,
  },
  progressContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.8)',
    padding: 12,
  },
  progressBar: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 2,
    marginBottom: 6,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#667eea',
    borderRadius: 2,
  },
  timeText: {
    color: 'white',
    fontSize: 12,
    textAlign: 'center',
    fontFamily: 'monospace',
  },
  errorContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    minHeight: 200,
    padding: 20,
    borderWidth: 2,
    borderColor: '#ff4444',
    borderStyle: 'dashed',
  },
  errorIcon: {
    fontSize: 40,
    marginBottom: 10,
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  errorSubtext: {
    color: '#aaa',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 20,
    backgroundColor: '#667eea',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  retryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  nftBadge: {
    position: 'absolute',
    top: 15,
    left: 15,
    backgroundColor: 'rgba(102, 126, 234, 0.9)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  nftBadgeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
    marginRight: 6,
  },
  nftTokenId: {
    color: 'white',
    fontSize: 10,
    opacity: 0.9,
    fontFamily: 'monospace',
  },
  typeIndicator: {
    position: 'absolute',
    top: 15,
    right: 15,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 15,
  },
  typeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '600',
  },
});