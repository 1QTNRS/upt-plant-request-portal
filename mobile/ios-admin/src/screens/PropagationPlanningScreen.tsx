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

const BORDER = "rgba(0, 41, 16, 0.22)";

function plantActionDisplayLabel(apiActionLabel: string): string {
  if (apiActionLabel === "Prop") return "Propped";
  if (apiActionLabel === "Obtained") return "Obtained";
  if (apiActionLabel === "Check Props") return "Checked Props";
  return apiActionLabel;
}

function plantActionButtonLabel(apiActionLabel: string, checked: boolean): string {
  const label = plantActionDisplayLabel(apiActionLabel);
  return checked ? `☑ ${label}` : `☐ ${label}`;
}

function disclosureTitle(isOther: boolean, expanded: boolean): string {
  if (expanded) return "Hide details";
  return isOther ? "Responses & Prop Notes" : "Prop Notes & History";
}

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
  const actionButtonLabel = actionLabel
    ? plantActionButtonLabel(actionLabel, checked)
    : "";

  return (
    <View style={styles.plantCard}>
      <Text style={styles.plantName}>{plant.displayName}</Text>
      <Text style={styles.plantMeta}>
        {plant.uniqueCustomerCount} {plant.uniqueCustomerCount === 1 ? "person" : "people"}{" "}
        requested
      </Text>
      <Text style={styles.plantMetaSub}>
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
            style={[styles.primaryAction, checked ? styles.primaryActionDone : null]}
          >
            <Text
              style={[styles.primaryActionText, checked ? styles.primaryActionTextDone : null]}
            >
              {actionButtonLabel}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onCloseOrReopen}
          disabled={closing}
          style={styles.secondaryAction}
          accessibilityRole="button"
          accessibilityLabel={plant.state.closed ? "Reopen plant" : "Close plant"}
        >
          <Text style={styles.secondaryActionText}>
            {plant.state.closed ? "Reopen" : "Close"}
          </Text>
        </Pressable>
      </View>

      <Pressable
        onPress={expanded ? onCollapseExpand : onToggleExpand}
        style={styles.disclosureRow}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <Text style={styles.disclosureLabel}>{disclosureTitle(isOther, expanded)}</Text>
        <Text style={styles.disclosureChevron}>{expanded ? "▴" : "▸"}</Text>
      </Pressable>

      {expanded ? (
        <View style={styles.expandedBlock}>
          {isOther ? (
            <View style={styles.detailBlock}>
              {(plant.otherOccurrences ?? []).map((row) => (
                <View key={row.offerItemId} style={styles.detailItem}>
                  <Text style={styles.detailHeading}>
                    {formatPortalDateOnly(row.submittedAtIso)} · {row.requestNumber}
                  </Text>
                  <Text style={styles.detailLabel}>Customer-facing response</Text>
                  <Text style={styles.detailBody}>
                    {row.customerFacingNotes || "No customer-facing notes."}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.detailBlock}>
              {(plant.historyOccurrences ?? []).map((row) => (
                <View key={row.offerItemId} style={styles.detailItem}>
                  <Text style={styles.detailHeading}>
                    {formatPortalDateOnly(row.submittedAtIso)} · {row.requestNumber}
                  </Text>
                  <Text style={styles.detailLabel}>Unavailable reason</Text>
                  <Text style={styles.detailBody}>{row.unavailableReason}</Text>
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
          <CompactSelect
            compact
            label="Status"
            value={status}
            options={STATUS_OPTIONS}
            onChange={setStatus}
          />
          <CompactSelect
            compact
            label="Date range"
            value={dateRange}
            options={DATE_OPTIONS}
            onChange={setDateRange}
          />
        </View>
        <CompactSelect compact label="Sort" value={sort} options={SORT_OPTIONS} onChange={setSort} />

        <View style={styles.segmentTrack}>
          {PROPAGATION_TAB_ORDER.map((tabId) => {
            const active = reasonTab === tabId;
            return (
              <Pressable
                key={tabId}
                onPress={() => setReasonTab(tabId)}
                style={[styles.segment, active ? styles.segmentActive : null]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[styles.segmentText, active ? styles.segmentTextActive : null]}
                  numberOfLines={1}
                >
                  {TAB_LABELS[tabId]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading && !payload ? <ActivityIndicator color={THEME.darkGreen} /> : null}

        {!loading && payload && activeTabPlants.length === 0 ? (
          <Text style={styles.empty}>{emptyMessage}</Text>
        ) : null}

        {activeTabPlants.length > 0 ? (
          <View style={styles.plantList}>
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
          <Text style={styles.scrollTopFabText}>↑</Text>
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 72, gap: 8 },
  backRow: { alignSelf: "flex-start" },
  backLink: { color: THEME.darkGreen, fontWeight: "600", fontSize: 15 },
  title: { color: THEME.darkGreen, fontSize: 26, fontWeight: "700" },
  muted: { color: THEME.darkGreen, opacity: 0.75, fontSize: 14, lineHeight: 20 },
  search: {
    backgroundColor: "#fff",
    borderRadius: 8,
    paddingHorizontal: 11,
    paddingVertical: 9,
    color: THEME.darkGreen,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    fontSize: 15,
  },
  filterRow: { flexDirection: "row", gap: 8 },
  segmentTrack: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    padding: 3,
    gap: 2,
  },
  segment: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 7,
    paddingHorizontal: 4,
    borderRadius: 6,
    minHeight: 34,
  },
  segmentActive: { backgroundColor: THEME.darkGreen },
  segmentText: {
    color: THEME.darkGreen,
    fontWeight: "600",
    fontSize: 12,
    opacity: 0.85,
  },
  segmentTextActive: { color: THEME.yellow, opacity: 1, fontWeight: "700" },
  plantList: { gap: 10, marginTop: 2 },
  plantCard: {
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    gap: 3,
  },
  plantName: { color: THEME.darkGreen, fontSize: 17, fontWeight: "700", marginBottom: 2 },
  plantMeta: { color: THEME.darkGreen, fontSize: 14, fontWeight: "500" },
  plantMetaSub: { color: THEME.darkGreen, fontSize: 13, opacity: 0.65 },
  newSinceDone: { color: "#b45309", fontWeight: "600", fontSize: 13, marginTop: 2 },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
  },
  primaryAction: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: THEME.darkGreen,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "#fff",
  },
  primaryActionDone: {
    backgroundColor: THEME.darkGreen,
    borderColor: THEME.darkGreen,
  },
  primaryActionText: {
    color: THEME.darkGreen,
    fontWeight: "600",
    fontSize: 14,
  },
  primaryActionTextDone: { color: THEME.yellow },
  secondaryAction: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginLeft: "auto",
  },
  secondaryActionText: {
    color: THEME.darkGreen,
    fontWeight: "500",
    fontSize: 14,
    opacity: 0.55,
    textDecorationLine: "underline",
  },
  disclosureRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(0, 41, 16, 0.12)",
  },
  disclosureLabel: { color: THEME.darkGreen, fontWeight: "600", fontSize: 14 },
  disclosureChevron: { color: THEME.darkGreen, fontSize: 13, opacity: 0.5, marginLeft: 8 },
  expandedBlock: {
    gap: 8,
    marginTop: 8,
    paddingTop: 8,
    paddingHorizontal: 2,
    backgroundColor: "rgba(214, 236, 226, 0.35)",
    borderRadius: 8,
    paddingBottom: 4,
  },
  detailBlock: { gap: 10 },
  detailItem: { gap: 2 },
  detailHeading: { color: THEME.darkGreen, fontWeight: "600", fontSize: 13 },
  detailLabel: { color: THEME.darkGreen, fontWeight: "500", fontSize: 12, opacity: 0.7 },
  detailBody: { color: THEME.darkGreen, fontSize: 14, lineHeight: 19 },
  notesLabel: { color: THEME.darkGreen, fontWeight: "600", fontSize: 13, marginTop: 4 },
  notesInput: {
    minHeight: 68,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    borderRadius: 8,
    padding: 9,
    color: THEME.darkGreen,
    backgroundColor: "#fff",
    textAlignVertical: "top",
    fontSize: 14,
  },
  saveNotesButton: {
    alignSelf: "flex-start",
    backgroundColor: THEME.darkGreen,
    borderRadius: 7,
    paddingHorizontal: 11,
    paddingVertical: 7,
    marginBottom: 4,
  },
  saveNotesDisabled: { opacity: 0.6 },
  saveNotesText: { color: THEME.yellow, fontWeight: "600", fontSize: 13 },
  empty: { color: THEME.darkGreen, fontStyle: "italic", marginTop: 6, opacity: 0.8 },
  error: { color: "#9b1c1c" },
  scrollTopFab: {
    position: "absolute",
    right: 14,
    bottom: 20,
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    borderRadius: 999,
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    shadowColor: "#002910",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 2,
  },
  scrollTopFabText: { color: THEME.darkGreen, fontWeight: "700", fontSize: 16 },
});
