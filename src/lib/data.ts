import { distanceInKm } from "./distance";
import { readCache, writeCache } from "./cache";
import { supabase } from "./supabase";
import type { BusinessHour, CategorySummary, HomeDirectory, PopularProductSummary, ProductOptionGroupSummary, ProductSummary, ProductVariantSummary, RestaurantSummary, UserLocation } from "../types/domain";

type RestaurantRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  city: string | null;
  address: string | null;
  business_type: string | null;
  logo_url: string | null;
  banner_url: string | null;
  latitude: number | null;
  longitude: number | null;
};

type CategoryRow = {
  id: string;
  name: string;
  description: string | null;
};

type ProductRow = {
  id: string;
  restaurant_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  is_featured: boolean | null;
  sort_order: number | null;
  order_count: number | null;
};

type VariantRow = {
  id: string;
  product_id: string;
  name: string;
  description: string | null;
  price_delta: number;
  sort_order: number | null;
};

type OptionGroupRow = {
  id: string;
  product_id: string;
  name: string;
  description: string | null;
  min_choices: number;
  max_choices: number;
  is_required: boolean;
  sort_order: number | null;
};

type OptionRow = {
  id: string;
  product_id: string;
  option_group_id: string;
  name: string;
  description: string | null;
  price_delta: number;
  sort_order: number | null;
};

type BusinessHourRow = {
  day_of_week: number;
  opens_at: string | null;
  closes_at: string | null;
  is_closed: boolean | null;
};

type CountRow = {
  restaurant_id: string;
};

type RestaurantMetrics = {
  visits7d?: number;
  orders30d?: number;
  popularProducts?: string[];
};

function daysAgoIso(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function countByRestaurant(rows: CountRow[]) {
  const counts = new Map<string, number>();
  rows.forEach((row) => counts.set(row.restaurant_id, (counts.get(row.restaurant_id) ?? 0) + 1));
  return counts;
}

function mapRestaurant(row: RestaurantRow, location?: UserLocation, metrics: RestaurantMetrics = {}): RestaurantSummary {
  const hasCoordinates = row.latitude !== null && row.longitude !== null;
  const distanceKm = location && hasCoordinates ? distanceInKm(location, { latitude: Number(row.latitude), longitude: Number(row.longitude) }) : undefined;

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? "Pide tus favoritos en minutos.",
    city: row.city ?? "",
    address: row.address ?? "",
    businessType: row.business_type ?? "food",
    logoUrl: row.logo_url ?? initials(row.name),
    bannerUrl: row.banner_url ?? "",
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
    distanceKm,
    visits7d: metrics.visits7d ?? 0,
    orders30d: metrics.orders30d ?? 0,
    popularProducts: metrics.popularProducts ?? [],
  };
}

function emptyDirectory(): HomeDirectory {
  return {
    activeCity: "",
    restaurants: [],
    mostVisited: [],
    mostOrderedRestaurants: [],
    mostOrderedProducts: [],
    productSuggestions: [],
  };
}

function sortRestaurants(restaurants: RestaurantSummary[]) {
  return [...restaurants].sort((first, second) => (first.distanceKm ?? Number.POSITIVE_INFINITY) - (second.distanceKm ?? Number.POSITIVE_INFINITY));
}

