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
```

`EXPO_PUBLIC_API_BASE_URL` queda incluida dentro del APK al compilar. Si pruebas contra una web local, usa una URL que el celular pueda abrir (por ejemplo un dominio/tunel HTTPS o la IP LAN correcta) y vuelve a generar/instalar el APK.

Nunca uses `SUPABASE_SERVICE_ROLE_KEY` en la app movil.

## Comandos

```bash
npm run start
npm run android
npm run typecheck
```
