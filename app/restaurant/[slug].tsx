import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { Bike, ChevronLeft, Clock3, Minus, Plus, ShoppingBag, Sparkles, X } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  ImageBackground,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { EmptyMessage, FadeInView, IconButton, PillButton, colors } from "../../src/components/ui";
import { formatDistance } from "../../src/lib/distance";
import { getRestaurantBySlug, listRestaurantCatalog } from "../../src/lib/data";
import type { CategorySummary, ProductSummary, RestaurantSummary } from "../../src/types/domain";

type CartLine = ProductSummary & { quantity: number };

const defaultBanner = require("../../assets/default-food-banner.png");

export default function RestaurantScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [restaurant, setRestaurant] = useState<RestaurantSummary | null>(null);
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [categoryId, setCategoryId] = useState("all");
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [selectedProduct, setSelectedProduct] = useState<ProductSummary | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const visibleProducts = useMemo(() => {
    return products.filter((product) => categoryId === "all" || product.categoryId === categoryId);
  }, [categoryId, products]);
  const cartItems = Object.values(cart);
  const cartTotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  function updateQuantity(product: ProductSummary, delta: number) {
    setCart((current) => {
      const nextQuantity = (current[product.id]?.quantity ?? 0) + delta;
      if (nextQuantity <= 0) {
        const { [product.id]: _removed, ...rest } = current;
        return rest;
      }

      return {
        ...current,
        [product.id]: {
          ...product,
          quantity: nextQuantity,
        },
      };
    });
  }

  useEffect(() => {
    async function load() {
      if (!slug) {
        return;
      }

      const nextRestaurant = await getRestaurantBySlug(slug);
      if (!nextRestaurant) {
        setError("No encontramos este restaurante.");
        return;
      }

      const catalog = await listRestaurantCatalog(nextRestaurant.id);
      setRestaurant(nextRestaurant);
      setCategories(catalog.categories);
      setProducts(catalog.products);
    }

    load()
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el menu."))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <SafeAreaView style={styles.loading}>
        <AnimatedPulse />
        <Text style={styles.loadingText}>Cargando menu...</Text>
      </SafeAreaView>
    );
  }

  if (!restaurant) {
    return (
      <SafeAreaView style={styles.page}>
        <View style={styles.content}>
          <EmptyMessage description={error || "Intenta volver al inicio."} title="Restaurante no disponible" />
          <PillButton onPress={() => router.back()}>Volver</PillButton>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.page}>
      <FlatList
        ListHeaderComponent={
          <>
            <ImageBackground source={restaurant.bannerUrl ? { uri: restaurant.bannerUrl } : defaultBanner} style={styles.banner} imageStyle={styles.bannerImage}>
              <LinearGradient colors={["rgba(8,36,65,0.18)", "rgba(8,36,65,0.9)"]} style={styles.bannerOverlay}>
                <View style={styles.bannerTop}>
                  <IconButton light onPress={() => router.back()}>
                    <ChevronLeft color={colors.blue} size={25} strokeWidth={3} />
                  </IconButton>
                  <IconButton light>
                    <Sparkles color={colors.blue} size={22} strokeWidth={3} />
                  </IconButton>
                </View>

                <View>
                  <View style={styles.livePill}>
                    <Sparkles color={colors.blue} size={15} strokeWidth={3} />
                    <Text style={styles.liveText}>Ofertas y favoritos</Text>
                  </View>
                  <Text numberOfLines={2} style={styles.restaurantName}>
                    {restaurant.name}
                  </Text>
                  <Text style={styles.restaurantSubtitle}>Elige tus productos, confirma tu pedido y el equipo lo recibe al instante.</Text>
                  <View style={styles.bannerMetrics}>
                    <View style={styles.metricPill}>
                      <Clock3 color="#FFFFFF" size={15} strokeWidth={3} />
                      <Text style={styles.metricText}>25-35 min</Text>
                    </View>
                    <View style={styles.dot} />
                    <View style={styles.metricPill}>
                      <Bike color="#FFFFFF" size={15} strokeWidth={3} />
                      <Text style={styles.metricText}>Delivery</Text>
                    </View>
                    <View style={styles.dot} />
                    <Text style={styles.metricText}>{products.length} platos</Text>
                    {restaurant.distanceKm !== undefined ? (
                      <>
                        <View style={styles.dot} />
                        <Text style={styles.metricText}>{formatDistance(restaurant.distanceKm)}</Text>
                      </>
                    ) : null}
                  </View>
                </View>
              </LinearGradient>
            </ImageBackground>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRail}>
              <CategoryChip active={categoryId === "all"} label="Todo" onPress={() => setCategoryId("all")} />
              {categories.map((category) => (
                <CategoryChip active={categoryId === category.id} key={category.id} label={category.name} onPress={() => setCategoryId(category.id)} />
              ))}
            </ScrollView>

            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.menuHeader}>
              <View>
                <Text style={styles.eyebrow}>MENU</Text>
                <Text style={styles.sectionTitle}>Elige tus platos</Text>
              </View>
              <View style={styles.countPill}>
                <Text style={styles.countText}>{visibleProducts.length}</Text>
              </View>
            </View>
          </>
        }
        contentContainerStyle={styles.content}
        data={visibleProducts}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <FadeInView delay={Math.min(index * 45, 180)}>
            <ProductCard
              onAdd={() => updateQuantity(item, 1)}
              onPress={() => setSelectedProduct(item)}
              product={item}
              quantity={cart[item.id]?.quantity ?? 0}
            />
          </FadeInView>
        )}
        ListEmptyComponent={<EmptyMessage description="Cuando el local agregue productos disponibles apareceran aqui." title="Menu vacio" />}
      />

      {cartItems.length ? <FloatingCart count={cartCount} onPress={() => setCartOpen(true)} total={cartTotal} /> : null}
      {selectedProduct ? (
        <ProductDetailModal
          onChangeQuantity={(delta) => updateQuantity(selectedProduct, delta)}
          onClose={() => setSelectedProduct(null)}
          product={selectedProduct}
          quantity={cart[selectedProduct.id]?.quantity ?? 0}
        />
      ) : null}
      {cartOpen ? <CartSheet items={cartItems} onChangeQuantity={updateQuantity} onClose={() => setCartOpen(false)} total={cartTotal} /> : null}
    </SafeAreaView>
  );
}

