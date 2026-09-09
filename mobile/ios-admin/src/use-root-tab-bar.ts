import { useEffect, useLayoutEffect } from "react";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { rootTabBarStyle } from "./navigation-chrome";

type TabBarParentNavigation = {
  getParent(): { setOptions(options: { tabBarStyle: ReturnType<typeof rootTabBarStyle> }): void } | undefined;
};

function setRootTabBarVisible(
  navigation: TabBarParentNavigation,
  visible: boolean,
  bottomInset: number,
) {
  navigation.getParent()?.setOptions({
    tabBarStyle: rootTabBarStyle({ visible, bottomInset }),
  });
}

/** Root stack screens keep the tab bar visible for the whole time they are focused. */
export function useRootTabBarVisibleOnFocus() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();

  useLayoutEffect(() => {
    if (!isFocused) return;
    setRootTabBarVisible(navigation as TabBarParentNavigation, true, insets.bottom);
  }, [isFocused, insets.bottom, navigation]);
}

/**
 * Detail screens hide the tab bar synchronously on focus and restore it as soon
 * as the pop transition starts — not after `getFocusedRouteNameFromRoute`
 * catches up at transition end.
 */
export function useRootTabBarHiddenOnFocus() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();

  useLayoutEffect(() => {
    if (!isFocused) return;
    const tabNav = navigation as TabBarParentNavigation;
    setRootTabBarVisible(tabNav, false, insets.bottom);
    return () => {
      setRootTabBarVisible(tabNav, true, insets.bottom);
    };
  }, [isFocused, insets.bottom, navigation]);

  useEffect(() => {
    const tabNav = navigation as TabBarParentNavigation;
    const unsubscribe = (
      navigation as {
        addListener(
          event: "transitionStart",
          callback: (event: { data?: { closing?: boolean } }) => void,
        ): () => void;
      }
    ).addListener("transitionStart", (event) => {
      if (event.data?.closing) {
        setRootTabBarVisible(tabNav, true, insets.bottom);
      }
    });
    return unsubscribe;
  }, [insets.bottom, navigation]);
}
