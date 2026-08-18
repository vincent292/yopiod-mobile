import AsyncStorage from "@react-native-async-storage/async-storage";
import type { GroupSessionStatus } from "./group-orders";

export type SavedGroupSessionRole = "host" | "participant" | "viewer";

export type SavedGroupSession = {
  restaurantSlug: string;
  restaurantName?: string;
  sessionToken: string;
  hostAccessToken?: string;
  participantToken?: string;
  role: SavedGroupSessionRole;
  status?: GroupSessionStatus;
  expiresAt?: string;
  updatedAt: string;
};

const activeGroupSessionKey = "yopido:group-session:active";

function isFinished(status?: GroupSessionStatus) {
  return status === "cancelled" || status === "expired" || status === "submitted";
}

function isExpired(expiresAt?: string) {
  return Boolean(expiresAt && new Date(expiresAt).getTime() <= Date.now());
}

export async function loadSavedGroupSession(): Promise<SavedGroupSession | null> {
  const raw = await AsyncStorage.getItem(activeGroupSessionKey);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<SavedGroupSession>;
    if (!parsed.restaurantSlug || !parsed.sessionToken || isFinished(parsed.status) || isExpired(parsed.expiresAt)) {
      await clearSavedGroupSession();
      return null;
    }

    return {
      restaurantSlug: parsed.restaurantSlug,
      restaurantName: parsed.restaurantName,
      sessionToken: parsed.sessionToken,
      hostAccessToken: parsed.hostAccessToken,
      participantToken: parsed.participantToken,
      role: parsed.role ?? "viewer",
      status: parsed.status,
      expiresAt: parsed.expiresAt,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    await clearSavedGroupSession();
    return null;
  }
}

export async function saveSavedGroupSession(session: Omit<SavedGroupSession, "updatedAt"> & { updatedAt?: string }) {
  const nextSession: SavedGroupSession = {
    ...session,
    updatedAt: session.updatedAt ?? new Date().toISOString(),
  };
  await AsyncStorage.setItem(activeGroupSessionKey, JSON.stringify(nextSession));
  return nextSession;
}

export async function clearSavedGroupSession(sessionToken?: string) {
  if (sessionToken) {
    const current = await loadSavedGroupSession();
    if (current && current.sessionToken !== sessionToken) return;
  }
  await AsyncStorage.removeItem(activeGroupSessionKey);
}
