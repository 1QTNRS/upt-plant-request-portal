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
  AUTOSAVE_DEBOUNCE_MS,
  autosaveLabel,
  draftToSavePayload,
  shouldDebounceSave,
  type AutosaveStatus,
  type ItemDraft,
} from "../item-autosave";
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
import {
  changeStockUnblocksDropdown,
  linkedStockSummary,
  showsStockSearchInput,
} from "../linked-stock";
import {
  STOCK_SEARCH_NO_STOCK_COLOR,
  canSelectStockCandidate,
  formatStockSearchInventory,
  stockSearchInventoryIsEmpty,
} from "../stock-search";
import { itemNoteLines } from "../item-notes";
import {
  canPreviewPhoto,
  canReorderPhoto,
  mergeEditorPhotos,
  orderedPhotoIdsAfterUpload,
  PHOTO_UPLOAD_CONCURRENCY,
  photosFromPickerAssets,
  runPool,
  type EditorPhoto,
} from "../photo-upload";
import { THEME } from "../theme";
import type { ActionResult, FulfillmentRoute, RequestItem, StockCandidate } from "../types";
import { UNAVAILABLE_REASONS } from "../types";
import { ui } from "../ui";
import { PhotoStrip } from "./PhotoStrip";
import { PhotoViewer } from "./PhotoViewer";

