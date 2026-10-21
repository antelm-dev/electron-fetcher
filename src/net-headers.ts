import type { HeaderValue, NormalizedHeaders, NetRequestConfig } from "./fetcher.js";

export function normalizeHeaderValue(value: HeaderValue) {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

export function headersToRecord(headers: unknown): Record<string, string> {
  if (!headers) return {};

  if (headers instanceof Headers) {
    const entries: Record<string, string> = {};
    headers.forEach((value, key) => {
      entries[key] = value;
    });
    return entries;
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [key, String(value)]));
  }

  const maybeToJSON = (headers as { toJSON?: () => unknown }).toJSON;
  if (typeof maybeToJSON === "function") {
    return headersToRecord(maybeToJSON.call(headers));
  }

  const methodKeys = new Set([
    "common",
    "delete",
    "get",
    "head",
    "post",
    "put",
    "patch",
    "options",
  ]);

  return Object.fromEntries(
    Object.entries(headers as Record<string, HeaderValue>).flatMap(([key, value]) => {
      if (methodKeys.has(key.toLowerCase()) && value !== null && typeof value === "object") {
        return [];
      }

      const normalized = normalizeHeaderValue(value);
      return normalized === undefined ? [] : [[key, normalized]];
    }),
  );
}

export function createDefaultHeaders(headers: unknown): NormalizedHeaders {
  const source = headers as Record<string, unknown> | undefined;
  return {
    common: {
      ...headersToRecord(headers),
      ...headersToRecord(source?.common),
    },
    delete: headersToRecord(source?.delete),
    get: headersToRecord(source?.get),
    head: headersToRecord(source?.head),
    post: headersToRecord(source?.post),
    put: headersToRecord(source?.put),
    patch: headersToRecord(source?.patch),
    options: headersToRecord(source?.options),
  };
}

export function hasHeader(headers: Record<string, string>, name: string) {
  return Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());
}

export function setHeaderIfMissing(headers: Record<string, string>, name: string, value: string) {
  if (!hasHeader(headers, name)) {
    headers[name] = value;
  }
}

export function getMethod(config: NetRequestConfig) {
  return (config.method ?? "GET").toUpperCase();
}

export function getMergedHeaders(defaultHeaders: NormalizedHeaders, config: NetRequestConfig) {
  const method = getMethod(config).toLowerCase();

  return {
    ...headersToRecord(defaultHeaders.common),
    ...headersToRecord(defaultHeaders[method as keyof NormalizedHeaders]),
    ...headersToRecord(config.headers),
  };
}

export function responseHeadersToRecord(headers: Headers) {
  const entries: Record<string, string> = {};
  headers.forEach((value, key) => {
    entries[key] = value;
  });
  return entries;
}
