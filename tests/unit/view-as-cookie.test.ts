import { afterEach, describe, expect, it, vi } from 'vitest';

class LocalStorageMock {
  private readonly store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }
}

function createDocumentMock() {
  const cookieStore = new Map<string, string>();
  const documentMock = {};

  Object.defineProperty(documentMock, 'cookie', {
    get() {
      return Array.from(cookieStore.entries())
        .map(([key, value]) => `${key}=${value}`)
        .join('; ');
    },
    set(value: string) {
      const [cookiePart, ...attributes] = value.split(';').map((part) => part.trim());
      const equalsIndex = cookiePart.indexOf('=');
      const name = cookiePart.slice(0, equalsIndex);
      const cookieValue = cookiePart.slice(equalsIndex + 1);
      const shouldDelete = cookieValue === '' || attributes.some((attribute) => attribute.toLowerCase() === 'max-age=0');

      if (shouldDelete) {
        cookieStore.delete(name);
        return;
      }

      cookieStore.set(name, cookieValue);
    },
  });

  return documentMock as Document;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('view-as cookie helpers', () => {
  it('updates cookies, local storage, and dispatches a view-as change event', async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('document', createDocumentMock());
    vi.stubGlobal('localStorage', new LocalStorageMock());
    vi.stubGlobal('window', { dispatchEvent } as unknown as Window);

    const {
      VIEW_AS_CHANGE_EVENT,
      getViewAsSelection,
      setViewAsSelection,
    } = await import('@/lib/utils/view-as-cookie');

    setViewAsSelection({ roleId: 'role-1', teamId: 'team-9' });

    expect(getViewAsSelection()).toEqual({ roleId: 'role-1', teamId: 'team-9' });
    expect(dispatchEvent).toHaveBeenCalled();
    const dispatchedEvent = dispatchEvent.mock.calls[0]![0];
    expect(dispatchedEvent).toBeInstanceOf(Event);
    expect((dispatchedEvent as Event).type).toBe(VIEW_AS_CHANGE_EVENT);
  });
});
