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
import { THEME } from "../theme";

export type StripPhoto = { id: string; url: string };

type Props = {
  photos: StripPhoto[];
  canEdit: boolean;
  onPreview: (index: number) => void;
  onRemove?: (photoId: string) => void;
  onReorder?: (photos: StripPhoto[]) => void;
};

const SLOT = THUMB_SIZE + THUMB_GAP;

export function PhotoStrip({ photos, canEdit, onPreview, onRemove, onReorder }: Props) {
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
          .enabled(canEdit && Boolean(onReorder) && photo.id !== "linked-stock")
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
                onPress={() => onPreview(index)}
                accessibilityRole="imagebutton"
                accessibilityLabel="Preview photo"
              >
                <Image source={{ uri: photo.url }} style={styles.thumb} />
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
