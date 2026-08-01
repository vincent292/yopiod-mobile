import { config } from "./config";
import type { RecentOrder, SavedAddress, SavedFavorite } from "./customer-store";

export type MobileCustomerProfile = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  documentNumber: string;
  provider: "email" | "google";
  status: "active" | "blocked";
  createdAt: string;
  updatedAt: string;
  lastSignInAt: string | null;
};

export type MobileCustomerAddress = {
  id: string;
  customerId: string;
  label: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  mapsUrl: string | null;
  city: string | null;
  apartment: string | null;
  buildingName: string | null;
  reference: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MobileCustomerOrder = {
  id: string;
  restaurantName: string;
  restaurantSlug: string;
  orderNumber: string;
  customerPhone: string;
  trackingToken: string;
  orderType: "delivery" | "pickup" | "table" | "pos";
  status: "pending" | "accepted" | "preparing" | "ready" | "delivered" | "cancelled";
  total: number;
  createdAt: string;
};

type CustomerAccountPayload = {
  profile: MobileCustomerProfile | null;
  addresses: MobileCustomerAddress[];
  favorites: SavedFavorite[];
  orders: MobileCustomerOrder[];
};

function apiUrl(path: string) {
  if (!config.apiBaseUrl) throw new Error("api-base-url-required");
  return `${config.apiBaseUrl.replace(/\/$/, "")}${path}`;
}

async function parseApiError(response: Response) {
  const data = await response.json().catch(() => null);
  if (response.status === 404) {
    throw new Error("customer-api-not-deployed");
  }
  const error = typeof data?.error === "string" ? data.error : "customer-api-failed";
  throw new Error(error);
}

export function customerErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "customer-api-failed";
  if (message === "phone-already-exists") return "Ese telefono ya esta registrado en otra cuenta.";
  if (message === "document-already-exists") return "Ese carnet ya esta registrado en otra cuenta.";
  if (message === "email-already-exists") return "Ese correo ya esta registrado.";
  if (message === "customer-profile-required") return "Primero guarda tus datos de perfil.";
  if (message === "service-role-required") return "La web necesita SUPABASE_SERVICE_ROLE_KEY para registrar clientes.";
  if (message === "customer-api-not-deployed") return "La web publica todavia no tiene desplegada la API de clientes. Espera el deploy y vuelve a intentar.";
  if (message === "api-base-url-required") return "Configura EXPO_PUBLIC_API_BASE_URL para conectar con la web.";
  if (message === "invalid-customer-registration") return "Revisa nombre, telefono, carnet, correo y contrasena.";
  if (message === "invalid-customer-profile") return "Revisa nombre, telefono y carnet.";
  if (message === "invalid-customer-address") return "Marca una direccion valida en el mapa.";
  if (message === "invalid-customer-favorite" || message === "favorite-save-failed") return "No pudimos guardar el favorito. Intenta nuevamente.";
  if (message === "favorite-restaurant-not-found" || message === "favorite-product-not-found") return "Este local o plato ya no esta disponible.";
  return "No se pudo completar la accion. Intenta nuevamente.";
}

export async function registerCustomerAccount(input: {
  email: string;
  password: string;
  fullName: string;
  phone: string;
  documentNumber: string;
}) {
  const response = await fetch(apiUrl("/api/mobile/customers/register"), {
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) await parseApiError(response);
  return (await response.json()) as { profile: MobileCustomerProfile };
}

export async function fetchCustomerAccount(accessToken: string): Promise<CustomerAccountPayload> {
  const response = await fetch(apiUrl("/api/mobile/customers/profile"), {
    headers: { Authorization: `Bearer ${accessToken}` },
    method: "GET",
  });

  if (!response.ok) await parseApiError(response);
  return (await response.json()) as CustomerAccountPayload;
}

export async function claimCustomerOrders(
  accessToken: string,
  orders: Array<{ orderId: string; trackingToken: string }>,
) {
  const response = await fetch(apiUrl("/api/mobile/customers/orders/claim"), {
    body: JSON.stringify({ orders }),
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) await parseApiError(response);
  return (await response.json()) as { claimed: number; orderIds: string[] };
}

export async function updateCustomerProfile(
  accessToken: string,
  input: {
    fullName: string;
    phone: string;
    documentNumber: string;
  },
) {
  const response = await fetch(apiUrl("/api/mobile/customers/profile"), {
    body: JSON.stringify(input),
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    method: "PUT",
  });

  if (!response.ok) await parseApiError(response);
  return (await response.json()) as { profile: MobileCustomerProfile };
}

export async function createCustomerAddress(
  accessToken: string,
  input: {
    label: string;
    address: string;
    latitude?: number;
    longitude?: number;
    mapsUrl?: string;
    city?: string;
    apartment?: string;
    buildingName?: string;
    reference?: string;
    isDefault?: boolean;
  },
) {
  const response = await fetch(apiUrl("/api/mobile/customers/addresses"), {
    body: JSON.stringify(input),
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) await parseApiError(response);
  return (await response.json()) as { addresses: MobileCustomerAddress[] };
}

export async function setCustomerFavorite(
  accessToken: string,
  input: {
    kind: "restaurant" | "product";
    restaurantId: string;
    productId?: string;
    favorite: boolean;
  },
) {
  const response = await fetch(apiUrl("/api/mobile/customers/favorites"), {
    body: JSON.stringify(input),
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    method: "PUT",
  });

  if (!response.ok) await parseApiError(response);
  return (await response.json()) as { favorites: SavedFavorite[] };
}

export function mapCustomerAddressToSavedAddress(address: MobileCustomerAddress): SavedAddress {
  return {
    id: address.id,
    label: address.label,
    address: address.address,
    latitude: address.latitude ?? undefined,
    longitude: address.longitude ?? undefined,
    mapsUrl: address.mapsUrl ?? undefined,
    city: address.city ?? undefined,
    apartment: address.apartment ?? undefined,
    buildingName: address.buildingName ?? undefined,
    reference: address.reference ?? undefined,
    updatedAt: address.updatedAt,
  };
}

export function mapCustomerOrderToRecentOrder(order: MobileCustomerOrder): RecentOrder {
  return {
    id: order.id,
    restaurantName: order.restaurantName,
    restaurantSlug: order.restaurantSlug,
    orderNumber: order.orderNumber,
    customerPhone: order.customerPhone,
    trackingToken: order.trackingToken,
    orderType: order.orderType,
    status: order.status,
    total: order.total,
    createdAt: order.createdAt,
  };
}
