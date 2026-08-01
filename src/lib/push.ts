import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import type * as ExpoNotifications from "expo-notifications";
import { Platform } from "react-native";
import { config } from "./config";

export type PushRegistration = {
  deviceId: string;
  expoPushToken: string;
  platform: string;
};

export type PushRegistrationIssue =
  | "unsupported-platform"
  | "expo-go-android"
  | "missing-api-url"
  | "notifications-unavailable"
  | "permission-denied"
  | "permission-blocked"
  | "missing-project-id"
  | "expo-token-failed"
  | "backend-registration-failed";

export type PushRegistrationResult =
  | { ok: true; message: string; registration: PushRegistration }
  | { ok: false; error?: string; message: string; reason: PushRegistrationIssue };

export type LocalNotificationResult =
  | { ok: true; message: string }
  | { ok: false; error?: string; message: string; reason: PushRegistrationIssue | "local-notification-failed" };

const deviceIdKey = "yopido:device-id";
const orderChannelId = "order-status";
const pushRegisterTimeoutMs = 10000;
const deviceTokenTimeoutMs = 20000;
const expoTokenTimeoutMs = 20000;
type NotificationSubscription = { remove: () => void };
type NotificationsModule = typeof ExpoNotifications;
let notificationsPromise: Promise<NotificationsModule> | null = null;

function isExpoGoAndroid() {
  const executionEnvironment = (Constants as { executionEnvironment?: string }).executionEnvironment;
  return Platform.OS === "android" && (Constants.appOwnership === "expo" || executionEnvironment === "storeClient");
}

async function loadNotifications(): Promise<NotificationsModule | null> {
  if (isExpoGoAndroid()) return null;

  if (!notificationsPromise) {
    notificationsPromise = import("expo-notifications").then((Notifications) => {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldPlaySound: true,
          shouldSetBadge: false,
          shouldShowAlert: true,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });
      return Notifications;
    });
  }

  return notificationsPromise;
}

async function ensureOrderNotificationChannel(Notifications: NotificationsModule) {
  if (Platform.OS !== "android") return;

  await Notifications.setNotificationChannelAsync(orderChannelId, {
    importance: Notifications.AndroidImportance.MAX,
    lightColor: "#B7FF00",
    name: "Estados de pedido",
    sound: "default",
    vibrationPattern: [0, 250, 250, 250],
  });
}

async function getDeviceId() {
  const current = await AsyncStorage.getItem(deviceIdKey);
  if (current) return current;

  const next = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await AsyncStorage.setItem(deviceIdKey, next);
  return next;
}

function getProjectId() {
  return config.easProjectId || Constants.easConfig?.projectId || Constants.expoConfig?.extra?.eas?.projectId || "";
}

function getStartupBlocker(): PushRegistrationIssue | null {
  if (Platform.OS === "web") return "unsupported-platform";
  if (isExpoGoAndroid()) return "expo-go-android";
  if (!config.apiBaseUrl) return "missing-api-url";
  return null;
}

