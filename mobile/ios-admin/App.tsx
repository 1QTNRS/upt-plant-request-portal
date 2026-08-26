import "react-native-gesture-handler";

import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import {
  NavigationContainer,
  getFocusedRouteNameFromRoute,
  type Route,
} from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
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
import type {
  ExactPlantsStackParamList,
  MainTabParamList,
  RequestsStackParamList,
} from "./src/screens/navigation-types";
import { THEME } from "./src/theme";
import { ui } from "./src/ui";

const DEFAULT_API_URL = "https://upt-plant-request-portal.onrender.com";
const TOKEN_KEY = "upt_admin_token";
const URL_KEY = "upt_admin_api_url";

const RequestsStack = createNativeStackNavigator<RequestsStackParamList>();
const ExactPlantsStack = createNativeStackNavigator<ExactPlantsStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();

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
    height: 52 + insets.bottom,
    paddingBottom: insets.bottom,
  };

  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: THEME.yellow,
        tabBarInactiveTintColor: THEME.white,
        tabBarStyle,
        tabBarLabelStyle: { fontWeight: "700", fontSize: 12 },
        tabBarIconStyle: { display: "none" },
      }}
    >
      <Tabs.Screen
        name="Requests"
        component={RequestsNavigator}
        options={({ route }) => ({
          title: "Requests",
          tabBarStyle: tabBarVisible(route) ? tabBarStyle : { display: "none" },
        })}
      />
      <Tabs.Screen
        name="ExactPlants"
        component={ExactPlantsNavigator}
        options={({ route }) => ({
          title: "EXACT PLANTS",
          tabBarStyle: tabBarVisible(route) ? tabBarStyle : { display: "none" },
        })}
      />
      <Tabs.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: "Settings", tabBarStyle }}
      />
    </Tabs.Navigator>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [token, setToken] = useState("");

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
            <NavigationContainer>
              <MainTabs />
            </NavigationContainer>
          </SessionContext.Provider>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
