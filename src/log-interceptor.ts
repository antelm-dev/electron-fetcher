export type LoggerLike = Pick<Console, "debug" | "info" | "warn" | "error" | "log">;

export interface HttpRequestLike {
  method?: string;
  url?: string;
  baseURL?: string;
  [key: string]: unknown;
}

export interface HttpResponseLike<TRequest extends object = HttpRequestLike> {
  status?: number;
  request?: TRequest;
  [key: string]: unknown;
}

export interface HttpErrorLike<TRequest extends object = HttpRequestLike> extends Error {
  code?: string;
  status?: number;
  request?: TRequest;
  response?: {
    status?: number;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface CreateLoggingInterceptorsOptions<TRequest extends object, TResponse, TError> {
  logger?: LoggerLike;
  getMethod?: (request: TRequest) => string;
  getUrl?: (request: TRequest) => string;
  getRequestFromResponse?: (response: TResponse) => TRequest | undefined;
  getRequestFromError?: (error: TError) => TRequest | undefined;
  getStatusFromResponse?: (response: TResponse) => number | undefined;
  getStatusFromError?: (error: TError) => number | undefined;
  getErrorMessage?: (error: TError) => string | undefined;
  getErrorCode?: (error: TError) => string | undefined;
}

type PendingRequest = {
  id: string;
  start: number;
  method: string;
  url: string;
};

function defaultGetMethod<TRequest extends object>(request: TRequest): string {
  const method = (request as HttpRequestLike).method;
  return typeof method === "string" && method.length > 0 ? method.toUpperCase() : "GET";
}

function defaultGetUrl<TRequest extends object>(request: TRequest): string {
  const { url = "", baseURL } = request as HttpRequestLike;

  if (
    typeof url !== "string" ||
    url.length === 0 ||
    typeof baseURL !== "string" ||
    baseURL.length === 0 ||
    /^https?:\/\//i.test(url)
  ) {
    return typeof url === "string" ? url : "";
  }

  return `${baseURL.replace(/\/$/, "")}/${url.replace(/^\//, "")}`;
}

function defaultGetRequestFromResponse<TRequest extends object, TResponse>(
  response: TResponse,
): TRequest | undefined {
  return (response as HttpResponseLike<TRequest>).request;
}

function defaultGetRequestFromError<TRequest extends object, TError>(
  error: TError,
): TRequest | undefined {
  return (error as HttpErrorLike<TRequest>).request;
}

function defaultGetStatusFromResponse<TResponse>(response: TResponse) {
  return (response as HttpResponseLike).status;
}

function defaultGetStatusFromError<TError>(error: TError) {
  const e = error as HttpErrorLike;
  return e.response?.status ?? e.status;
}

function defaultGetErrorMessage<TError>(error: TError) {
  return error instanceof Error ? error.message : undefined;
}

function defaultGetErrorCode<TError>(error: TError) {
  return (error as HttpErrorLike).code;
}

export function createLoggingInterceptors<
  TRequest extends object,
  TResponse = HttpResponseLike<TRequest>,
  TError = HttpErrorLike<TRequest>,
>({
  logger = console,
  getMethod = defaultGetMethod,
  getUrl = defaultGetUrl,
  getRequestFromResponse = defaultGetRequestFromResponse,
  getRequestFromError = defaultGetRequestFromError,
  getStatusFromResponse = defaultGetStatusFromResponse,
  getStatusFromError = defaultGetStatusFromError,
  getErrorMessage = defaultGetErrorMessage,
  getErrorCode = defaultGetErrorCode,
}: CreateLoggingInterceptorsOptions<TRequest, TResponse, TError> = {}) {
  const requests = new Map<string, PendingRequest>();
  const requestIds = new WeakMap<TRequest, string>();

  let i = 0;
  const nextId = () => `${Date.now()}-${++i}`;

  return {
    request(request: TRequest): TRequest {
      const id = nextId();
      const method = getMethod(request);
      const url = getUrl(request);

      requestIds.set(request, id);
      requests.set(id, {
        id,
        start: Date.now(),
        method,
        url,
      });

      logger.debug("request", { id, method, url });

      return request;
    },

    response(response: TResponse): TResponse {
      const request = getRequestFromResponse(response);
      const id = request ? requestIds.get(request) : undefined;
      const meta = id ? requests.get(id) : undefined;

      if (request) {
        requestIds.delete(request);
      }

      if (id) {
        requests.delete(id);
      }

      const status = getStatusFromResponse(response);
      const method = meta?.method ?? (request ? getMethod(request) : "GET");
      const url = meta?.url ?? (request ? getUrl(request) : "");
      const duration = meta ? Date.now() - meta.start : undefined;

      logger.debug("response", {
        id,
        status,
        method,
        url,
        duration,
      });

      return response;
    },

    responseError(error: TError): Promise<never> {
      const request = getRequestFromError(error);
      const id = request ? requestIds.get(request) : undefined;
      const meta = id ? requests.get(id) : undefined;

      if (request) {
        requestIds.delete(request);
      }

      if (id) {
        requests.delete(id);
      }

      const status = getStatusFromError(error);
      const method = meta?.method ?? (request ? getMethod(request) : "GET");
      const url = meta?.url ?? (request ? getUrl(request) : "");
      const duration = meta ? Date.now() - meta.start : undefined;

      logger.warn("error", {
        id,
        status,
        method,
        url,
        duration,
        message: getErrorMessage(error),
        code: getErrorCode(error),
      });

      return Promise.reject(error);
    },
  };
}
