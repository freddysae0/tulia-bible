import { create } from 'zustand';
import {
  isSupported,
  getPermission,
  requestAndRegister,
  unregister,
  onForegroundMessage,
  listenForTokenRefresh,
  getStoredToken,
  detectPlatform,
} from '@/lib/push';
import { api } from '@/lib/api';
import { useUIStore } from './useUIStore';
import { handleStudyInvitation } from '@/components/study/InvitationToast';

export interface PushPreferences {
  chat_message: boolean;
  note_reply: boolean;
  note_like: boolean;
  friend_request: boolean;
  friend_accepted: boolean;
  activity_in_chapter: boolean;
}

interface PushState {
  isSupported: boolean;
  permission: NotificationPermission;
  token: string | null;
  isRequesting: boolean;
  preferences: PushPreferences;
  preferencesLoaded: boolean;

  checkSupport: () => void;
  requestPermission: () => Promise<{ ok: boolean; reason?: string }>;
  disablePush: () => Promise<void>;
  loadPreferences: () => Promise<void>;
  updatePreferences: (prefs: Partial<PushPreferences>) => Promise<void>;
}

export const usePushStore = create<PushState>((set, get) => ({
  isSupported: false,
  permission: 'default',
  token: getStoredToken(),
  isRequesting: false,
  preferences: {
    chat_message: true,
    note_reply: true,
    note_like: true,
    friend_request: true,
    friend_accepted: true,
    activity_in_chapter: true,
  },
  preferencesLoaded: false,

  checkSupport: () => {
    const supported = isSupported();
    set({
      isSupported: supported,
      permission: supported ? getPermission() : 'denied',
      token: getStoredToken(),
    });
  },

  requestPermission: async () => {
    if (get().isRequesting) return { ok: false, reason: 'busy' };
    set({ isRequesting: true });
    try {
      const result = await requestAndRegister();
      if (result.ok) {
        set({ token: result.token, permission: 'granted', isRequesting: false });
        return { ok: true };
      }
      set({
        isRequesting: false,
        permission: result.reason === 'permission-denied' ? 'denied' : get().permission,
      });
      return { ok: false, reason: result.reason };
    } catch {
      set({ isRequesting: false });
      return { ok: false, reason: 'unknown' };
    }
  },

  disablePush: async () => {
    await unregister();
    set({ token: null, permission: 'denied' });
  },

  loadPreferences: async () => {
    try {
      const prefs = await api.get<PushPreferences>('/api/push/preferences');
      set({ preferences: prefs, preferencesLoaded: true });
    } catch {
      set({ preferencesLoaded: true });
    }
  },

  updatePreferences: async (partial) => {
    const current = get().preferences;
    const updated = { ...current, ...partial };
    set({ preferences: updated });
    try {
      const prefs = await api.patch<PushPreferences>('/api/push/preferences', partial);
      set({ preferences: prefs });
    } catch {
      set({ preferences: current });
    }
  },
}));

export function initPushForegroundListener(): () => void {
  const platform = detectPlatform();

  const unsub = onForegroundMessage(async (payload) => {
    if (handleStudyInvitation(payload)) return;

    const title: string = payload.notification?.title || payload.data?.title || 'Tulia';
    const body: string = payload.notification?.body || payload.data?.body || '';

    if (platform === 'desktop') {
      try {
        const { sendNotification, isPermissionGranted, requestPermission } = await import(
          '@tauri-apps/plugin-notification'
        );

        let permitted = await isPermissionGranted();
        if (!permitted) {
          const result = await requestPermission();
          permitted = result === 'granted';
        }

        if (permitted) {
          sendNotification({ title, body });
        }
      } catch {
        useUIStore.getState().addToast(`${title}: ${body}`, 'info', { duration: 5000 });
      }
    } else {
      useUIStore.getState().addToast(`${title}: ${body}`, 'info', { duration: 5000 });
    }
  });

  listenForTokenRefresh();

  return unsub;
}
