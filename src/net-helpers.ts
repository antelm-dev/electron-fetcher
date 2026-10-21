import type { NetRequestConfig, NetResponse } from "./fetcher.js";
import { getMethod, setHeaderIfMissing, responseHeadersToRecord } from "./net-headers.js";

export function serializeBody(
  config: NetRequestConfig,
  headers: Record<string, string>,
): BodyInit | undefined {
  const method = getMethod(config);
  const data = config.data;

  if (method === "GET" || method === "HEAD") return undefined;
  if (typeof FormData !== "undefined" && data instanceof FormData) {
    return data;
  }

  if (data === undefined || data === null) return undefined;

  if (typeof data === "string") return data;
  if (data instanceof URLSearchParams) return data;
  if (typeof Blob !== "undefined" && data instanceof Blob) return data;
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  }

  setHeaderIfMissing(headers, "Content-Type", "application/json");
  return JSON.stringify(data);
}

export async function parseResponseData(response: Response, config: NetRequestConfig) {
  if (config.responseType === "arraybuffer") {
    return response.arrayBuffer();
  }

  if (config.responseType === "blob") {
    return response.blob();
  }

  if (config.responseType === "stream") {
    return response.body;
  }

  const text = await response.text();
  if (config.responseType === "text") return text;
  if (!text) return "";

  const contentType = response.headers.get("content-type") ?? "";
  const shouldParseJson =
    config.responseType === "json" ||
    contentType.includes("application/json") ||
    contentType.includes("+json");

  if (!shouldParseJson) return text;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function createNetResponse<T>(
  config: NetRequestConfig,
  data: T,
  response: Pick<Response, "status" | "statusText" | "headers">,
): NetResponse<T> {
  return {
    data,
    status: response.status,
    statusText: response.statusText,
    headers: responseHeadersToRecord(response.headers),
    config,
    request: config,
  };
}

export function createAbortSignal(config: NetRequestConfig) {
  const sourceSignal = config.signal as AbortSignal | undefined;

  if (!config.timeout) {
    return { signal: sourceSignal, cleanup: () => {} };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeout);

  const abort = () => controller.abort();
  sourceSignal?.addEventListener("abort", abort, { once: true });

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      sourceSignal?.removeEventListener("abort", abort);
    },
  };
}

export function getCacheKey(config: NetRequestConfig) {
  return `${getMethod(config)}-${config.url ?? ""}`.toLowerCase();
}
