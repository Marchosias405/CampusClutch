import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
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

type CampusName = "Burnaby" | "Surrey" | "Vancouver";

type SubmissionState = "idle" | "submitting" | "success";


type ValidationField =
  | "requestTitle"
  | "campus"
  | "roomLocation"
  | "pickupLocation"
  | "dropoffLocation"
  | "eventName"
  | "eventTask"
  | "courseOrSubject"
  | "studyTopic"
  | "description"
  | "deadline"
  | "pointsOffered";

type ValidationResult = {
  field: ValidationField;
  message: string;
} | null;






const campusOptions: CampusName[] = [
  "Burnaby",
  "Surrey",
  "Vancouver",
];


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
  softPink: "#FBECEC",
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
    id: "Pickup",
    label: "Pickup",
    icon: "shopping-bag",
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
  const [campus, setCampus] = useState<CampusName>("Burnaby");
  const [showCampusOptions, setShowCampusOptions] = useState(false);  
  const [roomLocation, setRoomLocation] = useState("");
  const [pickupLocation, setPickupLocation] = useState("");
  const [dropoffLocation, setDropoffLocation] = useState("");

  const [eventName, setEventName] = useState("");
  const [eventTask, setEventTask] = useState("");
  const [courseOrSubject, setCourseOrSubject] = useState("");
  const [studyTopic, setStudyTopic] = useState("");

  const [itemSize, setItemSize] = useState<ItemSize>("Medium");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [deadlineDate, setDeadlineDate] = useState<Date | null>(null);
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(false);
  const [showWebCalendar, setShowWebCalendar] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [pointsOffered, setPointsOffered] = useState("");
  const [validationError, setValidationError] = useState("");
  const [invalidField, setInvalidField] = useState<ValidationField | null>(null);



  const [submissionState, setSubmissionState] =
    useState<SubmissionState>("idle");

  const submitLockRef = useRef(false);

  const navigationTimeoutRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);






  const handleBack = () => {
    router.back();
  };



  const clearValidationError = () => {
    if (validationError) {
      setValidationError("");
    }

    if (invalidField) {
      setInvalidField(null);
    }
  };




  const handleTextFieldChange = (
    setter: React.Dispatch<React.SetStateAction<string>>,
    value: string
  ) => {
    setter(value);
    clearValidationError();
  };








  const handleRequestTypeChange = (type: RequestType) => {
    setSelectedRequestType(type);
    clearValidationError();
  };

  const handleSizeChange = (size: ItemSize) => {
    setItemSize(size);
  };



  const handlePointsOfferedChange = (value: string) => {
    const numbersOnly = value.replace(/[^0-9]/g, "");

    setPointsOffered(numbersOnly);
    clearValidationError();
  };



  const formatDeadlineDate = (date: Date) => {
    return date.toLocaleDateString("en-CA", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };


  useEffect(() => {
    return () => {
      if (navigationTimeoutRef.current) {
        clearTimeout(navigationTimeoutRef.current);
      }
    };
  }, []);


  const handleToggleCampusOptions = () => {
    setShowCampusOptions((currentValue) => !currentValue);
  };

  
  const handleCampusSelect = (selectedCampus: CampusName) => {
    setCampus(selectedCampus);
    setShowCampusOptions(false);
    clearValidationError();
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
      setInvalidField(null);
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
        setValidationError("");
        setInvalidField(null);
      }
    
  };

  const handleCloseDeadlinePicker = () => {
    setShowDeadlinePicker(false);
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






      const validateForm = (): ValidationResult => {
        const pointsNumber = Number(pointsOffered.trim());

        if (!requestTitle.trim()) {
          return {
            field: "requestTitle",
            message: "Please enter a request title.",
          };
        }

        if (!campus.trim()) {
          return {
            field: "campus",
            message: "Please select a campus.",
          };
        }

        if (!roomLocation.trim()) {
          return {
            field: "roomLocation",
            message: "Please enter a room or specific location.",
          };
        }

        if (selectedRequestType === "Delivery") {
          if (!pickupLocation.trim()) {
            return {
              field: "pickupLocation",
              message: "Please enter the delivery pickup location.",
            };
          }

          if (!dropoffLocation.trim()) {
            return {
              field: "dropoffLocation",
              message: "Please enter the delivery drop-off location.",
            };
          }
        }

        if (selectedRequestType === "Pickup") {
          if (!pickupLocation.trim()) {
            return {
              field: "pickupLocation",
              message: "Please enter the pickup location.",
            };
          }

          if (!dropoffLocation.trim()) {
            return {
              field: "dropoffLocation",
              message: "Please enter the pickup destination.",
            };
          }
        }

        if (selectedRequestType === "Event Help") {
          if (!eventName.trim()) {
            return {
              field: "eventName",
              message: "Please enter the event name.",
            };
          }

          if (!eventTask.trim()) {
            return {
              field: "eventTask",
              message: "Please describe the help needed for the event.",
            };
          }
        }

        if (selectedRequestType === "Study Help") {
          if (!courseOrSubject.trim()) {
            return {
              field: "courseOrSubject",
              message: "Please enter the course or subject.",
            };
          }

          if (!studyTopic.trim()) {
            return {
              field: "studyTopic",
              message: "Please enter the study topic.",
            };
          }
        }

        if (!description.trim()) {
          return {
            field: "description",
            message: "Please enter a description.",
          };
        }

        if (!deadline.trim()) {
          return {
            field: "deadline",
            message: "Please select a deadline.",
          };
        }

        if (!pointsOffered.trim()) {
          return {
            field: "pointsOffered",
            message: "Please enter points offered.",
          };
        }

        if (!Number.isInteger(pointsNumber) || pointsNumber <= 0) {
          return {
            field: "pointsOffered",
            message: "Points offered must be a whole number greater than 0.",
          };
        }

        return null;
      };














  const handleSubmit = () => {
    if (submitLockRef.current) {
      return;
    }





    const validationResult = validateForm();

    if (validationResult) {
      setValidationError(validationResult.message);
      setInvalidField(validationResult.field);
      return;
    }

    submitLockRef.current = true;
    setValidationError("");
    setInvalidField(null);
    setSubmissionState("submitting");

    try {
      const formData = {
        selectedRequestType,
        requestTitle: requestTitle.trim(),
        campus: campus.trim(),
        roomLocation: roomLocation.trim(),

        pickupLocation: pickupLocation.trim(),
        dropoffLocation: dropoffLocation.trim(),

        eventName: eventName.trim(),
        eventTask: eventTask.trim(),

        courseOrSubject: courseOrSubject.trim(),
        studyTopic: studyTopic.trim(),

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

      setSubmissionState("success");

      navigationTimeoutRef.current = setTimeout(() => {
        router.back();
      }, 1000);
    } catch (error) {
      console.error("Unable to submit request:", error);

      submitLockRef.current = false;
      setSubmissionState("idle");
      setValidationError(
        "Unable to post your request. Please try again."
      );
    }
  };


  const isSubmitting = submissionState === "submitting";
  const isSubmissionSuccessful = submissionState === "success";
  const isSubmitDisabled = submissionState !== "idle";


  

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
              onChangeText={(value) =>
                handleTextFieldChange(setRequestTitle, value)
              }              
              placeholder="e.g., Tim Hortons Coffee Delivery to Librar"
              placeholderTextColor={COLORS.inactiveGray}
              style={[
                styles.textInput,
                invalidField === "requestTitle" && styles.invalidInput,
              ]}
            />
          </View>

          <View style={styles.twoColumnRow}>







            <View style={styles.columnField}>
              <Text style={styles.inputLabel}>Campus</Text>

              <Pressable
                style={[
                  styles.selectorInput,
                  invalidField === "campus" && styles.invalidInput,
                ]}
                onPress={handleToggleCampusOptions}
              >
                <Text style={styles.selectorText}>{campus}</Text>

                <Ionicons
                  name={showCampusOptions ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={COLORS.inactiveGray}
                />
              </Pressable>

              {showCampusOptions && (
                <View style={styles.campusOptionsCard}>
                  {campusOptions.map((campusOption) => {
                    const isSelected = campus === campusOption;

                    return (
                      <Pressable
                        key={campusOption}
                        style={[
                          styles.campusOption,
                          isSelected && styles.selectedCampusOption,
                        ]}
                        onPress={() => handleCampusSelect(campusOption)}
                      >
                        <Text
                          style={[
                            styles.campusOptionText,
                            isSelected && styles.selectedCampusOptionText,
                          ]}
                        >
                          {campusOption}
                        </Text>

                        {isSelected && (
                          <Ionicons
                            name="checkmark"
                            size={18}
                            color={COLORS.primary}
                          />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>











            <View style={styles.columnField}>
              <Text style={styles.inputLabel}>Room/Specific Location</Text>

              <TextInput
                value={roomLocation}
                onChangeText={(value) =>
                  handleTextFieldChange(setRoomLocation, value)
                }                
                placeholder="e.g., Room 3002"
                placeholderTextColor={COLORS.inactiveGray}
                style={[
                  styles.textInput,
                  invalidField === "roomLocation" && styles.invalidInput,
                ]}
              />
            </View>
          </View>





          {(selectedRequestType === "Delivery" ||
            selectedRequestType === "Pickup") && (
            <View style={styles.detailsCard}>
              <View style={styles.detailsHeader}>
                <Ionicons
                  name="information-circle"
                  size={18}
                  color={COLORS.primary}
                />

                <Text style={styles.detailsTitle}>
                  {selectedRequestType === "Delivery"
                    ? "Delivery Details"
                    : "Pickup Details"}
                </Text>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Pickup Location</Text>

                <View
                  style={[
                    styles.iconInputWrap,
                    invalidField === "pickupLocation" && styles.invalidInput,
                  ]}
                >
                  <Ionicons
                    name="location-sharp"
                    size={20}
                    color={COLORS.mutedText}
                    style={styles.inputLeftIcon}
                  />

                  <TextInput
                    value={pickupLocation}
                    onChangeText={(value) =>
                      handleTextFieldChange(setPickupLocation, value)
                    }
                    placeholder={
                      selectedRequestType === "Delivery"
                        ? "e.g., AQ Tim Hortons"
                        : "e.g., Belzberg Library"
                    }
                    placeholderTextColor={COLORS.inactiveGray}
                    style={styles.iconTextInput}
                  />
                </View>
              </View>

              <View style={styles.formGroupLast}>
                <Text style={styles.inputLabel}>
                  {selectedRequestType === "Delivery"
                    ? "Drop-off Location"
                    : "Destination"}
                </Text>

                  <View
                    style={[
                      styles.iconInputWrap,
                      invalidField === "dropoffLocation" && styles.invalidInput,
                    ]}
                  >
                  <Ionicons
                    name="navigate"
                    size={20}
                    color={COLORS.primary}
                    style={styles.inputLeftIcon}
                  />

                  <TextInput
                    value={dropoffLocation}
                    onChangeText={(value) =>
                      handleTextFieldChange(setDropoffLocation, value)
                    }
                    placeholder={
                      selectedRequestType === "Delivery"
                        ? "e.g., WMC Study Area"
                        : "e.g., Burnaby Campus"
                    }
                    placeholderTextColor={COLORS.inactiveGray}
                    style={styles.iconTextInput}
                  />
                </View>
              </View>
            </View>
          )}

          {selectedRequestType === "Event Help" && (
            <View style={styles.detailsCard}>
              <View style={styles.detailsHeader}>
                <FontAwesome5
                  name="hands-helping"
                  size={17}
                  color={COLORS.primary}
                />

                <Text style={styles.detailsTitle}>Event Details</Text>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Event Name</Text>

                  <View
                    style={[
                      styles.iconInputWrap,
                      invalidField === "eventName" && styles.invalidInput,
                    ]}
                  >
                  <Ionicons
                    name="calendar"
                    size={19}
                    color={COLORS.mutedText}
                    style={styles.inputLeftIcon}
                  />

                  <TextInput
                    value={eventName}
                    onChangeText={(value) =>
                      handleTextFieldChange(setEventName, value)
                    }
                    placeholder="e.g., Student Union Gala"
                    placeholderTextColor={COLORS.inactiveGray}
                    style={styles.iconTextInput}
                  />
                </View>
              </View>

              <View style={styles.formGroupLast}>
                <Text style={styles.inputLabel}>Help Needed</Text>

                <View
                  style={[
                    styles.iconInputWrap,
                    invalidField === "eventTask" && styles.invalidInput,
                  ]}
                >
                  <Ionicons
                    name="people"
                    size={20}
                    color={COLORS.primary}
                    style={styles.inputLeftIcon}
                  />

                  <TextInput
                    value={eventTask}
                    onChangeText={(value) =>
                      handleTextFieldChange(setEventTask, value)
                    }
                    placeholder="e.g., Set up chairs and tables"
                    placeholderTextColor={COLORS.inactiveGray}
                    style={styles.iconTextInput}
                  />
                </View>
              </View>
            </View>
          )}

          {selectedRequestType === "Study Help" && (
            <View style={styles.detailsCard}>
              <View style={styles.detailsHeader}>
                <FontAwesome5
                  name="graduation-cap"
                  size={17}
                  color={COLORS.primary}
                />

                <Text style={styles.detailsTitle}>Study Details</Text>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Course or Subject</Text>

                <View
                  style={[
                    styles.iconInputWrap,
                    invalidField === "courseOrSubject" && styles.invalidInput,
                  ]}
                >
                  <Ionicons
                    name="book"
                    size={19}
                    color={COLORS.mutedText}
                    style={styles.inputLeftIcon}
                  />

                  <TextInput
                    value={courseOrSubject}
                    onChangeText={(value) =>
                      handleTextFieldChange(setCourseOrSubject, value)
                    }
                    placeholder="e.g., MATH 151"
                    placeholderTextColor={COLORS.inactiveGray}
                    style={styles.iconTextInput}
                  />
                </View>
              </View>

              <View style={styles.formGroupLast}>
                <Text style={styles.inputLabel}>Topic</Text>

                <View
                  style={[
                    styles.iconInputWrap,
                    invalidField === "studyTopic" && styles.invalidInput,
                  ]}
                >
                  <Ionicons
                    name="school"
                    size={20}
                    color={COLORS.primary}
                    style={styles.inputLeftIcon}
                  />

                  <TextInput
                    value={studyTopic}
                    onChangeText={(value) =>
                      handleTextFieldChange(setStudyTopic, value)
                    }
                    placeholder="e.g., Derivative rules"
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
              onChangeText={(value) =>
                handleTextFieldChange(setDescription, value)
              }
              placeholder="Tell us more about what you need..."
              placeholderTextColor={COLORS.inactiveGray}
              style={[
                styles.descriptionInput,
                invalidField === "description" && styles.invalidInput,
              ]}
              multiline
              textAlignVertical="top"
            />
          </View>

          <View style={styles.twoColumnRow}>


            
            <View style={styles.columnField}>
              <Text style={styles.inputLabel}>Deadline</Text>

              <Pressable
                style={[
                  styles.iconInputWrapSmall,
                  invalidField === "deadline" && styles.invalidInput,
                ]}
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






            <View
              style={[
                styles.iconInputWrapSmall,
                invalidField === "pointsOffered" && styles.invalidInput,
              ]}
            >
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

          {isSubmissionSuccessful ? (
            <Text style={styles.successText}>
              Request posted successfully.
            </Text>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.submitButton,
              isSubmitDisabled && styles.submitButtonDisabled,
              pressed && !isSubmitDisabled && styles.submitButtonPressed,
            ]}
            onPress={handleSubmit}
            disabled={isSubmitDisabled}
            accessibilityRole="button"
            accessibilityState={{
              disabled: isSubmitDisabled,
              busy: isSubmitting,
            }}
          >
            <Text style={styles.submitButtonText}>
              {isSubmitting
                ? "Posting..."
                : isSubmissionSuccessful
                  ? "Request Posted"
                  : "Post Request"}
            </Text>

            <Ionicons
              name={isSubmissionSuccessful ? "checkmark" : "arrow-forward"}
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
  invalidInput: {
  borderColor: COLORS.primary,
  borderWidth: 2,
  },
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



  campusOptionsCard: {
    marginTop: 7,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#E8CFCF",
    backgroundColor: COLORS.cardWhite,
    overflow: "hidden",
  },

  campusOption: {
    minHeight: 43,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },

  selectedCampusOption: {
    backgroundColor: COLORS.softPink,
  },

  campusOptionText: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textDark,
  },

  selectedCampusOptionText: {
    color: COLORS.primary,
    fontWeight: "900",
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







  successText: {
    color: COLORS.primary,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
    marginBottom: 14,
  },

  submitButtonDisabled: {
    opacity: 0.72,
  },

  submitButtonPressed: {
    opacity: 0.88,
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