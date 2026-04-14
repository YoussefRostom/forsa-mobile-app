import { Ionicons } from '@expo/vector-icons';
import { ResizeMode, Video } from 'expo-av';
import React, { memo, useMemo, useState } from 'react';
import {
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

type MediaKind = 'image' | 'video';

type FeedMediaItem = {
  key: string;
  uri: string;
  type: MediaKind;
};

const clamp = (value: number, min: number, max: number) => {
  'worklet';
  return Math.min(Math.max(value, min), max);
};

const inferMediaType = (value: unknown): MediaKind => {
  const text = String(value ?? '').toLowerCase();
  return text.includes('video') || /\.(mp4|mov|m4v|webm)$/i.test(text) ? 'video' : 'image';
};

const normalizeMedia = (post: any): FeedMediaItem[] => {
  const candidates: any[] = [];

  if (Array.isArray(post?.mediaItems)) candidates.push(...post.mediaItems);
  if (Array.isArray(post?.media)) candidates.push(...post.media);

  if (Array.isArray(post?.mediaUrls)) {
    post.mediaUrls.forEach((uri: string, index: number) => {
      candidates.push({
        uri,
        type: Array.isArray(post?.mediaTypes) ? post.mediaTypes[index] : post?.mediaType,
      });
    });
  }

  if (post?.mediaUrl) {
    candidates.push({ uri: post.mediaUrl, type: post.mediaType });
  }

  const seen = new Set<string>();

  return candidates
    .map((entry, index) => {
      const uri =
        typeof entry === 'string'
          ? entry
          : entry?.uri || entry?.url || entry?.mediaUrl || entry?.secureUrl || null;

      if (!uri || seen.has(uri)) return null;
      seen.add(uri);

      return {
        key: `${uri}-${index}`,
        uri,
        type: inferMediaType(entry?.type || entry?.mediaType || entry?.resourceType || uri),
      } satisfies FeedMediaItem;
    })
    .filter(Boolean) as FeedMediaItem[];
};

function ZoomableStage({ item }: { item: FeedMediaItem }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const resetTransform = () => {
    'worklet';
    scale.value = withSpring(1, { damping: 16, stiffness: 180 });
    savedScale.value = 1;
    translateX.value = withSpring(0, { damping: 16, stiffness: 180 });
    translateY.value = withSpring(0, { damping: 16, stiffness: 180 });
  };

  const pinchGesture = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = clamp(savedScale.value * event.scale, 1, 4);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1.02) {
        resetTransform();
      }
    });

  const panGesture = Gesture.Pan()
    .onStart(() => {
      startX.value = translateX.value;
      startY.value = translateY.value;
    })
    .onUpdate((event) => {
      if (scale.value <= 1.01) return;
      translateX.value = startX.value + event.translationX;
      translateY.value = startY.value + event.translationY;
    })
    .onEnd(() => {
      if (scale.value <= 1.02) {
        resetTransform();
      }
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(250)
    .onEnd(() => {
      if (scale.value > 1.02) {
        resetTransform();
      } else {
        scale.value = withSpring(2.2, { damping: 16, stiffness: 180 });
        savedScale.value = 2.2;
      }
    });

  // Keep advanced gestures inside the modal so they don't fight with the main feed scroll.
  const mediaGesture = Gesture.Simultaneous(pinchGesture, panGesture, doubleTapGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: scale.value },
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
  }));

  return (
    <GestureDetector gesture={mediaGesture}>
      <Animated.View style={[styles.viewerMediaShell, animatedStyle]}>
        {item.type === 'video' ? (
          <Video
            source={{ uri: item.uri }}
            style={styles.viewerMedia}
            useNativeControls
            resizeMode={ResizeMode.CONTAIN}
            isLooping={false}
          />
        ) : (
          <Image source={{ uri: item.uri }} style={styles.viewerMedia} resizeMode="contain" />
        )}
      </Animated.View>
    </GestureDetector>
  );
}

