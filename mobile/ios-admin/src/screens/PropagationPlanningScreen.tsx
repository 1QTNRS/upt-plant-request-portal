import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import { formatPortalDateOnly } from "../admin-time";
import { apiPath } from "../query";
import { useSession } from "../SessionContext";
import { THEME } from "../theme";
import type {
  PropagationCategoryPlantRow,
  PropagationPlanningCategory,
  PropagationPlanningPayload,
} from "../types";
import { usePrimaryScrollProps } from "../use-primary-scroll";
import { useRootTabBarHiddenOnFocus } from "../use-root-tab-bar";
import type { SettingsStackParamList } from "./navigation-types";

type Props = NativeStackScreenProps<SettingsStackParamList, "PropagationPlanning">;

type StatusFilter = PropagationPlanningPayload["filters"]["status"];
type DateRange = PropagationPlanningPayload["filters"]["dateRange"];
type Sort = PropagationPlanningPayload["filters"]["sort"];

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "needs", label: "Needs" },
  { value: "done", label: "Done" },
  { value: "all", label: "All" },
];

const DATE_OPTIONS: Array<{ value: DateRange; label: string }> = [
  { value: "all", label: "All Time" },
  { value: "90d", label: "Last 90 Days" },
  { value: "30d", label: "Last 30 Days" },
];

const SORT_OPTIONS: Array<{ value: Sort; label: string }> = [
  { value: "most_requested", label: "Most Requested" },
  { value: "oldest_request", label: "Oldest Request" },
  { value: "az", label: "A–Z" },
];