function pushIssueMessage(reason: PushRegistrationIssue) {
  if (reason === "unsupported-platform") return "Las notificaciones solo se activan en la app instalada.";
  if (reason === "expo-go-android") return "Las push no funcionan en Expo Go para Android; instala el APK.";
  if (reason === "missing-api-url") return "Falta la URL de la web para registrar este telefono.";
  if (reason === "notifications-unavailable") return "El modulo de notificaciones no esta disponible en este APK.";
  if (reason === "permission-blocked") return "Las notificaciones estan bloqueadas para Yopido. Activalas desde Ajustes del telefono.";
  if (reason === "permission-denied") return "No se concedio permiso para recibir notificaciones.";
  if (reason === "missing-project-id") return "Falta el projectId de Expo/EAS para generar el token push.";
  if (reason === "expo-token-failed") return "No se pudo generar el token push de Expo. Revisa las credenciales FCM del proyecto.";
  return "No se pudo registrar el token push en la web.";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, stage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${stage}-timeout`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function requestNotificationPermission(Notifications: NotificationsModule) {
  const permissions = await Notifications.getPermissionsAsync();
  if (permissions.granted) return { blocked: false, granted: true };
  if (permissions.canAskAgain === false) return { blocked: true, granted: false };

  const requested = await Notifications.requestPermissionsAsync();
  return { blocked: requested.canAskAgain === false, granted: requested.granted };
}

async function postPushRegistration(registration: PushRegistration, customerPhone?: string): Promise<PushRegistrationResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), pushRegisterTimeoutMs);

  try {
    const response = await fetch(`${config.apiBaseUrl.replace(/\/$/, "")}/api/mobile/push/register`, {
      body: JSON.stringify({
        appVersion: Constants.expoConfig?.version,
        customerPhone,
        deviceId: registration.deviceId,
        expoPushToken: registration.expoPushToken,
        platform: registration.platform,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: controller.signal,
    });

    if (response.ok) return null;

    const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
    const error = typeof payload?.error === "string" ? payload.error : `status-${response.status}`;
    return {
      error,
      message: `La web rechazo el registro push (${error}).`,
      ok: false,
      reason: "backend-registration-failed",
    };
  } catch (error) {
    return {
      error: getErrorMessage(error),
      message: "No se pudo conectar con la web para registrar las notificaciones.",
      ok: false,
      reason: "backend-registration-failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestOrderNotificationRegistration(customerPhone?: string): Promise<PushRegistrationResult> {
  const startupBlocker = getStartupBlocker();
  if (startupBlocker) {
    return { message: pushIssueMessage(startupBlocker), ok: false, reason: startupBlocker };
  }

  const Notifications = await loadNotifications();
  if (!Notifications) {
    return {
      message: pushIssueMessage("notifications-unavailable"),
      ok: false,
      reason: "notifications-unavailable",
    };
  }

  try {
    await ensureOrderNotificationChannel(Notifications);
  } catch (error) {
    return {
      error: getErrorMessage(error),
      message: "Android no pudo crear el canal de notificaciones.",
      ok: false,
      reason: "notifications-unavailable",
    };
  }

  const permission = await requestNotificationPermission(Notifications);
  if (!permission.granted) {
    const reason = permission.blocked ? "permission-blocked" : "permission-denied";
    return { message: pushIssueMessage(reason), ok: false, reason };
  }

  const projectId = getProjectId();
  if (!projectId) {
    return { message: pushIssueMessage("missing-project-id"), ok: false, reason: "missing-project-id" };
  }

  let devicePushToken: ExpoNotifications.DevicePushToken;
  try {
    devicePushToken = await withTimeout(
      Notifications.getDevicePushTokenAsync(),
      deviceTokenTimeoutMs,
      "firebase-device-token",
    );
  } catch (error) {
    return {
      error: getErrorMessage(error),
      message: "Firebase no pudo identificar este telefono. Revisa Google Play Services y la conexion.",
      ok: false,
      reason: "expo-token-failed",
    };
  }

  let tokenResult: ExpoNotifications.ExpoPushToken;
  try {
    tokenResult = await withTimeout(
      Notifications.getExpoPushTokenAsync({ devicePushToken, projectId }),
      expoTokenTimeoutMs,
      "expo-push-token",
    );
  } catch (error) {
    return {
      error: getErrorMessage(error),
      message: "El telefono obtuvo Firebase, pero Expo no pudo completar el token push. Revisa la conexion e intenta otra vez.",
      ok: false,
      reason: "expo-token-failed",
    };
  }

  const registration: PushRegistration = {
    deviceId: await getDeviceId(),
    expoPushToken: tokenResult.data,
    platform: Platform.OS,
  };

  const backendError = await postPushRegistration(registration, customerPhone);
  if (backendError) return backendError;

  return {
    message: "Notificaciones de pedidos activadas.",
    ok: true,
    registration,
  };
}

export async function registerForOrderNotifications(customerPhone?: string): Promise<PushRegistration | null> {
  const result = await requestOrderNotificationRegistration(customerPhone);
  return result.ok ? result.registration : null;
}

export async function scheduleOrderNotificationTest(): Promise<LocalNotificationResult> {
  const startupBlocker = getStartupBlocker();
  if (startupBlocker) {
    return { message: pushIssueMessage(startupBlocker), ok: false, reason: startupBlocker };
  }

  const Notifications = await loadNotifications();
  if (!Notifications) {
    return {
      message: pushIssueMessage("notifications-unavailable"),
      ok: false,
      reason: "notifications-unavailable",
    };
  }

  await ensureOrderNotificationChannel(Notifications);
  const permission = await requestNotificationPermission(Notifications);
  if (!permission.granted) {
    const reason = permission.blocked ? "permission-blocked" : "permission-denied";
    return { message: pushIssueMessage(reason), ok: false, reason };
  }

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        body: "Las actualizaciones de tus pedidos apareceran en la barra del telefono.",
        data: { type: "notification_test" },
        sound: "default",
        title: "Notificaciones de Yopido activas",
      },
      trigger:
        Platform.OS === "android"
          ? {
              channelId: orderChannelId,
              seconds: 2,
              type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            }
          : {
              seconds: 2,
              type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            },
    });

    return { message: "Prueba programada. Debe aparecer en la barra en 2 segundos.", ok: true };
  } catch (error) {
    return {
      error: getErrorMessage(error),
      message: "No se pudo mostrar la notificacion de prueba.",
      ok: false,
      reason: "local-notification-failed",
    };
  }
}

export function listenForOrderNotificationOpen(
  onOpen: (payload: { orderId?: string; orderNumber?: string; trackingToken?: string }) => void,
) {
  if (Platform.OS === "web" || isExpoGoAndroid()) {
    return { remove() {} };
  }

  let removed = false;
  let subscription: NotificationSubscription | null = null;

  void loadNotifications()
    .then((Notifications) => {
      if (!Notifications || removed) return;

      subscription = Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data as {
          orderId?: unknown;
          orderNumber?: unknown;
          trackingToken?: unknown;
          type?: unknown;
        };

        if (data.type !== "order_status") return;

        onOpen({
          orderId: typeof data.orderId === "string" ? data.orderId : undefined,
          orderNumber: typeof data.orderNumber === "string" ? data.orderNumber : undefined,
          trackingToken: typeof data.trackingToken === "string" ? data.trackingToken : undefined,
        });
      });
    })
    .catch((error) => {
      console.log("Order notification listener unavailable", {
        error: getErrorMessage(error),
      });
    });

  return {
    remove() {
      removed = true;
      subscription?.remove();
    },
  };
}
