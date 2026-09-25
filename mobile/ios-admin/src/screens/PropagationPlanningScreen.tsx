import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  NativeScrollEvent,
  NativeSyntheticEvent,
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
import { CompactSelect } from "../components/CompactSelect";
import { apiPath } from "../query";
import { useSession } from "../SessionContext";
import { THEME } from "../theme";
import type {
  PropagationCategoryPlantRow,
  PropagationPlanningPayload,
  PropagationTabId,
} from "../types";
import {
  appendNotesDraft,
  mergeNotesDraftsFromTabs,
  normalizePropagationPlanningPayload,
  plantsForTab,
  PROPAGATION_TAB_ORDER,
} from "../propagation-planning-screen";
import { scrollToTopButtonVisible } from "../scroll-to-top-button";
import { usePrimaryScrollProps } from "../use-primary-scroll";
import { useRootTabBarHiddenOnFocus } from "../use-root-tab-bar";
import type { SettingsStackParamList } from "./navigation-types";

type Props = NativeStackScreenProps<SettingsStackParamList, "PropagationPlanning">;

type StatusFilter = PropagationPlanningPayload["filters"]["status"];
type DateRange = PropagationPlanningPayload["filters"]["dateRange"];
type Sort = PropagationPlanningPayload["filters"]["sort"];

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "active", label: "Active" },
  { value: "done", label: "Done" },
  { value: "closed", label: "Closed" },
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

const TAB_LABELS: Record<PropagationTabId, string> = {
  prop: "Prop",
  inventory: "Inventory",
  check_props: "Check Props",
  other: "Other",
};

