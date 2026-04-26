import { useRef, useCallback } from 'react';
import { Animated } from 'react-native';

const SCROLL_THRESHOLD = 100; // px scrolled before floating button can appear

export function useScrollAwareHeader() {
  const lastScrollY = useRef(0);
  const floatingMenuAnim = useRef(new Animated.Value(-100)).current;
  const isFloatingVisible = useRef(false);

  const showFloating = useCallback(() => {
    if (isFloatingVisible.current) return;
    isFloatingVisible.current = true;
    Animated.spring(floatingMenuAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 80,
      friction: 10,
    }).start();
  }, [floatingMenuAnim]);

  const hideFloating = useCallback(() => {
    if (!isFloatingVisible.current) return;
    isFloatingVisible.current = false;
    Animated.spring(floatingMenuAnim, {
      toValue: -100,
      useNativeDriver: true,
      tension: 80,
      friction: 10,
    }).start();
  }, [floatingMenuAnim]);

  const onScroll = useCallback(
    (event: any) => {
      const currentY = event.nativeEvent.contentOffset.y;
      const diff = currentY - lastScrollY.current;
      lastScrollY.current = currentY;

      if (currentY < SCROLL_THRESHOLD) {
        // Near the top — original button is visible
        hideFloating();
      } else if (diff < -2) {
        // Scrolling up and past threshold
        showFloating();
      } else if (diff > 2) {
        // Scrolling down
        hideFloating();
      }
    },
    [showFloating, hideFloating]
  );

  return { onScroll, floatingMenuAnim };
}
