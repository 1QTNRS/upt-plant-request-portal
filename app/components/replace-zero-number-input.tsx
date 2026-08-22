import { useEffect, useState, type CSSProperties } from "react";

import {
  parseNumberDraft,
  sanitizeNumberDraft,
  shouldSelectZeroOnFocus,
} from "../lib/admin-item-draft";

/**
 * Admin price/weight field. A controlled `type="number"` that starts at 0
 * keeps that zero when the merchant types, producing 085. This keeps a text
 * draft, selects the untouched zero on focus, and only parses on each change
 * and blur. Server-side normalizePrice / normalizeWeight still run on save.
 */
export function ReplaceZeroNumberInput({
  id,
  value,
  disabled,
  readOnly,
  step,
  style,
  onValueChange,
  onCommit,
}: {
  id: string;
  value: number;
  disabled?: boolean;
  readOnly?: boolean;
  step?: number;
  style?: CSSProperties;
  onValueChange: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const [display, setDisplay] = useState(value === 0 ? "0" : String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (focused) return;
    setDisplay(value === 0 ? "0" : String(value));
  }, [value, focused]);

  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      step={step}
      value={display}
      readOnly={readOnly}
      disabled={disabled}
      onFocus={(event) => {
        setFocused(true);
        if (shouldSelectZeroOnFocus(display)) {
          event.currentTarget.select();
        }
      }}
      onChange={(event) => {
        const next = sanitizeNumberDraft(event.currentTarget.value);
        setDisplay(next);
        onValueChange(parseNumberDraft(next));
      }}
      onBlur={() => {
        setFocused(false);
        const parsed = parseNumberDraft(display);
        setDisplay(parsed === 0 ? "0" : String(parsed));
        onCommit(parsed);
      }}
      style={style}
    />
  );
}
