/** Build an API path without URLSearchParams.size, which Hermes does not implement. */
export function apiPath(
  path: string,
  params: Record<string, string | undefined | null> = {},
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const trimmed = value?.trim();
    if (trimmed) search.set(key, trimmed);
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}
