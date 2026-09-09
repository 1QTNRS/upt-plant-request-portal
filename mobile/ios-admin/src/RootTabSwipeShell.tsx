import type { ReactNode } from "react";
import { View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import {
  type MainTabName,
  swipeDirectionToAdjacent,
} from "./tab-swipe";

type Props = {
  tabName: MainTabName;
  /** Only true on root tab routes (list/settings), never on pushed detail screens. */
  swipeEnabled: boolean;
  children: ReactNode;
};

/**
 * Horizontal swipe between root tabs. Mounted only on root screens so no pager
 * sits above nested stack detail routes and steals row taps.
 */
export function RootTabSwipeShell({ tabName, swipeEnabled, children }: Props) {
  const navigation = useNavigation();

  const pan = Gesture.Pan()
    .enabled(swipeEnabled)
    .activeOffsetX([-28, 28])
    .failOffsetY([-16, 16])
    .onEnd((event) => {
      const next = swipeDirectionToAdjacent(tabName, event.translationX);
      if (next) {
        navigation.getParent()?.navigate(next);
      }
    });

  return (
    <GestureDetector gesture={pan}>
      <View style={{ flex: 1 }}>{children}</View>
    </GestureDetector>
  );
}
