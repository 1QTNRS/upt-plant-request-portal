import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { apiGet } from "../api";
import { ui } from "../ui";

type Props = {
  apiUrl: string;
  token: string;
  onApiUrl: (value: string) => void;
  onToken: (value: string) => void;
  onSignedIn: () => void;
};

export function LoginScreen({ apiUrl, token, onApiUrl, onToken, onSignedIn }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setError(null);
    setLoading(true);
    try {
      await apiGet(apiUrl, token.trim(), "/api/mobile/admin/session");
      onSignedIn();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign in.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={ui.flex} edges={["top", "left", "right", "bottom"]}>
    <ScrollView contentContainerStyle={ui.page} keyboardShouldPersistTaps="handled">
      <Text style={ui.title}>Request Portal</Text>
      <Text style={ui.muted}>
        Create a device token in Shopify admin → Settings → iOS admin app, then paste it
        here.
      </Text>
      <Text style={ui.label}>App URL</Text>
      <TextInput
        value={apiUrl}
        onChangeText={onApiUrl}
        autoCapitalize="none"
        autoCorrect={false}
        style={ui.input}
      />
      <Text style={ui.label}>Device token</Text>
      <TextInput
        value={token}
        onChangeText={onToken}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        style={ui.input}
      />
      {error ? <Text style={ui.error}>{error}</Text> : null}
      <Pressable style={ui.button} onPress={() => void signIn()} disabled={loading}>
        <Text style={ui.buttonLabel}>{loading ? "Signing in…" : "Sign in"}</Text>
      </Pressable>
    </ScrollView>
    </SafeAreaView>
  );
}
