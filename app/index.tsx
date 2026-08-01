import * as Location from "expo-location";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Bike, Clock3, MapPin, Navigation, ReceiptText, Search, UserRound } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  ImageBackground,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BrandHeader, EmptyMessage, FadeInView, IconButton, PillButton, colors } from "../src/components/ui";
import { formatDistance } from "../src/lib/distance";
import { listRestaurants } from "../src/lib/data";
import type { RestaurantSummary, UserLocation } from "../src/types/domain";

const defaultBanner = require("../assets/default-food-banner.png");

export default function HomeScreen() {
  const [restaurants, setRestaurants] = useState<RestaurantSummary[]>([]);
  const [location, setLocation] = useState<UserLocation | undefined>();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return restaurants;
    }

    return restaurants.filter((restaurant) => {
      return [restaurant.name, restaurant.description, restaurant.city].some((value) => value.toLowerCase().includes(normalized));
    });
  }, [query, restaurants]);
  const featured = filtered.slice(0, 4);

  async function load(nextLocation = location) {
    setError("");
    const nextRestaurants = await listRestaurants(nextLocation);
    setRestaurants(nextRestaurants);
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await load();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar restaurantes.");
    } finally {
      setRefreshing(false);
    }
  }

  async function requestLocation() {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      setError("Activa la ubicacion para ordenar restaurantes por cercania.");
      return;
    }

    const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const nextLocation = {
      latitude: current.coords.latitude,
      longitude: current.coords.longitude,
    };
    setLocation(nextLocation);
    await load(nextLocation);
  }

  useEffect(() => {
    load()
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar restaurantes."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <SafeAreaView edges={["top"]} style={styles.safe}>
      <FlatList
        ListHeaderComponent={
          <>
            <BrandHeader>
              <View style={styles.topRow}>
                <View style={styles.headerSpacer} />
                <View style={styles.headerActions}>
                  <IconButton onPress={() => router.push("/orders")}>
                    <ReceiptText color="#FFFFFF" size={21} strokeWidth={3} />
                  </IconButton>
                  <IconButton>
                    <UserRound color="#FFFFFF" size={22} strokeWidth={3} />
                  </IconButton>
                </View>
              </View>

              <FadeInView>
                <Text style={styles.heroTitle}>Pide rapido, cerca y directo.</Text>
                <View style={styles.searchBox}>
                  <Search color={colors.blue} size={23} strokeWidth={3} />
                  <TextInput
                    onChangeText={setQuery}
                    placeholder="Locales, platos y productos"
                    placeholderTextColor="#8A98AB"
                    style={styles.searchInput}
                    value={query}
                  />
                </View>
                <View style={styles.actions}>
                  <PillButton onPress={requestLocation}>{location ? "Ubicacion activa" : "Usar mi ubicacion"}</PillButton>
                  <PillButton onPress={() => router.push("/orders")} variant="secondary">
                    Mis pedidos
                  </PillButton>
                </View>
              </FadeInView>
            </BrandHeader>

            {featured.length ? (
              <FadeInView delay={80} style={styles.featuredBlock}>
                <View style={styles.sectionHeaderInline}>
                  <View>
                    <Text style={styles.eyebrow}>RANKING</Text>
                    <Text style={styles.title}>Mas pedidos</Text>
                  </View>
                  {loading ? <ActivityIndicator color={colors.blue} /> : null}
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.featuredRail}>
                  {featured.map((restaurant, index) => (
                    <FeaturedRestaurantCard index={index + 1} key={restaurant.id} restaurant={restaurant} />
                  ))}
                </ScrollView>
              </FadeInView>
            ) : null}

            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.eyebrow}>EXPLORAR</Text>
                <Text style={styles.title}>Encuentra tu negocio</Text>
              </View>
              {loading && !featured.length ? <ActivityIndicator color={colors.blue} /> : null}
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </>
        }
        contentContainerStyle={styles.content}
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl onRefresh={refresh} refreshing={refreshing} tintColor={colors.blue} />}
        renderItem={({ item, index }) => (
          <FadeInView delay={Math.min(index * 45, 180)}>
            <RestaurantCard restaurant={item} />
          </FadeInView>
        )}
        ListEmptyComponent={!loading ? <EmptyMessage description="Cuando haya locales activos apareceran aqui para pedir." title="Sin resultados" /> : null}
      />
    </SafeAreaView>
  );
}

function FeaturedRestaurantCard({ restaurant, index }: { restaurant: RestaurantSummary; index: number }) {
  const distance = formatDistance(restaurant.distanceKm);

  return (
    <Pressable
      onPress={() => router.push({ pathname: "/restaurant/[slug]", params: { slug: restaurant.slug } })}
      style={({ pressed }) => [styles.featuredCard, pressed && styles.pressedCard]}
    >
      <ImageBackground source={restaurant.bannerUrl ? { uri: restaurant.bannerUrl } : defaultBanner} style={styles.featuredImage} imageStyle={styles.featuredImageRadius}>
        <LinearGradient colors={["rgba(8,36,65,0.08)", "rgba(8,36,65,0.78)"]} style={styles.featuredOverlay}>
          <View style={styles.rankPill}>
            <Navigation color={colors.blue} size={15} strokeWidth={3} />
            <Text style={styles.rankText}>#{index} mas usado</Text>
          </View>
          <View style={styles.featuredBottom}>
            <RestaurantLogo restaurant={restaurant} size={58} />
            <View style={styles.featuredText}>
              <Text numberOfLines={1} style={styles.featuredTitle}>
                {restaurant.name}
              </Text>
              <Text numberOfLines={1} style={styles.featuredMeta}>
                {[restaurant.city, distance].filter(Boolean).join(" - ")}
              </Text>
            </View>
          </View>
        </LinearGradient>
      </ImageBackground>
    </Pressable>
  );
}