function PlantRow({
  plant,
  actionLabel,
  isOther,
  expanded,
  onToggleExpand,
  onCollapseExpand,
  onToggleDone,
  onCloseOrReopen,
  closing,
  notesDraft,
  onNotesChange,
  onSaveNotes,
  savingNotes,
  togglingDone,
}: {
  plant: PropagationCategoryPlantRow;
  actionLabel: string | null;
  isOther: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onCollapseExpand: () => void;
  onToggleDone: () => void;
  onCloseOrReopen: () => void;
  closing: boolean;
  notesDraft: string;
  onNotesChange: (value: string) => void;
  onSaveNotes: () => void;
  savingNotes: boolean;
  togglingDone: boolean;
}) {
  const checked = plant.state.done;
  const showAction = Boolean(actionLabel) && !plant.state.closed;
  const checkText = actionLabel
    ? checked
      ? `☑ ${actionLabel}${
          plant.state.completedAtIso
            ? ` · ${formatPortalDateOnly(plant.state.completedAtIso)}`
            : ""
        }`
      : `☐ ${actionLabel.toUpperCase()}`
    : "";

  return (
    <View style={styles.plantRow}>
      {isOther ? (
        <Pressable onPress={onToggleExpand}>
          <Text style={styles.plantNameLink}>{plant.displayName}</Text>
        </Pressable>
      ) : (
        <Pressable onPress={onToggleExpand}>
          <Text style={styles.plantName}>{plant.displayName}</Text>
        </Pressable>
      )}

      <Text style={styles.plantMeta}>
        {plant.uniqueCustomerCount} {plant.uniqueCustomerCount === 1 ? "person" : "people"}{" "}
        requested
      </Text>
      <Text style={styles.plantMeta}>
        Oldest request: {formatPortalDateOnly(plant.oldestRequestAtIso)}
      </Text>
      {plant.newSinceDone > 0 && !plant.state.closed ? (
        <Text style={styles.newSinceDone}>
          {plant.newSinceDone} new request{plant.newSinceDone === 1 ? "" : "s"} since done
        </Text>
      ) : null}
      {plant.newSinceClosed > 0 && plant.state.closed ? (
        <Text style={styles.newSinceDone}>
          {plant.newSinceClosed} new request{plant.newSinceClosed === 1 ? "" : "s"} since closed
        </Text>
      ) : null}

      <View style={styles.actionRow}>
        {showAction ? (
          <Pressable
            onPress={onToggleDone}
            disabled={togglingDone}
            style={[styles.actionCheck, checked ? styles.actionCheckDone : null]}
          >
            <Text style={[styles.actionCheckText, checked ? styles.actionCheckTextDone : null]}>
              {checkText}
            </Text>
          </Pressable>
        ) : (
          <View style={styles.actionSpacer} />
        )}
        <Pressable
          onPress={onCloseOrReopen}
          disabled={closing}
          style={styles.closeButton}
          accessibilityRole="button"
          accessibilityLabel={plant.state.closed ? "Reopen plant" : "Close plant"}
        >
          <Text style={styles.closeButtonText}>
            {plant.state.closed ? "Reopen" : "✕ Close"}
          </Text>
        </Pressable>
      </View>

      {!expanded && !isOther ? (
        <Pressable onPress={onToggleExpand}>
          <Text style={styles.expandHint}>Prop Notes & history</Text>
        </Pressable>
      ) : null}
      {!expanded && isOther ? (
        <Pressable onPress={onToggleExpand}>
          <Text style={styles.expandHint}>Show responses & Prop Notes</Text>
        </Pressable>
      ) : null}

      {expanded ? (
        <View style={styles.expandedBlock}>
          <Pressable
            onPress={onCollapseExpand}
            style={styles.expandedDismiss}
            accessibilityRole="button"
            accessibilityLabel="Collapse details"
          >
            <Text style={styles.expandedDismissText}>✕</Text>
          </Pressable>
          {isOther ? (
            <View style={styles.otherBlock}>
              {(plant.otherOccurrences ?? []).map((row) => (
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
          ) : (
            <View style={styles.historyBlock}>
              {(plant.historyOccurrences ?? []).map((row) => (
                <View key={row.offerItemId} style={styles.otherItem}>
                  <Text style={styles.otherHeading}>
                    {formatPortalDateOnly(row.submittedAtIso)} · {row.requestNumber}
                  </Text>
                  <Text style={styles.otherLabel}>Unavailable reason:</Text>
                  <Text style={styles.otherBody}>{row.unavailableReason}</Text>
                </View>
              ))}
            </View>
          )}
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
      ) : null}
    </View>
  );
}

export function PropagationPlanningScreen({ navigation }: Props) {
  useRootTabBarHiddenOnFocus();
  const primaryScrollProps = usePrimaryScrollProps();
  const scrollRef = useRef<ScrollView>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const { apiUrl, token } = useSession();
  const [payload, setPayload] = useState<PropagationPlanningPayload | null>(null);
  const [status, setStatus] = useState<StatusFilter>("active");
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [sort, setSort] = useState<Sort>("most_requested");
  const [query, setQuery] = useState("");
  const [reasonTab, setReasonTab] = useState<PropagationTabId>("prop");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [notesDrafts, setNotesDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingNotesKey, setSavingNotesKey] = useState<string | null>(null);
  const [togglingDoneKey, setTogglingDoneKey] = useState<string | null>(null);
  const [closingKey, setClosingKey] = useState<string | null>(null);

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
        const raw = await apiGet<PropagationPlanningPayload>(apiUrl, token, path);
        const { payload: next, warning } = normalizePropagationPlanningPayload(raw);
        if (warning.missingTabs && __DEV__) {
          console.error("[PropagationPlanning]", warning.message);
        }
        setPayload(next);
        if (warning.message && warning.missingTabs && !next.tabs.length) {
          setError(warning.message);
        }
        setNotesDrafts((current) => mergeNotesDraftsFromTabs(current, next.tabs));
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

  const activeTabPlants = useMemo(
    () => plantsForTab(payload?.tabs ?? [], reasonTab),
    [payload?.tabs, reasonTab],
  );

  const activeTabMeta = useMemo(
    () => payload?.tabs.find((tab) => tab.id === reasonTab),
    [payload?.tabs, reasonTab],
  );

  const emptyMessage = useMemo(() => {
    if (query.trim() || dateRange !== "all") {
      return "No unavailable requests match these filters.";
    }
    if (status === "active") {
      return "No active plants in this tab.";
    }
    if (status === "closed") {
      return "No closed plants in this tab.";
    }
    return "No propagation planning groups match this filter.";
  }, [query, dateRange, status]);

  async function toggleDone(groupKey: string) {
    const plant = payload?.tabs
      .flatMap((tab) => tab.plants)
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

  async function closeOrReopen(groupKey: string, closed: boolean) {
    setClosingKey(groupKey);
    setError(null);
    try {
      await apiPostJson(apiUrl, token, "/api/mobile/admin/propagation-planning", {
        intent: closed ? "reopen" : "close",
        groupKey,
      });
      await load("refresh");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update closed state.");
    } finally {
      setClosingKey(null);
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

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    setShowScrollTop(scrollToTopButtonVisible(event.nativeEvent.contentOffset.y));
  }

  function scrollToTop() {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: THEME.mint }} edges={["top", "left", "right"]}>
      <ScrollView
        ref={scrollRef}
        {...primaryScrollProps}
        onScroll={onScroll}
        scrollEventThrottle={16}
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
            <Text style={styles.summaryText}>Active: {payload.summary.active}</Text>
            <Text style={styles.summaryText}>Done: {payload.summary.done}</Text>
            <Text style={styles.summaryText}>Closed: {payload.summary.closed}</Text>
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

        <View style={styles.filterRow}>
          <CompactSelect label="Status" value={status} options={STATUS_OPTIONS} onChange={setStatus} />
          <CompactSelect
            label="Date range"
            value={dateRange}
            options={DATE_OPTIONS}
            onChange={setDateRange}
          />
        </View>
        <CompactSelect label="Sort" value={sort} options={SORT_OPTIONS} onChange={setSort} />

        <ScrollView
          horizontal
          scrollsToTop={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabRow}
        >
          {PROPAGATION_TAB_ORDER.map((tabId) => (
            <Pressable
              key={tabId}
              onPress={() => setReasonTab(tabId)}
              style={[styles.tabChip, reasonTab === tabId ? styles.tabChipActive : null]}
            >
              <Text
                style={[styles.tabChipText, reasonTab === tabId ? styles.tabChipTextActive : null]}
              >
                {TAB_LABELS[tabId]}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading && !payload ? <ActivityIndicator color={THEME.darkGreen} /> : null}

        {!loading && payload && activeTabPlants.length === 0 ? (
          <Text style={styles.empty}>{emptyMessage}</Text>
        ) : null}

        {activeTabPlants.length > 0 ? (
          <View style={styles.listBox}>
            {activeTabMeta?.actionLabel ? (
              <Text style={styles.listActionHint}>Action: {activeTabMeta.actionLabel}</Text>
            ) : null}
            {activeTabPlants.map((plant) => (
              <PlantRow
                key={`${reasonTab}:${plant.groupKey}`}
                plant={plant}
                actionLabel={activeTabMeta?.actionLabel ?? null}
                isOther={reasonTab === "other"}
                expanded={Boolean(expanded[`${reasonTab}:${plant.groupKey}`])}
                onToggleExpand={() =>
                  setExpanded((current) => ({
                    ...current,
                    [`${reasonTab}:${plant.groupKey}`]:
                      !current[`${reasonTab}:${plant.groupKey}`],
                  }))
                }
                onCollapseExpand={() =>
                  setExpanded((current) => ({
                    ...current,
                    [`${reasonTab}:${plant.groupKey}`]: false,
                  }))
                }
                onToggleDone={() => void toggleDone(plant.groupKey)}
                onCloseOrReopen={() =>
                  void closeOrReopen(plant.groupKey, plant.state.closed)
                }
                closing={closingKey === plant.groupKey}
                notesDraft={notesDrafts[plant.groupKey] ?? plant.state.propNotes}
                onNotesChange={(value) =>
                  setNotesDrafts((current) => appendNotesDraft(current, plant.groupKey, value))
                }
                onSaveNotes={() => void saveNotes(plant.groupKey)}
                savingNotes={savingNotesKey === plant.groupKey}
                togglingDone={togglingDoneKey === plant.groupKey}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>

      {showScrollTop ? (
        <Pressable
          onPress={scrollToTop}
          style={styles.scrollTopFab}
          accessibilityRole="button"
          accessibilityLabel="Scroll to top"
        >
          <Text style={styles.scrollTopFabText}>↑ Top</Text>
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 88, gap: 10 },
  backRow: { alignSelf: "flex-start" },
  backLink: { color: THEME.darkGreen, fontWeight: "600" },
  title: { color: THEME.darkGreen, fontSize: 28, fontWeight: "700" },
  muted: { color: THEME.darkGreen, opacity: 0.85 },
  summaryRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
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
  filterRow: { flexDirection: "row", gap: 10 },
  tabRow: { flexDirection: "row", gap: 8, paddingVertical: 4 },
  tabChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: THEME.darkGreen,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "#fff",
  },
  tabChipActive: { backgroundColor: THEME.darkGreen },
  tabChipText: { color: THEME.darkGreen, fontWeight: "700", fontSize: 14 },
  tabChipTextActive: { color: THEME.yellow },
  listBox: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    gap: 4,
    borderWidth: 1,
    borderColor: THEME.darkGreen,
  },
  listActionHint: { color: THEME.muted, fontWeight: "600", marginBottom: 4 },
  plantRow: {
    borderTopWidth: 1,
    borderTopColor: THEME.mint,
    paddingTop: 12,
    gap: 4,
  },
  plantName: { color: THEME.darkGreen, fontSize: 18, fontWeight: "700" },
  plantNameLink: {
    color: THEME.darkGreen,
    fontSize: 18,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
  plantMeta: { color: THEME.darkGreen, opacity: 0.9 },
  newSinceDone: { color: "#b45309", fontWeight: "700" },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 6,
  },
  actionCheck: {
    flex: 1,
    borderWidth: 2,
    borderColor: THEME.darkGreen,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: "#fff",
  },
  actionCheckDone: { backgroundColor: THEME.darkGreen },
  actionCheckText: {
    color: THEME.darkGreen,
    fontWeight: "800",
    fontSize: 16,
    letterSpacing: 0.5,
  },
  actionCheckTextDone: { color: THEME.yellow },
  actionSpacer: { flex: 1 },
  closeButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME.darkGreen,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: "#fff",
  },
  closeButtonText: { color: THEME.darkGreen, fontWeight: "700" },
  expandedBlock: { gap: 8, marginTop: 8, position: "relative" },
  expandedDismiss: {
    position: "absolute",
    top: 0,
    right: 0,
    zIndex: 1,
    padding: 6,
  },
  expandedDismissText: { color: THEME.darkGreen, fontWeight: "800", fontSize: 18 },
  historyBlock: { gap: 10, paddingRight: 28 },
  otherBlock: { gap: 10, paddingRight: 28 },
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
  scrollTopFab: {
    position: "absolute",
    right: 16,
    bottom: 24,
    backgroundColor: THEME.darkGreen,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 2,
    borderColor: THEME.yellow,
  },
  scrollTopFabText: { color: THEME.yellow, fontWeight: "800" },
});
