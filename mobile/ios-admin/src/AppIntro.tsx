import { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, Image, StyleSheet, Text, View } from "react-native";

import { APP_INTRO_BRAND_MARK } from "./app-intro-assets";
import { APP_INTRO_BACKGROUND, appIntroDurationMs } from "./app-intro";

type Props = {
  onFinished: () => void;
};

export function AppIntro({ onFinished }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.96)).current;

  useEffect(() => {
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (cancelled) return;
      const duration = appIntroDurationMs(reduceMotion);
      if (reduceMotion) {
        opacity.setValue(1);
        scale.setValue(1);
        timeout = setTimeout(onFinished, duration);
        return;
      }
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 420,
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
      ]).start();
      timeout = setTimeout(onFinished, duration);
    });

    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [onFinished, opacity, scale]);

  return (
    <View style={styles.root} accessibilityRole="image" accessibilityLabel="Request Portal">
      <Animated.View style={{ opacity, transform: [{ scale }] }}>
        {APP_INTRO_BRAND_MARK ? (
          <Image source={APP_INTRO_BRAND_MARK} style={styles.mark} resizeMode="contain" />
        ) : (
          <Text style={styles.wordmark}>Request Portal</Text>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: APP_INTRO_BACKGROUND,
    alignItems: "center",
    justifyContent: "center",
  },
  mark: {
    width: 160,
    height: 160,
  },
  wordmark: {
    color: "#f7faf7",
    fontSize: 28,
    fontWeight: "600",
    fontFamily: "Georgia",
    letterSpacing: 0.3,
  },
});