type Props = {
  item: RequestItem;
  canEditItems: boolean;
  apiUrl: string;
  token: string;
  requestId: string;
  onResult: (result: ActionResult) => void;
  onError: (message: string) => void;
  onStockDropdownChange?: (open: boolean, itemId: string) => void;
  onStockSearchTouch?: () => void;
  onDraftChange?: (itemId: string, draft: ItemDraft) => void;
  registerFlush?: (itemId: string, flush: (() => Promise<boolean>) | null) => void;
  registerStockDismiss?: (itemId: string, dismiss: (() => void) | null) => void;
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
  onStockSearchTouch,
  onDraftChange,
  registerFlush,
  registerStockDismiss,
}: Props) {
  const route = routeOf(item);
  const fieldsOn = canEditItems && offerFieldsEnabled(route);
  const exactFields = canEditItems && showsExactPlantFields(route);
  const stockMode = showsStockSearch(route);
  const noteLines = itemNoteLines(item);

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
  const [changingStock, setChangingStock] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [autosave, setAutosave] = useState<AutosaveStatus>("idle");
  const [pendingPhotos, setPendingPhotos] = useState<EditorPhoto[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortedKeys = useRef(new Set<string>());
  const persistInFlight = useRef<Promise<boolean> | null>(null);
  const persistDraftRef = useRef<(options?: { flush?: boolean; silentUi?: boolean }) => Promise<boolean>>(
    async () => true,
  );
  const mountedRef = useRef(true);
  const draftRef = useRef<ItemDraft>({
    offeredName: item.offeredName,
    priceText: String(item.price ?? ""),
    weightText: String(item.weightLbs ?? ""),
    customerFacingNotes: item.customerFacingNotes,
  });
  const itemRef = useRef(item);
  itemRef.current = item;

  const photos = mergeEditorPhotos(itemPhotos(item), pendingPhotos);
  const readyPhotos = photos.filter(canPreviewPhoto);

  useEffect(() => {
    setOfferedName(item.offeredName);
    setPriceText(String(item.price ?? ""));
    setWeightText(String(item.weightLbs ?? ""));
    setNotes(item.customerFacingNotes);
    draftRef.current = {
      offeredName: item.offeredName,
      priceText: String(item.price ?? ""),
      weightText: String(item.weightLbs ?? ""),
      customerFacingNotes: item.customerFacingNotes,
    };
  }, [item.id]);

  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;

  useEffect(() => {
    draftRef.current = { offeredName, priceText, weightText, customerFacingNotes: notes };
    onDraftChangeRef.current?.(item.id, draftRef.current);
  }, [offeredName, priceText, weightText, notes, item.id]);

  const linkedSummary = item.linkedStock
    ? linkedStockSummary({
        productTitle: item.linkedStock.productTitle,
        variantTitle: item.linkedStock.variantTitle,
        price: Number(item.linkedStock.price ?? item.price),
        inventoryQuantity: item.linkedStock.inventoryQuantity,
      })
    : null;

  const dropdownVisible = stockDropdownOpen(
    stockFocused,
    stockTerm,
    stockResults.length > 0,
    stockLoading,
    stockClosed,
  );

  const onStockDropdownChangeRef = useRef(onStockDropdownChange);
  onStockDropdownChangeRef.current = onStockDropdownChange;
  const onStockSearchTouchRef = useRef(onStockSearchTouch);
  onStockSearchTouchRef.current = onStockSearchTouch;

  function consumeStockSearchTouch() {
    onStockSearchTouchRef.current?.();
  }

  useEffect(() => {
    onStockDropdownChangeRef.current?.(dropdownVisible, item.id);
    return () => onStockDropdownChangeRef.current?.(false, item.id);
  }, [dropdownVisible, item.id]);

  function dismissStockSearch() {
    setStockClosed(true);
    setStockFocused(false);
  }

  const dismissStockSearchRef = useRef(dismissStockSearch);
  dismissStockSearchRef.current = dismissStockSearch;

  const registerStockDismissRef = useRef(registerStockDismiss);
  registerStockDismissRef.current = registerStockDismiss;

  useEffect(() => {
    registerStockDismissRef.current?.(item.id, () => dismissStockSearchRef.current());
    return () => {
      dismissStockSearchRef.current();
      registerStockDismissRef.current?.(item.id, null);
    };
  }, [item.id]);

  useEffect(() => {
    if (stockMode) return;
    setStockClosed(true);
    setStockFocused(false);
    setChangingStock(false);
    setStockTerm("");
    setStockResults([]);
    setStockLoading(false);
    if (searchTimer.current) {
      clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
  }, [stockMode]);

  function clearLocalStockSearch() {
    setStockTerm("");
    setStockResults([]);
    setStockClosed(false);
    setStockFocused(false);
    setChangingStock(false);
    if (searchTimer.current) {
      clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
  }

  function unlinkLinkedStock() {
    clearLocalStockSearch();
    void act({ intent: "unlink-stock", itemId: item.id });
  }

  function startChangeStock() {
    const next = changeStockUnblocksDropdown();
    setChangingStock(next.changingStock);
    setStockClosed(next.stockClosed);
    setStockTerm("");
    setStockResults([]);
  }

  async function act(
    body: Record<string, unknown>,
    options?: { silent?: boolean; skipResult?: boolean },
  ) {
    if (!options?.silent) setBusy(true);
    try {
      const result = await apiPost(
        apiUrl,
        token,
        `/api/mobile/admin/requests/${requestId}`,
        body,
      );
      if (!result.ok) {
        if (mountedRef.current) onError(result.error || "That action failed.");
        return result;
      }
      if (result.stockSearch) {
        setStockResults(result.stockSearch.results);
        setStockClosed(false);
      }
      if (result.request && !options?.skipResult) onResult(result);
      return result;
    } catch (caught) {
      if (mountedRef.current) {
        onError(caught instanceof Error ? caught.message : "Could not save.");
      }
      return undefined;
    } finally {
      if (!options?.silent) setBusy(false);
    }
  }

  async function persistDraft(options?: { flush?: boolean; silentUi?: boolean }): Promise<boolean> {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (persistInFlight.current) {
      await persistInFlight.current;
    }
    const run = (async () => {
      if (!options?.flush && !shouldDebounceSave(draftRef.current)) return true;
      const current = itemRef.current;
      const payload = draftToSavePayload(draftRef.current);
      const same =
        payload.offeredName === current.offeredName &&
        payload.customerFacingNotes === current.customerFacingNotes &&
        payload.price === current.price &&
        payload.weightLbs === current.weightLbs;
      if (same) return true;
      if (!options?.silentUi && mountedRef.current) setAutosave("saving");
      const result = await act(
        {
          intent: "update-item",
          itemId: current.id,
          customerFacingNotes: payload.customerFacingNotes,
          ...(route === "not_available"
            ? {
                availability: "not_available",
                unavailableReason: current.unavailableReason || UNAVAILABLE_REASONS[3],
              }
            : { availability: "available", fulfillmentType: route }),
          ...(route === "exact_plant"
            ? {
                offeredName: payload.offeredName,
                price: payload.price,
                weightLbs: payload.weightLbs,
              }
            : {}),
        },
        { silent: true, skipResult: options?.silentUi },
      );
      if (mountedRef.current && !options?.silentUi) {
        setAutosave(result?.ok ? "saved" : "failed");
      }
      return Boolean(result?.ok);
    })();
    persistInFlight.current = run;
    try {
      return await run;
    } finally {
      if (persistInFlight.current === run) persistInFlight.current = null;
    }
  }
  persistDraftRef.current = persistDraft;

  function scheduleAutosave() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void persistDraftRef.current();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  const registerFlushRef = useRef(registerFlush);
  registerFlushRef.current = registerFlush;

  useEffect(() => {
    mountedRef.current = true;
    registerFlushRef.current?.(item.id, () => persistDraftRef.current({ flush: true }));
    return () => {
      mountedRef.current = false;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      void persistDraftRef.current({ flush: true, silentUi: true });
      registerFlushRef.current?.(item.id, null);
    };
  }, [item.id]);

  async function setRoute(next: FulfillmentRoute) {
    dismissStockSearch();
    setStockTerm("");
    setStockResults([]);
    setStockLoading(false);
    if (searchTimer.current) {
      clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
    await persistDraftRef.current({ flush: true });
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

  function patchPending(clientKey: string, patch: Partial<EditorPhoto>) {
    setPendingPhotos((current) =>
      current.map((photo) => (photo.clientKey === clientKey ? { ...photo, ...patch } : photo)),
    );
  }

  async function uploadOne(photo: EditorPhoto): Promise<string | undefined> {
    if (!photo.file || !photo.clientKey) return undefined;
    if (abortedKeys.current.has(photo.clientKey)) return undefined;
    const signal = { aborted: false };
    const watch = setInterval(() => {
      if (abortedKeys.current.has(photo.clientKey!)) signal.aborted = true;
    }, 120);
    const beforeIds = new Set(itemPhotos(itemRef.current).map((entry) => entry.id));
    try {
      const result = await apiUploadPhoto(
        apiUrl,
        token,
        `/api/mobile/admin/requests/${requestId}`,
        item.id,
        photo.file,
        {
          uploadKey: photo.clientKey,
          signal,
          onProgress: (progress) => patchPending(photo.clientKey!, { progress }),
        },
      );
      if (abortedKeys.current.has(photo.clientKey)) return undefined;
      if (!result.ok) {
        patchPending(photo.clientKey, { status: "failed" });
        onError(result.error || "Could not upload that photo.");
        return undefined;
      }
      const added = result.request?.items
        .find((entry) => entry.id === itemRef.current.id)
        ?.photos.find((entry) => !beforeIds.has(entry.id));
      setPendingPhotos((current) => current.filter((entry) => entry.clientKey !== photo.clientKey));
      if (result.request) onResult(result);
      return added?.id;
    } catch (caught) {
      if (abortedKeys.current.has(photo.clientKey)) return undefined;
      patchPending(photo.clientKey, { status: "failed" });
      onError(caught instanceof Error ? caught.message : "Could not upload that photo.");
      return undefined;
    } finally {
      clearInterval(watch);
    }
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
      allowsMultipleSelection: true,
      orderedSelection: true,
    });
    if (picked.canceled || picked.assets.length === 0) return;
    const next = photosFromPickerAssets(picked.assets);
    setPendingPhotos((current) => [...current, ...next]);
    const uploadedByKey = new Map<string, string>();
    await runPool(next, PHOTO_UPLOAD_CONCURRENCY, async (photo) => {
      const uploadedId = await uploadOne(photo);
      if (uploadedId && photo.clientKey) uploadedByKey.set(photo.clientKey, uploadedId);
    });
    const uploadedIds = [...uploadedByKey.values()];
    if (uploadedIds.length === 0) return;
    const keptIds = itemPhotos(itemRef.current)
      .filter((photo) => photo.id !== "linked-stock" && !uploadedIds.includes(photo.id))
      .map((photo) => photo.id);
    const ordered = orderedPhotoIdsAfterUpload(
      keptIds,
      next.map((photo) => photo.clientKey || ""),
      uploadedByKey,
    );
    if (ordered.length > 1) {
      void act({ intent: "reorder-photos", itemId: item.id, photoIds: ordered }, { silent: true });
    }
  }

  async function retryPhoto(photoId: string) {
    const photo = pendingPhotos.find((entry) => entry.id === photoId);
    if (!photo?.file || !photo.clientKey) return;
    abortedKeys.current.delete(photo.clientKey);
    patchPending(photo.clientKey, { status: "uploading", progress: 0 });
    await uploadOne({ ...photo, status: "uploading", progress: 0 });
  }

  function persistPhotoOrder(next: EditorPhoto[]) {
    const ids = next.filter(canReorderPhoto).map((photo) => photo.id);
    if (ids.length < 2) return;
    void act({ intent: "reorder-photos", itemId: item.id, photoIds: ids }, { silent: true });
  }

  return (
    <View style={ui.card}>
      <View style={styles.identity}>
        <PhotoStrip
          photos={photos}
          canEdit={canEditItems && route === "exact_plant"}
          onPreview={(index) => {
            const photo = photos[index];
            if (!photo || !canPreviewPhoto(photo)) return;
            setViewerIndex(readyPhotos.findIndex((entry) => entry.id === photo.id));
          }}
          onRemove={(photoId) => {
            const pending = pendingPhotos.find((photo) => photo.id === photoId);
            if (pending?.clientKey) {
              abortedKeys.current.add(pending.clientKey);
              setPendingPhotos((current) => current.filter((photo) => photo.id !== photoId));
              return;
            }
            void act({ intent: "remove-photo", itemId: item.id, photoId });
          }}
          onReorder={persistPhotoOrder}
          onRetry={(photoId) => void retryPhoto(photoId)}
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
      {noteLines.customer ? <Text style={ui.muted}>Customer: {noteLines.customer}</Text> : null}
      {noteLines.admin ? <Text style={ui.muted}>Admin: {noteLines.admin}</Text> : null}

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
          {item.linkedStock && linkedSummary ? (
            <View style={styles.linkedRow}>
              <View style={styles.linkedCopy}>
                <Text style={ui.cardTitle}>{linkedSummary.title}</Text>
                {linkedSummary.variant ? <Text style={ui.muted}>{linkedSummary.variant}</Text> : null}
                <Text style={ui.muted}>{linkedSummary.meta}</Text>
              </View>
              {canEditItems ? (
                <Pressable
                  disabled={!fieldsOn}
                  onPress={unlinkLinkedStock}
                  accessibilityRole="button"
                  accessibilityLabel="Remove linked stock"
                  hitSlop={8}
                  style={styles.removeStock}
                >
                  <Text style={styles.removeStockLabel}>X</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <Text style={ui.muted}>No store listing linked yet.</Text>
          )}
          {item.linkedStock && canEditItems && !changingStock ? (
            <Pressable disabled={!fieldsOn} onPress={startChangeStock}>
              <Text style={ui.link}>Change stock</Text>
            </Pressable>
          ) : null}
          {canEditItems &&
          showsStockSearchInput({
            hasLinkedStock: Boolean(item.linkedStock),
            changingStock,
          }) ? (
            <Pressable
              style={styles.stockHit}
              onTouchStart={(event) => {
                consumeStockSearchTouch();
                event.stopPropagation();
              }}
            >
              <TextInput
                value={stockTerm}
                onChangeText={onStockTerm}
                editable={fieldsOn}
                placeholder="Search live website stock"
                placeholderTextColor={THEME.muted}
                style={[ui.input, styles.stockInput, !fieldsOn && ui.inputDisabled]}
                onFocus={() => {
                  setStockClosed(false);
                  setStockFocused(true);
                }}
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
                      onTouchStart={consumeStockSearchTouch}
                      style={styles.dropdownList}
                    >
                      {stockResults.map((candidate) => {
                        const selectable = canSelectStockCandidate(candidate);
                        const noStock = stockSearchInventoryIsEmpty(candidate);
                        const inventoryLabel = formatStockSearchInventory(candidate);
                        return (
                          <Pressable
                            key={candidate.variantGid}
                            style={styles.dropdownRow}
                            disabled={!selectable}
                            accessibilityState={{ disabled: !selectable }}
                            onPress={() => {
                              if (!selectable) return;
                              setStockClosed(true);
                              setChangingStock(false);
                              void act({
                                intent: "link-stock",
                                itemId: item.id,
                                variantGid: candidate.variantGid,
                              });
                            }}
                          >
                            <Text style={ui.cardTitle}>{candidate.productTitle}</Text>
                            {candidate.variantTitle ? (
                              <Text style={ui.muted}>{candidate.variantTitle}</Text>
                            ) : null}
                            <Text style={ui.muted}>${candidate.price.toFixed(2)}</Text>
                            <Text
                              style={noStock ? styles.noStock : styles.inStock}
                              accessibilityLabel={inventoryLabel}
                            >
                              {inventoryLabel}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </GestureScrollView>
                  )}
                </View>
              ) : null}
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {exactFields ? (
        <>
          <Text style={ui.label}>Offered name</Text>
          <TextInput
            value={offeredName}
            onChangeText={(text) => {
              setOfferedName(text);
              scheduleAutosave();
            }}
            editable={fieldsOn}
            style={[ui.input, !fieldsOn && ui.inputDisabled]}
            onBlur={() => void persistDraftRef.current({ flush: true })}
          />
          <View style={ui.row}>
            <View style={ui.flexItem}>
              <Text style={ui.label}>Price</Text>
              <TextInput
                value={priceText}
                onChangeText={(text) => {
                  setPriceText(text);
                  scheduleAutosave();
                }}
                editable={fieldsOn}
                keyboardType="decimal-pad"
                selectTextOnFocus
                style={[ui.input, !fieldsOn && ui.inputDisabled]}
                onBlur={() => void persistDraftRef.current({ flush: true })}
              />
            </View>
            <View style={ui.flexItem}>
              <Text style={ui.label}>Weight (lb)</Text>
              <TextInput
                value={weightText}
                onChangeText={(text) => {
                  setWeightText(text);
                  scheduleAutosave();
                }}
                editable={fieldsOn}
                keyboardType="decimal-pad"
                selectTextOnFocus
                style={[ui.input, !fieldsOn && ui.inputDisabled]}
                onBlur={() => void persistDraftRef.current({ flush: true })}
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
            onChangeText={(text) => {
              setNotes(text);
              scheduleAutosave();
            }}
            multiline
            style={[ui.input, ui.multiline]}
            onBlur={() => void persistDraftRef.current({ flush: true })}
          />
          {autosaveLabel(autosave) ? (
            <Pressable
              disabled={autosave !== "failed"}
              onPress={() => void persistDraftRef.current({ flush: true })}
            >
              <Text style={autosave === "failed" ? ui.error : ui.muted}>
                {autosaveLabel(autosave)}
                {autosave === "failed" ? " · Retry" : ""}
              </Text>
            </Pressable>
          ) : null}
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
            <Text style={ui.secondaryLabel}>Upload Photos</Text>
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
          photos={readyPhotos}
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
  stockHit: { zIndex: 2 },
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
  inStock: { color: THEME.darkGreen, fontWeight: "600" as const },
  noStock: { color: STOCK_SEARCH_NO_STOCK_COLOR, fontWeight: "700" as const },
  linkedStock: { marginTop: 10, gap: 4 },
  linkedRow: {
    marginTop: 10,
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: 12,
  },
  linkedCopy: { flex: 1, minWidth: 0, gap: 2 },
  removeStock: {
    minWidth: 36,
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME.line,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: THEME.white,
  },
  removeStockLabel: { color: THEME.darkGreen, fontWeight: "700" as const, fontSize: 16 },
  busy: { marginTop: 8 },
};
