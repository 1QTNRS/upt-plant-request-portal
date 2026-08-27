import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";

import {
  PHOTO_VIEWER_DISMISS_ACTIVE_OFFSET_Y,
  PHOTO_VIEWER_DISMISS_FAIL_OFFSET_X,
  clampPhotoViewerZoom,
  normalizedSwipeVelocity,
  photoViewerDismissTranslateY,
  photoViewerImageTransform,
  photoViewerPagingEnabled,
  photoViewerShouldPanImage,
  resetPhotoViewerImageTransform,
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
  const mountId = useRef(`pv-${Date.now()}-${index}`).current;
  const [current, setCurrent] = useState(index);
  const [pagingEnabled, setPagingEnabled] = useState(true);
  const [imageOffset, setImageOffset] = useState(resetPhotoViewerImageTransform);
  const zoomScaleRef = useRef(1);
  const pinchBaseRef = useRef(1);
  const imagePanStart = useRef({ x: 0, y: 0 });
  const imageOffsetRef = useRef(imageOffset);
  imageOffsetRef.current = imageOffset;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dragY = useRef(new Animated.Value(0)).current;
  const sheetOpacity = useMemo(
    () =>
      dragY.interpolate({
        inputRange: [0, SCREEN_HEIGHT],
        outputRange: [1, 0],
        extrapolate: "clamp",
      }),
    [dragY],
  );

  const resetImage = useRef(() => {
    zoomScaleRef.current = 1;
    pinchBaseRef.current = 1;
    imagePanStart.current = { x: 0, y: 0 };
    setImageOffset(resetPhotoViewerImageTransform());
    setPagingEnabled(true);
    dragY.setValue(0);
  }).current;

  const closeViewer = () => {
    resetImage();
    onCloseRef.current();
  };

  useEffect(() => {
    resetImage();
  }, [resetImage]);

  const applyZoomRef = useRef<(scale: number) => void>(() => undefined);
  applyZoomRef.current = (scale: number) => {
    const next = clampPhotoViewerZoom(scale);
    zoomScaleRef.current = next;
    const paging = photoViewerPagingEnabled(next);
    setPagingEnabled((was) => (was === paging ? was : paging));
    if (paging) {
      imagePanStart.current = { x: 0, y: 0 };
      setImageOffset(resetPhotoViewerImageTransform());
      return;
    }
    setImageOffset((prev) =>
      photoViewerImageTransform(next, prev.translateX, prev.translateY),
    );
  };

  const composed = useMemo(() => {
    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onBegin(() => {
        pinchBaseRef.current = zoomScaleRef.current;
      })
      .onUpdate((event) => {
        applyZoomRef.current(pinchBaseRef.current * event.scale);
      })
      .onEnd(() => {
        if (photoViewerPagingEnabled(zoomScaleRef.current)) {
          imagePanStart.current = { x: 0, y: 0 };
          setImageOffset(resetPhotoViewerImageTransform());
        }
      });

    const pan = Gesture.Pan().maxPointers(1).runOnJS(true);
    if (pagingEnabled) {
      pan
        .activeOffsetY([...PHOTO_VIEWER_DISMISS_ACTIVE_OFFSET_Y])
        .failOffsetX([...PHOTO_VIEWER_DISMISS_FAIL_OFFSET_X]);
    }

    pan
      .onBegin(() => {
        dragY.stopAnimation();
        imagePanStart.current = {
          x: imageOffsetRef.current.translateX,
          y: imageOffsetRef.current.translateY,
        };
      })
      .onUpdate((event) => {
        const pointers = event.numberOfPointers ?? 1;
        if (photoViewerShouldPanImage(zoomScaleRef.current, pointers)) {
          setImageOffset(
            photoViewerImageTransform(
              zoomScaleRef.current,
              imagePanStart.current.x + event.translationX,
              imagePanStart.current.y + event.translationY,
            ),
          );
          return;
        }
        if (pointers !== 1) return;
        dragY.setValue(photoViewerDismissTranslateY(event.translationY));
      })
      .onEnd((event) => {
        const pointers = event.numberOfPointers ?? 1;
        if (
          shouldDismissPhotoViewer({
            zoomScale: zoomScaleRef.current,
            translationX: event.translationX,
            translationY: event.translationY,
            velocityY: normalizedSwipeVelocity(event.velocityY),
            numberActiveTouches: pointers,
          })
        ) {
          resetImage();
          onCloseRef.current();
          return;
        }
        if (photoViewerShouldPanImage(zoomScaleRef.current, pointers)) {
          const next = photoViewerImageTransform(
            zoomScaleRef.current,
            imagePanStart.current.x + event.translationX,
            imagePanStart.current.y + event.translationY,
          );
          imagePanStart.current = { x: next.translateX, y: next.translateY };
          setImageOffset(next);
          return;
        }
        Animated.spring(dragY, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      });

    return Gesture.Simultaneous(pinch, pan);
  }, [dragY, pagingEnabled, resetImage]);

  const rendered = photoViewerImageTransform(
    imageOffset.scale,
    imageOffset.translateX,
    imageOffset.translateY,
  );

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={closeViewer}>
      <GestureHandlerRootView style={styles.root}>
        <Animated.View
          style={[
            styles.sheet,
            { opacity: sheetOpacity, transform: [{ translateY: dragY }] },
          ]}
        >
          <View style={styles.topBar}>
            <Text style={styles.count}>
              {current + 1} of {photos.length}
            </Text>
            <Pressable onPress={closeViewer} hitSlop={12} accessibilityRole="button">
              <Text style={styles.close}>Close</Text>
            </Pressable>
          </View>
          <GestureDetector gesture={composed}>
            <View style={styles.list}>
              <FlatList
                data={photos}
                horizontal
                pagingEnabled
                directionalLockEnabled
                scrollEnabled={pagingEnabled}
                initialScrollIndex={index}
                removeClippedSubviews={false}
                windowSize={Math.max(photos.length, 1)}
                maxToRenderPerBatch={Math.max(photos.length, 1)}
                initialNumToRender={Math.max(photos.length, 1)}
                getItemLayout={(_, photoIndex) => ({
                  length: SCREEN_WIDTH,
                  offset: SCREEN_WIDTH * photoIndex,
                  index: photoIndex,
                })}
                onMomentumScrollEnd={(event) => {
                  const next = Math.round(event.nativeEvent.contentOffset.x / SCREEN_WIDTH);
                  setCurrent(next);
                  applyZoomRef.current(1);
                  dragY.setValue(0);
                }}
                keyExtractor={(photo) => `${mountId}-${photo.id}`}
                renderItem={({ item }) => (
                  <View style={styles.page} collapsable={false}>
                    <Image
                      key={`${mountId}-${item.id}`}
                      source={{ uri: item.url }}
                      style={[
                        styles.image,
                        {
                          transform: [
                            { translateX: rendered.translateX },
                            { translateY: rendered.translateY },
                            { scale: rendered.scale },
                          ],
                        },
                      ]}
                      resizeMode="contain"
                      accessibilityLabel="Request item photo"
                    />
                  </View>
                )}
              />
            </View>
          </GestureDetector>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000000" },
  sheet: { flex: 1, backgroundColor: "#000000", overflow: "hidden" },
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
  list: { flex: 1 },
  page: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT - 90,
    alignItems: "center",
    justifyContent: "center",
  },
  image: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT - 90 },
});
