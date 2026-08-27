import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";

import { apiGet } from "../api";
import { StatusFilterBar } from "../components/StatusFilterBar";
import { apiPath } from "../query";
import {
  DEFAULT_STATUS_FILTER,
  filterRequestRows,
  statusFilterCounts,
  type StatusFilterValue,
} from "../request-filters";
import { useSession } from "../SessionContext";
import { StatusPills } from "../StatusPills";
import { THEME } from "../theme";
import type { RequestRow, Stats } from "../types";
import { ui } from "../ui";
import type { RequestsStackParamList } from "./navigation-types";

type Props = NativeStackScreenProps<RequestsStackParamList, "RequestList">;

export function RequestListScreen({ navigation }: Props) {
  const { apiUrl, token, signOut } = useSession();
  const [stats, setStats] = useState<Stats | null>(null);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>(DEFAULT_STATUS_FILTER);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadList = useCallback(
    async (nextQuery: string, mode: "initial" | "refresh" = "initial") => {
      setError(null);
      if (mode === "refresh") setRefreshing(true);
      else setLoading(true);
      try {
        const path = apiPath("/api/mobile/admin/requests", {
          q: nextQuery.trim() || undefined,
        });
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
        setRefreshing(false);
      }
    },
    [apiUrl, token],
  );

  useEffect(() => {
    void loadList("", "initial");
  }, [loadList]);

  const visible = filterRequestRows(requests, statusFilter);
  const counts = statusFilterCounts(requests, stats);

  return (
    <SafeAreaView style={ui.screen} edges={["top", "left", "right"]}>
      <View style={ui.header}>
        <Text style={ui.title}>Requests</Text>
        <Pressable onPress={() => void signOut()}>
          <Text style={ui.link}>Sign out</Text>
        </Pressable>
      </View>
      <StatusFilterBar
        selected={statusFilter}
        counts={counts}
        onSelect={setStatusFilter}
      />
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search name, email, request #, plant"
        placeholderTextColor={THEME.muted}
        style={ui.input}
        onSubmitEditing={() => void loadList(query, "initial")}
        returnKeyType="search"
      />
      {error ? <Text style={ui.error}>{error}</Text> : null}
      <ScrollView
        style={ui.flexPage}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadList(query, "refresh")}
            tintColor={THEME.darkGreen}
            colors={[THEME.darkGreen]}
            progressBackgroundColor={THEME.requestPage}
          />
        }
      >
        {loading && requests.length === 0 ? (
          <ActivityIndicator color={THEME.darkGreen} />
        ) : null}
        {visible.map((row) => (
          <Pressable
            key={row.id}
            style={ui.card}
            onPress={() => navigation.navigate("RequestDetail", { requestId: row.id })}
          >
            <Text style={ui.cardTitle}>{row.requestNumber}</Text>
            <Text style={ui.cardMeta}>{row.customer}</Text>
            <StatusPills status={row.status} hasExistingOrder={row.hasExistingOrder} />
            <Text style={ui.muted}>{row.plantsRequested || "No plants listed"}</Text>
          </Pressable>
        ))}
        {!loading && visible.length === 0 ? (
          <Text style={ui.muted}>No requests match this filter.</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