function ZoomableFeedMedia({ post }: { post: any }) {
  const mediaItems = useMemo(() => normalizeMedia(post), [post]);
  const { width } = useWindowDimensions();
  const [viewerVisible, setViewerVisible] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [imageHeights, setImageHeights] = useState<Record<string, number>>({});

  const usableWidth = Math.max(Math.min(width - 96, 520), 240);

  const getPreviewHeight = (item: FeedMediaItem) => {
    if (item.type === 'video') return 240;
    return imageHeights[item.key] || (mediaItems.length > 1 ? 240 : 280);
  };

  const handleImageLoad = (item: FeedMediaItem, event: any) => {
    const source = event?.nativeEvent?.source;
    if (!source?.width || !source?.height) return;

    const nextHeight = Math.min(Math.max(usableWidth * (source.height / source.width), 200), mediaItems.length > 1 ? 320 : 420);
    setImageHeights((prev) => (prev[item.key] === nextHeight ? prev : { ...prev, [item.key]: nextHeight }));
  };

  if (!mediaItems.length) {
    return null;
  }

  const renderPreview = (item: FeedMediaItem, index: number) => (
    <TouchableOpacity
      key={item.key}
      style={[
        styles.previewCard,
        mediaItems.length > 1 && { width: usableWidth, marginRight: index === mediaItems.length - 1 ? 0 : 12 },
        { height: getPreviewHeight(item) },
      ]}
      activeOpacity={0.92}
      onPress={() => {
        setSelectedIndex(index);
        setViewerVisible(true);
      }}
    >
      {item.type === 'video' ? (
        <Video
          source={{ uri: item.uri }}
          style={styles.previewMedia}
          useNativeControls
          resizeMode={ResizeMode.COVER}
          isLooping={false}
        />
      ) : (
        <Image
          source={{ uri: item.uri }}
          style={styles.previewMedia}
          resizeMode="cover"
          onLoad={(event) => handleImageLoad(item, event)}
        />
      )}

      <View style={styles.previewOverlay}>
        <View style={styles.expandBadge}>
          <Ionicons name="scan-outline" size={16} color="#fff" />
          <Text style={styles.expandBadgeText}>Zoom</Text>
        </View>
        {mediaItems.length > 1 && (
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{index + 1}/{mediaItems.length}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <>
      {mediaItems.length > 1 ? (
        // Use a horizontal strip for multi-media posts so wider content can be browsed without stretching the whole feed.
        <ScrollView
          horizontal
          pagingEnabled
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          contentContainerStyle={styles.previewScrollerContent}
          style={styles.previewScroller}
        >
          {mediaItems.map(renderPreview)}
        </ScrollView>
      ) : (
        renderPreview(mediaItems[0], 0)
      )}

      <Modal
        visible={viewerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setViewerVisible(false)}
        statusBarTranslucent
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => setViewerVisible(false)}
            activeOpacity={0.8}
          >
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>

          <View style={styles.hintPill}>
            <Ionicons name="expand-outline" size={14} color="#fff" />
            <Text style={styles.hintText}>Pinch or double tap to zoom</Text>
          </View>

          {mediaItems.length > 1 ? (
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              contentOffset={{ x: selectedIndex * width, y: 0 }}
              onMomentumScrollEnd={(event) => {
                const nextIndex = Math.round(event.nativeEvent.contentOffset.x / Math.max(width, 1));
                setSelectedIndex(nextIndex);
              }}
            >
              {mediaItems.map((item) => (
                <View key={`viewer-${item.key}`} style={[styles.viewerPage, { width }]}>
                  <ZoomableStage item={item} />
                </View>
              ))}
            </ScrollView>
          ) : (
            <View style={[styles.viewerPage, { width }]}>
              <ZoomableStage item={mediaItems[0]} />
            </View>
          )}
        </View>
      </Modal>
    </>
  );
}

export default memo(ZoomableFeedMedia);

const styles = StyleSheet.create({
  previewScroller: {
    marginVertical: 12,
  },
  previewScrollerContent: {
    paddingRight: 4,
  },
  previewCard: {
    position: 'relative',
    width: '100%',
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#111',
    marginVertical: 12,
  },
  previewMedia: {
    width: '100%',
    height: '100%',
    backgroundColor: '#111',
  },
  previewOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    padding: 12,
  },
  expandBadge: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  expandBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  countBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  countBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.96)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 54,
    right: 20,
    zIndex: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderRadius: 18,
    padding: 8,
  },
  hintPill: {
    position: 'absolute',
    top: 56,
    left: 20,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  hintText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  viewerPage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  viewerMediaShell: {
    width: '100%',
    height: '72%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerMedia: {
    width: '100%',
    height: '100%',
  },
});