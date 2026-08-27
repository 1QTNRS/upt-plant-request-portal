import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.join(import.meta.dirname, "..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

describe("iOS admin source layout", () => {
  it("does not remount ItemEditor from inside App on each keystroke", () => {
    const app = read("App.tsx");
    const editor = read("src/components/ItemEditor.tsx");
    assert.match(editor, /export function ItemEditor/);
    assert.doesNotMatch(app, /function ItemEditor/);
    assert.match(editor, /useState\(String\(item\.price/);
    assert.match(editor, /editable=\{fieldsOn\}/);
    assert.match(editor, /selectTextOnFocus/);
    assert.doesNotMatch(editor, /Save item/);
    assert.match(editor, /Upload Photos/);
    assert.match(editor, /allowsMultipleSelection/);
  });

  it("combines request counts with filters and pull-to-refresh", () => {
    const list = read("src/screens/RequestListScreen.tsx");
    assert.match(list, /StatusFilterBar/);
    assert.match(list, /DEFAULT_STATUS_FILTER/);
    assert.match(list, /RefreshControl/);
    assert.match(list, /filterRequestRows/);
    assert.doesNotMatch(list, /STATUS_FILTERS\.map/);
    assert.doesNotMatch(list, /stats\.newRequests/);
  });

  it("keeps stock results in an attached dropdown and compact photos", () => {
    const editor = read("src/components/ItemEditor.tsx");
    const strip = read("src/components/PhotoStrip.tsx");
    const detail = read("src/screens/RequestDetailScreen.tsx");
    assert.match(editor, /styles\.dropdown/);
    assert.match(editor, /STOCK_DROPDOWN_MAX_HEIGHT/);
    assert.match(editor, /GestureScrollView/);
    assert.match(editor, /formatStockSearchInventory/);
    assert.match(editor, /canSelectStockCandidate/);
    assert.match(editor, /styles\.noStock/);
    assert.match(editor, /styles\.inStock/);
    assert.match(editor, /STOCK_SEARCH_NO_STOCK_COLOR/);
    assert.match(editor, /disabled=\{!selectable\}/);
    assert.match(editor, /PhotoStrip/);
    assert.match(editor, /PhotoViewer/);
    assert.match(editor, /setViewerIndex/);
    assert.match(editor, /reorder-photos/);
    assert.match(strip, /THUMB_SIZE/);
    assert.match(strip, /paddingTop: THUMB_PAD/);
    assert.match(strip, /overflow: "visible"/);
    assert.match(detail, /scrollEnabled=\{!stockDropdownOpen\}/);
    assert.match(detail, /ui\.expirationDays/);
    assert.match(detail, /sendOfferHoldControlsEnabled/);
    const viewer = read("src/components/PhotoViewer.tsx");
    assert.match(viewer, /shouldDismissPhotoViewer/);
    assert.match(viewer, /shouldCapturePhotoViewerDismiss/);
    assert.doesNotMatch(editor, /height: 160/);
  });

  it("puts Link Stock search directly under fulfillment buttons", () => {
    const editor = read("src/components/ItemEditor.tsx");
    const fulfillment = editor.indexOf('(["exact_plant", "growers_choice", "not_available"]');
    const search = editor.indexOf("Search live website stock");
    const notes = editor.lastIndexOf("Customer-facing notes");
    const offered = editor.indexOf("Offered name");
    assert.ok(fulfillment > -1 && search > fulfillment);
    assert.ok(notes > search);
    assert.ok(offered > search);
    assert.match(editor, /showsExactPlantFields/);
    assert.match(editor, /linkedStock\.productTitle/);
  });

  it("uses native stack swipe-back and a taller centered tab bar", () => {
    const app = read("App.tsx");
    assert.match(app, /createMaterialTopTabNavigator/);
    assert.match(app, /tabBarPosition="bottom"/);
    assert.match(app, /createNativeStackNavigator/);
    assert.match(app, /gestureEnabled: true/);
    assert.match(app, /fullScreenGestureEnabled: false/);
    assert.match(app, /backgroundColor: THEME\.darkGreen/);
    assert.match(app, /tabBarInactiveTintColor: THEME\.white/);
    assert.match(app, /TAB_BAR_CONTENT_HEIGHT/);
    assert.match(app, /TAB_BAR_LABEL_FONT_SIZE/);
    assert.match(app, /justifyContent: "center"/);
    assert.match(app, /insets\.bottom/);
    assert.doesNotMatch(app, /fontSize: 12/);
  });

  it("registers push after sign-in and keeps deep links behind auth", () => {
    const app = read("App.tsx");
    const settings = read("src/screens/SettingsScreen.tsx");
    assert.match(app, /registerAdminPush/);
    assert.match(app, /createNavigationContainerRef/);
    assert.match(app, /uptadmin:\/\//);
    assert.match(app, /request\/:requestId/);
    assert.match(app, /resolveAdminPushDeepLink/);
    assert.match(settings, /iOS Push Notifications/);
    assert.match(settings, /save-admin-push/);
    assert.match(settings, /New Request/);
    assert.match(settings, /Item Status Update/);
  });

  it("plays a skippable in-app intro after the native splash", () => {
    const app = read("App.tsx");
    const login = read("src/screens/LoginScreen.tsx");
    assert.match(app, /preventAutoHideAsync/);
    assert.match(app, /AppIntro/);
    assert.match(app, /shouldPlayAppIntro/);
    assert.match(app, /sessionKind/);
    assert.match(login, /Request Portal/);
    assert.doesNotMatch(login, /UPT Admin/);
  });
});
