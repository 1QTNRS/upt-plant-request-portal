import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";

const THEME = {
  darkGreen: "#002910",
  yellow: "#f1a638",
  mint: "#d6ece2",
  cream: "#f7faf7",
  white: "#ffffff",
  muted: "#4a5c52",
  line: "#c9d9d0",
};

const DEFAULT_API_URL = "https://upt-plant-request-portal.onrender.com";
const TOKEN_KEY = "upt_admin_token";
const URL_KEY = "upt_admin_api_url";

type Stats = {
  newRequests: number;
  pending: number;
  closed: number;
  expired: number;
};

type RequestRow = {
  id: string;
  requestNumber: string;
  customer: string;
  email: string;
  plantsRequested: string;
  status: string;
  submittedAtIso: string;
  hasResponded: boolean;
};

type RequestDetail = {
  id: string;
  requestNumber: string;
  customer: string;
  email: string;
  status: string;
  submittedAtIso: string;
  items: Array<{
    id: string;
    plantName: string;
    offeredName: string;
    availability: string;
    unavailableReason?: string;
    fulfillmentType: string;
    price: number;
    weightLbs: number;
    customerRequestNotes?: string;
    customerFacingNotes: string;
    adminNotes: string;
    photoUrls: string[];
  }>;
};

type Screen = "boot" | "login" | "list" | "detail";

