import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Image, StyleSheet, View } from "react-native";
import { Asset } from "expo-asset";
import * as SplashScreen from "expo-splash-screen";

import { APP_INTRO_SPLASH_ICON } from "./app-intro-assets";
import {
  APP_INTRO_BACKGROUND,
  APP_INTRO_LOGO_WIDTH,
  APP_INTRO_START_OPACITY,
  APP_INTRO_START_SCALE,
  appIntroDurationMs,
} from "./app-intro";

type Props = {
  onFinished: () => void;
};

export function AppIntro({ onFinished }: Props) {
  const [logoReady, setLogoReady] = useState(false);
  const opacity = useRef(new Animated.Value(APP_INTRO_START_OPACITY)).current;
  const scale = useRef(new Animated.Value(APP_INTRO_START_SCALE)).current;

  useEffect(() => {
    let cancelled = false;
    void Asset.fromModule(APP_INTRO_SPLASH_ICON)
      .downloadAsync()
      .catch(() => {
        // Bundled require() still renders if Asset cache is unavailable.
      })
      .finally(() => {
        if (!cancelled) setLogoReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!logoReady) return;
    void SplashScreen.hideAsync().catch(() => {
      // Expo Go may already have hidden its own splash.
    });
  }, [logoReady]);

  useEffect(() => {
    if (!logoReady) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (cancelled) return;
      const duration = appIntroDurationMs(reduceMotion);
      opacity.setValue(1);
      if (reduceMotion) {
        scale.setValue(1);
        timeout = setTimeout(onFinished, duration);
        return;
      }
      Animated.timing(scale, {
        toValue: 1,
        duration: 700,
        useNativeDriver: true,
      }).start();
      timeout = setTimeout(onFinished, duration);
    });

    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [logoReady, onFinished, opacity, scale]);

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
