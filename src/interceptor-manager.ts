import type { Interceptor } from "./fetcher.js";

export function createInterceptorManager<T>() {
  let id = 0;
  const handlers = new Map<number, Interceptor<T>>();

  return {
    use(fulfilled?: Interceptor<T>["fulfilled"], rejected?: Interceptor<T>["rejected"]) {
      const nextId = id++;
      handlers.set(nextId, { fulfilled, rejected });
      return nextId;
    },
    eject(handlerId: number) {
      handlers.delete(handlerId);
    },
    clear() {
      handlers.clear();
    },
    async runFulfilled(value: T) {
      let current = value;
      for (const handler of handlers.values()) {
        if (handler.fulfilled) {
          current = await handler.fulfilled(current);
        }
      }
      return current;
    },
    async runRejected(error: unknown): Promise<T> {
      let currentError = error;
      for (const handler of handlers.values()) {
        if (!handler.rejected) continue;
        try {
          return await handler.rejected(currentError);
        } catch (nextError) {
          currentError = nextError;
        }
      }
      throw currentError;
    },
  };
}
