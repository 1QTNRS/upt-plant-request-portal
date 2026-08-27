import { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { apiGet, apiPostJson } from "../api";
import {
  mergeSettingsForm,
  settingsFeedbackLabel,
  settingsFormFromShop,
  type SettingsFormState,
} from "../settings-form";
import { useSession } from "../SessionContext";
import { THEME } from "../theme";
import type { ShopSettings } from "../types";

const EMPTY_FORM: SettingsFormState = {
  warning: "",
  email: "",
  newRequestEmail: true,
  customerResponseEmail: true,
  paymentAfterVoidEmail: true,
  pushNewRequest: true,
  pushItemStatus: true,
  registeredPushDevices: 0,
  sku: "",
};

export function SettingsScreen() {
  const { apiUrl, token, signOut } = useSession();
  const [form, setForm] = useState<SettingsFormState>(EMPTY_FORM);
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingPush, setSavingPush] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  function applyServer(settings: ShopSettings) {
    setForm((current) => mergeSettingsForm(current, settingsFormFromShop(settings)));
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setError(null);
      try {
        const settings = await apiGet<ShopSettings>(
          apiUrl,
          token,
          "/api/mobile/admin/settings",
        );
        if (cancelled) return;
        applyServer(settings);
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Could not load settings.");
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function save(intent: "save" | "reset") {
    setError(null);
    setSaved(null);
    setSaving(true);
    try {
      const result = await apiPostJson<ShopSettings & { ok: boolean; reset?: boolean; error?: string }>(
        apiUrl,
        token,
        "/api/mobile/admin/settings",
        {
          intent,
          fedexRemovalWarning: form.warning,
          adminNotificationEmail: form.email,
          adminEmailNewRequest: form.newRequestEmail,
          adminEmailCustomerResponse: form.customerResponseEmail,
          adminEmailPaymentAfterVoid: form.paymentAfterVoidEmail,
        },
      );
      if (!result.ok) {
        setError(result.error || "Could not save settings.");
        return;
      }
      applyServer(result);
      setSaved(result.reset ? "FedEx warning reset to the default." : "Settings saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  const feedback = settingsFeedbackLabel({
    saving: saving || savingPush,
    saved,
    error,
    hydrated,
  });
  const feedbackBusy = saving || savingPush;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: THEME.mint }} edges={["top", "left", "right"]}>
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.muted}>
        FedEx warning, admin emails, and iOS push toggles. Create or revoke a
        device token on the website Settings page. Analytics stays on the website.
      </Text>
      <Text
        style={[
          styles.feedback,
          error ? styles.error : feedbackBusy || saved ? styles.success : styles.feedbackIdle,
        ]}
      >
        {feedback}
      </Text>

      <Text style={styles.label}>FedEx upgrade warning</Text>
      <Text style={styles.muted}>{form.sku ? `Listing SKU: ${form.sku}` : " "}</Text>
      <TextInput
        value={form.warning}
        onChangeText={(warning) => setForm((current) => ({ ...current, warning }))}
        multiline
        style={[styles.input, styles.multiline]}
      />
      <Text style={styles.label}>Admin notification email</Text>
      <TextInput
        value={form.email}
        onChangeText={(email) => setForm((current) => ({ ...current, email }))}
        autoCapitalize="none"
        keyboardType="email-address"
        style={styles.input}
      />
      <Text style={styles.muted}>
        Subscribe to the automatic emails you want in that inbox.
      </Text>
      {(
        [
          ["New customer request", form.newRequestEmail, "newRequestEmail"],
          ["Customer answered an offer", form.customerResponseEmail, "customerResponseEmail"],
          ["Payment after a voided invoice", form.paymentAfterVoidEmail, "paymentAfterVoidEmail"],
        ] as const
      ).map(([label, value, key]) => (
        <View key={label} style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>{label}</Text>
          <Switch
            value={value}
            onValueChange={(next) => setForm((current) => ({ ...current, [key]: next }))}
            trackColor={{ true: THEME.darkGreen }}
          />
        </View>
      ))}
      <Pressable style={styles.button} disabled={saving} onPress={() => void save("save")}>
        <Text style={styles.buttonLabel}>{saving ? "Saving…" : "Save settings"}</Text>
      </Pressable>

      <Text style={styles.label}>iOS Push Notifications</Text>
      <Text style={styles.muted}>
        Separate from admin emails.{" "}
        {form.registeredPushDevices === 0
          ? "No iOS admin device is currently registered for push."
          : form.registeredPushDevices === 1
            ? "1 iOS admin device is registered for push."
            : `${form.registeredPushDevices} iOS admin devices are registered for push.`}
      </Text>
      {(
        [
          ["New Request", form.pushNewRequest, "pushNewRequest"],
          ["Item Status Update", form.pushItemStatus, "pushItemStatus"],
        ] as const
      ).map(([label, value, key]) => (
        <View key={label} style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>{label}</Text>
          <Switch
            value={value}
            onValueChange={(next) => setForm((current) => ({ ...current, [key]: next }))}
            trackColor={{ true: THEME.darkGreen }}
          />
        </View>
      ))}
      <Pressable
        style={styles.button}
        disabled={savingPush}
        onPress={() => {
          setSavingPush(true);
          setError(null);
          setSaved(null);
          void apiPostJson<ShopSettings & { ok: boolean; error?: string }>(
            apiUrl,
            token,
            "/api/mobile/admin/settings",
            {
              intent: "save-admin-push",
              adminPushNewRequest: form.pushNewRequest,
              adminPushItemStatusUpdate: form.pushItemStatus,
            },
          )
            .then((result) => {
              if (!result.ok) {
                setError(result.error || "Could not save push settings.");
                return;
              }
              applyServer(result);
              setSaved("iOS push notifications saved.");
            })
            .catch((caught) => {
              setError(caught instanceof Error ? caught.message : "Could not save push settings.");
            })
            .finally(() => setSavingPush(false));
        }}
      >
        <Text style={styles.buttonLabel}>
          {savingPush ? "Saving…" : "Save push notifications"}
        </Text>
      </Pressable>
      <Pressable style={styles.secondary} disabled={saving} onPress={() => void save("reset")}>
        <Text style={styles.secondaryLabel}>Reset warning to default</Text>
      </Pressable>
      <Pressable style={styles.secondary} onPress={() => void signOut()}>
        <Text style={styles.secondaryLabel}>Sign out</Text>
      </Pressable>
    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 8 },
  title: {
    color: THEME.darkGreen,
    fontSize: 28,
    fontWeight: "700",
    fontFamily: "Georgia",
  },
  muted: { color: THEME.muted, lineHeight: 20 },
  label: { color: THEME.darkGreen, fontWeight: "600", marginTop: 8 },
  input: {
    backgroundColor: THEME.white,
    borderColor: THEME.line,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    color: THEME.darkGreen,
    marginBottom: 8,
  },
  multiline: { minHeight: 120, textAlignVertical: "top" },
  button: {
    backgroundColor: THEME.darkGreen,
    minHeight: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  buttonLabel: { color: THEME.white, fontWeight: "700" },
  secondary: {
    borderColor: THEME.darkGreen,
    borderWidth: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
    backgroundColor: THEME.white,
  },
  secondaryLabel: { color: THEME.darkGreen, fontWeight: "700" },
  feedback: { minHeight: 20, lineHeight: 20, fontWeight: "600" },
  feedbackIdle: { color: THEME.mint },
  error: { color: "#8e1f0b" },
  success: { color: THEME.darkGreen, fontWeight: "600" },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 6,
  },
  toggleLabel: { color: THEME.darkGreen, flex: 1, fontWeight: "600" },
});
