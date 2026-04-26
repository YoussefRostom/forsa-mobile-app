import { Ionicons } from '@expo/vector-icons';
import * as VideoThumbnails from 'expo-video-thumbnails';
import React from 'react';
import { Image, ImageStyle, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

type Props = {
  uri: string;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  iconSize?: number;
};

export default function FeedVideoPreview({ uri, style, imageStyle, iconSize = 28 }: Props) {
  const [thumbnailUri, setThumbnailUri] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;

    const loadThumbnail = async () => {
      try {
        const { uri: nextUri } = await VideoThumbnails.getThumbnailAsync(uri, {
          time: 0,
          quality: 0.7,
        });
        if (active) {
          setThumbnailUri(nextUri);
        }
      } catch {
        if (active) {
          setThumbnailUri(null);
        }
      }
    };

    setThumbnailUri(null);
    void loadThumbnail();

    return () => {
      active = false;
    };
  }, [uri]);

  return (
    <View style={[styles.container, style]}>
      {thumbnailUri ? (
        <Image source={{ uri: thumbnailUri }} style={[styles.image, imageStyle]} resizeMode="cover" />
      ) : (
        <View style={[styles.fallback, imageStyle]} />
      )}
      <View style={styles.playBadge}>
        <Ionicons name="play" size={iconSize} color="#fff" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: '#111',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  fallback: {
    width: '100%',
    height: '100%',
    backgroundColor: '#111827',
  },
  playBadge: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -18 }, { translateY: -18 }],
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
