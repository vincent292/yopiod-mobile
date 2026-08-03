# yopido.shop mobile

App movil de cliente final para Android/iOS. Este proyecto no contiene paneles administrativos; solo experiencia de pedidos.

## Stack

- Expo React Native
- Expo Router
- Supabase Auth/Data
- AsyncStorage para persistir sesion
- Expo Location para cercania

## Variables

Copia `.env.example` a `.env.local` y usa solo llaves publicas:

```bash
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
EXPO_PUBLIC_API_BASE_URL=https://www.yopido.shop
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=
GOOGLE_MAPS_ANDROID_API_KEY=
```

`EXPO_PUBLIC_API_BASE_URL` queda incluida dentro del APK al compilar. Si pruebas contra una web local, usa una URL que el celular pueda abrir (por ejemplo un dominio/tunel HTTPS o la IP LAN correcta) y vuelve a generar/instalar el APK.

Para que Google Maps no salga negro en APK/build Android:

- Habilita `Maps SDK for Android` en Google Cloud.
- La API key debe tener restriccion de aplicacion `Android apps`, no `Websites`.
- Registra el package `shop.yopido.app` y el SHA-1 del certificado que firma ese APK.
- Usa esa key en `GOOGLE_MAPS_ANDROID_API_KEY` al compilar. Si no existe, el build usa `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`.
- Si cambias la key, restricciones o certificado, vuelve a generar e instalar el APK.

Las restricciones de dominios como `yopido.shop`, Vercel o localhost solo aplican a APIs web; no autorizan el mapa nativo de Android.

Nunca uses `SUPABASE_SERVICE_ROLE_KEY` en la app movil.

## Comandos

```bash
npm run start
npm run android
npm run typecheck
```
