import { readCache, writeCache } from "./cache";
import { config } from "./config";
import { distanceInKm } from "./distance";
import type { BusinessHour, CategorySummary, HomeDirectory, ProductSummary, RestaurantSummary, UserLocation } from "../types/domain";

type RestaurantDetail = {
  restaurant: RestaurantSummary;
  businessHours: BusinessHour[];
  catalog: {
    categories: CategorySummary[];
    products: ProductSummary[];
  };
};

const cacheTtlMs = 1000 * 60 * 60 * 6;
const apiTimeoutMs = 20000;
const restaurantDetails = new Map<string, { expiresAt: number; value: RestaurantDetail }>();
const restaurantMemoryTtlMs = 15000;

function apiUrl(path: string) {
  if (!config.apiBaseUrl) throw new Error("api-base-url-required");
  return `${config.apiBaseUrl.replace(/\/$/, "")}${path}`;
}

async function mobileGet<T>(path: string): Promise<T> {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), apiTimeoutMs) : null;

  try {
    const response = await fetch(apiUrl(path), {
      headers: { Accept: "application/json" },
      signal: controller?.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const code = data && typeof data.error === "string" ? data.error : "mobile-data-failed";
      throw new Error(code);
    }
    return data as T;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function normalizeCity(value?: string | null) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function absoluteMediaUrl(value: string) {
  if (!value || !value.startsWith("/")) return value;
  return `${config.apiBaseUrl.replace(/\/$/, "")}${value}`;
}

function withLocation(restaurant: RestaurantSummary, location?: UserLocation): RestaurantSummary {
  const hasCoordinates = restaurant.latitude != null && restaurant.longitude != null;
  return {
    ...restaurant,
    logoUrl: absoluteMediaUrl(restaurant.logoUrl),
    bannerUrl: absoluteMediaUrl(restaurant.bannerUrl),
    distanceKm: location && hasCoordinates
      ? distanceInKm(location, { latitude: Number(restaurant.latitude), longitude: Number(restaurant.longitude) })
      : undefined,
  };
}

function sortRestaurants(restaurants: RestaurantSummary[]) {
  return [...restaurants].sort((first, second) => (first.distanceKm ?? Number.POSITIVE_INFINITY) - (second.distanceKm ?? Number.POSITIVE_INFINITY));
}

function nearestRestaurantCity(restaurants: RestaurantSummary[], location?: UserLocation) {
  if (!location) return "";

  let nearestCity = "";
  let nearestDistance = Number.POSITIVE_INFINITY;
  restaurants.forEach((restaurant) => {
    if (restaurant.latitude == null || restaurant.longitude == null || !restaurant.city) return;
    const distance = distanceInKm(location, {
      latitude: Number(restaurant.latitude),
      longitude: Number(restaurant.longitude),
    });
    if (distance < nearestDistance) {
      nearestCity = restaurant.city;
      nearestDistance = distance;
    }
  });

  return nearestDistance <= 50 ? nearestCity : "";
}

function homeCacheKey(location?: UserLocation) {
  const city = normalizeCity(location?.city) || "all";
  const lat = location?.latitude != null ? location.latitude.toFixed(2) : "na";
  const lng = location?.longitude != null ? location.longitude.toFixed(2) : "na";
  return `home:v3:web-api:${city}:${lat}:${lng}`;
}

export async function listHomeDirectory(location?: UserLocation): Promise<HomeDirectory> {
  const cacheKey = homeCacheKey(location);

  try {
    const remote = await mobileGet<HomeDirectory>("/api/mobile/directory");
    const allRestaurants = remote.restaurants.map((restaurant) => withLocation(restaurant, location));
    const requestedCity = normalizeCity(location?.city);
    const requestedCityRows = requestedCity
      ? allRestaurants.filter((restaurant) => normalizeCity(restaurant.city) === requestedCity)
      : [];
    const activeCity = requestedCity
      ? requestedCityRows[0]?.city || location?.city || ""
      : nearestRestaurantCity(allRestaurants, location);
    const activeCityFilter = normalizeCity(activeCity);
    const visibleRestaurants = location
      ? allRestaurants.filter((restaurant) => normalizeCity(restaurant.city) === activeCityFilter)
      : allRestaurants;
    const visibleIds = new Set(visibleRestaurants.map((restaurant) => restaurant.id));
    const byId = new Map(allRestaurants.map((restaurant) => [restaurant.id, restaurant]));
    const visibleProducts = remote.productSuggestions
      .filter((product) => visibleIds.has(product.restaurantId))
      .map((product) => ({ ...product, imageUrl: absoluteMediaUrl(product.imageUrl) }));
    const visibleRanked = (items: RestaurantSummary[]) => items
      .filter((restaurant) => visibleIds.has(restaurant.id))
      .map((restaurant) => byId.get(restaurant.id) ?? withLocation(restaurant, location));

    const directory: HomeDirectory = {
      activeCity,
      restaurants: sortRestaurants(visibleRestaurants),
      mostVisited: visibleRanked(remote.mostVisited),
      mostOrderedRestaurants: visibleRanked(remote.mostOrderedRestaurants),
      mostOrderedProducts: visibleProducts.filter((product) => product.orderCount > 0).slice(0, 12),
      productSuggestions: visibleProducts,
    };
    await writeCache(cacheKey, directory);
    return directory;
  } catch (error) {
    const cached = await readCache<HomeDirectory>(cacheKey, cacheTtlMs);
    if (cached) return cached;
    throw error;
  }
}

export async function listRestaurants(location?: UserLocation) {
  return (await listHomeDirectory(location)).restaurants;
}

async function getRestaurantDetail(slug: string) {
  const memory = restaurantDetails.get(slug);
  if (memory && memory.expiresAt > Date.now()) return memory.value;

  const cacheKey = `restaurant:v3:web-api:${slug}`;
  try {
    const detail = await mobileGet<RestaurantDetail>(`/api/mobile/restaurants/${encodeURIComponent(slug)}`);
    const normalized: RestaurantDetail = {
      ...detail,
      restaurant: withLocation(detail.restaurant),
      catalog: {
        ...detail.catalog,
        products: detail.catalog.products.map((product) => ({
          ...product,
          imageUrl: absoluteMediaUrl(product.imageUrl),
        })),
      },
    };
    restaurantDetails.set(slug, { expiresAt: Date.now() + restaurantMemoryTtlMs, value: normalized });
    await writeCache(cacheKey, normalized);
    return normalized;
  } catch (error) {
    const cached = await readCache<RestaurantDetail>(cacheKey, cacheTtlMs);
    if (cached) return cached;
    if (error instanceof Error && error.message === "restaurant-not-found") return null;
    throw error;
  }
}

export async function getRestaurantBySlug(slug: string, location?: UserLocation) {
  const detail = await getRestaurantDetail(slug);
  return detail ? withLocation(detail.restaurant, location) : null;
}

export async function listRestaurantBusinessHours(restaurantSlug: string): Promise<BusinessHour[]> {
  return (await getRestaurantDetail(restaurantSlug))?.businessHours ?? [];
}

export async function listRestaurantCatalog(restaurantSlug: string) {
  return (await getRestaurantDetail(restaurantSlug))?.catalog ?? { categories: [], products: [] };
}
