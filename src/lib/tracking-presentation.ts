import type { MobileTrackedOrder, MobileOrderStatus } from "./orders";

export function trackingLabel(order: MobileTrackedOrder) {
  if (order.status === "cancelled") return "Cancelado";
  if (order.status === "delivered" || order.deliveryDispatch?.status === "delivered") return order.orderType === "pickup" ? "Retirado" : "Entregado";
  if (order.orderType === "pickup" && order.status === "ready") return "Listo para recoger";
  if (order.orderType === "delivery" && order.deliveryDispatch?.status === "arrived") return "En camino a tu ubicación";
  if (order.orderType === "delivery" && order.deliveryDispatch?.status === "active") return "El rider va al punto de recogida";
  const labels: Record<MobileOrderStatus, string> = {
    accepted: "Confirmado",
    cancelled: "Cancelado",
    delivered: order.orderType === "pickup" ? "Retirado" : "Entregado",
    pending: "Recibido",
    preparing: "Preparando",
    ready: "Listo",
  };
  return labels[order.status];
}

export function formatRelativeUpdate(value?: string, now = Date.now()) {
  const timestamp = value ? new Date(value).getTime() : NaN;
  if (!Number.isFinite(timestamp)) return "Sin señal reciente";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return "Actualizado hace menos de 1 min";
  const minutes = Math.floor(seconds / 60);
  return `Actualizado hace ${minutes} min`;
}

export function coordinates(latitudeValue: unknown, longitudeValue: unknown) {
  const numeric = (value: unknown) => typeof value === "number" || (typeof value === "string" && value.trim() !== "");
  if (!numeric(latitudeValue) || !numeric(longitudeValue)) return null;
  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);
  return Number.isFinite(latitude) && Math.abs(latitude) <= 90 && Number.isFinite(longitude) && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
}
