import { CameraView, useCameraPermissions } from "expo-camera";
import type { BarcodeScanningResult } from "expo-camera";
import { ScanLine, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { IconButton, colors } from "../../components/ui";
import { parseGroupInvite } from "../../lib/group-invites";
import type { GroupInviteTarget } from "../../lib/group-invites";

export function GroupQrScannerModal({
  fallbackRestaurantSlug,
  onClose,
  onScanned,
}: {
  fallbackRestaurantSlug?: string;
  onClose: () => void;
  onScanned: (target: GroupInviteTarget) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission?.granted, permission?.canAskAgain, requestPermission]);

  function handleBarcodeScanned(result: BarcodeScanningResult) {
    if (scanned) return;
    const target = parseGroupInvite(result.data);
    if (!target) {
      setError("Este QR no parece ser de un Yopido Grupal.");
      setScanned(true);
      setTimeout(() => setScanned(false), 1400);
      return;
    }

    onScanned({
      restaurantSlug: target.restaurantSlug ?? fallbackRestaurantSlug,
      sessionToken: target.sessionToken,
    });
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible>
      <View style={styles.overlay}>
        <SafeAreaView edges={["top", "bottom"]} style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text style={styles.eyebrow}>Yopido Grupal</Text>
              <Text style={styles.title}>Escanear QR</Text>
            </View>
            <IconButton light onPress={onClose}><X color={colors.blue} size={22} strokeWidth={3} /></IconButton>
          </View>

          <View style={styles.cameraWrap}>
            {permission?.granted ? (
              <CameraView
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                facing="back"
                onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
                style={styles.camera}
              />
            ) : (
              <View style={styles.permissionBox}>
                <ScanLine color={colors.blue} size={34} strokeWidth={2.8} />
                <Text style={styles.permissionTitle}>Permiso de camara</Text>
                <Text style={styles.permissionText}>Activa la camara para leer el QR de la sala grupal.</Text>
                <Pressable onPress={requestPermission} style={({ pressed }) => [styles.permissionButton, pressed && styles.pressed]}>
                  <Text style={styles.permissionButtonText}>Permitir camara</Text>
                </Pressable>
              </View>
            )}
            {permission?.granted ? (
              <View pointerEvents="none" style={styles.frame}>
                <View style={styles.frameCornerTopLeft} />
                <View style={styles.frameCornerTopRight} />
                <View style={styles.frameCornerBottomLeft} />
                <View style={styles.frameCornerBottomRight} />
              </View>
            ) : null}
          </View>

          <Text style={styles.hint}>Apunta al QR del Yopido Grupal. Tambien acepta links compartidos desde la web.</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const cornerBase = {
  borderRadius: 7,
  height: 42,
  position: "absolute" as const,
  width: 42,
};

const styles = StyleSheet.create({
  camera: { height: "100%", width: "100%" },
  cameraWrap: { backgroundColor: "#081B2F", borderRadius: 24, height: 360, marginTop: 16, overflow: "hidden", position: "relative" },
  error: { color: colors.danger, fontSize: 13, fontWeight: "900", lineHeight: 18, marginTop: 10, textAlign: "center" },
  eyebrow: { color: colors.green, fontSize: 12, fontWeight: "900", letterSpacing: 3, textTransform: "uppercase" },
  frame: { borderColor: "rgba(255,255,255,0.22)", borderRadius: 26, borderWidth: 1, height: 220, left: "50%", marginLeft: -110, marginTop: -110, position: "absolute", top: "50%", width: 220 },
  frameCornerBottomLeft: { ...cornerBase, borderBottomColor: colors.green, borderBottomWidth: 5, borderLeftColor: colors.green, borderLeftWidth: 5, bottom: -1, left: -1 },
  frameCornerBottomRight: { ...cornerBase, borderBottomColor: colors.green, borderBottomWidth: 5, borderRightColor: colors.green, borderRightWidth: 5, bottom: -1, right: -1 },
  frameCornerTopLeft: { ...cornerBase, borderLeftColor: colors.green, borderLeftWidth: 5, borderTopColor: colors.green, borderTopWidth: 5, left: -1, top: -1 },
  frameCornerTopRight: { ...cornerBase, borderRightColor: colors.green, borderRightWidth: 5, borderTopColor: colors.green, borderTopWidth: 5, right: -1, top: -1 },
  header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  hint: { color: colors.muted, fontSize: 12, fontWeight: "800", lineHeight: 18, marginTop: 12, textAlign: "center" },
  overlay: { backgroundColor: "rgba(8,36,65,0.64)", flex: 1, justifyContent: "flex-end" },
  permissionBox: { alignItems: "center", backgroundColor: colors.surface, flex: 1, gap: 10, justifyContent: "center", padding: 24 },
  permissionButton: { alignItems: "center", backgroundColor: colors.green, borderRadius: 999, justifyContent: "center", minHeight: 46, paddingHorizontal: 18 },
  permissionButtonText: { color: colors.blue, fontSize: 13, fontWeight: "900" },
  permissionText: { color: colors.muted, fontSize: 13, fontWeight: "800", lineHeight: 19, textAlign: "center" },
  permissionTitle: { color: colors.ink, fontSize: 19, fontWeight: "900" },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 18 },
  title: { color: colors.ink, fontSize: 24, fontWeight: "900", marginTop: 2 },
});
