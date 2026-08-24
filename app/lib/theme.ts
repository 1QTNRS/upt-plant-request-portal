/** Brand palette from the customer-form mock. */
export const THEME = {
  darkGreen: "#002910",
  yellow: "#f1a638",
  mint: "#d6ece2",
  cream: "#f7faf7",
  white: "#ffffff",
  ink: "#002910",
  muted: "#4a5c52",
  line: "#c9d9d0",
} as const;

export type ThemeTone =
  | "info"
  | "warning"
  | "caution"
  | "success"
  | "critical";

export type StatusBadgeStyle = {
  background: string;
  color: string;
  borderColor: string;
};

/**
 * Maps stored and customer-facing statuses onto the brand palette.
 * New / mint, payable / yellow, Closed / dark green.
 */
export function themeBadgeStyle(
  tone: ThemeTone,
  label?: string,
): StatusBadgeStyle {
  if (label === "Needs Payment" || label === "Offer Ready for Review") {
    return {
      background: THEME.yellow,
      color: THEME.darkGreen,
      borderColor: THEME.yellow,
    };
  }
  if (label === "No Payment Needed") {
    return {
      background: THEME.mint,
      color: THEME.darkGreen,
      borderColor: THEME.mint,
    };
  }
  switch (tone) {
    case "info":
      return {
        background: THEME.mint,
        color: THEME.darkGreen,
        borderColor: THEME.mint,
      };
    case "warning":
    case "caution":
      return {
        background: THEME.yellow,
        color: THEME.darkGreen,
        borderColor: THEME.yellow,
      };
    case "success":
      return {
        background: THEME.darkGreen,
        color: THEME.white,
        borderColor: THEME.darkGreen,
      };
    case "critical":
      return {
        background: THEME.white,
        color: THEME.darkGreen,
        borderColor: THEME.yellow,
      };
  }
}
