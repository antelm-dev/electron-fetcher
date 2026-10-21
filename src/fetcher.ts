import { net } from "electron";
import pLimit from "p-limit";
import NodeCache from "node-cache";
import type { LoggerLike } from "./log-interceptor.js";
import { createLoggingInterceptors } from "./log-interceptor.js";
import { createInterceptorManager } from "./interceptor-manager.js";
import { resolveUrl } from "./net-url.js";
import {
  headersToRecord,
  createDefaultHeaders,
  getMergedHeaders,
  getMethod,
} from "./net-headers.js";
import {
  serializeBody,
  parseResponseData,
  createNetResponse,
  createAbortSignal,
  getCacheKey,
} from "./net-helpers.js";

export type HeaderValue = string | number | boolean | string[] | null | undefined;
type HeaderRecord = Record<string, HeaderValue>;
export type MethodHeaderKey =
  | "common"
  | "delete"
  | "get"
  | "head"
  | "post"
  | "put"
  | "patch"
  | "options";
type HeaderBag = Headers | HeadersInit | HeaderRecord;
type HeaderDefaults = Partial<Record<MethodHeaderKey, HeaderBag>>;
export type NormalizedHeaders = Record<MethodHeaderKey, Record<string, string>>;

export type NetHeaders = HeaderBag | HeaderDefaults;

export type NetResponseType = "arraybuffer" | "blob" | "json" | "stream" | "text";

export type NetRequestConfig = {
  baseURL?: string;
  data?: unknown;
  headers?: NetHeaders;
  method?: string;
  params?: URLSearchParams | Record<string, unknown>;
  responseType?: NetResponseType;
  signal?: AbortSignal;
  timeout?: number;
  url?: string;
  validateStatus?: ((status: number) => boolean) | null;
  __log?: { id: string };
  [key: string]: unknown;
};

export type NetResponse<T = unknown> = {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  config: NetRequestConfig;
  request: NetRequestConfig;
};

export type Interceptor<T> = {
  fulfilled?: (value: T) => T | Promise<T>;
  rejected?: (error: unknown) => T | Promise<T> | Promise<never>;
};

export type CreateNetDefaults = Omit<
  NetRequestConfig,
  "data" | "params" | "signal" | "url" | "__log"
> & {
  concurrency?: number;
  logger?: LoggerLike;
};

type NetDefaults = Omit<CreateNetDefaults, "concurrency" | "headers" | "logger"> & {
  headers: NormalizedHeaders;
};

export class NetRequestError<T = unknown> extends Error {
  readonly isNetRequestError = true;
  readonly config: NetRequestConfig;
  readonly request: NetRequestConfig;
  readonly response?: NetResponse<T>;
  readonly code?: string;
  readonly status?: number;

  constructor(
    message: string,
    config: NetRequestConfig,
    options: {
      code?: string;
      response?: NetResponse<T>;
    } = {},
  ) {
    super(message);
    this.name = "NetRequestError";
    this.config = config;
    this.request = config;
    this.response = options.response;
    this.code = options.code;
    this.status = options.response?.status;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      status: this.status,
    };
  }
}

export function isNetRequestError(error: unknown): error is NetRequestError {
  return (
    error instanceof NetRequestError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { isNetRequestError?: unknown }).isNetRequestError === true)
  );
}

export const createNetInstance = (
  options: CreateNetDefaults & {
    interceptors?: ReturnType<
      typeof createLoggingInterceptors<NetRequestConfig, NetResponse<unknown>, NetRequestError>
    >[];
  },
) => {
  const { concurrency = 3, interceptors = [], logger = console, ...opts } = options;
  const limit = pLimit(concurrency);
  const requestInterceptors = createInterceptorManager<NetRequestConfig>();
  const responseInterceptors = createInterceptorManager<NetResponse<unknown>>();

  const defaults = {
    ...opts,
    headers: createDefaultHeaders(opts.headers),
  } as NetDefaults;

  if (logger) {
    interceptors.push(createLoggingInterceptors({ logger }));
  }

  interceptors.forEach((interceptor) => {
    requestInterceptors.use(interceptor.request);
    responseInterceptors.use(
      interceptor.response,
      interceptor.responseError as (error: unknown) => Promise<never>,
    );
  });

  const cache = new NodeCache({
    stdTTL: 60 * 60,
    deleteOnExpire: true,
    useClones: false,
  });

  const dispatch = async (config: NetRequestConfig): Promise<NetResponse<unknown>> => {
    const url = resolveUrl(config);
    const headers = getMergedHeaders(defaults.headers, config);
    const body = serializeBody(config, headers);
    const { signal, cleanup } = createAbortSignal(config);

    try {
      const response = await net.fetch(url.toString(), {
        method: getMethod(config),
        headers,
        body,
        signal,
      });
      const data = await parseResponseData(response, config);
      const netResponse = createNetResponse(config, data, response);
      const validateStatus =
        config.validateStatus === null
          ? () => true
          : (config.validateStatus ?? ((status: number) => status >= 200 && status < 300));

      if (!validateStatus(netResponse.status)) {
        throw new NetRequestError(`Request failed with status code ${netResponse.status}`, config, {
          response: netResponse,
        });
      }

      return netResponse;
    } catch (error) {
      if (error instanceof NetRequestError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof Error && "name" in error ? String(error.name) : "ERR_NETWORK";
      throw new NetRequestError(message, config, { code });
    } finally {
      cleanup();
    }
  };

  const request = async <T = unknown>(
    config: NetRequestConfig,
    allowCache = false,
  ): Promise<NetResponse<T>> => {
    const mergedConfig = {
      ...defaults,
      ...config,
      headers: {
        ...headersToRecord(defaults.headers.common),
        ...headersToRecord(config.headers),
      },
    } as NetRequestConfig;

    const interceptedConfig = await requestInterceptors.runFulfilled(mergedConfig);
    const cacheKey = getCacheKey(interceptedConfig);
    const cachedData = cache.get<T>(cacheKey);

    if (cachedData !== undefined && allowCache) {
      const cachedResponse = createNetResponse(interceptedConfig, cachedData, {
        status: 200,
        statusText: "OK",
        headers: new Headers(),
      });
      return (await responseInterceptors.runFulfilled(cachedResponse)) as NetResponse<T>;
    }

    try {
      const response = (await limit(() => dispatch(interceptedConfig))) as NetResponse<T>;
      const interceptedResponse = (await responseInterceptors.runFulfilled(
        response,
      )) as NetResponse<T>;

      if (allowCache) cache.set(cacheKey, interceptedResponse.data);
      else cache.del(cacheKey);

      return interceptedResponse;
    } catch (error) {
      return (await responseInterceptors.runRejected(error)) as NetResponse<T>;
    }
  };

  return {
    defaults,
    interceptors: {
      request: requestInterceptors,
      response: responseInterceptors,
    },
    request,
  };
};