function AnimatedPulse() {
  const scale = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { duration: 720, toValue: 1.06, useNativeDriver: true }),
        Animated.timing(scale, { duration: 720, toValue: 0.92, useNativeDriver: true }),
      ]),
    ).start();
  }, [scale]);

  return (
    <Animated.Image
      resizeMode="contain"
      source={require("../../assets/yopido-logo-dark.png")}
      style={[styles.loadingLogo, { transform: [{ scale }] }]}
    />
  );
}

function CategoryChip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.categoryChip, active && styles.categoryChipActive, pressed && styles.pressed]}>
      <Text style={[styles.categoryText, active && styles.categoryTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ProductCard({
  product,
  quantity,
  onAdd,
  onPress,
}: {
  product: ProductSummary;
  quantity: number;
  onAdd: () => void;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.productCard, quantity > 0 && styles.productCardSelected, pressed && styles.pressed]}>
      <ImageBackground source={product.imageUrl ? { uri: product.imageUrl } : defaultBanner} style={styles.productImage} imageStyle={styles.productImageRadius}>
        {quantity > 0 ? (
          <View style={styles.quantityBadge}>
            <Text style={styles.quantityBadgeText}>{quantity}</Text>
          </View>
        ) : null}
      </ImageBackground>
      <View style={styles.productBody}>
        <Text numberOfLines={1} style={styles.productName}>
          {product.name}
        </Text>
        <Text numberOfLines={2} style={styles.productDescription}>
          {product.description || "Listo para agregar a tu pedido."}
        </Text>
        <Text style={styles.productPrice}>Bs {product.price.toFixed(2)}</Text>
      </View>
      <Pressable onPress={onAdd} style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}>
        <Plus color={colors.blue} size={24} strokeWidth={4} />
      </Pressable>
    </Pressable>
  );
}

