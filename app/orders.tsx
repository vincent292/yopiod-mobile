import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { EmptyMessage, PillButton, colors } from "../src/components/ui";

export default function OrdersScreen() {
  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.content}>
        <EmptyMessage description="Aqui mostraremos historial, tracking y estado en tiempo real cuando conectemos pedidos autenticados." title="Mis pedidos" />
        <PillButton onPress={() => router.back()}>Volver a pedir</PillButton>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    padding: 18,
  },
  page: {
    backgroundColor: colors.background,
    flex: 1,
  },
});
