import { useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  FlatList,
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
  photoViewerImagePanEnabled,
  photoViewerPagingEnabled,
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
  const [pagingEnabled, setPagingEnabled] = useState(true);
  const zoomScaleRef = useRef(1);
  const pinchBaseRef = useRef(1);
  const imagePanStart = useRef({ x: 0, y: 0 });
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dragY = useRef(new Animated.Value(0)).current;
  const imageScale = useRef(new Animated.Value(1)).current;
  const imageX = useRef(new Animated.Value(0)).current;
  const imageY = useRef(new Animated.Value(0)).current;
  const sheetOpacity = useMemo(
    () =>
      dragY.interpolate({
        inputRange: [0, SCREEN_HEIGHT],
        outputRange: [1, 0],
        extrapolate: "clamp",
      }),
    [dragY],
  );

  const applyZoomRef = useRef<(scale: number) => void>(() => undefined);
  applyZoomRef.current = (scale: number) => {
    const next = clampPhotoViewerZoom(scale);
    zoomScaleRef.current = next;
    imageScale.setValue(next);
    const paging = photoViewerPagingEnabled(next);
    setPagingEnabled((was) => (was === paging ? was : paging));
    if (paging) {
      imagePanStart.current = { x: 0, y: 0 };
      imageX.setValue(0);
      imageY.setValue(0);
    }
  };

  const composed = useMemo(() => {
    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onBegin(() => {
        pinchBaseRef.current = zoomScaleRef.current;
      })
      .onUpdate((event) => {
        applyZoomRef.current(pinchBaseRef.current * event.scale);
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
      })
      .onUpdate((event) => {
        if (photoViewerImagePanEnabled(zoomScaleRef.current)) {
          imageX.setValue(imagePanStart.current.x + event.translationX);
          imageY.setValue(imagePanStart.current.y + event.translationY);
          return;
        }
        dragY.setValue(photoViewerDismissTranslateY(event.translationY));
      })
      .onEnd((event) => {
        if (
          shouldDismissPhotoViewer({
            zoomScale: zoomScaleRef.current,
            translationX: event.translationX,
            translationY: event.translationY,
            velocityY: normalizedSwipeVelocity(event.velocityY),
            numberActiveTouches: 1,
          })
        ) {
          onCloseRef.current();
          return;
        }
        if (photoViewerImagePanEnabled(zoomScaleRef.current)) {
          imagePanStart.current = {
            x: imagePanStart.current.x + event.translationX,
            y: imagePanStart.current.y + event.translationY,
          };
          return;
        }
        Animated.spring(dragY, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      });

    return Gesture.Simultaneous(pinch, pan);
  }, [dragY, imageScale, imageX, imageY, pagingEnabled]);

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
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
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
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
                keyExtractor={(photo) => photo.id}
                renderItem={({ item }) => (
                  <View style={styles.page}>
                    <Animated.View
                      style={[
                        styles.imageWrap,
                        {
                          transform: [
                            { translateX: imageX },
                            { translateY: imageY },
                            { scale: imageScale },
                          ],
                        },
                      ]}
                    >
                      <Image
                        source={{ uri: item.url }}
                        style={styles.image}
                        resizeMode="contain"
                        accessibilityLabel="Request item photo"
                      />
                    </Animated.View>
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
  imageWrap: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT - 90,
    alignItems: "center",
    justifyContent: "center",
  },
  image: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT - 90 },
});
