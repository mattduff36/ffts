import { afterEach, describe, expect, it, vi } from 'vitest';

const AUTH_EVENT_STORAGE_KEY = 'avs_auth_event_v1';

type EventHandler = (event: Event) => void;

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

class WindowMock {
  private readonly listeners = new Map<string, Set<EventHandler>>();

  addEventListener(type: string, listener: EventHandler): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: EventHandler): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    const listeners = this.listeners.get(event.type);
    if (!listeners || listeners.size === 0) {
      return true;
    }

    for (const listener of listeners) {
      listener(event);
    }
    return true;
  }
}

class BroadcastChannelMock {
  static channels = new Map<string, Set<BroadcastChannelMock>>();

  readonly name: string;
  private readonly listeners = new Set<(event: MessageEvent) => void>();

  constructor(name: string) {
    this.name = name;
    if (!BroadcastChannelMock.channels.has(name)) {
      BroadcastChannelMock.channels.set(name, new Set());
    }
    BroadcastChannelMock.channels.get(name)!.add(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    if (type === 'message') {
      this.listeners.add(listener);
    }
  }

  postMessage(data: unknown): void {
    const members = BroadcastChannelMock.channels.get(this.name);
    if (!members) return;
    for (const member of members) {
      if (member === this) continue;
      for (const listener of member.listeners) {
        listener({ data } as MessageEvent);
      }
    }
  }

  close(): void {
    BroadcastChannelMock.channels.get(this.name)?.delete(this);
  }
}

afterEach(() => {
  BroadcastChannelMock.channels.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('auth client event bus', () => {
  it('broadcastAuthStateChange writes event payload and posts channel message', async () => {
    const windowMock = new WindowMock();
    const localStorageMock = new LocalStorageMock();

    vi.stubGlobal('window', windowMock);
    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubGlobal('BroadcastChannel', BroadcastChannelMock);

    const { broadcastAuthStateChange } = await import('@/lib/app-auth/client');
    broadcastAuthStateChange('signed_in');

    const payload = localStorageMock.getItem(AUTH_EVENT_STORAGE_KEY);
    expect(payload).toBeTruthy();
    const parsed = JSON.parse(payload ?? '{}') as { event?: string };
    expect(parsed.event).toBe('signed_in');
  });

  it('subscribeToAuthStateChange reacts to storage and broadcast events', async () => {
    const windowMock = new WindowMock();
    const localStorageMock = new LocalStorageMock();
    const callback = vi.fn();

    vi.stubGlobal('window', windowMock);
    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubGlobal('BroadcastChannel', BroadcastChannelMock);

    const { subscribeToAuthStateChange } = await import('@/lib/app-auth/client');
    const unsubscribe = subscribeToAuthStateChange(callback);

    const storageEvent = new Event('storage') as Event & { key?: string };
    storageEvent.key = AUTH_EVENT_STORAGE_KEY;
    windowMock.dispatchEvent(storageEvent);

    const externalChannel = new BroadcastChannelMock('avs-auth-session');
    externalChannel.postMessage(JSON.stringify({ event: 'signed_in', at: Date.now() }));

    unsubscribe();
    externalChannel.close();

    expect(callback).toHaveBeenCalled();
    expect(callback.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
