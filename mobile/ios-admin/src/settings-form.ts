import type { ShopSettings } from "./types";

export type SettingsFormState = {
  warning: string;
  email: string;
  newRequestEmail: boolean;
  customerResponseEmail: boolean;
  paymentAfterVoidEmail: boolean;
  pushNewRequest: boolean;
  pushItemStatus: boolean;
  registeredPushDevices: number;
  sku: string;
};

export function settingsFormFromShop(settings: ShopSettings): SettingsFormState {
  return {
    warning: settings.fedexRemovalWarning,
    email: settings.adminNotificationEmail,
    newRequestEmail: settings.adminEmailNewRequest,
    customerResponseEmail: settings.adminEmailCustomerResponse,
    paymentAfterVoidEmail: settings.adminEmailPaymentAfterVoid,
    pushNewRequest: settings.adminPushNewRequest,
    pushItemStatus: settings.adminPushItemStatusUpdate,
    registeredPushDevices: settings.registeredPushDevices,
    sku: settings.fedexProductSku,
  };
}

/** Merge server fields into the open form. Does not remount or reset scroll. */
export function mergeSettingsForm(
  current: SettingsFormState,
  incoming: SettingsFormState,
): SettingsFormState {
  return { ...current, ...incoming };
}

export function settingsFeedbackLabel(input: {
  saving: boolean;
  saved: string | null;
  error: string | null;
  hydrated?: boolean;
}): string {
  if (input.saving) return "Saving…";
  if (input.error) return input.error;
  if (input.saved) return input.saved;
  if (input.hydrated === false) return " ";
  return " ";
}

/** The form stays on screen during save. Never swap it for a spinner. */
export function settingsFormHiddenForSave(_saving: boolean): boolean {
  return false;
}

/** Save must leave the ScrollView offset alone. */
export function scrollOffsetAfterSettingsSave(scrollY: number): number {
  return scrollY;
}