function RestaurantCard({ restaurant }: { restaurant: RestaurantSummary }) {
  const distance = formatDistance(restaurant.distanceKm);

  return (
    <Pressable
      onPress={() => router.push({ pathname: "/restaurant/[slug]", params: { slug: restaurant.slug } })}
      style={({ pressed }) => [styles.card, pressed && styles.pressedCard]}
    >
      <ImageBackground source={restaurant.bannerUrl ? { uri: restaurant.bannerUrl } : defaultBanner} style={styles.cardBanner} imageStyle={styles.cardBannerImage}>
        <LinearGradient colors={["rgba(8,36,65,0)", "rgba(8,36,65,0.55)"]} style={StyleSheet.absoluteFill} />
      </ImageBackground>
      <View style={styles.cardContent}>
        <RestaurantLogo restaurant={restaurant} size={62} />
        <View style={styles.cardBody}>
          <Text numberOfLines={1} style={styles.cardTitle}>
            {restaurant.name}
          </Text>
          <View style={styles.metaRow}>
            <MapPin color={colors.muted} size={15} strokeWidth={2.8} />
            <Text numberOfLines={1} style={styles.cardMeta}>
              {[restaurant.city, distance].filter(Boolean).join(" - ")}
            </Text>
          </View>
          <View style={styles.statusRow}>
            <View style={styles.statusPill}>
              <Clock3 color={colors.blue} size={14} strokeWidth={3} />
              <Text style={styles.statusText}>Abierto</Text>
            </View>
            <View style={styles.statusPill}>
              <Bike color={colors.blue} size={14} strokeWidth={3} />
              <Text style={styles.statusText}>Delivery</Text>
            </View>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function RestaurantLogo({ restaurant, size }: { restaurant: RestaurantSummary; size: number }) {
  return (
    <View style={[styles.logoBox, { height: size, width: size, borderRadius: size * 0.28 }]}>
      {restaurant.logoUrl.startsWith("http") ? <Image source={{ uri: restaurant.logoUrl }} style={styles.logoImage} /> : <Text style={styles.logoInitials}>{restaurant.logoUrl}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 16,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    marginHorizontal: 18,
    overflow: "hidden",
    shadowColor: "#12355B",
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
  },
  cardBanner: {
    height: 86,
  },
  cardBannerImage: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
  },
  cardContent: {
    alignItems: "center",
    flexDirection: "row",
    gap: 13,
    padding: 14,
  },
  cardMeta: {
    color: colors.muted,
    flex: 1,
    fontSize: 13,
    fontWeight: "800",
  },
  cardTitle: {
    color: colors.ink,
    fontSize: 19,
    fontWeight: "900",
  },
  content: {
    gap: 12,
    paddingBottom: 30,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "800",
    marginHorizontal: 20,
    marginTop: -8,
  },
  eyebrow: {
    color: colors.green,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 3,
  },
  featuredBlock: {
    marginTop: 18,
  },
  featuredBottom: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  featuredCard: {
    height: 210,
    marginRight: 14,
    width: 292,
  },
  featuredImage: {
    flex: 1,
  },
  featuredImageRadius: {
    borderRadius: 26,
  },
  featuredMeta: {
    color: "#FFFFFFD8",
    fontSize: 13,
    fontWeight: "800",
    marginTop: 3,
  },
  featuredOverlay: {
    borderRadius: 26,
    flex: 1,
    justifyContent: "space-between",
    padding: 16,
  },
  featuredRail: {
    paddingHorizontal: 18,
    paddingTop: 12,
  },
  featuredText: {
    flex: 1,
    minWidth: 0,
  },
  featuredTitle: {
    color: "#FFFFFF",
    fontSize: 25,
    fontWeight: "900",
  },
  headerActions: {
    flexDirection: "row",
    gap: 10,
  },
  headerSpacer: {
    flex: 1,
  },
  heroTitle: {
    color: "#FFFFFF",
    fontSize: 30,
    fontWeight: "900",
    lineHeight: 36,
    marginTop: 18,
    maxWidth: 300,
  },
  logoBox: {
    alignItems: "center",
    backgroundColor: colors.softBlue,
    borderColor: "rgba(255,255,255,0.86)",
    borderWidth: 2,
    justifyContent: "center",
    overflow: "hidden",
  },
  logoImage: {
    height: "100%",
    width: "100%",
  },
  logoInitials: {
    color: colors.blue,
    fontSize: 20,
    fontWeight: "900",
  },
  metaRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    marginTop: 4,
  },
  pressedCard: {
    opacity: 0.88,
    transform: [{ scale: 0.985 }],
  },
  rankPill: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.green,
    borderRadius: 999,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  rankText: {
    color: colors.blue,
    fontSize: 12,
    fontWeight: "900",
  },
  safe: {
    backgroundColor: colors.blue,
    flex: 1,
  },
  searchBox: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 26,
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
    marginTop: 18,
    minHeight: 60,
    paddingHorizontal: 18,
    shadowColor: colors.green,
    shadowOffset: { height: 0, width: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 24,
  },
  searchInput: {
    color: colors.ink,
    flex: 1,
    fontSize: 16,
    fontWeight: "800",
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 22,
  },
  sectionHeaderInline: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
  statusPill: {
    alignItems: "center",
    backgroundColor: colors.softBlue,
    borderRadius: 999,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  statusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  statusText: {
    color: colors.blue,
    fontSize: 12,
    fontWeight: "900",
  },
  title: {
    color: colors.ink,
    fontSize: 30,
    fontWeight: "900",
    marginTop: 4,
  },
  topRow: {
    alignItems: "center",
    flexDirection: "row",
    marginTop: -46,
  },
});
