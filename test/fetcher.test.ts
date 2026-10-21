import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  net: { fetch: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>() },
}));
vi.mock("electron", () => electron);

const { createNetInstance, isNetRequestError } = await import("../src/index.js");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("createNetInstance", () => {
  beforeEach(() => {
    electron.net.fetch.mockReset();
  });

  it("resolves baseURL + params, merges headers and serializes JSON bodies", async () => {
    electron.net.fetch.mockResolvedValue(json({ ok: true }));
    const net = createNetInstance({
      baseURL: "https://api.test/v1/",
      headers: { common: { "x-app": "a" }, post: { "x-post": "p" } },
      logger: undefined,
    });

    const res = await net.request({
      url: "/items",
      method: "post",
      params: { q: "x", tag: ["a", "b"], skip: undefined },
      data: { name: "n" },
    });

    expect(res.data).toEqual({ ok: true });
    const [url, init] = electron.net.fetch.mock.calls[0]!;
    expect(url).toBe("https://api.test/v1/items?q=x&tag=a&tag=b");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"name":"n"}');
    expect(init?.headers).toMatchObject({
      "x-app": "a",
      "x-post": "p",
      "Content-Type": "application/json",
    });
  });

  it("rejects non-2xx with a NetRequestError carrying the response", async () => {
    electron.net.fetch.mockResolvedValue(json({ err: 1 }, 404));
    const net = createNetInstance({ baseURL: "https://api.test", logger: undefined });

    const error = await net.request({ url: "/missing" }).catch((e: unknown) => e);
    expect(isNetRequestError(error)).toBe(true);
    expect(error).toMatchObject({ status: 404, response: { data: { err: 1 } } });
  });

  it("wraps network failures and accepts any status when validateStatus is null", async () => {
    electron.net.fetch.mockRejectedValueOnce(new TypeError("boom"));
    const net = createNetInstance({ baseURL: "https://api.test", logger: undefined });
    await expect(net.request({ url: "/x" })).rejects.toMatchObject({
      name: "NetRequestError",
      code: "TypeError",
      message: "boom",
    });

    electron.net.fetch.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    const res = await net.request({ url: "/x", validateStatus: null });
    expect(res).toMatchObject({ status: 500, data: "nope" });
  });

  it("serves cached data only when the caller opts in", async () => {
    electron.net.fetch.mockImplementation(async () => json({ n: 1 }));
    const net = createNetInstance({ baseURL: "https://api.test", logger: undefined });

    await net.request({ url: "/c" }, true);
    const cached = await net.request({ url: "/c" }, true);
    expect(cached.data).toEqual({ n: 1 });
    expect(electron.net.fetch).toHaveBeenCalledTimes(1);

    await net.request({ url: "/c" });
    expect(electron.net.fetch).toHaveBeenCalledTimes(2);
  });

  it("runs request and response interceptors, and logs through the logger", async () => {
    electron.net.fetch.mockResolvedValue(json({ v: 1 }));
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() };
    const net = createNetInstance({ baseURL: "https://api.test", logger });
    net.interceptors.request.use((config) => ({ ...config, headers: { auth: "t" } }));
    net.interceptors.response.use((response) => ({ ...response, data: "changed" }));

    const res = await net.request({ url: "/i" });
    expect(res.data).toBe("changed");
    expect(electron.net.fetch.mock.calls[0]![1]?.headers).toMatchObject({ auth: "t" });
    expect(logger.debug).toHaveBeenCalledWith(
      "request",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("refuses relative urls without a baseURL", async () => {
    const net = createNetInstance({ logger: undefined });
    await expect(net.request({ url: "/x" })).rejects.toThrow(/without baseURL/);
  });
});

describe("timeouts and response types", () => {
  beforeEach(() => {
    electron.net.fetch.mockReset();
  });

  it("aborts the request when the timeout elapses", async () => {
    electron.net.fetch.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          ),
        ),
    );
    const net = createNetInstance({ baseURL: "https://api.test", timeout: 10, logger: undefined });
    await expect(net.request({ url: "/slow" })).rejects.toMatchObject({ code: "AbortError" });
  });

  it("honours responseType", async () => {
    const net = createNetInstance({ baseURL: "https://api.test", logger: undefined });
    electron.net.fetch.mockResolvedValueOnce(json({ a: 1 }));
    expect((await net.request({ url: "/t", responseType: "text" })).data).toBe('{"a":1}');
    electron.net.fetch.mockResolvedValueOnce(new Response("ab"));
    const buf = (await net.request({ url: "/b", responseType: "arraybuffer" })).data;
    expect(buf).toBeInstanceOf(ArrayBuffer);
  });
});
