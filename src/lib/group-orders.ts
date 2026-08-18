import { config } from "./config";
import type { RestaurantSummary } from "../types/domain";

const mobileApiTimeoutMs = 20000;

export type GroupCollectMode = "host_collects" | "restaurant_collects" | "internal_cash";
export type GroupPaymentStatus = "pending" | "paid_qr" | "cash_pending" | "covered_by_host" | "excluded";
export type GroupSessionStatus = "open" | "locked" | "submitted" | "cancelled" | "expired";

export type MobileGroupSession = {
  id: string;
  publicToken: string;
  hostName: string;
  hostPhone: string;
  collectMode: GroupCollectMode;
  hostQrUrl: string;
  status: GroupSessionStatus;
  submittedOrderId: string;
  subtotal: number;
  deliveryFee: number;
  total: number;
  expiresAt: string;
  createdAt: string;
};

export type MobileGroupParticipant = {
  id: string;
  displayName: string;
  phone: string;
  role: "host" | "guest";
  paymentStatus: GroupPaymentStatus;
  paymentMethod: string;
  paymentNote: string;
  paymentReceiptUrl: string;
};

export type MobileGroupItem = {
  id: string;
  participantId: string;
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
  notes: string;
};

export type MobileGroupOrderState = {
  currentParticipantId: string | null;
  isHost: boolean;
  restaurant: RestaurantSummary | null;
  session: MobileGroupSession;
  participants: MobileGroupParticipant[];
  items: MobileGroupItem[];
};

export type MobileGroupOrderResult = {
  orderId: string;
  orderNumber: string;
  trackingToken: string;
};

export type MobileUploadFile = {
  uri: string;
  name: string;
  type: string;
};

export class MobileGroupOrderError extends Error {
  code: string;
  status?: number;

  constructor(code: string, status?: number) {
    super(code);
    this.name = "MobileGroupOrderError";
    this.code = code;
    this.status = status;
  }
}

function apiUrl(path: string) {
  if (!config.apiBaseUrl) throw new MobileGroupOrderError("api-base-url-required");
  return `${config.apiBaseUrl.replace(/\/$/, "")}${path}`;
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

function errorCodeFromBody(data: unknown, fallback: string) {
  if (data && typeof data === "object" && "error" in data) {
    const error = (data as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return fallback;
}

async function requestMobileApi<T>(path: string, options: RequestInit, fallbackCode: string): Promise<T> {
  const url = apiUrl(path);
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), mobileApiTimeoutMs) : null;
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...((options.headers ?? {}) as Record<string, string>),
  };

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
      signal: controller?.signal,
    });
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    throw new MobileGroupOrderError(isAbort ? "api-timeout" : "api-network-failed");
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  const data = await parseJsonResponse(response);
  if (!response.ok) throw new MobileGroupOrderError(errorCodeFromBody(data, fallbackCode), response.status);
  return data as T;
}

function jsonBody(payload: unknown) {
  return JSON.stringify(payload);
}

function appendValue(formData: FormData, key: string, value: string | number | boolean | undefined | null) {
  if (value === undefined || value === null || value === "") return;
  formData.append(key, String(value));
}

function appendFile(formData: FormData, key: string, file?: MobileUploadFile | null) {
  if (!file) return;
  formData.append(key, {
    name: file.name,
    type: file.type || "image/jpeg",
    uri: file.uri,
  } as unknown as Blob);
}

