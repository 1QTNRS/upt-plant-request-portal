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
import { formatPortalDateOnly, formatPortalDateTime } from "../admin-time";
import { iosFormScrollKeyboardProps } from "../ios-form-keyboard";
import { apiPath } from "../query";
import { useSession } from "../SessionContext";
import { THEME } from "../theme";
import type {
  PropagationPlanningGroup,
  PropagationPlanningPayload,
} from "../types";
import { ui } from "../ui";
import { useRootTabBarHiddenOnFocus } from "../use-root-tab-bar";
import type { SettingsStackParamList } from "./navigation-types";

type Props = NativeStackScreenProps<SettingsStackParamList, "PropagationPlanning">;

type StatusFilter = PropagationPlanningPayload["filters"]["status"];
type DateRange = PropagationPlanningPayload["filters"]["dateRange"];
type Sort = PropagationPlanningPayload["filters"]["sort"];

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "needs", label: "Needs Propagation" },
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
  { value: "most_recent", label: "Most Recent" },
  { value: "az", label: "A–Z" },
];

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active ? styles.chipActive : null]}
    >
      <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>{label}</Text>
    </Pressable>
  );
}

function GroupCard({
  group,
  expanded,
  onToggleExpanded,
  onToggleDone,
  notesDraft,
  onNotesChange,
  onSaveNotes,
  savingNotes,
  togglingDone,
}: {
  group: PropagationPlanningGroup;
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggleDone: () => void;
  notesDraft: string;
  onNotesChange: (value: string) => void;
  onSaveNotes: () => void;
  savingNotes: boolean;
  togglingDone: boolean;
}) {
  const doneLabel =
    group.state.done && group.state.completedAtIso
      ? `✓ Done ${formatPortalDateOnly(group.state.completedAtIso)}`
      : "☐ Done";

  return (
    <View style={styles.card}>
      <Pressable onPress={onToggleExpanded}>
        <Text style={styles.plantName}>{group.displayName}</Text>
        <Text style={styles.summaryLine}>
          {group.occurrenceCount} requests · {group.uniqueCustomerCount} customers
        </Text>
        <Text style={styles.muted}>
          Last requested {formatPortalDateOnly(group.lastRequestedAtIso)}
        </Text>
        {group.newSinceDone > 0 ? (
          <Text style={styles.newSinceDone}>
            {group.newSinceDone} new request{group.newSinceDone === 1 ? "" : "s"} since done
          </Text>
        ) : null}
        {group.reasonCounts.length > 0 ? (
          <View style={styles.reasonBlock}>
            {group.reasonCounts.slice(0, 4).map((row) => (
              <Text key={row.reason} style={styles.reasonLine}>
                {row.reason} × {row.count}
              </Text>
            ))}
          </View>
        ) : null}
      </Pressable>

      <Pressable
        onPress={onToggleDone}
        disabled={togglingDone}
        style={styles.doneButton}
      >
        <Text style={styles.doneButtonText}>{doneLabel}</Text>
      </Pressable>

      <View style={styles.notesBlock}>
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
          <Text style={styles.saveNotesText}>{savingNotes ? "Saving…" : "Save Prop Notes"}</Text>
        </Pressable>
      </View>

      {expanded ? (
        <View style={styles.historyBlock}>
          {group.occurrences.map((row) => (
            <View key={row.offerItemId} style={styles.historyItem}>
              <Text style={styles.historyHeading}>
                {formatPortalDateOnly(row.submittedAtIso)} · {row.requestNumber}
              </Text>
              <Text style={styles.historyLabel}>Requested:</Text>
              <Text style={styles.historyBody}>{row.plantName}</Text>
              <Text style={styles.historyLabel}>Answer:</Text>
              <Text style={styles.historyBody}>
                {row.unavailableReason || "not in our current inventory"}
              </Text>
              {row.customerFacingNotes.trim() ? (
                <>
                  <Text style={styles.historyLabel}>Customer-facing response:</Text>
                  <Text style={styles.historyBody}>{row.customerFacingNotes}</Text>
                </>
              ) : null}
              {row.customerRequestNotes?.trim() ? (
                <>
                  <Text style={styles.historyLabel}>Customer request notes:</Text>
                  <Text style={styles.historyBody}>{row.customerRequestNotes}</Text>
                </>
              ) : null}
              <Text style={styles.historyMeta}>
                Offer sent {formatPortalDateTime(row.offerSentAtIso)}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Pressable onPress={onToggleExpanded}>
          <Text style={styles.expandHint}>Show request history</Text>
        </Pressable>
      )}
    </View>
  );
}

export function PropagationPlanningScreen({ navigation }: Props) {
  useRootTabBarHiddenOnFocus();
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
          for (const group of next.groups) {
            if (merged[group.groupKey] === undefined) {
              merged[group.groupKey] = group.state.propNotes;
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

  async function toggleDone(group: PropagationPlanningGroup) {
    setTogglingDoneKey(group.groupKey);
    setError(null);
    try {
      await apiPostJson(apiUrl, token, "/api/mobile/admin/propagation-planning", {
        intent: group.state.done ? "undo-done" : "set-done",
        groupKey: group.groupKey,
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
        {...iosFormScrollKeyboardProps()}
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
          Unavailable customer requests grouped by plant to help plan propagation and restocks.
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
            <FilterChip
              key={option.value}
              label={option.label}
              active={status === option.value}
              onPress={() => setStatus(option.value)}
            />
          ))}
        </View>

        <Text style={styles.filterHeading}>Date range</Text>
        <View style={styles.chipRow}>
          {DATE_OPTIONS.map((option) => (
            <FilterChip
              key={option.value}
              label={option.label}
              active={dateRange === option.value}
              onPress={() => setDateRange(option.value)}
            />
          ))}
        </View>

        <Text style={styles.filterHeading}>Sort</Text>
        <View style={styles.chipRow}>
          {SORT_OPTIONS.map((option) => (
            <FilterChip
              key={option.value}
              label={option.label}
              active={sort === option.value}
              onPress={() => setSort(option.value)}
            />
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading && !payload ? <ActivityIndicator color={THEME.darkGreen} /> : null}

        {!loading && payload && payload.groups.length === 0 ? (
          <Text style={styles.empty}>{emptyMessage}</Text>
        ) : null}

        {payload?.groups.map((group) => (
          <GroupCard
            key={group.groupKey}
            group={group}
            expanded={Boolean(expanded[group.groupKey])}
            onToggleExpanded={() =>
              setExpanded((current) => ({
                ...current,
                [group.groupKey]: !current[group.groupKey],
              }))
            }
            onToggleDone={() => void toggleDone(group)}
            notesDraft={notesDrafts[group.groupKey] ?? group.state.propNotes}
            onNotesChange={(value) =>
              setNotesDrafts((current) => ({ ...current, [group.groupKey]: value }))
            }
            onSaveNotes={() => void saveNotes(group.groupKey)}
            savingNotes={savingNotesKey === group.groupKey}
            togglingDone={togglingDoneKey === group.groupKey}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
  backRow: {
    alignSelf: "flex-start",
  },
  backLink: {
    color: THEME.darkGreen,
    fontWeight: "600",
  },
  title: {
    color: THEME.darkGreen,
    fontSize: 28,
    fontWeight: "700",
  },
  muted: {
    color: THEME.darkGreen,
    opacity: 0.85,
  },
  summaryRow: {
    gap: 4,
  },
  summaryText: {
    color: THEME.darkGreen,
    fontWeight: "600",
  },
  search: {
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: THEME.darkGreen,
    borderWidth: 1,
    borderColor: THEME.darkGreen,
  },
  filterHeading: {
    color: THEME.darkGreen,
    fontWeight: "700",
    marginTop: 4,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: THEME.darkGreen,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#fff",
  },
  chipActive: {
    backgroundColor: THEME.darkGreen,
  },
  chipText: {
    color: THEME.darkGreen,
    fontWeight: "600",
    fontSize: 13,
  },
  chipTextActive: {
    color: THEME.yellow,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  plantName: {
    color: THEME.darkGreen,
    fontSize: 20,
    fontWeight: "700",
  },
  summaryLine: {
    color: THEME.darkGreen,
    fontWeight: "600",
  },
  newSinceDone: {
    color: "#b45309",
    fontWeight: "700",
    marginTop: 4,
  },
  reasonBlock: {
    marginTop: 6,
    gap: 2,
  },
  reasonLine: {
    color: THEME.darkGreen,
    opacity: 0.9,
    fontSize: 13,
  },
  doneButton: {
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: THEME.mint,
  },
  doneButtonText: {
    color: THEME.darkGreen,
    fontWeight: "700",
  },
  notesBlock: {
    gap: 6,
  },
  notesLabel: {
    color: THEME.darkGreen,
    fontWeight: "700",
  },
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
  saveNotesDisabled: {
    opacity: 0.6,
  },
  saveNotesText: {
    color: THEME.yellow,
    fontWeight: "700",
  },
  historyBlock: {
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: THEME.mint,
    paddingTop: 10,
  },
  historyItem: {
    gap: 4,
  },
  historyHeading: {
    color: THEME.darkGreen,
    fontWeight: "700",
  },
  historyLabel: {
    color: THEME.darkGreen,
    fontWeight: "600",
    marginTop: 2,
  },
  historyBody: {
    color: THEME.darkGreen,
  },
  historyMeta: {
    color: THEME.darkGreen,
    opacity: 0.75,
    fontSize: 12,
    marginTop: 4,
  },
  expandHint: {
    color: THEME.darkGreen,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  empty: {
    color: THEME.darkGreen,
    fontStyle: "italic",
    marginTop: 8,
  },
  error: {
    color: "#9b1c1c",
  },
});
