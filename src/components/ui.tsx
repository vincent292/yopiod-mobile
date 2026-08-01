import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { Animated, Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";

export const colors = {
  blue: "#12355B",
  blueDark: "#082441",
  green: "#B7FF00",
  ink: "#111827",
  muted: "#667085",
  border: "#E4E9F0",
  surface: "#FFFFFF",
  background: "#F5F7FA",
  softBlue: "#EEF3F8",
  danger: "#B42318",
};

export function BrandHeader({ children }: { children?: ReactNode }) {
  return (
    <View style={styles.header}>
      <Image resizeMode="contain" source={require("../../assets/yopido-logo-dark.png")} style={styles.logo} />
      {children}
    </View>
  );
}

export function PillButton({
  children,
  onPress,
  variant = "primary",
}: {
  children: ReactNode;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "dark";
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        variant === "secondary" && styles.pillSecondary,
        variant === "dark" && styles.pillDark,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.pillText, variant === "secondary" && styles.pillTextSecondary, variant === "dark" && styles.pillTextDark]}>{children}</Text>
    </Pressable>
  );
}

export function IconButton({ children, onPress, light = false }: { children: ReactNode; onPress?: () => void; light?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.iconButton, light && styles.iconButtonLight, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

export function EmptyMessage({ title, description }: { title: string; description: string }) {
  return (
    <View style={styles.empty}>
      <Image resizeMode="contain" source={require("../../assets/yopido-icon-dark-1024.png")} style={styles.emptyIcon} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDescription}>{description}</Text>
    </View>
  );
}

export function FadeInView({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: object }) {
  const progress = useRef(new Animated.Value(Platform.OS === "web" ? 1 : 0)).current;

  useEffect(() => {
    if (Platform.OS === "web") return;
    Animated.timing(progress, {
      delay,
      duration: 420,
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [delay, progress]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [16, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    padding: 24,
  },
  emptyDescription: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "700",
    marginTop: 8,
    textAlign: "center",
  },
  emptyIcon: {
    height: 54,
    marginBottom: 10,
    width: 54,
  },
  emptyTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "900",
  },
  header: {
    backgroundColor: colors.blue,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    paddingBottom: 22,
    paddingHorizontal: 18,
    paddingTop: 16,
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: 999,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  iconButtonLight: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  logo: {
    height: 44,
    width: 184,
  },
  pill: {
    alignItems: "center",
    backgroundColor: colors.green,
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 18,
  },
  pillDark: {
    backgroundColor: colors.blue,
  },
  pillSecondary: {
    backgroundColor: colors.softBlue,
  },
  pillText: {
    color: colors.blue,
    fontSize: 14,
    fontWeight: "900",
  },
  pillTextDark: {
    color: "#FFFFFF",
  },
  pillTextSecondary: {
    color: colors.blue,
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.98 }],
  },
});
