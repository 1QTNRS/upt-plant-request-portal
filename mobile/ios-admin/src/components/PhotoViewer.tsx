import { useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  FlatList,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  PHOTO_VIEWER_DISMISS_DISTANCE,
  normalizedSwipeVelocity,
  photoViewerBounces,
  photoViewerScrollEnabled,
  shouldCapturePhotoViewerDismiss,
  shouldDismissPhotoViewer,
} from "../photo-viewer";
import { THEME } from "../theme";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

type Photo = { id: string; url: string };

type Props = {
  photos: Photo[];
  index: number;
  onClose: () => void;
};

export function PhotoViewer({ photos, index, onClose }: Props) {
  const [current, setCurrent] = useState(index);
  const [zoomById, setZoomById] = useState<Record<string, number>>({});
  const zoomScaleRef = useRef(1);
  const zoomByIdRef = useRef<Record<string, number>>({});
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dragY = useRef(new Animated.Value(0)).current;
  const backdropOpacity = useMemo(
    () =>
      dragY.interpolate({
        inputRange: [0, PHOTO_VIEWER_DISMISS_DISTANCE * 2],
        outputRange: [1, 0.25],
        extrapolate: "clamp",
      }),
    [dragY],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) =>
          shouldCapturePhotoViewerDismiss(
            zoomScaleRef.current,
            gesture.dx,
            gesture.dy,
            gesture.numberActiveTouches,
          ),
        onPanResponderMove: (_, gesture) => {
          if (gesture.dy > 0) dragY.setValue(gesture.dy);
        },
        onPanResponderRelease: (_, gesture) => {
          if (
            shouldDismissPhotoViewer({
              zoomScale: zoomScaleRef.current,
              translationX: gesture.dx,
              translationY: gesture.dy,
              velocityY: normalizedSwipeVelocity(gesture.vy),
              numberActiveTouches: 1,
            })
          ) {
            onCloseRef.current();
            return;
          }
          Animated.spring(dragY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(dragY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        },
      }),
    [dragY],
  );

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
      <Animated.View
        style={[
          styles.backdrop,
          { opacity: backdropOpacity, transform: [{ translateY: dragY }] },
        ]}
        {...panResponder.panHandlers}
      >
        <View style={styles.topBar}>
          <Text style={styles.count}>
            {current + 1} of {photos.length}
          </Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
            <Text style={styles.close}>Close</Text>
          </Pressable>
        </View>
        <FlatList
          data={photos}
          horizontal
          pagingEnabled
          directionalLockEnabled
          initialScrollIndex={index}
          getItemLayout={(_, photoIndex) => ({
            length: SCREEN_WIDTH,
            offset: SCREEN_WIDTH * photoIndex,
            index: photoIndex,
          })}
          onMomentumScrollEnd={(event) => {
            const next = Math.round(event.nativeEvent.contentOffset.x / SCREEN_WIDTH);
            setCurrent(next);
            const photoId = photos[next]?.id;
            zoomScaleRef.current = photoId ? (zoomByIdRef.current[photoId] ?? 1) : 1;
          }}
          keyExtractor={(photo) => photo.id}
          renderItem={({ item }) => (
            <ScrollView
              style={styles.page}
              contentContainerStyle={styles.pageContent}
              maximumZoomScale={4}
              minimumZoomScale={1}
              scrollEnabled={photoViewerScrollEnabled(zoomById[item.id] ?? 1)}
              bounces={photoViewerBounces(zoomById[item.id] ?? 1)}
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
              centerContent
              scrollEventThrottle={16}
              onScroll={(event) => {
                const scale = event.nativeEvent.zoomScale;
                if (typeof scale === "number" && Number.isFinite(scale)) {
                  zoomScaleRef.current = scale;
                  zoomByIdRef.current[item.id] = scale;
                  setZoomById((currentZooms) => {
                    const previous = currentZooms[item.id] ?? 1;
                    if (photoViewerScrollEnabled(previous) === photoViewerScrollEnabled(scale)) {
                      return currentZooms;
                    }
                    return { ...currentZooms, [item.id]: scale };
                  });
                }
              }}
            >
              <Image
                source={{ uri: item.url }}
                style={styles.image}
                resizeMode="contain"
                accessibilityLabel="Request item photo"
              />
            </ScrollView>
          )}
        />
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#000000", overflow: "hidden" },
  topBar: {
    paddingTop: 54,
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  count: { color: THEME.white, fontWeight: "700" },
  close: { color: THEME.white, fontWeight: "700", fontSize: 16 },
  page: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT - 90 },
  pageContent: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT - 90,
    alignItems: "center",
    justifyContent: "center",
  },
  image: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT - 90 },
});
