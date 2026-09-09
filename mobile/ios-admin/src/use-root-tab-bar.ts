import { useEffect, useLayoutEffect, useRef } from "react";
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

/**
 * Drive tab chrome from focus without layout-effect cleanup that briefly
 * restores the tab bar when safe-area deps change while the screen stays focused
 * (that reflow was dismissing the keyboard on first TextInput tap).
 */
function useRootTabChromeWhenFocused(visible: boolean, swipeEnabled: boolean) {
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const bottomInsetRef = useRef(insets.bottom);
  bottomInsetRef.current = insets.bottom;

  useLayoutEffect(() => {
    if (!isFocused) return;
    setRootTabChrome(
      navigation as TabBarParentNavigation,
      visible,
      swipeEnabled,
      bottomInsetRef.current,
    );
  }, [isFocused, navigation, swipeEnabled, visible]);
}

/** Root stack screens keep the tab bar visible and pager swipe enabled while focused. */
export function useRootTabBarVisibleOnFocus() {
  useRootTabChromeWhenFocused(true, true);
}

/**
 * Detail screens hide the tab bar and disable root-tab paging while focused.
 * Restores both on pop via transitionStart (before isFocused flips).
 */
export function useRootTabBarHiddenOnFocus() {
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const bottomInsetRef = useRef(insets.bottom);
  bottomInsetRef.current = insets.bottom;

  useRootTabChromeWhenFocused(false, false);

  useEffect(() => {
    if (!isFocused) return;
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
        setRootTabChrome(tabNav, true, true, bottomInsetRef.current);
      }
    });
    return unsubscribe;
  }, [isFocused, navigation]);
}
