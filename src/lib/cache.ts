import AsyncStorage from "@react-native-async-storage/async-storage";

type CacheEnvelope<T> = {
  savedAt: number;
  value: T;
};

const prefix = "yopido.cache.";

export async function readCache<T>(key: string, maxAgeMs?: number): Promise<T | null> {
  const envelope = await readCacheEnvelope<T>(key, maxAgeMs);
  return envelope?.value ?? null;
}

export async function readCacheEnvelope<T>(key: string, maxAgeMs?: number): Promise<CacheEnvelope<T> | null> {
  const raw = await AsyncStorage.getItem(`${prefix}${key}`);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (maxAgeMs && Date.now() - parsed.savedAt > maxAgeMs) return null;
    return parsed;
  } catch {
    await AsyncStorage.removeItem(`${prefix}${key}`);
    return null;
  }
}

export async function writeCache<T>(key: string, value: T) {
  const envelope: CacheEnvelope<T> = {
    savedAt: Date.now(),
    value,
  };
  await AsyncStorage.setItem(`${prefix}${key}`, JSON.stringify(envelope));
}

export async function clearCache(key: string) {
  await AsyncStorage.removeItem(`${prefix}${key}`);
}
