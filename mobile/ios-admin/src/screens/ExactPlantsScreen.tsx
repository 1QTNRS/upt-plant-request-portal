import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";

import { apiGet, apiPostJson } from "../api";
import { useSession } from "../SessionContext";
import { THEME } from "../theme";
import type {
  ExactPlantActionResult,
  ExactPlantFilter,
  ExactPlantReview,
  ExactPlantRow,
} from "../types";
import { ui } from "../ui";
import type { ExactPlantsStackParamList } from "./navigation-types";

const FILTERS: ExactPlantFilter[] = [
  "all",
  "not_yet_listed",
  "flagged",
  "listed",
  "dismissed",
];

const FILTER_LABELS: Record<ExactPlantFilter, string> = {
  all: "All",
  not_yet_listed: "Not listed",
  flagged: "Flagged",
  listed: "Listed",
  dismissed: "Dismissed",
};

type ListProps = NativeStackScreenProps<ExactPlantsStackParamList, "ExactPlantsList">;

export function ExactPlantsScreen({ navigation }: ListProps) {
  const { apiUrl, token } = useSession();
  const [filter, setFilter] = useState<ExactPlantFilter>("not_yet_listed");
  const [counts, setCounts] = useState<Record<ExactPlantFilter, number> | null>(null);
  const [items, setItems] = useState<ExactPlantRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadQueue = useCallback(
    async (nextFilter = filter, mode: "initial" | "refresh" = "initial") => {
      setError(null);
      if (mode === "refresh") setRefreshing(true);
      else setLoading(true);
      try {
        const payload = await apiGet<{
          counts: Record<ExactPlantFilter, number>;
          items: ExactPlantRow[];
        }>(apiUrl, token, `/api/mobile/admin/exact-plants?listing=${nextFilter}`);
        setCounts(payload.counts);
        setItems(payload.items);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not load EXACT PLANTS.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [apiUrl, filter, token],
  );

  useEffect(() => {
    void loadQueue(filter, "initial");
  }, [filter, loadQueue]);

  return (
    <SafeAreaView style={ui.screen} edges={["top", "left", "right"]}>
      <Text style={ui.title}>EXACT PLANTS</Text>
      <Text style={ui.muted}>
        Review declined or expired exact plants. Nothing goes live until you approve.
      </Text>
      <View style={ui.filters}>
        {FILTERS.map((value) => (
          <Pressable
            key={value}
            style={[ui.chip, filter === value && ui.chipOn]}
            onPress={() => setFilter(value)}
          >
            <Text style={[ui.chipLabel, filter === value && ui.chipLabelOn]}>
              {FILTER_LABELS[value]}
              {counts ? ` (${counts[value]})` : ""}
            </Text>
          </Pressable>
        ))}
      </View>
      {error ? <Text style={ui.error}>{error}</Text> : null}
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadQueue(filter, "refresh")}
            tintColor={THEME.darkGreen}
          />
        }
      >
        {loading && items.length === 0 ? <ActivityIndicator color={THEME.darkGreen} /> : null}
        {items.map((row) => (
          <Pressable
            key={row.requestItemId}
            style={ui.card}
            onPress={() =>
              row.listingStatus === "dismissed"
                ? navigation.getParent()?.navigate("Requests", {
                    screen: "RequestDetail",
                    params: { requestId: row.requestId },
                  })
                : navigation.navigate("ExactPlantsReview", { itemId: row.requestItemId })
            }
          >
            {row.photoUrl ? <Image source={{ uri: row.photoUrl }} style={styles.photo} /> : null}
            <Text style={ui.cardTitle}>{row.title}</Text>
            <Text style={ui.cardMeta}>
              {row.requestNumber} · {row.listingLabel}
            </Text>
            <Text style={ui.muted}>
              {row.releaseLabel} · ${row.price.toFixed(2)} · {row.weightLbs} lb
            </Text>
            {row.lastError ? <Text style={ui.error}>{row.lastError}</Text> : null}
          </Pressable>
        ))}
        {!loading && items.length === 0 ? (
          <Text style={ui.muted}>No exact plants match this filter.</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

type ReviewProps = NativeStackScreenProps<ExactPlantsStackParamList, "ExactPlantsReview">;

export function ExactPlantsReviewScreen({ navigation, route }: ReviewProps) {
  const { apiUrl, token } = useSession();
  const { itemId } = route.params;
  const [review, setReview] = useState<ExactPlantReview | null>(null);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [weightLbs, setWeightLbs] = useState("");
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyReview(next: ExactPlantReview) {
    setReview(next);
    setTitle(next.draft.title);
    setPrice(String(next.draft.price));
    setWeightLbs(String(next.draft.weightLbs));
    setPhotoUrls(next.draft.photoUrls);
    setConfirmDismiss(false);
  }

  useEffect(() => {
    void (async () => {
      setError(null);
      setLoading(true);
      try {
        applyReview(
          await apiGet<ExactPlantReview>(
            apiUrl,
            token,
            `/api/mobile/admin/exact-plants/${itemId}`,
          ),
        );
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not load that plant.");
      } finally {
        setLoading(false);
      }
    })();
  }, [apiUrl, itemId, token]);

  async function runAction(body: Record<string, unknown>) {
    if (!review) return;
    setError(null);
    setLoading(true);
    try {
      const result = await apiPostJson<ExactPlantActionResult>(
        apiUrl,
        token,
        `/api/mobile/admin/exact-plants/${review.requestItemId}`,
        body,
      );
      if (!result.ok) {
        setError(result.error || "That action failed.");
        if (result.pendingDismiss) setConfirmDismiss(true);
        return;
      }
      if (result.review) applyReview(result.review);
      else navigation.goBack();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={ui.flex} edges={["top", "left", "right", "bottom"]}>
    <ScrollView contentContainerStyle={ui.page} keyboardShouldPersistTaps="handled">
      <Pressable onPress={() => navigation.goBack()}>
        <Text style={ui.link}>← EXACT PLANTS</Text>
      </Pressable>
      <Text style={ui.title}>{review?.listed ? "Listed" : "Review listing"}</Text>
      {review ? <Text style={ui.cardMeta}>{review.releaseLabel}</Text> : null}
      {loading ? <ActivityIndicator color={THEME.darkGreen} /> : null}
      {error ? <Text style={ui.error}>{error}</Text> : null}

      {review?.listed ? (
        <View style={ui.card}>
          <Text style={ui.cardTitle}>{review.draft.title}</Text>
          <Text style={ui.muted}>
            ${review.draft.price.toFixed(2)} · {review.draft.weightLbs} lb
          </Text>
          <Pressable
            onPress={() =>
              navigation.getParent()?.navigate("Requests", {
                screen: "RequestDetail",
                params: { requestId: review.requestId },
              })
            }
          >
            <Text style={ui.link}>Open the request</Text>
          </Pressable>
        </View>
      ) : review ? (
        <View style={ui.card}>
          <Text style={ui.muted}>
            Nothing is published until you approve. Customer notes stay off the listing.
          </Text>
          <Text style={ui.label}>Product title</Text>
          <TextInput value={title} onChangeText={setTitle} style={ui.input} />
          <View style={ui.row}>
            <View style={ui.flexItem}>
              <Text style={ui.label}>Price</Text>
              <TextInput
                value={price}
                onChangeText={setPrice}
                keyboardType="decimal-pad"
                style={ui.input}
              />
            </View>
            <View style={ui.flexItem}>
              <Text style={ui.label}>Weight (lb)</Text>
              <TextInput
                value={weightLbs}
                onChangeText={setWeightLbs}
                keyboardType="decimal-pad"
                style={ui.input}
              />
            </View>
          </View>
          {photoUrls.map((url, index) => (
            <View key={`${url}-${index}`} style={styles.photoRow}>
              <Image source={{ uri: url }} style={styles.thumb} />
              <Pressable
                onPress={() =>
                  setPhotoUrls((current) =>
                    current.filter((_, photoIndex) => photoIndex !== index),
                  )
                }
              >
                <Text style={ui.link}>Remove</Text>
              </Pressable>
            </View>
          ))}
          {review.canList ? (
            <Pressable
              style={ui.button}
              disabled={loading}
              onPress={() =>
                void runAction({
                  intent: "create-listing",
                  title,
                  price,
                  weightLbs,
                  photoUrls,
                })
              }
            >
              <Text style={ui.buttonLabel}>
                {review.listing?.status === "failed"
                  ? "Retry EXACT PLANTS listing"
                  : "Approve and create listing"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {review?.canDismiss ? (
        <View style={ui.card}>
          <Text style={ui.cardTitle}>Dismiss from EXACT PLANTS</Text>
          <Text style={ui.muted}>
            Removes this plant from the queue. No Shopify product is created. History stays.
          </Text>
          {confirmDismiss ? (
            <Pressable
              style={ui.danger}
              onPress={() =>
                void runAction({
                  intent: "dismiss-exact-plant",
                  confirmed: "true",
                })
              }
            >
              <Text style={ui.buttonLabel}>Confirm dismiss</Text>
            </Pressable>
          ) : (
            <Pressable
              style={ui.secondary}
              onPress={() => void runAction({ intent: "dismiss-exact-plant" })}
            >
              <Text style={ui.secondaryLabel}>Dismiss from EXACT PLANTS</Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  photo: { width: "100%", height: 140, borderRadius: 10, marginBottom: 8 },
  thumb: { width: 72, height: 72, borderRadius: 8 },
  photoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
});
