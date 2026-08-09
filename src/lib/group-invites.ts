import { config } from "./config";

export type GroupInviteTarget = { restaurantSlug?: string; sessionToken: string };

export function groupInviteUrl(restaurantSlug: string, sessionToken: string) {
  return `${config.apiBaseUrl.replace(/\/$/, "")}/r/${restaurantSlug}/grupo/${sessionToken}`;
}

export function parseGroupInvite(value: string): GroupInviteTarget | null {
  const clean = value.trim();
  if (!clean) return null;

  try {
    const url = new URL(clean);
    const segments = url.pathname.split("/").filter(Boolean);
    const groupIndex = segments.findIndex((segment) => segment === "grupo");
    if (groupIndex >= 0 && segments[groupIndex + 1]) {
      const restaurantSlug = segments[groupIndex - 1] && segments[groupIndex - 2] === "r" ? segments[groupIndex - 1] : undefined;
      return { restaurantSlug, sessionToken: decodeURIComponent(segments[groupIndex + 1]) };
    }

    const queryToken = url.searchParams.get("sessionToken") || url.searchParams.get("session") || url.searchParams.get("token");
    if (queryToken) {
      return { restaurantSlug: url.searchParams.get("restaurantSlug") || undefined, sessionToken: queryToken };
    }
  } catch {
    // Plain session codes are supported when scanning from a restaurant.
  }

  if (/^[A-Za-z0-9_-]{4,64}$/.test(clean)) return { sessionToken: clean };
  return null;
}
