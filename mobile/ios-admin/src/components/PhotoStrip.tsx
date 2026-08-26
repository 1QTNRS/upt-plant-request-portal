import { useEffect, useRef, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import {
  THUMB_GAP,
  THUMB_PAD,
  THUMB_REMOVE_SIZE,
  THUMB_SIZE,
  reorderPhotos,
} from "../item-editor";
import {
  canPreviewPhoto,
  canReorderPhoto,
  showsProgressBar,
  showsRetry,
  type EditorPhoto,
} from "../photo-upload";
import { THEME } from "../theme";

export type StripPhoto = EditorPhoto;

type Props = {
  photos: StripPhoto[];
  canEdit: boolean;
  onPreview: (index: number) => void;
  onRemove?: (photoId: string) => void;
  onReorder?: (photos: StripPhoto[]) => void;
  onRetry?: (photoId: string) => void;
};

const SLOT = THUMB_SIZE + THUMB_GAP;

export function PhotoStrip({
  photos,
  canEdit,
  onPreview,
  onRemove,
  onReorder,
  onRetry,
}: Props) {
  const [order, setOrder] = useState(photos);
  const orderRef = useRef(photos);
  const draggedId = useRef<string | null>(null);
  const startIndex = useRef(0);

  useEffect(() => {
    setOrder(photos);
    orderRef.current = photos;
  }, [photos]);

  function move(from: number, to: number) {
    const next = reorderPhotos(orderRef.current, from, to);
    orderRef.current = next;
    setOrder(next);
  }

  if (order.length === 0) return null;

  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      scrollEnabled={!draggedId.current}
      showsHorizontalScrollIndicator={false}
      style={styles.strip}
      contentContainerStyle={styles.row}
    >
      {order.map((photo, index) => {
        const pan = Gesture.Pan()
          .enabled(canEdit && Boolean(onReorder) && canReorderPhoto(photo))
          .activateAfterLongPress(220)
          .runOnJS(true)
          .onStart(() => {
            draggedId.current = photo.id;
            startIndex.current = index;
          })
          .onUpdate((event) => {
            const from = orderRef.current.findIndex((entry) => entry.id === draggedId.current);
            const to = Math.max(
              0,
              Math.min(
                orderRef.current.length - 1,
                startIndex.current + Math.round(event.translationX / SLOT),
              ),
            );
            if (from !== -1 && to !== from) move(from, to);
          })
          .onEnd(() => {
            draggedId.current = null;
            onReorder?.(orderRef.current);
          })
          .onFinalize(() => {
            draggedId.current = null;
          });

        return (
          <GestureDetector key={photo.id} gesture={pan}>
            <View style={styles.thumbWrap}>
              <Pressable
                onPress={() => {
                  if (canPreviewPhoto(photo)) onPreview(index);
                }}
                accessibilityRole="imagebutton"
                accessibilityLabel={
                  canPreviewPhoto(photo) ? "Preview photo" : "Photo still uploading"
                }
              >
                <Image source={{ uri: photo.url }} style={styles.thumb} />
                {showsProgressBar(photo) ? (
                  <View style={styles.progressTrack}>
                    <View
                      style={[
                        styles.progressFill,
                        { width: THUMB_SIZE * Math.max(0.08, Math.min(photo.progress, 1)) },
                      ]}
                    />
                  </View>
                ) : null}
                {showsRetry(photo) ? (
                  <Pressable
                    style={styles.retry}
                    onPress={() => onRetry?.(photo.id)}
                    accessibilityRole="button"
                    accessibilityLabel="Retry photo upload"
                  >
                    <Text style={styles.retryLabel}>Retry</Text>
                  </Pressable>
                ) : null}
              </Pressable>
              {canEdit && onRemove && photo.id !== "linked-stock" ? (
                <Pressable
                  style={styles.remove}
                  hitSlop={8}
                  onPress={() => onRemove(photo.id)}
                  accessibilityRole="button"
                  accessibilityLabel="Remove photo"
                >
                  <Text style={styles.removeLabel}>✕</Text>
                </Pressable>
              ) : null}
            </View>
          </GestureDetector>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { flexGrow: 0, maxWidth: THUMB_SIZE * 2 + THUMB_GAP + THUMB_PAD * 2 },
  row: {
    alignItems: "center",
    gap: THUMB_GAP,
    paddingTop: THUMB_PAD,
    paddingRight: THUMB_PAD,
    paddingBottom: 2,
  },
  thumbWrap: {
    position: "relative",
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    overflow: "visible",
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 8,
    backgroundColor: THEME.mint,
  },
  progressTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 4,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    backgroundColor: "rgba(0,0,0,0.35)",
    overflow: "hidden",
  },
  progressFill: {
    height: 4,
    backgroundColor: THEME.yellow,
  },
  retry: {
    position: "absolute",
    left: 4,
    right: 4,
    bottom: 6,
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 6,
    alignItems: "center",
    paddingVertical: 3,
  },
  retryLabel: { color: THEME.white, fontSize: 11, fontWeight: "700" },
  remove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: THUMB_REMOVE_SIZE,
    height: THUMB_REMOVE_SIZE,
    borderRadius: THUMB_REMOVE_SIZE / 2,
    backgroundColor: THEME.darkGreen,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  removeLabel: { color: THEME.white, fontSize: 11, fontWeight: "700" },
});
