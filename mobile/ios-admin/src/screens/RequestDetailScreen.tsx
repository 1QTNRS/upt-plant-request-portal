import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
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
import {
  applyItemDraft,
  draftsEqual,
  requestLooksSendable,
  type ItemDraft,
} from "../item-autosave";
import { applyStockOutsideTouch } from "../item-editor";
import { sendOfferHoldControlsEnabled } from "../offer-controls";
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
  const [drafts, setDrafts] = useState<Record<string, ItemDraft>>({});
  const flushers = useRef(new Map<string, () => Promise<boolean>>());
  const stockDismissers = useRef(new Map<string, () => void>());
  const stockOpenIds = useRef(new Set<string>());
  const stockTouchConsumed = useRef(false);

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

  useEffect(() => {
    return () => {
      for (const dismiss of stockDismissers.current.values()) dismiss();
      stockDismissers.current.clear();
      stockOpenIds.current.clear();
    };
  }, [requestId]);

  function applyResult(result: ActionResult) {
    if (!result.ok) {
      setError(result.error || "That action failed.");
      if (result.pendingAdminOverrideClose) setConfirmOverride(true);
      return;
    }
    if (result.request) setDetail(result.request);
  }

  const registerFlush = useCallback((itemId: string, flush: (() => Promise<boolean>) | null) => {
    if (flush) flushers.current.set(itemId, flush);
    else flushers.current.delete(itemId);
  }, []);

  const registerStockDismiss = useCallback((itemId: string, dismiss: (() => void) | null) => {
    if (dismiss) stockDismissers.current.set(itemId, dismiss);
    else stockDismissers.current.delete(itemId);
  }, []);

  const onStockDropdownChange = useCallback((open: boolean, itemId: string) => {
    if (open) stockOpenIds.current.add(itemId);
    else stockOpenIds.current.delete(itemId);
  }, []);

  const consumeStockSearchTouch = useCallback(() => {
    stockTouchConsumed.current = true;
  }, []);

  const dismissStockSearches = useCallback(() => {
    if (stockOpenIds.current.size === 0 && !stockTouchConsumed.current) return;
    // ScrollView onTouchStart can beat the stock hit box. Wait one tick so a
    // tap on the input, results, or dropdown scroll can claim the touch.
    queueMicrotask(() => {
      const consumed = stockTouchConsumed.current;
      stockTouchConsumed.current = false;
      if (
        applyStockOutsideTouch({
          dropdownOpen: stockOpenIds.current.size > 0,
          consumedByStockSearch: consumed,
        }) === "ignore"
      ) {
        return;
      }
      for (const dismiss of stockDismissers.current.values()) dismiss();
      Keyboard.dismiss();
    });
  }, []);

  const onDraftChange = useCallback((itemId: string, draft: ItemDraft) => {
    setDrafts((current) => {
      if (draftsEqual(current[itemId], draft)) return current;
      return { ...current, [itemId]: draft };
    });
  }, []);

  async function flushPendingSaves() {
    const results = await Promise.all(
      [...flushers.current.values()].map((flush) => flush()),
    );
    return results.every(Boolean);
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

  const holdControlsOn = sendOfferHoldControlsEnabled(detail.items);
  const draftedItems = detail.items.map((item) => applyItemDraft(item, drafts[item.id]));
  const canSendOffer =
    detail.status === "New" && (detail.canSendOffer || requestLooksSendable(draftedItems));

  return (
    <SafeAreaView style={ui.flexPage} edges={["top", "left", "right", "bottom"]}>
    <KeyboardAvoidingView
      style={ui.flexPage}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={ui.flexPage}
        contentContainerStyle={ui.page}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onTouchStart={dismissStockSearches}
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
            onStockDropdownChange={onStockDropdownChange}
            onStockSearchTouch={consumeStockSearchTouch}
            onDraftChange={onDraftChange}
            registerFlush={registerFlush}
            registerStockDismiss={registerStockDismiss}
          />
        ))}

        <View style={ui.card}>
          <Text style={ui.cardTitle}>Send offer</Text>
          {detail.sentOffer ? (
            <>
              {holdControlsOn ? (
                <Text style={ui.muted}>
                  Sent for {detail.sentOffer.expirationDays} days. Frozen after send.
                </Text>
              ) : (
                <Text style={ui.muted}>
                  Response sent. Nothing was purchasable — the request is closed.
                </Text>
              )}
              {holdControlsOn && detail.sentOffer.shippingFeeOverride !== undefined ? (
                <Text style={ui.muted}>
                  ADD ON ${detail.sentOffer.shippingFeeOverride.toFixed(2)}
                </Text>
              ) : null}
            </>
          ) : (
            <>
              {!requestLooksSendable(draftedItems)
                ? detail.offerProblems.map((problem) => (
                    <Text key={problem.itemName} style={ui.error}>
                      {problem.itemName} is missing {problem.missing.join(", ")}.
                    </Text>
                  ))
                : null}
              {!holdControlsOn ? (
                <Text style={ui.muted}>
                  Nothing on this request is purchasable. Send offer notifies the
                  customer and closes the request. Expiration and ADD ON do not apply.
                </Text>
              ) : null}
              {detail.hasExistingOrder && holdControlsOn ? (
                <Text style={ui.muted}>
                  This customer said they have an existing order. You can set an ADD ON
                  amount below if you are combining shipments.
                </Text>
              ) : null}
              <View
                style={[ui.holdControls, !holdControlsOn && ui.holdControlsOff]}
                pointerEvents={holdControlsOn ? "auto" : "none"}
              >
              <View style={ui.expirationDays}>
                {[3, 5, 7].map((days) => (
                  <Pressable
                    key={days}
                    style={[ui.chip, expirationDays === days && ui.chipOn]}
                    onPress={() => setExpirationDays(days)}
                    disabled={!holdControlsOn}
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
                editable={holdControlsOn}
                style={[ui.input, !holdControlsOn && ui.inputDisabled]}
              />
              <Text style={ui.muted}>
                Optional. Sets a custom ADD ON amount on the draft-order invoice, including
                0. Leave blank so the customer can choose a store shipping rate at checkout.
              </Text>
              </View>
              <Pressable
                style={[ui.button, !canSendOffer && ui.buttonDisabled]}
                disabled={!canSendOffer || loading}
                onPress={() =>
                  void (async () => {
                    setLoading(true);
                    try {
                      const flushed = await flushPendingSaves();
                      if (!flushed) {
                        setError(
                          "Couldn’t save the latest item values. Retry, then send the offer.",
                        );
                        return;
                      }
                      await runAction({
                        intent: "send-offer",
                        expirationDays,
                        shippingFeeOverride: holdControlsOn ? shippingFeeOverride : "",
                      });
                    } finally {
                      setLoading(false);
                    }
                  })()
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
