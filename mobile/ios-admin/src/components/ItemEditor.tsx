import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { ScrollView as GestureScrollView } from "react-native-gesture-handler";
import * as ImagePicker from "expo-image-picker";

import { apiPost, apiUploadPhoto } from "../api";
import {
  itemPhotos,
  offerFieldsEnabled,
  routeLabel,
  routeOf,
  showsExactPlantFields,
  showsStockSearch,
  STOCK_DROPDOWN_MAX_HEIGHT,
  stockDropdownOpen,
} from "../item-editor";
import { THEME } from "../theme";
import type { ActionResult, FulfillmentRoute, RequestItem, StockCandidate } from "../types";
import { UNAVAILABLE_REASONS } from "../types";
import { ui } from "../ui";
import { PhotoStrip, type StripPhoto } from "./PhotoStrip";
import { PhotoViewer } from "./PhotoViewer";

type Props = {
  item: RequestItem;
  canEditItems: boolean;
  apiUrl: string;
  token: string;
  requestId: string;
  onResult: (result: ActionResult) => void;
  onError: (message: string) => void;
  onStockDropdownChange?: (open: boolean) => void;
};

export function ItemEditor({
  item,
  canEditItems,
  apiUrl,
  token,
  requestId,
  onResult,
  onError,
  onStockDropdownChange,
}: Props) {
  const route = routeOf(item);
  const fieldsOn = canEditItems && offerFieldsEnabled(route);
  const exactFields = canEditItems && showsExactPlantFields(route);
  const stockMode = showsStockSearch(route);
  const photos = itemPhotos(item);

  const [offeredName, setOfferedName] = useState(item.offeredName);
  const [priceText, setPriceText] = useState(String(item.price ?? ""));
  const [weightText, setWeightText] = useState(String(item.weightLbs ?? ""));
  const [notes, setNotes] = useState(item.customerFacingNotes);
  const [photoUrl, setPhotoUrl] = useState("");
  const [stockTerm, setStockTerm] = useState("");
  const [stockResults, setStockResults] = useState<StockCandidate[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockFocused, setStockFocused] = useState(false);
  const [stockClosed, setStockClosed] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setOfferedName(item.offeredName);
    setPriceText(String(item.price ?? ""));
    setWeightText(String(item.weightLbs ?? ""));
    setNotes(item.customerFacingNotes);
  }, [item.id]);

  const dropdownVisible = stockDropdownOpen(
    stockFocused,
    stockTerm,
    stockResults.length > 0,
    stockLoading,
    stockClosed,
  );

  useEffect(() => {
    onStockDropdownChange?.(dropdownVisible);
    return () => onStockDropdownChange?.(false);
  }, [dropdownVisible, onStockDropdownChange]);

  async function act(body: Record<string, unknown>, options?: { silent?: boolean }) {
    if (!options?.silent) setBusy(true);
    try {
      const result = await apiPost(
        apiUrl,
        token,
        `/api/mobile/admin/requests/${requestId}`,
        body,
      );
      if (!result.ok) {
        onError(result.error || "That action failed.");
        return result;
      }
      if (result.stockSearch) {
        setStockResults(result.stockSearch.results);
        setStockClosed(false);
      }
      if (result.request) onResult(result);
      return result;
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not save.");
      return undefined;
    } finally {
      if (!options?.silent) setBusy(false);
    }
  }

  async function setRoute(next: FulfillmentRoute) {
    await act(
      next === "not_available"
        ? {
            intent: "update-item",
            itemId: item.id,
            availability: "not_available",
            unavailableReason: item.unavailableReason || UNAVAILABLE_REASONS[3],
          }
        : {
            intent: "update-item",
            itemId: item.id,
            availability: "available",
            fulfillmentType: next,
          },
    );
  }

  async function saveItem() {
    await act({
      intent: "update-item",
      itemId: item.id,
      customerFacingNotes: notes,
      ...(route === "not_available"
        ? {
            availability: "not_available",
            unavailableReason: item.unavailableReason || UNAVAILABLE_REASONS[3],
          }
        : { availability: "available", fulfillmentType: route }),
      ...(exactFields
        ? {
            offeredName,
            price: Number(priceText) || 0,
            weightLbs: Number(weightText) || 0,
          }
        : {}),
    });
  }

  async function searchStock(term: string) {
    if (!term.trim()) {
      setStockResults([]);
      return;
    }
    setStockLoading(true);
    try {
      await act({ intent: "search-stock", itemId: item.id, term }, { silent: true });
    } finally {
      setStockLoading(false);
    }
  }

  function onStockTerm(text: string) {
    setStockTerm(text);
    setStockClosed(false);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      void searchStock(text);
    }, 300);
  }

  async function pickPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      onError("Photo library access is needed to attach an exact-plant photo.");
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];
    setBusy(true);
    try {
      const result = await apiUploadPhoto(
        apiUrl,
        token,
        `/api/mobile/admin/requests/${requestId}`,
        item.id,
        {
          uri: asset.uri,
          name: asset.fileName || "plant.jpg",
          type: asset.mimeType || "image/jpeg",
        },
      );
      if (!result.ok) onError(result.error || "Could not upload that photo.");
      else if (result.request) onResult(result);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not upload that photo.");
    } finally {
      setBusy(false);
    }
  }

  function persistPhotoOrder(next: StripPhoto[]) {
    const ids = next.filter((photo) => photo.id !== "linked-stock").map((photo) => photo.id);
    if (ids.length < 2) return;
    void act(
      { intent: "reorder-photos", itemId: item.id, photoIds: ids },
      { silent: true },
    );
  }

  return (
    <View style={ui.card}>
      <View style={styles.identity}>
        <PhotoStrip
          photos={photos}
          canEdit={canEditItems && route === "exact_plant"}
          onPreview={setViewerIndex}
          onRemove={(photoId) =>
            void act({ intent: "remove-photo", itemId: item.id, photoId })
          }
          onReorder={persistPhotoOrder}
        />
        <View style={styles.identityText}>
          <Text style={ui.cardTitle}>
            {stockMode && item.linkedStock
              ? item.linkedStock.productTitle
              : offeredName || item.plantName}
          </Text>
          <Text style={ui.muted}>Requested: {item.plantName}</Text>
        </View>
      </View>
      {item.customerRequestNotes ? (
        <Text style={ui.muted}>Customer: {item.customerRequestNotes}</Text>
      ) : null}
      {item.adminNotes ? <Text style={ui.muted}>Admin: {item.adminNotes}</Text> : null}

      {canEditItems ? (
        <View style={ui.filters}>
          {(["exact_plant", "growers_choice", "not_available"] as FulfillmentRoute[]).map(
            (value) => (
              <Pressable
                key={value}
                style={[ui.chip, route === value && ui.chipOn]}
                onPress={() => void setRoute(value)}
              >
                <Text style={[ui.chipLabel, route === value && ui.chipLabelOn]}>
                  {routeLabel(value)}
                </Text>
              </Pressable>
            ),
          )}
        </View>
      ) : (
        <Text style={ui.cardMeta}>{routeLabel(route)}</Text>
      )}

      {stockMode ? (
        <View style={styles.stockWrap} pointerEvents={fieldsOn ? "auto" : "none"}>
          {canEditItems ? (
            <>
              <TextInput
                value={stockTerm}
                onChangeText={onStockTerm}
                editable={fieldsOn}
                placeholder="Search live website stock"
                placeholderTextColor={THEME.muted}
                style={[ui.input, styles.stockInput, !fieldsOn && ui.inputDisabled]}
                onFocus={() => setStockFocused(true)}
                onBlur={() => setStockFocused(false)}
                returnKeyType="search"
                onSubmitEditing={() => void searchStock(stockTerm)}
              />
              {dropdownVisible ? (
                <View style={styles.dropdown}>
                  {stockLoading ? (
                    <ActivityIndicator color={THEME.darkGreen} style={styles.dropdownStatus} />
                  ) : null}
                  {!stockLoading && stockResults.length === 0 ? (
                    <Text style={styles.dropdownEmpty}>No matching website stock.</Text>
                  ) : (
                    <GestureScrollView
                      nestedScrollEnabled
                      keyboardShouldPersistTaps="always"
                      keyboardDismissMode="none"
                      style={styles.dropdownList}
                    >
                      {stockResults.map((candidate) => (
                        <Pressable
                          key={candidate.variantGid}
                          style={styles.dropdownRow}
                          onPress={() => {
                            setStockClosed(true);
                            void act({
                              intent: "link-stock",
                              itemId: item.id,
                              variantGid: candidate.variantGid,
                            });
                          }}
                        >
                          <Text style={ui.cardTitle}>
                            {candidate.productTitle} · {candidate.variantTitle}
                          </Text>
                          <Text style={ui.muted}>
                            ${candidate.price.toFixed(2)}
                            {candidate.unlinkableReason ? ` · ${candidate.unlinkableReason}` : ""}
                          </Text>
                        </Pressable>
                      ))}
                    </GestureScrollView>
                  )}
                </View>
              ) : null}
            </>
          ) : null}
          {item.linkedStock ? (
            <View style={styles.linkedStock}>
              <Text style={ui.muted}>
                Linked: {item.linkedStock.productTitle} · {item.linkedStock.variantTitle}
              </Text>
              <Text style={ui.muted}>
                ${Number(item.linkedStock.price ?? item.price).toFixed(2)}
                {item.linkedStock.weightLbs != null ? ` · ${item.linkedStock.weightLbs} lb` : ""}
              </Text>
              {canEditItems ? (
                <Pressable
                  disabled={!fieldsOn}
                  onPress={() => void act({ intent: "unlink-stock", itemId: item.id })}
                >
                  <Text style={ui.link}>Unlink listing</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <Text style={ui.muted}>No store listing linked yet.</Text>
          )}
        </View>
      ) : null}

      {exactFields ? (
        <>
          <Text style={ui.label}>Offered name</Text>
          <TextInput
            value={offeredName}
            onChangeText={setOfferedName}
            editable={fieldsOn}
            style={[ui.input, !fieldsOn && ui.inputDisabled]}
          />
          <View style={ui.row}>
            <View style={ui.flexItem}>
              <Text style={ui.label}>Price</Text>
              <TextInput
                value={priceText}
                onChangeText={setPriceText}
                editable={fieldsOn}
                keyboardType="decimal-pad"
                style={[ui.input, !fieldsOn && ui.inputDisabled]}
              />
            </View>
            <View style={ui.flexItem}>
              <Text style={ui.label}>Weight (lb)</Text>
              <TextInput
                value={weightText}
                onChangeText={setWeightText}
                editable={fieldsOn}
                keyboardType="decimal-pad"
                style={[ui.input, !fieldsOn && ui.inputDisabled]}
              />
            </View>
          </View>
        </>
      ) : null}

      {canEditItems ? (
        <>
          <Text style={ui.label}>Customer-facing notes</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            multiline
            style={[ui.input, ui.multiline]}
          />
          <Pressable style={ui.button} onPress={() => void saveItem()}>
            <Text style={ui.buttonLabel}>Save item</Text>
          </Pressable>
        </>
      ) : !stockMode ? (
        <Text style={ui.cardMeta}>
          ${item.price.toFixed(2)} · {item.weightLbs} lb
        </Text>
      ) : null}

      {route === "not_available" && canEditItems ? (
        <View style={styles.reasons}>
          {UNAVAILABLE_REASONS.map((reason) => (
            <Pressable
              key={reason}
              style={[ui.chip, item.unavailableReason === reason && ui.chipOn]}
              onPress={() =>
                void act({
                  intent: "update-item",
                  itemId: item.id,
                  availability: "not_available",
                  unavailableReason: reason,
                })
              }
            >
              <Text
                style={[ui.chipLabel, item.unavailableReason === reason && ui.chipLabelOn]}
              >
                {reason}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {route === "not_available" && item.unavailableReason ? (
        <Text style={ui.muted}>Reason: {item.unavailableReason}</Text>
      ) : null}

      {route === "exact_plant" && canEditItems ? (
        <View style={styles.block}>
          <Pressable
            style={[ui.secondary, !fieldsOn && ui.buttonDisabled]}
            disabled={!fieldsOn}
            onPress={() => void pickPhoto()}
          >
            <Text style={ui.secondaryLabel}>Add photo from library</Text>
          </Pressable>
          <TextInput
            value={photoUrl}
            onChangeText={setPhotoUrl}
            editable={fieldsOn}
            placeholder="Or paste a photo URL"
            placeholderTextColor={THEME.muted}
            autoCapitalize="none"
            style={[ui.input, !fieldsOn && ui.inputDisabled]}
          />
          <Pressable
            style={[ui.secondary, !fieldsOn && ui.buttonDisabled]}
            disabled={!fieldsOn}
            onPress={() =>
              void act({
                intent: "add-photo-url",
                itemId: item.id,
                photoUrl,
              })
            }
          >
            <Text style={ui.secondaryLabel}>Add photo URL</Text>
          </Pressable>
        </View>
      ) : null}

      {busy ? <ActivityIndicator color={THEME.darkGreen} style={styles.busy} /> : null}

      {viewerIndex !== null ? (
        <PhotoViewer
          photos={photos}
          index={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      ) : null}
    </View>
  );
}

const styles = {
  identity: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, marginBottom: 8 },
  identityText: { flex: 1, minWidth: 0 },
  reasons: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 8,
    marginTop: 16,
    marginBottom: 8,
  },
  block: { marginTop: 8 },
  stockWrap: { marginTop: 4, marginBottom: 8, zIndex: 2 },
  stockInput: { marginBottom: 0, marginTop: 4 },
  dropdown: {
    borderWidth: 1,
    borderColor: THEME.line,
    borderTopWidth: 0,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    backgroundColor: THEME.white,
    maxHeight: STOCK_DROPDOWN_MAX_HEIGHT,
    overflow: "hidden" as const,
  },
  dropdownList: { maxHeight: STOCK_DROPDOWN_MAX_HEIGHT },
  dropdownStatus: { padding: 12 },
  dropdownEmpty: { color: THEME.muted, padding: 12 },
  dropdownRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: THEME.line,
  },
  linkedStock: { marginTop: 10, gap: 4 },
  busy: { marginTop: 8 },
};
