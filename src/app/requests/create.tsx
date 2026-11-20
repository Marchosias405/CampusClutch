import { MotionPressable as Pressable } from '@/components/motion';
import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useAuth } from "../../context/AuthContext";
import { loadRequest, requestError } from "../../lib/requests";
import ScreenHeader from "../../components/ScreenHeader";
import { useRequests } from "../../context/RequestsContext";
import type { CampusRequest } from "../../types";
import {
  clearRequestDraft, emptyRequestForm, formFromRequest, readRequestDraft, requestDraftKey, saveRequestDraft,
  type CampusName, type RequestFormValues, type RequestType,
} from "../../lib/requestFormDraft";

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
  mutedText: "#6E6565",
  border: "#EFE1E1",
  inactiveGray: "#68636B",
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

const weekDayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CreateRequestScreen() {
  const { user } = useAuth();
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const editId = typeof edit === 'string' ? edit : undefined;
  if (!user) return null;
  return <RequestForm key={requestDraftKey(user.id, editId)} userId={user.id} editId={editId} />;
}

function RequestForm({ userId, editId }: { userId: string; editId?: string }) {
  const { fontScale } = useWindowDimensions();
  const fieldColumn = [styles.columnField, { flexBasis: 160 * Math.max(1, fontScale) }];
  const router = useRouter();
  const { addRequest } = useRequests();
  const navigation = useNavigation();
  const storageKey = Platform.OS === 'android' ? requestDraftKey(userId, editId) : null;
  const [editReady, setEditReady] = useState(!editId && !storageKey);
  const [editRetry, setEditRetry] = useState(0);
  const [editLoadError, setEditLoadError] = useState("");
  const [urgent, setUrgent] = useState(false);
  // Older request records and the save API still use a size. Preserve it when editing.
  const originalItemSize = useRef<CampusRequest["itemSize"]>(undefined);
  const originalDeadline = useRef<string | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);


  const [form, setForm] = useState(emptyRequestForm);
  const { selectedRequestType, requestTitle, campus, roomLocation, pickupLocation, dropoffLocation,
    eventName, eventTask, courseOrSubject, studyTopic, description, pointsOffered, deadlineAt } = form;
  const deadlineDate = deadlineAt ? new Date(deadlineAt) : null;
  const deadline = deadlineDate ? formatDeadlineDate(deadlineDate) : "";
  const baseline = useRef(JSON.stringify(emptyRequestForm));
  const lastForm = useRef(emptyRequestForm);
  const leaving = useRef(false);
  const [storageWarning, setStorageWarning] = useState(false);
  const [showCampusOptions, setShowCampusOptions] = useState(false);  
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(false);
  const [showWebCalendar, setShowWebCalendar] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [validationError, setValidationError] = useState("");
  const [invalidField, setInvalidField] = useState<ValidationField | null>(null);



  const [submissionState, setSubmissionState] =
    useState<SubmissionState>("idle");

  const submitLockRef = useRef(false);

  const navigationTimeoutRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);






  useEffect(() => {
    if (!editId && !storageKey) return;
    let active = true;
    setEditReady(false);
    setEditLoadError("");
    async function openForm() {
      let initial = emptyRequestForm;
      if (editId) {
        const row = await loadRequest(editId);
        if (!active) return;
        if (!row || row.ownerId !== userId || row.status !== 'open') throw new Error('This request is no longer editable.');
        initial = formFromRequest(row);
        originalItemSize.current = row.itemSize;
        originalDeadline.current = row.deadlineAt;
        setUrgent(row.isUrgent ?? false);
      }
      baseline.current = JSON.stringify(initial);
      const restored = storageKey ? await readRequestDraft(storageKey, baseline.current).catch(() => {
        if (active) setStorageWarning(true);
        return null;
      }) : null;
      if (!active) return;
      lastForm.current = restored ?? initial;
      setForm(lastForm.current);
      setEditReady(true);
    }
    void openForm().catch(error => { if (active) setEditLoadError(requestError(error)); });
    return () => { active = false; };
  }, [editId, userId, storageKey, editRetry]);

  useEffect(() => {
    if (!storageKey || !editReady || leaving.current || lastForm.current === form) return;
    lastForm.current = form;
    const saved = JSON.stringify(form) === baseline.current
      ? clearRequestDraft(storageKey)
      : saveRequestDraft(storageKey, baseline.current, form);
    void saved.catch(() => { if (mounted.current) setStorageWarning(true); });
  }, [editReady, storageKey, form]);

  useEffect(() => navigation.addListener('beforeRemove', event => {
    if (!['GO_BACK', 'POP', 'POP_TO_TOP'].includes(event.data.action.type)) return;
    leaving.current = true;
    if (storageKey) void clearRequestDraft(storageKey).catch(() => undefined);
  }), [navigation, storageKey]);

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
    field: keyof RequestFormValues,
    value: string
  ) => {
    setForm(current => ({ ...current, [field]: value }));
    clearValidationError();
  };








  const handleRequestTypeChange = (type: RequestType) => {
    if (editId) return;
    setForm(current => ({ ...current, selectedRequestType: type }));
    clearValidationError();
  };

  const handlePointsOfferedChange = (value: string) => {
    setForm(current => ({ ...current, pointsOffered: value }));
    clearValidationError();
  };



  function formatDeadlineDate(date: Date) {
    return date.toLocaleDateString("en-CA", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }


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
    setForm(current => ({ ...current, campus: selectedCampus }));
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
      setForm(current => ({ ...current, deadlineAt: date.toISOString() }));
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
        setForm(current => ({ ...current, deadlineAt: selectedDate.toISOString() }));
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
        const pointsText = pointsOffered.trim();

        if (!requestTitle.trim() || requestTitle.trim().length > 120) {
          return {
            field: "requestTitle",
            message: "Enter a title of 1–120 characters.",
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

        if (description.trim().length < 10 || description.trim().length > 4000) {
          return {
            field: "description",
            message: "Description must contain 10–4000 characters.",
          };
        }

        if (!deadline.trim()) {
          return {
            field: "deadline",
            message: "Please select a deadline.",
          };
        }

        if (!pointsText) {
          return {
            field: "pointsOffered",
            message: "Please enter points offered.",
          };
        }

        const pointsNumber = Number(pointsText);
        if (!/^\d+$/.test(pointsText) || pointsNumber < 1 || pointsNumber > 2147483647) {
          return {
            field: "pointsOffered",
            message: "Enter a whole number from 1 to 2,147,483,647 using digits only.",
          };
        }

        return null;
      };














  const handleSubmit = async () => {
    if (submitLockRef.current || !editReady) {
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
        const requestDetails: Partial<CampusRequest> = {};

        if (
          selectedRequestType === "Delivery" ||
          selectedRequestType === "Pickup"
        ) {
          requestDetails.pickupLocation = pickupLocation.trim();
          requestDetails.dropoffLocation = dropoffLocation.trim();
        }

        if (selectedRequestType === "Event Help") {
          requestDetails.eventName = eventName.trim();
          requestDetails.eventTask = eventTask.trim();
        }

        if (selectedRequestType === "Study Help") {
          requestDetails.courseOrSubject = courseOrSubject.trim();
          requestDetails.studyTopic = studyTopic.trim();
        }







      const expires = new Date(deadlineDate!);
      if (!originalDeadline.current || expires.getTime() !== Date.parse(originalDeadline.current)) expires.setHours(23, 59, 59, 999);
      if (expires.getTime() <= Date.now()) throw new Error("Select a future deadline.");
      const newRequest = await addRequest({
        category: mapRequestTypeToCategory(selectedRequestType),
        title: requestTitle.trim(),
        description: description.trim(),

        location: `${campus.trim()}, ${roomLocation.trim()}`,
        campus: campus.trim(),
        roomLocation: roomLocation.trim(),

        deadlineAt: expires.toISOString(),
        timeLabel: deadline.trim(),
        points: Number(pointsOffered.trim()),
        itemSize: (editId && originalItemSize.current) || "Medium",

        status: "open",
        createdAt: new Date().toISOString(),
        isUrgent: urgent,

        ...requestDetails,
      }, editId);

      leaving.current = true;
      if (storageKey) {
        const submitted = mounted.current ? undefined : { baseline: baseline.current, values: form };
        await clearRequestDraft(storageKey, submitted).catch(() => { if (mounted.current) setStorageWarning(true); });
      }
      if (!mounted.current) return;
      setSubmissionState("success");

      navigationTimeoutRef.current = setTimeout(() => {
        router.replace({ pathname: "/requests/[id]", params: { id: newRequest } });
      }, 500);
    } catch (error) {
      if (!mounted.current) return;

      submitLockRef.current = false;
      setSubmissionState("idle");
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P0002') {
        setInvalidField('pointsOffered');
      }
      setValidationError(
        requestError(error)
      );
    }
  };


  const isSubmitting = submissionState === "submitting";
  const isSubmissionSuccessful = submissionState === "success";
  const isSubmitDisabled = submissionState !== "idle" || !editReady;
  const isLoadingEdit = !editReady && !editLoadError;
  const submitLabel = isSubmitting
    ? (editId ? "Saving changes..." : "Posting...")
    : isSubmissionSuccessful
      ? (editId ? "Changes Saved" : "Request Posted")
      : (editId ? "Save Changes" : "Post Request");


  

  return (
    <View style={styles.safeArea}>
      <View style={styles.screen}>
        <ScreenHeader>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            accessibilityState={{ disabled: submissionState !== "idle" }}
            disabled={submissionState !== "idle"}
            onPress={handleBack}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
          </Pressable>

          <Text accessibilityRole="header" style={styles.headerTitle}>{editId ? "Edit Request" : "New Request"}</Text>

          <View style={styles.headerSpacer} />
        </ScreenHeader>

        <KeyboardAvoidingView
          style={styles.keyboardAvoidingView}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={0}
        >
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={
              Platform.OS === "ios" ? "interactive" : "on-drag"
            }
          >
          <View pointerEvents={editReady && submissionState === "idle" ? "auto" : "none"}
            importantForAccessibility={editReady ? "auto" : "no-hide-descendants"}
            accessibilityElementsHidden={!editReady}>
          <Text style={styles.sectionTitle}>Request Type</Text>

          <ScrollView
            horizontal
            accessibilityRole="radiogroup"
            accessibilityLabel="Request type"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.requestTypesRow}
          >
            {requestTypes.map((type) => {
              const isActive = selectedRequestType === type.id;

              return (
                <Pressable
                  key={type.id}
                  accessibilityRole="radio"
                  accessibilityLabel={type.label}
                  aria-checked={isActive}
                  disabled={Boolean(editId)}
                  accessibilityState={{ disabled: Boolean(editId) }}
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
              onChangeText={value => handleTextFieldChange("requestTitle", value)}
              accessibilityLabel="Request title"
              placeholder="e.g., Coffee delivery"
              placeholderTextColor={COLORS.inactiveGray}
              style={[
                styles.textInput,
                invalidField === "requestTitle" && styles.invalidInput,
              ]}
            />
          </View>

          <View style={styles.twoColumnRow}>







            <View style={fieldColumn}>
              <Text style={styles.inputLabel}>Campus</Text>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Campus, ${campus}`}
                aria-expanded={showCampusOptions}
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
                <View accessibilityRole="radiogroup" accessibilityLabel="Campus options" style={styles.campusOptionsCard}>
                  {campusOptions.map((campusOption) => {
                    const isSelected = campus === campusOption;

                    return (
                      <Pressable
                        key={campusOption}
                        accessibilityRole="radio"
                        accessibilityLabel={campusOption}
                        aria-checked={isSelected}
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











            <View style={fieldColumn}>
              <Text style={styles.inputLabel}>Room/Specific Location</Text>

              <TextInput
                value={roomLocation}
                onChangeText={value => handleTextFieldChange("roomLocation", value)}
                accessibilityLabel="Room or specific location"
                placeholder="e.g., 3002"
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
                    accessibilityLabel="Pickup location"
                    value={pickupLocation}
                    onChangeText={value => handleTextFieldChange("pickupLocation", value)}
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
                    accessibilityLabel={selectedRequestType === "Delivery" ? "Drop-off location" : "Destination"}
                    value={dropoffLocation}
                    onChangeText={value => handleTextFieldChange("dropoffLocation", value)}
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
                    accessibilityLabel="Event name"
                    value={eventName}
                    onChangeText={value => handleTextFieldChange("eventName", value)}
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
                    accessibilityLabel="Help needed"
                    value={eventTask}
                    onChangeText={value => handleTextFieldChange("eventTask", value)}
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
                    accessibilityLabel="Course or subject"
                    value={courseOrSubject}
                    onChangeText={value => handleTextFieldChange("courseOrSubject", value)}
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
                    accessibilityLabel="Topic"
                    value={studyTopic}
                    onChangeText={value => handleTextFieldChange("studyTopic", value)}
                    placeholder="e.g., Derivative rules"
                    placeholderTextColor={COLORS.inactiveGray}
                    style={styles.iconTextInput}
                  />
                </View>
              </View>
            </View>
          )}







          <View style={styles.formGroup}>
            <Text style={styles.inputLabel}>Description</Text>

            <TextInput
              accessibilityLabel="Description"
              value={description}
              onChangeText={value => handleTextFieldChange("description", value)}
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


            
            <View style={[fieldColumn, showWebCalendar && styles.fullColumn]}>
              <Text style={styles.inputLabel}>Deadline (end of day)</Text>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Deadline (end of day), ${deadline || "Pick date"}`}
                aria-expanded={showWebCalendar || showDeadlinePicker}
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
                      accessibilityRole="button"
                      accessibilityLabel="Previous month"
                      onPress={handlePreviousCalendarMonth}
                    >
                      <Ionicons name="chevron-back" size={18} color={COLORS.primary} />
                    </Pressable>

                    <Text style={styles.webCalendarMonthText}>
                      {formatCalendarMonthLabel(calendarMonth)}
                    </Text>

                    <Pressable
                      style={styles.calendarNavButton}
                      accessibilityRole="button"
                      accessibilityLabel="Next month"
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
                          accessibilityRole="button"
                          accessibilityLabel={formatDeadlineDate(date)}
                          aria-selected={isSelected}
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
                  accessibilityRole="button"
                  style={styles.doneDateButton}
                  onPress={handleCloseDeadlinePicker}
                >
                  <Text style={styles.doneDateButtonText}>Done</Text>
                </Pressable>
              )}
            </View>






            <View style={fieldColumn}>
              <Text style={styles.inputLabel}>Points Offered</Text>

              <View
                style={[
                  styles.iconInputWrapSmall,
                  invalidField === "pointsOffered" && styles.invalidInput,
                ]}
              >
                <FontAwesome5
                  name="coins"
                  size={16}
                  color={COLORS.coinGold}
                  style={styles.coinIcon}
                />

                <TextInput
                  accessibilityLabel="Points offered"
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

          <Text style={{ color: COLORS.mutedText, fontSize: 13, lineHeight: 19, marginBottom: 16 }}>
            {!editId ? 'You can have up to 3 active requests across all categories. Open and accepted requests count toward this limit. Completed, cancelled, and expired requests free a slot.\n\n' : ''}
            You cannot offer more than your available points. Your balance is checked when you post or edit, and again when you accept a helper. Points are reserved only on acceptance; check Profile for your balance.
            {editId ? ' Changing points closes earlier offers and requires helpers to confirm the new reward before you can accept them.' : ''}
          </Text>
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












          </View>
          {storageWarning && <Text accessibilityRole="alert" style={styles.validationText}>Device storage is unavailable. Your draft may not be recovered correctly.</Text>}
          {isLoadingEdit && <Text accessibilityLiveRegion="polite" style={styles.validationText}>{editId ? 'Loading request…' : 'Opening draft…'}</Text>}
          {editLoadError || validationError ? (
            <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.validationText}>
              {editLoadError || validationError}
            </Text>
          ) : null}
          {!!editLoadError && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading request"
              style={styles.retryButton}
              onPress={() => { setEditLoadError(""); setEditRetry(value => value + 1); }}
            >
              <Text style={styles.validationText}>Retry loading request</Text>
            </Pressable>
          )}

          {isSubmissionSuccessful ? (
            <Text accessibilityLiveRegion="polite" style={styles.successText}>
              {editId ? 'Changes saved successfully.' : 'Request posted successfully.'}
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
            accessibilityLabel={submitLabel}
            accessibilityState={{
              disabled: isSubmitDisabled,
              busy: isSubmitting || isLoadingEdit,
            }}
          >
            <Text style={styles.submitButtonText}>
              {submitLabel}
            </Text>

            <Ionicons
              name={isSubmissionSuccessful ? "checkmark" : "arrow-forward"}
              size={22}
              color={COLORS.cardWhite}
              style={styles.submitIcon}
            />
          </Pressable>









          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  retryButton: {
    minHeight: 48,
    justifyContent: "center",
  },
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

  keyboardAvoidingView: {
    flex: 1,
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
    minWidth: 102,
    minHeight: 118,
    paddingHorizontal: 10,
    paddingVertical: 12,
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
    minHeight: 48,
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
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 15,
  },

  columnField: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  fullColumn: {
    flexBasis: "100%",
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
    minHeight: 48,
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
    minHeight: 48,
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
    minHeight: 48,
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
    minHeight: 48,
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.textDark,
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
    minHeight: 48,
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
    minHeight: 48,
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
    width: 48,
    minHeight: 48,
    borderRadius: 24,
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
    minHeight: 48,
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
    minHeight: 48,
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
    color: COLORS.mutedText,
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
    minHeight: 55,
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
