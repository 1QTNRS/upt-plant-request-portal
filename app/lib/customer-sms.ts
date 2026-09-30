type FieldSource = Pick<FormData, "get">;

/** Storefront policy paths (Online Store). */
export const STOREFRONT_PRIVACY_POLICY_PATH = "/policies/privacy-policy";
export const STOREFRONT_TERMS_OF_SERVICE_PATH = "/policies/terms-of-service";

/** Absolute policy URLs for SMS consent disclosure (Twilio / storefront). */
export const STOREFRONT_PRIVACY_POLICY_URL =
  "https://unsolicitedplanttalks.com/policies/privacy-policy";
export const STOREFRONT_TERMS_OF_SERVICE_URL =
  "https://unsolicitedplanttalks.com/policies/terms-of-service";

/** Exact consent copy shown before the SMS checkbox on the customer request form. */
export const CUSTOMER_SMS_CONSENT_PARAGRAPH =
  "By checking this box and submitting your request, you agree to receive automated, request-related text messages from Unsolicited Plant Talks. Availability alerts are sent only when at least one requested plant is available and an offer is ready for review. Message frequency varies. Message and data rates may apply. Reply HELP for help or STOP to unsubscribe. SMS consent is optional and is not required to submit a plant request or make a purchase.";

/**
 * When false, the customer request form hides the SMS opt-in card.
 * Backend helpers, schema, and saved preferences are unchanged.
 */
export const CUSTOMER_SMS_OPT_IN_ENABLED = true;

export const SMS_PHONE_INVALID_MESSAGE = "Enter a valid 10-digit mobile number.";

export function readSmsNotifyEnabled(fields: FieldSource): boolean {
  const raw = String(fields.get("smsNotifyEnabled") || "")
    .trim()
    .toLowerCase();
  return raw === "yes" || raw === "on" || raw === "true" || raw === "1";
}

export function readSmsPhone(fields: FieldSource): string {
  return String(fields.get("smsNotifyPhone") ?? "").trim();
}

export function smsPhoneRawHasLetters(raw: string): boolean {
  return /[a-zA-Z]/.test(raw);
}

/** Digits only from typed or pasted input. */
export function digitsOnlyFromSmsPhoneInput(raw: string): string {
  return raw.replace(/\D/g, "");
}

/**
 * Caps at 10 U.S./Canada national digits. A leading country code 1 (11 digits
 * total) is stripped; an 11th national digit is dropped.
 */
export function capUsCaNationalDigits(digits: string): string {
  let d = digits;
  if (d.length > 11) d = d.slice(0, 11);
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  if (d.length > 10) return d.slice(0, 10);
  return d;
}

/** Partial or complete display: (###) ###-#### */
export function formatUsCaNationalDigitsForDisplay(national: string): string {
  const d = national.replace(/\D/g, "").slice(0, 10);
  if (!d) return "";
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Format any phone-ish string for the SMS input (typing, paste, Shopify prefill). */
export function formatSmsPhoneFieldDisplay(raw: string): string {
  if (!raw.trim()) return "";
  const national = capUsCaNationalDigits(digitsOnlyFromSmsPhoneInput(raw));
  return formatUsCaNationalDigitsForDisplay(national);
}

/**
 * Returns exactly 10 national digits when input is valid U.S./Canada mobile,
 * otherwise null.
 */
export function parseUsCaSmsPhoneNationalDigits(raw: string): string | null {
  if (!raw.trim()) return null;
  if (smsPhoneRawHasLetters(raw)) return null;
  const digits = digitsOnlyFromSmsPhoneInput(raw);
  if (digits.length < 10) return null;
  if (digits.length > 11) return null;
  if (digits.length === 11) {
    if (!digits.startsWith("1")) return null;
    return digits.slice(1);
  }
  return digits;
}

export function canonicalUsCaSmsPhoneE164(national10: string): string {
  return `+1${national10}`;
}

/** @deprecated Use parseUsCaSmsPhoneNationalDigits for validation. */
export function normalizeSmsPhone(raw: string): string {
  const national = parseUsCaSmsPhoneNationalDigits(raw);
  if (national) return canonicalUsCaSmsPhoneE164(national);
  return digitsOnlyFromSmsPhoneInput(raw);
}

/** @deprecated Use parseUsCaSmsPhoneNationalDigits. */
export function smsPhoneLooksValid(normalized: string): boolean {
  return parseUsCaSmsPhoneNationalDigits(normalized) !== null;
}

export function validateSmsOptIn(input: {
  enabled: boolean;
  phoneRaw: string;
}): { ok: true; phone: string } | { ok: false; message: string } {
  if (!input.enabled) return { ok: true, phone: "" };
  const trimmed = input.phoneRaw.trim();
  if (!trimmed) {
    return { ok: false, message: "Enter a mobile number to enable SMS notifications." };
  }
  const national = parseUsCaSmsPhoneNationalDigits(trimmed);
  if (!national) {
    return { ok: false, message: SMS_PHONE_INVALID_MESSAGE };
  }
  return { ok: true, phone: canonicalUsCaSmsPhoneE164(national) };
}
