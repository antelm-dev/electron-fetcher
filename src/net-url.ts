import type { NetRequestConfig } from "./fetcher.js";

export function isAbsoluteUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

export function combineUrls(baseURL: string, url: string) {
  if (isAbsoluteUrl(url)) return url;
  return `${baseURL.replace(/\/$/, "")}/${url.replace(/^\//, "")}`;
}

export function appendParams(url: URL, params: unknown) {
  if (!params) return url;

  const nextParams =
    params instanceof URLSearchParams
      ? params
      : new URLSearchParams(
          Object.entries(params as Record<string, unknown>).flatMap(([key, value]) => {
            if (value === undefined || value === null) return [];
            if (Array.isArray(value)) {
              return value.map((item) => [key, String(item)]);
            }
            return [[key, String(value)]];
          }),
        );

  nextParams.forEach((value, key) => {
    url.searchParams.append(key, value);
  });

  return url;
}

export function resolveUrl(config: NetRequestConfig) {
  const url = config.url ?? "";
  const baseURL = config.baseURL;

  if (!url) throw new Error("Request url is required");
  if (!isAbsoluteUrl(url) && !baseURL) {
    throw new Error(`Cannot request relative url without baseURL: ${url}`);
  }

  return appendParams(
    new URL(isAbsoluteUrl(url) ? url : combineUrls(baseURL!, url)),
    config.params,
  );
}
