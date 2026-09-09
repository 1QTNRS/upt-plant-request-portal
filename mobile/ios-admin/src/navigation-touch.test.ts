import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { rootTabBarStyle, rootTabBarVisible } from "./navigation-chrome";
import {
  partitionPendingOfferItems,
  shouldGroupPendingOfferItems,
} from "./terminal-response";

const root = path.join(import.meta.dirname, "..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

describe("iOS navigation touch regression", () => {
  it("uses a material top tab pager for smooth root-tab swipe", () => {
    const app = read("App.tsx");
    assert.match(app, /createMaterialTopTabNavigator/);
    assert.match(app, /tabBarPosition="bottom"/);
    assert.match(read("package.json"), /react-native-pager-view/);
    assert.doesNotMatch(app, /RootTabSwipeShell/);
    assert.doesNotMatch(app, /getFocusedRouteNameFromRoute/);
    assert.match(read("src/navigation-chrome.ts"), /lazy: false/);
    assert.match(app, /freezeOnBlur: true/);
    assert.match(app, /rootMaterialTabScreenOptions/);
  });

  it("uses label-only tab styling and focus hooks for tab bar timing and pager swipe", () => {
    const chrome = read("src/navigation-chrome.ts");
    assert.match(chrome, /tabBarIndicatorStyle: \{ height: 0/);
    assert.match(chrome, /tabBarActiveTintColor: THEME\.yellow/);
    assert.match(chrome, /tabBarInactiveTintColor: THEME\.white/);
    const detail = read("src/screens/RequestDetailScreen.tsx");
    assert.match(detail, /useRootTabBarHiddenOnFocus/);
    const list = read("src/screens/RequestListScreen.tsx");
    assert.match(list, /useRootTabBarVisibleOnFocus/);
    const hooks = read("src/use-root-tab-bar.ts");
    assert.match(hooks, /useLayoutEffect/);
    assert.match(hooks, /transitionStart/);
    assert.match(hooks, /swipeEnabled/);
    assert.match(hooks, /bottomInsetRef/);
    assert.doesNotMatch(
      hooks,
      /return \(\) => \{[\s\S]*setRootTabChrome[\s\S]*true, true/,
    );
  });

  it("hides the tab bar on detail routes without leaving touch targets active", () => {
    assert.equal(rootTabBarVisible("RequestList"), true);
    assert.equal(rootTabBarVisible("RequestDetail"), false);
    const hidden = rootTabBarStyle({ visible: false, bottomInset: 20 });
    assert.equal(hidden.pointerEvents, "none");
    assert.equal(hidden.height, 0);
    const visible = rootTabBarStyle({ visible: true, bottomInset: 20 });
    assert.equal(visible.pointerEvents, "auto");
    assert.ok((visible.height ?? 0) > 0);
  });

  it("blocks blurred detail screens from intercepting list and tab touches", () => {
    const detail = read("src/screens/RequestDetailScreen.tsx");
    assert.match(detail, /useIsFocused/);
    assert.match(detail, /pointerEvents=\{isFocused \? "auto" : "none"\}/);
    assert.match(detail, /registerPhotoDismiss/);
    assert.match(detail, /photoDismissers/);
    assert.match(detail, /dismissInteractionBlockers/);
  });

  it("closes photo viewer and stock overlays when leaving request detail", () => {
    const editor = read("src/components/ItemEditor.tsx");
    assert.match(editor, /registerPhotoDismiss/);
    assert.match(editor, /setViewerIndex\(null\)/);
    const viewer = read("src/components/PhotoViewer.tsx");
    assert.match(viewer, /registerTouchBlocker/);
  });

  it("logs active touch blockers when returning to the request list", () => {
    const list = read("src/screens/RequestListScreen.tsx");
    assert.match(list, /logActiveTouchBlockers\("request-list-focus"\)/);
    assert.match(list, /useFocusEffect/);
  });

  it("does not mount custom swipe shells on root or detail screens", () => {
    const list = read("src/screens/RequestListScreen.tsx");
    assert.doesNotMatch(list, /RootTabSwipeShell/);
    const detail = read("src/screens/RequestDetailScreen.tsx");
    assert.doesNotMatch(detail, /RootTabSwipeShell/);
    const exact = read("src/screens/ExactPlantsScreen.tsx");
    assert.doesNotMatch(exact, /RootTabSwipeShell/);
    const settings = read("src/screens/SettingsScreen.tsx");
    assert.doesNotMatch(settings, /RootTabSwipeShell/);
  });
});

describe("pending offer grouping", () => {
  it("groups unanswered pending offers into OFFERED and NOT AVAILABLE", () => {
    assert.equal(
      shouldGroupPendingOfferItems("Pending", true, undefined),
      true,
    );
    assert.equal(
      shouldGroupPendingOfferItems("Pending", true, [
        { sourceItemId: "a", choice: "accept" },
      ]),
      false,
    );
    const grouped = partitionPendingOfferItems([
      {
        id: "1",
        plantName: "Monstera",
        availability: "available",
        offeredName: "Monstera",
        price: 10,
        weightLbs: 1,
        customerFacingNotes: "",
        fulfillmentRoute: "exact_plant",
        photos: [],
      },
      {
        id: "2",
        plantName: "Philodendron",
        availability: "not_available",
        offeredName: "",
        price: 0,
        weightLbs: 0,
        customerFacingNotes: "",
        fulfillmentRoute: "not_available",
        photos: [],
      },
    ] as never);
    assert.equal(grouped.offered.length, 1);
    assert.equal(grouped.notAvailable.length, 1);
  });

  it("renders OFFERED before NOT AVAILABLE on iOS request detail", () => {
    const detail = read("src/screens/RequestDetailScreen.tsx");
    assert.match(detail, /shouldGroupPendingOfferItems/);
    assert.match(
      detail,
      /pendingGroups\.offered[\s\S]*<Text style=\{ui\.terminalGroupHeading\}>OFFERED<\/Text>/,
    );
    assert.match(
      detail,
      /pendingGroups\.notAvailable[\s\S]*<Text style=\{ui\.terminalGroupHeading\}>NOT AVAILABLE<\/Text>/,
    );
    const pendingBlock = detail.slice(detail.indexOf("pendingGroups ?"));
    assert.ok(
      pendingBlock.indexOf(">OFFERED<") < pendingBlock.indexOf(">NOT AVAILABLE<"),
    );
  });
});
