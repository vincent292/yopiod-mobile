import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { GlassContainer, GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import {
  Activity,
  ArrowRight,
  Banknote,
  Bell,
  BellRing,
  Bike,
  CalendarClock,
  ChefHat,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ClipboardCheck,
  Clock3,
  CreditCard,
  Flame,
  Heart,
  Home,
  Info,
  LogOut,
  Mail,
  MapPinned,
  MapPin,
  MessageCircle,
  Minus,
  MoreVertical,
  Navigation,
  PackageCheck,
  Phone,
  Plus,
  QrCode,
  ReceiptText,
  ScanLine,
  Search,
  Send,
  Share2,
  Shirt,
  ShoppingBag,
  Sparkles,
  Store,
  Timer,
  TrendingUp,
  Utensils,
  UserRound,
  UsersRound,
  X,
} from "lucide-react-native";
import { Component, useEffect, useMemo, useRef, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  StatusBar as NativeStatusBar,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import QRCode from "qrcode";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent } from "react-native-webview";
import { EmptyMessage, FadeInView, IconButton, colors } from "./src/components/ui";
import { GroupQrScannerModal } from "./src/features/group-orders/GroupQrScannerModal";
import { addRecentOrder, loadCustomerStore, saveCustomerStore, upsertSavedAddress } from "./src/lib/customer-store";
import type { CustomerStore, RecentOrder, SavedAddress, SavedFavorite } from "./src/lib/customer-store";
import { claimCustomerOrders, createCustomerAddress, customerErrorMessage, fetchCustomerAccount, mapCustomerAddressToSavedAddress, mapCustomerOrderToRecentOrder, registerCustomerAccount, setCustomerFavorite, signInCustomerAccount, updateCustomerProfile } from "./src/lib/customers";
import { signInCustomerWithGoogle } from "./src/lib/auth";
import { getRestaurantBySlug, listHomeDirectory, listRestaurantBusinessHours, listRestaurantCatalog } from "./src/lib/data";
import { config } from "./src/lib/config";
import { clearCache, readCache, readCacheEnvelope, writeCache } from "./src/lib/cache";
import { businessHoursSummary, getBusinessStatus } from "./src/lib/business-hours";
import { distanceInKm, formatDistance } from "./src/lib/distance";
import { groupInviteUrl } from "./src/lib/group-invites";
import type { GroupInviteTarget } from "./src/lib/group-invites";
import { createMobileOrder, getMobileApiError, getMobileOrderStatus, trackMobileOrder } from "./src/lib/orders";
import type { MobileOrderQueueState, MobileOrderStatus, MobileOrderType, MobileTrackedOrder, MobileTrackingResult } from "./src/lib/orders";
import {
  addMobileGroupOrderItem,
  createMobileGroupOrderSession,
  getMobileGroupOrderSession,
  groupOrderErrorMessage,
  joinMobileGroupOrderSession,
  removeMobileGroupOrderItem,
  submitMobileGroupOrder,
  updateMobileGroupHost,
  updateMobileGroupParticipantPayment,
} from "./src/lib/group-orders";
import type { GroupCollectMode, GroupPaymentStatus, MobileGroupItem, MobileGroupOrderState, MobileGroupParticipant, MobileUploadFile } from "./src/lib/group-orders";
import { listenForOrderNotificationOpen, requestOrderNotificationRegistration, scheduleOrderNotificationTest } from "./src/lib/push";
import type { LocalNotificationResult, PushRegistration, PushRegistrationResult } from "./src/lib/push";
import { supabase } from "./src/lib/supabase";
import type { BusinessHour, CategorySummary, HomeDirectory, PopularProductSummary, ProductSummary, RestaurantSummary, UserLocation } from "./src/types/domain";

type Screen =
  | { name: "home" }
  | { name: "restaurant"; slug: string }
  | { name: "group"; restaurantSlug: string; sessionToken?: string; hostAccessToken?: string; participantToken?: string }
  | { name: "orders"; orderId?: string; trackingToken?: string; orderNumber?: string; customerPhone?: string }
  | { name: "promos" }
  | { name: "account" };
type CartLine = {
  cartId: string;
  productId: string;
  variantId?: string;
  optionIds: string[];
  name: string;
  description: string;
  imageUrl: string;
  price: number;
  quantity: number;
  notes?: string;
};
type DeliveryLocation = { latitude: number; longitude: number; mapsUrl: string; label: string };
type AddressDetails = { label: string; apartment: string; reference: string; buildingName: string };
type SessionUser = { id: string; email?: string; accessToken?: string };
type AccountPanelView = "home" | "addresses" | "orders" | "favorites" | "help";
type OrderHistoryFilter = "all" | "delivery" | "pickup";
type FavoriteFilter = "all" | "restaurant" | "product";
type NotificationStatus = "checking" | "disabled" | "error" | "ready" | "unknown";
type GroupOpenTokens = { restaurantSlug?: string; sessionToken?: string; hostAccessToken?: string; participantToken?: string };
type BusinessType = {
  value: string;
  label: string;
  accent: string;
  soft: string;
  icon: "food" | "fashion" | "store" | "sparkles";
};

const cartTtlMs = 30 * 60 * 1000;

function mergeRecentOrderLists(...lists: RecentOrder[][]) {
  const byId = new Map<string, RecentOrder>();
  for (const list of lists) {
    for (const order of list) {
      if (!byId.has(order.id)) byId.set(order.id, order);
    }
  }

  return [...byId.values()]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 50);
}

function mergeFavoriteLists(...lists: SavedFavorite[][]) {
  const byId = new Map<string, SavedFavorite>();
  for (const list of lists) {
    for (const favorite of list) {
      if (!byId.has(favorite.id)) byId.set(favorite.id, favorite);
    }
  }

  return [...byId.values()]
    .sort((left, right) => new Date(right.savedAt).getTime() - new Date(left.savedAt).getTime())
    .slice(0, 100);
}

function restaurantFavorite(restaurant: RestaurantSummary): SavedFavorite {
  return {
    entityId: restaurant.id,
    id: `restaurant:${restaurant.id}`,
    imageUrl: restaurant.bannerUrl || restaurant.logoUrl,
    kind: "restaurant",
    restaurantId: restaurant.id,
    restaurantSlug: restaurant.slug,
    savedAt: new Date().toISOString(),
    subtitle: restaurant.description || restaurant.city || "Local en Yopido",
    title: restaurant.name,
  };
}

function productFavorite(product: ProductSummary, restaurant: RestaurantSummary): SavedFavorite {
  return {
    entityId: product.id,
    id: `product:${product.id}`,
    imageUrl: product.imageUrl,
    kind: "product",
    price: product.price,
    restaurantId: restaurant.id,
    restaurantSlug: restaurant.slug,
    savedAt: new Date().toISOString(),
    subtitle: restaurant.name,
    title: product.name,
  };
}

const defaultBanner = require("./assets/default-food-banner.png");
const logoDark = require("./assets/yopido-logo-dark.png");
const iconDark = require("./assets/yopido-icon-dark-1024.png");
const illustrationDeliveryScooter = require("./assets/illustrations/delivery-scooter-3d.png");
const illustrationOrderStatus = require("./assets/illustrations/order-status-3d.png");
const illustrationOrderSuccess = require("./assets/illustrations/order-success-3d.png");

function isDisplayImage(value?: string | null) {
  return Boolean(value && value.startsWith("http") && !value.includes("imagendefault") && !value.includes("defalutimagen"));
}

function displayImageSource(value?: string | null) {
  return isDisplayImage(value) ? { uri: value as string } : defaultBanner;
}

function formatBs(value: number) {
  return `Bs ${value.toFixed(2).replace(".", ",")}`;
}

function googleMapsUrl(latitude: number, longitude: number) {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

function googleMapsSearchUrl(query: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function restaurantMapsUrl(restaurant: Pick<RestaurantSummary, "address" | "city" | "latitude" | "longitude" | "name">) {
  if (restaurant.latitude != null && restaurant.longitude != null) {
    return googleMapsUrl(restaurant.latitude, restaurant.longitude);
  }
  return googleMapsSearchUrl([restaurant.name, restaurant.address, restaurant.city].filter(Boolean).join(", "));
}

const savedAddressSnapRadiusKm = 0.3;
const cachedHomeLocationMaxAgeMs = 12 * 60 * 60 * 1000;
const lastKnownLocationMaxAgeMs = 5 * 60 * 1000;
const groupUploadMaxBytes = 5 * 1024 * 1024;

function uploadNameFromAsset(asset: ImagePicker.ImagePickerAsset, fallback: string) {
  if (asset.fileName) return asset.fileName;
  const extension = asset.mimeType?.split("/").pop() || asset.uri.split(".").pop()?.split("?")[0] || "jpg";
  return `${fallback}.${extension}`;
}

async function pickGroupImageUpload(fallbackName: string): Promise<MobileUploadFile | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    Alert.alert("Permiso requerido", "Permite acceso a tus fotos para subir el QR o comprobante.");
    return null;
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    allowsEditing: false,
    mediaTypes: ["images"],
    quality: 0.82,
  });
  if (result.canceled || !result.assets[0]) return null;

  const asset = result.assets[0];
  if (asset.fileSize && asset.fileSize > groupUploadMaxBytes) {
    Alert.alert("Archivo muy pesado", "El archivo debe pesar menos de 5 MB.");
    return null;
  }

  return {
    name: uploadNameFromAsset(asset, fallbackName),
    type: asset.mimeType || "image/jpeg",
    uri: asset.uri,
  };
}

function savedAddressToLocation(address: SavedAddress): UserLocation | null {
  if (!Number.isFinite(address.latitude) || !Number.isFinite(address.longitude)) return null;
  return {
    city: address.city || "",
    latitude: Number(address.latitude),
    longitude: Number(address.longitude),
  };
}

function nearestSavedAddress(location: UserLocation, addresses: SavedAddress[]) {
  let nearest: { address: SavedAddress; distanceKm: number } | null = null;

  for (const address of addresses) {
    const addressLocation = savedAddressToLocation(address);
    if (!addressLocation) continue;
    const distanceKm = distanceInKm(location, addressLocation);
    if (!nearest || distanceKm < nearest.distanceKm) {
      nearest = { address, distanceKm };
    }
  }

  return nearest && nearest.distanceKm <= savedAddressSnapRadiusKm ? nearest.address : null;
}

function locationFromCoordinates(latitude: number, longitude: number, city = ""): UserLocation {
  return { city, latitude, longitude };
}

function googleStaticMapUrl(latitude: number, longitude: number) {
  if (!config.googleMapsApiKey) return "";
  const marker = `${latitude},${longitude}`;
  return `https://maps.googleapis.com/maps/api/staticmap?center=${marker}&zoom=16&size=640x260&scale=2&maptype=roadmap&markers=color:red%7C${marker}&key=${config.googleMapsApiKey}`;
}

function clampMapZoom(zoom: number) {
  return Math.min(19, Math.max(3, zoom));
}

function leafletZoomFromDelta(latitudeDelta: number) {
  return clampMapZoom(Math.round(Math.log2(360 / Math.max(latitudeDelta, 0.0001))));
}

function leafletDeltaFromZoom(zoom: number) {
  return 360 / (2 ** clampMapZoom(zoom));
}

function leafletPickerHtml(latitude: number, longitude: number, zoom: number) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; width: 100%; }
    body { background: #F5F8FB; overflow: hidden; }
    .leaflet-control-attribution { background: rgba(255,255,255,0.72); color: #536173; font: 9px/1.2 sans-serif; }
    .leaflet-control-zoom { display: none; }
    .leaflet-tile-pane { filter: saturate(1.06) contrast(1.02); }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    (function () {
      function post(payload) {
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }

      var map = L.map("map", {
        attributionControl: true,
        center: [${latitude}, ${longitude}],
        zoom: ${clampMapZoom(zoom)},
        zoomControl: false
      });

      var tilesLoaded = false;
      var tiles = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
        attribution: "OpenStreetMap, CARTO",
        maxZoom: 19
      }).addTo(map);

      function postRegion(type) {
        var center = map.getCenter();
        post({ type: type, latitude: center.lat, longitude: center.lng, zoom: map.getZoom() });
      }

      tiles.on("load", function () {
        tilesLoaded = true;
        postRegion("loaded");
      });

      tiles.on("tileerror", function () {
        postRegion("tileerror");
      });

      map.whenReady(function () {
        postRegion("ready");
      });

      map.on("moveend", function () {
        postRegion(tilesLoaded ? "region" : "ready");
      });

      map.on("click", function (event) {
        map.setView(event.latlng, map.getZoom(), { animate: true });
      });

      window.setYopidoMapCenter = function (lat, lng, nextZoom) {
        map.setView([lat, lng], nextZoom || map.getZoom(), { animate: true });
      };

      window.zoomYopidoMap = function (direction) {
        map.setZoom(map.getZoom() + (direction === "in" ? 1 : -1));
      };
    })();
  </script>
</body>
</html>`;
}

function publicRestaurantUrl(slug: string) {
  return `https://yopido.shop/${slug}`;
}

async function shareRestaurant(restaurant: RestaurantSummary) {
  const url = publicRestaurantUrl(restaurant.slug);
  await Share.share({
    title: restaurant.name,
    message: `${restaurant.name} en yopido.shop\n${url}`,
    url,
  });
}

async function shareProduct(product: ProductSummary) {
  await Share.share({
    title: product.name,
    message: `${product.name} - ${formatBs(product.price)}\n${product.description || "Disponible para pedir en yopido.shop"}`,
  });
}

const businessTypes: BusinessType[] = [
  { value: "food", label: "Restaurantes y comida", accent: "#C46A14", soft: "#FFF4E6", icon: "food" },
  { value: "fashion", label: "Ropa y moda", accent: "#C018D9", soft: "#FCEBFF", icon: "fashion" },
  { value: "market", label: "Mercados", accent: "#65A30D", soft: "#F2FCE7", icon: "store" },
  { value: "beauty", label: "Belleza", accent: "#E11D48", soft: "#FFF1F4", icon: "sparkles" },
  { value: "other", label: "Otros", accent: colors.blue, soft: colors.softBlue, icon: "store" },
];

