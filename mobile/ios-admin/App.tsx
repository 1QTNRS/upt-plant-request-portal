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
import * as ImagePicker from "expo-image-picker";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";

import { apiGet, apiPost, apiUploadPhoto } from "./src/api";
import { ExactPlantsScreen } from "./src/screens/ExactPlantsScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { THEME } from "./src/theme";
import type {
  ActionResult,
  FulfillmentRoute,
  RequestDetail,
  RequestItem,
  RequestRow,
  Stats,
  StockCandidate,
} from "./src/types";
import { UNAVAILABLE_REASONS } from "./src/types";

type Tab = "list" | "exact-plants" | "settings";

const DEFAULT_API_URL = "https://upt-plant-request-portal.onrender.com";
const TOKEN_KEY = "upt_admin_token";
const URL_KEY = "upt_admin_api_url";

type Screen = "boot" | "login" | "list" | "detail";

function routeOf(item: RequestItem): FulfillmentRoute {
  if (item.availability === "not_available") return "not_available";
  return item.fulfillmentType === "growers_choice" ? "growers_choice" : "exact_plant";
}

function routeLabel(route: FulfillmentRoute): string {
  if (route === "exact_plant") return "Exact Plant";
  if (route === "growers_choice") return "Link Stock";
  return "Not Available";
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
  const [itemDrafts, setItemDrafts] = useState<Record<string, RequestItem>>({});
  const [photoUrlDraft, setPhotoUrlDraft] = useState<Record<string, string>>({});
  const [stockTerm, setStockTerm] = useState<Record<string, string>>({});
  const [stockResults, setStockResults] = useState<Record<string, StockCandidate[]>>({});
  const [expirationDays, setExpirationDays] = useState(3);
  const [noteDraft, setNoteDraft] = useState("");
  const [confirmOverride, setConfirmOverride] = useState(false);
  const [tab, setTab] = useState<Tab>("list");

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, token]);

  function applyResult(result: ActionResult) {
    if (!result.ok) {
      setError(result.error || "That action failed.");
      if (result.pendingAdminOverrideClose) setConfirmOverride(true);
      return false;
    }
    if (result.request) {
      setDetail(result.request);
      setItemDrafts(
        Object.fromEntries(result.request.items.map((item) => [item.id, item])),
      );
    }
    if (result.stockSearch) {
      setStockResults((current) => ({
        ...current,
        [result.stockSearch!.itemId]: result.stockSearch!.results,
      }));
    }
    return true;
  }

  async function runAction(body: Record<string, unknown>) {
    if (!detail) return;
    setError(null);
    setLoading(true);
    try {
      const result = await apiPost(
        apiUrl,
        token,
        `/api/mobile/admin/requests/${detail.id}`,
        body,
      );
      applyResult(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save.");
    } finally {
      setLoading(false);
    }
  }

  async function openRequest(id: string) {
    setError(null);
    setLoading(true);
    setConfirmOverride(false);
    try {
      const payload = await apiGet<RequestDetail>(
        apiUrl,
        token,
        `/api/mobile/admin/requests/${id}`,
      );
      setDetail(payload);
      setItemDrafts(Object.fromEntries(payload.items.map((item) => [item.id, item])));
      setTab("list");
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
    setTab("list");
    setScreen("login");
  }

  async function setRoute(item: RequestItem, route: FulfillmentRoute) {
    const body: Record<string, unknown> =
      route === "not_available"
        ? {
            intent: "update-item",
            itemId: item.id,
            availability: "not_available",
            unavailableReason:
              itemDrafts[item.id]?.unavailableReason || UNAVAILABLE_REASONS[3],
          }
        : {
            intent: "update-item",
            itemId: item.id,
            availability: "available",
            fulfillmentType: route,
          };
    await runAction(body);
  }

  async function saveItem(item: RequestItem) {
    const draft = itemDrafts[item.id] ?? item;
    await runAction({
      intent: "update-item",
      itemId: item.id,
      offeredName: draft.offeredName,
      price: Number(draft.price),
      weightLbs: Number(draft.weightLbs),
      customerFacingNotes: draft.customerFacingNotes,
      ...(routeOf(draft) === "not_available"
        ? {
            availability: "not_available",
            unavailableReason: draft.unavailableReason || UNAVAILABLE_REASONS[3],
          }
        : { availability: "available", fulfillmentType: routeOf(draft) }),
    });
  }

  async function pickPhoto(item: RequestItem) {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Photo library access is needed to attach an exact-plant photo.");
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (picked.canceled || !picked.assets[0] || !detail) return;
    const asset = picked.assets[0];
    setError(null);
    setLoading(true);
    try {
      const result = await apiUploadPhoto(
        apiUrl,
        token,
        `/api/mobile/admin/requests/${detail.id}`,
        item.id,
        {
          uri: asset.uri,
          name: asset.fileName || "plant.jpg",
          type: asset.mimeType || "image/jpeg",
        },
      );
      applyResult(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not upload that photo.");
    } finally {
      setLoading(false);
    }
  }

  function ItemEditor({ item }: { item: RequestItem }) {
    const draft = itemDrafts[item.id] ?? item;
    const route = routeOf(draft);
    return (
      <View style={styles.card}>
        {draft.photos[0] || draft.linkedStock?.imageUrl ? (
          <Image
            source={{ uri: draft.photos[0]?.url || draft.linkedStock?.imageUrl }}
            style={styles.photo}
          />
        ) : null}
        <Text style={styles.cardTitle}>{draft.offeredName || draft.plantName}</Text>
        <Text style={styles.muted}>Requested: {draft.plantName}</Text>
        {draft.customerRequestNotes ? (
          <Text style={styles.muted}>Customer: {draft.customerRequestNotes}</Text>
        ) : null}
        {draft.adminNotes ? <Text style={styles.muted}>Admin: {draft.adminNotes}</Text> : null}

        {detail?.canEditItems ? (
          <View style={styles.filters}>
            {(["exact_plant", "growers_choice", "not_available"] as FulfillmentRoute[]).map(
              (value) => (
                <Pressable
                  key={value}
                  style={[styles.chip, route === value && styles.chipOn]}
                  onPress={() => void setRoute(item, value)}
                >
                  <Text style={[styles.chipLabel, route === value && styles.chipLabelOn]}>
                    {routeLabel(value)}
                  </Text>
                </Pressable>
              ),
            )}
          </View>
        ) : (
          <Text style={styles.cardMeta}>{routeLabel(route)}</Text>
        )}

        {detail?.canEditItems ? (
          <>
            <Text style={styles.label}>Offered name</Text>
            <TextInput
              value={draft.offeredName}
              onChangeText={(text) =>
                setItemDrafts((current) => ({
                  ...current,
                  [item.id]: { ...draft, offeredName: text },
                }))
              }
              style={styles.input}
            />
            <View style={styles.row}>
              <View style={styles.flex}>
                <Text style={styles.label}>Price</Text>
                <TextInput
                  value={String(draft.price ?? "")}
                  onChangeText={(text) =>
                    setItemDrafts((current) => ({
                      ...current,
                      [item.id]: { ...draft, price: Number(text) || 0 },
                    }))
                  }
                  keyboardType="decimal-pad"
                  style={styles.input}
                />
              </View>
              <View style={styles.flex}>
                <Text style={styles.label}>Weight (lb)</Text>
                <TextInput
                  value={String(draft.weightLbs ?? "")}
                  onChangeText={(text) =>
                    setItemDrafts((current) => ({
                      ...current,
                      [item.id]: { ...draft, weightLbs: Number(text) || 0 },
                    }))
                  }
                  keyboardType="decimal-pad"
                  style={styles.input}
                />
              </View>
            </View>
            <Text style={styles.label}>Customer-facing notes</Text>
            <TextInput
              value={draft.customerFacingNotes}
              onChangeText={(text) =>
                setItemDrafts((current) => ({
                  ...current,
                  [item.id]: { ...draft, customerFacingNotes: text },
                }))
              }
              multiline
              style={[styles.input, styles.multiline]}
            />
            <Pressable style={styles.button} onPress={() => void saveItem(item)}>
              <Text style={styles.buttonLabel}>Save item</Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.cardMeta}>
            ${draft.price.toFixed(2)} · {draft.weightLbs} lb
          </Text>
        )}

        {route === "not_available" && detail?.canEditItems ? (
          <View style={styles.filters}>
            {UNAVAILABLE_REASONS.map((reason) => (
              <Pressable
                key={reason}
                style={[
                  styles.chip,
                  draft.unavailableReason === reason && styles.chipOn,
                ]}
                onPress={() =>
                  void runAction({
                    intent: "update-item",
                    itemId: item.id,
                    availability: "not_available",
                    unavailableReason: reason,
                  })
                }
              >
                <Text
                  style={[
                    styles.chipLabel,
                    draft.unavailableReason === reason && styles.chipLabelOn,
                  ]}
                >
                  {reason}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {route === "not_available" && draft.unavailableReason ? (
          <Text style={styles.muted}>Reason: {draft.unavailableReason}</Text>
        ) : null}

        {route === "exact_plant" ? (
          <View style={styles.block}>
            {draft.photos.map((photo) => (
              <View key={photo.id} style={styles.photoRow}>
                <Image source={{ uri: photo.url }} style={styles.thumb} />
                {detail?.canEditItems ? (
                  <Pressable
                    onPress={() =>
                      void runAction({
                        intent: "remove-photo",
                        itemId: item.id,
                        photoId: photo.id,
                      })
                    }
                  >
                    <Text style={styles.link}>Remove</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
            {detail?.canEditItems ? (
              <>
                <Pressable style={styles.secondary} onPress={() => void pickPhoto(item)}>
                  <Text style={styles.secondaryLabel}>Add photo from library</Text>
                </Pressable>
                <TextInput
                  value={photoUrlDraft[item.id] ?? ""}
                  onChangeText={(text) =>
                    setPhotoUrlDraft((current) => ({ ...current, [item.id]: text }))
                  }
                  placeholder="Or paste a photo URL"
                  placeholderTextColor={THEME.muted}
                  autoCapitalize="none"
                  style={styles.input}
                />
                <Pressable
                  style={styles.secondary}
                  onPress={() =>
                    void runAction({
                      intent: "add-photo-url",
                      itemId: item.id,
                      photoUrl: photoUrlDraft[item.id] ?? "",
                    })
                  }
                >
                  <Text style={styles.secondaryLabel}>Add photo URL</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        ) : null}

        {route === "growers_choice" ? (
          <View style={styles.block}>
            {draft.linkedStock ? (
              <Text style={styles.muted}>
                Linked: {draft.linkedStock.productTitle} · {draft.linkedStock.variantTitle}
                {detail?.canEditItems ? "  " : ""}
              </Text>
            ) : (
              <Text style={styles.muted}>No store listing linked yet.</Text>
            )}
            {detail?.canEditItems && draft.linkedStock ? (
              <Pressable
                onPress={() => void runAction({ intent: "unlink-stock", itemId: item.id })}
              >
                <Text style={styles.link}>Unlink listing</Text>
              </Pressable>
            ) : null}
            {detail?.canEditItems ? (
              <>
                <TextInput
                  value={stockTerm[item.id] ?? ""}
                  onChangeText={(text) =>
                    setStockTerm((current) => ({ ...current, [item.id]: text }))
                  }
                  placeholder="Search live website stock"
                  placeholderTextColor={THEME.muted}
                  style={styles.input}
                  onSubmitEditing={() =>
                    void runAction({
                      intent: "search-stock",
                      itemId: item.id,
                      term: stockTerm[item.id] ?? "",
                    })
                  }
                  returnKeyType="search"
                />
                <Pressable
                  style={styles.secondary}
                  onPress={() =>
                    void runAction({
                      intent: "search-stock",
                      itemId: item.id,
                      term: stockTerm[item.id] ?? "",
                    })
                  }
                >
                  <Text style={styles.secondaryLabel}>Search stock</Text>
                </Pressable>
                {(stockResults[item.id] ?? []).map((candidate) => (
                  <View key={candidate.variantGid} style={styles.stockRow}>
                    <Text style={styles.cardTitle}>
                      {candidate.productTitle} · {candidate.variantTitle}
                    </Text>
                    <Text style={styles.muted}>
                      ${candidate.price.toFixed(2)}
                      {candidate.unlinkableReason ? ` · ${candidate.unlinkableReason}` : ""}
                    </Text>
                    {!candidate.unlinkableReason ? (
                      <Pressable
                        onPress={() =>
                          void runAction({
                            intent: "link-stock",
                            itemId: item.id,
                            variantGid: candidate.variantGid,
                          })
                        }
                      >
                        <Text style={styles.link}>Link this listing</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </>
            ) : null}
          </View>
        ) : null}
      </View>
    );
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

      {screen === "list" && tab === "list" ? (
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

      {screen !== "boot" && screen !== "login" && tab === "exact-plants" ? (
        <ExactPlantsScreen
          apiUrl={apiUrl}
          token={token}
          onOpenRequest={(requestId) => void openRequest(requestId)}
        />
      ) : null}

      {screen !== "boot" && screen !== "login" && tab === "settings" ? (
        <SettingsScreen apiUrl={apiUrl} token={token} onSignOut={() => void signOut()} />
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
          {loading ? <ActivityIndicator color={THEME.darkGreen} /> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {detail.items.map((item) => (
            <ItemEditor key={item.id} item={item} />
          ))}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Send offer</Text>
            {detail.sentOffer ? (
              <Text style={styles.muted}>
                Sent for {detail.sentOffer.expirationDays} days. Frozen after send.
              </Text>
            ) : (
              <>
                {detail.offerProblems.map((problem) => (
                  <Text key={problem.itemName} style={styles.error}>
                    {problem.itemName} is missing {problem.missing.join(", ")}.
                  </Text>
                ))}
                <View style={styles.filters}>
                  {[3, 5, 7].map((days) => (
                    <Pressable
                      key={days}
                      style={[styles.chip, expirationDays === days && styles.chipOn]}
                      onPress={() => setExpirationDays(days)}
                    >
                      <Text
                        style={[
                          styles.chipLabel,
                          expirationDays === days && styles.chipLabelOn,
                        ]}
                      >
                        {days} days
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable
                  style={[styles.button, !detail.canSendOffer && styles.buttonDisabled]}
                  disabled={!detail.canSendOffer || loading}
                  onPress={() =>
                    void runAction({ intent: "send-offer", expirationDays })
                  }
                >
                  <Text style={styles.buttonLabel}>Send offer</Text>
                </Pressable>
              </>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Internal notes</Text>
            {detail.internalNotes.map((note) => (
              <Text key={note.id} style={styles.muted}>
                {note.body}
              </Text>
            ))}
            <TextInput
              value={noteDraft}
              onChangeText={setNoteDraft}
              placeholder="Note for the team only"
              placeholderTextColor={THEME.muted}
              style={styles.input}
            />
            <Pressable
              style={styles.secondary}
              onPress={() => {
                void runAction({ intent: "add-internal-note", note: noteDraft });
                setNoteDraft("");
              }}
            >
              <Text style={styles.secondaryLabel}>Add note</Text>
            </Pressable>
          </View>

          {detail.canCloseDeclined ? (
            <Pressable
              style={styles.secondary}
              onPress={() => void runAction({ intent: "close-request" })}
            >
              <Text style={styles.secondaryLabel}>Close declined request</Text>
            </Pressable>
          ) : null}

          {detail.canOverrideClose ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Close entire request</Text>
              <Text style={styles.muted}>
                Admin override. History stays. An unpaid invoice is voided.
              </Text>
              {confirmOverride ? (
                <Pressable
                  style={styles.danger}
                  onPress={() =>
                    void runAction({
                      intent: "admin-override-close",
                      confirmed: "true",
                    })
                  }
                >
                  <Text style={styles.buttonLabel}>Confirm close entire request</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={styles.secondary}
                  onPress={() => void runAction({ intent: "admin-override-close" })}
                >
                  <Text style={styles.secondaryLabel}>Close entire request</Text>
                </Pressable>
              )}
            </View>
          ) : null}
        </ScrollView>
      ) : null}

      {screen !== "boot" && screen !== "login" && screen !== "detail" ? (
        <View style={styles.tabs}>
          {(
            [
              ["list", "Requests"],
              ["exact-plants", "EXACT PLANTS"],
              ["settings", "Settings"],
            ] as const
          ).map(([value, label]) => (
            <Pressable
              key={value}
              style={[styles.tab, tab === value && styles.tabOn]}
              onPress={() => setTab(value)}
            >
              <Text style={[styles.tabLabel, tab === value && styles.tabLabelOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
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
  multiline: { minHeight: 72, textAlignVertical: "top" },
  button: {
    backgroundColor: THEME.darkGreen,
    minHeight: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.45 },
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
  danger: {
    backgroundColor: "#8e1f0b",
    minHeight: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
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
  thumb: { width: 72, height: 72, borderRadius: 8 },
  photoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  row: { flexDirection: "row", gap: 8 },
  block: { marginTop: 8 },
  stockRow: {
    borderTopWidth: 1,
    borderTopColor: THEME.line,
    paddingTop: 8,
    marginTop: 8,
  },
  tabs: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: THEME.line,
    backgroundColor: THEME.white,
  },
  tab: {
    flex: 1,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  tabOn: { borderTopWidth: 3, borderTopColor: THEME.darkGreen },
  tabLabel: { color: THEME.muted, fontWeight: "600", fontSize: 12, textAlign: "center" },
  tabLabelOn: { color: THEME.darkGreen },
});
