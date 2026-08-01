export const config = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://www.yopido.shop",
  easProjectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? "",
  googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "",
};

export const isSupabaseConfigured = Boolean(config.supabaseUrl && config.supabasePublishableKey);
