import { StyleSheet, Text, View } from "react-native";
export default function HomeScreen() {
  return (
    <View
      style={styles.page}
    >
      <Text>Home Page</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: "center",
    // backgroundColor: "gray"
  }
});
