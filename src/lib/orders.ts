import { config } from "./config";

const mobileApiTimeoutMs = 20000;

export class MobileApiError extends Error {
  code: string;
  status?: number;
  url?: string;
  causeMessage?: string;

  constructor(code: string, options: { causeMessage?: string; status?: number; url?: string } = {}) {
    super(code);
    this.name = "MobileApiError";
    this.code = code;
    this.status = options.status;
    this.url = options.url;
    this.causeMessage = options.causeMessage;
  }
}

export type MobileOrderItem = {
  productId: string;
  variantId?: string;
  optionIds?: string[];
  name: string;
  price: number;
  quantity: number;
  notes?: string;
};

export type MobilePushSubscription = {
  appVersion?: string;
  deviceId?: string;
  expoPushToken: string;
  platform?: string;
};

export type MobileOrderPayload = {
  requestId: string;
  restaurantId: string;
  restaurantSlug: string;
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  deliveryLatitude?: number;
  deliveryLongitude?: number;
  deliveryMapsUrl?: string;
  orderType: "delivery" | "pickup";
  paymentMethod: "cash" | "qr";
  push?: MobilePushSubscription;
  deliveryFee: number;
  notes?: string;
  items: MobileOrderItem[];
};

export type MobileOrderResult = {
  orderId: string;
  orderNumber: string;
  trackingToken: string;
};

export type MobileOrderStatus = "pending" | "accepted" | "preparing" | "ready" | "delivered" | "cancelled";
export type MobileOrderType = "delivery" | "pickup" | "table" | "pos";

export type MobileTrackingItem = {
  id: string;
  productId?: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
  notes?: string;
};

export type MobileDeliveryDispatch = {
  status: "active" | "arrived" | "delivered" | "cancelled" | "expired";
  deliveryPhone?: string;
  deliveryName?: string;
  dispatchedAt?: string;
  openedAt?: string;
  arrivedAt?: string;
  deliveredAt?: string;
  riderLatitude?: number;
  riderLongitude?: number;
  riderLocationAccuracyMeters?: number;
  riderLocationHeading?: number;
  riderLocationSpeedMetersPerSecond?: number;
  riderLocationUpdatedAt?: string;
};

export type MobileTrackedOrder = {
  id: string;
  restaurantId: string;
  orderNumber: string;
  trackingToken: string;
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  deliveryAddressDetail?: string;
  deliveryLatitude?: number;
  deliveryLongitude?: number;
  deliveryMapsUrl?: string;
  deliveryDistanceKm?: number;
  orderType: MobileOrderType;
  status: MobileOrderStatus;
  paymentStatus: string;
  paymentMethod: string;
  subtotal: number;
  deliveryFee: number;
  discountTotal: number;
  total: number;
  notes?: string;
  createdAt: string;
  acceptedAt?: string;
  preparingAt?: string;
  readyAt?: string;
  deliveredAt?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  deliveryDispatch?: MobileDeliveryDispatch;
  items: MobileTrackingItem[];
};

export type MobileOrderQueueState = {
  queueEnabled: boolean;
  status: MobileOrderStatus;
  queuePosition?: number;
  ordersAhead?: number;
  activeOrders: number;
  preparingOrders: number;
  readyOrders: number;
  recentOrders: number;
  estimatedMinMinutes: number;
  estimatedMaxMinutes: number;
  estimatedReadyAtMin?: string;
  estimatedReadyAtMax?: string;
  demandLabel: string;
  demandLevel: "calm" | "normal" | "busy" | "event";
  confidence: "low" | "medium" | "high";
  kitchenCapacity: number;
  basePrepMinutes: number;
  historySampleSize: number;
  updatedAt: string;
};

export type MobileTrackingResult = {
  restaurant: {
    id: string;
    name: string;
    slug: string;
    city: string;
    logoUrl?: string;
    businessType?: string;
    whatsapp?: string;
  };
  order: MobileTrackedOrder;
  queue: MobileOrderQueueState | null;
  updatedAt: string;
};

function apiUrl(path: string) {
  if (!config.apiBaseUrl) {
    throw new MobileApiError("api-base-url-required");
  }

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

async function postMobileApi<T>(path: string, payload: unknown, fallbackCode: string, accessToken?: string): Promise<T> {
  const url = apiUrl(path);
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeout = controller
    ? setTimeout(() => {
        controller.abort();
      }, mobileApiTimeoutMs)
    : null;

  let response: Response;
  try {
    response = await fetch(url, {
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      method: "POST",
      signal: controller?.signal,
    });
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    throw new MobileApiError(isAbort ? "api-timeout" : "api-network-failed", {
      causeMessage: error instanceof Error ? error.message : String(error),
      url,
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  const data = await parseJsonResponse(response);

  if (!response.ok) {
    const code = response.status === 404 && !errorCodeFromBody(data, "")
      ? "mobile-orders-api-not-deployed"
      : errorCodeFromBody(data, fallbackCode);
    throw new MobileApiError(code, { status: response.status, url });
  }

  return data as T;
}

function stringField(data: unknown, key: string) {
  if (!data || typeof data !== "object" || !(key in data)) return "";
  const value = (data as Record<string, unknown>)[key];
  return value == null ? "" : String(value);
}

export function getMobileApiError(error: unknown) {
  return error instanceof MobileApiError ? error : null;
}

export async function createMobileOrder(payload: MobileOrderPayload, accessToken?: string): Promise<MobileOrderResult> {
  const data = await postMobileApi<unknown>("/api/mobile/orders", payload, "order-create-failed", accessToken);
  const orderId = stringField(data, "orderId");
  const trackingToken = stringField(data, "trackingToken");

  if (!orderId || !trackingToken) {
    throw new MobileApiError("invalid-order-response");
  }

  return {
    orderId,
    orderNumber: stringField(data, "orderNumber"),
    trackingToken,
  };
}

export async function trackMobileOrder(payload: {
  orderNumber: string;
  customerPhone: string;
  push?: MobilePushSubscription;
}): Promise<MobileTrackingResult> {
  return postMobileApi<MobileTrackingResult>("/api/mobile/orders/track", payload, "tracking-failed");
}

export async function getMobileOrderStatus(payload: {
  orderId: string;
  trackingToken: string;
}): Promise<MobileTrackingResult> {
  return postMobileApi<MobileTrackingResult>("/api/mobile/orders/status", payload, "tracking-failed");
}
