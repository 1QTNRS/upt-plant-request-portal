import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { apiPostJson } from "./api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function expoProjectId(): string | undefined {
  return (
    Constants.easConfig?.projectId ||
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
      ?.projectId
  );
}

/**
 * Ask for notification permission after sign-in. Denial is not an error:
 * the rest of the admin app keeps working.
 */
export async function registerAdminPush(apiUrl: string, token: string): Promise<void> {
  if (!Device.isDevice) return;

  const current = await Notifications.getPermissionsAsync();
  const permission =
    current.status === "granted"
      ? current
      : await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted") return;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("upt-admin", {
      name: "Request Portal",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const projectId = expoProjectId();
  const pushToken = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );
  await apiPostJson(apiUrl, token, "/api/mobile/admin/push-token", {
    expoPushToken: pushToken.data,
  });
}

export function notificationRequestId(
  response: Notifications.NotificationResponse | null,
): string | null {
  const data = response?.notification.request.content.data as
    | Record<string, unknown>
    | undefined;
  const value = data?.requestId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