function ProductDetailModal({
  product,
  quantity,
  onChangeQuantity,
  onClose,
}: {
  product: ProductSummary;
  quantity: number;
  onChangeQuantity: (delta: number) => void;
  onClose: () => void;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, { duration: 260, toValue: 1, useNativeDriver: true }).start();
  }, [progress]);

  return (
    <Modal transparent animationType="none" statusBarTranslucent visible>
      <Animated.View style={[styles.modalOverlay, { opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View
          style={[
            styles.productSheet,
            {
              transform: [
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [80, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <ImageBackground source={product.imageUrl ? { uri: product.imageUrl } : defaultBanner} style={styles.sheetImage} imageStyle={styles.sheetImageRadius}>
            <LinearGradient colors={["rgba(8,36,65,0)", "rgba(8,36,65,0.72)"]} style={styles.sheetImageOverlay}>
              <IconButton light onPress={onClose}>
                <X color={colors.blue} size={22} strokeWidth={3} />
              </IconButton>
            </LinearGradient>
          </ImageBackground>
          <View style={styles.sheetBody}>
            <Text style={styles.sheetTitle}>{product.name}</Text>
            <Text style={styles.sheetDescription}>{product.description || "Producto disponible para tu pedido."}</Text>
            <View style={styles.sheetBottom}>
              <View>
                <Text style={styles.priceLabel}>Precio</Text>
                <Text style={styles.sheetPrice}>Bs {product.price.toFixed(2)}</Text>
              </View>
              <QuantityControl onMinus={() => onChangeQuantity(-1)} onPlus={() => onChangeQuantity(1)} quantity={quantity} />
            </View>
            <PillButton
              onPress={() => {
                if (quantity === 0) {
                  onChangeQuantity(1);
                }
                onClose();
              }}
              variant="dark"
            >
              {quantity ? "Listo" : "Agregar al pedido"}
            </PillButton>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

function FloatingCart({ count, total, onPress }: { count: number; total: number; onPress: () => void }) {
  const scale = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    Animated.spring(scale, { friction: 7, tension: 120, toValue: 1, useNativeDriver: true }).start();
  }, [count, scale]);

  return (
    <Animated.View style={[styles.cartBar, { transform: [{ scale }] }]}>
      <Pressable onPress={onPress} style={styles.cartPressable}>
        <View style={styles.cartIcon}>
          <ShoppingBag color={colors.blue} size={22} strokeWidth={3} />
        </View>
        <View style={styles.cartInfo}>
          <Text style={styles.cartLabel}>{count} productos</Text>
          <Text style={styles.cartTotal}>Bs {total.toFixed(2)}</Text>
        </View>
        <View style={styles.cartAction}>
          <Text style={styles.cartActionText}>Ver pedido</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function CartSheet({
  items,
  total,
  onChangeQuantity,
  onClose,
}: {
  items: CartLine[];
  total: number;
  onChangeQuantity: (product: ProductSummary, delta: number) => void;
  onClose: () => void;
}) {
  return (
    <Modal transparent animationType="slide" statusBarTranslucent visible>
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.cartSheet}>
          <View style={styles.cartSheetHeader}>
            <View>
              <Text style={styles.eyebrow}>CARRITO</Text>
              <Text style={styles.cartSheetTitle}>Tu pedido</Text>
            </View>
            <IconButton light onPress={onClose}>
              <X color={colors.blue} size={22} strokeWidth={3} />
            </IconButton>
          </View>

          <View style={styles.cartLines}>
            {items.map((item) => (
              <View style={styles.cartLine} key={item.id}>
                <View style={styles.cartLineBody}>
                  <Text numberOfLines={1} style={styles.cartLineTitle}>
                    {item.name}
                  </Text>
                  <Text style={styles.cartLinePrice}>Bs {(item.price * item.quantity).toFixed(2)}</Text>
                </View>
                <QuantityControl onMinus={() => onChangeQuantity(item, -1)} onPlus={() => onChangeQuantity(item, 1)} quantity={item.quantity} compact />
              </View>
            ))}
          </View>

          <View style={styles.checkoutSummary}>
            <Text style={styles.checkoutLabel}>Total</Text>
            <Text style={styles.checkoutTotal}>Bs {total.toFixed(2)}</Text>
          </View>
          <PillButton variant="dark">Continuar con datos de envio</PillButton>
        </View>
      </View>
    </Modal>
  );
}

function QuantityControl({
  quantity,
  onMinus,
  onPlus,
  compact = false,
}: {
  quantity: number;
  onMinus: () => void;
  onPlus: () => void;
  compact?: boolean;
}) {
  return (
    <View style={[styles.qtyControl, compact && styles.qtyControlCompact]}>
      <Pressable disabled={quantity === 0} onPress={onMinus} style={({ pressed }) => [styles.qtyButton, quantity === 0 && styles.qtyButtonDisabled, pressed && styles.pressed]}>
        <Minus color={quantity === 0 ? colors.muted : colors.blue} size={compact ? 16 : 20} strokeWidth={4} />
      </Pressable>
      <Text style={styles.qtyText}>{quantity}</Text>
      <Pressable onPress={onPlus} style={({ pressed }) => [styles.qtyButton, styles.qtyButtonPlus, pressed && styles.pressed]}>
        <Plus color={colors.blue} size={compact ? 16 : 20} strokeWidth={4} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  addButton: {
    alignItems: "center",
    backgroundColor: colors.green,
    borderRadius: 999,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  banner: {
    height: 318,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  bannerImage: {
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  bannerMetrics: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 16,
  },
  bannerOverlay: {
    flex: 1,
    justifyContent: "space-between",
    padding: 18,
  },
  bannerTop: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  cartAction: {
    backgroundColor: colors.green,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  cartActionText: {
    color: colors.blue,
    fontSize: 13,
    fontWeight: "900",
  },
  cartBar: {
    bottom: 16,
    left: 14,
    position: "absolute",
    right: 14,
  },
  cartIcon: {
    alignItems: "center",
    backgroundColor: colors.green,
    borderRadius: 16,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  cartInfo: {
    flex: 1,
  },
  cartLabel: {
    color: "#FFFFFFAA",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  cartLine: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: 18,
    flexDirection: "row",
    gap: 12,
    padding: 12,
  },
  cartLineBody: {
    flex: 1,
    minWidth: 0,
  },
  cartLinePrice: {
    color: colors.blue,
    fontSize: 14,
    fontWeight: "900",
    marginTop: 4,
  },
  cartLineTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "900",
  },
  cartLines: {
    gap: 10,
    marginTop: 18,
  },
  cartPressable: {
    alignItems: "center",
    backgroundColor: colors.blue,
    borderRadius: 24,
    flexDirection: "row",
    gap: 12,
    minHeight: 74,
    padding: 14,
    shadowColor: "#082441",
    shadowOffset: { height: 14, width: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 22,
  },
  cartSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    bottom: 0,
    left: 0,
    maxHeight: "82%",
    padding: 18,
    position: "absolute",
    right: 0,
  },
  cartSheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  cartSheetTitle: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: "900",
  },
  cartTotal: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "900",
  },
  categoryChip: {
    backgroundColor: "#FFFFFF",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 17,
    paddingVertical: 12,
  },
  categoryChipActive: {
    backgroundColor: colors.blue,
    borderColor: colors.blue,
  },
  categoryRail: {
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 18,
  },
  categoryText: {
    color: colors.blue,
    fontSize: 13,
    fontWeight: "900",
  },
  categoryTextActive: {
    color: "#FFFFFF",
  },
  checkoutLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  checkoutSummary: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 18,
    paddingBottom: 14,
    paddingTop: 16,
  },
  checkoutTotal: {
    color: colors.blue,
    fontSize: 24,
    fontWeight: "900",
  },
  content: {
    gap: 12,
    paddingBottom: 120,
  },
  countPill: {
    alignItems: "center",
    backgroundColor: colors.green,
    borderRadius: 999,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  countText: {
    color: colors.blue,
    fontSize: 15,
    fontWeight: "900",
  },
  dot: {
    backgroundColor: colors.green,
    borderRadius: 999,
    height: 5,
    width: 5,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "800",
    marginHorizontal: 18,
  },
  eyebrow: {
    color: colors.green,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 3,
  },
  livePill: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.green,
    borderRadius: 999,
    flexDirection: "row",
    gap: 6,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  liveText: {
    color: colors.blue,
    fontSize: 12,
    fontWeight: "900",
  },
  loading: {
    alignItems: "center",
    backgroundColor: colors.blue,
    flex: 1,
    justifyContent: "center",
  },
  loadingLogo: {
    height: 82,
    width: 240,
  },
  loadingText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
    marginTop: 12,
  },
  menuHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 18,
  },
  metricPill: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
  },
  metricText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
  },
  modalOverlay: {
    backgroundColor: "rgba(8,36,65,0.56)",
    flex: 1,
    justifyContent: "flex-end",
  },
  page: {
    backgroundColor: colors.background,
    flex: 1,
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.985 }],
  },
  priceLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  productBody: {
    flex: 1,
    minWidth: 0,
  },
  productCard: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    marginHorizontal: 18,
    padding: 12,
    shadowColor: "#12355B",
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
  },
  productCardSelected: {
    borderColor: colors.green,
    borderWidth: 2,
  },
  productDescription: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 4,
  },
  productImage: {
    height: 72,
    justifyContent: "flex-start",
    overflow: "hidden",
    width: 72,
  },
  productImageRadius: {
    borderRadius: 18,
  },
  productName: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: "900",
  },
  productPrice: {
    color: colors.blue,
    fontSize: 16,
    fontWeight: "900",
    marginTop: 8,
  },
  productSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    overflow: "hidden",
  },
  quantityBadge: {
    alignItems: "center",
    alignSelf: "flex-end",
    backgroundColor: colors.green,
    borderRadius: 999,
    height: 26,
    justifyContent: "center",
    margin: 6,
    width: 26,
  },
  quantityBadgeText: {
    color: colors.blue,
    fontSize: 12,
    fontWeight: "900",
  },
  qtyButton: {
    alignItems: "center",
    backgroundColor: colors.softBlue,
    borderRadius: 999,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  qtyButtonDisabled: {
    opacity: 0.45,
  },
  qtyButtonPlus: {
    backgroundColor: colors.green,
  },
  qtyControl: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  qtyControlCompact: {
    gap: 8,
  },
  qtyText: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "900",
    minWidth: 22,
    textAlign: "center",
  },
  restaurantName: {
    color: "#FFFFFF",
    fontSize: 38,
    fontWeight: "900",
    lineHeight: 42,
  },
  restaurantSubtitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 21,
    marginTop: 8,
    maxWidth: 330,
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 30,
    fontWeight: "900",
    marginTop: 2,
  },
  sheetBody: {
    gap: 16,
    padding: 18,
  },
  sheetBottom: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sheetDescription: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 22,
  },
  sheetImage: {
    height: 260,
  },
  sheetImageOverlay: {
    alignItems: "flex-end",
    flex: 1,
    justifyContent: "flex-start",
    padding: 16,
  },
  sheetImageRadius: {
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
  },
  sheetPrice: {
    color: colors.blue,
    fontSize: 25,
    fontWeight: "900",
  },
  sheetTitle: {
    color: colors.ink,
    fontSize: 27,
    fontWeight: "900",
    lineHeight: 31,
  },
});
