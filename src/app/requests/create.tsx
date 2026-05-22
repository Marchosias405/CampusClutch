import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
    Image,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";

type RequestType = "Delivery" | "Event Help" | "Study Help" | "Pickup";
type ItemSize = "Small" | "Medium" | "Large";

const COLORS = {
  primary: "#9B1C31",
  darkRed: "#8F1428",
  background: "#FFF7F6",
  cardWhite: "#FFFFFF",
  textDark: "#2B2525",
  mutedText: "#8C8585",
  border: "#EFE1E1",
  inactiveGray: "#A5AAB3",
  safetyBox: "#FFF0F0",
  coinGold: "#F4A62A",
};

const requestTypes: {
  id: RequestType;
  label: string;
  icon: string;
}[] = [
  {
    id: "Delivery",
    label: "Delivery",
    icon: "truck",
  },
  {
    id: "Event Help",
    label: "Event Help",
    icon: "hands-helping",
  },
  {
    id: "Study Help",
    label: "Study Help",
    icon: "graduation-cap",
  },
];

const itemSizes: ItemSize[] = ["Small", "Medium", "Large"];

export default function CreateRequestScreen() {
  const router = useRouter();

  const [selectedRequestType, setSelectedRequestType] =
    useState<RequestType>("Delivery");
  const [requestTitle, setRequestTitle] = useState("");
  const [campus, setCampus] = useState("Burnaby");
  const [roomLocation, setRoomLocation] = useState("");
  const [pickupLocation, setPickupLocation] = useState("");
  const [dropoffLocation, setDropoffLocation] = useState("");
  const [itemSize, setItemSize] = useState<ItemSize>("Medium");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [pointsOffered, setPointsOffered] = useState("50");

  const handleBack = () => {
    router.back();
  };

  const handleRequestTypeChange = (type: RequestType) => {
    setSelectedRequestType(type);
  };

  const handleSizeChange = (size: ItemSize) => {
    setItemSize(size);
  };

  const handleSubmit = () => {
    // Lightweight validation placeholder:
    // Later, check required fields before sending to backend.
    const formData = {
      selectedRequestType,
      requestTitle,
      campus,
      roomLocation,
      pickupLocation,
      dropoffLocation,
      itemSize,
      description,
      deadline,
      pointsOffered,
    };

    console.log("New request submitted:", formData);

    router.back();
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={handleBack}>
            <Ionicons name="arrow-back" size={24} color={COLORS.primary} />
          </Pressable>

          <Text style={styles.headerTitle}>New Request</Text>

          <Image
            source={{
              uri: "https://api.dicebear.com/7.x/personas/png?seed=CampusUser",
            }}
            style={styles.headerAvatar}
          />
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.sectionTitle}>Request Type</Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.requestTypesRow}
          >
            {requestTypes.map((type) => {
              const isActive = selectedRequestType === type.id;

              return (
                <Pressable
                  key={type.id}
                  style={[
                    styles.requestTypeCard,
                    isActive && styles.activeRequestTypeCard,
                  ]}
                  onPress={() => handleRequestTypeChange(type.id)}
                >
                  <FontAwesome5
                    name={type.icon}
                    size={24}
                    color={isActive ? COLORS.primary : COLORS.mutedText}
                  />

                  <Text
                    style={[
                      styles.requestTypeLabel,
                      isActive && styles.activeRequestTypeLabel,
                    ]}
                  >
                    {type.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.formGroup}>
            <Text style={styles.inputLabel}>Request Title</Text>
            <TextInput
              value={requestTitle}
              onChangeText={setRequestTitle}
              placeholder="e.g., Tim Hortons Coffee Delivery to Librar"
              placeholderTextColor={COLORS.inactiveGray}
              style={styles.textInput}
            />
          </View>

          <View style={styles.twoColumnRow}>
            <View style={styles.columnField}>
              <Text style={styles.inputLabel}>Campus</Text>

              <Pressable style={styles.selectorInput}>
                <Text style={styles.selectorText}>{campus}</Text>
                <Ionicons
                  name="chevron-down"
                  size={18}
                  color={COLORS.inactiveGray}
                />
              </Pressable>
            </View>

            <View style={styles.columnField}>
              <Text style={styles.inputLabel}>Room/Specific Location</Text>

              <TextInput
                value={roomLocation}
                onChangeText={setRoomLocation}
                placeholder="e.g., Room 3002"
                placeholderTextColor={COLORS.inactiveGray}
                style={styles.textInput}
              />
            </View>
          </View>

          {selectedRequestType === "Delivery" && (
            <View style={styles.detailsCard}>
              <View style={styles.detailsHeader}>
                <Ionicons
                  name="information-circle"
                  size={18}
                  color={COLORS.primary}
                />
                <Text style={styles.detailsTitle}>Delivery Details</Text>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Pickup Location</Text>

                <View style={styles.iconInputWrap}>
                  <Ionicons
                    name="location-sharp"
                    size={20}
                    color={COLORS.mutedText}
                    style={styles.inputLeftIcon}
                  />

                  <TextInput
                    value={pickupLocation}
                    onChangeText={setPickupLocation}
                    placeholder="e.g., AQ Tim Hortons"
                    placeholderTextColor={COLORS.inactiveGray}
                    style={styles.iconTextInput}
                  />
                </View>
              </View>

              <View style={styles.formGroupLast}>
                <Text style={styles.inputLabel}>Drop-off Location</Text>

                <View style={styles.iconInputWrap}>
                  <Ionicons
                    name="navigate"
                    size={20}
                    color={COLORS.primary}
                    style={styles.inputLeftIcon}
                  />

                  <TextInput
                    value={dropoffLocation}
                    onChangeText={setDropoffLocation}
                    placeholder="e.g., WMC Study Area"
                    placeholderTextColor={COLORS.inactiveGray}
                    style={styles.iconTextInput}
                  />
                </View>
              </View>
            </View>
          )}

          <View style={styles.formGroup}>
            <Text style={styles.inputLabel}>Item/Task Size</Text>

            <View style={styles.sizeRow}>
              {itemSizes.map((size) => {
                const isActive = itemSize === size;

                return (
                  <Pressable
                    key={size}
                    style={[styles.sizeButton, isActive && styles.activeSizeButton]}
                    onPress={() => handleSizeChange(size)}
                  >
                    <Text
                      style={[
                        styles.sizeButtonText,
                        isActive && styles.activeSizeButtonText,
                      ]}
                    >
                      {size}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.inputLabel}>Description</Text>

            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Tell us more about what you need..."
              placeholderTextColor={COLORS.inactiveGray}
              style={styles.descriptionInput}
              multiline
              textAlignVertical="top"
            />
          </View>

          <View style={styles.twoColumnRow}>
            <View style={styles.columnField}>
              <Text style={styles.inputLabel}>Deadline</Text>

              <View style={styles.iconInputWrapSmall}>
                <TextInput
                  value={deadline}
                  onChangeText={setDeadline}
                  placeholder="ASAP or Time"
                  placeholderTextColor={COLORS.inactiveGray}
                  style={styles.smallIconInput}
                />

                <Ionicons
                  name="calendar"
                  size={19}
                  color={COLORS.mutedText}
                  style={styles.inputRightIcon}
                />
              </View>
            </View>

            <View style={styles.columnField}>
              <Text style={styles.inputLabel}>Points Offered</Text>

              <View style={styles.iconInputWrapSmall}>
                <FontAwesome5
                  name="coins"
                  size={16}
                  color={COLORS.coinGold}
                  style={styles.coinIcon}
                />

                <TextInput
                  value={pointsOffered}
                  onChangeText={setPointsOffered}
                  keyboardType="number-pad"
                  placeholder="50"
                  placeholderTextColor={COLORS.textDark}
                  style={styles.pointsInput}
                />
              </View>
            </View>
          </View>

          <View style={styles.safetyBox}>
            <Ionicons
              name="shield-checkmark"
              size={18}
              color="#8D6F6F"
              style={styles.safetyIcon}
            />

            <Text style={styles.safetyText}>
              Always meet in well-lit, public campus areas. SFU security is
              available 24/7 if you feel unsafe. Never share personal sensitive
              information.
            </Text>
          </View>

          <Pressable style={styles.submitButton} onPress={handleSubmit}>
            <Text style={styles.submitButtonText}>Post Request</Text>
            <Ionicons
              name="arrow-forward"
              size={22}
              color={COLORS.cardWhite}
              style={styles.submitIcon}
            />
          </Pressable>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  screen: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  header: {
    height: 58,
    paddingHorizontal: 18,
    backgroundColor: COLORS.cardWhite,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    flexDirection: "row",
    alignItems: "center",
  },

  backButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4,
  },

  headerTitle: {
    flex: 1,
    fontSize: 19,
    fontWeight: "900",
    color: COLORS.primary,
  },

  headerAvatar: {
    width: 31,
    height: 31,
    borderRadius: 16,
  },

  scrollView: {
    flex: 1,
  },

  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 32,
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: COLORS.textDark,
    marginBottom: 12,
  },

  requestTypesRow: {
    paddingBottom: 22,
  },

  requestTypeCard: {
    width: 102,
    height: 118,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.cardWhite,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },

  activeRequestTypeCard: {
    borderWidth: 2,
    borderColor: COLORS.primary,
  },

  requestTypeLabel: {
    marginTop: 14,
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.mutedText,
  },

  activeRequestTypeLabel: {
    color: COLORS.primary,
  },

  formGroup: {
    marginBottom: 15,
  },

  formGroupLast: {
    marginBottom: 0,
  },

  inputLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: "#766E6E",
    marginBottom: 8,
  },

  textInput: {
    height: 47,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#E8CFCF",
    backgroundColor: COLORS.cardWhite,
    paddingHorizontal: 14,
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.textDark,
  },

  twoColumnRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 15,
  },

  columnField: {
    flex: 1,
  },

  selectorInput: {
    height: 47,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#E8CFCF",
    backgroundColor: COLORS.cardWhite,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  selectorText: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textDark,
  },

  detailsCard: {
    borderRadius: 12,
    backgroundColor: COLORS.cardWhite,
    borderWidth: 1,
    borderColor: "#F1DADA",
    paddingHorizontal: 16,
    paddingVertical: 15,
    marginBottom: 17,
  },

  detailsHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },

  detailsTitle: {
    marginLeft: 7,
    fontSize: 16,
    fontWeight: "900",
    color: "#B45B67",
  },

  iconInputWrap: {
    height: 47,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#E8CFCF",
    backgroundColor: COLORS.cardWhite,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
  },

  inputLeftIcon: {
    marginRight: 8,
  },

  iconTextInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.textDark,
  },

  sizeRow: {
    flexDirection: "row",
    gap: 10,
  },

  sizeButton: {
    flex: 1,
    height: 47,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#E8CFCF",
    backgroundColor: COLORS.cardWhite,
    alignItems: "center",
    justifyContent: "center",
  },

  activeSizeButton: {
    borderColor: COLORS.primary,
  },

  sizeButtonText: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.mutedText,
  },

  activeSizeButtonText: {
    color: COLORS.primary,
  },

  descriptionInput: {
    minHeight: 86,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#E8CFCF",
    backgroundColor: COLORS.cardWhite,
    paddingHorizontal: 14,
    paddingTop: 13,
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.textDark,
  },

  iconInputWrapSmall: {
    height: 47,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#E8CFCF",
    backgroundColor: COLORS.cardWhite,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
  },

  smallIconInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textDark,
  },

  inputRightIcon: {
    marginLeft: 7,
  },

  coinIcon: {
    marginRight: 8,
  },

  pointsInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.textDark,
  },

  safetyBox: {
    borderRadius: 10,
    backgroundColor: COLORS.safetyBox,
    borderWidth: 1,
    borderColor: "#F0CCCC",
    paddingHorizontal: 13,
    paddingVertical: 12,
    flexDirection: "row",
    marginBottom: 20,
  },

  safetyIcon: {
    marginRight: 9,
    marginTop: 1,
  },

  safetyText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    color: "#8D6F6F",
  },

  submitButton: {
    height: 55,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: COLORS.primary,
    shadowOffset: {
      width: 0,
      height: 5,
    },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },

  submitButtonText: {
    fontSize: 18,
    fontWeight: "900",
    color: COLORS.cardWhite,
  },

  submitIcon: {
    marginLeft: 8,
  },
});