export function groupOrderErrorMessage(error: unknown) {
  const code = error instanceof MobileGroupOrderError ? error.code : "";
  const messages: Record<string, string> = {
    "api-network-failed": "No pudimos conectar con Yopido. Revisa internet e intenta nuevamente.",
    "api-timeout": "La solicitud tardo demasiado. Intenta otra vez.",
    "closed": "La sala ya esta cerrada.",
    "create": "No se pudo crear la sala grupal.",
    "create-order": "No se pudo enviar el pedido grupal.",
    "delivery-address": "Completa la direccion de entrega.",
    "delivery-location": "Marca el punto de entrega en el mapa.",
    "different-city": "La direccion esta fuera de la ciudad del local.",
    "disabled": "Esta modalidad no esta habilitada para este local.",
    "empty": "Agrega productos antes de finalizar.",
    "invalid": "Datos incompletos.",
    "invalid-restaurant": "No encontramos este local.",
    "join": "No se pudo unir a la sala.",
    "minimum": "El pedido no alcanza el minimo requerido.",
    "no-open-cash": "El local aun no tiene caja abierta.",
    "not-found": "La sala ya no existe o expiro.",
    "outside-hours": "El local esta fuera de horario.",
    "participant": "No encontramos tu participante.",
    "payment": "No se pudo actualizar el pago.",
    "product-configuration": "Este producto necesita configuracion.",
    "product-not-found": "Producto no disponible.",
    "qr-required-distance": "Por distancia este pedido requiere pago por QR.",
    "qr-size": "El QR debe pesar menos de 5 MB.",
    "qr-type": "El QR debe ser una imagen.",
    "qr-unavailable": "El local no tiene QR configurado.",
    "receipt-required": "Sube el comprobante del pago QR.",
    "receipt-size": "El comprobante debe pesar menos de 5 MB.",
    "receipt-type": "El comprobante debe ser imagen o PDF.",
    "service-role-required": "Falta configurar el service role del backend.",
    "temporarily-closed": "El local tiene los pedidos pausados temporalmente.",
  };
  return messages[code] || "No se pudo completar la accion. Intenta nuevamente.";
}

export async function createMobileGroupOrderSession(payload: {
  restaurantSlug: string;
  hostName: string;
  hostPhone?: string;
  collectMode: GroupCollectMode;
  hostQrUrl?: string;
  hostQrFile?: MobileUploadFile | null;
}) {
  const body = payload.hostQrFile
    ? (() => {
        const formData = new FormData();
        appendValue(formData, "collectMode", payload.collectMode);
        appendValue(formData, "hostName", payload.hostName);
        appendValue(formData, "hostPhone", payload.hostPhone);
        appendValue(formData, "restaurantSlug", payload.restaurantSlug);
        appendFile(formData, "hostQrFile", payload.hostQrFile);
        return formData;
      })()
    : jsonBody(payload);
  return requestMobileApi<MobileGroupOrderState & { hostAccessToken: string; participantToken: string; sessionToken: string }>(
    "/api/mobile/group-orders",
    { body, method: "POST" },
    "create",
  );
}

export async function getMobileGroupOrderSession(
  sessionToken: string,
  tokens: { hostAccessToken?: string; participantToken?: string } = {},
) {
  const params = new URLSearchParams();
  if (tokens.hostAccessToken) params.set("hostAccessToken", tokens.hostAccessToken);
  if (tokens.participantToken) params.set("participantToken", tokens.participantToken);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return requestMobileApi<MobileGroupOrderState>(`/api/mobile/group-orders/${encodeURIComponent(sessionToken)}${suffix}`, { method: "GET" }, "not-found");
}

export async function joinMobileGroupOrderSession(sessionToken: string, payload: { displayName: string; phone?: string }) {
  return requestMobileApi<MobileGroupOrderState & { participantToken: string }>(
    `/api/mobile/group-orders/${encodeURIComponent(sessionToken)}/join`,
    { body: jsonBody(payload), method: "POST" },
    "join",
  );
}

export async function addMobileGroupOrderItem(
  sessionToken: string,
  payload: {
    participantToken: string;
    productId: string;
    variantId?: string;
    optionIds?: string[];
    notes?: string;
  },
) {
  return requestMobileApi<MobileGroupOrderState>(
    `/api/mobile/group-orders/${encodeURIComponent(sessionToken)}/items`,
    {
      body: jsonBody({
        notes: payload.notes,
        optionIds: payload.optionIds ?? [],
        participantToken: payload.participantToken,
        productId: payload.productId,
        variantId: payload.variantId,
      }),
      method: "POST",
    },
    "add",
  );
}

