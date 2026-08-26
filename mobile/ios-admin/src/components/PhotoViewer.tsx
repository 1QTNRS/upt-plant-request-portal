import { useState } from "react";
import {
  Dimensions,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

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

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.backdrop}>
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
          initialScrollIndex={index}
          getItemLayout={(_, photoIndex) => ({
            length: SCREEN_WIDTH,
            offset: SCREEN_WIDTH * photoIndex,
            index: photoIndex,
          })}
          onMomentumScrollEnd={(event) => {
            const next = Math.round(event.nativeEvent.contentOffset.x / SCREEN_WIDTH);
            setCurrent(next);
          }}
          keyExtractor={(photo) => photo.id}
          renderItem={({ item }) => (
            <ScrollView
              style={styles.page}
              contentContainerStyle={styles.pageContent}
              maximumZoomScale={4}
              minimumZoomScale={1}
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
              centerContent
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
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#000000" },
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
