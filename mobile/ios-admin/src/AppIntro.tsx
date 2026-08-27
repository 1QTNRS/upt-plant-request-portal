import { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, Image, StyleSheet, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";

import { APP_INTRO_SPLASH_ICON } from "./app-intro-assets";
import {
  APP_INTRO_BACKGROUND,
  APP_INTRO_LOGO_WIDTH,
  appIntroDurationMs,
} from "./app-intro";

type Props = {
  onFinished: () => void;
};

export function AppIntro({ onFinished }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.96)).current;

  useEffect(() => {
    void SplashScreen.hideAsync().catch(() => {
      // Expo Go may already have hidden the native splash.
    });
  }, []);

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
    <View style={styles.root} accessibilityRole="image" accessibilityLabel="Logo">
      <Animated.View style={{ opacity, transform: [{ scale }] }}>
        <Image
          source={APP_INTRO_SPLASH_ICON}
          style={styles.mark}
          resizeMode="contain"
        />
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
    width: APP_INTRO_LOGO_WIDTH,
    height: APP_INTRO_LOGO_WIDTH,
  },
});
