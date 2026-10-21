# electron-fetcher

An axios-like HTTP client for the Electron **main process**, built on [`net.fetch`](https://www.electronjs.org/docs/latest/api/net#netfetchinput-init) so requests go through Chromium's network stack (system proxy, certificates, session).

- `baseURL`, `params`, per-method default headers (`common`, `get`, `post`, …)
- JSON bodies serialized automatically; `responseType`: `json` | `text` | `arraybuffer` | `blob` | `stream`
- Request/response interceptors (`use` / `eject` / `clear`)
- Concurrency limit (default 3) via `p-limit`
- `timeout` and `signal` support
- Opt-in in-memory response cache (1h TTL)
- `NetRequestError` with `status`, `code`, `response`, `config`
- Built-in request/response logging (pass `logger: undefined` to disable)

## Install

```sh
pnpm add electron-fetcher
```

`electron` (>= 25) is a peer dependency.

## Usage

```ts
import { app } from "electron";
import { createNetInstance, isNetRequestError } from "electron-fetcher";

await app.whenReady(); // net.fetch is only usable once the app is ready

const api = createNetInstance({
  baseURL: "https://api.example.com/v1",
  timeout: 10_000,
  headers: { common: { Accept: "application/json" } },
  concurrency: 5,
  logger: console,
});

api.interceptors.request.use((config) => ({
  ...config,
  headers: { ...(config.headers as Record<string, string>), Authorization: `Bearer ${token}` },
}));

try {
  const { data } = await api.request<{ items: string[] }>({
    url: "/items",
    params: { page: 1 },
  });

  // second argument opts into the cache (keyed by method + url)
  const cached = await api.request({ url: "/config" }, true);
} catch (error) {
  if (isNetRequestError(error)) console.error(error.status, error.code);
}
```

Set `validateStatus: null` to resolve for every status code.

## License

MIT
