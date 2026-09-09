export const QUICK_ADD_TIMEOUT_MS = 25_000;

export async function withBoundedTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new TypeError(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function shouldRollbackOptimisticQuickAdd(error: unknown): boolean {
  return !(
    error instanceof TypeError
    || (typeof error === 'object'
      && error !== null
      && 'status' in error
      && typeof (error as { status?: unknown }).status === 'number'
      && ((error as { status: number }).status >= 500))
  );
}
