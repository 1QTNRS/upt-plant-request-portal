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
  PHOTO_VIEWER_EDGE_BACK,
  clampPhotoViewerZoom,
  normalizedSwipeVelocity,
  photoViewerDismissTranslateY,
  photoViewerImageLayout,
  photoViewerImageTransform,
  photoViewerKeepZoomAfterPan,
  photoViewerPageDelta,
  photoViewerPagingEnabled,
  photoViewerShouldPanImage,
  photoViewerShouldResetZoomForPage,
  photoViewerSourceUri,
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
  const listRef = useRef<FlatList<Photo>>(null);
  const [current, setCurrent] = useState(index);
  const [photosMounted, setPhotosMounted] = useState(true);
  const [imageOffset, setImageOffset] = useState(resetPhotoViewerImageTransform);
  const [viewport, setViewport] = useState({
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT - 90,
  });
  const zoomScaleRef = useRef(1);
  const pinchBaseRef = useRef(1);
  const imagePanStart = useRef({ x: 0, y: 0 });
  const imageOffsetRef = useRef(imageOffset);
  imageOffsetRef.current = imageOffset;
  const currentRef = useRef(current);
  currentRef.current = current;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
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
    dragY.setValue(0);
  }).current;

  const closeViewer = () => {
    resetImage();
    setPhotosMounted(false);
    requestAnimationFrame(() => onCloseRef.current());
  };

  useEffect(() => {
    resetImage();
  }, [resetImage]);

  const applyZoomRef = useRef<(scale: number) => void>(() => undefined);
  applyZoomRef.current = (scale: number) => {
    const next = clampPhotoViewerZoom(scale);
    zoomScaleRef.current = next;
    if (photoViewerPagingEnabled(next)) {
      imagePanStart.current = { x: 0, y: 0 };
      setImageOffset(resetPhotoViewerImageTransform());
      return;
    }
    setImageOffset((prev) =>
      photoViewerImageTransform(next, prev.translateX, prev.translateY),
    );
  };

  const goToPageRef = useRef<(nextIndex: number) => void>(() => undefined);
  goToPageRef.current = (nextIndex: number) => {
    const clamped = Math.max(0, Math.min(photos.length - 1, nextIndex));
    if (photoViewerShouldResetZoomForPage(currentRef.current, clamped)) {
      applyZoomRef.current(1);
    }
    setCurrent(clamped);
    dragY.setValue(0);
    listRef.current?.scrollToOffset({
      offset: clamped * viewportRef.current.width,
      animated: true,
    });
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

    const pan = Gesture.Pan()
      .maxPointers(1)
      .runOnJS(true)
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
        if (pointers !== 1 || !photoViewerPagingEnabled(zoomScaleRef.current)) return;
        if (Math.abs(event.translationY) > Math.abs(event.translationX)) {
          dragY.setValue(photoViewerDismissTranslateY(event.translationY));
          return;
        }
        listRef.current?.scrollToOffset({
          offset: currentRef.current * viewportRef.current.width - event.translationX,
          animated: false,
        });
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
          setPhotosMounted(false);
          requestAnimationFrame(() => onCloseRef.current());
          return;
        }
        if (photoViewerKeepZoomAfterPan(zoomScaleRef.current)) {
          const next = photoViewerImageTransform(
            zoomScaleRef.current,
            imagePanStart.current.x + event.translationX,
            imagePanStart.current.y + event.translationY,
          );
          imagePanStart.current = { x: next.translateX, y: next.translateY };
          setImageOffset(next);
          return;
        }
        const delta = photoViewerPageDelta(
          event.translationX,
          event.translationY,
          photos.length,
          currentRef.current,
        );
        goToPageRef.current(currentRef.current + delta);
        Animated.spring(dragY, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      });

    return Gesture.Simultaneous(pinch, pan);
  }, [dragY, resetImage]);

  const rendered = photoViewerImageLayout(
    imageOffset.scale,
    imageOffset.translateX,
    imageOffset.translateY,
    viewport.width,
    viewport.height,
  );

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={closeViewer}>
      <GestureHandlerRootView style={styles.root}>
        <View style={styles.chrome}>
          <View style={styles.topBar}>
            <Text style={styles.count}>
              {current + 1} of {photos.length}
            </Text>
            <Pressable onPress={closeViewer} hitSlop={12} accessibilityRole="button">
              <Text style={styles.close}>Close</Text>
            </Pressable>
          </View>
          <Animated.View
            style={[
              styles.stage,
              { opacity: sheetOpacity, transform: [{ translateY: dragY }] },
            ]}
            onLayout={(event) => {
              const { width, height } = event.nativeEvent.layout;
              if (width <= 0 || height <= 0) return;
              setViewport((was) =>
                was.width === width && was.height === height ? was : { width, height },
              );
            }}
          >
            {photosMounted ? (
              <FlatList
                ref={listRef}
                data={photos}
                horizontal
                pagingEnabled
                directionalLockEnabled
                scrollEnabled={false}
                initialScrollIndex={index > 0 ? index : undefined}
                removeClippedSubviews={false}
                windowSize={Math.max(photos.length, 1)}
                maxToRenderPerBatch={Math.max(photos.length, 1)}
                initialNumToRender={Math.max(photos.length, 1)}
                extraData={`${mountId}-${rendered.left}-${rendered.top}-${rendered.width}`}
                getItemLayout={(_, photoIndex) => ({
                  length: viewport.width,
                  offset: viewport.width * photoIndex,
                  index: photoIndex,
                })}
                keyExtractor={(photo) => `${mountId}-${photo.id}`}
                renderItem={({ item }) => (
                  <View
                    style={[styles.page, { width: viewport.width, height: viewport.height }]}
                    collapsable={false}
                  >
                    <Image
                      key={`${mountId}-${item.id}`}
                      source={{ uri: photoViewerSourceUri(item.url, mountId) }}
                      style={[
                        styles.image,
                        {
                          width: rendered.width,
                          height: rendered.height,
                          left: rendered.left,
                          top: rendered.top,
                        },
                      ]}
                      resizeMode="contain"
                      accessibilityLabel="Request item photo"
                    />
                  </View>
                )}
              />
            ) : null}
            <GestureDetector gesture={composed}>
              <View
                style={[styles.gestureOverlay, { left: PHOTO_VIEWER_EDGE_BACK }]}
                collapsable={false}
              />
            </GestureDetector>
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000000" },
  chrome: { flex: 1, backgroundColor: "#000000" },
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
  stage: { flex: 1, overflow: "hidden" },
  page: {
    overflow: "hidden",
  },
  image: { position: "absolute" },
  gestureOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "transparent",
  },
});
