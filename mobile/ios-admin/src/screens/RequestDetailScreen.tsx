import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";

import { apiGet, apiPost } from "../api";
import { ItemEditor } from "../components/ItemEditor";
import { useSession } from "../SessionContext";
import { StatusPills } from "../StatusPills";
import { THEME } from "../theme";
import type { ActionResult, RequestDetail } from "../types";
import { ui } from "../ui";
import type { RequestsStackParamList } from "./navigation-types";

type Props = NativeStackScreenProps<RequestsStackParamList, "RequestDetail">;

export function RequestDetailScreen({ navigation, route }: Props) {
  const { apiUrl, token } = useSession();
  const { requestId } = route.params;
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expirationDays, setExpirationDays] = useState(3);
  const [shippingFeeOverride, setShippingFeeOverride] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [confirmOverride, setConfirmOverride] = useState(false);

  useEffect(() => {
    void (async () => {
      setError(null);
      setLoading(true);
      setConfirmOverride(false);
      setShippingFeeOverride("");
      try {
        setDetail(
          await apiGet<RequestDetail>(
            apiUrl,
            token,
            `/api/mobile/admin/requests/${requestId}`,
          ),
        );
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not load that request.");
      } finally {
        setLoading(false);
      }
    })();
  }, [apiUrl, requestId, token]);

  function applyResult(result: ActionResult) {
    if (!result.ok) {
      setError(result.error || "That action failed.");
      if (result.pendingAdminOverrideClose) setConfirmOverride(true);
      return;
    }
    if (result.request) setDetail(result.request);
  }

  async function runAction(body: Record<string, unknown>) {
    if (!detail) return;
    setError(null);
    setLoading(true);
    try {
      applyResult(
        await apiPost(apiUrl, token, `/api/mobile/admin/requests/${detail.id}`, body),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save.");
    } finally {
      setLoading(false);
    }
  }

  if (!detail) {
    return (
      <SafeAreaView style={ui.screen} edges={["top", "left", "right", "bottom"]}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={ui.link}>← Requests</Text>
        </Pressable>
        {loading ? <ActivityIndicator color={THEME.darkGreen} /> : null}
        {error ? <Text style={ui.error}>{error}</Text> : null}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={ui.flex} edges={["top", "left", "right", "bottom"]}>
    <KeyboardAvoidingView
      style={ui.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={ui.page}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
      >
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={ui.link}>← Requests</Text>
        </Pressable>
        <Text style={ui.title}>{detail.requestNumber}</Text>
        <Text style={ui.cardMeta}>{detail.customer}</Text>
        <StatusPills status={detail.status} hasExistingOrder={detail.hasExistingOrder} />
        <Text style={ui.muted}>{detail.email}</Text>
        <Text style={ui.muted}>
          Existing order: {detail.hasExistingOrder ? "Yes — combine shipping" : "No"}
        </Text>
        {loading ? <ActivityIndicator color={THEME.darkGreen} /> : null}
        {error ? <Text style={ui.error}>{error}</Text> : null}

        {detail.items.map((item) => (
          <ItemEditor
            key={item.id}
            item={item}
            canEditItems={detail.canEditItems}
            apiUrl={apiUrl}
            token={token}
            requestId={detail.id}
            onResult={applyResult}
            onError={setError}
          />
        ))}

        <View style={ui.card}>
          <Text style={ui.cardTitle}>Send offer</Text>
          {detail.sentOffer ? (
            <>
              <Text style={ui.muted}>
                Sent for {detail.sentOffer.expirationDays} days. Frozen after send.
              </Text>
              {detail.sentOffer.shippingFeeOverride !== undefined ? (
                <Text style={ui.muted}>
                  ADD ON ${detail.sentOffer.shippingFeeOverride.toFixed(2)}
                </Text>
              ) : null}
            </>
          ) : (
            <>
              {detail.offerProblems.map((problem) => (
                <Text key={problem.itemName} style={ui.error}>
                  {problem.itemName} is missing {problem.missing.join(", ")}.
                </Text>
              ))}
              {detail.hasExistingOrder ? (
                <Text style={ui.muted}>
                  This customer said they have an existing order. You can set an ADD ON
                  amount below if you are combining shipments.
                </Text>
              ) : null}
              <View style={ui.filters}>
                {[3, 5, 7].map((days) => (
                  <Pressable
                    key={days}
                    style={[ui.chip, expirationDays === days && ui.chipOn]}
                    onPress={() => setExpirationDays(days)}
                  >
                    <Text style={[ui.chipLabel, expirationDays === days && ui.chipLabelOn]}>
                      {days} days
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={ui.label}>ADD ON</Text>
              <TextInput
                value={shippingFeeOverride}
                onChangeText={setShippingFeeOverride}
                placeholder="Leave blank so they choose at checkout"
                placeholderTextColor={THEME.muted}
                keyboardType="decimal-pad"
                style={ui.input}
              />
              <Text style={ui.muted}>
                Optional. Sets a custom ADD ON amount on the draft-order invoice, including
                0. Leave blank so the customer can choose a store shipping rate at checkout.
              </Text>
              <Pressable
                style={[ui.button, !detail.canSendOffer && ui.buttonDisabled]}
                disabled={!detail.canSendOffer || loading}
                onPress={() =>
                  void runAction({
                    intent: "send-offer",
                    expirationDays,
                    shippingFeeOverride,
                  })
                }
              >
                <Text style={ui.buttonLabel}>Send offer</Text>
              </Pressable>
            </>
          )}
        </View>

        <View style={ui.card}>
          <Text style={ui.cardTitle}>Internal notes</Text>
          {detail.internalNotes.map((note) => (
            <Text key={note.id} style={ui.muted}>
              {note.body}
            </Text>
          ))}
          <TextInput
            value={noteDraft}
            onChangeText={setNoteDraft}
            placeholder="Note for the team only"
            placeholderTextColor={THEME.muted}
            style={ui.input}
          />
          <Pressable
            style={ui.secondary}
            onPress={() => {
              void runAction({ intent: "add-internal-note", note: noteDraft });
              setNoteDraft("");
            }}
          >
            <Text style={ui.secondaryLabel}>Add note</Text>
          </Pressable>
        </View>

        {detail.canCloseDeclined ? (
          <Pressable
            style={ui.secondary}
            onPress={() => void runAction({ intent: "close-request" })}
          >
            <Text style={ui.secondaryLabel}>Close declined request</Text>
          </Pressable>
        ) : null}

        {detail.canOverrideClose ? (
          <View style={ui.card}>
            <Text style={ui.cardTitle}>Close entire request</Text>
            <Text style={ui.muted}>
              Admin override. History stays. An unpaid invoice is voided.
            </Text>
            {confirmOverride ? (
              <Pressable
                style={ui.danger}
                onPress={() =>
                  void runAction({
                    intent: "admin-override-close",
                    confirmed: "true",
                  })
                }
              >
                <Text style={ui.buttonLabel}>Confirm close entire request</Text>
              </Pressable>
            ) : (
              <Pressable
                style={ui.secondary}
                onPress={() => void runAction({ intent: "admin-override-close" })}
              >
                <Text style={ui.secondaryLabel}>Close entire request</Text>
              </Pressable>
            )}
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
