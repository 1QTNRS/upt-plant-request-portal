import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from "react-native";

import { apiGet, apiPostJson } from "../api";
import { THEME } from "../theme";
import type { ShopSettings } from "../types";

type Props = {
  apiUrl: string;
  token: string;
  onSignOut: () => void;
};

export function SettingsScreen({ apiUrl, token, onSignOut }: Props) {
  const [warning, setWarning] = useState("");
  const [email, setEmail] = useState("");
  const [sku, setSku] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function load() {
    setError(null);
    setLoading(true);
    try {
      const settings = await apiGet<ShopSettings>(
        apiUrl,
        token,
        "/api/mobile/admin/settings",
      );
      setWarning(settings.fedexRemovalWarning);
      setEmail(settings.adminNotificationEmail);
      setSku(settings.fedexProductSku);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load settings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function save(intent: "save" | "reset") {
    setError(null);
    setSaved(null);
    setLoading(true);
    try {
      const result = await apiPostJson<ShopSettings & { ok: boolean; reset?: boolean; error?: string }>(
        apiUrl,
        token,
        "/api/mobile/admin/settings",
        {
          intent,
          fedexRemovalWarning: warning,
          adminNotificationEmail: email,
        },
      );
      if (!result.ok) {
        setError(result.error || "Could not save settings.");
        return;
      }
      setWarning(result.fedexRemovalWarning);
      setEmail(result.adminNotificationEmail);
      setSku(result.fedexProductSku);
      setSaved(result.reset ? "FedEx warning reset to the default." : "Settings saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save settings.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.muted}>
        FedEx warning and admin email only. Create or revoke a device token on the
        website Settings page. Analytics stays on the website.
      </Text>
      {loading && !warning ? <ActivityIndicator color={THEME.darkGreen} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {saved ? <Text style={styles.success}>{saved}</Text> : null}

      <Text style={styles.label}>FedEx upgrade warning</Text>
      {sku ? <Text style={styles.muted}>Listing SKU: {sku}</Text> : null}
      <TextInput
        value={warning}
        onChangeText={setWarning}
        multiline
        style={[styles.input, styles.multiline]}
      />
      <Text style={styles.label}>Admin notification email</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        style={styles.input}
      />
      <Pressable style={styles.button} disabled={loading} onPress={() => void save("save")}>
        <Text style={styles.buttonLabel}>{loading ? "Saving…" : "Save settings"}</Text>
      </Pressable>
      <Pressable style={styles.secondary} disabled={loading} onPress={() => void save("reset")}>
        <Text style={styles.secondaryLabel}>Reset warning to default</Text>
      </Pressable>
      <Pressable style={styles.secondary} onPress={onSignOut}>
        <Text style={styles.secondaryLabel}>Sign out</Text>
      </Pressable>
    </ScrollView>
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
  error: { color: "#8e1f0b" },
  success: { color: THEME.darkGreen, fontWeight: "600" },
});
