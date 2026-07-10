import { vi, type Mock } from 'vitest';

export type SupabaseQueryMock<T> = Promise<T> & Record<string, Mock>;

export function createSupabaseQueryMock<T>(
  result: T | (() => T | Promise<T>),
  chainMethods: readonly string[]
): SupabaseQueryMock<T> {
  const query = new Promise<T>((resolve, reject) => {
    queueMicrotask(() => {
      try {
        const resolved = typeof result === 'function' ? (result as () => T | Promise<T>)() : result;
        Promise.resolve(resolved).then(resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  }) as unknown as SupabaseQueryMock<T>;

  chainMethods.forEach((method) => {
    query[method] = vi.fn(() => query);
  });

  return query;
}
