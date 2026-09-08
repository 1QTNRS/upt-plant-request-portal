import { useEffect, useState, type TimeHTMLAttributes } from "react";

import { formatAdminNoteTimestamp } from "../lib/customer-time";

/**
 * Shows when an internal note was saved, in the viewer's local timezone.
 * First paint uses the server fallback; after hydrate the label is rewritten.
 */
export function AdminNoteTime({
  iso,
  fallback,
  ...rest
}: {
  iso: string;
  fallback: string;
} & TimeHTMLAttributes<HTMLTimeElement>) {
  const [label, setLabel] = useState(fallback);

  useEffect(() => {
    setLabel(formatAdminNoteTimestamp(iso));
  }, [iso]);

  return (
    <time dateTime={iso} suppressHydrationWarning {...rest}>
      {label}
    </time>
  );
}
