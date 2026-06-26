import React from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const PRIMARY = "#9B1C31";

type ScreenHeaderProps = {
  children: React.ReactNode;
};

/**
 * App header bar in the SFU primary color that extends behind the status bar
 * so it sits flush with the top of the screen. Header content (text/icons)
 * should be white to stay legible on the red background.
 */
export default function ScreenHeader({ children }: ScreenHeaderProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <View style={styles.row}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: PRIMARY,
    paddingHorizontal: 20,
  },
  row: {
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
