import { useEffect, useState, type TimeHTMLAttributes } from "react";

import { formatViewerDateTime } from "../lib/customer-time";

/**
 * Shows a stored UTC instant in the viewer's timezone. First paint uses the
 * server-formatted fallback so SSR and no-JS still have a stamp; after hydrate
 * the label is rewritten with the browser zone (e.g. 3:00 PM ET → 12:00 PM PT).
 */
export function ViewerLocalTime({
  iso,
  fallback,
  ...rest
}: {
  iso: string;
  fallback: string;
} & TimeHTMLAttributes<HTMLTimeElement>) {
  const [label, setLabel] = useState(fallback);

  useEffect(() => {
    setLabel(formatViewerDateTime(iso));
  }, [iso]);

  return (
    <time dateTime={iso} suppressHydrationWarning {...rest}>
      {label}
    </time>
  );
}
