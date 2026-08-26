import type { ActionResult } from "./types";

async function readError(response: Response, fallback: string): Promise<string> {
  if (response.status === 401) {
    return "That device token was rejected. Create a new one in Settings.";
  }
  try {
    const payload = (await response.clone().json()) as { error?: string };
    if (payload.error) return payload.error;
  } catch {
    // Keep the status fallback when the body is not JSON.
  }
  return `${fallback} (${response.status}).`;
}

export async function apiGet<T>(
  apiUrl: string,
  token: string,
  path: string,
): Promise<T> {
  const response = await fetch(`${apiUrl.replace(/\/+$/, "")}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Request failed"));
  }
  return (await response.json()) as T;
}

export async function apiPostJson<T>(
  apiUrl: string,
  token: string,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${apiUrl.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (response.status === 401) {
    throw new Error(await readError(response, "Request failed"));
  }
  return (await response.json()) as T;
}

export async function apiPost(
  apiUrl: string,
  token: string,
  path: string,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  const payload = await apiPostJson<ActionResult>(apiUrl, token, path, body);
  if (!payload.ok && !payload.error) {
    throw new Error("Request failed.");
  }
  return payload;
}

export async function apiUploadPhoto(
  apiUrl: string,
  token: string,
  path: string,
  itemId: string,
  file: { uri: string; name: string; type: string },
  options?: {
    uploadKey?: string;
    onProgress?: (progress: number) => void;
    signal?: { aborted: boolean };
  },
): Promise<ActionResult> {
  const form = new FormData();
  form.append("intent", "upload-photo");
  form.append("itemId", itemId);
  form.append("uploadKey", options?.uploadKey || `${itemId}-${Date.now()}`);
  form.append("photo", file as unknown as Blob);

  return await new Promise<ActionResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${apiUrl.replace(/\/+$/, "")}${path}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        options?.onProgress?.(event.loaded / event.total);
      }
    };
    xhr.onerror = () => reject(new Error("Could not upload that photo."));
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    xhr.onload = () => {
      if (xhr.status === 401) {
        reject(new Error("That device token was rejected. Create a new one in Settings."));
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText) as ActionResult);
      } catch {
        reject(new Error("Could not upload that photo."));
      }
    };
    if (options?.signal) {
      const timer = setInterval(() => {
        if (options.signal?.aborted) {
          clearInterval(timer);
          xhr.abort();
        }
      }, 120);
      xhr.onloadend = () => clearInterval(timer);
    }
    xhr.send(form);
  });
}