export default function App() {
  return (
    <AppErrorBoundary>
      <YopidoApp />
    </AppErrorBoundary>
  );
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { message: string }> {
  state = { message: "" };

  static getDerivedStateFromError(error: Error) {
    return { message: error.message || "La app no pudo iniciar." };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.log("Yopido mobile startup error", error, info.componentStack);
  }

  render() {
    if (this.state.message) {
      return (
        <SafeAreaProvider>
          <SafeAreaView edges={["top"]} style={styles.loading}>
            <Image resizeMode="contain" source={logoDark} style={styles.errorLogo} />
            <Text style={styles.loadingText}>No pudimos abrir Yopido</Text>
            <Text style={styles.startupErrorText}>{this.state.message}</Text>
          </SafeAreaView>
        </SafeAreaProvider>
      );
    }

    return this.props.children;
  }
}

function YopidoApp() {
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [activeLocation, setActiveLocation] = useState<UserLocation | undefined>();
  const [pushRegistration, setPushRegistration] = useState<PushRegistration | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<NotificationStatus>("checking");
  const [notificationMessage, setNotificationMessage] = useState("Revisando notificaciones...");
  const pushOrderSyncRef = useRef(new Set<string>());
  const [customerStore, setCustomerStore] = useState<CustomerStore>({
    profile: { documentNumber: "", name: "", phone: "" },
    addresses: [],
    recentOrders: [],
    favorites: [],
  });

  useEffect(() => {
    NativeStatusBar.setBarStyle("light-content");
    if (Platform.OS === "android") {
      NativeStatusBar.setBackgroundColor(colors.blue);
      NativeStatusBar.setTranslucent(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    requestOrderNotificationRegistration()
      .then((result) => {
        if (!mounted) return;
        applyNotificationRegistrationResult(result);
        if (result.ok) {
          console.log("Order notification registration ready", {
            deviceId: result.registration.deviceId,
            platform: result.registration.platform,
          });
        } else {
          console.log("Order notification registration unavailable", {
            error: result.error,
            reason: result.reason,
          });
        }
      })
      .catch((error) => {
        if (!mounted) return;
        const message = error instanceof Error ? error.message : String(error);
        setPushRegistration(null);
        setNotificationStatus("error");
        setNotificationMessage(`No se pudo activar notificaciones (${message}).`);
        console.log("Order notification registration failed", error);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const subscription = listenForOrderNotificationOpen((order) => {
      if (order.orderId && order.trackingToken) {
        setScreen({ name: "orders", ...order });
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!pushRegistration) return;

    for (const order of customerStore.recentOrders) {
      if (!order.orderNumber || !order.customerPhone) continue;

      const syncKey = `${pushRegistration.expoPushToken}:${order.id}`;
      if (pushOrderSyncRef.current.has(syncKey)) continue;
      pushOrderSyncRef.current.add(syncKey);

      void trackMobileOrder({
        customerPhone: order.customerPhone,
        orderNumber: order.orderNumber,
        push: {
          deviceId: pushRegistration.deviceId,
          expoPushToken: pushRegistration.expoPushToken,
          platform: pushRegistration.platform,
        },
      }).catch((error) => {
        pushOrderSyncRef.current.delete(syncKey);
        console.log("Order notification subscription sync failed", {
          error: error instanceof Error ? error.message : String(error),
          orderId: order.id,
        });
      });
    }
  }, [customerStore.recentOrders, pushRegistration]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (screen.name !== "home") {
        setScreen({ name: "home" });
        return true;
      }
      return true;
    });

    return () => subscription.remove();
  }, [screen]);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      const user = data.session?.user ? { id: data.session.user.id, accessToken: data.session.access_token, email: data.session.user.email ?? undefined } : null;
      setSessionUser(user);
      setCustomerStore(await loadCustomerStoreForUser(user));
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ? { id: session.user.id, accessToken: session.access_token, email: session.user.email ?? undefined } : null;
      setSessionUser(user);
      void loadCustomerStoreForUser(user).then(setCustomerStore);
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (screen.name !== "account" || !sessionUser?.accessToken) return;
    let active = true;
    void loadCustomerStoreForUser(sessionUser).then((store) => {
      if (active) setCustomerStore(store);
    });
    return () => {
      active = false;
    };
  }, [screen.name, sessionUser?.accessToken, sessionUser?.id]);

  async function loadCustomerStoreForUser(user: SessionUser | null) {
    const localStore = await loadCustomerStore(user?.id);
    if (!user?.accessToken) return localStore;
    const deviceStore = await loadCustomerStore();

    try {
      const claimableOrders = mergeRecentOrderLists(localStore.recentOrders, deviceStore.recentOrders)
        .filter((order) => order.trackingToken)
        .slice(0, 20)
        .map((order) => ({ orderId: order.id, trackingToken: order.trackingToken as string }));
      if (claimableOrders.length) {
        const claimed = await claimCustomerOrders(user.accessToken, claimableOrders);
        if (claimed.orderIds.length) {
          const claimedIds = new Set(claimed.orderIds);
          await saveCustomerStore(null, {
            ...deviceStore,
            recentOrders: deviceStore.recentOrders.filter((order) => !claimedIds.has(order.id)),
          });
        }
      }

      const account = await fetchCustomerAccount(user.accessToken);
      const pendingFavorites = mergeFavoriteLists(localStore.favorites, deviceStore.favorites);
      let remoteFavorites = account.favorites ?? [];
      let favoriteSyncComplete = true;
      for (const favorite of pendingFavorites) {
        if (remoteFavorites.some((item) => item.id === favorite.id)) continue;
        if (!favorite.restaurantId) {
          favoriteSyncComplete = false;
          continue;
        }
        try {
          const result = await setCustomerFavorite(user.accessToken, {
            favorite: true,
            kind: favorite.kind,
            productId: favorite.kind === "product" ? favorite.entityId : undefined,
            restaurantId: favorite.restaurantId,
          });
          remoteFavorites = result.favorites;
        } catch {
          favoriteSyncComplete = false;
        }
      }
      if (favoriteSyncComplete && deviceStore.favorites.length) {
        await saveCustomerStore(null, { ...deviceStore, favorites: [] });
      }
      const nextStore: CustomerStore = {
        profile: account.profile
          ? {
              documentNumber: account.profile.documentNumber,
              name: account.profile.fullName,
              phone: account.profile.phone,
            }
          : localStore.profile,
        addresses: account.addresses.map(mapCustomerAddressToSavedAddress),
        recentOrders: mergeRecentOrderLists(
          account.orders.map(mapCustomerOrderToRecentOrder),
          localStore.recentOrders,
          deviceStore.recentOrders,
        ),
        favorites: favoriteSyncComplete ? remoteFavorites : mergeFavoriteLists(remoteFavorites, pendingFavorites),
      };
      await saveCustomerStore(user.id, nextStore);
      return nextStore;
    } catch {
      const fallbackStore = {
        ...localStore,
        recentOrders: mergeRecentOrderLists(localStore.recentOrders, deviceStore.recentOrders),
        favorites: mergeFavoriteLists(localStore.favorites, deviceStore.favorites),
      };
      await saveCustomerStore(user.id, fallbackStore);
      return fallbackStore;
    }
  }

  async function updateCustomerStore(nextStore: CustomerStore) {
    setCustomerStore(nextStore);
    await saveCustomerStore(sessionUser?.id, nextStore);
  }

  async function handleRecentOrder(order: RecentOrder) {
    const recentOrders = await addRecentOrder(sessionUser?.id, order);
    setCustomerStore((current) => ({ ...current, recentOrders }));
  }

  async function handleSavedAddress(address: Omit<SavedAddress, "id" | "updatedAt">) {
    if (sessionUser?.accessToken) {
      const response = await createCustomerAddress(sessionUser.accessToken, {
        address: address.address,
        apartment: address.apartment,
        buildingName: address.buildingName,
        city: address.city,
        isDefault: customerStore.addresses.length === 0,
        label: address.label,
        latitude: address.latitude,
        longitude: address.longitude,
        mapsUrl: address.mapsUrl,
        reference: address.reference,
      });
      const addresses = response.addresses.map(mapCustomerAddressToSavedAddress);
      setCustomerStore((current) => ({ ...current, addresses }));
      await saveCustomerStore(sessionUser.id, { ...customerStore, addresses });
      return addresses;
    }

    const addresses = await upsertSavedAddress(sessionUser?.id, address);
    setCustomerStore((current) => ({ ...current, addresses }));
    return addresses;
  }

  async function handleToggleFavorite(favorite: SavedFavorite) {
    const isSaved = customerStore.favorites.some((item) => item.id === favorite.id);
    const optimisticFavorites = isSaved
      ? customerStore.favorites.filter((item) => item.id !== favorite.id)
      : [{ ...favorite, savedAt: new Date().toISOString() }, ...customerStore.favorites].slice(0, 100);
    await updateCustomerStore({ ...customerStore, favorites: optimisticFavorites });

    if (!sessionUser?.accessToken) return;
    try {
      const result = await setCustomerFavorite(sessionUser.accessToken, {
        favorite: !isSaved,
        kind: favorite.kind,
        productId: favorite.kind === "product" ? favorite.entityId : undefined,
        restaurantId: favorite.restaurantId,
      });
      await updateCustomerStore({ ...customerStore, favorites: result.favorites });
    } catch (error) {
      await updateCustomerStore(customerStore);
      Alert.alert("Favoritos", customerErrorMessage(error));
    }
  }

  function applyNotificationRegistrationResult(result: PushRegistrationResult) {
    setNotificationMessage(result.message);
    if (result.ok) {
      setPushRegistration(result.registration);
      setNotificationStatus("ready");
      return;
    }

    setPushRegistration(null);
    setNotificationStatus(result.reason === "permission-blocked" || result.reason === "permission-denied" ? "disabled" : "error");
  }

  function showNotificationSettingsAlert(message: string) {
    Alert.alert("Notificaciones", message, [
      { style: "cancel", text: "Ahora no" },
      { onPress: () => Linking.openSettings().catch(() => undefined), text: "Abrir ajustes" },
    ]);
  }

  async function handleEnableNotifications(): Promise<PushRegistrationResult> {
    setNotificationStatus("checking");
    setNotificationMessage("Activando notificaciones...");
    const result = await requestOrderNotificationRegistration(customerStore.profile.phone.trim() || undefined);
    applyNotificationRegistrationResult(result);
    if (!result.ok) {
      console.log("Order notification registration unavailable", {
        error: result.error,
        reason: result.reason,
      });
      if (result.reason === "permission-blocked") {
        showNotificationSettingsAlert(result.message);
      }
    }
    return result;
  }

  async function handleTestNotification(): Promise<LocalNotificationResult> {
    const result = await scheduleOrderNotificationTest();
    setNotificationMessage(result.message);
    if (!result.ok) {
      console.log("Order notification local test failed", {
        error: result.error,
        reason: result.reason,
      });
      if (result.reason === "permission-blocked") {
        setNotificationStatus("disabled");
        showNotificationSettingsAlert(result.message);
      } else if (result.reason === "permission-denied") {
        setNotificationStatus("disabled");
      } else {
        setNotificationStatus("error");
      }
    }
    return result;
  }

  return (
    <SafeAreaProvider>
      <ExpoStatusBar style="light" />
      {screen.name === "home" ? (
        <HomeScreen
          activeLocation={activeLocation}
          canSaveAddress={Boolean(sessionUser?.accessToken)}
          favorites={customerStore.favorites}
          onOpenGroupInvite={(target) => {
            if (!target.restaurantSlug) {
              Alert.alert("QR grupal", "Este QR no incluye el local. Escanealo desde el restaurante o comparte el link completo.");
              return;
            }
            setScreen({ name: "group", restaurantSlug: target.restaurantSlug, sessionToken: target.sessionToken });
          }}
          onOpenRestaurant={(slug) => setScreen({ name: "restaurant", slug })}
          onSaveAddress={handleSavedAddress}
          onToggleFavorite={handleToggleFavorite}
          onUseLocation={setActiveLocation}
          savedAddresses={customerStore.addresses}
        />
      ) : null}
      {screen.name === "restaurant" ? (
        <RestaurantScreen
          customerAccessToken={sessionUser?.accessToken}
          customerStore={customerStore}
          onBack={() => setScreen({ name: "home" })}
          onOpenGroupOrder={(tokens) => setScreen({ name: "group", restaurantSlug: tokens?.restaurantSlug ?? screen.slug, ...tokens })}
          onRecentOrder={handleRecentOrder}
          onSavedAddress={handleSavedAddress}
          onToggleFavorite={handleToggleFavorite}
          onTrack={(order) => setScreen({ name: "orders", ...order })}
          pushRegistration={pushRegistration}
          slug={screen.slug}
        />
      ) : null}
      {screen.name === "orders" ? (
        <OrdersScreen
          initialCustomerPhone={screen.customerPhone}
          initialOrderId={screen.orderId}
          initialOrderNumber={screen.orderNumber}
          initialTrackingToken={screen.trackingToken}
          onBack={() => setScreen({ name: "home" })}
          pushRegistration={pushRegistration}
          recentOrders={customerStore.recentOrders}
        />
      ) : null}
      {screen.name === "group" ? (
        <GroupOrderScreen
          customerStore={customerStore}
          hostAccessToken={screen.hostAccessToken}
          onBack={() => setScreen({ name: "restaurant", slug: screen.restaurantSlug })}
          onRecentOrder={handleRecentOrder}
          onSavedAddress={handleSavedAddress}
          onTrack={(order) => setScreen({ name: "orders", ...order })}
          participantToken={screen.participantToken}
          restaurantSlug={screen.restaurantSlug}
          sessionToken={screen.sessionToken}
        />
      ) : null}
      {screen.name === "promos" ? <PromosScreen onOpenRestaurant={(slug) => setScreen({ name: "restaurant", slug })} /> : null}
      {screen.name === "account" ? (
        <AccountScreen
          customerStore={customerStore}
          notificationMessage={notificationMessage}
          notificationStatus={notificationStatus}
          onChangeStore={updateCustomerStore}
          onEnableNotifications={handleEnableNotifications}
          onSaveAddress={handleSavedAddress}
          onTestNotification={handleTestNotification}
          onOpenOrders={() => setScreen({ name: "orders" })}
          onOpenRestaurant={(slug) => setScreen({ name: "restaurant", slug })}
          onOpenRecentOrder={(order) => setScreen({ name: "orders", customerPhone: order.customerPhone, orderId: order.id, orderNumber: order.orderNumber, trackingToken: order.trackingToken })}
          onToggleFavorite={handleToggleFavorite}
          sessionUser={sessionUser}
        />
      ) : null}
      {screen.name !== "restaurant" && screen.name !== "group" ? <BottomNav active={screen.name} onNavigate={(name) => setScreen({ name } as Screen)} /> : null}
    </SafeAreaProvider>
  );
}

function HomeScreen({
  activeLocation,
  canSaveAddress,
  favorites,
  onOpenGroupInvite,
  onOpenRestaurant,
  onSaveAddress,
  onToggleFavorite,
  onUseLocation,
  savedAddresses,
}: {
  activeLocation?: UserLocation;
  canSaveAddress: boolean;
  favorites: SavedFavorite[];
  onOpenGroupInvite: (target: GroupInviteTarget) => void;
  onOpenRestaurant: (slug: string) => void;
  onSaveAddress: (address: Omit<SavedAddress, "id" | "updatedAt">) => Promise<SavedAddress[]>;
  onToggleFavorite: (favorite: SavedFavorite) => void | Promise<void>;
  onUseLocation: (location: UserLocation) => void;
  savedAddresses: SavedAddress[];
}) {
  const [restaurants, setRestaurants] = useState<RestaurantSummary[]>([]);
  const [directory, setDirectory] = useState<HomeDirectory>({
    activeCity: "",
    restaurants: [],
    mostVisited: [],
    mostOrderedRestaurants: [],
    mostOrderedProducts: [],
    productSuggestions: [],
  });
  const [query, setQuery] = useState("");
  const [selectedType, setSelectedType] = useState("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [locationSheetOpen, setLocationSheetOpen] = useState(false);
  const [addressPickerOpen, setAddressPickerOpen] = useState(false);
  const [groupScannerOpen, setGroupScannerOpen] = useState(false);
  const [currentCity, setCurrentCity] = useState("");
  const [loading, setLoading] = useState(Boolean(activeLocation));
  const [autoResolvingLocation, setAutoResolvingLocation] = useState(!activeLocation);
  const [refreshing, setRefreshing] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [addressSaving, setAddressSaving] = useState(false);
  const [error, setError] = useState("");
  const autoLocationAttemptRef = useRef(false);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return restaurants.filter((restaurant) => {
      const matchesQuery = !normalized || [restaurant.name, restaurant.description, restaurant.city, ...restaurant.popularProducts].some((value) => value.toLowerCase().includes(normalized));
      const matchesType = selectedType === "all" || restaurant.businessType === selectedType;
      return matchesQuery && matchesType;
    });
  }, [query, restaurants, selectedType]);

  const featured = useMemo(() => {
    const source = restaurants.length ? restaurants : filtered;
    return source.slice(0, 4);
  }, [filtered, restaurants]);

  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    restaurants.forEach((restaurant) => counts.set(restaurant.businessType, (counts.get(restaurant.businessType) ?? 0) + 1));
    return counts;
  }, [restaurants]);

  const locationTitle = locationLoading
    ? "Detectando..."
    : activeLocation
      ? currentCity || activeLocation.city || "Ubicacion activa"
      : autoResolvingLocation
        ? "Buscando..."
        : "Elegir ubicacion";

  function applyDirectory(nextDirectory: HomeDirectory, nextLocation?: UserLocation) {
    setDirectory(nextDirectory);
    setRestaurants(nextDirectory.restaurants);
    const resolvedLocation = nextLocation
      ? {
          ...nextLocation,
          city: nextDirectory.activeCity || nextLocation.city || "",
        }
      : null;
    setCurrentCity(resolvedLocation?.city || nextDirectory.activeCity || "");
    return resolvedLocation;
  }

  async function load(nextLocation: UserLocation) {
    setError("");
    const nextDirectory = await listHomeDirectory(nextLocation);
    const resolvedLocation = applyDirectory(nextDirectory, nextLocation);
    if (!resolvedLocation) throw new Error("No se pudo resolver la ubicacion.");
    onUseLocation(resolvedLocation);
    await writeCache("home-location", resolvedLocation);
    return nextDirectory;
  }

  async function resolveCurrentLocation(askPermission: boolean) {
    const permission = askPermission ? await Location.requestForegroundPermissionsAsync() : await Location.getForegroundPermissionsAsync();
    if (!permission.granted) return null;

    const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return locationFromDevicePosition(current);
  }

  async function locationFromDevicePosition(position: Location.LocationObject) {
    const rawLocation = locationFromCoordinates(position.coords.latitude, position.coords.longitude);
    const snappedAddress = nearestSavedAddress(rawLocation, savedAddresses);
    if (snappedAddress) {
      return locationFromSavedAddress(snappedAddress);
    }

    const geocode = await Location.reverseGeocodeAsync({ latitude: position.coords.latitude, longitude: position.coords.longitude }).catch(() => []);
    const city = geocode[0]?.city || geocode[0]?.district || geocode[0]?.subregion || geocode[0]?.region || "";
    return locationFromCoordinates(position.coords.latitude, position.coords.longitude, city);
  }

  async function locationFromSavedAddress(address: SavedAddress) {
    if (!Number.isFinite(address.latitude) || !Number.isFinite(address.longitude)) return null;

    let city = address.city || "";
    if (!city) {
      const geocode = await Location.reverseGeocodeAsync({
        latitude: Number(address.latitude),
        longitude: Number(address.longitude),
      }).catch(() => []);
      city = geocode[0]?.city || geocode[0]?.district || geocode[0]?.subregion || geocode[0]?.region || "";
    }

    return {
      latitude: Number(address.latitude),
      longitude: Number(address.longitude),
      city,
    };
  }

  async function refresh() {
    if (!activeLocation) {
      setLocationSheetOpen(true);
      return;
    }

    setRefreshing(true);
    try {
      await load(activeLocation);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar restaurantes.");
    } finally {
      setRefreshing(false);
    }
  }

  async function requestLocation() {
    setLocationLoading(true);
    setError("");
    try {
      const nextLocation = await resolveCurrentLocation(true);
      if (!nextLocation) {
        setError("Activa la ubicacion para mostrar los negocios de tu ciudad.");
        return false;
      }
      await load(nextLocation);
      setLocationSheetOpen(false);
      return true;
    } catch (locationError) {
      setError(locationError instanceof Error ? locationError.message : "No pudimos leer tu ubicacion.");
      return false;
    } finally {
      setLocationLoading(false);
    }
  }

  async function selectSavedAddress(address: SavedAddress) {
    setLocationLoading(true);
    setError("");
    try {
      const nextLocation = await locationFromSavedAddress(address);
      if (!nextLocation) {
        setError("Esta direccion no tiene un punto guardado en el mapa.");
        return;
      }
      await load(nextLocation);
      setLocationSheetOpen(false);
    } catch (locationError) {
      setError(locationError instanceof Error ? locationError.message : "No pudimos usar esta direccion.");
    } finally {
      setLocationLoading(false);
    }
  }

  useEffect(() => {
    if (!activeLocation) {
      let cancelled = false;
      setLoading(true);
      setError("");
      listHomeDirectory()
        .then((nextDirectory) => {
          if (!cancelled) applyDirectory(nextDirectory);
        })
        .catch((loadError) => {
          if (!cancelled) setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar restaurantes.");
        })
        .finally(() => {
          if (!cancelled && !autoResolvingLocation) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    load(activeLocation)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar restaurantes."))
      .finally(() => setLoading(false));
  }, [activeLocation?.latitude, activeLocation?.longitude]);

  useEffect(() => {
    if (activeLocation || autoLocationAttemptRef.current) return;
    autoLocationAttemptRef.current = true;

    let cancelled = false;
    async function resolveInitialLocation() {
      setAutoResolvingLocation(true);
      setLoading(true);
      setError("");

      try {
        const cachedLocation = await readCache<UserLocation>("home-location", cachedHomeLocationMaxAgeMs);
        if (cancelled) return;
        if (cachedLocation) {
          await load(cachedLocation);
        }

        const permission = await Location.getForegroundPermissionsAsync();
        if (cancelled || !permission.granted) return;

        const lastKnown = await Location.getLastKnownPositionAsync({
          maxAge: lastKnownLocationMaxAgeMs,
          requiredAccuracy: 500,
        });
        if (cancelled) return;
        if (lastKnown) {
          const quickLocation = await locationFromDevicePosition(lastKnown);
          if (quickLocation && !cancelled) await load(quickLocation);
        }

        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          mayShowUserSettingsDialog: false,
        });
        if (cancelled) return;
        const nextLocation = await locationFromDevicePosition(current);
        if (nextLocation && !cancelled) await load(nextLocation);
      } catch {
        if (!cancelled) setError("");
      } finally {
        if (!cancelled) {
          setAutoResolvingLocation(false);
          setLoading(false);
        }
      }
    }

    void resolveInitialLocation();
    return () => {
      cancelled = true;
    };
  }, [activeLocation?.latitude, activeLocation?.longitude, savedAddresses.length]);

  useEffect(() => {
    if (!activeLocation || !savedAddresses.length) return;
    const snappedAddress = nearestSavedAddress(activeLocation, savedAddresses);
    const snappedLocation = snappedAddress ? savedAddressToLocation(snappedAddress) : null;
    if (!snappedAddress || !snappedLocation || distanceInKm(activeLocation, snappedLocation) < 0.02) return;

    let cancelled = false;
    locationFromSavedAddress(snappedAddress)
      .then((nextLocation) => {
        if (!cancelled && nextLocation) void load(nextLocation);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [activeLocation?.latitude, activeLocation?.longitude, savedAddresses.length]);

  async function saveAddressFromMap(location: DeliveryLocation, details?: AddressDetails) {
    setAddressSaving(true);
    setError("");
    try {
      const label = details?.label.trim() ?? "";
      const reference = details?.reference.trim() ?? "";
      if (!label || !reference) {
        setError("Completa el nombre y la referencia de la direccion.");
        return;
      }

      const geocode = await Location.reverseGeocodeAsync({ latitude: location.latitude, longitude: location.longitude }).catch(() => []);
      const place = geocode[0];
      const city = place?.city || place?.district || place?.subregion || place?.region || "";
      await onSaveAddress({
        address: location.label,
        apartment: details?.apartment.trim() || undefined,
        buildingName: details?.buildingName.trim() || undefined,
        city,
        label,
        latitude: location.latitude,
        longitude: location.longitude,
        mapsUrl: location.mapsUrl,
        reference,
      });
      await load({ city, latitude: location.latitude, longitude: location.longitude });
      setAddressPickerOpen(false);
      setLocationSheetOpen(false);
    } catch (saveError) {
      setError(customerErrorMessage(saveError));
    } finally {
      setAddressSaving(false);
    }
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.safeBlue}>
      <FlatList
        ListHeaderComponent={
          <>
            <View style={styles.homeHero}>
              <View style={styles.brandRow}>
                <Image resizeMode="contain" source={logoDark} style={styles.brandLogo} />
                <Pressable
                  disabled={locationLoading}
                  onPress={() => setLocationSheetOpen(true)}
                  style={({ pressed }) => [styles.headerLocationButton, pressed && !locationLoading && styles.pressedCard]}
                >
                  <View style={styles.headerLocationIcon}>
                    {locationLoading ? <ActivityIndicator color={colors.blue} size="small" /> : <MapPin color={colors.blue} size={16} strokeWidth={2.5} />}
                  </View>
                  <View style={styles.headerLocationBody}>
                    <Text numberOfLines={1} style={styles.headerLocationLabel}>Ubicacion</Text>
                    <Text numberOfLines={1} style={styles.headerLocationTitle}>{locationTitle}</Text>
                  </View>
                  <ChevronDown color="#FFFFFF" size={15} strokeWidth={2.6} />
                </Pressable>
              </View>

              <Pressable onPress={() => setSearchOpen(true)} style={styles.searchShell}>
                <Text numberOfLines={1} style={[styles.searchPlaceholder, query ? styles.searchValue : null]}>{query || "Locales, platos y productos"}</Text>
                <View style={styles.searchButton}>
                  <Search color={colors.blue} size={23} strokeWidth={2.6} />
                </View>
              </Pressable>
              <Pressable onPress={() => setGroupScannerOpen(true)} style={({ pressed }) => [styles.groupScanHeroButton, pressed && styles.pressedCard]}>
                <ScanLine color={colors.blue} size={18} strokeWidth={3} />
                <Text style={styles.groupScanHeroText}>Escanear QR grupal</Text>
              </Pressable>

              {featured.length ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.featuredRail}>
                  {featured.map((restaurant, index) => (
                    <FeaturedRestaurantCard
                      favorite={favorites.some((favorite) => favorite.id === `restaurant:${restaurant.id}`)}
                      index={index + 1}
                      key={restaurant.id}
                      onPress={() => onOpenRestaurant(restaurant.slug)}
                      onToggleFavorite={() => onToggleFavorite(restaurantFavorite(restaurant))}
                      restaurant={restaurant}
                    />
                  ))}
                </ScrollView>
              ) : (
                <View style={styles.heroLoading}>{loading ? <ActivityIndicator color={colors.green} /> : null}</View>
              )}
              {featured.length > 1 ? (
                <View style={styles.heroDots}>
                  <View style={styles.heroDotActive} />
                  <View style={styles.heroDot} />
                  <View style={styles.heroDot} />
                </View>
              ) : null}
            </View>

            {activeLocation || restaurants.length ? (
              <View style={styles.bodyTop}>
                <SectionTitle eyebrow="Explorar" title="Encuentra tu negocio" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.businessRail}>
                  {businessTypes.map((businessType) => {
                    const count = typeCounts.get(businessType.value) ?? 0;
                    if (!count && restaurants.length && businessType.value !== "other") return null;
                    return <BusinessChip active={selectedType === businessType.value} businessType={businessType} count={count} key={businessType.value} onPress={() => setSelectedType(selectedType === businessType.value ? "all" : businessType.value)} />;
                  })}
                </ScrollView>

                <View style={styles.resultsHeader}>
                  <SectionTitle eyebrow="Resultados" title={activeLocation ? `Negocios en ${currentCity || "tu ciudad"}` : "Negocios disponibles"} />
                  <View style={styles.resultsCount}>
                    <Text style={styles.resultsCountText}>{filtered.length} negocios</Text>
                  </View>
                </View>
                {error ? <Text style={styles.error}>{error}</Text> : null}
              </View>
            ) : null}
          </>
        }
        contentContainerStyle={styles.homeContent}
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl onRefresh={refresh} refreshing={refreshing} tintColor={colors.blue} />}
        renderItem={({ item, index }) => (
          <FadeInView delay={Math.min(index * 40, 180)}>
            <RestaurantResultCard
              favorite={favorites.some((favorite) => favorite.id === `restaurant:${item.id}`)}
              onPress={() => onOpenRestaurant(item.slug)}
              onToggleFavorite={() => onToggleFavorite(restaurantFavorite(item))}
              restaurant={item}
            />
          </FadeInView>
        )}
        ListFooterComponent={
          activeLocation || restaurants.length ? (
            <HomeFooter
              mostOrderedProducts={directory.mostOrderedProducts.length ? directory.mostOrderedProducts : directory.productSuggestions.slice(0, 8)}
              mostOrderedRestaurants={directory.mostOrderedRestaurants.length ? directory.mostOrderedRestaurants : restaurants.slice(0, 4)}
              mostVisited={directory.mostVisited.length ? directory.mostVisited : restaurants.slice(0, 4)}
              onOpenRestaurant={onOpenRestaurant}
            />
          ) : null
        }
        ListEmptyComponent={
          loading
            ? <HomeSkeleton />
            : activeLocation
              ? <EmptyMessage description={`Todavia no hay negocios disponibles en ${currentCity || "esta ciudad"}.`} title="Sin negocios en tu ciudad" />
              : null
        }
      />
      {searchOpen ? (
        <SearchSheet
          onClose={() => setSearchOpen(false)}
          onOpenRestaurant={onOpenRestaurant}
          onSelectBusinessType={(value) => setSelectedType(value)}
          productSuggestions={directory.productSuggestions}
          query={query}
          restaurants={restaurants}
          setQuery={setQuery}
          typeCounts={typeCounts}
        />
      ) : null}
      {locationSheetOpen ? (
        <LocationSheet
          currentCity={currentCity}
          currentLocation={activeLocation}
          error={error}
          loading={locationLoading}
          canAddAddress={canSaveAddress}
          onAddAddress={() => {
            setLocationSheetOpen(false);
            setAddressPickerOpen(true);
          }}
          onClose={() => {
            if (activeLocation) setLocationSheetOpen(false);
          }}
          onSelectAddress={selectSavedAddress}
          onUseCurrentLocation={requestLocation}
          savedAddresses={savedAddresses}
        />
      ) : null}
      {addressPickerOpen ? (
        <MapPickerModal
          collectAddressDetails
          initialLocation={null}
          onClose={() => {
            setAddressPickerOpen(false);
            if (!activeLocation) setLocationSheetOpen(true);
          }}
          onConfirm={saveAddressFromMap}
          saving={addressSaving}
        />
      ) : null}
      {groupScannerOpen ? (
        <GroupQrScannerModal
          onClose={() => setGroupScannerOpen(false)}
          onScanned={(target) => {
            setGroupScannerOpen(false);
            onOpenGroupInvite(target);
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

function RestaurantScreen({
  slug,
  customerAccessToken,
  customerStore,
  onBack,
  onOpenGroupOrder,
  onRecentOrder,
  onSavedAddress,
  onToggleFavorite,
  onTrack,
  pushRegistration,
}: {
  slug: string;
  customerAccessToken?: string;
  customerStore: CustomerStore;
  onBack: () => void;
  onOpenGroupOrder: (tokens?: GroupOpenTokens) => void;
  onRecentOrder: (order: RecentOrder) => void;
  onSavedAddress: (address: Omit<SavedAddress, "id" | "updatedAt">) => void;
  onToggleFavorite: (favorite: SavedFavorite) => void | Promise<void>;
  onTrack: (order?: { customerPhone?: string; orderId?: string; orderNumber?: string; trackingToken?: string }) => void;
  pushRegistration: PushRegistration | null;
}) {
  const [restaurant, setRestaurant] = useState<RestaurantSummary | null>(null);
  const [businessHours, setBusinessHours] = useState<BusinessHour[]>([]);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [categoryId, setCategoryId] = useState("all");
  const [productQuery, setProductQuery] = useState("");
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [cartSavedAt, setCartSavedAt] = useState<number | null>(null);
  const [cartDirty, setCartDirty] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductSummary | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [restaurantMenuOpen, setRestaurantMenuOpen] = useState(false);
  const [restaurantInfoOpen, setRestaurantInfoOpen] = useState(false);
  const [groupStartOpen, setGroupStartOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cartCacheReady, setCartCacheReady] = useState(false);

  const visibleProducts = useMemo(() => {
    const needle = productQuery.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory = categoryId === "all" || product.categoryId === categoryId;
      const matchesQuery = !needle || `${product.name} ${product.description}`.toLowerCase().includes(needle);
      return matchesCategory && matchesQuery;
    });
  }, [categoryId, productQuery, products]);
  const topOrderedProducts = useMemo(() => [...products].sort((first, second) => second.orderCount - first.orderCount).slice(0, 3), [products]);
  const cartItems = Object.values(cart);
  const cartTotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const restaurantIsFavorite = Boolean(restaurant && customerStore.favorites.some((favorite) => favorite.id === `restaurant:${restaurant.id}`));
  const businessStatus = useMemo(() => getBusinessStatus(businessHours), [businessHours]);
  const orderingBlockedByHours = businessStatus.hasSchedule && !businessStatus.isOpen;
  const orderingStatusText = businessStatus.hasSchedule
    ? businessStatus.isOpen
      ? `Abierto hoy ${businessStatus.todayHours}`
      : `Cerrado. Abre ${businessStatus.nextOpeningInputValue.replace("T", " ")}`
    : "Horario por confirmar";
  const heroStatusText = businessStatus.hasSchedule
    ? businessStatus.isOpen
      ? `Abierto hasta las ${businessStatus.todayHours.split(" - ")[1] || businessStatus.todayHours}`
      : `Cerrado · Abre ${formatHeroOpeningLabel(businessStatus.nextOpeningInputValue, businessStatus.currentInputValue)}`
    : "Horario por confirmar";
  const specialtiesText =
    categories.slice(0, 3).map((category) => category.name).filter(Boolean).join(" • ")
    || restaurant?.popularProducts.slice(0, 3).join(" • ")
    || "Catalogo disponible";

  function touchCart() {
    setCartSavedAt(Date.now());
    setCartDirty(true);
  }

  function baseCartLine(product: ProductSummary): CartLine {
    return {
      cartId: product.id,
      productId: product.id,
      optionIds: [],
      name: product.name,
      description: product.description,
      imageUrl: product.imageUrl,
      price: product.price,
      quantity: 0,
    };
  }

  function productQuantity(productId: string) {
    return cartItems.filter((item) => item.productId === productId).reduce((sum, item) => sum + item.quantity, 0);
  }

  function updateLineQuantity(line: CartLine, delta: number) {
    if (orderingBlockedByHours && delta > 0) {
      setHoursOpen(true);
      return;
    }
    touchCart();
    setCart((current) => {
      const nextQuantity = (current[line.cartId]?.quantity ?? 0) + delta;
      if (nextQuantity <= 0) {
        const { [line.cartId]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [line.cartId]: { ...line, quantity: nextQuantity } };
    });
  }

  function addConfiguredLine(line: CartLine) {
    updateLineQuantity(line, 1);
  }

  function quickAddProduct(product: ProductSummary) {
    if (orderingBlockedByHours) {
      setHoursOpen(true);
      return;
    }
    if (product.variants.length || product.optionGroups.length) {
      setSelectedProduct(product);
      return;
    }
    updateLineQuantity(baseCartLine(product), 1);
  }

  function quickRemoveProduct(product: ProductSummary) {
    const baseLine = cart[product.id];
    if (baseLine) {
      updateLineQuantity(baseLine, -1);
      return;
    }
    const firstLine = cartItems.find((item) => item.productId === product.id);
    if (firstLine) updateLineQuantity(firstLine, -1);
  }

  async function openRestaurantMap() {
    if (!restaurant) return;
    await Linking.openURL(restaurantMapsUrl(restaurant)).catch(() => undefined);
  }

  useEffect(() => {
    async function load() {
      const nextRestaurant = await getRestaurantBySlug(slug);
      if (!nextRestaurant) {
        setError("No encontramos este restaurante.");
        return;
      }
      const [catalog, hours] = await Promise.all([
        listRestaurantCatalog(nextRestaurant.slug),
        listRestaurantBusinessHours(nextRestaurant.slug),
      ]);
      setRestaurant(nextRestaurant);
      setBusinessHours(hours);
      setCategories(catalog.categories);
      setProducts(catalog.products);
      const cachedCart = await readCacheEnvelope<Record<string, CartLine>>(`cart:${nextRestaurant.id}`, cartTtlMs);
      if (cachedCart) {
        setCart(cachedCart.value);
        setCartSavedAt(cachedCart.savedAt);
      } else {
        setCart({});
        setCartSavedAt(null);
        await clearCache(`cart:${nextRestaurant.id}`);
      }
      setCartDirty(false);
      setCartCacheReady(true);
    }
    load()
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el menu."))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    if (!restaurant || !cartCacheReady) return;
    if (!cartItems.length) {
      setCartSavedAt(null);
      setCartDirty(false);
      void clearCache(`cart:${restaurant.id}`);
      return;
    }
    if (!cartDirty) return;
    const savedAt = cartSavedAt ?? Date.now();
    if (!cartSavedAt) setCartSavedAt(savedAt);
    void writeCache(`cart:${restaurant.id}`, cart).then(() => setCartDirty(false));
  }, [cart, cartCacheReady, cartDirty, cartItems.length, cartSavedAt, restaurant]);

  useEffect(() => {
    if (!restaurant || !cartSavedAt || !cartItems.length) return;
    const remainingMs = cartTtlMs - (Date.now() - cartSavedAt);
    if (remainingMs <= 0) {
      setCart({});
      setCartSavedAt(null);
      void clearCache(`cart:${restaurant.id}`);
      return;
    }
    const timeout = setTimeout(() => {
      setCart({});
      setCartSavedAt(null);
      void clearCache(`cart:${restaurant.id}`);
    }, remainingMs);
    return () => clearTimeout(timeout);
  }, [cartItems.length, cartSavedAt, restaurant]);

  if (loading) {
    return <YopidoLoader text="Cargando menu..." />;
  }

  if (!restaurant) {
    return (
      <SafeAreaView style={styles.page}>
        <View style={styles.centerContent}>
          <EmptyMessage description={error || "Intenta volver al inicio."} title="Restaurante no disponible" />
          <PrimaryButton onPress={onBack} text="Volver" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.safeBlue}>
      <FlatList
        style={styles.restaurantList}
        ListHeaderComponent={
          <>
            <View style={styles.restaurantTopBar}>
              <View style={styles.restaurantIdentity}>
                <RestaurantLogo restaurant={restaurant} size={42} />
                <View style={styles.restaurantTopText}>
                  <Text numberOfLines={1} style={styles.restaurantTopName}>{restaurant.name}</Text>
                  <Pressable onPress={openRestaurantMap} style={({ pressed }) => [styles.restaurantTopCityRow, pressed && styles.pressedCard]}>
                    <MapPin color={colors.blue} size={13} strokeWidth={2.4} />
                    <Text numberOfLines={1} style={styles.restaurantTopCity}>{restaurant.city || "Ver mapa"}</Text>
                  </Pressable>
                </View>
              </View>
              <View style={styles.restaurantActions}>
                <MiniPill icon={<Navigation color={colors.blue} size={14} strokeWidth={2.5} />} onPress={onTrack} text="Rastrear" />
                <Pressable onPress={() => setCartOpen(true)} style={styles.cartCircle}>
                  <ShoppingBag color={colors.blue} size={20} strokeWidth={2.5} />
                  {cartCount ? <Text style={styles.cartBadge}>{cartCount}</Text> : null}
                </Pressable>
              </View>
            </View>

            <ImageBackground source={displayImageSource(restaurant.bannerUrl)} style={styles.banner} imageStyle={styles.bannerImage}>
              <LinearGradient colors={["rgba(8,36,65,0.06)", "rgba(8,36,65,0.42)", "#12355B"]} locations={[0.12, 0.52, 1]} style={styles.bannerOverlay}>
                <View style={styles.bannerTopActions}>
                  <HeroActionButton accessibilityLabel="Volver" onPress={onBack}>
                    <ChevronLeft color="#FFFFFF" size={22} strokeWidth={2.5} />
                  </HeroActionButton>
                  <View style={styles.bannerActionGroup}>
                    <HeroActionButton accessibilityLabel={restaurantIsFavorite ? "Quitar favorito" : "Guardar favorito"} onPress={() => onToggleFavorite(restaurantFavorite(restaurant))}>
                      <Heart color="#FFFFFF" fill={restaurantIsFavorite ? colors.green : "transparent"} size={19} strokeWidth={2.5} />
                    </HeroActionButton>
                    <HeroActionButton accessibilityLabel="Mas opciones" onPress={() => setRestaurantMenuOpen(true)}>
                      <MoreVertical color="#FFFFFF" size={20} strokeWidth={2.5} />
                    </HeroActionButton>
                  </View>
                </View>

                <View style={styles.heroInfoBlock}>
                  <View style={styles.heroPillRow}>
                    <Pressable onPress={openRestaurantMap} style={({ pressed }) => [styles.heroLocationPill, pressed && styles.heroPillPressed]}>
                      <MapPin color="#FFFFFF" size={14} strokeWidth={2.5} />
                      <Text ellipsizeMode="tail" numberOfLines={1} style={styles.heroLocationText}>{restaurant.city || "Ver mapa"}</Text>
                    </Pressable>
                    <Pressable onPress={() => setHoursOpen(true)} style={({ pressed }) => [styles.heroStatusPill, pressed && styles.heroPillPressed]}>
                      <View style={[styles.heroStatusDot, orderingBlockedByHours && styles.heroStatusDotClosed]} />
                      <Text ellipsizeMode="tail" numberOfLines={1} style={styles.heroStatusText}>{heroStatusText}</Text>
                    </Pressable>
                  </View>

                  <Text ellipsizeMode="tail" numberOfLines={2} style={styles.restaurantName}>{restaurant.name}</Text>
                  <Text ellipsizeMode="tail" numberOfLines={1} style={styles.restaurantSubtitle}>{specialtiesText}</Text>

                  <View style={styles.bannerMetrics}>
                    <HeroMetric icon={<Clock3 color={colors.green} size={17} strokeWidth={2.2} />} label="Entrega estimada" value="25-35 min" />
                    <View style={styles.heroMetricDivider} />
                    <HeroMetric icon={<Bike color={colors.green} size={17} strokeWidth={2.2} />} label="Disponible" value="Delivery" />
                    <View style={styles.heroMetricDivider} />
                    <HeroMetric icon={<Utensils color={colors.green} size={17} strokeWidth={2.2} />} label="Mas vendidos" value={`${products.length} platos`} />
                  </View>
                </View>
              </LinearGradient>
            </ImageBackground>

            {topOrderedProducts.length ? (
              <View style={styles.restaurantTopProducts}>
                <View style={styles.restaurantSectionHeader}>
                  <View>
                    <Text style={styles.restaurantSectionEyebrow}>Mas pedidos</Text>
                    <Text style={styles.restaurantSectionTitle}>Lo que mas eligen</Text>
                  </View>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.topProductRail}>
                  {topOrderedProducts.map((product) => (
                    <Pressable key={product.id} onPress={() => setSelectedProduct(product)} style={({ pressed }) => [styles.topProductCard, pressed && styles.pressedCard]}>
                      <ImageBackground source={displayImageSource(product.imageUrl)} style={styles.topProductImage} imageStyle={styles.topProductImageRadius} />
                      <View style={styles.topProductBody}>
                        <Text numberOfLines={1} style={styles.topProductName}>{product.name}</Text>
                        <Text style={styles.topProductMeta}>{product.orderCount || 0} pedidos</Text>
                      </View>
                      <View style={[styles.topProductAdd, orderingBlockedByHours && styles.addButtonDisabled]}>
                        <Plus color={colors.blue} size={18} strokeWidth={2.8} />
                      </View>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            <Pressable onPress={() => setGroupStartOpen(true)} style={({ pressed }) => [styles.groupEntryCard, pressed && styles.pressedCard]}>
              <View style={styles.groupEntryIcon}>
                <UsersRound color={colors.blue} size={24} strokeWidth={3} />
              </View>
              <View style={styles.groupEntryBody}>
                <Text style={styles.groupEntryTitle}>Yopido Grupal</Text>
                <Text style={styles.groupEntryText}>Pidan entre amigos, cada uno agrega su parte y el host finaliza una sola orden.</Text>
              </View>
              <ArrowRight color={colors.blue} size={20} strokeWidth={3} />
            </Pressable>

            <View style={styles.restaurantSearchShell}>
              <Search color={colors.muted} size={19} strokeWidth={3} />
              <TextInput
                onChangeText={setProductQuery}
                placeholder="Busca productos o combos"
                placeholderTextColor="#8A98AB"
                style={styles.restaurantSearchInput}
                value={productQuery}
              />
              {productQuery ? (
                <Pressable onPress={() => setProductQuery("")} style={styles.restaurantSearchClear}>
                  <X color="#FFFFFF" size={16} strokeWidth={3} />
                </Pressable>
              ) : null}
            </View>

            <View style={styles.categorySection}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRail}>
                <CategoryChip active={categoryId === "all"} label="Todo" onPress={() => setCategoryId("all")} />
                {categories.map((category) => <CategoryChip active={categoryId === category.id} key={category.id} label={category.name} onPress={() => setCategoryId(category.id)} />)}
              </ScrollView>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.menuHeader}>
              <SectionTitle eyebrow="Menu" title="Elige tus platos" />
              <View style={styles.resultsCount}>
                <Text style={styles.resultsCountText}>{visibleProducts.length}</Text>
              </View>
            </View>
          </>
        }
        contentContainerStyle={styles.contentWithCart}
        data={visibleProducts}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <FadeInView delay={Math.min(index * 35, 160)}>
            <ProductCard
              favorite={customerStore.favorites.some((favorite) => favorite.id === `product:${item.id}`)}
              onAdd={() => quickAddProduct(item)}
              orderingDisabled={orderingBlockedByHours}
              onMinus={() => quickRemoveProduct(item)}
              onPress={() => setSelectedProduct(item)}
              onToggleFavorite={() => onToggleFavorite(productFavorite(item, restaurant))}
              product={item}
              quantity={productQuantity(item.id)}
            />
          </FadeInView>
        )}
        ListEmptyComponent={<EmptyMessage description="Cuando el local agregue productos disponibles apareceran aqui." title="Menu vacio" />}
      />

      <FloatingCart count={cartCount} onPress={() => setCartOpen(true)} total={cartTotal} />
      {selectedProduct ? (
        <ProductModal
          onAdd={addConfiguredLine}
          onClose={() => setSelectedProduct(null)}
          orderingDisabled={orderingBlockedByHours}
          orderingDisabledReason={orderingStatusText}
          product={selectedProduct}
          quantity={productQuantity(selectedProduct.id)}
        />
      ) : null}
      {cartOpen ? (
        <CartSheet
          customerAccessToken={customerAccessToken}
          customerStore={customerStore}
          orderingDisabled={orderingBlockedByHours}
          orderingDisabledReason={orderingStatusText}
          items={cartItems}
          onClearCart={() => {
            setCart({});
            setCartSavedAt(null);
            setCartDirty(false);
          }}
          onChangeQuantity={updateLineQuantity}
          onClose={() => setCartOpen(false)}
          onRecentOrder={onRecentOrder}
          onSavedAddress={onSavedAddress}
          onTrackOrder={(order) => {
            setCartOpen(false);
            onTrack(order);
          }}
          pushRegistration={pushRegistration}
          restaurant={restaurant}
          total={cartTotal}
        />
      ) : null}
      {hoursOpen ? <BusinessHoursModal hours={businessHours} onClose={() => setHoursOpen(false)} statusText={orderingStatusText} /> : null}
      {restaurantMenuOpen ? (
        <RestaurantOptionsSheet
          onClose={() => setRestaurantMenuOpen(false)}
          onInfo={() => {
            setRestaurantMenuOpen(false);
            setRestaurantInfoOpen(true);
          }}
          onReport={() => {
            setRestaurantMenuOpen(false);
            Alert.alert("Reportar local", "Gracias. Revisaremos este local con el equipo de Yopido.");
          }}
          onShare={() => {
            setRestaurantMenuOpen(false);
            void shareRestaurant(restaurant);
          }}
          onShowHours={() => {
            setRestaurantMenuOpen(false);
            setHoursOpen(true);
          }}
        />
      ) : null}
      {restaurantInfoOpen ? <RestaurantInfoSheet onClose={() => setRestaurantInfoOpen(false)} onOpenMap={openRestaurantMap} restaurant={restaurant} /> : null}
      {groupStartOpen ? (
        <GroupOrderStartSheet
          customerStore={customerStore}
          onClose={() => setGroupStartOpen(false)}
          onOpenGroup={(tokens) => {
            setGroupStartOpen(false);
            onOpenGroupOrder(tokens);
          }}
          restaurant={restaurant}
        />
      ) : null}
    </SafeAreaView>
  );
}

function GroupOrderStartSheet({
  customerStore,
  restaurant,
  onClose,
  onOpenGroup,
}: {
  customerStore: CustomerStore;
  restaurant: RestaurantSummary;
  onClose: () => void;
  onOpenGroup: (tokens: GroupOpenTokens) => void;
}) {
  const [mode, setMode] = useState<"create" | "join">("create");
  const [hostName, setHostName] = useState(customerStore.profile.name);
  const [hostPhone, setHostPhone] = useState(customerStore.profile.phone);
  const [displayName, setDisplayName] = useState(customerStore.profile.name);
  const [phone, setPhone] = useState(customerStore.profile.phone);
  const [sessionToken, setSessionToken] = useState("");
  const [collectMode, setCollectMode] = useState<GroupCollectMode>("host_collects");
  const [hostQrFile, setHostQrFile] = useState<MobileUploadFile | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function createSession() {
    if (!hostName.trim()) {
      setError("Escribe tu nombre para crear la sala.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await createMobileGroupOrderSession({
        collectMode,
        hostName: hostName.trim(),
        hostPhone: hostPhone.trim() || undefined,
        hostQrFile: collectMode === "host_collects" ? hostQrFile : null,
        restaurantSlug: restaurant.slug,
      });
      onOpenGroup({
        hostAccessToken: result.hostAccessToken,
        participantToken: result.participantToken,
        sessionToken: result.sessionToken,
      });
    } catch (nextError) {
      setError(groupOrderErrorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }

  async function joinSession() {
    const cleanToken = sessionToken.trim();
    if (!cleanToken || !displayName.trim()) {
      setError("Agrega el codigo y tu nombre para unirte.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await joinMobileGroupOrderSession(cleanToken, {
        displayName: displayName.trim(),
        phone: phone.trim() || undefined,
      });
      onOpenGroup({ participantToken: result.participantToken, sessionToken: cleanToken });
    } catch (nextError) {
      setError(groupOrderErrorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }

  function openScannedGroup(target: GroupInviteTarget) {
    const nextRestaurantSlug = target.restaurantSlug ?? restaurant.slug;
    setScannerOpen(false);
    onOpenGroup({ restaurantSlug: nextRestaurantSlug, sessionToken: target.sessionToken });
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} visible>
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView edges={["bottom"]} style={styles.groupStartSheet}>
          <View style={styles.mapPickerHandle} />
          <View style={styles.cartSheetHeader}>
            <View>
              <Text style={styles.cartSheetEyebrow}>Yopido Grupal</Text>
              <Text style={styles.cartSheetTitle}>{mode === "create" ? "Crear sala" : "Unirme"}</Text>
            </View>
            <IconButton light onPress={onClose}><X color={colors.blue} size={22} strokeWidth={3} /></IconButton>
          </View>

          <View style={styles.segmentRow}>
            <SegmentButton active={mode === "create"} icon={<UsersRound color={mode === "create" ? colors.blue : colors.muted} size={16} strokeWidth={3} />} onPress={() => setMode("create")} text="Crear" />
            <SegmentButton active={mode === "join"} icon={<UsersRound color={mode === "join" ? colors.blue : colors.muted} size={16} strokeWidth={3} />} onPress={() => setMode("join")} text="Unirme" />
          </View>
          <Pressable onPress={() => setScannerOpen(true)} style={({ pressed }) => [styles.groupScanInlineButton, pressed && styles.pressedCard]}>
            <ScanLine color={colors.blue} size={17} strokeWidth={3} />
            <Text style={styles.groupScanInlineText}>Escanear QR para entrar</Text>
          </Pressable>

          {mode === "create" ? (
            <View style={styles.groupStartForm}>
              <InputBox onChangeText={setHostName} placeholder="Tu nombre" value={hostName} />
              <InputBox keyboardType="phone-pad" onChangeText={setHostPhone} placeholder="WhatsApp del host" value={hostPhone} />
              <View style={styles.groupModeGrid}>
                <ChoiceCard
                  active={collectMode === "host_collects"}
                  icon={<UsersRound color={collectMode === "host_collects" ? "#FFFFFF" : colors.blue} size={20} strokeWidth={3} />}
                  label="Todos me pagan"
                  onPress={() => setCollectMode("host_collects")}
                  text="Subes tu QR o cobras por fuera y haces un solo pago."
                />
                <ChoiceCard
                  active={collectMode === "restaurant_collects"}
                  icon={<CreditCard color={collectMode === "restaurant_collects" ? "#FFFFFF" : colors.blue} size={20} strokeWidth={3} />}
                  label="Cada uno paga"
                  onPress={() => setCollectMode("restaurant_collects")}
                  text="Cada participante confirma su pago al restaurante."
                />
              </View>
              {collectMode === "host_collects" ? (
                <UploadPicker
                  description="Se guarda temporalmente para esta sala."
                  file={hostQrFile}
                  label="QR para que te paguen"
                  onClear={() => setHostQrFile(null)}
                  onPick={async () => {
                    const file = await pickGroupImageUpload("qr-host");
                    if (file) setHostQrFile(file);
                  }}
                />
              ) : null}
              <PrimaryButton loading={loading} onPress={createSession} text={loading ? "Creando..." : "Crear sala grupal"} />
            </View>
          ) : (
            <View style={styles.groupStartForm}>
              <InputBox autoCapitalize="none" onChangeText={(value) => setSessionToken(value.trim())} placeholder="Codigo de sala" value={sessionToken} />
              <InputBox onChangeText={setDisplayName} placeholder="Tu nombre" value={displayName} />
              <InputBox keyboardType="phone-pad" onChangeText={setPhone} placeholder="WhatsApp (opcional)" value={phone} />
              <PrimaryButton loading={loading} onPress={joinSession} text={loading ? "Uniendo..." : "Unirme a la sala"} />
            </View>
          )}
          {error ? <Text style={styles.submitError}>{error}</Text> : null}
          {scannerOpen ? (
            <GroupQrScannerModal
              fallbackRestaurantSlug={restaurant.slug}
              onClose={() => setScannerOpen(false)}
              onScanned={openScannedGroup}
            />
          ) : null}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function GroupOrderScreen({
  customerStore,
  hostAccessToken,
  participantToken,
  restaurantSlug,
  sessionToken,
  onBack,
  onRecentOrder,
  onSavedAddress,
  onTrack,
}: {
  customerStore: CustomerStore;
  hostAccessToken?: string;
  participantToken?: string;
  restaurantSlug: string;
  sessionToken?: string;
  onBack: () => void;
  onRecentOrder: (order: RecentOrder) => void;
  onSavedAddress: (address: Omit<SavedAddress, "id" | "updatedAt">) => void;
  onTrack: (order: { customerPhone?: string; orderId: string; orderNumber?: string; trackingToken: string }) => void;
}) {
  const [state, setState] = useState<MobileGroupOrderState | null>(null);
  const [restaurant, setRestaurant] = useState<RestaurantSummary | null>(null);
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [categoryId, setCategoryId] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<ProductSummary | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [localParticipantToken, setLocalParticipantToken] = useState(participantToken);
  const [localHostAccessToken] = useState(hostAccessToken);
  const [joinName, setJoinName] = useState(customerStore.profile.name);
  const [joinPhone, setJoinPhone] = useState(customerStore.profile.phone);
  const [inviteQrDataUrl, setInviteQrDataUrl] = useState("");
  const [loading, setLoading] = useState(Boolean(sessionToken));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const resolvedSessionToken = sessionToken || state?.session.publicToken || "";
  const currentParticipant = state?.participants.find((participant) => participant.id === state.currentParticipantId);
  const isHost = Boolean(state?.isHost && localHostAccessToken);
  const visibleProducts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory = categoryId === "all" || product.categoryId === categoryId;
      const matchesQuery = !needle || `${product.name} ${product.description}`.toLowerCase().includes(needle);
      return matchesCategory && matchesQuery;
    });
  }, [categoryId, products, query]);
  const totalsByParticipant = useMemo(() => {
    const totals = new Map<string, number>();
    state?.items.forEach((item) => totals.set(item.participantId, (totals.get(item.participantId) ?? 0) + item.subtotal));
    return totals;
  }, [state?.items]);
  const groupSubtotal = state?.items
    .filter((item) => state.participants.find((participant) => participant.id === item.participantId)?.paymentStatus !== "excluded")
    .reduce((sum, item) => sum + item.subtotal, 0) ?? 0;
  const participantSubmitted = Boolean(!isHost && currentParticipant && currentParticipant.paymentStatus !== "pending");
  const canModify = Boolean(state && state.session.status === "open" && (isHost || !participantSubmitted));
  const inviteUrl = resolvedSessionToken ? groupInviteUrl(restaurantSlug, resolvedSessionToken) : "";

  async function refresh(silent = false) {
    if (!resolvedSessionToken) return;
    if (!silent) setLoading(true);
    try {
      const nextState = await getMobileGroupOrderSession(resolvedSessionToken, {
        hostAccessToken: localHostAccessToken,
        participantToken: localParticipantToken,
      });
      setState(nextState);
      const nextRestaurant = nextState.restaurant ?? (await getRestaurantBySlug(restaurantSlug));
      if (nextRestaurant) {
        setRestaurant(nextRestaurant);
        const catalog = await listRestaurantCatalog(nextRestaurant.slug);
        setCategories(catalog.categories);
        setProducts(catalog.products);
      }
      setError("");
    } catch (nextError) {
      setError(groupOrderErrorMessage(nextError));
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function handleAddLine(line: CartLine) {
    if (!resolvedSessionToken || !localParticipantToken) {
      setError("Unete a la sala antes de agregar productos.");
      return;
    }
    setBusy(true);
    try {
      const nextState = await addMobileGroupOrderItem(resolvedSessionToken, {
        optionIds: line.optionIds,
        participantToken: localParticipantToken,
        productId: line.productId,
        variantId: line.variantId,
        notes: line.notes,
      });
      setState(nextState);
      setError("");
    } catch (nextError) {
      setError(groupOrderErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function quickAddProduct(product: ProductSummary) {
    if (product.variants.length || product.optionGroups.length) {
      setSelectedProduct(product);
      return;
    }
    await handleAddLine({
      cartId: product.id,
      description: product.description,
      imageUrl: product.imageUrl,
      name: product.name,
      optionIds: [],
      price: product.price,
      productId: product.id,
      quantity: 0,
    });
  }

  async function removeItem(item: MobileGroupItem) {
    if (!resolvedSessionToken) return;
    setBusy(true);
    try {
      const nextState = await removeMobileGroupOrderItem(resolvedSessionToken, {
        hostAccessToken: localHostAccessToken,
        itemId: item.id,
        participantToken: localParticipantToken,
      });
      setState(nextState);
    } catch (nextError) {
      setError(groupOrderErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function markPayment(paymentStatus: GroupPaymentStatus, paymentReceiptFile?: MobileUploadFile | null, paymentReceiptUrl?: string) {
    if (!resolvedSessionToken || !localParticipantToken) return;
    setBusy(true);
    try {
      const nextState = await updateMobileGroupParticipantPayment(resolvedSessionToken, {
        participantToken: localParticipantToken,
        paymentReceiptFile,
        paymentReceiptUrl,
        paymentStatus,
      });
      setState(nextState);
      setError("");
    } catch (nextError) {
      setError(groupOrderErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function hostAction(action: "open" | "locked" | "cancelled") {
    if (!resolvedSessionToken || !localHostAccessToken) return;
    setBusy(true);
    try {
      setState(await updateMobileGroupHost(resolvedSessionToken, { action: "status", hostAccessToken: localHostAccessToken, status: action }));
    } catch (nextError) {
      setError(groupOrderErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function hostParticipant(participantId: string, paymentStatus: GroupPaymentStatus) {
    if (!resolvedSessionToken || !localHostAccessToken) return;
    setBusy(true);
    try {
      setState(await updateMobileGroupHost(resolvedSessionToken, { action: "participant", hostAccessToken: localHostAccessToken, participantId, paymentStatus }));
    } catch (nextError) {
      setError(groupOrderErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function shareGroup() {
    if (!resolvedSessionToken) return;
    await Share.share({
      message: `Unete a mi Yopido Grupal en ${restaurant?.name ?? "Yopido"}.\nCodigo: ${resolvedSessionToken}\n${inviteUrl}`,
    }).catch(() => undefined);
  }

  async function joinCurrentSession() {
    if (!resolvedSessionToken || !joinName.trim()) {
      setError("Escribe tu nombre para unirte al pedido.");
      return;
    }
    setBusy(true);
    try {
      const result = await joinMobileGroupOrderSession(resolvedSessionToken, {
        displayName: joinName.trim(),
        phone: joinPhone.trim() || undefined,
      });
      setLocalParticipantToken(result.participantToken);
      setState(result);
      setError("");
    } catch (nextError) {
      setError(groupOrderErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [resolvedSessionToken]);

  useEffect(() => {
    if (!inviteUrl) {
      setInviteQrDataUrl("");
      return;
    }
    QRCode.toDataURL(inviteUrl, { margin: 1, width: 280 })
      .then(setInviteQrDataUrl)
      .catch(() => setInviteQrDataUrl(""));
  }, [inviteUrl]);

  useEffect(() => {
    if (!resolvedSessionToken || state?.session.status === "submitted" || state?.session.status === "cancelled") return;
    const interval = setInterval(() => void refresh(true), state?.session.status === "open" ? 5000 : 10000);
    return () => clearInterval(interval);
  }, [resolvedSessionToken, state?.session.status, localParticipantToken, localHostAccessToken]);

  if (loading && !state) return <YopidoLoader text="Cargando Yopido Grupal..." />;

  if (!state || !restaurant) {
    return (
      <SafeAreaView style={styles.page}>
        <View style={styles.centerContent}>
          <EmptyMessage description={error || "Vuelve al restaurante e intenta nuevamente."} title="Sala no disponible" />
          <PrimaryButton onPress={onBack} text="Volver" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.safeBlue}>
      <FlatList
        style={styles.restaurantList}
        ListHeaderComponent={
          <>
            <View style={styles.groupHero}>
              <View style={styles.bannerTopActions}>
                <HeroActionButton accessibilityLabel="Volver" onPress={onBack}>
                  <ChevronLeft color="#FFFFFF" size={22} strokeWidth={2.5} />
                </HeroActionButton>
                <HeroActionButton accessibilityLabel="Compartir" onPress={shareGroup}>
                  <Share2 color="#FFFFFF" size={20} strokeWidth={2.5} />
                </HeroActionButton>
              </View>
              <Text style={styles.tabEyebrow}>Yopido Grupal</Text>
              <Text style={styles.tabTitle}>{restaurant.name}</Text>
              <Text style={styles.tabCopy}>Codigo {state.session.publicToken} · {state.participants.length} participantes · {formatBs(groupSubtotal)}</Text>
              <View style={styles.groupStatusRow}>
                <View style={styles.groupStatusPill}><Text style={styles.groupStatusText}>{groupStatusLabel(state.session.status)}</Text></View>
                {busy ? <ActivityIndicator color={colors.green} /> : null}
              </View>
            </View>

            <View style={styles.groupInviteCard}>
              <View style={styles.groupInviteHeader}>
                <View style={styles.groupInviteIcon}>
                  <QrCode color={colors.blue} size={22} strokeWidth={3} />
                </View>
                <View style={styles.groupEntryBody}>
                  <Text style={styles.groupEntryTitle}>Invitar por QR</Text>
                  <Text style={styles.groupEntryText}>Escanealo desde otra app Yopido o comparte el link.</Text>
                </View>
              </View>
              {inviteQrDataUrl ? <Image source={{ uri: inviteQrDataUrl }} style={styles.groupInviteQr} /> : null}
              <Pressable onPress={shareGroup} style={({ pressed }) => [styles.groupShareButton, pressed && styles.pressedCard]}>
                <Share2 color={colors.blue} size={16} strokeWidth={3} />
                <Text style={styles.groupShareButtonText}>Compartir invitacion</Text>
              </Pressable>
            </View>

            {!currentParticipant && !isHost && state.session.status === "open" ? (
              <View style={styles.groupPanel}>
                <SectionTitle eyebrow="Unirme" title="Entrar al pedido" />
                <Text style={styles.paymentHint}>No necesitas cuenta. Solo usamos tu nombre para separar lo que agregas.</Text>
                <InputBox onChangeText={setJoinName} placeholder="Tu nombre" value={joinName} />
                <InputBox keyboardType="phone-pad" onChangeText={setJoinPhone} placeholder="WhatsApp (opcional)" value={joinPhone} />
                <PrimaryButton loading={busy} onPress={joinCurrentSession} text={busy ? "Entrando..." : "Entrar al pedido"} />
              </View>
            ) : null}

            {participantSubmitted && !isHost ? (
              <View style={styles.groupSubmittedCard}>
                <CheckCircle2 color={colors.blue} size={34} strokeWidth={3} />
                <Text style={styles.groupSubmittedTitle}>Tu parte fue enviada</Text>
                <Text style={styles.groupSubmittedText}>El host ya puede verla. Si quieres agregar algo mas, se pedira confirmar de nuevo tu pago.</Text>
                <PrimaryButton onPress={() => markPayment("pending")} text="Agregar algo mas" />
              </View>
            ) : null}

            <View style={styles.groupPanel}>
              <View style={styles.restaurantSectionHeader}>
                <SectionTitle eyebrow="Participantes" title="Resumen del grupo" />
                <Text style={styles.groupTotal}>{formatBs(groupSubtotal)}</Text>
              </View>
              <View style={styles.groupParticipantsList}>
                {state.participants.map((participant) => (
                  <GroupParticipantCard
                    isHost={isHost}
                    key={participant.id}
                    onChangeStatus={(paymentStatus) => hostParticipant(participant.id, paymentStatus)}
                    participant={participant}
                    total={totalsByParticipant.get(participant.id) ?? 0}
                  />
                ))}
              </View>
              {isHost ? (
                <View style={styles.groupHostActions}>
                  <PrimaryButton onPress={() => hostAction(state.session.status === "locked" ? "open" : "locked")} text={state.session.status === "locked" ? "Reabrir sala" : "Cerrar ingreso"} />
                  <PrimaryButton disabled={!state.items.length} onPress={() => setCheckoutOpen(true)} text="Finalizar pedido grupal" />
                  <Pressable onPress={() => hostAction("cancelled")} style={styles.groupDangerButton}>
                    <Text style={styles.groupDangerText}>Cancelar sala</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>

            {currentParticipant && !participantSubmitted ? (
              <ParticipantPaymentBox
                collectMode={state.session.collectMode}
                hostQrUrl={state.session.hostQrUrl}
                onMarkPayment={markPayment}
                participant={currentParticipant}
                total={totalsByParticipant.get(currentParticipant.id) ?? 0}
              />
            ) : null}

            {canModify ? (
              <>
                <View style={styles.restaurantSearchShell}>
                  <Search color={colors.muted} size={19} strokeWidth={3} />
                  <TextInput onChangeText={setQuery} placeholder="Busca productos para tu parte" placeholderTextColor="#8A98AB" style={styles.restaurantSearchInput} value={query} />
                </View>
                <View style={styles.categorySection}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRail}>
                    <CategoryChip active={categoryId === "all"} label="Todo" onPress={() => setCategoryId("all")} />
                    {categories.map((category) => <CategoryChip active={categoryId === category.id} key={category.id} label={category.name} onPress={() => setCategoryId(category.id)} />)}
                  </ScrollView>
                </View>
              </>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </>
        }
        contentContainerStyle={styles.contentWithCart}
        data={canModify ? visibleProducts : []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ProductCard
            favorite={false}
            onAdd={() => void quickAddProduct(item)}
            onMinus={() => undefined}
            onPress={() => setSelectedProduct(item)}
            onToggleFavorite={() => undefined}
            orderingDisabled={busy}
            product={item}
            quantity={state.items.filter((groupItem) => groupItem.productId === item.id && groupItem.participantId === state.currentParticipantId).length}
          />
        )}
        ListFooterComponent={
          <View style={styles.groupItemsFooter}>
            <Text style={styles.restaurantSectionTitle}>Productos agregados</Text>
            {state.items.length ? state.items.map((item) => {
              const owner = state.participants.find((participant) => participant.id === item.participantId);
              const canRemoveItem = isHost || item.participantId === state.currentParticipantId;
              return (
                <View key={item.id} style={styles.groupItemRow}>
                  <View style={styles.groupItemBody}>
                    <Text numberOfLines={1} style={styles.cartLineName}>{item.quantity}x {item.productName}</Text>
                    <Text style={styles.cartLineNotes}>{owner?.displayName ?? "Participante"} · {formatBs(item.subtotal)}</Text>
                  </View>
                  {canRemoveItem && state.session.status !== "submitted" ? (
                    <Pressable disabled={busy} onPress={() => void removeItem(item)} style={styles.qtyButtonSmall}>
                      <X color={colors.blue} size={14} strokeWidth={4} />
                    </Pressable>
                  ) : null}
                </View>
              );
            }) : <EmptyMessage description="Cuando agreguen productos apareceran aqui." title="Sin productos" />}
          </View>
        }
      />
      {selectedProduct ? (
        <ProductModal
          onAdd={handleAddLine}
          onClose={() => setSelectedProduct(null)}
          orderingDisabled={busy || !canModify}
          product={selectedProduct}
          quantity={0}
        />
      ) : null}
      {checkoutOpen && localHostAccessToken ? (
        <GroupCheckoutSheet
          customerStore={customerStore}
          hostAccessToken={localHostAccessToken}
          onClose={() => setCheckoutOpen(false)}
          onRecentOrder={onRecentOrder}
          onSavedAddress={onSavedAddress}
          onTrack={onTrack}
          restaurant={restaurant}
          session={state}
          sessionToken={state.session.publicToken}
          subtotal={groupSubtotal}
        />
      ) : null}
    </SafeAreaView>
  );
}

function GroupParticipantCard({
  isHost,
  participant,
  total,
  onChangeStatus,
}: {
  isHost: boolean;
  participant: MobileGroupParticipant;
  total: number;
  onChangeStatus: (paymentStatus: GroupPaymentStatus) => void;
}) {
  return (
    <View style={styles.groupParticipantCard}>
      <View style={styles.groupParticipantTop}>
        <View>
          <Text style={styles.cartLineName}>{participant.displayName}{participant.role === "host" ? " · host" : ""}</Text>
          <Text style={styles.cartLineNotes}>{paymentStatusLabel(participant.paymentStatus)}</Text>
        </View>
        <Text style={styles.groupTotal}>{formatBs(total)}</Text>
      </View>
      {participant.paymentReceiptUrl ? (
        <Pressable onPress={() => Linking.openURL(participant.paymentReceiptUrl).catch(() => undefined)} style={styles.groupReceiptButton}>
          <ReceiptText color={colors.blue} size={15} strokeWidth={3} />
          <Text style={styles.groupReceiptText}>Ver comprobante</Text>
        </Pressable>
      ) : null}
      {isHost && participant.role !== "host" ? (
        <View style={styles.groupMiniActions}>
          <Pressable onPress={() => onChangeStatus("covered_by_host")} style={styles.groupMiniButton}><Text style={styles.groupMiniText}>Cubrir</Text></Pressable>
          <Pressable onPress={() => onChangeStatus("cash_pending")} style={styles.groupMiniButton}><Text style={styles.groupMiniText}>Efectivo</Text></Pressable>
          <Pressable onPress={() => onChangeStatus("excluded")} style={[styles.groupMiniButton, styles.groupMiniDanger]}><Text style={[styles.groupMiniText, styles.groupMiniDangerText]}>Excluir</Text></Pressable>
        </View>
      ) : null}
    </View>
  );
}

function ParticipantPaymentBox({
  collectMode,
  hostQrUrl,
  participant,
  total,
  onMarkPayment,
}: {
  collectMode: GroupCollectMode;
  hostQrUrl: string;
  participant: MobileGroupParticipant;
  total: number;
  onMarkPayment: (paymentStatus: GroupPaymentStatus, paymentReceiptFile?: MobileUploadFile | null, paymentReceiptUrl?: string) => void;
}) {
  const [receiptFile, setReceiptFile] = useState<MobileUploadFile | null>(null);
  if (total <= 0) return null;
  return (
    <View style={styles.groupPanel}>
      <SectionTitle eyebrow="Tu pago" title={`Tu parte ${formatBs(total)}`} />
      <Text style={styles.paymentHint}>{collectMode === "host_collects" ? "Paga al host o marca efectivo si lo arreglaran al entregar." : "Confirma tu pago para que el host pueda finalizar."}</Text>
      {hostQrUrl ? (
        <Pressable onPress={() => Linking.openURL(hostQrUrl).catch(() => undefined)} style={styles.groupReceiptButton}>
          <CreditCard color={colors.blue} size={16} strokeWidth={3} />
          <Text style={styles.groupReceiptText}>Abrir QR del host</Text>
        </Pressable>
      ) : null}
      <UploadPicker
        description={participant.paymentReceiptUrl ? "Ya tienes un comprobante enviado. Puedes subir otro para reemplazarlo." : "Captura del pago QR desde tu galeria."}
        file={receiptFile}
        label="Comprobante de pago"
        onClear={() => setReceiptFile(null)}
        onPick={async () => {
          const file = await pickGroupImageUpload("comprobante-grupal");
          if (file) setReceiptFile(file);
        }}
      />
      <View style={styles.groupHostActions}>
        <PrimaryButton disabled={!receiptFile && !participant.paymentReceiptUrl} onPress={() => onMarkPayment("paid_qr", receiptFile, participant.paymentReceiptUrl)} text="Enviar comprobante" />
        <PrimaryButton onPress={() => onMarkPayment("cash_pending")} text="Pagare en efectivo" />
      </View>
    </View>
  );
}

function GroupCheckoutSheet({
  customerStore,
  hostAccessToken,
  restaurant,
  session,
  sessionToken,
  subtotal,
  onClose,
  onRecentOrder,
  onSavedAddress,
  onTrack,
}: {
  customerStore: CustomerStore;
  hostAccessToken: string;
  restaurant: RestaurantSummary;
  session: MobileGroupOrderState;
  sessionToken: string;
  subtotal: number;
  onClose: () => void;
  onRecentOrder: (order: RecentOrder) => void;
  onSavedAddress: (address: Omit<SavedAddress, "id" | "updatedAt">) => void;
  onTrack: (order: { customerPhone?: string; orderId: string; orderNumber?: string; trackingToken: string }) => void;
}) {
  const firstAddress = customerStore.addresses[0];
  const [customerName, setCustomerName] = useState(customerStore.profile.name || session.session.hostName);
  const [phone, setPhone] = useState(customerStore.profile.phone || session.session.hostPhone);
  const [orderType, setOrderType] = useState<"delivery" | "pickup">("pickup");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "qr">("cash");
  const [address, setAddress] = useState(firstAddress?.address ?? "");
  const [deliveryLocation, setDeliveryLocation] = useState<DeliveryLocation | null>(
    firstAddress?.latitude != null && firstAddress.longitude != null
      ? { latitude: firstAddress.latitude, longitude: firstAddress.longitude, mapsUrl: firstAddress.mapsUrl ?? googleMapsUrl(firstAddress.latitude, firstAddress.longitude), label: firstAddress.label }
      : null,
  );
  const [receiptFile, setReceiptFile] = useState<MobileUploadFile | null>(null);
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const deliveryFee = orderType === "delivery" ? 8 : 0;
  const total = subtotal + deliveryFee;

  async function send() {
    if (!customerName.trim()) {
      setError("Agrega el nombre del host.");
      return;
    }
    if (orderType === "delivery" && (!address.trim() || !deliveryLocation)) {
      setError("Marca la direccion y el punto de entrega.");
      return;
    }
    setSending(true);
    setError("");
    try {
      const order = await submitMobileGroupOrder(sessionToken, {
        customerAddress: orderType === "delivery" ? address.trim() : undefined,
        customerName: customerName.trim(),
        customerPhone: phone.trim() || undefined,
        deliveryLatitude: orderType === "delivery" ? deliveryLocation?.latitude : undefined,
        deliveryLongitude: orderType === "delivery" ? deliveryLocation?.longitude : undefined,
        deliveryMapsUrl: orderType === "delivery" ? deliveryLocation?.mapsUrl : undefined,
        hostAccessToken,
        orderType,
        paymentMethod,
        paymentReceiptFile: paymentMethod === "qr" ? receiptFile : null,
        restaurantSlug: restaurant.slug,
      });
      onRecentOrder({
        createdAt: new Date().toISOString(),
        customerPhone: phone.trim(),
        id: order.orderId,
        orderNumber: order.orderNumber,
        orderType,
        restaurantName: restaurant.name,
        restaurantSlug: restaurant.slug,
        status: "pending",
        total,
        trackingToken: order.trackingToken,
      });
      if (orderType === "delivery" && address.trim()) {
        onSavedAddress({
          address: address.trim(),
          city: restaurant.city,
          label: deliveryLocation?.label ?? "Direccion grupal",
          latitude: deliveryLocation?.latitude,
          longitude: deliveryLocation?.longitude,
          mapsUrl: deliveryLocation?.mapsUrl,
        });
      }
      onClose();
      onTrack({ customerPhone: phone.trim(), orderId: order.orderId, orderNumber: order.orderNumber, trackingToken: order.trackingToken });
    } catch (nextError) {
      setError(groupOrderErrorMessage(nextError));
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} visible>
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.cartSheet}>
          <View style={styles.cartSheetHeader}>
            <View>
              <Text style={styles.cartSheetEyebrow}>Finalizar grupo</Text>
              <Text style={styles.cartSheetTitle}>Enviar pedido</Text>
            </View>
            <IconButton light onPress={onClose}><X color={colors.blue} size={22} strokeWidth={3} /></IconButton>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} style={styles.cartScroll}>
            <View style={styles.choiceGrid}>
              <ChoiceCard active={orderType === "pickup"} icon={<Store color={orderType === "pickup" ? "#FFFFFF" : colors.blue} size={20} strokeWidth={3} />} label="Recojo" onPress={() => setOrderType("pickup")} text={restaurant.address || "El local confirma la direccion."} />
              <ChoiceCard active={orderType === "delivery"} icon={<Bike color={orderType === "delivery" ? "#FFFFFF" : colors.blue} size={20} strokeWidth={3} />} label="Delivery" onPress={() => setOrderType("delivery")} text={`${formatBs(deliveryFee)} estimado`} />
            </View>
            <InputBox onChangeText={setCustomerName} placeholder="Nombre del host" value={customerName} />
            <InputBox keyboardType="phone-pad" onChangeText={setPhone} placeholder="WhatsApp" value={phone} />
            {orderType === "delivery" ? (
              <>
                <InputBox multiline onChangeText={setAddress} placeholder="Direccion de entrega" value={address} />
                <DeliveryMapPreview location={deliveryLocation} locating={false} onOpenMap={() => setMapPickerOpen(true)} onUseCurrent={() => setMapPickerOpen(true)} />
              </>
            ) : null}
            <View style={styles.segmentRow}>
              <SegmentButton active={paymentMethod === "cash"} icon={<Banknote color={paymentMethod === "cash" ? colors.blue : colors.muted} size={16} strokeWidth={3} />} onPress={() => setPaymentMethod("cash")} text="Efectivo" />
              <SegmentButton active={paymentMethod === "qr"} icon={<CreditCard color={paymentMethod === "qr" ? colors.blue : colors.muted} size={16} strokeWidth={3} />} onPress={() => setPaymentMethod("qr")} text="QR" />
            </View>
            {paymentMethod === "qr" ? (
              <UploadPicker
                description="Captura o imagen del pago final al restaurante."
                file={receiptFile}
                label="Comprobante final"
                onClear={() => setReceiptFile(null)}
                onPick={async () => {
                  const file = await pickGroupImageUpload("comprobante-final");
                  if (file) setReceiptFile(file);
                }}
              />
            ) : null}
            <View style={styles.totalBox}>
              <TotalLine label="Subtotal grupal" value={formatBs(subtotal)} />
              <TotalLine label="Envio" value={formatBs(deliveryFee)} />
              <TotalLine strong label="Total" value={formatBs(total)} />
            </View>
            {error ? <Text style={styles.submitError}>{error}</Text> : null}
            <PrimaryButton disabled={paymentMethod === "qr" && !receiptFile} loading={sending} onPress={send} text={sending ? "Enviando..." : "Enviar a caja"} />
          </ScrollView>
          {mapPickerOpen ? (
            <MapPickerModal
              initialLocation={deliveryLocation}
              onClose={() => setMapPickerOpen(false)}
              onConfirm={(location) => {
                setDeliveryLocation(location);
                if (!address.trim()) setAddress(`${location.label}\n${location.mapsUrl}`);
                setMapPickerOpen(false);
              }}
              restaurant={restaurant}
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function paymentStatusLabel(status: GroupPaymentStatus) {
  if (status === "paid_qr") return "Pago QR enviado";
  if (status === "cash_pending") return "Pagara en efectivo";
  if (status === "covered_by_host") return "Cubierto por host";
  if (status === "excluded") return "Excluido";
  return "Pendiente";
}

function groupStatusLabel(status: string) {
  if (status === "locked") return "Cerrada para nuevos cambios";
  if (status === "submitted") return "Pedido enviado";
  if (status === "cancelled") return "Cancelada";
  if (status === "expired") return "Expirada";
  return "Abierta";
}

function HomeSkeleton() {
  return (
    <View style={styles.skeletonList}>
      {[0, 1, 2].map((item) => (
        <View key={item} style={styles.skeletonCard}>
          <View style={styles.skeletonLogo} />
          <View style={styles.skeletonBody}>
            <View style={styles.skeletonLineStrong} />
            <View style={styles.skeletonLine} />
          </View>
          <View style={styles.skeletonCircle} />
        </View>
      ))}
    </View>
  );
}

function OrdersScreen({
  initialCustomerPhone,
  initialOrderId,
  initialOrderNumber,
  initialTrackingToken,
  onBack,
  pushRegistration,
  recentOrders,
}: {
  initialCustomerPhone?: string;
  initialOrderId?: string;
  initialOrderNumber?: string;
  initialTrackingToken?: string;
  onBack: () => void;
  pushRegistration: PushRegistration | null;
  recentOrders: RecentOrder[];
}) {
  const [orderNumber, setOrderNumber] = useState(initialOrderNumber ?? "");
  const [customerPhone, setCustomerPhone] = useState(initialCustomerPhone ?? recentOrders[0]?.customerPhone ?? "");
  const [tracking, setTracking] = useState<MobileTrackingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  async function loadByToken(orderId: string, trackingToken: string, silent = false) {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setTracking(null);
    }
    setError("");
    try {
      const nextTracking = await getMobileOrderStatus({ orderId, trackingToken });
      setTracking(nextTracking);
      setOrderNumber(nextTracking.order.orderNumber);
      setCustomerPhone(nextTracking.order.customerPhone);
    } catch (trackError) {
      const message = trackError instanceof Error ? trackError.message : "tracking-failed";
      setError(message === "order-not-found" ? "No encontramos un pedido con esos datos." : "No se pudo rastrear el pedido. Revisa los datos e intenta otra vez.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function searchOrder() {
    setLoading(true);
    setError("");
    setTracking(null);
    try {
      setTracking(
        await trackMobileOrder({
          customerPhone: customerPhone.trim(),
          orderNumber: orderNumber.trim(),
          ...(pushRegistration
            ? {
                push: {
                  deviceId: pushRegistration.deviceId,
                  expoPushToken: pushRegistration.expoPushToken,
                  platform: pushRegistration.platform,
                },
              }
            : {}),
        }),
      );
    } catch (trackError) {
      const message = trackError instanceof Error ? trackError.message : "tracking-failed";
      setError(message === "order-not-found" ? "No encontramos un pedido con esos datos." : "No se pudo rastrear el pedido. Revisa los datos e intenta otra vez.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialOrderId && initialTrackingToken) {
      void loadByToken(initialOrderId, initialTrackingToken);
      return;
    }

    if (initialOrderNumber && initialCustomerPhone) {
      setOrderNumber(initialOrderNumber);
      setCustomerPhone(initialCustomerPhone);
    }
  }, [initialCustomerPhone, initialOrderId, initialOrderNumber, initialTrackingToken]);

  useEffect(() => {
    if (!tracking || isTerminalTracking(tracking.order)) return;
    const interval = setInterval(() => {
      void loadByToken(tracking.order.id, tracking.order.trackingToken, true);
    }, 12000);
    return () => clearInterval(interval);
  }, [tracking?.order.id, tracking?.order.trackingToken, tracking?.order.status, tracking?.order.deliveryDispatch?.status]);

  function openRecentOrder(order: RecentOrder) {
    setOrderNumber(order.orderNumber);
    setCustomerPhone(order.customerPhone);
    if (order.trackingToken) {
      void loadByToken(order.id, order.trackingToken);
    }
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.safeBlue}>
      <ScrollView
        contentContainerStyle={styles.trackingPage}
        refreshControl={tracking ? <RefreshControl onRefresh={() => loadByToken(tracking.order.id, tracking.order.trackingToken, true)} refreshing={refreshing} tintColor={colors.green} /> : undefined}
        style={styles.page}
      >
        <View style={styles.trackingTop}>
          <IconButton light onPress={onBack}>
            <ChevronLeft color={colors.blue} size={24} strokeWidth={3} />
          </IconButton>
          <View style={styles.trackingTitleBlock}>
            <Text style={styles.eyebrow}>Rastreo</Text>
            <Text style={styles.title}>Sigue tu pedido</Text>
          </View>
        </View>

        {tracking ? (
          <TrackingStatusCard
            onRefresh={() => loadByToken(tracking.order.id, tracking.order.trackingToken, true)}
            refreshing={refreshing}
            tracking={tracking}
          />
        ) : null}

        {tracking ? (
          <Pressable
            onPress={() => {
              setTracking(null);
              setError("");
            }}
            style={({ pressed }) => [styles.searchAnotherButton, pressed && styles.pressedCard]}
          >
            <Search color={colors.blue} size={18} strokeWidth={3} />
            <Text style={styles.searchAnotherText}>Buscar otro pedido</Text>
          </Pressable>
        ) : null}

        {!tracking && recentOrders.length ? (
          <View style={styles.recentOrdersBlock}>
            <SectionTitle eyebrow="Recientes" title="Tus ultimos pedidos" />
            {recentOrders.slice(0, 5).map((order) => (
              <Pressable
                key={order.id}
                onPress={() => openRecentOrder(order)}
                style={({ pressed }) => [styles.recentOrderCard, pressed && styles.pressedCard]}
              >
                <View style={styles.recentOrderIcon}>
                  <ReceiptText color={colors.blue} size={20} strokeWidth={3} />
                </View>
                <View style={styles.recentOrderBody}>
                  <Text numberOfLines={1} style={styles.recentOrderName}>{order.restaurantName}</Text>
                  <Text style={styles.recentOrderMeta}>{order.orderNumber} | {formatBs(order.total)}</Text>
                </View>
                <ArrowRight color={colors.blue} size={18} strokeWidth={3} />
              </Pressable>
            ))}
          </View>
        ) : null}

        {!tracking ? <View style={styles.trackingCard}>
          <InputBox onChangeText={setOrderNumber} placeholder="Numero de pedido, ej. P-123456" value={orderNumber} />
          <InputBox keyboardType="phone-pad" onChangeText={setCustomerPhone} placeholder="Telefono usado en el pedido" value={customerPhone} />
          {error ? <Text style={styles.submitError}>{error}</Text> : null}
          <PrimaryButton disabled={loading || !orderNumber.trim() || !customerPhone.trim()} loading={loading} onPress={searchOrder} text={loading ? "Buscando pedido..." : "Rastrear pedido"} />
        </View> : null}
        {tracking && error ? <Text style={styles.submitError}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const terminalTrackingStatuses = new Set<MobileOrderStatus>(["delivered", "cancelled"]);
const confidenceLabel: Record<MobileOrderQueueState["confidence"], string> = {
  high: "Muy preciso",
  low: "Aprendiendo",
  medium: "Buena lectura",
};

function isTerminalTracking(order: MobileTrackedOrder) {
  return terminalTrackingStatuses.has(order.status) || order.deliveryDispatch?.status === "delivered";
}

function trackingLabel(order: MobileTrackedOrder) {
  if (order.status === "cancelled") return "Cancelado";
  if (order.orderType === "pickup" && order.status === "ready") return "Listo para recoger";
  if (order.orderType === "delivery" && order.deliveryDispatch?.status === "arrived") return "Llego";
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

function recentOrderStatusLabel(order: RecentOrder) {
  if (!order.status) return "Guardado";
  if (order.orderType === "pickup" && order.status === "ready") return "Listo para recoger";
  const labels: Record<NonNullable<RecentOrder["status"]>, string> = {
    accepted: "Confirmado",
    cancelled: "Cancelado",
    delivered: order.orderType === "pickup" ? "Retirado" : "Entregado",
    pending: "Recibido",
    preparing: "Preparando",
    ready: "Listo",
  };
  return labels[order.status];
}

function recentOrderModeLabel(orderType?: string) {
  if (orderType === "pickup") return "Recojo";
  if (orderType === "table") return "Mesa";
  if (orderType === "pos") return "Local";
  return "Delivery";
}

function orderModeLabel(orderType: MobileOrderType) {
  if (orderType === "delivery") return "Envio a domicilio";
  if (orderType === "pickup") return "Recojo en local";
  if (orderType === "table") return "Pedido en mesa";
  return "Pedido en local";
}

function trackingSteps(order: MobileTrackedOrder) {
  const base = order.orderType === "pickup"
    ? [
        { key: "pending", title: "Recibido", description: "El local recibio tu pedido.", icon: CheckCircle2 },
        { key: "accepted", title: "Confirmado", description: "El equipo lo aprobo.", icon: ClipboardCheck },
        { key: "preparing", title: "Preparando", description: "El equipo esta trabajando.", icon: ChefHat },
        { key: "ready", title: "Listo", description: "Puedes pasar por el local.", icon: PackageCheck },
        { key: "delivered", title: "Retirado", description: "Pedido completado.", icon: PackageCheck },
      ]
    : [
        { key: "pending", title: "Recibido", description: "Ahora", icon: CheckCircle2 },
        { key: "accepted", title: "Confirmado", description: "El equipo lo aprobo.", icon: ClipboardCheck },
        { key: "preparing", title: "Preparando", description: "Cocina esta trabajando.", icon: ChefHat },
        { key: "ready", title: "Listo", description: "Sale del local.", icon: PackageCheck },
        { key: "arrived", title: "Llego", description: "El repartidor marco llegada.", icon: Bike },
        { key: "delivered", title: "Entregado", description: "Pedido completado.", icon: PackageCheck },
      ];

  const activeIndex = trackingActiveIndex(order, base.map((step) => step.key));
  return { activeIndex, steps: base };
}

function trackingActiveIndex(order: MobileTrackedOrder, keys: string[]) {
  if (order.status === "cancelled") return -1;
  if (order.deliveryDispatch?.status === "delivered") return keys.indexOf("delivered");
  if (order.deliveryDispatch?.status === "arrived") return keys.indexOf("arrived");
  return Math.max(0, keys.indexOf(order.status));
}

function queueEstimateLabel(queue: MobileOrderQueueState) {
  if (queue.status === "ready") return "Listo ahora";
  if (queue.status === "delivered") return "Completado";
  if (queue.status === "cancelled") return "Sin estimado";
  if (queue.estimatedMinMinutes <= 0 && queue.estimatedMaxMinutes <= 0) return "Calculando";
  if (queue.estimatedMinMinutes === queue.estimatedMaxMinutes) return `${queue.estimatedMinMinutes} min`;
  return `${queue.estimatedMinMinutes}-${queue.estimatedMaxMinutes} min`;
}

function formatShortTime(value?: string) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" });
}

function queueWindow(queue: MobileOrderQueueState) {
  if (!queue.estimatedReadyAtMin || !queue.estimatedReadyAtMax || queue.estimatedMinMinutes <= 0) return "";
  return `${formatShortTime(queue.estimatedReadyAtMin)} - ${formatShortTime(queue.estimatedReadyAtMax)}`;
}

function queueHeadline(order: MobileTrackedOrder, queue: MobileOrderQueueState) {
  if ((order.status === "pending" || order.status === "accepted") && queue.queuePosition) {
    return `Estas #${queue.queuePosition} en la fila virtual`;
  }
  if (order.status === "preparing") return "Tu pedido esta en preparacion";
  if (order.status === "ready") return order.orderType === "delivery" ? "Tu pedido esta listo para envio" : "Tu pedido esta listo";
  if (order.status === "delivered") return "Pedido completado";
  return "Seguimiento del pedido";
}

function queueSupportText(order: MobileTrackedOrder, queue: MobileOrderQueueState) {
  if (order.status === "pending") {
    const ahead = queue.ordersAhead ?? 0;
    if (ahead === 0) return "Tu pedido ya esta en la fila. El restaurante lo confirmara para mandarlo a cocina.";
    return ahead === 1 ? "Hay 1 pedido antes que el tuyo. El restaurante confirmara el tuyo para mandarlo a cocina." : `Hay ${ahead} pedidos antes que el tuyo. El restaurante confirmara el tuyo para mandarlo a cocina.`;
  }
  if (order.status === "accepted") {
    const ahead = queue.ordersAhead ?? 0;
    return ahead <= 0 ? "Eres el siguiente para entrar a preparacion." : ahead === 1 ? "Hay 1 pedido antes que el tuyo." : `Hay ${ahead} pedidos antes que el tuyo.`;
  }
  if (order.status === "preparing") return "Cocina ya esta trabajando en tu pedido.";
  if (order.status === "ready") return order.orderType === "delivery" ? "El equipo lo tiene listo para despacho." : "Puedes pasar por el local y pedirlo con tu numero de pedido.";
  if (order.status === "delivered") return "Gracias por pedir con nosotros.";
  return "El estado se actualiza automaticamente.";
}

function TrackingStatusCard({ onRefresh, refreshing, tracking }: { onRefresh: () => void; refreshing: boolean; tracking: MobileTrackingResult }) {
  const [productsOpen, setProductsOpen] = useState(false);
  const { order, queue, restaurant } = tracking;
  const { activeIndex, steps } = trackingSteps(order);
  const statusIllustration = order.status === "delivered" ? illustrationOrderSuccess : illustrationOrderStatus;

  async function contactRestaurant() {
    const digits = (restaurant.whatsapp ?? "").replace(/\D/g, "");
    if (digits) {
      await Linking.openURL(`https://wa.me/${digits}`);
      return;
    }
    await Linking.openURL(publicRestaurantUrl(restaurant.slug));
  }

  async function openPickupMap() {
    await Linking.openURL(googleMapsSearchUrl([restaurant.name, restaurant.city].filter(Boolean).join(", "))).catch(() => undefined);
  }

  return (
    <View style={styles.trackingStack}>
      <View style={styles.trackingHeaderCard}>
        <RestaurantLogo restaurant={{ name: restaurant.name, logoUrl: restaurant.logoUrl } as RestaurantSummary} size={46} />
        <View style={styles.trackingHeaderBody}>
          <Text numberOfLines={1} style={styles.recentOrderName}>{restaurant.name}</Text>
          <View style={styles.metaRow}>
            <Store color={colors.muted} size={12} strokeWidth={3} />
            <Text numberOfLines={1} style={styles.recentOrderMeta}>{restaurant.city || "yopido.shop"}</Text>
          </View>
        </View>
        <IconButton light onPress={onRefresh}>
          {refreshing ? <ActivityIndicator color={colors.blue} size="small" /> : <Clock3 color={colors.blue} size={19} strokeWidth={3} />}
        </IconButton>
      </View>

      <View style={styles.trackingResultCard}>
        <Text style={styles.eyebrow}>Resumen</Text>
        <Text style={styles.trackingOrder}>Pedido {order.orderNumber}</Text>
        <View style={styles.trackingModePill}>
          <Text style={styles.trackingModeText}>{orderModeLabel(order.orderType)}</Text>
        </View>
        {order.orderType === "pickup" ? (
          <Pressable onPress={openPickupMap} style={({ pressed }) => [styles.trackingMapButton, pressed && styles.pressedCard]}>
            <MapPinned color={colors.blue} size={18} strokeWidth={3} />
            <Text style={styles.trackingMapButtonText}>Ver ubicacion del local</Text>
          </Pressable>
        ) : null}

        <Pressable onPress={() => setProductsOpen((current) => !current)} style={styles.trackingProductsToggle}>
          <Text style={styles.trackingProductsText}>Ver productos</Text>
          <Text style={styles.trackingProductsCount}>{order.items.length}</Text>
        </Pressable>
        {productsOpen ? (
          <View style={styles.trackingProductsList}>
            {order.items.map((item) => (
              <View key={item.id} style={styles.trackingProductLine}>
                <View style={styles.trackingProductThumb}>
                  <ShoppingBag color={colors.blue} size={18} strokeWidth={3} />
                </View>
                <View style={styles.trackingProductBody}>
                  <Text numberOfLines={1} style={styles.trackingProductName}>{item.productName}</Text>
                  {item.notes ? <Text numberOfLines={1} style={styles.trackingProductNotes}>{item.notes}</Text> : null}
                  <Text style={styles.trackingProductNotes}>{formatBs(Number(item.unitPrice))} c/u</Text>
                </View>
                <Text style={styles.trackingProductQty}>x{item.quantity}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.trackingTotalBox}>
          <Text style={styles.trackingTotalLabel}>Total</Text>
          <Text style={styles.trackingTotal}>{formatBs(Number(order.total))}</Text>
        </View>
        <PrimaryButton icon={<MessageCircle color={colors.blue} size={18} strokeWidth={3} />} onPress={contactRestaurant} text="Contactar restaurante" />
      </View>

      <View>
        <Text style={styles.trackingSectionTitle}>Seguimiento del pedido</Text>
        <Text style={styles.trackingSectionSub}>Pedido {order.orderNumber}</Text>
        <View style={styles.trackingStatusPill}>
          <Text style={styles.trackingStatusPillText}>{trackingLabel(order)}</Text>
        </View>
      </View>

      <View style={styles.trackingStateCard}>
        <Image source={statusIllustration} style={styles.trackingIllustration} />
        <View style={styles.trackingStateIntro}>
          <View style={styles.trackingModePill}>
            <Text style={styles.trackingModeText}>{orderModeLabel(order.orderType)}</Text>
          </View>
          <Text style={styles.trackingStateTitle}>Seguimiento por estados</Text>
        </View>

        {order.status === "cancelled" ? (
        <View style={styles.cancelledBox}>
          <Text style={styles.cancelledText}>Pedido cancelado{order.cancellationReason ? `: ${order.cancellationReason}` : ""}</Text>
        </View>
      ) : (
        <View style={styles.trackingSteps}>
          {steps.map((step, index) => {
            const active = index <= activeIndex;
            const current = index === activeIndex;
            const Icon = step.icon;
            return (
              <View key={step.key} style={[styles.trackingStep, current && styles.trackingStepCurrent]}>
                <View style={[styles.trackingDot, active && styles.trackingDotActive]}>
                  <Icon color={active ? colors.blue : "#8D9AAF"} size={18} strokeWidth={2.8} />
                </View>
                <View style={styles.trackingStepBody}>
                  <Text style={[styles.trackingStepText, active && styles.trackingStepTextActive]}>{step.title}</Text>
                  <Text style={styles.trackingStepDescription}>{step.description}</Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
      </View>

      {queue?.queueEnabled && order.status !== "cancelled" ? <VirtualQueueMobileCard order={order} queue={queue} /> : null}
    </View>
  );
}

function VirtualQueueMobileCard({ order, queue }: { order: MobileTrackedOrder; queue: MobileOrderQueueState }) {
  const windowLabel = queueWindow(queue);
  const progressSteps = [
    { label: "Confirmado", icon: Sparkles, key: "accepted" },
    { label: "En fila", icon: UsersRound, key: "queue" },
    { label: "Cocina", icon: ChefHat, key: "preparing" },
    { label: "Listo", icon: Flame, key: "ready" },
  ];
  const currentStep = order.status === "pending" ? 0 : order.status === "accepted" ? 0 : order.status === "preparing" ? 2 : order.status === "ready" || order.status === "delivered" ? 3 : 0;

  return (
    <View style={styles.queueCard}>
      <View style={styles.queueDemandPill}>
        <Activity color={colors.blue} size={14} strokeWidth={3} />
        <Text style={styles.queueDemandText}>{queue.demandLabel}</Text>
      </View>
      <Text style={styles.queueHeadline}>{queueHeadline(order, queue)}</Text>
      <Text style={styles.queueSupport}>{queueSupportText(order, queue)}</Text>

      <View style={styles.queueEstimateBox}>
        <Text style={styles.queueEstimateLabel}>Estimado</Text>
        <Text style={styles.queueEstimateValue}>{queueEstimateLabel(queue)}</Text>
        {windowLabel ? <Text style={styles.queueWindow}>{windowLabel}</Text> : null}
      </View>

      <View style={styles.queueLane}>
        <View style={styles.queueLaneTop}>
          <View style={styles.queueLaneLine}>
            <View style={styles.queueLaneLineActive} />
          </View>
          <Text style={styles.queueLiveText}>En vivo</Text>
        </View>
        <View style={styles.queueLaneDots}>
          <View style={styles.queueDotAhead}>
            <Text style={styles.queueDotText}>{Math.max(queue.ordersAhead ?? 0, 0) + 1}</Text>
          </View>
          <View style={styles.queueDotMine}>
            <Text style={styles.queueDotMineText}>Tu</Text>
          </View>
          <View style={styles.queueChefDot}>
            <ChefHat color={colors.blue} size={19} strokeWidth={3} />
          </View>
        </View>
      </View>

      <View style={styles.queueProgress}>
        {progressSteps.map((step, index) => {
          const active = index <= currentStep;
          const Icon = step.icon;
          return (
            <View key={step.key} style={[styles.queueProgressItem, active && styles.queueProgressItemActive]}>
              <Icon color={active ? colors.blue : "#9AA7B8"} size={19} strokeWidth={3} />
              <Text style={[styles.queueProgressText, active && styles.queueProgressTextActive]}>{step.label}</Text>
            </View>
          );
        })}
      </View>

      <View style={styles.queueStats}>
        <QueueStat icon={<UsersRound color={colors.blue} size={16} strokeWidth={3} />} label="Fila actual" value={`${queue.activeOrders}`} detail="pedidos activos" />
        <QueueStat icon={<ChefHat color={colors.blue} size={16} strokeWidth={3} />} label="Cocina" value={`${queue.preparingOrders}`} detail="en preparacion" />
        <QueueStat icon={<Timer color={colors.blue} size={16} strokeWidth={3} />} label="Precision" value={confidenceLabel[queue.confidence]} detail={queue.historySampleSize ? `${queue.historySampleSize} pedidos medidos` : "con datos iniciales"} />
      </View>

      <View style={styles.queueRefreshFooter}>
        <Clock3 color={colors.muted} size={15} strokeWidth={3} />
        <Text style={styles.queueRefreshText}>Actualiza en tiempo real</Text>
      </View>
    </View>
  );
}

function QueueStat({ detail, icon, label, value }: { detail: string; icon: ReactNode; label: string; value: string }) {
  return (
    <View style={styles.queueStat}>
      <View style={styles.queueStatTitle}>
        {icon}
        <Text style={styles.queueStatLabel}>{label}</Text>
      </View>
      <Text style={styles.queueStatValue}>{value}</Text>
      <Text style={styles.queueStatDetail}>{detail}</Text>
    </View>
  );
}

function PromosScreen({ onOpenRestaurant }: { onOpenRestaurant: (slug: string) => void }) {
  const [products, setProducts] = useState<PopularProductSummary[]>([]);
  const [restaurants, setRestaurants] = useState<RestaurantSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listHomeDirectory()
      .then((directory) => {
        setProducts(directory.productSuggestions.slice(0, 20));
        setRestaurants(directory.mostOrderedRestaurants);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <SafeAreaView edges={["top"]} style={styles.safeBlue}>
      <ScrollView contentContainerStyle={styles.tabPage} style={styles.page}>
        <View style={styles.tabHero}>
          <Text style={styles.tabEyebrow}>Promos</Text>
          <Text style={styles.tabTitle}>Ofertas y favoritos</Text>
          <Text style={styles.tabCopy}>Productos populares y locales activos para pedir rapido.</Text>
        </View>
        {loading ? <HomeSkeleton /> : null}
        {!loading && products.length ? (
          <View style={styles.promoGrid}>
            {products.map((product) => (
              <Pressable key={product.id} onPress={() => onOpenRestaurant(product.restaurantSlug)} style={({ pressed }) => [styles.promoCard, pressed && styles.pressedCard]}>
                <ImageBackground source={displayImageSource(product.imageUrl)} style={styles.promoImage} imageStyle={styles.promoImageRadius}>
                  <View style={styles.productTopBadge}><Text style={styles.productTopText}>Promo</Text></View>
                </ImageBackground>
                <View style={styles.promoBody}>
                  <Text numberOfLines={1} style={styles.promoName}>{product.name}</Text>
                  <Text numberOfLines={1} style={styles.promoRestaurant}>{product.restaurantName}</Text>
                  <Text style={styles.promoPrice}>{formatBs(product.price)}</Text>
                </View>
                <View style={styles.resultArrow}><ArrowRight color={colors.blue} size={20} strokeWidth={3} /></View>
              </Pressable>
            ))}
          </View>
        ) : null}
        {!loading && !products.length ? (
          <RankingSection icon={<Flame color={colors.blue} size={21} strokeWidth={3} />} metric={(restaurant) => restaurant.popularProducts.join(" | ") || "Listo para pedir"} onOpenRestaurant={onOpenRestaurant} restaurants={restaurants} title="Locales destacados" />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function AccountScreen({
  customerStore,
  notificationMessage,
  notificationStatus,
  onChangeStore,
  onEnableNotifications,
  onSaveAddress,
  onTestNotification,
  sessionUser,
  onOpenOrders,
  onOpenRestaurant,
  onOpenRecentOrder,
  onToggleFavorite,
}: {
  customerStore: CustomerStore;
  notificationMessage: string;
  notificationStatus: NotificationStatus;
  onChangeStore: (store: CustomerStore) => void | Promise<void>;
  onEnableNotifications: () => Promise<PushRegistrationResult>;
  onSaveAddress: (address: Omit<SavedAddress, "id" | "updatedAt">) => Promise<SavedAddress[]>;
  onTestNotification: () => Promise<LocalNotificationResult>;
  sessionUser: SessionUser | null;
  onOpenOrders: () => void;
  onOpenRestaurant: (slug: string) => void;
  onOpenRecentOrder: (order: RecentOrder) => void;
  onToggleFavorite: (favorite: SavedFavorite) => void | Promise<void>;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState(sessionUser?.email ?? "");
  const [password, setPassword] = useState("");
  const [name, setName] = useState(customerStore.profile.name);
  const [phone, setPhone] = useState(customerStore.profile.phone);
  const [documentNumber, setDocumentNumber] = useState(customerStore.profile.documentNumber);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [addressSaving, setAddressSaving] = useState(false);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [addressPickerOpen, setAddressPickerOpen] = useState(false);
  const [panelView, setPanelView] = useState<AccountPanelView>("home");
  const [orderFilter, setOrderFilter] = useState<OrderHistoryFilter>("all");
  const [favoriteFilter, setFavoriteFilter] = useState<FavoriteFilter>("all");
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [notificationTesting, setNotificationTesting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    setName(customerStore.profile.name);
    setPhone(customerStore.profile.phone);
    setDocumentNumber(customerStore.profile.documentNumber);
  }, [customerStore.profile.documentNumber, customerStore.profile.name, customerStore.profile.phone]);

  useEffect(() => {
    if (sessionUser?.email) setEmail(sessionUser.email);
  }, [sessionUser?.email]);

  const greetingName = useMemo(() => {
    const cleanName = name.trim().split(/\s+/)[0];
    if (cleanName) return cleanName;
    const cleanEmail = sessionUser?.email?.split("@")[0]?.trim();
    return cleanEmail || "";
  }, [name, sessionUser?.email]);

  const addressCount = customerStore.addresses.length;
  const orderCount = customerStore.recentOrders.length;
  const favoriteCount = customerStore.favorites.length;
  const profileComplete = Boolean(name.trim() && phone.trim() && documentNumber.trim());
  const notificationMeta =
    notificationStatus === "ready"
      ? "Activas para seguimiento de pedidos"
      : notificationStatus === "checking"
        ? "Revisando permisos..."
        : notificationStatus === "disabled"
          ? "Toca para permitirlas en este telefono"
          : notificationMessage || "Toca para revisar la configuracion";
  const visibleRecentOrders = useMemo(() => {
    return customerStore.recentOrders.filter((order) => orderFilter === "all" || order.orderType === orderFilter);
  }, [customerStore.recentOrders, orderFilter]);
  const visibleFavorites = useMemo(() => {
    return customerStore.favorites.filter((favorite) => favoriteFilter === "all" || favorite.kind === favoriteFilter);
  }, [customerStore.favorites, favoriteFilter]);

  useEffect(() => {
    if (!sessionUser) {
      setPanelView("home");
    }
  }, [sessionUser]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (panelView !== "home") {
        setPanelView("home");
        setErrorMessage("");
        setSuccessMessage("");
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [panelView]);

  async function submitAuth() {
    setLoading(true);
    setErrorMessage("");
    setSuccessMessage("");

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();
    const cleanPhone = phone.trim();
    const cleanDocumentNumber = documentNumber.trim();

    if (mode === "register" && (!cleanName || !cleanPhone || !cleanDocumentNumber)) {
      setLoading(false);
      setErrorMessage("Completa nombre, telefono y carnet para crear tu cuenta.");
      return;
    }

    try {
      if (mode === "register") {
        await registerCustomerAccount({
          documentNumber: cleanDocumentNumber,
          email: cleanEmail,
          fullName: cleanName,
          password,
          phone: cleanPhone,
        });
      }

      const authSession = await signInCustomerAccount(cleanEmail, password);
      const { error } = await supabase.auth.setSession({
        access_token: authSession.accessToken,
        refresh_token: authSession.refreshToken,
      });
      if (error) throw error;

      setPassword("");
      if (mode === "register") {
        await onChangeStore({ ...customerStore, profile: { documentNumber: cleanDocumentNumber, name: cleanName, phone: cleanPhone } });
      }
      setSuccessMessage(mode === "login" ? "Sesion iniciada." : "Cuenta creada. Bienvenido a Yopido.");
    } catch (error) {
      setErrorMessage(customerErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  async function submitGoogleAuth() {
    setGoogleLoading(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const session = await signInCustomerWithGoogle();
      if (session) {
        setSuccessMessage("Sesion iniciada con Google.");
      }
    } catch (error) {
      setErrorMessage(customerErrorMessage(error));
    } finally {
      setGoogleLoading(false);
    }
  }

  async function saveProfile() {
    setProfileSaving(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      let nextProfile = { documentNumber: documentNumber.trim(), name: name.trim(), phone: phone.trim() };
      if (sessionUser?.accessToken) {
        const response = await updateCustomerProfile(sessionUser.accessToken, {
          documentNumber: nextProfile.documentNumber,
          fullName: nextProfile.name,
          phone: nextProfile.phone,
        });
        nextProfile = {
          documentNumber: response.profile.documentNumber,
          name: response.profile.fullName,
          phone: response.profile.phone,
        };
      }

      await onChangeStore({ ...customerStore, profile: nextProfile });
      setProfileEditorOpen(false);
      setSuccessMessage("Datos guardados para tus proximos pedidos.");
    } catch (error) {
      setErrorMessage(customerErrorMessage(error));
    } finally {
      setProfileSaving(false);
    }
  }

  async function saveAddressFromMap(location: DeliveryLocation, details?: AddressDetails) {
    setAddressSaving(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const label = details?.label.trim() ?? "";
      const reference = details?.reference.trim() ?? "";
      if (!label || !reference) {
        setErrorMessage("Completa el nombre y la referencia de la direccion.");
        return;
      }
      if (sessionUser?.accessToken) {
        const response = await createCustomerAddress(sessionUser.accessToken, {
          address: location.label,
          apartment: details?.apartment.trim() || undefined,
          buildingName: details?.buildingName.trim() || undefined,
          isDefault: addressCount === 0,
          label,
          latitude: location.latitude,
          longitude: location.longitude,
          mapsUrl: location.mapsUrl,
          reference,
        });
        await onChangeStore({
          ...customerStore,
          addresses: response.addresses.map(mapCustomerAddressToSavedAddress),
        });
      } else {
        await onSaveAddress({
          address: location.label,
          apartment: details?.apartment.trim() || undefined,
          buildingName: details?.buildingName.trim() || undefined,
          label,
          latitude: location.latitude,
          longitude: location.longitude,
          mapsUrl: location.mapsUrl,
          reference,
        });
      }

      setAddressPickerOpen(false);
      setSuccessMessage("Direccion guardada.");
    } catch (error) {
      setErrorMessage(customerErrorMessage(error));
    } finally {
      setAddressSaving(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSuccessMessage("Sesion cerrada.");
  }

  async function enableNotificationsFromAccount() {
    setNotificationSaving(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const result = await onEnableNotifications();
      if (result.ok) {
        setSuccessMessage(result.message);
      } else {
        setErrorMessage(result.message);
      }
    } finally {
      setNotificationSaving(false);
    }
  }

  async function testNotificationsFromAccount() {
    setNotificationTesting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const result = await onTestNotification();
      if (result.ok) {
        setSuccessMessage(result.message);
      } else {
        setErrorMessage(result.message);
      }
    } finally {
      setNotificationTesting(false);
    }
  }

  function openAddressPicker() {
    if (!profileComplete) {
      setSuccessMessage("");
      setErrorMessage("Primero guarda tus datos para asociar direcciones a tu cuenta.");
      return;
    }
    setAddressPickerOpen(true);
  }

  function openProfileEditor() {
    setName(customerStore.profile.name);
    setPhone(customerStore.profile.phone);
    setDocumentNumber(customerStore.profile.documentNumber);
    setErrorMessage("");
    setSuccessMessage("");
    setProfileEditorOpen(true);
  }

  function closeProfileEditor() {
    setName(customerStore.profile.name);
    setPhone(customerStore.profile.phone);
    setDocumentNumber(customerStore.profile.documentNumber);
    setErrorMessage("");
    setProfileEditorOpen(false);
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.safeBlue}>
      <ScrollView
        alwaysBounceVertical={false}
        bounces={false}
        contentContainerStyle={[styles.tabPage, styles.accountPageContent]}
        overScrollMode="never"
        style={styles.accountPage}
      >
        <View style={styles.accountHero}>
          <View style={styles.accountHeroTop}>
            <Image resizeMode="contain" source={logoDark} style={styles.accountHeroLogo} />
            <View style={styles.accountHeroIcon}>
              <UserRound color="#FFFFFF" size={22} strokeWidth={3} />
            </View>
          </View>
          <Text style={styles.accountHeroEyebrow}>Mi Yopido</Text>
          <Text style={styles.accountGreeting}>{greetingName ? `Hola ${greetingName}, bienvenido` : "Hola, bienvenido"}</Text>
          <Text style={styles.accountHeroCopy}>Tus pedidos, direcciones y datos listos para comprar mas rapido.</Text>
        </View>

        {!sessionUser ? (
          <View style={styles.accountCard}>
            <SectionTitle eyebrow="Acceso" title={mode === "login" ? "Ingresa a tu cuenta" : "Crea tu cuenta"} />
            <Pressable
              disabled={loading || googleLoading}
              onPress={submitGoogleAuth}
              style={({ pressed }) => [styles.googleAuthButton, (loading || googleLoading) && styles.primaryButtonDisabled, pressed && styles.pressedCard]}
            >
              <View style={styles.googleAuthBadge}><Text style={styles.googleAuthBadgeText}>G</Text></View>
              {googleLoading ? <ActivityIndicator color={colors.blue} size="small" /> : <Text style={styles.googleAuthText}>Continuar con Google</Text>}
            </Pressable>
            <View style={styles.authDivider}>
              <View style={styles.authDividerLine} />
              <Text style={styles.authDividerText}>O usa correo</Text>
              <View style={styles.authDividerLine} />
            </View>
            <View style={styles.segmentRow}>
              <SegmentButton active={mode === "login"} icon={<Mail color={mode === "login" ? colors.blue : colors.muted} size={16} strokeWidth={3} />} onPress={() => setMode("login")} text="Ingresar" />
              <SegmentButton active={mode === "register"} icon={<Plus color={mode === "register" ? colors.blue : colors.muted} size={16} strokeWidth={3} />} onPress={() => setMode("register")} text="Registro" />
            </View>
            {mode === "register" ? (
              <>
                <InputBox onChangeText={setName} placeholder="Nombre completo" value={name} />
                <InputBox keyboardType="phone-pad" onChangeText={setPhone} placeholder="Telefono / WhatsApp" value={phone} />
                <InputBox keyboardType="number-pad" onChangeText={setDocumentNumber} placeholder="Carnet de identidad" value={documentNumber} />
              </>
            ) : null}
            <InputBox autoCapitalize="none" keyboardType="email-address" onChangeText={setEmail} placeholder="Correo electronico" value={email} />
            <InputBox onChangeText={setPassword} placeholder="Contrasena" secureTextEntry value={password} />
            {errorMessage ? <Text style={styles.submitError}>{errorMessage}</Text> : null}
            {successMessage ? <Text style={styles.successInline}>{successMessage}</Text> : null}
            <PrimaryButton disabled={loading || googleLoading || !email.trim() || password.length < 6 || (mode === "register" && (!name.trim() || !phone.trim() || !documentNumber.trim()))} loading={loading} onPress={submitAuth} text={mode === "login" ? "Iniciar sesion" : "Crear cuenta"} />
            {loading ? <AuthLoadingOverlay text={mode === "login" ? "Ingresando a tu cuenta..." : "Creando tu cuenta..."} /> : null}
          </View>
        ) : panelView === "addresses" ? (
          <>
            <View style={styles.accountCard}>
              <View style={styles.accountSectionActionRow}>
                <AccountSubHeader eyebrow="Direcciones" title="Mis direcciones" />
                <Pressable
                  accessibilityLabel="Agregar direccion"
                  disabled={addressSaving || !profileComplete}
                  onPress={openAddressPicker}
                  style={({ pressed }) => [styles.accountAddButton, (!profileComplete || addressSaving) && styles.accountAddButtonDisabled, pressed && profileComplete && styles.pressedCard]}
                >
                  <Plus color={colors.blue} size={23} strokeWidth={3.5} />
                </Pressable>
              </View>
              <Text style={styles.accountHint}>Guarda puntos frecuentes con nombres claros. Despues, al pedir delivery, usaremos esa direccion sin pedirte los datos otra vez.</Text>
              {!profileComplete ? <Text style={styles.submitError}>Primero guarda nombre, telefono y carnet para asociar direcciones a tu cuenta.</Text> : null}
              {errorMessage ? <Text style={styles.submitError}>{errorMessage}</Text> : null}
              {successMessage ? <Text style={styles.successInline}>{successMessage}</Text> : null}
            </View>

            <View style={styles.accountCard}>
              <View style={styles.accountSectionActionRow}>
                <SectionTitle eyebrow="Guardadas" title={`${addressCount} direcciones`} />
              </View>
              {customerStore.addresses.length ? customerStore.addresses.map((address) => (
                <View key={address.id} style={styles.addressRow}>
                  <View style={styles.accountRowIcon}>
                    <MapPin color={colors.blue} size={17} strokeWidth={3} />
                  </View>
                  <View style={styles.recentOrderBody}>
                    <Text numberOfLines={1} style={styles.recentOrderName}>{address.label}</Text>
                    <Text numberOfLines={2} style={styles.recentOrderMeta}>{address.address}</Text>
                    {address.buildingName || address.apartment ? <Text numberOfLines={1} style={styles.addressDetail}>{[address.buildingName, address.apartment].filter(Boolean).join(" | ")}</Text> : null}
                    {address.reference ? <Text numberOfLines={2} style={styles.addressReference}>{address.reference}</Text> : null}
                  </View>
                </View>
              )) : (
                <EmptyMessage description="Agrega Casa, Trabajo u otro punto frecuente para pedir mas rapido." title="Aun no tienes direcciones" />
              )}
            </View>
          </>
        ) : panelView === "orders" ? (
          <>
            <View style={styles.accountCard}>
              <AccountSubHeader eyebrow="Historial" title="Mis pedidos" />
              <Text style={styles.accountHint}>Tus pedidos recientes quedan guardados para rastrear, repetir o revisar el total.</Text>
              <View style={styles.accountFilterRow}>
                <OrderFilterChip active={orderFilter === "all"} label="Ultimos" onPress={() => setOrderFilter("all")} />
                <OrderFilterChip active={orderFilter === "delivery"} label="Delivery" onPress={() => setOrderFilter("delivery")} />
                <OrderFilterChip active={orderFilter === "pickup"} label="Recojo" onPress={() => setOrderFilter("pickup")} />
              </View>
            </View>

            <View style={styles.accountCard}>
              {visibleRecentOrders.length ? visibleRecentOrders.map((order) => (
                <Pressable key={order.id} onPress={() => onOpenRecentOrder(order)} style={({ pressed }) => [styles.accountOrderRow, pressed && styles.pressedCard]}>
                  <View style={styles.accountRowIcon}>
                    <ReceiptText color={colors.blue} size={17} strokeWidth={3} />
                  </View>
                  <View style={styles.recentOrderBody}>
                    <Text numberOfLines={1} style={styles.recentOrderName}>{order.restaurantName}</Text>
                    <Text style={styles.recentOrderMeta}>{order.orderNumber} | {formatBs(order.total)}</Text>
                  </View>
                  <View style={styles.accountOrderTrailing}>
                    <View style={[styles.accountOrderStatus, order.status === "cancelled" && styles.accountOrderStatusCancelled]}>
                      <Text style={[styles.accountOrderStatusText, order.status === "cancelled" && styles.accountOrderStatusTextCancelled]}>
                        {recentOrderStatusLabel(order)}
                      </Text>
                    </View>
                    <Text style={styles.accountOrderMode}>{recentOrderModeLabel(order.orderType)}</Text>
                  </View>
                  <ArrowRight color={colors.blue} size={18} strokeWidth={3} />
                </Pressable>
              )) : (
                <EmptyMessage description="Cuando confirmes un pedido aparecera aqui con acceso al seguimiento." title="Sin pedidos en este filtro" />
              )}
            </View>
          </>
        ) : panelView === "favorites" ? (
          <>
            <View style={styles.accountCard}>
              <AccountSubHeader eyebrow="Favoritos" title="Mis favoritos" />
              <Text style={styles.accountHint}>Tus locales y platos guardados quedan disponibles aqui para volver a ellos rapidamente.</Text>
              <View style={styles.accountFilterRow}>
                <OrderFilterChip active={favoriteFilter === "all"} label="Todos" onPress={() => setFavoriteFilter("all")} />
                <OrderFilterChip active={favoriteFilter === "restaurant"} label="Locales" onPress={() => setFavoriteFilter("restaurant")} />
                <OrderFilterChip active={favoriteFilter === "product"} label="Platos" onPress={() => setFavoriteFilter("product")} />
              </View>
            </View>
            <View style={styles.accountCard}>
              {visibleFavorites.length ? visibleFavorites.map((favorite) => (
                <Pressable key={favorite.id} onPress={() => onOpenRestaurant(favorite.restaurantSlug)} style={({ pressed }) => [styles.favoriteRow, pressed && styles.pressedCard]}>
                  <Image source={displayImageSource(favorite.imageUrl)} style={styles.favoriteImage} />
                  <View style={styles.favoriteRowBody}>
                    <Text style={styles.favoriteKind}>{favorite.kind === "restaurant" ? "Local" : "Plato"}</Text>
                    <Text numberOfLines={1} style={styles.favoriteTitle}>{favorite.title}</Text>
                    <Text numberOfLines={1} style={styles.favoriteSubtitle}>{favorite.subtitle}{favorite.price !== undefined ? ` | ${formatBs(favorite.price)}` : ""}</Text>
                  </View>
                  <FavoriteButton active onPress={() => onToggleFavorite(favorite)} />
                </Pressable>
              )) : (
                <EmptyMessage description="Toca el corazon de un local o plato para guardarlo aqui." title="Sin favoritos en este filtro" />
              )}
            </View>
          </>
        ) : panelView === "help" ? (
          <View style={styles.accountCard}>
            <AccountSubHeader eyebrow="Ayuda" title="Soporte" />
            <AccountMenuRow icon={<BellRing color={colors.blue} size={19} strokeWidth={3} />} meta={notificationSaving ? "Activando..." : notificationMeta} onPress={notificationSaving ? undefined : enableNotificationsFromAccount} title={notificationStatus === "ready" ? "Notificaciones activas" : "Activar notificaciones"} />
            <AccountMenuRow icon={<Bell color={colors.blue} size={19} strokeWidth={3} />} meta={notificationTesting ? "Enviando prueba..." : "Envia una prueba en este telefono"} onPress={notificationTesting ? undefined : testNotificationsFromAccount} title="Probar notificacion" />
            <AccountMenuRow icon={<MessageCircle color={colors.blue} size={19} strokeWidth={3} />} meta="Escribenos para revisar pedidos o datos de tu cuenta" onPress={() => Linking.openURL("https://yopido.shop").catch(() => undefined)} title="Contactar soporte" />
            {errorMessage ? <Text style={styles.submitError}>{errorMessage}</Text> : null}
            {successMessage ? <Text style={styles.successInline}>{successMessage}</Text> : null}
            <Text style={styles.accountHint}>Tambien puedes contactarnos desde el seguimiento de cada pedido cuando necesites hablar con el restaurante.</Text>
          </View>
        ) : (
          <>
            <View style={styles.accountCard}>
              <View style={styles.accountIdentityRow}>
                <View style={styles.accountAvatar}>
                  <Text style={styles.accountAvatarText}>{(greetingName || "Y").slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={styles.recentOrderBody}>
                  <Text style={styles.accountName}>{name.trim() || "Cliente Yopido"}</Text>
                  <Text numberOfLines={1} style={styles.accountEmail}>{sessionUser.email}</Text>
                </View>
                <Pressable onPress={openProfileEditor} style={({ pressed }) => [styles.accountEditButton, pressed && styles.pressedCard]}>
                  <UserRound color={colors.blue} size={17} strokeWidth={3} />
                  <Text style={styles.accountEditText}>{profileComplete ? "Editar datos" : "Completar"}</Text>
                </Pressable>
              </View>
              <Text style={profileComplete ? styles.accountProfileSummary : styles.accountProfileMissing}>
                {profileComplete ? `${phone.trim()} | CI ${documentNumber.trim()}` : "Completa tu telefono y carnet para comprar mas rapido."}
              </Text>
              {successMessage ? <Text style={styles.successInline}>{successMessage}</Text> : null}
            </View>

            <View style={styles.accountCard}>
              <SectionTitle eyebrow="Panel" title="Mi Yopido" />
              <AccountMenuRow icon={<MapPin color={colors.blue} size={19} strokeWidth={3} />} meta={addressCount ? `${addressCount} direcciones guardadas` : "Guarda casa, trabajo o favoritos"} onPress={() => setPanelView("addresses")} title="Mis direcciones" />
              <AccountMenuRow icon={<ReceiptText color={colors.blue} size={19} strokeWidth={3} />} meta={orderCount ? `${orderCount} pedidos recientes` : "Historial y seguimiento"} onPress={() => setPanelView("orders")} title="Mis pedidos" />
              <AccountMenuRow icon={<BellRing color={colors.blue} size={19} strokeWidth={3} />} meta={notificationSaving ? "Activando..." : notificationMeta} onPress={notificationSaving ? undefined : enableNotificationsFromAccount} title="Notificaciones de pedidos" />
              <AccountMenuRow icon={<Heart color={colors.blue} size={19} strokeWidth={3} />} meta={favoriteCount ? `${favoriteCount} favoritos guardados` : "Guarda locales y platos"} onPress={() => setPanelView("favorites")} title="Mis favoritos" />
              <AccountMenuRow icon={<MessageCircle color={colors.blue} size={19} strokeWidth={3} />} meta="Ayuda con pedidos o cuenta" onPress={() => setPanelView("help")} title="Ayuda y soporte" />
            </View>

            <Pressable onPress={signOut} style={({ pressed }) => [styles.accountLogoutButton, pressed && styles.pressedCard]}>
              <LogOut color={colors.danger} size={17} strokeWidth={3} />
              <Text style={styles.logoutText}>Cerrar sesion</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
      <Modal animationType="slide" onRequestClose={closeProfileEditor} transparent visible={profileEditorOpen}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.profileEditorOverlay}>
          <Pressable onPress={closeProfileEditor} style={styles.profileEditorBackdrop} />
          <SafeAreaView edges={["bottom"]} style={styles.profileEditorSheet}>
            <View style={styles.profileEditorHandle} />
            <View style={styles.profileEditorHeader}>
              <View style={styles.favoriteRowBody}>
                <Text style={styles.profileEditorEyebrow}>Perfil</Text>
                <Text style={styles.profileEditorTitle}>Editar mis datos</Text>
              </View>
              <IconButton onPress={closeProfileEditor}>
                <X color={colors.blue} size={21} strokeWidth={3} />
              </IconButton>
            </View>
            <Text style={styles.accountHint}>Estos datos se usaran para completar tus proximos pedidos.</Text>
            <InputBox onChangeText={setName} placeholder="Tu nombre" value={name} />
            <InputBox keyboardType="phone-pad" onChangeText={setPhone} placeholder="Telefono / WhatsApp" value={phone} />
            <InputBox keyboardType="number-pad" onChangeText={setDocumentNumber} placeholder="Carnet de identidad" value={documentNumber} />
            {errorMessage ? <Text style={styles.submitError}>{errorMessage}</Text> : null}
            <View style={styles.profileEditorActions}>
              <Pressable disabled={profileSaving} onPress={closeProfileEditor} style={({ pressed }) => [styles.profileCancelButton, pressed && styles.pressedCard]}>
                <Text style={styles.profileCancelText}>Cancelar</Text>
              </Pressable>
              <Pressable
                disabled={profileSaving || !name.trim() || !phone.trim() || !documentNumber.trim()}
                onPress={saveProfile}
                style={({ pressed }) => [styles.profileSaveButton, (profileSaving || !name.trim() || !phone.trim() || !documentNumber.trim()) && styles.profileSaveButtonDisabled, pressed && !profileSaving && styles.pressedCard]}
              >
                {profileSaving ? <ActivityIndicator color={colors.blue} size="small" /> : <Check color={colors.blue} size={18} strokeWidth={3.5} />}
                <Text style={styles.profileSaveText}>{profileSaving ? "Guardando..." : "Guardar datos"}</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
      {addressPickerOpen ? (
        <MapPickerModal
          collectAddressDetails
          initialLocation={null}
          onClose={() => setAddressPickerOpen(false)}
          onConfirm={saveAddressFromMap}
          saving={addressSaving}
        />
      ) : null}
    </SafeAreaView>
  );
}

function AccountMenuRow({ icon, title, meta, onPress }: { icon: ReactNode; title: string; meta: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.accountMenuRow, pressed && onPress && styles.pressedCard]}>
      <View style={styles.accountRowIcon}>{icon}</View>
      <View style={styles.recentOrderBody}>
        <Text style={styles.accountMenuTitle}>{title}</Text>
        <Text numberOfLines={1} style={styles.accountMenuMeta}>{meta}</Text>
      </View>
      <ArrowRight color={colors.blue} size={18} strokeWidth={3} />
    </Pressable>
  );
}

function AccountSubHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <View style={styles.accountSubHeader}>
      <View style={styles.recentOrderBody}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.title}>{title}</Text>
      </View>
    </View>
  );
}

function OrderFilterChip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.accountFilterChip, active && styles.accountFilterChipActive]}>
      <Text style={[styles.accountFilterText, active && styles.accountFilterTextActive]}>{label}</Text>
    </Pressable>
  );
}

function BottomNav({ active, onNavigate }: { active: "home" | "orders" | "promos" | "account"; onNavigate: (name: "home" | "promos" | "account") => void }) {
  const items = [
    { key: "home" as const, label: "Inicio", icon: Home },
    { key: "promos" as const, label: "Promos", icon: Flame },
    { key: "account" as const, label: "Mi Yopido", icon: UserRound },
  ];
  const useLiquidGlass = Platform.OS === "ios" && isGlassEffectAPIAvailable();

  const content = items.map((item) => {
    const Icon = item.icon;
    const selected = active === item.key;
    return (
      <Pressable key={item.key} onPress={() => onNavigate(item.key)} style={({ pressed }) => [styles.bottomNavItem, Platform.OS === "ios" && styles.bottomNavItemIos, selected && styles.bottomNavItemActive, useLiquidGlass && selected && styles.bottomNavItemActiveGlass, pressed && styles.bottomNavItemPressed]}>
        {useLiquidGlass && selected ? (
          <GlassView
            colorScheme="light"
            glassEffectStyle={{ animate: true, animationDuration: 0.24, style: "clear" }}
            isInteractive
            style={styles.bottomNavActiveGlass}
            tintColor="rgba(183,255,0,0.30)"
          />
        ) : null}
        <Icon color={selected ? colors.blue : Platform.OS === "ios" ? "#31516F" : colors.muted} size={Platform.OS === "ios" ? 20 : 19} strokeWidth={3} />
        <Text style={[styles.bottomNavText, Platform.OS === "ios" && styles.bottomNavTextIos, selected && styles.bottomNavTextActive]}>{item.label}</Text>
      </Pressable>
    );
  });

  if (useLiquidGlass) {
    return (
      <GlassContainer spacing={10} style={styles.bottomNavGlassContainer}>
        <GlassView colorScheme="light" glassEffectStyle="regular" isInteractive style={styles.bottomNavGlass} tintColor="rgba(255,255,255,0.46)">
          {content}
        </GlassView>
      </GlassContainer>
    );
  }

  return <View style={[styles.bottomNav, Platform.OS === "ios" && styles.bottomNavIosFallback]}>{content}</View>;
}

function HomeFooter({
  mostVisited,
  mostOrderedRestaurants,
  mostOrderedProducts,
  onOpenRestaurant,
}: {
  mostVisited: RestaurantSummary[];
  mostOrderedRestaurants: RestaurantSummary[];
  mostOrderedProducts: PopularProductSummary[];
  onOpenRestaurant: (slug: string) => void;
}) {
  return (
    <View style={styles.homeFooter}>
      <RankingSection
        icon={<TrendingUp color={colors.blue} size={21} strokeWidth={3} />}
        metric={(restaurant) => (restaurant.visits7d ? `${restaurant.visits7d} visitas esta semana` : "Activo en yopido.shop")}
        onOpenRestaurant={onOpenRestaurant}
        restaurants={mostVisited}
        title="Mas visitados"
      />
      <RankingSection
        icon={<Flame color={colors.blue} size={21} strokeWidth={3} />}
        metric={(restaurant) => (restaurant.orders30d ? `${restaurant.orders30d} pedidos 30d` : restaurant.popularProducts.slice(0, 2).join(" | ") || "Listo para pedir")}
        onOpenRestaurant={onOpenRestaurant}
        restaurants={mostOrderedRestaurants}
        title="Mas pedidos"
      />
      <PopularProductsSection onOpenRestaurant={onOpenRestaurant} products={mostOrderedProducts} />
    </View>
  );
}

function RankingSection({
  title,
  icon,
  restaurants,
  metric,
  onOpenRestaurant,
}: {
  title: string;
  icon: ReactNode;
  restaurants: RestaurantSummary[];
  metric: (restaurant: RestaurantSummary) => string;
  onOpenRestaurant: (slug: string) => void;
}) {
  if (!restaurants.length) return null;

  return (
    <View style={styles.rankingSection}>
      <View style={styles.rankingTitleRow}>
        <SectionTitle eyebrow="Ranking" title={title} />
        <View style={styles.rankingTitleIcon}>{icon}</View>
      </View>
      <View style={styles.rankingCard}>
        {restaurants.slice(0, 4).map((restaurant, index) => (
          <Pressable key={`${title}-${restaurant.id}`} onPress={() => onOpenRestaurant(restaurant.slug)} style={({ pressed }) => [styles.rankingRow, pressed && styles.pressedCard]}>
            <View style={styles.rankingRank}>
              <Text style={styles.rankingRankText}>{index + 1}</Text>
            </View>
            <RestaurantLogo restaurant={restaurant} size={56} />
            <View style={styles.rankingBody}>
              <Text numberOfLines={1} style={styles.rankingName}>{restaurant.name}</Text>
              <Text numberOfLines={1} style={styles.rankingMetric}>{metric(restaurant)}</Text>
            </View>
            <ArrowRight color={colors.blue} size={18} strokeWidth={3.2} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function PopularProductsSection({ products, onOpenRestaurant }: { products: PopularProductSummary[]; onOpenRestaurant: (slug: string) => void }) {
  if (!products.length) return null;

  return (
    <View style={styles.rankingSection}>
      <View style={styles.rankingTitleRow}>
        <SectionTitle eyebrow="Productos" title="Productos mas pedidos" />
        <View style={styles.rankingTitleIcon}>
          <ShoppingBag color={colors.blue} size={21} strokeWidth={3} />
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.productRail}>
        {products.slice(0, 8).map((product) => (
          <Pressable key={product.id} onPress={() => onOpenRestaurant(product.restaurantSlug)} style={({ pressed }) => [styles.popularProductCard, pressed && styles.pressedCard]}>
            <ImageBackground source={displayImageSource(product.imageUrl)} style={styles.popularProductImage} imageStyle={styles.popularProductImageRadius}>
              <LinearGradient colors={["rgba(8,36,65,0)", "rgba(8,36,65,0.64)"]} style={styles.popularProductOverlay} />
            </ImageBackground>
            <Text numberOfLines={2} style={styles.popularProductName}>{product.name}</Text>
            <Text numberOfLines={1} style={styles.popularProductRestaurant}>{product.restaurantName}</Text>
            <Text style={styles.popularProductPrice}>{formatBs(product.price)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function LocationSheet({
  canAddAddress,
  currentCity,
  currentLocation,
  error,
  loading,
  onAddAddress,
  onClose,
  onSelectAddress,
  onUseCurrentLocation,
  savedAddresses,
}: {
  canAddAddress: boolean;
  currentCity: string;
  currentLocation?: UserLocation;
  error: string;
  loading: boolean;
  onAddAddress: () => void;
  onClose: () => void;
  onSelectAddress: (address: SavedAddress) => void | Promise<void>;
  onUseCurrentLocation: () => void | Promise<unknown>;
  savedAddresses: SavedAddress[];
}) {
  function isActiveAddress(address: SavedAddress) {
    if (!currentLocation || address.latitude === undefined || address.longitude === undefined) return false;
    return Math.abs(currentLocation.latitude - address.latitude) < 0.0001
      && Math.abs(currentLocation.longitude - address.longitude) < 0.0001;
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible>
      <View style={styles.searchModalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView edges={["bottom"]} style={styles.locationSheet}>
          <View style={styles.searchHandle} />
          <View style={styles.locationSheetHeader}>
            <View style={styles.locationSheetHeading}>
              <Text style={styles.searchSheetEyebrow}>Ubicacion</Text>
              <Text style={styles.locationSheetTitle}>Donde quieres pedir</Text>
            </View>
            {currentLocation ? (
              <IconButton light onPress={onClose}>
                <X color={colors.blue} size={22} strokeWidth={3} />
              </IconButton>
            ) : null}
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.locationSheetContent}>
            {error ? <Text style={styles.locationSheetError}>{error}</Text> : null}
            <Pressable
              disabled={loading}
              onPress={onUseCurrentLocation}
              style={({ pressed }) => [styles.locationOptionRow, styles.locationOptionCurrent, pressed && !loading && styles.pressedCard]}
            >
              <View style={[styles.locationOptionIcon, styles.locationOptionIconActive]}>
                {loading ? <ActivityIndicator color={colors.blue} size="small" /> : <Navigation color={colors.blue} size={19} strokeWidth={3} />}
              </View>
              <View style={styles.locationOptionBody}>
                <Text style={styles.locationOptionTitle}>Mi ubicacion actual</Text>
                <Text numberOfLines={1} style={styles.locationOptionText}>{currentCity || "Detectar ciudad con GPS"}</Text>
              </View>
              <ArrowRight color={colors.blue} size={18} strokeWidth={3} />
            </Pressable>

            <View style={styles.locationSavedHeader}>
              <Text style={styles.locationSavedTitle}>Ubicaciones guardadas</Text>
              {canAddAddress ? (
              <Pressable disabled={loading} onPress={onAddAddress} style={({ pressed }) => [styles.locationAddButton, pressed && !loading && styles.pressedCard]}>
                <Plus color={colors.blue} size={16} strokeWidth={2.8} />
                <Text style={styles.locationAddButtonText}>Añadir</Text>
              </Pressable>
              ) : null}
            </View>
            {savedAddresses.length ? (
              savedAddresses.map((address) => {
                const selectable = Number.isFinite(address.latitude) && Number.isFinite(address.longitude);
                const active = isActiveAddress(address);
                return (
                  <Pressable
                    disabled={!selectable || loading}
                    key={address.id}
                    onPress={() => onSelectAddress(address)}
                    style={({ pressed }) => [
                      styles.locationOptionRow,
                      !selectable && styles.locationOptionDisabled,
                      pressed && selectable && !loading && styles.pressedCard,
                    ]}
                  >
                    <View style={styles.locationOptionIcon}>
                      <MapPin color={colors.blue} size={18} strokeWidth={3} />
                    </View>
                    <View style={styles.locationOptionBody}>
                      <Text numberOfLines={1} style={styles.locationOptionTitle}>{address.label || "Direccion guardada"}</Text>
                      <Text numberOfLines={1} style={styles.locationOptionText}>{[address.address, address.city].filter(Boolean).join(" - ")}</Text>
                    </View>
                    {active ? (
                      <View style={styles.locationActiveCheck}>
                        <Check color={colors.blue} size={15} strokeWidth={3.2} />
                      </View>
                    ) : (
                      <ArrowRight color={colors.muted} size={17} strokeWidth={3} />
                    )}
                  </Pressable>
                );
              })
            ) : (
              <View style={styles.locationSavedEmpty}>
                <MapPin color={colors.muted} size={19} strokeWidth={2.8} />
                <Text style={styles.locationSavedEmptyText}>Aun no tienes direcciones guardadas. Agrega una para empezar a pedir.</Text>
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function SearchSheet({
  query,
  setQuery,
  restaurants,
  productSuggestions,
  typeCounts,
  onSelectBusinessType,
  onOpenRestaurant,
  onClose,
}: {
  query: string;
  setQuery: (value: string) => void;
  restaurants: RestaurantSummary[];
  productSuggestions: PopularProductSummary[];
  typeCounts: Map<string, number>;
  onSelectBusinessType: (value: string) => void;
  onOpenRestaurant: (slug: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(query);
  const normalized = draft.trim().toLowerCase();
  const restaurantMatches = restaurants
    .filter((restaurant) => !normalized || [restaurant.name, restaurant.description, restaurant.city, ...restaurant.popularProducts].some((value) => value.toLowerCase().includes(normalized)))
    .slice(0, 6);
  const productMatches = productSuggestions
    .filter((product) => !normalized || [product.name, product.description, product.restaurantName].some((value) => value.toLowerCase().includes(normalized)))
    .slice(0, 8);

  function applySearch() {
    setQuery(draft.trim());
    onClose();
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible>
      <View style={styles.searchModalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView edges={["bottom"]} style={styles.searchSheet}>
          <View style={styles.searchHandle} />
          <View style={styles.searchSheetHeader}>
            <View>
              <Text style={styles.searchSheetEyebrow}>Buscar</Text>
              <Text style={styles.searchSheetTitle}>Encuentra lo que buscas</Text>
            </View>
            <IconButton light onPress={onClose}>
              <X color={colors.blue} size={22} strokeWidth={3} />
            </IconButton>
          </View>

          <View style={styles.searchSheetInputWrap}>
            <Search color={colors.blue} size={22} strokeWidth={3} />
            <TextInput autoFocus onChangeText={setDraft} onSubmitEditing={applySearch} placeholder="Local, producto o rubro" placeholderTextColor="#8A98AB" returnKeyType="search" style={styles.searchSheetInput} value={draft} />
            {draft ? (
              <Pressable onPress={() => setDraft("")}>
                <X color={colors.muted} size={18} strokeWidth={3} />
              </Pressable>
            ) : null}
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.searchBlock}>
              <Text style={styles.searchBlockTitle}>Rubros</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.searchBusinessRail}>
                {businessTypes.map((businessType) => {
                  const count = typeCounts.get(businessType.value) ?? 0;
                  if (!count && restaurants.length && businessType.value !== "other") return null;
                  return (
                    <BusinessChip
                      active={false}
                      businessType={businessType}
                      count={count}
                      key={`search-${businessType.value}`}
                      onPress={() => {
                        onSelectBusinessType(businessType.value);
                        onClose();
                      }}
                    />
                  );
                })}
              </ScrollView>
            </View>

            <View style={styles.searchBlock}>
              <View style={styles.searchBlockHeader}>
                <Text style={styles.searchBlockTitle}>Locales</Text>
                <Pressable onPress={applySearch} style={styles.applySearchButton}>
                  <Text style={styles.applySearchText}>Aplicar</Text>
                </Pressable>
              </View>
              {restaurantMatches.map((restaurant) => (
                <RestaurantSearchRow
                  key={`sheet-restaurant-${restaurant.id}`}
                  onPress={() => {
                    setQuery(draft.trim());
                    onClose();
                    onOpenRestaurant(restaurant.slug);
                  }}
                  restaurant={restaurant}
                />
              ))}
            </View>

            {productMatches.length ? (
              <View style={styles.searchBlock}>
                <Text style={styles.searchBlockTitle}>Productos</Text>
                {productMatches.map((product) => (
                  <ProductSearchRow
                    key={`sheet-product-${product.id}`}
                    onPress={() => {
                      setQuery(product.name);
                      onClose();
                      onOpenRestaurant(product.restaurantSlug);
                    }}
                    product={product}
                  />
                ))}
              </View>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function RestaurantSearchRow({ restaurant, onPress }: { restaurant: RestaurantSummary; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.searchResultRow, pressed && styles.pressedCard]}>
      <RestaurantLogo restaurant={restaurant} size={46} />
      <View style={styles.searchResultBody}>
        <Text numberOfLines={1} style={styles.searchResultTitle}>{restaurant.name}</Text>
        <Text numberOfLines={1} style={styles.searchResultText}>{restaurant.popularProducts.slice(0, 2).join(" | ") || restaurant.city || "Catalogo disponible"}</Text>
      </View>
      <ArrowRight color={colors.blue} size={18} strokeWidth={3.2} />
    </Pressable>
  );
}

function ProductSearchRow({ product, onPress }: { product: PopularProductSummary; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.searchResultRow, pressed && styles.pressedCard]}>
      <ImageBackground source={displayImageSource(product.imageUrl)} style={styles.searchProductImage} imageStyle={styles.searchProductImageRadius} />
      <View style={styles.searchResultBody}>
        <Text numberOfLines={1} style={styles.searchResultTitle}>{product.name}</Text>
        <Text numberOfLines={1} style={styles.searchResultText}>{product.restaurantName} - {formatBs(product.price)}</Text>
      </View>
      <ArrowRight color={colors.blue} size={18} strokeWidth={3.2} />
    </Pressable>
  );
}

function FeaturedRestaurantCard({ favorite, restaurant, index, onPress, onToggleFavorite }: { favorite: boolean; restaurant: RestaurantSummary; index: number; onPress: () => void; onToggleFavorite: () => void | Promise<void> }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.featuredCard, pressed && styles.pressedCard]}>
      <ImageBackground source={displayImageSource(restaurant.bannerUrl)} style={styles.featuredImage} imageStyle={styles.featuredImageRadius}>
        <LinearGradient colors={["rgba(8,36,65,0.02)", "rgba(8,36,65,0.82)"]} style={styles.featuredOverlay}>
          <View style={styles.featuredTopRow}>
            <View style={styles.rankPill}>
              <Navigation color={colors.blue} size={13} strokeWidth={3} />
              <Text style={styles.rankText}>#{index} mas usado</Text>
            </View>
            <FavoriteButton active={favorite} onPress={onToggleFavorite} />
          </View>
          <View style={styles.featuredBottom}>
            <RestaurantLogo restaurant={restaurant} size={68} />
            <View style={styles.featuredCopy}>
              <Text numberOfLines={1} style={styles.featuredTitle}>{restaurant.name}</Text>
              <Text numberOfLines={1} style={styles.featuredSubtitle}>{restaurant.description || restaurant.city}</Text>
              <View style={styles.localButton}>
                <Text style={styles.localButtonText}>Ver local</Text>
                <ArrowRight color={colors.blue} size={17} strokeWidth={3.5} />
              </View>
            </View>
          </View>
        </LinearGradient>
      </ImageBackground>
    </Pressable>
  );
}

function RestaurantResultCard({ favorite, restaurant, onPress, onToggleFavorite }: { favorite: boolean; restaurant: RestaurantSummary; onPress: () => void; onToggleFavorite: () => void | Promise<void> }) {
  const distance = formatDistance(restaurant.distanceKm);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.resultCard, pressed && styles.pressedCard]}>
      <RestaurantLogo restaurant={restaurant} size={56} />
      <View style={styles.resultBody}>
        <Text numberOfLines={1} style={styles.resultTitle}>{restaurant.name}</Text>
        <Text numberOfLines={1} style={styles.resultSubtitle}>{restaurant.description || restaurant.city || "Catalogo disponible"}</Text>
        {distance ? (
          <View style={styles.miniDistance}>
            <MapPin color={colors.blue} size={12} strokeWidth={3} />
            <Text style={styles.miniDistanceText}>{distance}</Text>
          </View>
        ) : null}
      </View>
      <FavoriteButton active={favorite} onPress={onToggleFavorite} />
    </Pressable>
  );
}

function ProductCard({
  favorite,
  orderingDisabled = false,
  product,
  quantity,
  onAdd,
  onMinus,
  onPress,
  onToggleFavorite,
}: {
  favorite: boolean;
  orderingDisabled?: boolean;
  product: ProductSummary;
  quantity: number;
  onAdd: () => void;
  onMinus: () => void;
  onPress: () => void;
  onToggleFavorite: () => void | Promise<void>;
}) {
  const isConfigurable = Boolean(product.variants.length || product.optionGroups.length);
  const showTop = product.isFeatured || product.orderCount > 0;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.productCard, quantity > 0 && styles.productCardSelected, pressed && styles.pressedCard]}>
      <ImageBackground source={displayImageSource(product.imageUrl)} style={styles.productImage} imageStyle={styles.productImageRadius}>
        <View style={styles.productFavoriteButton}>
          <FavoriteButton active={favorite} compact onPress={onToggleFavorite} />
        </View>
        {showTop ? (
          <View style={styles.productTopBadge}>
            <Text style={styles.productTopText}>Top</Text>
          </View>
        ) : null}
      </ImageBackground>
      <View style={styles.productBody}>
        {isConfigurable ? (
          <View style={styles.productConfigBadge}>
            <Text style={styles.productConfigText}>Personalizable</Text>
          </View>
        ) : null}
        <Text numberOfLines={1} style={styles.productName}>{product.name}</Text>
        <Text numberOfLines={2} style={styles.productDescription}>{product.description || "Listo para agregar a tu pedido."}</Text>
        <View style={styles.productMetaLine}>
          <View style={styles.productOrdersPill}>
            <Text style={styles.productOrdersText}>{product.orderCount || 0} pedidos</Text>
          </View>
          <Text style={styles.productPrice}>{formatBs(product.price)}</Text>
        </View>
      </View>
      {quantity ? (
        <View style={styles.quantityControl}>
          <Pressable onPress={(event) => { event.stopPropagation(); onMinus(); }} style={styles.qtyButton}><Minus color={colors.blue} size={15} strokeWidth={3} /></Pressable>
          <Text style={styles.qtyText}>{quantity}</Text>
          <Pressable disabled={orderingDisabled} onPress={(event) => { event.stopPropagation(); onAdd(); }} style={[styles.qtyButton, orderingDisabled && styles.qtyButtonDisabled]}><Plus color={colors.blue} size={15} strokeWidth={3} /></Pressable>
        </View>
      ) : (
        <Pressable disabled={orderingDisabled} onPress={(event) => { event.stopPropagation(); onAdd(); }} style={[styles.addButton, orderingDisabled && styles.addButtonDisabled]}>
          <Plus color={colors.blue} size={22} strokeWidth={2.8} />
        </Pressable>
      )}
    </Pressable>
  );
}

function FavoriteButton({ active, compact = false, onPress }: { active: boolean; compact?: boolean; onPress: () => void | Promise<void> }) {
  return (
    <Pressable
      accessibilityLabel={active ? "Quitar de favoritos" : "Guardar en favoritos"}
      onPress={(event) => {
        event.stopPropagation();
        void onPress();
      }}
      style={({ pressed }) => [styles.favoriteButton, compact && styles.favoriteButtonCompact, active && styles.favoriteButtonActive, pressed && styles.pressedCard]}
    >
      <Heart color={active ? colors.danger : colors.blue} fill={active ? colors.danger : "transparent"} size={compact ? 16 : 18} strokeWidth={2.4} />
    </Pressable>
  );
}

function ProductModal({
  orderingDisabled = false,
  orderingDisabledReason,
  product,
  quantity,
  onAdd,
  onClose,
}: {
  orderingDisabled?: boolean;
  orderingDisabledReason?: string;
  product: ProductSummary;
  quantity: number;
  onAdd: (line: CartLine) => void;
  onClose: () => void;
}) {
  const { height } = useWindowDimensions();
  const [variantId, setVariantId] = useState(product.variants[0]?.id ?? "");
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {};
    product.optionGroups.forEach((group) => {
      initial[group.id] = group.isRequired && group.minChoices > 0 && group.options[0] ? [group.options[0].id] : [];
    });
    return initial;
  });
  const selectedVariant = product.variants.find((variant) => variant.id === variantId);
  const selectedOptionRows = product.optionGroups.flatMap((group) => group.options.filter((option) => selectedOptions[group.id]?.includes(option.id)));
  const configuredPrice = product.price + (selectedVariant?.priceDelta ?? 0) + selectedOptionRows.reduce((sum, option) => sum + option.priceDelta, 0);
  const customizationCount = product.optionGroups.reduce((sum, group) => sum + group.options.length, 0);
  const configurationRows = product.variants.length + customizationCount;
  const sheetMaxHeight = Math.round(height * 0.94);
  const productImageHeight = Math.round(Math.min(height * 0.31, 246));
  const variantError = product.variants.length > 0 && !selectedVariant;
  const configError = product.optionGroups.find((group) => {
    const count = selectedOptions[group.id]?.length ?? 0;
    return count < group.minChoices || count > group.maxChoices;
  });
  const canAdd = !orderingDisabled && !variantError && !configError;

  function toggleOption(groupId: string, optionId: string) {
    const group = product.optionGroups.find((item) => item.id === groupId);
    if (!group) return;

    setSelectedOptions((current) => {
      const selected = current[groupId] ?? [];
      const exists = selected.includes(optionId);
      if (exists) {
        return { ...current, [groupId]: selected.filter((id) => id !== optionId) };
      }
      if (group.maxChoices === 1) {
        return { ...current, [groupId]: exists && !group.isRequired ? [] : [optionId] };
      }
      if (selected.length >= group.maxChoices) {
        return { ...current, [groupId]: [...selected.slice(1), optionId] };
      }
      return { ...current, [groupId]: [...selected, optionId] };
    });
  }

  function addToCart() {
    if (!canAdd) return;
    const optionIds = selectedOptionRows.map((option) => option.id);
    const detailParts = [selectedVariant?.name, ...selectedOptionRows.map((option) => option.name)].filter(Boolean);
    const cartId = [product.id, selectedVariant?.id ?? "base", ...optionIds.sort()].join(":");
    onAdd({
      cartId,
      productId: product.id,
      variantId: selectedVariant?.id,
      optionIds,
      name: selectedVariant ? `${product.name} - ${selectedVariant.name}` : product.name,
      description: product.description,
      imageUrl: product.imageUrl,
      price: configuredPrice,
      quantity: 0,
      notes: detailParts.join(" | ") || undefined,
    });
    onClose();
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} visible>
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.productSheetDynamic, configurationRows ? { height: sheetMaxHeight } : { maxHeight: sheetMaxHeight }]}>
          <ScrollView contentContainerStyle={styles.productModalScrollContent} showsVerticalScrollIndicator={false} style={styles.productModalScroll}>
            <ImageBackground source={displayImageSource(product.imageUrl)} style={[styles.sheetImage, { height: productImageHeight }]} imageStyle={styles.sheetImageRadius}>
              <LinearGradient colors={["rgba(8,36,65,0.08)", "rgba(8,36,65,0.22)", "rgba(8,36,65,0.76)"]} style={styles.sheetTop}>
                <View style={styles.sheetActionsRow}>
                  <IconButton light onPress={onClose}><ChevronLeft color={colors.blue} size={25} strokeWidth={3} /></IconButton>
                  <IconButton light onPress={() => shareProduct(product)}><Share2 color={colors.blue} size={20} strokeWidth={3} /></IconButton>
                </View>
              </LinearGradient>
            </ImageBackground>

            <View style={styles.productSheetBody}>
              <Text style={styles.sheetEyebrow}>Personalizar</Text>
              <Text style={styles.sheetTitle}>{product.name}</Text>
              <Text style={styles.sheetDescription}>{product.description || "Producto disponible para tu pedido."}</Text>

              {configurationRows ? <View style={styles.productModalStats}>
                <View style={styles.productModalStat}>
                  <Text style={styles.productModalStatValue}>{Math.max(product.variants.length, 1)}</Text>
                  <Text style={styles.productModalStatLabel}>Variantes</Text>
                </View>
                <View style={styles.productModalStat}>
                  <Text style={styles.productModalStatValue}>{customizationCount}</Text>
                  <Text style={styles.productModalStatLabel}>Personalizaciones</Text>
                </View>
                <View style={styles.productModalStat}>
                  <Text style={styles.productModalStatValue}>{formatBs(product.price)}</Text>
                  <Text style={styles.productModalStatLabel}>Base</Text>
                </View>
              </View> : null}

              <View style={styles.configScrollContent}>
                {product.variants.length ? (
                  <View style={styles.configBlock}>
                    <Text style={styles.configTitle}>Variante</Text>
                    {product.variants.map((variant) => (
                      <Pressable key={variant.id} onPress={() => setVariantId(variant.id)} style={[styles.configOption, variantId === variant.id && styles.configOptionActive]}>
                        <View style={styles.configOptionText}>
                          <Text style={styles.configOptionName}>{variant.name}</Text>
                          {variant.description ? <Text style={styles.configOptionDescription}>{variant.description}</Text> : null}
                        </View>
                        <Text style={styles.configOptionPrice}>{variant.priceDelta > 0 ? `+ ${formatBs(variant.priceDelta)}` : variant.priceDelta < 0 ? formatBs(variant.priceDelta) : "Incluido"}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                {product.optionGroups.map((group) => (
                  <View key={group.id} style={styles.configGroupCard}>
                    <View style={styles.configHeader}>
                      <View>
                        <Text style={styles.configTitle}>{group.name}</Text>
                        <Text style={styles.configHint}>{group.isRequired ? "Obligatorio" : "Opcional"} | elige {group.minChoices}-{group.maxChoices}</Text>
                      </View>
                      <View style={[styles.optionCountBadge, (selectedOptions[group.id]?.length ?? 0) >= group.minChoices && styles.optionCountBadgeOk]}>
                        <Text style={[styles.optionCountText, (selectedOptions[group.id]?.length ?? 0) >= group.minChoices && styles.optionCountTextOk]}>{selectedOptions[group.id]?.length ?? 0}/{group.maxChoices}</Text>
                      </View>
                    </View>
                    {group.description ? <Text style={styles.configDescription}>{group.description}</Text> : null}
                    {group.options.map((option) => {
                      const active = selectedOptions[group.id]?.includes(option.id);
                      return (
                        <Pressable key={option.id} onPress={() => toggleOption(group.id, option.id)} style={[styles.configOption, active && styles.configOptionActive]}>
                          <View style={[styles.configCheck, active && styles.configCheckActive]}>
                            {active ? <Check color="#FFFFFF" size={14} strokeWidth={3.4} /> : null}
                          </View>
                          <View style={styles.configOptionText}>
                            <Text style={styles.configOptionName}>{option.name}</Text>
                            {option.description ? <Text style={styles.configOptionDescription}>{option.description}</Text> : null}
                          </View>
                          <Text style={styles.configOptionPrice}>{option.priceDelta > 0 ? `+ ${formatBs(option.priceDelta)}` : option.priceDelta < 0 ? formatBs(option.priceDelta) : "Incluido"}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>

          <View style={styles.productModalFooter}>
            {variantError ? <Text style={styles.configError}>Elige una variante para continuar.</Text> : null}
            {configError ? <Text style={styles.configError}>Completa {configError.name}: minimo {configError.minChoices} opcion(es).</Text> : null}
            {orderingDisabled ? <Text style={styles.configError}>{orderingDisabledReason || "El local esta cerrado en este horario."}</Text> : null}
            <Text style={styles.footerLabel}>Total producto</Text>
            <Text style={styles.sheetPrice}>{formatBs(configuredPrice)}</Text>
            <Pressable disabled={!canAdd} onPress={addToCart} style={({ pressed }) => [styles.footerAddButton, !canAdd && styles.footerAddButtonDisabled, pressed && canAdd && styles.pressedCard]}>
              <Text style={styles.footerAddText}>{orderingDisabled ? "Fuera de horario" : quantity ? "Agregar otra" : "Agregar al pedido"}</Text>
              <ArrowRight color={colors.blue} size={18} strokeWidth={3.4} />
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ProductModalLegacy({ product, quantity, onAdd, onClose }: { product: ProductSummary; quantity: number; onAdd: (line: CartLine) => void; onClose: () => void }) {
  const [variantId, setVariantId] = useState(product.variants[0]?.id ?? "");
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {};
    product.optionGroups.forEach((group) => {
      initial[group.id] = group.isRequired && group.minChoices > 0 && group.options[0] ? [group.options[0].id] : [];
    });
    return initial;
  });
  const selectedVariant = product.variants.find((variant) => variant.id === variantId);
  const selectedOptionRows = product.optionGroups.flatMap((group) => group.options.filter((option) => selectedOptions[group.id]?.includes(option.id)));
  const configuredPrice = product.price + (selectedVariant?.priceDelta ?? 0) + selectedOptionRows.reduce((sum, option) => sum + option.priceDelta, 0);
  const configError = product.optionGroups.find((group) => {
    const count = selectedOptions[group.id]?.length ?? 0;
    return count < group.minChoices || count > group.maxChoices;
  });

  function toggleOption(groupId: string, optionId: string) {
    const group = product.optionGroups.find((item) => item.id === groupId);
    if (!group) return;

    setSelectedOptions((current) => {
      const selected = current[groupId] ?? [];
      const exists = selected.includes(optionId);
      if (exists) {
        return { ...current, [groupId]: selected.filter((id) => id !== optionId) };
      }
      if (group.maxChoices === 1) {
        return { ...current, [groupId]: [optionId] };
      }
      if (selected.length >= group.maxChoices) {
        return current;
      }
      return { ...current, [groupId]: [...selected, optionId] };
    });
  }

  function addToCart() {
    if (configError) return;
    const optionIds = selectedOptionRows.map((option) => option.id);
    const detailParts = [selectedVariant?.name, ...selectedOptionRows.map((option) => option.name)].filter(Boolean);
    const cartId = [product.id, selectedVariant?.id ?? "base", ...optionIds.sort()].join(":");
    onAdd({
      cartId,
      productId: product.id,
      variantId: selectedVariant?.id,
      optionIds,
      name: selectedVariant ? `${product.name} - ${selectedVariant.name}` : product.name,
      description: product.description,
      imageUrl: product.imageUrl,
      price: configuredPrice,
      quantity: 0,
      notes: detailParts.join(" | ") || undefined,
    });
    onClose();
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} visible>
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.productSheet}>
          <ImageBackground source={displayImageSource(product.imageUrl)} style={styles.sheetImage}>
            <LinearGradient colors={["rgba(8,36,65,0)", "rgba(8,36,65,0.7)"]} style={styles.sheetTop}>
              <IconButton light onPress={onClose}><X color={colors.blue} size={22} strokeWidth={3} /></IconButton>
            </LinearGradient>
          </ImageBackground>
          <View style={styles.sheetBody}>
            <Text style={styles.sheetTitle}>{product.name}</Text>
            <Text style={styles.sheetDescription}>{product.description || "Producto disponible para tu pedido."}</Text>
            <ScrollView showsVerticalScrollIndicator={false} style={styles.configScroll}>
              {product.variants.length ? (
                <View style={styles.configBlock}>
                  <Text style={styles.configTitle}>Elige una variante</Text>
                  {product.variants.map((variant) => (
                    <Pressable key={variant.id} onPress={() => setVariantId(variant.id)} style={[styles.configOption, variantId === variant.id && styles.configOptionActive]}>
                      <View style={styles.configOptionText}>
                        <Text style={styles.configOptionName}>{variant.name}</Text>
                        {variant.description ? <Text style={styles.configOptionDescription}>{variant.description}</Text> : null}
                      </View>
                      <Text style={styles.configOptionPrice}>{variant.priceDelta ? `+ Bs ${variant.priceDelta.toFixed(2)}` : "Incluido"}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {product.optionGroups.map((group) => (
                <View key={group.id} style={styles.configBlock}>
                  <View style={styles.configHeader}>
                    <Text style={styles.configTitle}>{group.name}</Text>
                    <Text style={styles.configHint}>{group.isRequired ? "Obligatorio" : "Opcional"} · max {group.maxChoices}</Text>
                  </View>
                  {group.description ? <Text style={styles.configDescription}>{group.description}</Text> : null}
                  {group.options.map((option) => {
                    const active = selectedOptions[group.id]?.includes(option.id);
                    return (
                      <Pressable key={option.id} onPress={() => toggleOption(group.id, option.id)} style={[styles.configOption, active && styles.configOptionActive]}>
                        <View style={styles.configCheck}>
                          {active ? <CheckCircle2 color={colors.blue} size={18} strokeWidth={3} /> : null}
                        </View>
                        <View style={styles.configOptionText}>
                          <Text style={styles.configOptionName}>{option.name}</Text>
                          {option.description ? <Text style={styles.configOptionDescription}>{option.description}</Text> : null}
                        </View>
                        <Text style={styles.configOptionPrice}>{option.priceDelta ? `+ Bs ${option.priceDelta.toFixed(2)}` : "Incluido"}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
            {configError ? <Text style={styles.configError}>Completa {configError.name}: minimo {configError.minChoices} opcion(es).</Text> : null}
            <Text style={styles.sheetPrice}>Bs {configuredPrice.toFixed(2)}</Text>
            <PrimaryButton disabled={Boolean(configError)} onPress={addToCart} text={quantity ? "Agregar otra configuracion" : "Agregar al pedido"} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function FloatingCart({ count, total, onPress }: { count: number; total: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.cartBar}>
      <View style={styles.cartIcon}><ShoppingBag color={colors.blue} size={25} strokeWidth={3} /></View>
      <View style={styles.cartInfo}>
        <Text style={styles.cartTotal}>Tu pedido</Text>
        <Text style={styles.cartLabel}>{count ? `${count} productos` : "Carrito vacio"}</Text>
      </View>
      <View style={styles.cartAction}>
        <Text style={styles.cartActionText}>{formatBs(total)}</Text>
        <ArrowRight color={colors.blue} size={17} strokeWidth={3.5} />
      </View>
    </Pressable>
  );
}

function CartSheet({
  customerAccessToken,
  customerStore,
  orderingDisabled = false,
  orderingDisabledReason,
  items,
  total,
  restaurant,
  onChangeQuantity,
  onClearCart,
  onClose,
  onRecentOrder,
  onSavedAddress,
  onTrackOrder,
  pushRegistration,
}: {
  customerAccessToken?: string;
  customerStore: CustomerStore;
  orderingDisabled?: boolean;
  orderingDisabledReason?: string;
  items: CartLine[];
  total: number;
  restaurant: RestaurantSummary;
  onChangeQuantity: (line: CartLine, delta: number) => void;
  onClearCart: () => void;
  onClose: () => void;
  onRecentOrder: (order: RecentOrder) => void;
  onSavedAddress: (address: Omit<SavedAddress, "id" | "updatedAt">) => void;
  onTrackOrder: (order: { customerPhone?: string; orderId: string; orderNumber?: string; trackingToken: string }) => void;
  pushRegistration: PushRegistration | null;
}) {
  const { height } = useWindowDimensions();
  const firstAddress = customerStore.addresses[0];
  const [customerName, setCustomerName] = useState(customerStore.profile.name);
  const [phone, setPhone] = useState(customerStore.profile.phone);
  const [address, setAddress] = useState(firstAddress?.address ?? "");
  const [notes, setNotes] = useState("");
  const [deliveryLocation, setDeliveryLocation] = useState<DeliveryLocation | null>(
    firstAddress?.latitude != null && firstAddress.longitude != null
      ? {
          latitude: firstAddress.latitude,
          longitude: firstAddress.longitude,
          mapsUrl: firstAddress.mapsUrl ?? googleMapsUrl(firstAddress.latitude, firstAddress.longitude),
          label: firstAddress.label,
        }
      : null,
  );
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const [orderType, setOrderType] = useState<"delivery" | "pickup">("pickup");
  const [fulfillmentMode, setFulfillmentMode] = useState<"now" | "scheduled">("now");
  const [requestedFulfillmentAt, setRequestedFulfillmentAt] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "qr">("cash");
  const [sending, setSending] = useState(false);
  const [locating, setLocating] = useState(false);
  const [sent, setSent] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [createdOrder, setCreatedOrder] = useState<{ orderId: string; orderNumber: string; trackingToken: string } | null>(null);
  const deliveryFee = orderType === "delivery" ? 8 : 0;
  const finalTotal = total + deliveryFee;
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const detailsReady = Boolean(customerName.trim() && phone.trim());
  const deliveryReady = orderType === "pickup" || Boolean(address.trim() && deliveryLocation);
  const submitDisabled = orderingDisabled || sending || locating || !items.length || !detailsReady || !deliveryReady;
  const cartMaxHeight = Math.round(height * 0.94);
  const primaryText = step === 3 ? (sending ? "Enviando pedido..." : "Confirmar pedido") : "Guardar y continuar";

  function goNext() {
    if (orderingDisabled) {
      setSubmitError(orderingDisabledReason || "El local esta cerrado en este horario.");
      return;
    }
    if (step === 0) {
      if (!items.length) {
        setSubmitError("Agrega productos del menu para continuar.");
        return;
      }
      setSubmitError("");
      setStep(1);
      return;
    }

    if (step === 1) {
      if (!detailsReady) {
        setSubmitError("Completa tu nombre y WhatsApp para continuar.");
        return;
      }
      if (!deliveryReady) {
        setSubmitError(orderType === "delivery" ? "Marca el punto de entrega y agrega una referencia." : "Completa los datos del pedido.");
        return;
      }
      setSubmitError("");
      setStep(2);
      return;
    }

    if (step === 2) {
      setSubmitError("");
      setStep(3);
      return;
    }

    void submit();
  }

  async function submit() {
    if (orderingDisabled) {
      setSubmitError(orderingDisabledReason || "El local esta cerrado en este horario.");
      return;
    }
    if (!items.length) {
      setSubmitError("Agrega al menos un producto para confirmar el pedido.");
      return;
    }
    if (orderType === "delivery" && !address.trim()) {
      setSubmitError("Escribe una direccion o referencia de entrega.");
      return;
    }
    if (orderType === "delivery" && !deliveryLocation) {
      setSubmitError("Marca tu ubicacion actual para que el restaurante pueda despachar el pedido.");
      return;
    }

    setSending(true);
    setSubmitError("");
    try {
      const order = await createMobileOrder({
        requestId: randomRequestId(),
        restaurantId: restaurant.id,
        restaurantSlug: restaurant.slug,
        customerName: customerName.trim(),
        customerPhone: phone.trim(),
        customerAddress: orderType === "delivery" ? address.trim() : undefined,
        deliveryLatitude: orderType === "delivery" ? deliveryLocation?.latitude : undefined,
        deliveryLongitude: orderType === "delivery" ? deliveryLocation?.longitude : undefined,
        deliveryMapsUrl: orderType === "delivery" ? deliveryLocation?.mapsUrl : undefined,
        orderType,
        paymentMethod,
        ...(pushRegistration
          ? {
              push: {
                deviceId: pushRegistration.deviceId,
                expoPushToken: pushRegistration.expoPushToken,
                platform: pushRegistration.platform,
              },
            }
          : {}),
        deliveryFee,
        notes: notes.trim() || undefined,
        items: items.map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          optionIds: item.optionIds,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          notes: item.notes,
        })),
      }, customerAccessToken);
      onRecentOrder({
        id: order.orderId,
        restaurantName: restaurant.name,
        restaurantSlug: restaurant.slug,
        orderNumber: order.orderNumber,
        customerPhone: phone.trim(),
        trackingToken: order.trackingToken,
        orderType,
        status: "pending",
        total: finalTotal,
        createdAt: new Date().toISOString(),
      });
      if (orderType === "delivery" && address.trim()) {
        onSavedAddress({
          label: deliveryLocation?.label ?? "Direccion de entrega",
          address: address.trim(),
          latitude: deliveryLocation?.latitude,
          longitude: deliveryLocation?.longitude,
          mapsUrl: deliveryLocation?.mapsUrl,
          city: restaurant.city,
        });
      }
      setCreatedOrder(order);
      setSent(true);
      onClearCart();
    } catch (error) {
      console.log("Mobile order submit failed", getMobileApiError(error) ?? error);
      setSubmitError(orderErrorMessage(error));
    } finally {
      setSending(false);
    }
  }

  async function captureDeliveryLocation() {
    setLocating(true);
    setSubmitError("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setSubmitError("Activa la ubicacion para marcar tu punto de entrega.");
        return;
      }

      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const latitude = current.coords.latitude;
      const longitude = current.coords.longitude;
      const mapsUrl = googleMapsUrl(latitude, longitude);
      const geocode = await Location.reverseGeocodeAsync({ latitude, longitude }).catch(() => []);
      const place = geocode[0];
      const label = [place?.street, place?.streetNumber, place?.district, place?.city].filter(Boolean).join(", ") || "Ubicacion marcada en Google Maps";
      setDeliveryLocation({ latitude, longitude, mapsUrl, label });
      if (!address.trim()) {
        setAddress(`${label}\n${mapsUrl}`);
      } else if (!address.includes(mapsUrl)) {
        setAddress(`${address.trim()}\n${mapsUrl}`);
      }
    } catch {
      setSubmitError("No pudimos obtener tu ubicacion. Intenta nuevamente.");
    } finally {
      setLocating(false);
    }
  }

  function openDeliveryMap() {
    setMapPickerOpen(true);
  }

  function handleBack() {
    if (mapPickerOpen) {
      setMapPickerOpen(false);
      return;
    }
    if (sent) {
      onClose();
      return;
    }
    if (step > 0) {
      setStep((current) => (current === 3 ? 2 : current === 2 ? 1 : 0));
      return;
    }
    onClose();
  }

  async function confirmDeliveryLocation(nextLocation: DeliveryLocation) {
    setDeliveryLocation(nextLocation);
    if (!address.trim()) {
      setAddress(`${nextLocation.label}\n${nextLocation.mapsUrl}`);
    } else if (!address.includes(nextLocation.mapsUrl)) {
      setAddress(`${address.trim()}\n${nextLocation.mapsUrl}`);
    }
    setMapPickerOpen(false);
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={handleBack} visible>
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.cartSheet, { maxHeight: cartMaxHeight }]}>
          <View style={styles.cartSheetHeader}>
            <View>
              <Text style={styles.cartSheetTitle}>{sent ? "Pedido enviado" : "Tu pedido"}</Text>
              <Text style={styles.cartSheetCount}>{itemCount} items</Text>
            </View>
            <IconButton light onPress={onClose}><X color={colors.blue} size={22} strokeWidth={3} /></IconButton>
          </View>

          {sent ? (
            <View style={styles.successBox}>
              <CheckCircle2 color={colors.blue} size={48} strokeWidth={2.7} />
              <Text style={styles.successTitle}>Listo, recibimos tu pedido</Text>
              <Text style={styles.successText}>{createdOrder?.orderNumber ? `Codigo de seguimiento: ${createdOrder.orderNumber}` : "El restaurante ya puede verlo en su panel."}</Text>
              {createdOrder ? (
                <PrimaryButton
                  icon={<Navigation color={colors.blue} size={18} strokeWidth={3} />}
                  onPress={() =>
                    onTrackOrder({
                      customerPhone: phone.trim(),
                      orderId: createdOrder.orderId,
                      orderNumber: createdOrder.orderNumber,
                      trackingToken: createdOrder.trackingToken,
                    })
                  }
                  text="Rastrear pedido"
                />
              ) : null}
              <PrimaryButton onPress={onClose} text="Seguir viendo locales" />
            </View>
          ) : (
            <>
              <ScrollView showsVerticalScrollIndicator={false} style={styles.cartScroll}>
                <OrderSteps current={step} total={finalTotal} />
                {step === 0 ? (
                  <>
                    <StepIntro icon={<Store color="#FFFFFF" size={20} strokeWidth={3} />} title="Como quieres recibirlo" description="Primero elegimos recojo o envio; despues aparecen solo los datos necesarios." />
                    {orderingDisabled ? (
                      <View style={styles.orderBlockedBox}>
                        <Clock3 color={colors.danger} size={19} strokeWidth={3} />
                        <Text style={styles.orderBlockedText}>{orderingDisabledReason || "El local esta cerrado en este horario."}</Text>
                      </View>
                    ) : null}
                    <View style={styles.choiceGrid}>
                      <ChoiceCard
                        active={orderType === "pickup"}
                        icon={<Store color={orderType === "pickup" ? "#FFFFFF" : colors.blue} size={20} strokeWidth={3} />}
                        label="Recojo en local"
                        onPress={() => setOrderType("pickup")}
                        text={restaurant.address || "El restaurante confirmara la direccion."}
                      />
                      <ChoiceCard
                        active={orderType === "delivery"}
                        icon={<Bike color={orderType === "delivery" ? "#FFFFFF" : colors.blue} size={20} strokeWidth={3} />}
                        label="Envio a domicilio"
                        onPress={() => setOrderType("delivery")}
                        text={deliveryFee ? `${formatBs(deliveryFee)} de envio` : "Delivery disponible"}
                      />
                    </View>

                    <StepIntro icon={<CalendarClock color="#FFFFFF" size={20} strokeWidth={3} />} title="Cuando lo necesitas" description={orderingDisabled ? "El negocio recibe pedidos solo dentro de su horario de atencion." : "Pedido habilitado dentro del horario de atencion."} />
                    <View style={styles.fulfillmentSwitch}>
                      <Pressable onPress={() => setFulfillmentMode("now")} style={[styles.fulfillmentSwitchButton, fulfillmentMode === "now" && styles.fulfillmentSwitchButtonActive]}>
                        <Text style={[styles.fulfillmentSwitchText, fulfillmentMode === "now" && styles.fulfillmentSwitchTextActive]}>Ahora mismo</Text>
                      </Pressable>
                      <Pressable onPress={() => setFulfillmentMode("scheduled")} style={[styles.fulfillmentSwitchButton, fulfillmentMode === "scheduled" && styles.fulfillmentSwitchButtonActive]}>
                        <Text style={[styles.fulfillmentSwitchText, fulfillmentMode === "scheduled" && styles.fulfillmentSwitchTextActive]}>Programar hora</Text>
                      </Pressable>
                    </View>
                    {fulfillmentMode === "scheduled" ? <InputBox onChangeText={setRequestedFulfillmentAt} placeholder="Fecha y hora, ej. hoy 20:30" value={requestedFulfillmentAt} /> : null}
                  </>
                ) : null}

                {step === 1 ? (
                  <>
                    <StepIntro icon={<UserRound color="#FFFFFF" size={20} strokeWidth={3} />} title="Datos del cliente" description={orderType === "delivery" ? "Para envio necesitamos nombre, WhatsApp y direccion." : "Para recojo bastan tus datos principales."} />
                    <InputBox onChangeText={setCustomerName} placeholder="Nombre completo" value={customerName} />
                    <InputBox keyboardType="phone-pad" onChangeText={setPhone} placeholder="WhatsApp" value={phone} />
                    {orderType === "delivery" ? (
                      <>
                        {customerStore.addresses.length ? (
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.savedAddressRail}>
                            {customerStore.addresses.map((saved) => (
                              <Pressable
                                key={saved.id}
                                onPress={() => {
                                  setAddress(saved.address);
                                  if (saved.latitude != null && saved.longitude != null) {
                                    setDeliveryLocation({
                                      latitude: saved.latitude,
                                      longitude: saved.longitude,
                                      mapsUrl: saved.mapsUrl ?? googleMapsUrl(saved.latitude, saved.longitude),
                                      label: saved.label,
                                    });
                                  }
                                }}
                                style={({ pressed }) => [styles.savedAddressChip, pressed && styles.pressedCard]}
                              >
                                <MapPin color={colors.blue} size={14} strokeWidth={3} />
                                <Text numberOfLines={1} style={styles.savedAddressText}>{saved.label}</Text>
                              </Pressable>
                            ))}
                          </ScrollView>
                        ) : null}
                        <InputBox multiline onChangeText={setAddress} placeholder="Direccion de entrega" value={address} />
                        <DeliveryMapPreview
                          location={deliveryLocation}
                          locating={locating}
                          onOpenMap={openDeliveryMap}
                          onUseCurrent={captureDeliveryLocation}
                        />
                      </>
                    ) : (
                      <View style={styles.pickupBox}>
                        <Store color={colors.blue} size={26} strokeWidth={3} />
                        <View style={styles.pickupText}>
                          <Text style={styles.pickupTitle}>Recojo en local</Text>
                          <Text style={styles.pickupDescription}>{restaurant.address || "El restaurante confirmara la direccion."}</Text>
                        </View>
                      </View>
                    )}
                    <InputBox multiline onChangeText={setNotes} placeholder="Notas para el restaurante, salsas, referencia o indicaciones" value={notes} />
                  </>
                ) : null}

                {step === 2 ? (
                  <>
                    <StepIntro icon={<CreditCard color="#FFFFFF" size={20} strokeWidth={3} />} title="Forma de pago" description="El efectivo queda registrado para caja. En QR el comprobante se validara con el restaurante." />
                    <View style={styles.segmentRow}>
                      <SegmentButton active={paymentMethod === "cash"} icon={<Banknote color={paymentMethod === "cash" ? colors.blue : colors.muted} size={16} strokeWidth={3} />} onPress={() => setPaymentMethod("cash")} text="Efectivo" />
                      <SegmentButton active={paymentMethod === "qr"} icon={<CreditCard color={paymentMethod === "qr" ? colors.blue : colors.muted} size={16} strokeWidth={3} />} onPress={() => setPaymentMethod("qr")} text="QR" />
                    </View>
                    <Text style={styles.paymentHint}>{paymentMethod === "cash" ? "El pedido quedara como pago en efectivo pendiente de validacion en caja." : "El restaurante confirmara el QR antes de preparar el pedido."}</Text>
                  </>
                ) : null}

                {step === 3 ? (
                  <>
                    <StepIntro icon={<ShoppingBag color="#FFFFFF" size={20} strokeWidth={3} />} title="Revision final" description="Confirma productos, entrega, pago y total antes de enviar." />
                    {items.map((item) => (
                      <View key={item.cartId} style={styles.reviewLine}>
                        <Image source={displayImageSource(item.imageUrl)} style={styles.reviewImage} />
                        <View style={styles.reviewBody}>
                          <Text numberOfLines={1} style={styles.cartLineName}>{item.name}</Text>
                          {item.notes ? <Text numberOfLines={2} style={styles.cartLineNotes}>{item.notes}</Text> : null}
                          <Text style={styles.cartLinePrice}>{formatBs(item.price)} c/u</Text>
                        </View>
                        <View style={styles.quantityControlSmall}>
                          <Pressable onPress={() => onChangeQuantity(item, -1)} style={styles.qtyButtonSmall}><Minus color={colors.blue} size={14} strokeWidth={4} /></Pressable>
                          <Text style={styles.qtyTextSmall}>{item.quantity}</Text>
                          <Pressable onPress={() => onChangeQuantity(item, 1)} style={styles.qtyButtonSmall}><Plus color={colors.blue} size={14} strokeWidth={4} /></Pressable>
                        </View>
                      </View>
                    ))}
                    <View style={styles.reviewSummary}>
                      <ReviewLine label="Modalidad" value={orderType === "delivery" ? "Envio a domicilio" : "Recojo en local"} />
                      <ReviewLine label="Horario" value={fulfillmentMode === "scheduled" ? requestedFulfillmentAt || "Programado" : "Ahora mismo"} />
                      <ReviewLine label="Cliente" value={customerName || "Sin nombre"} />
                      {orderType === "delivery" ? <ReviewLine label="Direccion" value={address || "Sin direccion"} /> : null}
                      <ReviewLine label="Pago" value={paymentMethod === "cash" ? "Efectivo" : "QR"} />
                    </View>
                  </>
                ) : null}

                <View style={styles.totalBox}>
                  <TotalLine label="Subtotal" value={formatBs(total)} />
                  <TotalLine label="Envio" value={formatBs(deliveryFee)} />
                  <TotalLine strong label="Total a pagar" value={formatBs(finalTotal)} />
                </View>

                {submitError ? <Text style={styles.submitError}>{submitError}</Text> : null}
                <View style={styles.orderFooterActions}>
                  {step > 0 ? (
                    <Pressable disabled={sending} onPress={() => setStep((current) => (current === 3 ? 2 : current === 2 ? 1 : 0))} style={({ pressed }) => [styles.backStepButton, pressed && styles.pressedCard]}>
                      <ChevronLeft color={colors.blue} size={18} strokeWidth={3} />
                      <Text style={styles.backStepText}>Atras</Text>
                    </Pressable>
                  ) : null}
                  <PrimaryButton disabled={step === 3 ? submitDisabled : orderingDisabled || sending || !items.length} icon={step === 3 ? <Send color={colors.blue} size={18} strokeWidth={3} /> : <ArrowRight color={colors.blue} size={18} strokeWidth={3} />} loading={sending} onPress={goNext} text={orderingDisabled ? "Fuera de horario" : primaryText} />
                </View>
              </ScrollView>
              {mapPickerOpen ? (
                <MapPickerModal
                  initialLocation={deliveryLocation}
                  onClose={() => setMapPickerOpen(false)}
                  onConfirm={confirmDeliveryLocation}
                  restaurant={restaurant}
                />
              ) : null}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function DeliveryMapPreview({
  location,
  locating,
  onOpenMap,
  onUseCurrent,
}: {
  location: { latitude: number; longitude: number; mapsUrl: string; label: string } | null;
  locating: boolean;
  onOpenMap: () => void;
  onUseCurrent: () => void;
}) {
  const mapImageUrl = location ? googleStaticMapUrl(location.latitude, location.longitude) : "";

  return (
    <View style={styles.deliveryMapCard}>
      <Pressable onPress={location ? onOpenMap : onUseCurrent} style={({ pressed }) => [styles.deliveryMapCanvas, pressed && styles.pressedCard]}>
        {mapImageUrl ? <Image source={{ uri: mapImageUrl }} style={styles.mapStaticImage} /> : null}
        {!mapImageUrl ? (
          <>
            <View style={styles.mapGridVertical} />
            <View style={styles.mapGridHorizontal} />
            <View style={styles.mapRoadOne} />
            <View style={styles.mapRoadTwo} />
          </>
        ) : null}
        <View style={styles.mapPin}>
          {locating ? <ActivityIndicator color="#FFFFFF" /> : <MapPin color="#FFFFFF" size={20} strokeWidth={3} />}
        </View>
        <View style={styles.mapLabel}>
          <Text numberOfLines={1} style={styles.mapLabelTitle}>{location ? "Punto de entrega" : "Marca tu ubicacion"}</Text>
          <Text numberOfLines={1} style={styles.mapLabelText}>{location ? location.label : "Toca para usar GPS o abre Google Maps"}</Text>
        </View>
      </Pressable>
      <View style={styles.mapActionRow}>
        <Pressable disabled={locating} onPress={onUseCurrent} style={({ pressed }) => [styles.mapActionButton, pressed && styles.pressedCard]}>
          {locating ? <ActivityIndicator color={colors.blue} /> : <Navigation color={colors.blue} size={15} strokeWidth={3} />}
          <Text style={styles.mapActionText}>{location ? "Actualizar punto" : "Usar mi ubicacion"}</Text>
        </Pressable>
        <Pressable onPress={onOpenMap} style={({ pressed }) => [styles.mapActionButton, styles.mapActionButtonDark, pressed && styles.pressedCard]}>
          <MapPin color="#FFFFFF" size={15} strokeWidth={3} />
          <Text style={styles.mapActionTextDark}>Elegir en mapa</Text>
        </Pressable>
      </View>
    </View>
  );
}

function OrderSteps({ current, total }: { current: 0 | 1 | 2 | 3; total: number }) {
  const steps = [
    { label: "Entrega", icon: Store },
    { label: "Datos", icon: UserRound },
    { label: "Pago", icon: CreditCard },
    { label: "Confirmar", icon: Check },
  ];
  return (
    <View style={styles.orderSteps}>
      <View style={styles.orderStepsHeader}>
        <View>
          <Text style={styles.orderStepsEyebrow}>Paso {current + 1} de {steps.length}</Text>
          <Text style={styles.orderStepsTitle}>{steps[current]?.label ?? "Tu pedido"}</Text>
        </View>
        <View style={styles.orderStepsTotal}>
          <Text style={styles.orderStepsTotalText}>{formatBs(total)}</Text>
        </View>
      </View>
      <View style={styles.orderStepsGrid}>
        {steps.map((stepItem, index) => {
          const active = index === current;
          const completed = index < current;
          const Icon = stepItem.icon;
          return (
            <View key={stepItem.label} style={[styles.orderStepTab, active && styles.orderStepTabActive, completed && styles.orderStepTabCompleted]}>
              <Icon color={active ? "#FFFFFF" : colors.muted} size={14} strokeWidth={3} />
              <Text numberOfLines={1} style={[styles.orderStepTabText, active && styles.orderStepTabTextActive]}>{stepItem.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function StepIntro({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <View style={styles.stepIntro}>
      <View style={styles.stepIntroIcon}>{icon}</View>
      <View style={styles.stepIntroText}>
        <Text style={styles.stepIntroTitle}>{title}</Text>
        <Text style={styles.stepIntroDescription}>{description}</Text>
      </View>
    </View>
  );
}

function ChoiceCard({ active, icon, label, text, onPress }: { active: boolean; icon: ReactNode; label: string; text: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.choiceCard, active && styles.choiceCardActive, pressed && styles.pressedCard]}>
      <View style={[styles.choiceIcon, active && styles.choiceIconActive]}>{icon}</View>
      <View style={styles.choiceBody}>
        <Text style={styles.choiceLabel}>{label}</Text>
        <Text numberOfLines={2} style={styles.choiceText}>{text}</Text>
      </View>
    </Pressable>
  );
}

function BusinessHoursModal({ hours, onClose, statusText }: { hours: BusinessHour[]; onClose: () => void; statusText: string }) {
  const rows = businessHoursSummary(hours);
  const hasSchedule = hours.some((hour) => !hour.isClosed && hour.opensAt && hour.closesAt);

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} visible>
      <View style={styles.hoursOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.hoursCard}>
          <View style={styles.hoursHeader}>
            <View style={styles.hoursIcon}>
              <Clock3 color={colors.blue} size={22} strokeWidth={3} />
            </View>
            <View style={styles.recentOrderBody}>
              <Text style={styles.cartSheetEyebrow}>Horarios</Text>
              <Text style={styles.hoursTitle}>Atencion del negocio</Text>
            </View>
            <IconButton light onPress={onClose}><X color={colors.blue} size={21} strokeWidth={3} /></IconButton>
          </View>
          <View style={styles.hoursStatusBox}>
            <Text style={styles.hoursStatusText}>{statusText}</Text>
          </View>
          {hasSchedule ? (
            <View style={styles.hoursRows}>
              {rows.map((row) => (
                <View key={row.day} style={styles.hoursRow}>
                  <Text style={styles.hoursDay}>{row.day}</Text>
                  <Text style={[styles.hoursValue, row.value === "Cerrado" && styles.hoursValueClosed]}>{row.value}</Text>
                </View>
              ))}
            </View>
          ) : (
            <EmptyMessage description="El negocio aun no guardo sus horarios. Por ahora permitimos pedidos." title="Sin horario configurado" />
          )}
        </View>
      </View>
    </Modal>
  );
}

function ReviewLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.reviewSummaryLine}>
      <Text style={styles.reviewSummaryLabel}>{label}</Text>
      <Text numberOfLines={2} style={styles.reviewSummaryValue}>{value}</Text>
    </View>
  );
}

function MapPickerModal({
  initialLocation,
  restaurant,
  collectAddressDetails = false,
  onClose,
  onConfirm,
  saving = false,
}: {
  initialLocation: DeliveryLocation | null;
  restaurant?: RestaurantSummary;
  collectAddressDetails?: boolean;
  onClose: () => void;
  onConfirm: (location: DeliveryLocation, details?: AddressDetails) => void | Promise<void>;
  saving?: boolean;
}) {
  const { height } = useWindowDimensions();
  const fallbackLatitude = restaurant?.latitude ?? -17.3895;
  const fallbackLongitude = restaurant?.longitude ?? -66.1568;
  const mapRef = useRef<any>(null);
  const webMapRef = useRef<WebView | null>(null);
  const useWebMap = Platform.OS === "android";
  const [region, setRegion] = useState({
    latitude: initialLocation?.latitude ?? fallbackLatitude,
    longitude: initialLocation?.longitude ?? fallbackLongitude,
    latitudeDelta: 0.012,
    longitudeDelta: 0.012,
  });
  const [locating, setLocating] = useState(false);
  const [label, setLabel] = useState("");
  const [apartment, setApartment] = useState("");
  const [reference, setReference] = useState("");
  const [buildingName, setBuildingName] = useState("");
  const [formError, setFormError] = useState("");
  const [mapTouching, setMapTouching] = useState(false);

  function moveMap(nextRegion: typeof region) {
    setRegion(nextRegion);
    if (useWebMap) {
      webMapRef.current?.injectJavaScript(
        `window.setYopidoMapCenter && window.setYopidoMapCenter(${nextRegion.latitude}, ${nextRegion.longitude}, ${leafletZoomFromDelta(nextRegion.latitudeDelta)}); true;`,
      );
      return;
    }
    mapRef.current?.animateToRegion(nextRegion, 280);
  }

  async function useCurrentLocation() {
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) return;
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      moveMap({
        ...region,
        latitudeDelta: Math.min(region.latitudeDelta, 0.012),
        longitudeDelta: Math.min(region.longitudeDelta, 0.012),
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
      });
    } finally {
      setLocating(false);
    }
  }

  function changeZoom(direction: "in" | "out") {
    if (useWebMap) {
      webMapRef.current?.injectJavaScript(`window.zoomYopidoMap && window.zoomYopidoMap("${direction}"); true;`);
      return;
    }
    const factor = direction === "in" ? 0.55 : 1.8;
    moveMap({
      ...region,
      latitudeDelta: Math.min(0.2, Math.max(0.0012, region.latitudeDelta * factor)),
      longitudeDelta: Math.min(0.2, Math.max(0.0012, region.longitudeDelta * factor)),
    });
  }

  function placePin(latitude: number, longitude: number) {
    moveMap({
      ...region,
      latitude,
      longitude,
    });
  }

  function handleWebMapMessage(event: WebViewMessageEvent) {
    try {
      const payload = JSON.parse(event.nativeEvent.data) as { latitude?: number; longitude?: number; type?: string; zoom?: number };
      if (typeof payload.latitude === "number" && typeof payload.longitude === "number") {
        setRegion((current) => {
          const delta = typeof payload.zoom === "number" ? leafletDeltaFromZoom(payload.zoom) : current.latitudeDelta;
          return {
            ...current,
            latitude: payload.latitude!,
            latitudeDelta: delta,
            longitude: payload.longitude!,
            longitudeDelta: delta,
          };
        });
      }
    } catch (error) {
      // Ignore non-map messages from the embedded picker.
    }
  }

  async function confirm() {
    const cleanDetails: AddressDetails | undefined = collectAddressDetails
      ? {
          apartment: apartment.trim(),
          buildingName: buildingName.trim(),
          label: label.trim(),
          reference: reference.trim(),
        }
      : undefined;
    if (collectAddressDetails && (!cleanDetails?.label || !cleanDetails.reference)) {
      setFormError("Completa el nombre y una referencia para encontrar la direccion.");
      return;
    }
    setFormError("");

    const latitude = region.latitude;
    const longitude = region.longitude;
    const mapsUrl = googleMapsUrl(latitude, longitude);
    const geocode = await Location.reverseGeocodeAsync({ latitude, longitude }).catch(() => []);
    const place = geocode[0];
    const locationLabel = [place?.street, place?.streetNumber, place?.district, place?.city].filter(Boolean).join(", ") || "Punto marcado en el mapa";
    await onConfirm({ latitude, longitude, mapsUrl, label: locationLabel }, cleanDetails);
  }

  let NativeMapView: any = null;
  let NativeProviderGoogle: any = null;
  if (Platform.OS !== "web") {
    const nativeMaps = require("react-native-maps");
    NativeMapView = nativeMaps.default;
    NativeProviderGoogle = nativeMaps.PROVIDER_GOOGLE;
  }

  const staticUrl = googleStaticMapUrl(region.latitude, region.longitude);
  const webMapHtml = useMemo(
    () => leafletPickerHtml(region.latitude, region.longitude, leafletZoomFromDelta(region.latitudeDelta)),
    [],
  );
  const mapHeight = Math.min(430, Math.max(330, Math.round(height * (collectAddressDetails ? 0.43 : 0.48))));

  return (
    <Modal
      animationType="slide"
      hardwareAccelerated={Platform.OS === "android"}
      onRequestClose={onClose}
      transparent
      visible
    >
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView edges={["bottom"]} style={[styles.mapPickerSheet, collectAddressDetails && styles.mapPickerSheetTall]}>
          <View style={styles.mapPickerHandle} />
          <View style={styles.mapPickerHeader}>
            <View>
              <Text style={styles.cartSheetEyebrow}>Entrega</Text>
              <Text style={styles.mapPickerTitle}>{collectAddressDetails ? "Nueva direccion" : "Marca tu punto"}</Text>
            </View>
            <IconButton light onPress={onClose}><X color={colors.blue} size={22} strokeWidth={3} /></IconButton>
          </View>
          <ScrollView contentContainerStyle={styles.mapPickerContent} keyboardShouldPersistTaps="handled" scrollEnabled={!mapTouching} showsVerticalScrollIndicator={false}>
            <View style={[styles.mapPickerCanvas, Platform.OS !== "android" && styles.mapPickerCanvasClipped, { height: mapHeight }]}>
              {useWebMap ? (
                <WebView
                  ref={webMapRef}
                  allowsInlineMediaPlayback
                  domStorageEnabled
                  javaScriptEnabled
                  mixedContentMode="always"
                  nestedScrollEnabled={false}
                  onMessage={handleWebMapMessage}
                  onTouchCancel={() => setMapTouching(false)}
                  onTouchEnd={() => setMapTouching(false)}
                  onTouchStart={() => setMapTouching(true)}
                  originWhitelist={["*"]}
                  overScrollMode="never"
                  scrollEnabled={false}
                  setSupportMultipleWindows={false}
                  source={{ html: webMapHtml, baseUrl: "https://yopido.shop" }}
                  style={styles.nativeMap}
                />
              ) : NativeMapView ? (
                <NativeMapView
                  initialRegion={region}
                  cacheEnabled={false}
                  googleRenderer={Platform.OS === "android" ? "LEGACY" : undefined}
                  loadingEnabled
                  loadingBackgroundColor={colors.softBlue}
                  loadingIndicatorColor={colors.blue}
                  mapType="standard"
                  mapPadding={{ bottom: 12, left: 12, right: 12, top: 12 }}
                  onPress={(event: any) => placePin(event.nativeEvent.coordinate.latitude, event.nativeEvent.coordinate.longitude)}
                  onRegionChangeComplete={setRegion}
                  pitchEnabled={false}
                  provider={NativeProviderGoogle}
                  ref={mapRef}
                  rotateEnabled={false}
                  scrollEnabled
                  style={styles.nativeMap}
                  toolbarEnabled={false}
                  zoomControlEnabled={false}
                  zoomEnabled
                />
              ) : (
                <>
                  {staticUrl ? <Image source={{ uri: staticUrl }} style={styles.mapStaticImage} /> : null}
                  <View style={styles.mapGridVertical} />
                  <View style={styles.mapGridHorizontal} />
                  <View style={styles.mapRoadOne} />
                  <View style={styles.mapRoadTwo} />
                </>
              )}
              <View pointerEvents="none" style={styles.mapCenterPinWrap}>
                <View style={styles.mapPinShadow} />
                <View style={styles.mapPin}>
                  <MapPin color="#FFFFFF" size={24} strokeWidth={3} />
                </View>
              </View>
              <View style={styles.mapZoomControls}>
                <Pressable accessibilityLabel="Acercar mapa" onPress={() => changeZoom("in")} style={({ pressed }) => [styles.mapZoomButton, pressed && styles.pressedCard]}>
                  <Plus color={colors.blue} size={21} strokeWidth={3.5} />
                </Pressable>
                <View style={styles.mapZoomDivider} />
                <Pressable accessibilityLabel="Alejar mapa" onPress={() => changeZoom("out")} style={({ pressed }) => [styles.mapZoomButton, pressed && styles.pressedCard]}>
                  <Minus color={colors.blue} size={21} strokeWidth={3.5} />
                </Pressable>
              </View>
              <Pressable disabled={locating} onPress={useCurrentLocation} style={({ pressed }) => [styles.mapLocateButton, pressed && styles.pressedCard]}>
                {locating ? <ActivityIndicator color={colors.blue} size="small" /> : <Navigation color={colors.blue} size={18} strokeWidth={3} />}
              </Pressable>
            </View>
            <Text style={styles.mapPickerHint}>Arrastra el mapa o toca otro punto hasta que el pin quede sobre tu puerta.</Text>

            {collectAddressDetails ? (
              <View style={styles.addressForm}>
                <View>
                  <Text style={styles.addressFieldLabel}>Nombre</Text>
                  <InputBox onChangeText={setLabel} placeholder="Casa, trabajo, oficina..." value={label} />
                </View>
                <View style={styles.addressFormRow}>
                  <View style={styles.addressFormColumn}>
                    <Text style={styles.addressFieldLabel}>Apartamento (opcional)</Text>
                    <InputBox onChangeText={setApartment} placeholder="Piso, depto." value={apartment} />
                  </View>
                  <View style={styles.addressFormColumn}>
                    <Text style={styles.addressFieldLabel}>Edificio (opcional)</Text>
                    <InputBox onChangeText={setBuildingName} placeholder="Nombre" value={buildingName} />
                  </View>
                </View>
                <View>
                  <Text style={styles.addressFieldLabel}>Referencia</Text>
                  <InputBox multiline onChangeText={setReference} placeholder="Porton, color de puerta o indicacion para llegar" value={reference} />
                </View>
                {formError ? <Text style={styles.submitError}>{formError}</Text> : null}
              </View>
            ) : null}

            <View style={styles.mapActionRow}>
              {!collectAddressDetails ? (
                <Pressable disabled={locating} onPress={useCurrentLocation} style={({ pressed }) => [styles.mapActionButton, pressed && styles.pressedCard]}>
                  {locating ? <ActivityIndicator color={colors.blue} /> : <Navigation color={colors.blue} size={15} strokeWidth={3} />}
                  <Text style={styles.mapActionText}>Mi ubicacion</Text>
                </Pressable>
              ) : null}
              <Pressable disabled={saving} onPress={confirm} style={({ pressed }) => [styles.mapActionButton, styles.mapActionButtonDark, collectAddressDetails && styles.mapSaveAddressButton, saving && styles.primaryButtonDisabled, pressed && !saving && styles.pressedCard]}>
                {saving ? <ActivityIndicator color="#FFFFFF" /> : <MapPin color="#FFFFFF" size={16} strokeWidth={3} />}
                <Text style={styles.mapActionTextDark}>{saving ? "Guardando..." : collectAddressDetails ? "Guardar direccion" : "Confirmar punto"}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function randomRequestId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    const next = char === "x" ? value : (value & 0x3) | 0x8;
    return next.toString(16);
  });
}

function orderErrorMessage(error: unknown) {
  const apiError = getMobileApiError(error);
  const message = apiError?.code ?? (error instanceof Error ? error.message : "order-create-failed");
  if (message === "api-base-url-required") return "Configura la URL de la web para enviar pedidos desde la app.";
  if (message === "api-network-failed") {
    const host = apiHost(apiError?.url ?? config.apiBaseUrl);
    return host
      ? `No pudimos conectar con ${host}. El APK instalado apunta a esa URL; si estas probando la web local, recompila con una URL accesible desde el celular.`
      : "No pudimos conectar con la API de pedidos. Revisa la URL configurada en la app.";
  }
  if (message === "api-timeout") return "La API de pedidos tardo demasiado en responder. Intenta nuevamente en unos segundos.";
  if (message === "delivery-address-required") return "Agrega una direccion para delivery.";
  if (message === "cash-only-for-now") return "Por ahora usa efectivo en la app movil.";
  if (message === "service-role-required") return "La API de pedidos necesita la llave privada configurada en la web.";
  if (message === "mobile-orders-api-not-deployed") return "La API movil de pedidos aun no esta desplegada en yopido.shop.";
  if (message === "invalid-restaurant") return "Este restaurante no esta disponible.";
  if (message === "invalid-json" || message === "invalid-order") return "La app y la web tienen versiones distintas. Actualiza el APK o despliega la web mas reciente.";
  if (message === "invalid-public-order-items") return "Hay productos que ya no estan disponibles.";
  if (message === "invalid-public-order-total") return "El total cambio. Vacia el carrito, vuelve a agregar los productos e intenta otra vez.";
  if (message === "product-configuration") return "Revisa las opciones del producto antes de enviar.";
  if (message === "outside-hours") return "El negocio esta fuera de horario. Puedes ver el menu, pero no enviar pedidos hasta que abra.";
  if (message === "no-open-cash") return "El restaurante necesita abrir caja para recibir pedidos.";
  if (message === "prepayment-required") return "Este pedido requiere pago QR y comprobante antes de enviarse.";
  if (message === "invalid-order-response") return "La web respondio sin datos de seguimiento. Actualiza la web desplegada y vuelve a intentar.";
  if (message === "order-create-failed") return "La web rechazo el pedido. Revisa el deploy de la API movil e intenta otra vez.";
  return `No se pudo enviar el pedido (${message}). Intenta nuevamente.`;
}

function formatHeroOpeningLabel(nextOpeningInputValue: string, currentInputValue: string) {
  const [nextDate, nextTime = ""] = nextOpeningInputValue.split("T");
  const [currentDate] = currentInputValue.split("T");
  if (!nextDate || !nextTime) return nextOpeningInputValue.replace("T", " ");

  const current = new Date(`${currentDate}T00:00:00`);
  const next = new Date(`${nextDate}T00:00:00`);
  const days = Math.round((next.getTime() - current.getTime()) / 86400000);
  const time = nextTime.slice(0, 5);
  if (days <= 0) return `hoy a las ${time}`;
  if (days === 1) return `mañana a las ${time}`;
  return `${nextDate.slice(5).replace("-", "/")} a las ${time}`;
}

function apiHost(value?: string) {
  if (!value) return "";

  try {
    return new URL(value).host;
  } catch {
    return value.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}

function RestaurantLogo({ restaurant, size }: { restaurant: RestaurantSummary; size: number }) {
  return (
    <View style={[styles.logoBox, { height: size, width: size, borderRadius: size * 0.28 }]}>
      <Image source={displayImageSource(restaurant.logoUrl)} style={styles.logoImage} />
    </View>
  );
}

function HeroActionButton({ accessibilityLabel, children, onPress }: { accessibilityLabel: string; children: ReactNode; onPress: () => void }) {
  return (
    <Pressable accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [styles.heroActionButton, pressed && styles.heroActionButtonPressed]}>
      {children}
    </Pressable>
  );
}

function HeroMetric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <View style={styles.heroMetric}>
      <View style={styles.heroMetricIcon}>{icon}</View>
      <View style={styles.heroMetricTextBlock}>
        <Text ellipsizeMode="tail" numberOfLines={1} style={styles.heroMetricValue}>{value}</Text>
        <Text ellipsizeMode="tail" numberOfLines={1} style={styles.heroMetricLabel}>{label}</Text>
      </View>
    </View>
  );
}

function RestaurantOptionsSheet({
  onClose,
  onInfo,
  onReport,
  onShare,
  onShowHours,
}: {
  onClose: () => void;
  onInfo: () => void;
  onReport: () => void;
  onShare: () => void;
  onShowHours: () => void;
}) {
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} visible>
      <View style={styles.optionsOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView edges={["bottom"]} style={styles.optionsSheet}>
          <View style={styles.mapPickerHandle} />
          <View style={styles.optionsHeader}>
            <View>
              <Text style={styles.cartSheetEyebrow}>Local</Text>
              <Text style={styles.optionsTitle}>Opciones</Text>
            </View>
            <IconButton light onPress={onClose}><X color={colors.blue} size={21} strokeWidth={3} /></IconButton>
          </View>
          <View style={styles.optionsList}>
            <RestaurantOptionRow icon={<Clock3 color={colors.blue} size={20} strokeWidth={3} />} onPress={onShowHours} text="Ver horarios de atencion" />
            <RestaurantOptionRow icon={<Info color={colors.blue} size={20} strokeWidth={3} />} onPress={onInfo} text="Informacion del local" />
            <RestaurantOptionRow icon={<Share2 color={colors.blue} size={20} strokeWidth={3} />} onPress={onShare} text="Compartir" />
            <RestaurantOptionRow icon={<MessageCircle color={colors.blue} size={20} strokeWidth={3} />} onPress={onReport} text="Reportar local" />
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function RestaurantOptionRow({ icon, onPress, text }: { icon: ReactNode; onPress: () => void; text: string }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.optionsRow, pressed && styles.pressedCard]}>
      <View style={styles.optionsRowIcon}>{icon}</View>
      <Text style={styles.optionsRowText}>{text}</Text>
      <ArrowRight color={colors.blue} size={18} strokeWidth={3} />
    </Pressable>
  );
}

function RestaurantInfoSheet({ onClose, onOpenMap, restaurant }: { onClose: () => void; onOpenMap: () => void; restaurant: RestaurantSummary }) {
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} visible>
      <View style={styles.optionsOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView edges={["bottom"]} style={styles.optionsSheet}>
          <View style={styles.mapPickerHandle} />
          <View style={styles.optionsHeader}>
            <View>
              <Text style={styles.cartSheetEyebrow}>Informacion</Text>
              <Text style={styles.optionsTitle}>{restaurant.name}</Text>
            </View>
            <IconButton light onPress={onClose}><X color={colors.blue} size={21} strokeWidth={3} /></IconButton>
          </View>
          <View style={styles.infoRows}>
            <View style={styles.infoRow}>
              <MapPin color={colors.blue} size={18} strokeWidth={3} />
              <View style={styles.recentOrderBody}>
                <Text style={styles.infoLabel}>Ubicacion</Text>
                <Text style={styles.infoValue}>{[restaurant.address, restaurant.city].filter(Boolean).join(", ") || "Ubicacion disponible en mapa"}</Text>
              </View>
            </View>
            <View style={styles.infoRow}>
              <Store color={colors.blue} size={18} strokeWidth={3} />
              <View style={styles.recentOrderBody}>
                <Text style={styles.infoLabel}>Categoria</Text>
                <Text style={styles.infoValue}>{restaurant.description || "Local en Yopido"}</Text>
              </View>
            </View>
          </View>
          <Pressable onPress={onOpenMap} style={({ pressed }) => [styles.infoMapButton, pressed && styles.pressedCard]}>
            <MapPinned color={colors.blue} size={19} strokeWidth={3} />
            <Text style={styles.infoMapButtonText}>Ver ubicacion en mapa</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function BusinessChip({ active, businessType, count, onPress }: { active: boolean; businessType: BusinessType; count: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.businessChip, active && styles.businessChipActive]}>
      <View style={[styles.businessIcon, { backgroundColor: active ? "#FFFFFFAA" : businessType.soft }]}>
        <BusinessIcon businessType={businessType} color={businessType.accent} />
      </View>
      <View>
        <Text style={styles.businessText}>{businessType.label}</Text>
        <Text style={styles.businessCount}>{count} locales</Text>
      </View>
    </Pressable>
  );
}

function BusinessIcon({ businessType, color }: { businessType: BusinessType; color: string }) {
  if (businessType.icon === "food") return <Utensils color={color} size={26} strokeWidth={2.6} />;
  if (businessType.icon === "fashion") return <Shirt color={color} size={26} strokeWidth={2.6} />;
  if (businessType.icon === "sparkles") return <Sparkles color={color} size={25} strokeWidth={2.6} />;
  return <Store color={color} size={25} strokeWidth={2.6} />;
}

function CategoryChip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.categoryChip, active && styles.categoryChipActive]}>
      <Text style={[styles.categoryText, active && styles.categoryTextActive]}>{label}</Text>
    </Pressable>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <View>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.title}>{title}</Text>
    </View>
  );
}

function Metric({ icon, text }: { icon: ReactNode; text: string }) {
  return <View style={styles.metricPill}>{icon}<Text style={styles.metricText}>{text}</Text></View>;
}

function MiniPill({ icon, text, onPress }: { icon: ReactNode; text: string; onPress?: () => void }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.miniPill, pressed && onPress && styles.pressedCard]}>{icon}<Text style={styles.miniPillText}>{text}</Text></Pressable>;
}

function SegmentButton({ active, icon, text, onPress }: { active: boolean; icon: ReactNode; text: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.segmentButton, active && styles.segmentButtonActive]}>
      {icon}
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{text}</Text>
    </Pressable>
  );
}

function UploadPicker({
  description,
  file,
  label,
  onClear,
  onPick,
}: {
  description: string;
  file: MobileUploadFile | null;
  label: string;
  onClear: () => void;
  onPick: () => void;
}) {
  return (
    <View style={styles.uploadPicker}>
      <Pressable onPress={onPick} style={({ pressed }) => [styles.uploadPickerButton, pressed && styles.pressedCard]}>
        <View style={styles.uploadIconBox}>
          {file ? <Image source={{ uri: file.uri }} style={styles.uploadThumb} /> : <Plus color={colors.blue} size={22} strokeWidth={3.2} />}
        </View>
        <View style={styles.uploadPickerBody}>
          <Text numberOfLines={1} style={styles.uploadPickerLabel}>{file ? file.name : label}</Text>
          <Text numberOfLines={2} style={styles.uploadPickerText}>{file ? "Listo para subir" : description}</Text>
        </View>
        <ArrowRight color={colors.blue} size={20} strokeWidth={3} />
      </Pressable>
      {file ? (
        <Pressable onPress={onClear} style={styles.uploadClearButton}>
          <X color={colors.danger} size={14} strokeWidth={3} />
          <Text style={styles.uploadClearText}>Quitar archivo</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function InputBox({
  value,
  placeholder,
  onChangeText,
  multiline = false,
  keyboardType,
  secureTextEntry = false,
  autoCapitalize = "sentences",
}: {
  value: string;
  placeholder: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  keyboardType?: "phone-pad" | "email-address" | "number-pad";
  secureTextEntry?: boolean;
  autoCapitalize?: "none" | "sentences";
}) {
  return (
    <TextInput
      autoCapitalize={autoCapitalize}
      keyboardType={keyboardType}
      multiline={multiline}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="#8A98AB"
      secureTextEntry={secureTextEntry}
      style={[styles.inputBox, multiline && styles.inputMultiline]}
      value={value}
    />
  );
}

function TotalLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.totalLine}>
      <Text style={[styles.totalLabel, strong && styles.totalStrong]}>{label}</Text>
      <Text style={[styles.totalValue, strong && styles.totalStrong]}>{value}</Text>
    </View>
  );
}

function PrimaryButton({ text, onPress, loading = false, disabled = false, icon }: { text: string; onPress?: () => void; loading?: boolean; disabled?: boolean; icon?: ReactNode }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.primaryButton, disabled && styles.primaryButtonDisabled, pressed && !disabled && styles.pressedCard]}>
      {loading ? <ActivityIndicator color={colors.blue} /> : icon}
      <Text style={styles.primaryButtonText}>{text}</Text>
    </Pressable>
  );
}

function YopidoLoader({ text }: { text: string }) {
  return (
    <SafeAreaView style={styles.loading}>
      <Image resizeMode="contain" source={logoDark} style={styles.loaderLogo} />
      <Text style={styles.loadingText}>{text}</Text>
    </SafeAreaView>
  );
}

function AuthLoadingOverlay({ text }: { text: string }) {
  return (
    <Modal transparent animationType="fade" visible>
      <View style={styles.authLoadingOverlay}>
        <View style={styles.authLoadingCard}>
          <Image resizeMode="contain" source={logoDark} style={styles.authLoadingLogo} />
          <Text style={styles.authLoadingTitle}>{text}</Text>
          <Text style={styles.authLoadingText}>Validando acceso seguro.</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  addButton: { alignItems: "center", backgroundColor: colors.green, borderRadius: 999, elevation: 3, height: 46, justifyContent: "center", shadowColor: colors.green, shadowOpacity: 0.24, shadowRadius: 10, width: 46 },
  addButtonDisabled: { backgroundColor: "#D8E4E9", shadowOpacity: 0 },
  accountAddButton: { alignItems: "center", backgroundColor: colors.green, borderRadius: 999, elevation: 4, flexShrink: 0, height: 44, justifyContent: "center", shadowColor: colors.green, shadowOpacity: 0.25, shadowRadius: 10, width: 44 },
  accountAddButtonDisabled: { opacity: 0.45 },
  accountAvatar: { alignItems: "center", backgroundColor: colors.green, borderRadius: 999, height: 48, justifyContent: "center", width: 48 },
  accountAvatarText: { color: colors.blue, fontSize: 20, fontWeight: "900" },
  accountCard: { backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 22, borderWidth: 1, gap: 10, padding: 14, shadowColor: colors.blue, shadowOpacity: 0.08, shadowRadius: 12 },
  accountEditButton: { alignItems: "center", backgroundColor: colors.softBlue, borderColor: colors.border, borderRadius: 999, borderWidth: 1, flexDirection: "row", flexShrink: 0, gap: 7, minHeight: 42, paddingHorizontal: 13 },
  accountEditText: { color: colors.blue, fontSize: 13, fontWeight: "900" },
  accountEmail: { color: colors.muted, fontSize: 12, fontWeight: "800", marginTop: 2 },
  accountFilterChip: { alignItems: "center", backgroundColor: colors.background, borderColor: colors.border, borderRadius: 999, borderWidth: 1, flex: 1, justifyContent: "center", minHeight: 42, paddingHorizontal: 12 },
  accountFilterChipActive: { backgroundColor: colors.green, borderColor: colors.green },
  accountFilterRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  accountFilterText: { color: colors.muted, fontSize: 12, fontWeight: "900" },
  accountFilterTextActive: { color: colors.blue },
  accountGreeting: { color: "#FFFFFF", fontSize: 27, fontWeight: "900", lineHeight: 31, marginTop: 10 },
  accountHint: { color: colors.muted, fontSize: 13, fontWeight: "800", lineHeight: 19 },
  accountHero: { backgroundColor: colors.blue, borderBottomLeftRadius: 30, borderBottomRightRadius: 30, gap: 2, marginHorizontal: -14, padding: 18, paddingBottom: 24 },
  accountHeroCopy: { color: "#FFFFFFD1", fontSize: 14, fontWeight: "800", lineHeight: 20, marginTop: 6 },
  accountHeroEyebrow: { color: colors.green, fontSize: 12, fontWeight: "900", letterSpacing: 2.6, marginTop: 18, textTransform: "uppercase" },
  accountHeroIcon: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.14)", borderColor: "rgba(255,255,255,0.18)", borderRadius: 999, borderWidth: 1, height: 48, justifyContent: "center", width: 48 },
  accountHeroLogo: { height: 36, width: 160 },
  accountHeroTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  accountIdentityRow: { alignItems: "center", flexDirection: "row", gap: 12, marginBottom: 2 },
  accountLogoutButton: { alignItems: "center", alignSelf: "center", backgroundColor: "#FFF1F3", borderColor: "#FEE4E2", borderRadius: 999, borderWidth: 1, flexDirection: "row", gap: 7, justifyContent: "center", minHeight: 46, paddingHorizontal: 18 },
  accountMenuMeta: { color: colors.muted, fontSize: 12, fontWeight: "800", marginTop: 2 },
  accountMenuRow: { alignItems: "center", backgroundColor: colors.background, borderColor: colors.border, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 11, minHeight: 66, padding: 11 },
  accountMenuTitle: { color: colors.ink, fontSize: 15, fontWeight: "900" },
  accountName: { color: colors.ink, fontSize: 18, fontWeight: "900" },
  accountOrderRow: { alignItems: "center", backgroundColor: colors.background, borderColor: colors.border, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 10, padding: 11 },
  accountOrderMode: { color: colors.muted, fontSize: 10, fontWeight: "800" },
  accountOrderStatus: { backgroundColor: "#F3FFE0", borderColor: colors.green, borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  accountOrderStatusCancelled: { backgroundColor: "#FFF1F3", borderColor: "#FECDD3" },
  accountOrderStatusText: { color: colors.blue, fontSize: 10, fontWeight: "900" },
  accountOrderStatusTextCancelled: { color: colors.danger },
  accountOrderTrailing: { alignItems: "flex-end", gap: 3, maxWidth: 112 },
  accountPage: { backgroundColor: colors.blue, flex: 1 },
  accountPageContent: { backgroundColor: colors.background, minHeight: "100%" },
  accountProfileMissing: { color: colors.danger, fontSize: 12, fontWeight: "800", lineHeight: 18 },
  accountProfileSummary: { color: colors.muted, fontSize: 12, fontWeight: "800", lineHeight: 18 },
  accountRowIcon: { alignItems: "center", backgroundColor: colors.softBlue, borderRadius: 16, height: 42, justifyContent: "center", width: 42 },
  accountSectionActionRow: { alignItems: "flex-start", flexDirection: "row", gap: 10, justifyContent: "space-between", overflow: "hidden" },
  accountSmallAction: { alignItems: "center", backgroundColor: colors.green, borderRadius: 999, flexDirection: "row", gap: 5, minHeight: 38, paddingHorizontal: 12 },
  accountSmallActionText: { color: colors.blue, fontSize: 12, fontWeight: "900" },
  accountSubHeader: { alignItems: "center", flex: 1, flexDirection: "row", gap: 12, minWidth: 0 },
  addressRow: { alignItems: "center", backgroundColor: colors.background, borderColor: colors.border, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 10, padding: 11 },
  addressDetail: { color: colors.blue, fontSize: 11, fontWeight: "900", marginTop: 3 },
  addressFieldLabel: { color: colors.blue, fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  addressForm: { gap: 12, paddingTop: 8 },
  addressFormColumn: { flex: 1, minWidth: 0 },
  addressFormRow: { flexDirection: "row", gap: 10 },
  addressReference: { color: colors.muted, fontSize: 11, fontWeight: "700", lineHeight: 16, marginTop: 3 },
  authLoadingCard: { alignItems: "center", backgroundColor: colors.blue, borderColor: "rgba(255,255,255,0.14)", borderRadius: 24, borderWidth: 1, gap: 7, paddingHorizontal: 22, paddingVertical: 20, width: "82%" },
  authLoadingLogo: { height: 44, width: 190 },
  authLoadingOverlay: { alignItems: "center", backgroundColor: "rgba(8,36,65,0.62)", flex: 1, justifyContent: "center" },
  authLoadingText: { color: "#FFFFFFC7", fontSize: 13, fontWeight: "800" },
  authLoadingTitle: { color: "#FFFFFF", fontSize: 15, fontWeight: "900", textAlign: "center" },
  authDivider: { alignItems: "center", flexDirection: "row", gap: 10, paddingVertical: 2 },
  authDividerLine: { backgroundColor: colors.border, flex: 1, height: 1 },
  authDividerText: { color: colors.muted, fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  backStepButton: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 5, paddingHorizontal: 4, paddingVertical: 8 },
  backStepText: { color: colors.blue, fontSize: 13, fontWeight: "900" },
  banner: { backgroundColor: colors.blue, borderRadius: 25, height: 258, marginHorizontal: 14, marginTop: 14, overflow: "hidden", shadowColor: colors.blue, shadowOpacity: 0.16, shadowRadius: 14 },
  bannerImage: { borderRadius: 25 },
  bannerMetrics: { alignItems: "center", borderTopColor: "rgba(255,255,255,0.18)", borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 12, paddingTop: 10 },
  bannerOverlay: { borderRadius: 25, flex: 1, justifyContent: "space-between", padding: 12, paddingBottom: 13 },
  bannerActionGroup: { alignItems: "center", flexDirection: "row", gap: 8 },
  bannerTopActions: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  bodyTop: { backgroundColor: colors.background, paddingBottom: 2, paddingHorizontal: 14, paddingTop: 22 },
  bottomNav: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 999, borderWidth: 1, bottom: 14, elevation: 10, flexDirection: "row", gap: 4, justifyContent: "center", left: 14, padding: 5, position: "absolute", right: 14, shadowColor: colors.blue, shadowOpacity: 0.16, shadowRadius: 16 },
  bottomNavActiveGlass: { borderRadius: 999, bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  bottomNavGlass: { alignItems: "center", borderColor: "rgba(255,255,255,0.52)", borderRadius: 999, borderWidth: 1, flexDirection: "row", gap: 5, height: 68, justifyContent: "center", overflow: "hidden", padding: 6, shadowColor: colors.blue, shadowOffset: { height: 12, width: 0 }, shadowOpacity: 0.18, shadowRadius: 24 },
  bottomNavGlassContainer: { bottom: 22, height: 68, left: 18, position: "absolute", right: 18 },
  bottomNavIosFallback: { backgroundColor: "rgba(255,255,255,0.86)", borderColor: "rgba(255,255,255,0.72)", bottom: 22, left: 18, padding: 6, right: 18, shadowOffset: { height: 12, width: 0 }, shadowOpacity: 0.18, shadowRadius: 24 },
  bottomNavItem: { alignItems: "center", borderRadius: 999, flex: 1, gap: 2, justifyContent: "center", minHeight: 48, minWidth: 0, overflow: "hidden" },
  bottomNavItemActive: { backgroundColor: colors.green },
  bottomNavItemActiveGlass: { backgroundColor: "transparent" },
  bottomNavItemIos: { minHeight: 56 },
  bottomNavItemPressed: { transform: [{ scale: 0.97 }] },
  bottomNavText: { color: colors.muted, fontSize: 9, fontWeight: "900" },
  bottomNavTextIos: { color: "#31516F", fontSize: 10 },
  bottomNavTextActive: { color: colors.blue },
  brandLogo: { flexShrink: 1, height: 36, marginLeft: 3, width: 160 },
  brandRow: { alignItems: "center", flexDirection: "row", gap: 10, justifyContent: "space-between", paddingHorizontal: 14 },
  businessChip: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 17, borderWidth: 1, elevation: 2, flexDirection: "row", gap: 9, minHeight: 52, paddingHorizontal: 12, shadowColor: "#12355B", shadowOpacity: 0.08, shadowRadius: 8 },
  businessChipActive: { backgroundColor: "#F2FFD6", borderColor: colors.green },
  businessCount: { color: colors.muted, fontSize: 11, fontWeight: "800", marginTop: 1 },
  businessIcon: { alignItems: "center", borderRadius: 14, height: 38, justifyContent: "center", width: 38 },
  businessRail: { gap: 10, paddingRight: 16, paddingVertical: 8 },
  businessStatusPill: { alignItems: "center", alignSelf: "flex-start", borderRadius: 999, flexDirection: "row", gap: 6, marginBottom: 8, maxWidth: "100%", paddingHorizontal: 10, paddingVertical: 6 },
  businessStatusPillClosed: { backgroundColor: "#FFF1F3", borderColor: "#FECDD3", borderWidth: 1 },
  businessStatusPillOpen: { backgroundColor: "#F2FFD6", borderColor: colors.green, borderWidth: 1 },
  businessStatusText: { color: colors.blue, flexShrink: 1, fontSize: 12, fontWeight: "900" },
  businessStatusTextClosed: { color: colors.danger },
  businessText: { color: colors.ink, fontSize: 13, fontWeight: "900", maxWidth: 138 },
  cancelledBox: { backgroundColor: "#FEE4E2", borderRadius: 16, marginTop: 16, padding: 12 },
  cancelledText: { color: colors.danger, fontSize: 14, fontWeight: "900", textAlign: "center" },
  cartAction: { alignItems: "center", backgroundColor: colors.green, borderRadius: 999, flexDirection: "row", gap: 7, minHeight: 44, paddingHorizontal: 15 },
  cartActionText: { color: colors.blue, fontSize: 15, fontWeight: "900" },
  cartBadge: { backgroundColor: colors.green, borderRadius: 999, color: colors.blue, fontSize: 10, fontWeight: "900", height: 17, lineHeight: 17, minWidth: 17, overflow: "hidden", position: "absolute", right: -4, textAlign: "center", top: -5 },
  cartBar: { alignItems: "center", backgroundColor: colors.blue, borderColor: colors.green, borderRadius: 19, borderWidth: 1, bottom: 12, elevation: 10, flexDirection: "row", gap: 10, left: 14, minHeight: 62, paddingHorizontal: 9, paddingVertical: 8, position: "absolute", right: 14, shadowColor: colors.blue, shadowOpacity: 0.24, shadowRadius: 14 },
  cartCircle: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 999, borderWidth: 1, height: 44, justifyContent: "center", shadowColor: "#12355B", shadowOpacity: 0.12, shadowRadius: 9, width: 44 },
  cartIcon: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 999, height: 44, justifyContent: "center", width: 44 },
  cartInfo: { flex: 1 },
  cartLabel: { color: "#FFFFFFC7", fontSize: 12, fontWeight: "800", marginTop: 1 },
  cartLine: { alignItems: "center", borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: "row", gap: 12, paddingVertical: 12 },
  cartLineBody: { flex: 1, minWidth: 0 },
  cartLineName: { color: colors.ink, fontSize: 15, fontWeight: "900" },
  cartLineNotes: { color: colors.blue, fontSize: 12, fontWeight: "800", marginTop: 2 },
  cartLinePrice: { color: colors.muted, fontSize: 13, fontWeight: "800", marginTop: 2 },
  cartScroll: { flexGrow: 0 },
  cartSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, bottom: 0, left: 0, maxHeight: "94%", padding: 18, position: "absolute", right: 0 },
  cartSheetCount: { color: colors.muted, fontSize: 13, fontWeight: "900", marginTop: 1 },
  cartSheetEyebrow: { color: colors.muted, fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
  cartSheetHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  cartSheetTitle: { color: colors.ink, fontSize: 28, fontWeight: "900" },
  cartTotal: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  categoryChip: { backgroundColor: colors.softBlue, borderColor: "transparent", borderRadius: 999, borderWidth: 1, minHeight: 46, paddingHorizontal: 20, paddingVertical: 11 },
  categoryChipActive: { backgroundColor: colors.green, borderColor: colors.green },
  categoryRail: { gap: 12, paddingHorizontal: 14, paddingVertical: 14 },
  categorySection: { backgroundColor: "#FFFFFF", borderBottomColor: colors.border, borderBottomWidth: 1, borderTopColor: colors.border, borderTopWidth: 1, elevation: 2, marginTop: 12, shadowColor: colors.blue, shadowOpacity: 0.07, shadowRadius: 8 },
  categoryText: { color: colors.muted, fontSize: 14, fontWeight: "900" },
  categoryTextActive: { color: colors.blue },
  centerContent: { gap: 16, padding: 18 },
  choiceBody: { flex: 1, minWidth: 0 },
  choiceCard: { alignItems: "flex-start", backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 19, borderWidth: 1, flexDirection: "row", gap: 12, minHeight: 84, padding: 14 },
  choiceCardActive: { backgroundColor: colors.softBlue, borderColor: colors.blue },
  choiceGrid: { gap: 10 },
  choiceIcon: { alignItems: "center", backgroundColor: colors.softBlue, borderRadius: 999, height: 38, justifyContent: "center", width: 38 },
  choiceIconActive: { backgroundColor: colors.blue },
  choiceLabel: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  choiceText: { color: colors.muted, fontSize: 12, fontWeight: "800", lineHeight: 18, marginTop: 3 },
  contentWithCart: { gap: 12, paddingBottom: 120 },
  configBlock: { gap: 9, marginBottom: 16 },
  configCheck: { alignItems: "center", backgroundColor: colors.softBlue, borderColor: colors.border, borderRadius: 999, borderWidth: 1, height: 26, justifyContent: "center", width: 26 },
  configCheckActive: { backgroundColor: colors.blue, borderColor: colors.blue },
  configDescription: { color: colors.muted, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  configError: { color: colors.danger, fontSize: 13, fontWeight: "900", textAlign: "center" },
  configHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  configHint: { color: colors.muted, fontSize: 11, fontWeight: "900" },
  configGroupCard: { borderColor: colors.border, borderRadius: 20, borderWidth: 1, gap: 9, marginBottom: 16, padding: 12 },
  configOption: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 17, borderWidth: 1, flexDirection: "row", gap: 10, minHeight: 64, paddingHorizontal: 14, paddingVertical: 10 },
  configOptionActive: { backgroundColor: colors.softBlue, borderColor: colors.blue },
  configOptionDescription: { color: colors.muted, fontSize: 13, fontWeight: "700", lineHeight: 18, marginTop: 2 },
  configOptionName: { color: colors.blue, fontSize: 16, fontWeight: "900" },
  configOptionPrice: { color: colors.blue, fontSize: 14, fontWeight: "900" },
  configOptionText: { flex: 1, minWidth: 0 },
  configScroll: { flexGrow: 0 },
  configScrollContent: { paddingBottom: 24 },
  configTitle: { color: colors.ink, fontSize: 16, fontWeight: "900" },
  deliveryMapCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 20, borderWidth: 1, gap: 10, marginTop: 10, padding: 10 },
  deliveryMapCanvas: { backgroundColor: colors.softBlue, borderRadius: 17, height: 132, overflow: "hidden" },
  distancePill: { alignItems: "center", alignSelf: "flex-start", backgroundColor: "rgba(18,53,91,0.74)", borderRadius: 999, flexDirection: "row", gap: 5, marginBottom: 8, paddingHorizontal: 11, paddingVertical: 7 },
  distanceText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  dot: { backgroundColor: colors.green, borderRadius: 999, height: 5, width: 5 },
  emptyCartBox: { alignItems: "center", gap: 8, paddingBottom: 6, paddingTop: 14 },
  error: { color: colors.danger, fontSize: 13, fontWeight: "800", marginVertical: 8 },
  errorLogo: { height: 70, marginBottom: 10, width: 220 },
  eyebrow: { color: colors.green, fontSize: 12, fontWeight: "900", letterSpacing: 3, textTransform: "uppercase" },
  featuredBottom: { alignItems: "center", flexDirection: "row", gap: 12 },
  featuredCard: { height: 178, marginRight: 12, width: 292 },
  featuredCopy: { flex: 1, minWidth: 0 },
  featuredImage: { flex: 1 },
  featuredImageRadius: { borderRadius: 24 },
  featuredOverlay: { borderRadius: 24, flex: 1, justifyContent: "space-between", padding: 14 },
  featuredRail: { gap: 0, paddingLeft: 14, paddingRight: 14, paddingTop: 16 },
  featuredSubtitle: { color: "#FFFFFFD9", fontSize: 13, fontWeight: "800", marginTop: 2 },
  featuredTitle: { color: "#FFFFFF", fontSize: 23, fontWeight: "900" },
  featuredTopRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  favoriteButton: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 999, borderWidth: 1, height: 40, justifyContent: "center", shadowColor: colors.blue, shadowOpacity: 0.08, shadowRadius: 8, width: 40 },
  favoriteButtonActive: { backgroundColor: "#FFF1F3", borderColor: "#FECDD3" },
  favoriteButtonCompact: { height: 32, width: 32 },
  favoriteImage: { backgroundColor: colors.softBlue, borderRadius: 15, height: 58, width: 58 },
  favoriteKind: { color: colors.blue, fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  favoriteRow: { alignItems: "center", backgroundColor: colors.background, borderColor: colors.border, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 10, minHeight: 80, padding: 10 },
  favoriteRowBody: { flex: 1, minWidth: 0 },
  favoriteSubtitle: { color: colors.muted, fontSize: 12, fontWeight: "800", marginTop: 2 },
  favoriteTitle: { color: colors.ink, fontSize: 15, fontWeight: "900", marginTop: 1 },
  fulfillmentSwitch: { backgroundColor: colors.softBlue, borderRadius: 18, flexDirection: "row", gap: 5, padding: 5 },
  fulfillmentSwitchButton: { alignItems: "center", borderRadius: 999, flex: 1, justifyContent: "center", minHeight: 44 },
  fulfillmentSwitchButtonActive: { backgroundColor: colors.blue },
  fulfillmentSwitchText: { color: colors.muted, fontSize: 13, fontWeight: "900" },
  fulfillmentSwitchTextActive: { color: "#FFFFFF" },
  groupDangerButton: { alignItems: "center", alignSelf: "center", backgroundColor: "#FFF1F3", borderColor: "#FECDD3", borderRadius: 999, borderWidth: 1, minHeight: 44, paddingHorizontal: 16, justifyContent: "center" },
  groupDangerText: { color: colors.danger, fontSize: 13, fontWeight: "900" },
  groupEntryBody: { flex: 1, minWidth: 0 },
  groupEntryCard: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 22, borderWidth: 1, elevation: 2, flexDirection: "row", gap: 12, marginHorizontal: 14, marginTop: 14, padding: 13, shadowColor: colors.blue, shadowOpacity: 0.08, shadowRadius: 12 },
  groupEntryIcon: { alignItems: "center", backgroundColor: colors.green, borderRadius: 18, height: 48, justifyContent: "center", width: 48 },
  groupEntryText: { color: colors.muted, fontSize: 12, fontWeight: "800", lineHeight: 17, marginTop: 2 },
  groupEntryTitle: { color: colors.ink, fontSize: 17, fontWeight: "900" },
  groupHero: { backgroundColor: colors.blue, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, gap: 8, padding: 16, paddingBottom: 22 },
  groupHostActions: { gap: 9, marginTop: 12 },
  groupInviteCard: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 22, borderWidth: 1, gap: 12, marginHorizontal: 14, marginTop: 14, padding: 14, shadowColor: colors.blue, shadowOpacity: 0.07, shadowRadius: 12 },
  groupInviteHeader: { alignItems: "center", alignSelf: "stretch", flexDirection: "row", gap: 11 },
  groupInviteIcon: { alignItems: "center", backgroundColor: colors.softBlue, borderRadius: 16, height: 44, justifyContent: "center", width: 44 },
  groupInviteQr: { backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 18, borderWidth: 1, height: 190, width: 190 },
  groupItemBody: { flex: 1, minWidth: 0 },
  groupItemRow: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 10, marginTop: 8, padding: 11 },
  groupItemsFooter: { gap: 8, paddingHorizontal: 14, paddingTop: 4 },
  groupMiniActions: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 10 },
  groupMiniButton: { backgroundColor: colors.softBlue, borderColor: colors.border, borderRadius: 999, borderWidth: 1, minHeight: 34, paddingHorizontal: 10, justifyContent: "center" },
  groupMiniDanger: { backgroundColor: "#FFF1F3", borderColor: "#FECDD3" },
  groupMiniDangerText: { color: colors.danger },
  groupMiniText: { color: colors.blue, fontSize: 11, fontWeight: "900" },
  groupModeGrid: { gap: 10 },
  groupPanel: { backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 22, borderWidth: 1, gap: 10, marginHorizontal: 14, marginTop: 14, padding: 14, shadowColor: colors.blue, shadowOpacity: 0.07, shadowRadius: 12 },
  groupParticipantCard: { backgroundColor: colors.background, borderColor: colors.border, borderRadius: 18, borderWidth: 1, padding: 11 },
  groupParticipantTop: { alignItems: "flex-start", flexDirection: "row", gap: 10, justifyContent: "space-between" },
  groupParticipantsList: { gap: 9 },
  groupReceiptButton: { alignItems: "center", alignSelf: "flex-start", backgroundColor: colors.green, borderRadius: 999, flexDirection: "row", gap: 6, marginTop: 9, minHeight: 36, paddingHorizontal: 11 },
  groupReceiptText: { color: colors.blue, fontSize: 12, fontWeight: "900" },
  groupScanHeroButton: { alignItems: "center", alignSelf: "center", backgroundColor: colors.green, borderRadius: 999, flexDirection: "row", gap: 7, marginTop: 12, minHeight: 42, paddingHorizontal: 14 },
  groupScanHeroText: { color: colors.blue, fontSize: 13, fontWeight: "900" },
  groupScanInlineButton: { alignItems: "center", alignSelf: "stretch", backgroundColor: colors.softBlue, borderColor: colors.border, borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 46 },
  groupScanInlineText: { color: colors.blue, fontSize: 13, fontWeight: "900" },
  groupShareButton: { alignItems: "center", alignSelf: "stretch", backgroundColor: colors.green, borderRadius: 999, flexDirection: "row", gap: 7, justifyContent: "center", minHeight: 42 },
  groupShareButtonText: { color: colors.blue, fontSize: 13, fontWeight: "900" },
  groupStartForm: { gap: 12, marginTop: 14 },
  groupStartSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, bottom: 0, gap: 8, left: 0, padding: 18, position: "absolute", right: 0 },
  groupStatusPill: { alignSelf: "flex-start", backgroundColor: "#FFFFFF", borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  groupStatusRow: { alignItems: "center", flexDirection: "row", gap: 10, marginTop: 4 },
  groupStatusText: { color: colors.blue, fontSize: 12, fontWeight: "900" },
  groupSubmittedCard: { alignItems: "center", backgroundColor: "#F3FFE0", borderColor: colors.green, borderRadius: 22, borderWidth: 1, gap: 8, marginHorizontal: 14, marginTop: 14, padding: 16 },
  groupSubmittedText: { color: colors.blue, fontSize: 13, fontWeight: "800", lineHeight: 19, textAlign: "center" },
  groupSubmittedTitle: { color: colors.ink, fontSize: 19, fontWeight: "900" },
  groupTotal: { color: colors.blue, fontSize: 16, fontWeight: "900" },
  googleAuthBadge: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 999, borderWidth: 1, height: 30, justifyContent: "center", width: 30 },
  googleAuthBadgeText: { color: "#4285F4", fontSize: 16, fontWeight: "900" },
  googleAuthButton: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 10, justifyContent: "center", minHeight: 50, paddingHorizontal: 14 },
  googleAuthText: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  headerSpacer: { flex: 1 },
  heroActionButton: { alignItems: "center", backgroundColor: "rgba(8,36,65,0.58)", borderColor: "rgba(255,255,255,0.22)", borderRadius: 999, borderWidth: 1, height: 44, justifyContent: "center", width: 44 },
  heroActionButtonPressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
  heroInfoBlock: { gap: 0 },
  heroLocationPill: { alignItems: "center", alignSelf: "flex-start", backgroundColor: "rgba(8,36,65,0.58)", borderColor: "rgba(255,255,255,0.14)", borderRadius: 999, borderWidth: 1, flexDirection: "row", gap: 6, maxWidth: "62%", minHeight: 30, paddingHorizontal: 10 },
  heroLocationText: { color: "#FFFFFF", flexShrink: 1, fontSize: 12, fontWeight: "900" },
  heroMetric: { alignItems: "center", flex: 1, flexDirection: "row", gap: 6, minWidth: 0 },
  heroMetricDivider: { backgroundColor: "rgba(255,255,255,0.23)", height: 36, marginHorizontal: 6, width: 1 },
  heroMetricIcon: { alignItems: "center", height: 24, justifyContent: "center", width: 24 },
  heroMetricLabel: { color: "rgba(255,255,255,0.72)", fontSize: 10, fontWeight: "700", marginTop: 1 },
  heroMetricTextBlock: { flex: 1, minWidth: 0 },
  heroMetricValue: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  heroPillPressed: { opacity: 0.8 },
  heroPillRow: { alignItems: "flex-start", gap: 6, marginBottom: 8 },
  heroStatusDot: { backgroundColor: colors.green, borderRadius: 999, height: 8, width: 8 },
  heroStatusDotClosed: { backgroundColor: colors.danger },
  heroStatusPill: { alignItems: "center", alignSelf: "flex-start", backgroundColor: "rgba(8,36,65,0.72)", borderColor: "rgba(255,255,255,0.16)", borderRadius: 999, borderWidth: 1, flexDirection: "row", gap: 7, maxWidth: "88%", minHeight: 32, paddingHorizontal: 11 },
  heroStatusText: { color: "#FFFFFF", flexShrink: 1, fontSize: 12, fontWeight: "900" },
  hoursCard: { backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 24, borderWidth: 1, gap: 12, marginHorizontal: 18, padding: 14, shadowColor: colors.blue, shadowOpacity: 0.18, shadowRadius: 20 },
  hoursDay: { color: colors.blue, fontSize: 13, fontWeight: "900", width: 42 },
  hoursHeader: { alignItems: "center", flexDirection: "row", gap: 10 },
  hoursIcon: { alignItems: "center", backgroundColor: colors.softBlue, borderRadius: 16, height: 44, justifyContent: "center", width: 44 },
  hoursOverlay: { backgroundColor: "rgba(8,36,65,0.54)", flex: 1, justifyContent: "center" },
  hoursRow: { alignItems: "center", backgroundColor: colors.background, borderColor: colors.border, borderRadius: 14, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", minHeight: 44, paddingHorizontal: 12 },
  hoursRows: { gap: 7 },
  hoursStatusBox: { backgroundColor: "#F2FFD6", borderColor: colors.green, borderRadius: 16, borderWidth: 1, padding: 12 },
  hoursStatusText: { color: colors.blue, fontSize: 13, fontWeight: "900", lineHeight: 18 },
  hoursTitle: { color: colors.ink, fontSize: 18, fontWeight: "900" },
  hoursValue: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  hoursValueClosed: { color: colors.muted },
  headerLocationBody: { flex: 1, minWidth: 0 },
  headerLocationButton: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.11)", borderColor: "rgba(255,255,255,0.2)", borderRadius: 999, borderWidth: 1, flexDirection: "row", flexShrink: 1, gap: 6, maxWidth: 150, minHeight: 43, minWidth: 120, paddingLeft: 5, paddingRight: 9 },
  headerLocationIcon: { alignItems: "center", backgroundColor: colors.green, borderRadius: 999, height: 32, justifyContent: "center", width: 32 },
  headerLocationLabel: { color: "#FFFFFFA8", fontSize: 8, fontWeight: "900", textTransform: "uppercase" },
  headerLocationTitle: { color: "#FFFFFF", fontSize: 12, fontWeight: "900", marginTop: 0 },
  heroDot: { backgroundColor: "rgba(255,255,255,0.28)", borderRadius: 999, height: 7, width: 7 },
  heroDotActive: { backgroundColor: colors.green, borderRadius: 999, height: 7, width: 24 },
  heroDots: { alignItems: "center", flexDirection: "row", gap: 7, justifyContent: "center", marginTop: 10 },
  heroLoading: { height: 128, justifyContent: "center" },
  homeFooter: { backgroundColor: colors.background, gap: 18, paddingBottom: 30, paddingTop: 22 },
  homeContent: { backgroundColor: colors.background, paddingBottom: 104 },
  homeHero: { backgroundColor: colors.blue, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingBottom: 14, paddingHorizontal: 0, paddingTop: 10 },
  infoLabel: { color: colors.muted, fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  infoMapButton: { alignItems: "center", backgroundColor: colors.green, borderRadius: 16, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 8, minHeight: 52, paddingHorizontal: 14 },
  infoMapButtonText: { color: colors.blue, fontSize: 15, fontWeight: "900" },
  infoRow: { alignItems: "flex-start", backgroundColor: colors.background, borderColor: colors.border, borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 10, padding: 12 },
  infoRows: { gap: 8 },
  infoValue: { color: colors.ink, fontSize: 14, fontWeight: "800", lineHeight: 19, marginTop: 2 },
  inputBox: { backgroundColor: colors.background, borderColor: colors.border, borderRadius: 16, borderWidth: 1, color: colors.ink, fontSize: 15, fontWeight: "800", marginTop: 10, minHeight: 52, paddingHorizontal: 14 },
  inputMultiline: { minHeight: 78, paddingTop: 14, textAlignVertical: "top" },
  loaderIcon: { height: 82, marginBottom: 8, width: 82 },
  loading: { alignItems: "center", backgroundColor: colors.blue, flex: 1, justifyContent: "center" },
  loadingText: { color: "#FFFFFF", fontSize: 16, fontWeight: "900", marginTop: 12 },
  loaderLogo: { height: 58, marginBottom: 8, width: 220 },
  localButton: { alignItems: "center", alignSelf: "flex-start", backgroundColor: "#FFFFFF", borderRadius: 999, flexDirection: "row", gap: 8, marginTop: 12, paddingHorizontal: 15, paddingVertical: 10 },
  localButtonText: { color: colors.blue, fontSize: 13, fontWeight: "900" },
  locationActiveCheck: { alignItems: "center", backgroundColor: colors.green, borderRadius: 999, height: 28, justifyContent: "center", width: 28 },
  locationAddButton: { alignItems: "center", backgroundColor: colors.green, borderRadius: 999, flexDirection: "row", gap: 5, minHeight: 36, paddingHorizontal: 12 },
  locationAddButtonText: { color: colors.blue, fontSize: 12, fontWeight: "900" },
  locationOrderBody: { flex: 1, minWidth: 0 },
  locationOrderButton: { alignItems: "center", backgroundColor: colors.softBlue, borderColor: colors.border, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 11, marginTop: 10, padding: 12 },
  locationOrderIcon: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 15, height: 42, justifyContent: "center", width: 42 },
  locationOrderText: { color: colors.muted, fontSize: 12, fontWeight: "800", lineHeight: 16, marginTop: 2 },
  locationOrderTitle: { color: colors.blue, fontSize: 14, fontWeight: "900" },
  locationOptionBody: { flex: 1, minWidth: 0 },
  locationOptionCurrent: { backgroundColor: colors.softBlue, borderColor: colors.green, borderRadius: 18, borderWidth: 1, marginBottom: 18, paddingHorizontal: 11 },
  locationOptionDisabled: { opacity: 0.45 },
  locationOptionIcon: { alignItems: "center", backgroundColor: colors.softBlue, borderRadius: 14, height: 42, justifyContent: "center", width: 42 },
  locationOptionIconActive: { backgroundColor: colors.green },
  locationOptionRow: { alignItems: "center", borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: "row", gap: 11, minHeight: 68, paddingHorizontal: 2, paddingVertical: 10 },
  locationOptionText: { color: colors.muted, fontSize: 12, fontWeight: "800", marginTop: 3 },
  locationOptionTitle: { color: colors.blue, fontSize: 15, fontWeight: "900" },
  locationSavedEmpty: { alignItems: "center", flexDirection: "row", gap: 9, paddingHorizontal: 4, paddingVertical: 22 },
  locationSavedEmptyText: { color: colors.muted, flex: 1, fontSize: 13, fontWeight: "800" },
  locationSavedHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 2, marginTop: 4 },
  locationSavedTitle: { color: colors.ink, fontSize: 15, fontWeight: "900", marginBottom: 2 },
  locationSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "78%", padding: 16 },
  locationSheetContent: { paddingBottom: 12 },
  locationSheetError: { color: colors.danger, fontSize: 12, fontWeight: "900", marginBottom: 10 },
  locationSheetHeader: { alignItems: "center", flexDirection: "row", gap: 12, justifyContent: "space-between", marginBottom: 12 },
  locationSheetHeading: { flex: 1, minWidth: 0 },
  locationSheetTitle: { color: colors.ink, fontSize: 24, fontWeight: "900", marginTop: 2 },
  logoBox: { alignItems: "center", backgroundColor: colors.softBlue, borderColor: "rgba(255,255,255,0.86)", borderWidth: 2, justifyContent: "center", overflow: "hidden" },
  logoImage: { height: "100%", width: "100%" },
  logoInitials: { color: colors.blue, fontWeight: "900" },
  logoutButton: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 7, marginTop: 4, paddingHorizontal: 4, paddingVertical: 8 },
  logoutText: { color: colors.danger, fontSize: 13, fontWeight: "900" },
  menuHeader: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 14, paddingTop: 16 },
  metaRow: { alignItems: "center", flexDirection: "row", gap: 4, marginTop: 3 },
  metricPill: { alignItems: "center", flexDirection: "row", gap: 5 },
  metricText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  miniDistance: { alignItems: "center", alignSelf: "flex-start", backgroundColor: colors.softBlue, borderRadius: 999, flexDirection: "row", gap: 4, marginTop: 5, paddingHorizontal: 8, paddingVertical: 3 },
  miniDistanceText: { color: colors.blue, fontSize: 11, fontWeight: "900" },
  miniPill: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 999, borderWidth: 1, flexDirection: "row", gap: 5, height: 38, paddingHorizontal: 10 },
  miniPillText: { color: colors.blue, fontSize: 12, fontWeight: "900" },
  mapActionButton: { alignItems: "center", backgroundColor: colors.softBlue, borderColor: colors.border, borderRadius: 16, borderWidth: 1, flex: 1, flexDirection: "row", gap: 6, justifyContent: "center", minHeight: 50, paddingHorizontal: 10 },
  mapActionButtonDark: { backgroundColor: colors.blue, borderColor: colors.blue },
  mapActionRow: { flexDirection: "row", gap: 8 },
  mapActionText: { color: colors.blue, fontSize: 12, fontWeight: "900" },
  mapActionTextDark: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  mapGridHorizontal: { backgroundColor: "rgba(18,53,91,0.09)", height: 1, left: 0, position: "absolute", right: 0, top: 72 },
  mapGridVertical: { backgroundColor: "rgba(18,53,91,0.09)", bottom: 0, left: 128, position: "absolute", top: 0, width: 1 },
  mapLabel: { backgroundColor: "rgba(18,53,91,0.86)", borderRadius: 15, bottom: 10, left: 10, maxWidth: "82%", paddingHorizontal: 12, paddingVertical: 8, position: "absolute" },
  mapLabelText: { color: "#FFFFFFC9", fontSize: 11, fontWeight: "800", marginTop: 1 },
  mapLabelTitle: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  mapCenterPinWrap: { alignItems: "center", height: 58, justifyContent: "flex-start", left: "50%", marginLeft: -29, marginTop: -50, position: "absolute", top: "50%", width: 58 },
  mapPin: { alignItems: "center", backgroundColor: colors.blue, borderColor: "#FFFFFF", borderRadius: 999, borderWidth: 3, height: 50, justifyContent: "center", width: 50 },
  mapPinShadow: { backgroundColor: "rgba(8,36,65,0.22)", borderRadius: 999, bottom: 1, height: 9, position: "absolute", width: 26 },
  mapRoadOne: { backgroundColor: "rgba(183,255,0,0.34)", borderRadius: 999, height: 22, left: -16, position: "absolute", top: 34, transform: [{ rotate: "-12deg" }], width: 260 },
  mapRoadTwo: { backgroundColor: "rgba(255,255,255,0.76)", borderRadius: 999, height: 18, position: "absolute", right: -20, top: 80, transform: [{ rotate: "18deg" }], width: 230 },
  mapStaticImage: { height: "100%", opacity: 0.92, width: "100%" },
  mapLocateButton: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 999, borderWidth: 1, bottom: 14, elevation: 4, height: 44, justifyContent: "center", left: 14, position: "absolute", shadowColor: colors.blue, shadowOpacity: 0.14, shadowRadius: 8, width: 44 },
  mapPickerCanvas: { backgroundColor: colors.softBlue, borderRadius: 20, marginTop: 12 },
  mapPickerCanvasClipped: { overflow: "hidden" },
  mapPickerContent: { paddingBottom: 10 },
  mapPickerHandle: { alignSelf: "center", backgroundColor: colors.border, borderRadius: 999, height: 5, marginBottom: 12, width: 48 },
  mapPickerHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  mapPickerHint: { color: colors.muted, fontSize: 12, fontWeight: "800", lineHeight: 18, marginTop: 10, textAlign: "center" },
  mapPickerSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, bottom: 0, left: 0, maxHeight: "94%", padding: 16, position: "absolute", right: 0 },
  mapPickerSheetTall: { height: "96%", maxHeight: "96%" },
  mapPickerTitle: { color: colors.ink, fontSize: 25, fontWeight: "900", marginTop: 2 },
  mapSaveAddressButton: { flex: 1 },
  mapZoomButton: { alignItems: "center", height: 42, justifyContent: "center", width: 42 },
  mapZoomControls: { backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 16, borderWidth: 1, elevation: 4, overflow: "hidden", position: "absolute", right: 14, shadowColor: colors.blue, shadowOpacity: 0.14, shadowRadius: 8, top: 14 },
  mapZoomDivider: { backgroundColor: colors.border, height: 1, width: "100%" },
  nativeMap: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  modalOverlay: { backgroundColor: "rgba(8,36,65,0.56)", flex: 1, justifyContent: "flex-end" },
  orderBlockedBox: { alignItems: "center", backgroundColor: "#FFF1F3", borderColor: "#FECDD3", borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 9, padding: 12 },
  orderBlockedText: { color: colors.danger, flex: 1, fontSize: 13, fontWeight: "900", lineHeight: 18 },
  orderFooterActions: { gap: 8, paddingBottom: 4 },
  orderSteps: { backgroundColor: colors.softBlue, borderRadius: 22, gap: 10, marginBottom: 14, padding: 8 },
  orderStepsEyebrow: { color: colors.blue, fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  orderStepsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  orderStepsHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 5, paddingTop: 4 },
  orderStepsTitle: { color: colors.ink, fontSize: 19, fontWeight: "900", marginTop: 1 },
  orderStepsTotal: { backgroundColor: "#FFFFFF", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  orderStepsTotalText: { color: colors.blue, fontSize: 12, fontWeight: "900" },
  orderStepTab: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 999, flexBasis: "47%", flexDirection: "row", gap: 6, justifyContent: "center", minHeight: 40, paddingHorizontal: 8 },
  orderStepTabActive: { backgroundColor: colors.blue },
  orderStepTabCompleted: { backgroundColor: "#FFFFFF" },
  orderStepTabText: { color: colors.muted, flexShrink: 1, fontSize: 12, fontWeight: "900" },
  orderStepTabTextActive: { color: "#FFFFFF" },
  orderTypePill: { backgroundColor: "#F3FFE0", borderColor: colors.green, borderRadius: 999, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 5 },
  orderTypeText: { color: colors.blue, fontSize: 10, fontWeight: "900" },
  optionsHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  optionsList: { gap: 8 },
  optionsOverlay: { backgroundColor: "rgba(8,36,65,0.46)", flex: 1, justifyContent: "flex-end" },
  optionsRow: { alignItems: "center", backgroundColor: colors.background, borderColor: colors.border, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 11, minHeight: 58, padding: 11 },
  optionsRowIcon: { alignItems: "center", backgroundColor: colors.softBlue, borderRadius: 14, height: 40, justifyContent: "center", width: 40 },
  optionsRowText: { color: colors.ink, flex: 1, fontSize: 15, fontWeight: "900" },
  optionsSheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 28, borderTopRightRadius: 28, gap: 6, padding: 16, paddingBottom: 12 },
  optionsTitle: { color: colors.ink, fontSize: 24, fontWeight: "900", marginTop: 1 },
  page: { backgroundColor: colors.background, flex: 1 },
  optionCountBadge: { backgroundColor: colors.softBlue, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  optionCountBadgeOk: { backgroundColor: "#E8FBEF" },
  optionCountText: { color: colors.blue, fontSize: 12, fontWeight: "900" },
  optionCountTextOk: { color: "#067647" },
  paymentHint: { backgroundColor: colors.background, borderRadius: 16, color: colors.muted, fontSize: 13, fontWeight: "800", lineHeight: 19, marginTop: 10, padding: 12 },
  pressedCard: { opacity: 0.88, transform: [{ scale: 0.985 }] },
  primaryButton: { alignItems: "center", backgroundColor: colors.green, borderRadius: 999, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 14, minHeight: 52, paddingHorizontal: 18 },
  primaryButtonDisabled: { opacity: 0.45 },
  primaryButtonText: { color: colors.blue, fontSize: 15, fontWeight: "900" },
  promoBody: { flex: 1, minWidth: 0 },
  promoCard: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 22, borderWidth: 1, flexDirection: "row", gap: 12, padding: 10 },
  promoGrid: { gap: 10 },
  promoImage: { height: 78, overflow: "hidden", width: 78 },
  promoImageRadius: { borderRadius: 18 },
  promoName: { color: colors.ink, fontSize: 16, fontWeight: "900" },
  promoPrice: { color: colors.blue, fontSize: 16, fontWeight: "900", marginTop: 5 },
  promoRestaurant: { color: colors.muted, fontSize: 12, fontWeight: "800", marginTop: 2 },
  productBody: { flex: 1, justifyContent: "center", minWidth: 0 },
  productCard: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 24, borderWidth: 1, elevation: 2, flexDirection: "row", gap: 12, marginHorizontal: 14, minHeight: 132, padding: 12, shadowColor: colors.blue, shadowOpacity: 0.08, shadowRadius: 12 },
  productCardSelected: { borderColor: colors.green, borderWidth: 2 },
  productConfigBadge: { alignSelf: "flex-start", backgroundColor: colors.softBlue, borderRadius: 999, marginBottom: 4, paddingHorizontal: 10, paddingVertical: 4 },
  productConfigText: { color: colors.blue, fontSize: 11, fontWeight: "900" },
  productDescription: { color: colors.muted, fontSize: 14, fontWeight: "700", lineHeight: 19, marginTop: 3 },
  productFavoriteButton: { position: "absolute", right: 5, top: 5 },
  productImage: { height: 96, justifyContent: "flex-start", overflow: "hidden", width: 96 },
  productImageRadius: { borderRadius: 19 },
  productMetaLine: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  productName: { color: colors.ink, fontSize: 18, fontWeight: "900" },
  productOrdersPill: { backgroundColor: colors.softBlue, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  productOrdersText: { color: colors.blue, fontSize: 13, fontWeight: "900" },
  productPrice: { color: colors.blue, fontSize: 17, fontWeight: "900" },
  productSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 30, borderTopRightRadius: 30, overflow: "hidden" },
  productModalScroll: { flex: 1 },
  productModalScrollContent: { backgroundColor: "#FFFFFF", paddingBottom: 8 },
  productSheetBody: { backgroundColor: "#FFFFFF", gap: 8, padding: 16, paddingTop: 18 },
  productSheetDynamic: { backgroundColor: colors.surface, borderTopLeftRadius: 30, borderTopRightRadius: 30, overflow: "hidden" },
  productTopBadge: { alignSelf: "flex-start", backgroundColor: colors.green, borderRadius: 999, marginLeft: 7, marginTop: 7, paddingHorizontal: 9, paddingVertical: 5 },
  productTopText: { color: colors.blue, fontSize: 11, fontWeight: "900" },
  profileCancelButton: { alignItems: "center", backgroundColor: colors.background, borderColor: colors.border, borderRadius: 16, borderWidth: 1, flex: 1, justifyContent: "center", minHeight: 52, paddingHorizontal: 14 },
  profileCancelText: { color: colors.blue, fontSize: 14, fontWeight: "900" },
  profileEditorActions: { flexDirection: "row", gap: 10, marginTop: 6 },
  profileEditorBackdrop: { flex: 1 },
  profileEditorEyebrow: { color: colors.blue, fontSize: 11, fontWeight: "900", letterSpacing: 2.4, textTransform: "uppercase" },
  profileEditorHandle: { alignSelf: "center", backgroundColor: colors.border, borderRadius: 999, height: 5, marginBottom: 14, width: 48 },
  profileEditorHeader: { alignItems: "center", flexDirection: "row", gap: 12, justifyContent: "space-between" },
  profileEditorOverlay: { backgroundColor: "rgba(8,36,65,0.48)", flex: 1, justifyContent: "flex-end" },
  profileEditorSheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 28, borderTopRightRadius: 28, gap: 8, padding: 18, paddingBottom: 12 },
  profileEditorTitle: { color: colors.ink, fontSize: 24, fontWeight: "900", marginTop: 2 },
  profileSaveButton: { alignItems: "center", backgroundColor: colors.green, borderRadius: 16, flex: 1.35, flexDirection: "row", gap: 7, justifyContent: "center", minHeight: 52, paddingHorizontal: 14 },
  profileSaveButtonDisabled: { backgroundColor: "#D8E4E9" },
  profileSaveText: { color: colors.blue, fontSize: 14, fontWeight: "900" },
  productModalFooter: { backgroundColor: "#FFFFFF", borderTopColor: colors.border, borderTopWidth: 1, padding: 15 },
  productModalFull: { backgroundColor: colors.surface, flex: 1 },
  productModalStat: { alignItems: "center", flex: 1 },
  productModalStats: { borderBottomColor: colors.border, borderBottomWidth: 1, borderTopColor: colors.border, borderTopWidth: 1, flexDirection: "row", marginTop: 14, paddingVertical: 12 },
  productModalStatLabel: { color: colors.muted, fontSize: 12, fontWeight: "800", marginTop: 2, textAlign: "center" },
  productModalStatValue: { color: colors.ink, fontSize: 15, fontWeight: "900", textAlign: "center" },
  pickupBox: { alignItems: "center", backgroundColor: colors.softBlue, borderColor: colors.border, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 12, padding: 13 },
  pickupDescription: { color: colors.muted, fontSize: 12, fontWeight: "800", lineHeight: 17, marginTop: 2 },
  pickupText: { flex: 1, minWidth: 0 },
  pickupTitle: { color: colors.blue, fontSize: 15, fontWeight: "900" },
  qtyButton: { alignItems: "center", backgroundColor: colors.green, borderRadius: 999, height: 30, justifyContent: "center", width: 30 },
  qtyButtonDisabled: { backgroundColor: "#D8E4E9" },
  qtyButtonSmall: { alignItems: "center", backgroundColor: colors.softBlue, borderRadius: 999, height: 28, justifyContent: "center", width: 28 },
  qtyText: { color: colors.blue, fontSize: 15, fontWeight: "900", minWidth: 20, textAlign: "center" },
  qtyTextSmall: { color: colors.blue, fontSize: 13, fontWeight: "900", minWidth: 18, textAlign: "center" },
  quantityControl: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 999, borderWidth: 1, flexDirection: "row", gap: 6, padding: 4 },
  quantityControlSmall: { alignItems: "center", flexDirection: "row", gap: 5 },
  rankPill: { alignItems: "center", alignSelf: "flex-start", backgroundColor: colors.green, borderRadius: 999, flexDirection: "row", gap: 5, paddingHorizontal: 12, paddingVertical: 8 },
  rankText: { color: colors.blue, fontSize: 12, fontWeight: "900" },
  rankingBody: { flex: 1, minWidth: 0 },
  rankingCard: { backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 24, borderWidth: 1, gap: 8, marginHorizontal: 14, padding: 10, shadowColor: "#12355B", shadowOpacity: 0.08, shadowRadius: 12 },
  rankingMetric: { color: colors.muted, fontSize: 13, fontWeight: "800", marginTop: 2 },
  rankingName: { color: colors.ink, fontSize: 16, fontWeight: "900" },
  rankingRank: { alignItems: "center", backgroundColor: colors.green, borderRadius: 999, height: 43, justifyContent: "center", width: 43 },
  rankingRankText: { color: colors.blue, fontSize: 16, fontWeight: "900" },
  rankingRow: { alignItems: "center", backgroundColor: colors.background, borderRadius: 18, flexDirection: "row", gap: 11, minHeight: 78, padding: 10 },
  rankingSection: { gap: 12 },
  rankingTitleIcon: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 999, borderWidth: 1, height: 42, justifyContent: "center", width: 42 },
  rankingTitleRow: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 14 },
  recentOrderBody: { flex: 1, minWidth: 0 },
  recentOrderCard: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 10, padding: 10 },
  recentOrderIcon: { alignItems: "center", backgroundColor: colors.softBlue, borderRadius: 16, height: 42, justifyContent: "center", width: 42 },
  recentOrderMeta: { color: colors.muted, fontSize: 12, fontWeight: "800", marginTop: 2 },
  recentOrderName: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  recentOrdersBlock: { gap: 10 },
  reviewBody: { flex: 1, minWidth: 0 },
  reviewImage: { borderRadius: 14, height: 58, width: 58 },
  reviewLine: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 10, marginBottom: 8, padding: 10 },
  reviewSummary: { backgroundColor: colors.background, borderColor: colors.border, borderRadius: 18, borderWidth: 1, gap: 8, padding: 12 },
  reviewSummaryLabel: { color: colors.muted, fontSize: 12, fontWeight: "900" },
  reviewSummaryLine: { alignItems: "flex-start", flexDirection: "row", gap: 10, justifyContent: "space-between" },
  reviewSummaryValue: { color: colors.ink, flex: 1, fontSize: 12, fontWeight: "900", textAlign: "right" },
  restaurantActions: { alignItems: "center", flexDirection: "row", gap: 8 },
  restaurantIdentity: { alignItems: "center", flex: 1, flexDirection: "row", gap: 9, minWidth: 0 },
  restaurantList: { backgroundColor: colors.background, flex: 1 },
  restaurantName: { color: "#FFFFFF", fontSize: 32, fontWeight: "900", lineHeight: 34 },
  restaurantSearchClear: { alignItems: "center", backgroundColor: colors.blue, borderRadius: 999, height: 32, justifyContent: "center", width: 32 },
  restaurantSearchInput: { color: colors.ink, flex: 1, fontSize: 15, fontWeight: "900", minHeight: 52 },
  restaurantSearchShell: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 22, borderWidth: 1, flexDirection: "row", gap: 10, marginHorizontal: 14, marginTop: 16, minHeight: 58, paddingLeft: 16, paddingRight: 10, shadowColor: "#12355B", shadowOpacity: 0.08, shadowRadius: 10 },
  restaurantSectionEyebrow: { color: colors.green, fontSize: 11, fontWeight: "900", letterSpacing: 2.4, textTransform: "uppercase" },
  restaurantSectionHeader: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between" },
  restaurantSectionTitle: { color: colors.ink, fontSize: 21, fontWeight: "900", lineHeight: 25, marginTop: 2 },
  restaurantSubtitle: { color: "rgba(255,255,255,0.78)", fontSize: 13, fontWeight: "800", lineHeight: 18, marginTop: 4 },
  restaurantTopBar: { alignItems: "center", backgroundColor: "#FFFFFF", borderBottomColor: colors.border, borderBottomWidth: 1, elevation: 3, flexDirection: "row", gap: 10, minHeight: 62, paddingHorizontal: 14, paddingVertical: 8, shadowColor: "#12355B", shadowOpacity: 0.08, shadowRadius: 9 },
  restaurantTopCity: { color: colors.muted, flex: 1, fontSize: 11, fontWeight: "800" },
  restaurantTopCityRow: { alignItems: "center", flexDirection: "row", gap: 4, marginTop: 2 },
  restaurantTopName: { color: colors.ink, fontSize: 14, fontWeight: "900", maxWidth: 122 },
  restaurantTopProducts: { backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 24, borderWidth: 1, elevation: 2, gap: 14, marginHorizontal: 14, marginTop: 18, padding: 14, shadowColor: colors.blue, shadowOpacity: 0.08, shadowRadius: 12 },
  restaurantTopText: { flex: 1, minWidth: 0 },
  resultArrow: { alignItems: "center", backgroundColor: colors.green, borderRadius: 999, height: 42, justifyContent: "center", width: 42 },
  resultBody: { flex: 1, minWidth: 0 },
  resultCard: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 12, marginHorizontal: 14, padding: 10, shadowColor: "#12355B", shadowOpacity: 0.08, shadowRadius: 10 },
  resultSubtitle: { color: colors.muted, fontSize: 12, fontWeight: "800", marginTop: 2 },
  resultTitle: { color: colors.ink, fontSize: 15, fontWeight: "900" },
  resultsCount: { backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  resultsCountText: { color: colors.muted, fontSize: 12, fontWeight: "900" },
  resultsHeader: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between", marginTop: 16 },
  safeBlue: { backgroundColor: colors.blue, flex: 1 },
  savedAddressChip: { alignItems: "center", backgroundColor: colors.softBlue, borderColor: colors.border, borderRadius: 999, borderWidth: 1, flexDirection: "row", gap: 6, maxWidth: 210, minHeight: 38, paddingHorizontal: 12 },
  savedAddressRail: { gap: 8, paddingTop: 10 },
  savedAddressText: { color: colors.blue, fontSize: 12, fontWeight: "900" },
  searchBlock: { marginTop: 18 },
  searchBlockHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  searchBlockTitle: { color: colors.ink, fontSize: 16, fontWeight: "900", marginBottom: 10 },
  searchBusinessRail: { gap: 10, paddingBottom: 2, paddingRight: 18 },
  searchButton: { alignItems: "center", backgroundColor: colors.green, borderRadius: 999, height: 46, justifyContent: "center", width: 46 },
  searchHandle: { alignSelf: "center", backgroundColor: colors.border, borderRadius: 999, height: 5, marginBottom: 14, width: 48 },
  searchInput: { color: colors.ink, flex: 1, fontSize: 15, fontWeight: "900" },
  searchModalOverlay: { backgroundColor: "rgba(8,36,65,0.46)", flex: 1, justifyContent: "flex-end" },
  searchPlaceholder: { color: "#8A98AB", flex: 1, fontSize: 14, fontWeight: "900" },
  searchProductImage: { height: 46, overflow: "hidden", width: 46 },
  searchProductImageRadius: { borderRadius: 15 },
  searchResultBody: { flex: 1, minWidth: 0 },
  searchResultRow: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 10, marginBottom: 8, padding: 9 },
  searchResultText: { color: colors.muted, fontSize: 12, fontWeight: "800", marginTop: 2 },
  searchResultTitle: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  searchSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 30, borderTopRightRadius: 30, height: "88%", padding: 16 },
  searchSheetEyebrow: { color: colors.green, fontSize: 12, fontWeight: "900", letterSpacing: 2.5, textTransform: "uppercase" },
  searchSheetHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  searchSheetInput: { color: colors.ink, flex: 1, fontSize: 16, fontWeight: "900", minHeight: 52 },
  searchSheetInputWrap: { alignItems: "center", backgroundColor: colors.background, borderColor: colors.border, borderRadius: 22, borderWidth: 1, flexDirection: "row", gap: 10, marginTop: 14, paddingHorizontal: 14 },
  searchSheetTitle: { color: colors.ink, fontSize: 24, fontWeight: "900", marginTop: 2 },
  searchShell: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 22, flexDirection: "row", gap: 10, marginHorizontal: 14, marginTop: 14, minHeight: 54, paddingLeft: 18, paddingRight: 5 },
  searchValue: { color: colors.ink },
  sectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  segmentButton: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 999, borderWidth: 1, flex: 1, flexDirection: "row", gap: 7, justifyContent: "center", minHeight: 43 },
  segmentButtonActive: { backgroundColor: colors.softBlue, borderColor: colors.green },
  segmentRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  segmentText: { color: colors.muted, fontSize: 13, fontWeight: "900" },
  segmentTextActive: { color: colors.blue },
  sheetActionsRow: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" },
  sheetBody: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 28, borderTopRightRadius: 28, flex: 1, gap: 8, marginTop: -24, padding: 16, paddingTop: 21 },
  sheetDescription: { color: colors.muted, fontSize: 16, fontWeight: "700", lineHeight: 23 },
  sheetEyebrow: { color: colors.blue, fontSize: 12, fontWeight: "900", letterSpacing: 1.2, textTransform: "uppercase" },
  sheetImage: { height: 246 },
  sheetImageCompact: { height: 178 },
  sheetImageRadius: { borderBottomLeftRadius: 26, borderBottomRightRadius: 26 },
  sheetPrice: { color: colors.blue, fontSize: 26, fontWeight: "900" },
  sheetTitle: { color: colors.ink, fontSize: 31, fontWeight: "900", lineHeight: 35 },
  sheetTop: { flex: 1, justifyContent: "flex-start", padding: 18 },
  successInline: { color: "#067647", fontSize: 13, fontWeight: "900", marginTop: 4 },
  tabCopy: { color: "#FFFFFFD1", fontSize: 14, fontWeight: "800", lineHeight: 20, marginTop: 6 },
  tabEyebrow: { color: colors.green, fontSize: 12, fontWeight: "900", letterSpacing: 2.4, textTransform: "uppercase" },
  tabHero: { backgroundColor: colors.blue, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, marginHorizontal: -14, padding: 18, paddingBottom: 24 },
  tabPage: { gap: 14, paddingBottom: 110, paddingHorizontal: 14 },
  tabTitle: { color: "#FFFFFF", fontSize: 30, fontWeight: "900", lineHeight: 34, marginTop: 4 },
  footerAddButton: { alignItems: "center", backgroundColor: colors.green, borderRadius: 14, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 10, minHeight: 48, paddingHorizontal: 16 },
  footerAddButtonDisabled: { backgroundColor: "#CBD5E1" },
  footerAddText: { color: colors.blue, fontSize: 15, fontWeight: "900" },
  footerLabel: { color: colors.muted, fontSize: 12, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  footerRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 5 },
  startupErrorText: { color: "#FFFFFFCC", fontSize: 14, fontWeight: "700", lineHeight: 20, marginHorizontal: 26, marginTop: 8, textAlign: "center" },
  stepIntro: { alignItems: "flex-start", backgroundColor: "#FFFFFF", borderRadius: 20, flexDirection: "row", gap: 12, padding: 12 },
  stepIntroDescription: { color: colors.muted, fontSize: 13, fontWeight: "800", lineHeight: 19, marginTop: 2 },
  stepIntroIcon: { alignItems: "center", backgroundColor: colors.blue, borderRadius: 999, height: 40, justifyContent: "center", width: 40 },
  stepIntroText: { flex: 1, minWidth: 0 },
  stepIntroTitle: { color: colors.ink, fontSize: 15, fontWeight: "900" },
  submitError: { color: colors.danger, fontSize: 13, fontWeight: "800", lineHeight: 18, marginTop: 12, textAlign: "center" },
  successBox: { alignItems: "center", gap: 8, paddingVertical: 24 },
  successText: { color: colors.muted, fontSize: 14, fontWeight: "700", lineHeight: 20, textAlign: "center" },
  successTitle: { color: colors.ink, fontSize: 21, fontWeight: "900", textAlign: "center" },
  skeletonBody: { flex: 1, gap: 9 },
  skeletonCard: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 12, marginHorizontal: 14, padding: 12 },
  skeletonCircle: { backgroundColor: "#EEF3F8", borderRadius: 999, height: 42, width: 42 },
  skeletonLine: { backgroundColor: "#EEF3F8", borderRadius: 999, height: 14, width: "64%" },
  skeletonLineStrong: { backgroundColor: "#E4E9F0", borderRadius: 999, height: 18, width: "86%" },
  skeletonList: { gap: 12, paddingTop: 4 },
  skeletonLogo: { backgroundColor: "#EEF3F8", borderRadius: 16, height: 56, width: 56 },
  title: { color: colors.ink, fontSize: 22, fontWeight: "900", lineHeight: 27, marginTop: 2 },
  topProductAdd: { alignItems: "center", backgroundColor: colors.green, borderRadius: 999, height: 34, justifyContent: "center", width: 34 },
  topProductBody: { flex: 1, minWidth: 0 },
  topProductCard: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 21, borderWidth: 1, elevation: 2, flexDirection: "row", gap: 10, minHeight: 86, padding: 9, shadowColor: colors.blue, shadowOpacity: 0.08, shadowRadius: 10, width: 248 },
  topProductImage: { height: 64, overflow: "hidden", width: 64 },
  topProductImageRadius: { borderRadius: 16 },
  topProductMeta: { color: colors.blue, fontSize: 12, fontWeight: "900", marginTop: 3 },
  topProductName: { color: colors.ink, fontSize: 15, fontWeight: "900" },
  topProductRail: { gap: 10, paddingBottom: 2, paddingRight: 2 },
  queueCard: { backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 22, borderWidth: 1, gap: 14, padding: 12, shadowColor: colors.blue, shadowOpacity: 0.07, shadowRadius: 14 },
  queueChefDot: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 999, height: 44, justifyContent: "center", marginLeft: "auto", width: 44 },
  queueDemandPill: { alignItems: "center", alignSelf: "flex-start", backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 999, borderWidth: 1, flexDirection: "row", gap: 5, paddingHorizontal: 10, paddingVertical: 6 },
  queueDemandText: { color: colors.ink, fontSize: 11, fontWeight: "900" },
  queueDotAhead: { alignItems: "center", backgroundColor: "rgba(183,255,0,0.18)", borderRadius: 999, height: 40, justifyContent: "center", width: 40 },
  queueDotMine: { alignItems: "center", backgroundColor: "rgba(18,53,91,0.32)", borderRadius: 999, height: 40, justifyContent: "center", width: 40 },
  queueDotMineText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  queueDotText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  queueEstimateBox: { backgroundColor: "#EAF4FC", borderRadius: 16, padding: 14 },
  queueEstimateLabel: { color: colors.blue, fontSize: 11, fontWeight: "900", letterSpacing: 2, textTransform: "uppercase" },
  queueEstimateValue: { color: colors.blueDark, fontSize: 28, fontWeight: "900", marginTop: 2 },
  queueHeadline: { color: colors.ink, fontSize: 24, fontWeight: "900", lineHeight: 29 },
  queueLane: { backgroundColor: colors.blue, borderRadius: 16, gap: 14, overflow: "hidden", padding: 14 },
  queueLaneDots: { alignItems: "center", flexDirection: "row", gap: 8 },
  queueLaneLine: { backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 999, flex: 1, height: 3 },
  queueLaneLineActive: { backgroundColor: colors.green, borderRadius: 999, height: 3, width: "62%" },
  queueLaneTop: { alignItems: "center", flexDirection: "row", gap: 10 },
  queueLiveText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900", letterSpacing: 2, textTransform: "uppercase" },
  queueProgress: { flexDirection: "row", gap: 8 },
  queueProgressItem: { alignItems: "center", backgroundColor: "#F5F7FA", borderColor: colors.border, borderRadius: 14, borderWidth: 1, flex: 1, gap: 5, justifyContent: "center", minHeight: 68, padding: 7 },
  queueProgressItemActive: { backgroundColor: "#EFF8FF", borderColor: colors.blue },
  queueProgressText: { color: "#8D9AAF", fontSize: 9, fontWeight: "900", textAlign: "center" },
  queueProgressTextActive: { color: colors.blue },
  queueRefreshFooter: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 999, flexDirection: "row", gap: 6, justifyContent: "center", padding: 11 },
  queueRefreshText: { color: colors.muted, fontSize: 11, fontWeight: "900" },
  queueStat: { backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 16, borderWidth: 1, padding: 13 },
  queueStatDetail: { color: colors.muted, fontSize: 11, fontWeight: "700", marginTop: 2 },
  queueStatLabel: { color: colors.ink, fontSize: 12, fontWeight: "900" },
  queueStatTitle: { alignItems: "center", flexDirection: "row", gap: 6 },
  queueStatValue: { color: colors.ink, fontSize: 24, fontWeight: "900", marginTop: 9 },
  queueStats: { gap: 10 },
  queueSupport: { color: colors.muted, fontSize: 14, fontWeight: "700", lineHeight: 21 },
  queueWindow: { color: colors.blue, fontSize: 12, fontWeight: "800", marginTop: 3 },
  searchAnotherButton: { alignItems: "center", alignSelf: "center", backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 999, borderWidth: 1, flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 11 },
  searchAnotherText: { color: colors.blue, fontSize: 13, fontWeight: "900" },
  trackingCard: { backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 24, borderWidth: 1, padding: 14, shadowColor: "#12355B", shadowOpacity: 0.08, shadowRadius: 12 },
  trackingDot: { alignItems: "center", backgroundColor: "#F5F7FA", borderRadius: 999, height: 38, justifyContent: "center", width: 38 },
  trackingDotActive: { backgroundColor: "#FFFFFF", borderColor: colors.blue, borderWidth: 1 },
  trackingHeaderBody: { flex: 1, minWidth: 0 },
  trackingHeaderCard: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 10, padding: 10 },
  trackingIllustration: { height: 72, resizeMode: "contain", width: 92 },
  trackingMapButton: { alignItems: "center", alignSelf: "flex-start", backgroundColor: colors.green, borderRadius: 999, flexDirection: "row", gap: 7, marginTop: 10, minHeight: 40, paddingHorizontal: 13 },
  trackingMapButtonText: { color: colors.blue, fontSize: 12, fontWeight: "900" },
  trackingModePill: { alignSelf: "flex-start", backgroundColor: "#F3FFE0", borderColor: colors.green, borderRadius: 999, borderWidth: 1, marginTop: 8, paddingHorizontal: 12, paddingVertical: 5 },
  trackingModeText: { color: colors.blue, fontSize: 11, fontWeight: "900" },
  trackingOrder: { color: colors.ink, fontSize: 22, fontWeight: "900", marginTop: 4 },
  trackingPage: { gap: 16, padding: 14, paddingBottom: 112, paddingTop: 18 },
  trackingProductBody: { flex: 1, minWidth: 0 },
  trackingProductLine: { alignItems: "center", borderTopColor: colors.border, borderTopWidth: 1, flexDirection: "row", gap: 10, paddingVertical: 10 },
  trackingProductName: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  trackingProductNotes: { color: colors.muted, fontSize: 12, fontWeight: "700", marginTop: 2 },
  trackingProductQty: { color: colors.blue, fontSize: 14, fontWeight: "900" },
  trackingProductThumb: { alignItems: "center", backgroundColor: colors.softBlue, borderRadius: 14, height: 42, justifyContent: "center", width: 42 },
  trackingProductsCount: { backgroundColor: colors.softBlue, borderRadius: 999, color: colors.blue, fontSize: 12, fontWeight: "900", overflow: "hidden", paddingHorizontal: 9, paddingVertical: 3 },
  trackingProductsList: { marginTop: 4 },
  trackingProductsText: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  trackingProductsToggle: { alignItems: "center", borderBottomColor: colors.border, borderBottomWidth: 1, borderTopColor: colors.border, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", marginHorizontal: -16, marginTop: 14, paddingHorizontal: 16, paddingVertical: 12 },
  trackingRestaurant: { color: colors.muted, fontSize: 13, fontWeight: "900", textTransform: "uppercase" },
  trackingResultCard: { backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 20, borderWidth: 1, overflow: "hidden", padding: 16, shadowColor: "#12355B", shadowOpacity: 0.08, shadowRadius: 12 },
  trackingSectionSub: { color: colors.muted, fontSize: 13, fontWeight: "700", marginTop: 4 },
  trackingSectionTitle: { color: colors.ink, fontSize: 22, fontWeight: "900" },
  trackingStack: { gap: 14 },
  trackingStateCard: { backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 20, borderWidth: 1, gap: 12, padding: 12 },
  trackingStateIntro: { flex: 1, gap: 4 },
  trackingStateTitle: { color: colors.ink, fontSize: 15, fontWeight: "900" },
  trackingStatusPill: { alignSelf: "flex-start", backgroundColor: "#FFF9E8", borderColor: "#FFE2A8", borderRadius: 999, borderWidth: 1, marginTop: 12, paddingHorizontal: 12, paddingVertical: 5 },
  trackingStatusPillText: { color: "#B45309", fontSize: 11, fontWeight: "900" },
  trackingStep: { alignItems: "center", backgroundColor: "#F7F9FC", borderColor: "#F7F9FC", borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 10, padding: 10 },
  trackingStepBody: { flex: 1, minWidth: 0 },
  trackingStepCurrent: { backgroundColor: "#F1FFD6", borderColor: colors.green },
  trackingStepDescription: { color: colors.muted, fontSize: 12, fontWeight: "700", marginTop: 2 },
  trackingStepText: { color: colors.muted, fontSize: 14, fontWeight: "900" },
  trackingStepTextActive: { color: colors.blue },
  trackingSteps: { gap: 8 },
  trackingTitleBlock: { flex: 1 },
  trackingTop: { alignItems: "center", flexDirection: "row", gap: 12 },
  trackingTotal: { color: "#FFFFFF", fontSize: 24, fontWeight: "900" },
  trackingTotalBox: { backgroundColor: colors.blue, borderRadius: 14, marginTop: 14, padding: 14 },
  trackingTotalLabel: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  popularProductCard: { backgroundColor: "#FFFFFF", borderColor: colors.border, borderRadius: 20, borderWidth: 1, marginRight: 12, overflow: "hidden", paddingBottom: 12, shadowColor: "#12355B", shadowOpacity: 0.08, shadowRadius: 10, width: 156 },
  popularProductImage: { height: 105 },
  popularProductImageRadius: { borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  popularProductName: { color: colors.ink, fontSize: 14, fontWeight: "900", lineHeight: 18, marginHorizontal: 11, marginTop: 10, minHeight: 36 },
  popularProductOverlay: { flex: 1 },
  popularProductPrice: { color: colors.blue, fontSize: 15, fontWeight: "900", marginHorizontal: 11, marginTop: 6 },
  popularProductRestaurant: { color: colors.muted, fontSize: 12, fontWeight: "800", marginHorizontal: 11, marginTop: 3 },
  productRail: { paddingLeft: 14, paddingRight: 2 },
  applySearchButton: { backgroundColor: colors.green, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  applySearchText: { color: colors.blue, fontSize: 12, fontWeight: "900" },
  totalBox: { backgroundColor: colors.background, borderColor: colors.border, borderRadius: 18, borderWidth: 1, gap: 8, marginTop: 12, padding: 14 },
  totalLabel: { color: colors.muted, fontSize: 14, fontWeight: "800" },
  totalLine: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  totalStrong: { color: colors.blue, fontSize: 18, fontWeight: "900" },
  totalValue: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  uploadClearButton: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 5, marginTop: 8, minHeight: 32, paddingHorizontal: 4 },
  uploadClearText: { color: colors.danger, fontSize: 12, fontWeight: "900" },
  uploadIconBox: { alignItems: "center", backgroundColor: colors.green, borderRadius: 14, height: 46, justifyContent: "center", overflow: "hidden", width: 46 },
  uploadPicker: { gap: 2 },
  uploadPickerBody: { flex: 1, minWidth: 0 },
  uploadPickerButton: { alignItems: "center", backgroundColor: colors.background, borderColor: colors.border, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 11, minHeight: 70, padding: 11 },
  uploadPickerLabel: { color: colors.ink, fontSize: 15, fontWeight: "900" },
  uploadPickerText: { color: colors.muted, fontSize: 12, fontWeight: "800", lineHeight: 17, marginTop: 2 },
  uploadThumb: { height: 46, width: 46 },
});