async function apiGet<T>(
  apiUrl: string,
  token: string,
  path: string,
): Promise<T> {
  const response = await fetch(`${apiUrl.replace(/\/+$/, "")}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) {
    throw new Error("That device token was rejected. Create a new one in Settings.");
  }
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("boot");
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [detail, setDetail] = useState<RequestDetail | null>(null);

  useEffect(() => {
    void (async () => {
      const savedToken = await SecureStore.getItemAsync(TOKEN_KEY);
      const savedUrl = await SecureStore.getItemAsync(URL_KEY);
      if (savedUrl) setApiUrl(savedUrl);
      if (!savedToken) {
        setScreen("login");
        return;
      }
      setToken(savedToken);
      try {
        await apiGet(savedUrl || DEFAULT_API_URL, savedToken, "/api/mobile/admin/session");
        setScreen("list");
      } catch {
        setScreen("login");
      }
    })();
  }, []);

  async function signIn() {
    setError(null);
    setLoading(true);
    try {
      await apiGet(apiUrl, token.trim(), "/api/mobile/admin/session");
      await SecureStore.setItemAsync(TOKEN_KEY, token.trim());
      await SecureStore.setItemAsync(URL_KEY, apiUrl.trim());
      setScreen("list");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign in.");
    } finally {
      setLoading(false);
    }
  }

  async function loadList(nextQuery = query, nextStatus = statusFilter) {
    setError(null);
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (nextQuery.trim()) params.set("q", nextQuery.trim());
      if (nextStatus !== "All") params.set("status", nextStatus);
      const path = `/api/mobile/admin/requests${params.size ? `?${params}` : ""}`;
      const payload = await apiGet<{ stats: Stats; requests: RequestRow[] }>(
        apiUrl,
        token,
        path,
      );
      setStats(payload.stats);
      setRequests(payload.requests);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load requests.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (screen === "list" && token) void loadList();
    // Load when entering the list, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, token]);

  async function openRequest(id: string) {
    setError(null);
    setLoading(true);
    try {
      const payload = await apiGet<RequestDetail>(
        apiUrl,
        token,
        `/api/mobile/admin/requests/${id}`,
      );
      setDetail(payload);
      setScreen("detail");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load that request.");
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setToken("");
    setRequests([]);
    setDetail(null);
    setScreen("login");
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      {screen === "boot" ? (
        <View style={styles.centered}>
          <ActivityIndicator color={THEME.darkGreen} />
        </View>
      ) : null}

      {screen === "login" ? (
        <ScrollView contentContainerStyle={styles.page}>
          <Text style={styles.title}>UPT Admin</Text>
          <Text style={styles.muted}>
            Create a device token in Shopify admin → Settings → iOS admin app,
            then paste it here.
          </Text>
          <Text style={styles.label}>App URL</Text>
          <TextInput
            value={apiUrl}
            onChangeText={setApiUrl}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <Text style={styles.label}>Device token</Text>
          <TextInput
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={styles.input}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable style={styles.button} onPress={() => void signIn()} disabled={loading}>
            <Text style={styles.buttonLabel}>{loading ? "Signing in…" : "Sign in"}</Text>
          </Pressable>
        </ScrollView>
      ) : null}

      {screen === "list" ? (
        <View style={styles.flex}>
          <View style={styles.header}>
            <Text style={styles.title}>Requests</Text>
            <Pressable onPress={() => void signOut()}>
              <Text style={styles.link}>Sign out</Text>
            </Pressable>
          </View>
          {stats ? (
            <View style={styles.stats}>
              {[
                ["New", stats.newRequests],
                ["Pending", stats.pending],
                ["Closed", stats.closed],
                ["Expired", stats.expired],
              ].map(([label, value]) => (
                <View key={label} style={styles.stat}>
                  <Text style={styles.statValue}>{value}</Text>
                  <Text style={styles.statLabel}>{label}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search name, email, request #, plant"
            placeholderTextColor={THEME.muted}
            style={styles.input}
            onSubmitEditing={() => void loadList(query, statusFilter)}
            returnKeyType="search"
          />
          <View style={styles.filters}>
            {["All", "New", "Pending", "Expired", "Closed"].map((status) => (
              <Pressable
                key={status}
                style={[styles.chip, statusFilter === status && styles.chipOn]}
                onPress={() => {
                  setStatusFilter(status);
                  void loadList(query, status);
                }}
              >
                <Text style={[styles.chipLabel, statusFilter === status && styles.chipLabelOn]}>
                  {status}
                </Text>
              </Pressable>
            ))}
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <ScrollView>
            {loading && requests.length === 0 ? (
              <ActivityIndicator color={THEME.darkGreen} />
            ) : null}
            {requests.map((row) => (
              <Pressable key={row.id} style={styles.card} onPress={() => void openRequest(row.id)}>
                <Text style={styles.cardTitle}>{row.requestNumber}</Text>
                <Text style={styles.cardMeta}>
                  {row.status} · {row.customer}
                </Text>
                <Text style={styles.muted}>{row.plantsRequested || "No plants listed"}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {screen === "detail" && detail ? (
        <ScrollView contentContainerStyle={styles.page}>
          <Pressable onPress={() => setScreen("list")}>
            <Text style={styles.link}>← Requests</Text>
          </Pressable>
          <Text style={styles.title}>{detail.requestNumber}</Text>
          <Text style={styles.cardMeta}>
            {detail.status} · {detail.customer}
          </Text>
          <Text style={styles.muted}>{detail.email}</Text>
          {detail.items.map((item) => (
            <View key={item.id} style={styles.card}>
              {item.photoUrls[0] ? (
                <Image source={{ uri: item.photoUrls[0] }} style={styles.photo} />
              ) : null}
              <Text style={styles.cardTitle}>{item.offeredName || item.plantName}</Text>
              <Text style={styles.cardMeta}>
                {item.availability === "not_available" ? "Not Available" : item.fulfillmentType} · $
                {item.price.toFixed(2)}
              </Text>
              {item.unavailableReason ? (
                <Text style={styles.muted}>Reason: {item.unavailableReason}</Text>
              ) : null}
              {item.customerRequestNotes ? (
                <Text style={styles.muted}>Customer: {item.customerRequestNotes}</Text>
              ) : null}
              {item.customerFacingNotes ? (
                <Text style={styles.muted}>Offer notes: {item.customerFacingNotes}</Text>
              ) : null}
              {item.adminNotes ? (
                <Text style={styles.muted}>Admin: {item.adminNotes}</Text>
              ) : null}
            </View>
          ))}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: THEME.mint },
  flex: { flex: 1, padding: 16 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  page: { padding: 16, gap: 12 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
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
  button: {
    backgroundColor: THEME.darkGreen,
    minHeight: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonLabel: { color: THEME.white, fontWeight: "700" },
  link: { color: THEME.darkGreen, fontWeight: "600" },
  error: { color: "#8e1f0b" },
  stats: { flexDirection: "row", gap: 8, marginBottom: 12 },
  stat: {
    flex: 1,
    backgroundColor: THEME.white,
    borderRadius: 10,
    padding: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: THEME.line,
  },
  statValue: { color: THEME.darkGreen, fontSize: 20, fontWeight: "700" },
  statLabel: { color: THEME.muted, fontSize: 12 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: THEME.line,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: THEME.white,
  },
  chipOn: { backgroundColor: THEME.darkGreen, borderColor: THEME.darkGreen },
  chipLabel: { color: THEME.darkGreen, fontWeight: "600" },
  chipLabelOn: { color: THEME.white },
  card: {
    backgroundColor: THEME.white,
    borderColor: THEME.line,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  cardTitle: { color: THEME.darkGreen, fontWeight: "700", fontSize: 16 },
  cardMeta: { color: THEME.darkGreen, marginTop: 4 },
  photo: { width: "100%", height: 160, borderRadius: 10, marginBottom: 8 },
});
