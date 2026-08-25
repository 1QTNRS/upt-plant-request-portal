import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { apiGet, apiPostJson } from "../api";
import { THEME } from "../theme";
import type {
  ExactPlantActionResult,
  ExactPlantFilter,
  ExactPlantReview,
  ExactPlantRow,
} from "../types";

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

type Props = {
  apiUrl: string;
  token: string;
  onOpenRequest: (requestId: string) => void;
};

export function ExactPlantsScreen({ apiUrl, token, onOpenRequest }: Props) {
  const [filter, setFilter] = useState<ExactPlantFilter>("not_yet_listed");
  const [counts, setCounts] = useState<Record<ExactPlantFilter, number> | null>(null);
  const [items, setItems] = useState<ExactPlantRow[]>([]);
  const [review, setReview] = useState<ExactPlantReview | null>(null);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [weightLbs, setWeightLbs] = useState("");
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadQueue(nextFilter = filter) {
    setError(null);
    setLoading(true);
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
    }
  }

  useEffect(() => {
    void loadQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function applyReview(next: ExactPlantReview) {
    setReview(next);
    setTitle(next.draft.title);
    setPrice(String(next.draft.price));
    setWeightLbs(String(next.draft.weightLbs));
    setPhotoUrls(next.draft.photoUrls);
    setConfirmDismiss(false);
  }

  async function openReview(itemId: string) {
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
  }

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
      else {
        setReview(null);
        await loadQueue();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save.");
    } finally {
      setLoading(false);
    }
  }

  if (review) {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <Pressable
          onPress={() => {
            setReview(null);
            void loadQueue();
          }}
        >
          <Text style={styles.link}>← EXACT PLANTS</Text>
        </Pressable>
        <Text style={styles.title}>{review.listed ? "Listed" : "Review listing"}</Text>
        <Text style={styles.cardMeta}>{review.releaseLabel}</Text>
        {loading ? <ActivityIndicator color={THEME.darkGreen} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {review.listed ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{review.draft.title}</Text>
            <Text style={styles.muted}>
              ${review.draft.price.toFixed(2)} · {review.draft.weightLbs} lb
            </Text>
            <Pressable onPress={() => onOpenRequest(review.requestId)}>
              <Text style={styles.link}>Open the request</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.muted}>
              Nothing is published until you approve. Customer notes stay off the listing.
            </Text>
            <Text style={styles.label}>Product title</Text>
            <TextInput value={title} onChangeText={setTitle} style={styles.input} />
            <View style={styles.row}>
              <View style={styles.half}>
                <Text style={styles.label}>Price</Text>
                <TextInput
                  value={price}
                  onChangeText={setPrice}
                  keyboardType="decimal-pad"
                  style={styles.input}
                />
              </View>
              <View style={styles.half}>
                <Text style={styles.label}>Weight (lb)</Text>
                <TextInput
                  value={weightLbs}
                  onChangeText={setWeightLbs}
                  keyboardType="decimal-pad"
                  style={styles.input}
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
                  <Text style={styles.link}>Remove</Text>
                </Pressable>
              </View>
            ))}
            {review.canList ? (
              <Pressable
                style={styles.button}
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
                <Text style={styles.buttonLabel}>
                  {review.listing?.status === "failed"
                    ? "Retry EXACT PLANTS listing"
                    : "Approve and create listing"}
                </Text>
              </Pressable>
            ) : null}
          </View>
        )}

        {review.canDismiss ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Dismiss from EXACT PLANTS</Text>
            <Text style={styles.muted}>
              Removes this plant from the queue. No Shopify product is created. History stays.
            </Text>
            {confirmDismiss ? (
              <Pressable
                style={styles.danger}
                onPress={() =>
                  void runAction({
                    intent: "dismiss-exact-plant",
                    confirmed: "true",
                  })
                }
              >
                <Text style={styles.buttonLabel}>Confirm dismiss</Text>
              </Pressable>
            ) : (
              <Pressable
                style={styles.secondary}
                onPress={() => void runAction({ intent: "dismiss-exact-plant" })}
              >
                <Text style={styles.secondaryLabel}>Dismiss from EXACT PLANTS</Text>
              </Pressable>
            )}
          </View>
        ) : null}
      </ScrollView>
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>EXACT PLANTS</Text>
      <Text style={styles.muted}>
        Review declined or expired exact plants. Nothing goes live until you approve.
      </Text>
      <View style={styles.filters}>
        {FILTERS.map((value) => (
          <Pressable
            key={value}
            style={[styles.chip, filter === value && styles.chipOn]}
            onPress={() => {
              setFilter(value);
              void loadQueue(value);
            }}
          >
            <Text style={[styles.chipLabel, filter === value && styles.chipLabelOn]}>
              {FILTER_LABELS[value]}
              {counts ? ` (${counts[value]})` : ""}
            </Text>
          </Pressable>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ScrollView>
        {loading && items.length === 0 ? <ActivityIndicator color={THEME.darkGreen} /> : null}
        {items.map((row) => (
          <Pressable
            key={row.requestItemId}
            style={styles.card}
            onPress={() =>
              row.listingStatus === "dismissed"
                ? onOpenRequest(row.requestId)
                : void openReview(row.requestItemId)
            }
          >
            {row.photoUrl ? <Image source={{ uri: row.photoUrl }} style={styles.photo} /> : null}
            <Text style={styles.cardTitle}>{row.title}</Text>
            <Text style={styles.cardMeta}>
              {row.requestNumber} · {row.listingLabel}
            </Text>
            <Text style={styles.muted}>
              {row.releaseLabel} · ${row.price.toFixed(2)} · {row.weightLbs} lb
            </Text>
            {row.lastError ? <Text style={styles.error}>{row.lastError}</Text> : null}
          </Pressable>
        ))}
        {!loading && items.length === 0 ? (
          <Text style={styles.muted}>No exact plants match this filter.</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16 },
  page: { padding: 16, gap: 12 },
  title: {
    color: THEME.darkGreen,
    fontSize: 28,
    fontWeight: "700",
    fontFamily: "Georgia",
    marginBottom: 8,
  },
  muted: { color: THEME.muted, lineHeight: 20, marginBottom: 8 },
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
    marginTop: 8,
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
  error: { color: "#8e1f0b", marginBottom: 8 },
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
  cardMeta: { color: THEME.darkGreen, marginTop: 4, marginBottom: 4 },
  photo: { width: "100%", height: 140, borderRadius: 10, marginBottom: 8 },
  thumb: { width: 72, height: 72, borderRadius: 8 },
  photoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  row: { flexDirection: "row", gap: 8 },
  half: { flex: 1 },
});
