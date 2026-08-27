import type { PlantPhotoFile } from "./plant-photo-file";

export type StagedUploadParameter = { name: string; value: string };

export type StagedUploadTarget = {
  url: string;
  resourceUrl: string;
  parameters: StagedUploadParameter[];
};

export type StagedUploadFetch = (
  input: string,
  init: { method: string; body: FormData; headers?: HeadersInit },
) => Promise<Response>;

export const STAGED_UPLOAD_HTTP_METHOD = "POST" as const;
export const STAGED_UPLOAD_RESOURCE = "FILE" as const;

export function sanitizeStagedUploadUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "(invalid-url)";
  }
}

export function sanitizeStagedUploadBody(text: string): string {
  return text
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => sanitizeStagedUploadUrl(url))
    .replace(/(x-goog-signature|signature|x-amz-signature)\s*[=:]\s*[^\s<&"]+/gi, "$1=redacted")
    .replace(/\b(shpss_|shpat_|shpca_|shpck_)[A-Za-z0-9]+/gi, "$1[redacted]")
    .replace(/[A-Za-z0-9+/]{40,}={0,2}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

export function stagedTargetErrorMessage(input: {
  stage: string;
  status: number;
  body: string;
}): string {
  const detail = sanitizeStagedUploadBody(input.body);
  const suffix = detail ? `: ${detail}` : "";
  return `Shopify staged target returned ${input.status} at ${input.stage}${suffix}`;
}

export function logStagedUploadFailure(input: {
  shop: string;
  stage: string;
  status: number;
  url: string;
  body: string;
}): void {
  console.error(
    `Shopify staged-target failed shop=${input.shop} stage=${input.stage} status=${input.status} url=${sanitizeStagedUploadUrl(input.url)} body=${sanitizeStagedUploadBody(input.body)}`,
  );
}

export function stagedUploadFormEntries(
  target: Pick<StagedUploadTarget, "parameters">,
  file: PlantPhotoFile,
): Array<{ name: string; kind: "field" | "file"; value?: string }> {
  return [
    ...target.parameters.map((parameter) => ({
      name: parameter.name,
      kind: "field" as const,
      value: parameter.value,
    })),
    { name: "file", kind: "file" as const },
  ];
}

export async function postFileToStagedTarget(input: {
  shop: string;
  target: StagedUploadTarget;
  file: PlantPhotoFile;
  fetchImpl?: StagedUploadFetch;
}): Promise<void> {
  const form = new FormData();
  for (const parameter of input.target.parameters) {
    form.append(parameter.name, parameter.value);
  }
  form.append(
    "file",
    new File([new Uint8Array(input.file.data)], input.file.filename, {
      type: input.file.mimeType,
    }),
  );

  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(input.target.url, {
      method: STAGED_UPLOAD_HTTP_METHOD,
      body: form,
    });
  } catch (error) {
    logStagedUploadFailure({
      shop: input.shop,
      stage: "staged-target-network",
      status: 0,
      url: input.target.url,
      body: error instanceof Error ? error.message : "network error",
    });
    throw new Error("Could not reach the Shopify staged upload target.");
  }

  if (response.ok) return;

  const body = await response.text().catch(() => "");
  logStagedUploadFailure({
    shop: input.shop,
    stage: "staged-target",
    status: response.status,
    url: input.target.url,
    body,
  });
  throw new Error(
    stagedTargetErrorMessage({
      stage: "staged-target",
      status: response.status,
      body,
    }),
  );
}
