import "react-native-gesture-handler";

import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import {
  NavigationContainer,
  createNavigationContainerRef,
  getFocusedRouteNameFromRoute,
  type Route,
} from "@react-navigation/native";
import * as Notifications from "expo-notifications";
import { createMaterialTopTabNavigator } from "@react-navigation/material-top-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

import { apiGet } from "./src/api";
import { SessionContext } from "./src/SessionContext";
import { ExactPlantsReviewScreen, ExactPlantsScreen } from "./src/screens/ExactPlantsScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { RequestDetailScreen } from "./src/screens/RequestDetailScreen";
import { RequestListScreen } from "./src/screens/RequestListScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { resolveAdminPushDeepLink } from "./src/push";
import { notificationRequestId, registerAdminPush } from "./src/register-push";
import type {
  ExactPlantsStackParamList,
  MainTabParamList,
  RequestsStackParamList,
} from "./src/screens/navigation-types";
import { TAB_BAR_CONTENT_HEIGHT, TAB_BAR_LABEL_FONT_SIZE } from "./src/item-editor";
import { tabSwipeEnabled } from "./src/tab-swipe";
import { THEME } from "./src/theme";
import { ui } from "./src/ui";

const DEFAULT_API_URL = "https://upt-plant-request-portal.onrender.com";
const TOKEN_KEY = "upt_admin_token";
const URL_KEY = "upt_admin_api_url";

const navigationRef = createNavigationContainerRef<MainTabParamList>();

const linking = {
  prefixes: ["uptadmin://"],
  config: {
    screens: {
      Requests: {
        screens: {
          RequestDetail: "request/:requestId",
        },
      },
    },
  },
};

function openRequestDetail(requestId: string) {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate("Requests", {
    screen: "RequestDetail",
    params: { requestId },
  });
}

const RequestsStack = createNativeStackNavigator<RequestsStackParamList>();
const ExactPlantsStack = createNativeStackNavigator<ExactPlantsStackParamList>();
const Tabs = createMaterialTopTabNavigator<MainTabParamList>();

const stackScreenOptions = {
  headerShown: false,
  gestureEnabled: true,
  fullScreenGestureEnabled: false,
  animation: "slide_from_right" as const,
};

function RequestsNavigator() {
  return (
    <RequestsStack.Navigator screenOptions={stackScreenOptions}>
      <RequestsStack.Screen name="RequestList" component={RequestListScreen} />
      <RequestsStack.Screen name="RequestDetail" component={RequestDetailScreen} />
    </RequestsStack.Navigator>
  );
}

function ExactPlantsNavigator() {
  return (
    <ExactPlantsStack.Navigator screenOptions={stackScreenOptions}>
      <ExactPlantsStack.Screen name="ExactPlantsList" component={ExactPlantsScreen} />
      <ExactPlantsStack.Screen name="ExactPlantsReview" component={ExactPlantsReviewScreen} />
    </ExactPlantsStack.Navigator>
  );
}

function tabBarVisible(route: Route<string>) {
  const focused = getFocusedRouteNameFromRoute(route) ?? route.name;
  return focused !== "RequestDetail" && focused !== "ExactPlantsReview";
}

function MainTabs() {
  const insets = useSafeAreaInsets();
  const tabBarStyle = {
    backgroundColor: THEME.darkGreen,
    borderTopColor: THEME.darkGreen,
    height: TAB_BAR_CONTENT_HEIGHT + insets.bottom,
    paddingTop: 12,
    paddingBottom: insets.bottom + 10,
  };

  return (
    <Tabs.Navigator
      tabBarPosition="bottom"
      screenOptions={({ route }) => {
        const visible = tabBarVisible(route);
        const focused = getFocusedRouteNameFromRoute(route) ?? route.name;
        return {
          lazy: true,
          swipeEnabled: tabSwipeEnabled(focused) && visible,
          tabBarActiveTintColor: THEME.yellow,
          tabBarInactiveTintColor: THEME.white,
          tabBarStyle: visible ? tabBarStyle : { display: "none", height: 0 },
          tabBarLabelStyle: {
            fontWeight: "700",
            fontSize: TAB_BAR_LABEL_FONT_SIZE,
            marginBottom: 0,
            textTransform: "none",
          },
          tabBarItemStyle: { justifyContent: "center", paddingVertical: 6 },
          tabBarIndicatorStyle: { backgroundColor: THEME.yellow, height: 3 },
          tabBarPressColor: "transparent",
          tabBarBounces: false,
        };
      }}
    >
      <Tabs.Screen
        name="Requests"
        component={RequestsNavigator}
        options={{ title: "Requests" }}
      />
      <Tabs.Screen
        name="ExactPlants"
        component={ExactPlantsNavigator}
        options={{ title: "EXACT PLANTS" }}
      />
      <Tabs.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: "Settings" }}
      />
    </Tabs.Navigator>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [token, setToken] = useState("");
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const savedToken = await SecureStore.getItemAsync(TOKEN_KEY);
      const savedUrl = await SecureStore.getItemAsync(URL_KEY);
      if (savedUrl) setApiUrl(savedUrl);
      if (!savedToken) {
        setReady(true);
        return;
      }
      setToken(savedToken);
      try {
        await apiGet(savedUrl || DEFAULT_API_URL, savedToken, "/api/mobile/admin/session");
        setSignedIn(true);
      } catch {
        setSignedIn(false);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!signedIn || !token) return;
    void registerAdminPush(apiUrl, token).catch(() => {
      // Permission denied or a missing Expo project id must not block the app.
    });
  }, [signedIn, apiUrl, token]);

  useEffect(() => {
    function consume(requestId: string | null) {
      const resolved = resolveAdminPushDeepLink({ signedIn, requestId });
      if (resolved.openRequestId) {
        openRequestDetail(resolved.openRequestId);
        setPendingRequestId(null);
        return;
      }
      if (resolved.pendingRequestId) setPendingRequestId(resolved.pendingRequestId);
    }

    if (signedIn && pendingRequestId) {
      consume(pendingRequestId);
    }

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      consume(notificationRequestId(response));
    });
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      consume(notificationRequestId(response));
      void Notifications.clearLastNotificationResponseAsync();
    });
    return () => sub.remove();
  }, [signedIn, pendingRequestId]);

  const session = useMemo(
    () => ({
      apiUrl,
      token,
      signOut: async () => {
        await SecureStore.deleteItemAsync(TOKEN_KEY);
        setToken("");
        setSignedIn(false);
      },
    }),
    [apiUrl, token],
  );

  async function finishSignIn() {
    await SecureStore.setItemAsync(TOKEN_KEY, token.trim());
    await SecureStore.setItemAsync(URL_KEY, apiUrl.trim());
    setSignedIn(true);
  }

  return (
    <GestureHandlerRootView style={ui.flex}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        {!ready ? (
          <View style={[ui.flex, { justifyContent: "center", alignItems: "center" }]}>
            <ActivityIndicator color={THEME.darkGreen} />
          </View>
        ) : !signedIn ? (
          <LoginScreen
            apiUrl={apiUrl}
            token={token}
            onApiUrl={setApiUrl}
            onToken={setToken}
            onSignedIn={() => void finishSignIn()}
          />
        ) : (
          <SessionContext.Provider value={session}>
            <NavigationContainer ref={navigationRef} linking={linking}>
              <MainTabs />
            </NavigationContainer>
          </SessionContext.Provider>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