function PlantRow({
  plant,
  categoryActionLabel,
  isOther,
  expanded,
  onToggleExpand,
  onToggleDone,
  notesDraft,
  onNotesChange,
  onSaveNotes,
  savingNotes,
  togglingDone,
}: {
  plant: PropagationCategoryPlantRow;
  categoryActionLabel: string;
  isOther: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleDone: () => void;
  notesDraft: string;
  onNotesChange: (value: string) => void;
  onSaveNotes: () => void;
  savingNotes: boolean;
  togglingDone: boolean;
}) {
  const checked = plant.state.done;
  const checkLabel = checked
    ? `✓ ${categoryActionLabel}${
        plant.state.completedAtIso
          ? ` · ${formatPortalDateOnly(plant.state.completedAtIso)}`
          : ""
      }`
    : `☐ ${categoryActionLabel}`;

  return (
    <View style={styles.plantRow}>
      <Pressable onPress={onToggleDone} disabled={togglingDone} style={styles.checkRow}>
        <Text style={styles.checkLabel}>{checkLabel}</Text>
      </Pressable>

      {isOther ? (
        <Pressable onPress={onToggleExpand}>
          <Text style={styles.plantNameLink}>{plant.displayName}</Text>
        </Pressable>
      ) : (
        <Text style={styles.plantName}>{plant.displayName}</Text>
      )}

      <Text style={styles.plantMeta}>
        {plant.uniqueCustomerCount} {plant.uniqueCustomerCount === 1 ? "person" : "people"}{" "}
        requested
      </Text>
      <Text style={styles.plantMeta}>
        Oldest request: {formatPortalDateOnly(plant.oldestRequestAtIso)}
      </Text>
      {plant.newSinceDone > 0 ? (
        <Text style={styles.newSinceDone}>
          {plant.newSinceDone} new request{plant.newSinceDone === 1 ? "" : "s"} since done
        </Text>
      ) : null}

      {expanded ? (
        <View style={styles.expandedBlock}>
          {isOther ? (
            <View style={styles.otherBlock}>
              {plant.otherOccurrences.map((row) => (
                <View key={row.offerItemId} style={styles.otherItem}>
                  <Text style={styles.otherHeading}>
                    {formatPortalDateOnly(row.submittedAtIso)} · {row.requestNumber}
                  </Text>
                  <Text style={styles.otherLabel}>Customer-facing response:</Text>
                  <Text style={styles.otherBody}>
                    {row.customerFacingNotes || "No customer-facing notes."}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          <Text style={styles.notesLabel}>Prop Notes</Text>
          <TextInput
            value={notesDraft}
            onChangeText={onNotesChange}
            multiline
            placeholder="Mother plant recovering. Prop after next watering."
            placeholderTextColor={THEME.muted}
            style={styles.notesInput}
          />
          <Pressable
            onPress={onSaveNotes}
            disabled={savingNotes}
            style={[styles.saveNotesButton, savingNotes ? styles.saveNotesDisabled : null]}
          >
            <Text style={styles.saveNotesText}>
              {savingNotes ? "Saving…" : "Save Prop Notes"}
            </Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={onToggleExpand}>
          <Text style={styles.expandHint}>
            {isOther ? "Show responses & Prop Notes" : "Prop Notes & details"}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

export function PropagationPlanningScreen({ navigation }: Props) {
  useRootTabBarHiddenOnFocus();
  const primaryScrollProps = usePrimaryScrollProps();
  const { apiUrl, token } = useSession();
  const [payload, setPayload] = useState<PropagationPlanningPayload | null>(null);
  const [status, setStatus] = useState<StatusFilter>("needs");
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [sort, setSort] = useState<Sort>("most_requested");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [notesDrafts, setNotesDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingNotesKey, setSavingNotesKey] = useState<string | null>(null);
  const [togglingDoneKey, setTogglingDoneKey] = useState<string | null>(null);

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      setError(null);
      if (mode === "refresh") setRefreshing(true);
      else setLoading(true);
      try {
        const path = apiPath("/api/mobile/admin/propagation-planning", {
          status,
          dateRange,
          sort,
          q: query.trim() || undefined,
        });
        const next = await apiGet<PropagationPlanningPayload>(apiUrl, token, path);
        setPayload(next);
        setNotesDrafts((current) => {
          const merged = { ...current };
          for (const category of next.categories) {
            for (const plant of category.plants) {
              if (merged[plant.groupKey] === undefined) {
                merged[plant.groupKey] = plant.state.propNotes;
              }
            }
          }
          return merged;
        });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not load propagation planning.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [apiUrl, token, status, dateRange, sort, query],
  );

  useEffect(() => {
    void load("initial");
  }, [load]);

  const emptyMessage = useMemo(() => {
    if (query.trim() || dateRange !== "all") {
      return "No unavailable requests match these filters.";
    }
    if (status === "needs") {
      return "No unavailable plants need propagation right now.";
    }
    return "No propagation planning groups match this filter.";
  }, [query, dateRange, status]);

  async function toggleDone(groupKey: string) {
    const plant = payload?.categories
      .flatMap((category) => category.plants)
      .find((row) => row.groupKey === groupKey);
    if (!plant) return;
    setTogglingDoneKey(groupKey);
    setError(null);
    try {
      await apiPostJson(apiUrl, token, "/api/mobile/admin/propagation-planning", {
        intent: plant.state.done ? "undo-done" : "set-done",
        groupKey,
      });
      await load("refresh");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update done state.");
    } finally {
      setTogglingDoneKey(null);
    }
  }

  async function saveNotes(groupKey: string) {
    setSavingNotesKey(groupKey);
    setError(null);
    try {
      await apiPostJson(apiUrl, token, "/api/mobile/admin/propagation-planning", {
        intent: "save-notes",
        groupKey,
        propNotes: notesDrafts[groupKey] ?? "",
      });
      await load("refresh");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save prop notes.");
    } finally {
      setSavingNotesKey(null);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: THEME.mint }} edges={["top", "left", "right"]}>
      <ScrollView
        {...primaryScrollProps}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load("refresh")} />
        }
        contentContainerStyle={styles.page}
      >
        <Pressable onPress={() => navigation.goBack()} style={styles.backRow}>
          <Text style={styles.backLink}>← Settings</Text>
        </Pressable>
        <Text style={styles.title}>Propagation Planning</Text>
        <Text style={styles.muted}>
          Unavailable customer requests grouped by reason to help plan propagation and restocks.
        </Text>

        {payload ? (
          <View style={styles.summaryRow}>
            <Text style={styles.summaryText}>
              Needs Propagation: {payload.summary.needsPropagation}
            </Text>
            <Text style={styles.summaryText}>Done: {payload.summary.done}</Text>
            <Text style={styles.summaryText}>
              Unavailable requests in current date range: {payload.summary.unavailableInRange}
            </Text>
          </View>
        ) : null}

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search plants"
          placeholderTextColor={THEME.muted}
          style={styles.search}
          returnKeyType="search"
          onSubmitEditing={() => void load("initial")}
        />

        <Text style={styles.filterHeading}>Status</Text>
        <View style={styles.chipRow}>
          {STATUS_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              onPress={() => setStatus(option.value)}
              style={[styles.chip, status === option.value ? styles.chipActive : null]}
            >
              <Text
                style={[
                  styles.chipText,
                  status === option.value ? styles.chipTextActive : null,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.filterHeading}>Date range</Text>
        <View style={styles.chipRow}>
          {DATE_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              onPress={() => setDateRange(option.value)}
              style={[styles.chip, dateRange === option.value ? styles.chipActive : null]}
            >
              <Text
                style={[
                  styles.chipText,
                  dateRange === option.value ? styles.chipTextActive : null,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.filterHeading}>Sort within category</Text>
        <View style={styles.chipRow}>
          {SORT_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              onPress={() => setSort(option.value)}
              style={[styles.chip, sort === option.value ? styles.chipActive : null]}
            >
              <Text
                style={[styles.chipText, sort === option.value ? styles.chipTextActive : null]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading && !payload ? <ActivityIndicator color={THEME.darkGreen} /> : null}

        {!loading && payload && payload.categories.length === 0 ? (
          <Text style={styles.empty}>{emptyMessage}</Text>
        ) : null}

        {payload?.categories.map((category: PropagationPlanningCategory) => (
          <View key={category.id} style={styles.categoryBox}>
            <Text style={styles.categoryTitle}>{category.title}</Text>
            <Text style={styles.categoryAction}>{category.actionLabel}</Text>
            {category.plants.map((plant) => (
              <PlantRow
                key={`${category.id}:${plant.groupKey}`}
                plant={plant}
                categoryActionLabel={category.actionLabel}
                isOther={category.id === "other"}
                expanded={Boolean(expanded[`${category.id}:${plant.groupKey}`])}
                onToggleExpand={() =>
                  setExpanded((current) => ({
                    ...current,
                    [`${category.id}:${plant.groupKey}`]:
                      !current[`${category.id}:${plant.groupKey}`],
                  }))
                }
                onToggleDone={() => void toggleDone(plant.groupKey)}
                notesDraft={notesDrafts[plant.groupKey] ?? plant.state.propNotes}
                onNotesChange={(value) =>
                  setNotesDrafts((current) => ({ ...current, [plant.groupKey]: value }))
                }
                onSaveNotes={() => void saveNotes(plant.groupKey)}
                savingNotes={savingNotesKey === plant.groupKey}
                togglingDone={togglingDoneKey === plant.groupKey}
              />
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 32, gap: 12 },
  backRow: { alignSelf: "flex-start" },
  backLink: { color: THEME.darkGreen, fontWeight: "600" },
  title: { color: THEME.darkGreen, fontSize: 28, fontWeight: "700" },
  muted: { color: THEME.darkGreen, opacity: 0.85 },
  summaryRow: { gap: 4 },
  summaryText: { color: THEME.darkGreen, fontWeight: "600" },
  search: {
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: THEME.darkGreen,
    borderWidth: 1,
    borderColor: THEME.darkGreen,
  },
  filterHeading: { color: THEME.darkGreen, fontWeight: "700", marginTop: 4 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: THEME.darkGreen,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#fff",
  },
  chipActive: { backgroundColor: THEME.darkGreen },
  chipText: { color: THEME.darkGreen, fontWeight: "600", fontSize: 13 },
  chipTextActive: { color: THEME.yellow },
  categoryBox: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: THEME.darkGreen,
  },
  categoryTitle: {
    color: THEME.darkGreen,
    fontSize: 18,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  categoryAction: { color: THEME.muted, fontWeight: "700", marginBottom: 4 },
  plantRow: {
    borderTopWidth: 1,
    borderTopColor: THEME.mint,
    paddingTop: 10,
    gap: 4,
  },
  checkRow: { alignSelf: "flex-start" },
  checkLabel: { color: THEME.darkGreen, fontWeight: "700" },
  plantName: { color: THEME.darkGreen, fontSize: 17, fontWeight: "700" },
  plantNameLink: {
    color: THEME.darkGreen,
    fontSize: 17,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
  plantMeta: { color: THEME.darkGreen, opacity: 0.9 },
  newSinceDone: { color: "#b45309", fontWeight: "700" },
  expandedBlock: { gap: 8, marginTop: 4 },
  otherBlock: { gap: 10 },
  otherItem: { gap: 4 },
  otherHeading: { color: THEME.darkGreen, fontWeight: "700" },
  otherLabel: { color: THEME.darkGreen, fontWeight: "600" },
  otherBody: { color: THEME.darkGreen },
  notesLabel: { color: THEME.darkGreen, fontWeight: "700", marginTop: 4 },
  notesInput: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: THEME.darkGreen,
    borderRadius: 10,
    padding: 10,
    color: THEME.darkGreen,
    backgroundColor: "#fff",
    textAlignVertical: "top",
  },
  saveNotesButton: {
    alignSelf: "flex-start",
    backgroundColor: THEME.darkGreen,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  saveNotesDisabled: { opacity: 0.6 },
  saveNotesText: { color: THEME.yellow, fontWeight: "700" },
  expandHint: {
    color: THEME.darkGreen,
    fontWeight: "600",
    textDecorationLine: "underline",
    marginTop: 2,
  },
  empty: { color: THEME.darkGreen, fontStyle: "italic", marginTop: 8 },
  error: { color: "#9b1c1c" },
});
