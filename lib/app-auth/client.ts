'use client';

const AUTH_EVENT_STORAGE_KEY = 'avs_auth_event_v1';
const LEGACY_SHORTCUT_STORAGE_KEY = 'account_switch_shortcuts_v1';
const LEGACY_TRANSITION_STORAGE_KEY = 'account_switch_transition_until';
const AUTH_CHANNEL_NAME = 'avs-auth-session';

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

export function clearRetiredAccountSwitchClientState(): void {
  if (!isBrowser()) {
    return;
  }

  localStorage.removeItem(LEGACY_SHORTCUT_STORAGE_KEY);
  localStorage.removeItem(LEGACY_TRANSITION_STORAGE_KEY);
}

export function broadcastAuthStateChange(eventName: string): void {
  if (!isBrowser()) {
    return;
  }

  const payload = JSON.stringify({
    event: eventName,
    at: Date.now(),
  });

  localStorage.setItem(AUTH_EVENT_STORAGE_KEY, payload);

  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
    channel.postMessage(payload);
    channel.close();
  }
}

export function subscribeToAuthStateChange(callback: () => void): () => void {
  if (!isBrowser()) {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === AUTH_EVENT_STORAGE_KEY) {
      callback();
    }
  };

  window.addEventListener('storage', handleStorage);

  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
    channel.addEventListener('message', callback);
  }

  return () => {
    window.removeEventListener('storage', handleStorage);
    channel?.close();
  };
}