function normalizeCity(value?: string | null) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function nearestRestaurantCity(rows: RestaurantRow[], location?: UserLocation) {
  if (!location) return "";

  let nearestCity = "";
  let nearestDistance = Number.POSITIVE_INFINITY;

  rows.forEach((restaurant) => {
    if (restaurant.latitude === null || restaurant.longitude === null || !restaurant.city) return;
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

const cacheTtlMs = 1000 * 60 * 60 * 6;

function homeCacheKey(location?: UserLocation) {
  const city = normalizeCity(location?.city) || "all";
  const lat = location?.latitude != null ? location.latitude.toFixed(2) : "na";
  const lng = location?.longitude != null ? location.longitude.toFixed(2) : "na";
  return `home:v2:${city}:${lat}:${lng}`;
}

export async function listHomeDirectory(location?: UserLocation): Promise<HomeDirectory> {
  const cacheKey = homeCacheKey(location);

  try {
    const { data, error } = await supabase
      .from("restaurants")
      .select("id,name,slug,description,city,address,business_type,logo_url,banner_url,latitude,longitude")
      .eq("status", "active")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    const restaurantRows = (data ?? []) as RestaurantRow[];
    const restaurantIds = restaurantRows.map((restaurant) => restaurant.id);
    if (!restaurantIds.length) {
      const empty = emptyDirectory();
      await writeCache(cacheKey, empty);
      return empty;
    }

    const since7d = daysAgoIso(7);
    const since30d = daysAgoIso(30);
    const [productsResult, ordersResult, visitsResult] = await Promise.all([
      supabase
        .from("products")
        .select("id,restaurant_id,category_id,name,description,price,image_url,is_featured,sort_order,order_count")
        .in("restaurant_id", restaurantIds)
        .eq("is_available", true),
      supabase.from("orders").select("restaurant_id").in("restaurant_id", restaurantIds).gte("created_at", since30d),
      supabase.from("restaurant_public_visits").select("restaurant_id").in("restaurant_id", restaurantIds).gte("visited_at", since7d),
    ]);

    const products = productsResult.error ? [] : ((productsResult.data ?? []) as ProductRow[]);
    const ordersCount = ordersResult.error ? new Map<string, number>() : countByRestaurant((ordersResult.data ?? []) as CountRow[]);
    const visitsCount = visitsResult.error ? new Map<string, number>() : countByRestaurant((visitsResult.data ?? []) as CountRow[]);
    const productsByRestaurant = new Map<string, ProductRow[]>();
    const restaurantById = new Map(restaurantRows.map((restaurant) => [restaurant.id, restaurant]));

    products.forEach((product) => {
      const current = productsByRestaurant.get(product.restaurant_id) ?? [];
      current.push(product);
      productsByRestaurant.set(product.restaurant_id, current);
    });

    const requestedCity = normalizeCity(location?.city);
    const requestedCityRows = requestedCity
      ? restaurantRows.filter((restaurant) => normalizeCity(restaurant.city) === requestedCity)
      : [];
    const activeCity = requestedCity
      ? requestedCityRows[0]?.city || location?.city || ""
      : nearestRestaurantCity(restaurantRows, location);
    const activeCityFilter = normalizeCity(activeCity);
    const visibleRestaurantRows = location
      ? restaurantRows.filter((restaurant) => normalizeCity(restaurant.city) === activeCityFilter)
      : restaurantRows;
    const visibleRestaurantIds = new Set(visibleRestaurantRows.map((restaurant) => restaurant.id));
    const visibleProducts = products.filter((product) => visibleRestaurantIds.has(product.restaurant_id));

    const restaurants = sortRestaurants(
      visibleRestaurantRows.map((restaurant) => {
        const restaurantProducts = [...(productsByRestaurant.get(restaurant.id) ?? [])].sort((first, second) => Number(second.order_count ?? 0) - Number(first.order_count ?? 0));
        return mapRestaurant(restaurant, location, {
          orders30d: ordersCount.get(restaurant.id) ?? 0,
          visits7d: visitsCount.get(restaurant.id) ?? 0,
          popularProducts: restaurantProducts.slice(0, 3).map((product) => product.name),
        });
      }),
    );

    const productSuggestions = [...visibleProducts]
      .sort((first, second) => Number(second.order_count ?? 0) - Number(first.order_count ?? 0))
      .slice(0, 40)
      .map<PopularProductSummary | null>((product) => {
        const restaurant = restaurantById.get(product.restaurant_id);
        if (!restaurant) return null;
        return {
          id: product.id,
          restaurantId: restaurant.id,
          restaurantName: restaurant.name,
          restaurantSlug: restaurant.slug,
          name: product.name,
          description: product.description ?? "",
          price: Number(product.price),
          imageUrl: product.image_url ?? "",
          orderCount: Number(product.order_count ?? 0),
        };
      })
      .filter((product): product is PopularProductSummary => Boolean(product));

    const directory = {
      activeCity,
      restaurants,
      mostVisited: [...restaurants].sort((first, second) => second.visits7d - first.visits7d).slice(0, 6),
      mostOrderedRestaurants: [...restaurants].sort((first, second) => second.orders30d - first.orders30d).slice(0, 6),
      mostOrderedProducts: productSuggestions.filter((product) => product.orderCount > 0).slice(0, 10),
      productSuggestions,
    };
    await writeCache(cacheKey, directory);
    return directory;
  } catch (error) {
    const cached = await readCache<HomeDirectory>(cacheKey);
    if (cached) return cached;
    throw error;
  }
}

export async function listRestaurants(location?: UserLocation) {
  return (await listHomeDirectory(location)).restaurants;
}

export async function getRestaurantBySlug(slug: string, location?: UserLocation) {
  const { data, error } = await supabase
    .from("restaurants")
    .select("id,name,slug,description,city,address,business_type,logo_url,banner_url,latitude,longitude")
    .eq("slug", slug)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? mapRestaurant(data as RestaurantRow, location) : null;
}

export async function listRestaurantBusinessHours(restaurantId: string): Promise<BusinessHour[]> {
  const cacheKey = `business-hours:${restaurantId}`;

  try {
    const { data, error } = await supabase
      .from("business_hours")
      .select("day_of_week,opens_at,closes_at,is_closed")
      .eq("restaurant_id", restaurantId)
      .order("day_of_week", { ascending: true });

    if (error) throw new Error(error.message);

    const hours = ((data ?? []) as BusinessHourRow[]).map<BusinessHour>((hour) => ({
      closesAt: hour.closes_at ?? "",
      dayOfWeek: hour.day_of_week,
      isClosed: Boolean(hour.is_closed),
      opensAt: hour.opens_at ?? "",
    }));
    await writeCache(cacheKey, hours);
    return hours;
  } catch (error) {
    const cached = await readCache<BusinessHour[]>(cacheKey, cacheTtlMs);
    if (cached) return cached;
    throw error;
  }
}

export async function listRestaurantCatalog(restaurantId: string) {
  const cacheKey = `catalog:${restaurantId}`;

  try {
    const [
      { data: categories, error: categoryError },
      { data: products, error: productError },
      { data: variants },
      { data: optionGroups },
      { data: options },
    ] = await Promise.all([
      supabase
        .from("categories")
        .select("id,name,description")
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      supabase
        .from("products")
        .select("id,restaurant_id,category_id,name,description,price,image_url,is_featured,sort_order,order_count")
        .eq("restaurant_id", restaurantId)
        .eq("is_available", true)
        .order("sort_order", { ascending: true }),
      supabase
        .from("product_variants")
        .select("id,product_id,name,description,price_delta,sort_order")
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      supabase
        .from("product_option_groups")
        .select("id,product_id,name,description,min_choices,max_choices,is_required,sort_order")
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      supabase
        .from("product_options")
        .select("id,product_id,option_group_id,name,description,price_delta,sort_order")
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
    ]);

    if (categoryError) {
      throw new Error(categoryError.message);
    }

    if (productError) {
      throw new Error(productError.message);
    }

    const variantsByProduct = new Map<string, ProductVariantSummary[]>();
    ((variants ?? []) as VariantRow[]).forEach((variant) => {
      const current = variantsByProduct.get(variant.product_id) ?? [];
      current.push({
        id: variant.id,
        name: variant.name,
        description: variant.description ?? "",
        priceDelta: Number(variant.price_delta),
      });
      variantsByProduct.set(variant.product_id, current);
    });

    const optionsByGroup = new Map<string, OptionRow[]>();
    ((options ?? []) as OptionRow[]).forEach((option) => {
      const current = optionsByGroup.get(option.option_group_id) ?? [];
      current.push(option);
      optionsByGroup.set(option.option_group_id, current);
    });

    const groupsByProduct = new Map<string, ProductOptionGroupSummary[]>();
    ((optionGroups ?? []) as OptionGroupRow[]).forEach((group) => {
      const current = groupsByProduct.get(group.product_id) ?? [];
      current.push({
        id: group.id,
        name: group.name,
        description: group.description ?? "",
        minChoices: Number(group.min_choices),
        maxChoices: Number(group.max_choices),
        isRequired: Boolean(group.is_required),
        options: (optionsByGroup.get(group.id) ?? []).map((option) => ({
          id: option.id,
          name: option.name,
          description: option.description ?? "",
          priceDelta: Number(option.price_delta),
        })),
      });
      groupsByProduct.set(group.product_id, current);
    });

    const catalog = {
      categories: ((categories ?? []) as CategoryRow[]).map<CategorySummary>((category) => ({
        id: category.id,
        name: category.name,
        description: category.description ?? "",
      })),
      products: ((products ?? []) as ProductRow[]).map<ProductSummary>((product) => ({
        id: product.id,
        categoryId: product.category_id ?? "",
        name: product.name,
        description: product.description ?? "",
        price: Number(product.price),
        imageUrl: product.image_url ?? "",
        isFeatured: Boolean(product.is_featured),
        orderCount: Number(product.order_count ?? 0),
        variants: variantsByProduct.get(product.id) ?? [],
        optionGroups: groupsByProduct.get(product.id) ?? [],
      })),
    };
    await writeCache(cacheKey, catalog);
    return catalog;
  } catch (error) {
    const cached = await readCache<{
      categories: CategorySummary[];
      products: ProductSummary[];
    }>(cacheKey, cacheTtlMs);
    if (cached) return cached;
    throw error;
  }
}
