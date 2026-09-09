import { useEffect, useLayoutEffect } from "react";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { rootTabBarStyle } from "./navigation-chrome";

type TabBarParentNavigation = {
  getParent(): {
    setOptions(options: {
      tabBarStyle: ReturnType<typeof rootTabBarStyle>;
      swipeEnabled?: boolean;
    }): void;
  } | undefined;
};

function setRootTabChrome(
  navigation: TabBarParentNavigation,
  visible: boolean,
  swipeEnabled: boolean,
  bottomInset: number,
) {
  navigation.getParent()?.setOptions({
    tabBarStyle: rootTabBarStyle({ visible, bottomInset }),
    swipeEnabled,
  });
}

/** Root stack screens keep the tab bar visible and pager swipe enabled while focused. */
export function useRootTabBarVisibleOnFocus() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();

  useLayoutEffect(() => {
    if (!isFocused) return;
    setRootTabChrome(navigation as TabBarParentNavigation, true, true, insets.bottom);
  }, [isFocused, insets.bottom, navigation]);
}

/**
 * Detail screens hide the tab bar and disable root-tab paging synchronously on
 * focus, restoring both as soon as the pop transition starts.
 */
export function useRootTabBarHiddenOnFocus() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();

  useLayoutEffect(() => {
    if (!isFocused) return;
    const tabNav = navigation as TabBarParentNavigation;
    setRootTabChrome(tabNav, false, false, insets.bottom);
    return () => {
      setRootTabChrome(tabNav, true, true, insets.bottom);
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
        setRootTabChrome(tabNav, true, true, insets.bottom);
      }
    });
    return unsubscribe;
  }, [insets.bottom, navigation]);
}
