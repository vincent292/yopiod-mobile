module.exports = ({ config }) => {
  const androidGoogleMapsApiKey =
    process.env.GOOGLE_MAPS_ANDROID_API_KEY ??
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY ??
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

  return {
    ...config,
    plugins: (config.plugins ?? []).map((plugin) => {
      if (!Array.isArray(plugin) || plugin[0] !== "react-native-maps") {
        return plugin;
      }

      return [
        "react-native-maps",
        {
          ...(plugin[1] ?? {}),
          ...(androidGoogleMapsApiKey ? { androidGoogleMapsApiKey } : {}),
        },
      ];
    }),
  };
};
