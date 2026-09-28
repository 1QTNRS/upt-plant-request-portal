type FieldSource = Pick<FormData, "get">;

/** Storefront policy paths (Online Store). */
export const STOREFRONT_PRIVACY_POLICY_PATH = "/policies/privacy-policy";
export const STOREFRONT_TERMS_OF_SERVICE_PATH = "/policies/terms-of-service";

export function readSmsNotifyEnabled(fields: FieldSource): boolean {
  const raw = String(fields.get("smsNotifyEnabled") || "")
    .trim()
    .toLowerCase();
  return raw === "yes" || raw === "on" || raw === "true" || raw === "1";
}

export function readSmsPhone(fields: FieldSource): string {
  return String(fields.get("smsNotifyPhone") ?? "").trim();
}

/** Keeps digits and a leading + for E.164-style numbers. */
export function normalizeSmsPhone(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    return `+${digits.slice(1).replace(/\D/g, "")}`;
  }
  return digits.replace(/\D/g, "");
}

export function smsPhoneLooksValid(normalized: string): boolean {
  const digits = normalized.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

export function validateSmsOptIn(input: {
  enabled: boolean;
  phoneRaw: string;
}): { ok: true; phone: string } | { ok: false; message: string } {
  if (!input.enabled) return { ok: true, phone: "" };
  const phone = normalizeSmsPhone(input.phoneRaw);
  if (!phone) {
    return { ok: false, message: "Enter a mobile number to enable SMS notifications." };
  }
  if (!smsPhoneLooksValid(phone)) {
    return {
      ok: false,
      message: "Enter a valid mobile number (at least 10 digits).",
    };
  }
  return { ok: true, phone };
}
