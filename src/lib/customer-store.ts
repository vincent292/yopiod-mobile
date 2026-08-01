import AsyncStorage from "@react-native-async-storage/async-storage";

export type CustomerProfile = {
  name: string;
  phone: string;
  documentNumber: string;
};

export type SavedAddress = {
  id: string;
  label: string;
  address: string;
  latitude?: number;
  longitude?: number;
  mapsUrl?: string;
  city?: string;
  apartment?: string;
  buildingName?: string;
  reference?: string;
  updatedAt: string;
};

export type RecentOrder = {
  id: string;
  restaurantName: string;
  restaurantSlug: string;
  orderNumber: string;
  customerPhone: string;
  trackingToken?: string;
  orderType?: string;
  status?: "pending" | "accepted" | "preparing" | "ready" | "delivered" | "cancelled";
  total: number;
  createdAt: string;
};

export type SavedFavorite = {
  id: string;
  entityId: string;
  kind: "restaurant" | "product";
  title: string;
  subtitle: string;
  imageUrl: string;
  restaurantId: string;
  restaurantSlug: string;
  price?: number;
  savedAt: string;
};

export type CustomerStore = {
  profile: CustomerProfile;
  addresses: SavedAddress[];
  recentOrders: RecentOrder[];
  favorites: SavedFavorite[];
};

const emptyStore: CustomerStore = {
  profile: { name: "", phone: "", documentNumber: "" },
  addresses: [],
  recentOrders: [],
  favorites: [],
};

function keyFor(userId?: string | null) {
  return `yopido:customer:${userId || "device"}`;
}

export async function loadCustomerStore(userId?: string | null): Promise<CustomerStore> {
  const raw = await AsyncStorage.getItem(keyFor(userId));
  if (!raw) return emptyStore;

  try {
    const parsed = JSON.parse(raw) as Partial<CustomerStore>;
    return {
      profile: { ...emptyStore.profile, ...(parsed.profile ?? {}) },
      addresses: Array.isArray(parsed.addresses) ? parsed.addresses : [],
      recentOrders: Array.isArray(parsed.recentOrders) ? parsed.recentOrders : [],
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
    };
  } catch {
    return emptyStore;
  }
}

export async function saveCustomerStore(userId: string | null | undefined, store: CustomerStore) {
  await AsyncStorage.setItem(keyFor(userId), JSON.stringify(store));
}

export async function clearCustomerStore(userId?: string | null) {
  await AsyncStorage.removeItem(keyFor(userId));
}

export async function upsertSavedAddress(userId: string | null | undefined, address: Omit<SavedAddress, "id" | "updatedAt">) {
  const store = await loadCustomerStore(userId);
  const nextAddress: SavedAddress = {
    ...address,
    id: `${Date.now()}`,
    updatedAt: new Date().toISOString(),
  };
  const addresses = [nextAddress, ...store.addresses.filter((item) => item.address !== address.address)].slice(0, 8);
  await saveCustomerStore(userId, { ...store, addresses });
  return addresses;
}

export async function addRecentOrder(userId: string | null | undefined, order: RecentOrder) {
  const store = await loadCustomerStore(userId);
  const recentOrders = [order, ...store.recentOrders.filter((item) => item.id !== order.id)].slice(0, 12);
  await saveCustomerStore(userId, { ...store, recentOrders });
  return recentOrders;
}