export async function removeMobileGroupOrderItem(
  sessionToken: string,
  payload: { itemId: string; participantToken?: string; hostAccessToken?: string },
) {
  return requestMobileApi<MobileGroupOrderState>(
    `/api/mobile/group-orders/${encodeURIComponent(sessionToken)}/items`,
    { body: jsonBody(payload), method: "DELETE" },
    "remove",
  );
}

export async function updateMobileGroupParticipantPayment(
  sessionToken: string,
  payload: {
    participantToken: string;
    paymentStatus: GroupPaymentStatus;
    paymentNote?: string;
    paymentReceiptUrl?: string;
    paymentReceiptFile?: MobileUploadFile | null;
  },
) {
  const body = payload.paymentReceiptFile
    ? (() => {
        const formData = new FormData();
        appendValue(formData, "participantToken", payload.participantToken);
        appendValue(formData, "paymentNote", payload.paymentNote);
        appendValue(formData, "paymentStatus", payload.paymentStatus);
        appendFile(formData, "paymentReceiptFile", payload.paymentReceiptFile);
        return formData;
      })()
    : jsonBody(payload);
  return requestMobileApi<MobileGroupOrderState>(
    `/api/mobile/group-orders/${encodeURIComponent(sessionToken)}/payment`,
    { body, method: "POST" },
    "payment",
  );
}

export async function updateMobileGroupHost(
  sessionToken: string,
  payload:
    | { action: "status"; hostAccessToken: string; status: "open" | "locked" | "cancelled" }
    | { action: "participant"; hostAccessToken: string; participantId: string; paymentStatus: GroupPaymentStatus }
    | { action: "settings"; hostAccessToken: string; collectMode: GroupCollectMode; hostQrUrl?: string; hostQrFile?: MobileUploadFile | null },
) {
  const body = payload.action === "settings" && payload.hostQrFile
    ? (() => {
        const formData = new FormData();
        appendValue(formData, "action", payload.action);
        appendValue(formData, "collectMode", payload.collectMode);
        appendValue(formData, "hostAccessToken", payload.hostAccessToken);
        appendFile(formData, "hostQrFile", payload.hostQrFile);
        return formData;
      })()
    : jsonBody(payload);
  return requestMobileApi<MobileGroupOrderState>(
    `/api/mobile/group-orders/${encodeURIComponent(sessionToken)}/host`,
    { body, method: "POST" },
    "host",
  );
}

export async function submitMobileGroupOrder(
  sessionToken: string,
  payload: {
    hostAccessToken: string;
    restaurantSlug: string;
    orderType: "delivery" | "pickup";
    customerName: string;
    customerPhone?: string;
    customerAddress?: string;
    deliveryAddressDetail?: string;
    deliveryLatitude?: number;
    deliveryLongitude?: number;
    deliveryMapsUrl?: string;
    deliveryCity?: string;
    paymentMethod: "cash" | "qr";
    paymentReceiptUrl?: string;
    paymentReceiptFile?: MobileUploadFile | null;
  },
) {
  const body = payload.paymentReceiptFile
    ? (() => {
        const { paymentReceiptFile, ...submitPayload } = payload;
        const formData = new FormData();
        appendValue(formData, "action", "submit");
        appendValue(formData, "payload", JSON.stringify(submitPayload));
        appendFile(formData, "paymentReceiptFile", paymentReceiptFile);
        return formData;
      })()
    : jsonBody({ action: "submit", payload });
  const data = await requestMobileApi<{ order: MobileGroupOrderResult }>(
    `/api/mobile/group-orders/${encodeURIComponent(sessionToken)}/host`,
    { body, method: "POST" },
    "create-order",
  );
  return data.order;
}
