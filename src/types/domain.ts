export type UserLocation = {
  latitude: number;
  longitude: number;
  city?: string;
};

export type RestaurantSummary = {
  id: string;
  name: string;
  slug: string;
  description: string;
  city: string;
  address: string;
  businessType: string;
  logoUrl: string;
  bannerUrl: string;
  latitude?: number;
  longitude?: number;
  distanceKm?: number;
  visits7d: number;
  orders30d: number;
  popularProducts: string[];
};

export type BusinessHour = {
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
  isClosed: boolean;
};

export type CategorySummary = {
  id: string;
  name: string;
  description: string;
};

export type ProductSummary = {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  isFeatured: boolean;
  orderCount: number;
  variants: ProductVariantSummary[];
  optionGroups: ProductOptionGroupSummary[];
};

export type ProductVariantSummary = {
  id: string;
  name: string;
  description: string;
  priceDelta: number;
};

export type ProductOptionSummary = {
  id: string;
  name: string;
  description: string;
  priceDelta: number;
};

export type ProductOptionGroupSummary = {
  id: string;
  name: string;
  description: string;
  minChoices: number;
  maxChoices: number;
  isRequired: boolean;
  options: ProductOptionSummary[];
};

export type PopularProductSummary = {
  id: string;
  restaurantId: string;
  restaurantName: string;
  restaurantSlug: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  orderCount: number;
};

export type HomeDirectory = {
  activeCity: string;
  restaurants: RestaurantSummary[];
  mostVisited: RestaurantSummary[];
  mostOrderedRestaurants: RestaurantSummary[];
  mostOrderedProducts: PopularProductSummary[];
  productSuggestions: PopularProductSummary[];
};
