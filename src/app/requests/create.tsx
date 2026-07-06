import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import ScreenHeader from "../../components/ScreenHeader";
import { useRequests } from "../../context/RequestsContext";
import type { CampusRequest } from "../../types";

type RequestType = "Delivery" | "Event Help" | "Study Help" | "Pickup";
type ItemSize = "Small" | "Medium" | "Large";

const COLORS = {
  primary: "#9B1C31",
  darkRed: "#8F1428",
  background: "#FFFFFF",
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
const weekDayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CreateRequestScreen() {
  const router = useRouter();
  const { addRequest } = useRequests();

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
  const [deadlineDate, setDeadlineDate] = useState<Date | null>(null);
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(false);
  const [showWebCalendar, setShowWebCalendar] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [pointsOffered, setPointsOffered] = useState("");
  const [validationError, setValidationError] = useState("");

  const handleBack = () => {
    router.back();
  };

  const handleRequestTypeChange = (type: RequestType) => {
    setSelectedRequestType(type);
  };

  const handleSizeChange = (size: ItemSize) => {
    setItemSize(size);
  };



  const handlePointsOfferedChange = (value: string) => {
    const numbersOnly = value.replace(/[^0-9]/g, "");

    setPointsOffered(numbersOnly);

    if (validationError) {
      setValidationError("");
    }
  };



  const formatDeadlineDate = (date: Date) => {
    return date.toLocaleDateString("en-CA", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };









const isDateBeforeToday = (date: Date) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const targetDate = new Date(date);
  targetDate.setHours(0, 0, 0, 0);

  return targetDate < today;
};

const isSameCalendarDate = (firstDate: Date, secondDate: Date) => {
  return (
    firstDate.getFullYear() === secondDate.getFullYear() &&
    firstDate.getMonth() === secondDate.getMonth() &&
    firstDate.getDate() === secondDate.getDate()
  );
};

const getCalendarDays = () => {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();

  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);

  const days: (Date | null)[] = [];

  for (let i = 0; i < firstDayOfMonth.getDay(); i += 1) {
    days.push(null);
  }

  for (let day = 1; day <= lastDayOfMonth.getDate(); day += 1) {
    days.push(new Date(year, month, day));
  }

  return days;
};

const formatCalendarMonthLabel = (date: Date) => {
  return date.toLocaleDateString("en-CA", {
    month: "long",
    year: "numeric",
  });
};

    const handleOpenDeadlinePicker = () => {
      setValidationError("");

      if (Platform.OS === "web") {
        setCalendarMonth(deadlineDate ?? new Date());
        setShowWebCalendar((currentValue) => !currentValue);
        return;
      }

      setShowDeadlinePicker(true);
    };

    const handleSelectDeadlineDate = (date: Date) => {
      setDeadlineDate(date);
      setDeadline(formatDeadlineDate(date));
      setShowWebCalendar(false);
      setValidationError("");
    };

    const handlePreviousCalendarMonth = () => {
      setCalendarMonth((currentMonth) => {
        return new Date(
          currentMonth.getFullYear(),
          currentMonth.getMonth() - 1,
          1
        );
      });
    };

    const handleNextCalendarMonth = () => {
      setCalendarMonth((currentMonth) => {
        return new Date(
          currentMonth.getFullYear(),
          currentMonth.getMonth() + 1,
          1
        );
      });
    };

    const handleDeadlineChange = (
      event: DateTimePickerEvent,
      selectedDate?: Date
    ) => {
    if (Platform.OS === "android") {
      setShowDeadlinePicker(false);
    }

    if (event.type === "dismissed") {
      return;
    }

    if (selectedDate) {
      setDeadlineDate(selectedDate);
      setDeadline(formatDeadlineDate(selectedDate));
    }
  };

  const handleCloseDeadlinePicker = () => {
    setShowDeadlinePicker(false);
  };


  const validateForm = () => {
    const pointsNumber = Number(pointsOffered.trim());

    if (!requestTitle.trim()) {
      return "Please enter a request title.";
    }

    if (!campus.trim()) {
      return "Please select a campus.";
    }

    if (!roomLocation.trim()) {
      return "Please enter a room or specific location.";
    }

    if (!description.trim()) {
      return "Please enter a description.";
    }

    if (!deadline.trim()) {
      return "Please enter a deadline.";
    }

    if (!pointsOffered.trim()) {
      return "Please enter points offered.";
    }

    if (!Number.isInteger(pointsNumber) || pointsNumber <= 0) {
      return "Points offered must be a whole number greater than 0.";
    }

    return "";
  };


  const mapRequestTypeToCategory = (
    requestType: RequestType
  ): CampusRequest["category"] => {
    switch (requestType) {
      case "Delivery":
        return "DELIVERY";
      case "Event Help":
        return "EVENT HELP";
      case "Pickup":
        return "PICKUP";
      case "Study Help":
        return "STUDY HELP";
      default:
        return "DELIVERY";
    }
  };


  const handleSubmit = () => {
    const errorMessage = validateForm();

    if (errorMessage) {
      setValidationError(errorMessage);
      return;
    }

    setValidationError("");

    const formData = {
      selectedRequestType,
      requestTitle: requestTitle.trim(),
      campus: campus.trim(),
      roomLocation: roomLocation.trim(),
      pickupLocation: pickupLocation.trim(),
      dropoffLocation: dropoffLocation.trim(),
      itemSize,
      description: description.trim(),
      deadline: deadline.trim(),
      pointsOffered: Number(pointsOffered.trim()),
    };

    const newRequest = addRequest({
      category: mapRequestTypeToCategory(selectedRequestType),
      title: requestTitle.trim(),
      description: description.trim(),
      location: `${campus.trim()} • ${roomLocation.trim()}`,
      timeLabel: deadline.trim(),
      points: Number(pointsOffered.trim()),
      isUrgent: false,
    });

    console.log("New request submitted:", {
      ...formData,
      createdRequestId: newRequest.id,
    });

    router.back();
  };


  

  return (
    <View style={styles.safeArea}>
      <View style={styles.screen}>
        <ScreenHeader>
          <Pressable hitSlop={10} onPress={handleBack}>
            <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
          </Pressable>

          <Text style={styles.headerTitle}>New Request</Text>

          <View style={styles.headerSpacer} />
        </ScreenHeader>

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

              <Pressable
                style={styles.iconInputWrapSmall}
                onPress={handleOpenDeadlinePicker}
              >
                <Text
                  style={[
                    styles.deadlineText,
                    !deadline && styles.deadlinePlaceholderText,
                  ]}
                  numberOfLines={1}
                >
                  {deadline || "Pick date"}
                </Text>

                <Ionicons
                  name="calendar"
                  size={19}
                  color={COLORS.mutedText}
                  style={styles.inputRightIcon}
                />
              </Pressable>

              {Platform.OS === "web" && showWebCalendar && (
                <View style={styles.webCalendarCard}>
                  <View style={styles.webCalendarHeader}>
                    <Pressable
                      style={styles.calendarNavButton}
                      onPress={handlePreviousCalendarMonth}
                    >
                      <Ionicons name="chevron-back" size={18} color={COLORS.primary} />
                    </Pressable>

                    <Text style={styles.webCalendarMonthText}>
                      {formatCalendarMonthLabel(calendarMonth)}
                    </Text>

                    <Pressable
                      style={styles.calendarNavButton}
                      onPress={handleNextCalendarMonth}
                    >
                      <Ionicons name="chevron-forward" size={18} color={COLORS.primary} />
                    </Pressable>
                  </View>

                  <View style={styles.webCalendarWeekRow}>
                    {weekDayLabels.map((dayLabel) => (
                      <Text key={dayLabel} style={styles.webCalendarWeekText}>
                        {dayLabel}
                      </Text>
                    ))}
                  </View>

                  <View style={styles.webCalendarGrid}>
                    {getCalendarDays().map((date, index) => {
                      if (!date) {
                        return <View key={`empty-${index}`} style={styles.calendarDayCell} />;
                      }

                      const isSelected = deadlineDate
                        ? isSameCalendarDate(date, deadlineDate)
                        : false;

                      const isDisabled = isDateBeforeToday(date);

                      return (
                        <Pressable
                          key={date.toISOString()}
                          style={[
                            styles.calendarDayCell,
                            styles.calendarDayButton,
                            isSelected && styles.calendarDaySelected,
                            isDisabled && styles.calendarDayDisabled,
                          ]}
                          onPress={() => handleSelectDeadlineDate(date)}
                          disabled={isDisabled}
                        >
                          <Text
                            style={[
                              styles.calendarDayText,
                              isSelected && styles.calendarDaySelectedText,
                              isDisabled && styles.calendarDayDisabledText,
                            ]}
                          >
                            {date.getDate()}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}

              {Platform.OS !== "web" && showDeadlinePicker && (
                <DateTimePicker
                  value={deadlineDate ?? new Date()}
                  mode="date"
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  minimumDate={new Date()}
                  onChange={handleDeadlineChange}
                />
              )}

              {showDeadlinePicker && Platform.OS === "ios" && (
                <Pressable
                  style={styles.doneDateButton}
                  onPress={handleCloseDeadlinePicker}
                >
                  <Text style={styles.doneDateButtonText}>Done</Text>
                </Pressable>
              )}
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
                  onChangeText={handlePointsOfferedChange}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  placeholder="50"
                  placeholderTextColor={COLORS.inactiveGray}
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
          {validationError ? (
            <Text style={styles.validationText}>{validationError}</Text>
          ) : null}          

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
    </View>
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

  headerTitle: {
    flex: 1,
    marginLeft: 12,
    fontSize: 19,
    fontWeight: "900",
    color: "#FFFFFF",
  },

  headerSpacer: {
    width: 24,
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

  deadlineText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textDark,
  },

  deadlinePlaceholderText: {
    color: COLORS.inactiveGray,
  },

  doneDateButton: {
    marginTop: 8,
    height: 34,
    borderRadius: 8,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },

  doneDateButtonText: {
    color: COLORS.cardWhite,
    fontSize: 13,
    fontWeight: "800",
  },


  webCalendarCard: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#E8CFCF",
    backgroundColor: COLORS.cardWhite,
    padding: 10,
  },

  webCalendarHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },

  calendarNavButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF0F0",
  },

  webCalendarMonthText: {
    fontSize: 14,
    fontWeight: "900",
    color: COLORS.textDark,
  },

  webCalendarWeekRow: {
    flexDirection: "row",
    marginBottom: 6,
  },

  webCalendarWeekText: {
    width: "14.28%",
    textAlign: "center",
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.mutedText,
  },

  webCalendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },

  calendarDayCell: {
    width: "14.28%",
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },

  calendarDayButton: {
    borderRadius: 17,
  },

  calendarDaySelected: {
    backgroundColor: COLORS.primary,
  },

  calendarDayDisabled: {
    opacity: 0.35,
  },

  calendarDayText: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.textDark,
  },

  calendarDaySelectedText: {
    color: COLORS.cardWhite,
  },

  calendarDayDisabledText: {
    color: COLORS.inactiveGray,
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
  
  validationText: {
    color: COLORS.primary,
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 14,
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