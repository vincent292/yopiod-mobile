import { config } from "./config";
import type { RecentOrder, SavedAddress, SavedFavorite } from "./customer-store";

const customerApiTimeoutMs = 20000;

class CustomerApiError extends Error {
  code: string;
  status?: number;
  url?: string;
  causeMessage?: string;

  constructor(code: string, options: { causeMessage?: string; status?: number; url?: string } = {}) {
    super(code);
    this.name = "CustomerApiError";
    this.code = code;
    this.status = options.status;
    this.url = options.url;
    this.causeMessage = options.causeMessage;
  }
}

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
  if (!config.apiBaseUrl) throw new CustomerApiError("api-base-url-required");
  return `${config.apiBaseUrl.replace(/\/$/, "")}${path}`;
}

function errorCodeFromBody(data: unknown, fallback: string) {
  if (data && typeof data === "object" && "error" in data) {
    const error = (data as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }

  return fallback;
}

async function parseJsonResponse(response: Response) {
  const text = await response.text().catch(() => "");
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function customerApi<T>(path: string, init: RequestInit, fallbackCode = "customer-api-failed"): Promise<T> {
  const url = apiUrl(path);
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeout = controller
    ? setTimeout(() => {
        controller.abort();
      }, customerApiTimeoutMs)
    : null;

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: controller?.signal,
    });
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    throw new CustomerApiError(isAbort ? "api-timeout" : "api-network-failed", {
      causeMessage: error instanceof Error ? error.message : String(error),
      url,
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  const data = await parseJsonResponse(response);

  if (!response.ok) {
    const code = response.status === 404 && !errorCodeFromBody(data, "")
      ? "customer-api-not-deployed"
      : errorCodeFromBody(data, fallbackCode);
    throw new CustomerApiError(code, { status: response.status, url });
  }

  return data as T;
}

export function customerErrorMessage(error: unknown) {
  const message = error instanceof CustomerApiError ? error.code : error instanceof Error ? error.message : "customer-api-failed";
  if (message === "api-network-failed") return "No pudimos conectar con la web. Si el APK apunta a una web local o a un puerto, recompila usando una URL accesible desde el celular.";
  if (message === "api-timeout") return "La web tardo demasiado en responder. Intenta nuevamente en unos segundos.";
  if (message === "phone-already-exists") return "Ese telefono ya esta registrado en otra cuenta.";
  if (message === "document-already-exists") return "Ese carnet ya esta registrado en otra cuenta.";
  if (message === "email-already-exists") return "Ese correo ya esta registrado.";
  if (message === "customer-profile-required") return "Primero guarda tus datos de perfil.";
  if (message === "service-role-required") return "La web necesita SUPABASE_SERVICE_ROLE_KEY para registrar clientes.";
  if (message === "customer-api-not-deployed") return "La web publica todavia no tiene desplegada la API de clientes. Espera el deploy y vuelve a intentar.";
  if (message === "api-base-url-required") return "Configura EXPO_PUBLIC_API_BASE_URL para conectar con la web.";
  if (message === "unauthorized") return "Tu sesion vencio. Cierra sesion e ingresa nuevamente.";
  if (message === "invalid-login" || message === "invalid-login-credentials" || message.toLowerCase().includes("invalid login credentials")) return "Correo o contrasena incorrectos.";
  if (message === "rate-limit") return "Demasiados intentos. Espera unos minutos y vuelve a intentar.";
  if (message === "google-auth-failed" || message === "google-session-missing") return "No pudimos iniciar sesion con Google. Intenta nuevamente.";
  if (message === "email-required") return "Tu cuenta no tiene correo confirmado. Ingresa nuevamente o usa otro correo.";
  if (message === "invalid-json") return "La app y la web tienen versiones distintas. Actualiza el APK o despliega la web mas reciente.";
  if (message === "customer-auth-create-failed") return "Supabase no pudo crear la cuenta. Revisa Auth en la web o intenta con otro correo.";
  if (message === "customer-save-failed") return "La web no pudo guardar tus datos. Revisa que la base de datos tenga las migraciones de clientes aplicadas.";
  if (message === "invalid-customer-registration") return "Revisa nombre, telefono, carnet, correo y contrasena.";
  if (message === "invalid-customer-profile") return "Revisa nombre, telefono y carnet.";
  if (message === "invalid-customer-address") return "Marca una direccion valida en el mapa.";
  if (message === "address-save-failed") return "No pudimos guardar la direccion. Revisa la referencia e intenta nuevamente.";
  if (message === "invalid-customer-favorite" || message === "favorite-save-failed") return "No pudimos guardar el favorito. Intenta nuevamente.";
  if (message === "favorite-restaurant-not-found" || message === "favorite-product-not-found") return "Este local o plato ya no esta disponible.";
  return `No se pudo completar la accion (${message}). Intenta nuevamente.`;
}

export async function registerCustomerAccount(input: {
  email: string;
  password: string;
  fullName: string;
  phone: string;
  documentNumber: string;
}) {
  return customerApi<{ profile: MobileCustomerProfile }>("/api/mobile/customers/register", {
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

export async function signInCustomerAccount(email: string, password: string) {
  return customerApi<{
    accessToken: string;
    refreshToken: string;
    user: { id: string; email: string };
  }>("/api/mobile/customers/login", {
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  }, "invalid-login-credentials");
}

export async function fetchCustomerAccount(accessToken: string): Promise<CustomerAccountPayload> {
  return customerApi<CustomerAccountPayload>("/api/mobile/customers/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
    method: "GET",
  });
}

export async function claimCustomerOrders(
  accessToken: string,
  orders: Array<{ orderId: string; trackingToken: string }>,
) {
  return customerApi<{ claimed: number; orderIds: string[] }>("/api/mobile/customers/orders/claim", {
    body: JSON.stringify({ orders }),
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    method: "POST",
  });
}

export async function updateCustomerProfile(
  accessToken: string,
  input: {
    fullName: string;
    phone: string;
    documentNumber: string;
  },
) {
  return customerApi<{ profile: MobileCustomerProfile }>("/api/mobile/customers/profile", {
    body: JSON.stringify(input),
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    method: "PUT",
  });
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
  return customerApi<{ addresses: MobileCustomerAddress[] }>("/api/mobile/customers/addresses", {
    body: JSON.stringify(input),
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    method: "POST",
  });
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
  return customerApi<{ favorites: SavedFavorite[] }>("/api/mobile/customers/favorites", {
    body: JSON.stringify(input),
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    method: "PUT",
  });
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
