import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useRef, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ScreenHeader from "../../components/ScreenHeader";

const COLORS = {
  primary: "#9B1C31",
  darkRed: "#8F1428",
  background: "#FFFFFF",
  textDark: "#2B2525",
  mutedText: "#8C8585",
  border: "#ECE3E3",
  incoming: "#F1EEEE",
  inputGray: "#F2F0F0",
};

type ChatMeta = { name: string; subtitle: string; avatar?: string };

const chatMeta: Record<string, ChatMeta> = {
  marcus: {
    name: "Marcus Jenkins",
    subtitle: "CMPT 361",
    avatar: "https://api.dicebear.com/7.x/personas/png?seed=Marcus&backgroundColor=b6e3f4",
  },
  sarah: {
    name: "Sarah Chen",
    subtitle: "ECON 201",
    avatar: "https://api.dicebear.com/7.x/personas/png?seed=Sarah&backgroundColor=ffd5dc",
  },
  delivery: { name: "CampusLoop Delivery", subtitle: "Active order" },
  alex: {
    name: "Alex Rodriguez",
    subtitle: "CMPT 361",
    avatar: "https://api.dicebear.com/7.x/personas/png?seed=AlexRodriguez&backgroundColor=c0aede",
  },
  jordan: { name: "Jordan Lee", subtitle: "Study group" },
};

type Message = {
  id: string;
  text: string;
  fromMe: boolean;
  time: string;
};

const initialThread: Message[] = [
  { id: "1", text: "Hey! Are we still meeting at the library at 4?", fromMe: false, time: "13:58" },
  { id: "2", text: "Yeah for sure, I'm heading there now.", fromMe: true, time: "14:00" },
  { id: "3", text: "Perfect. I grabbed a study room on the 3rd floor.", fromMe: false, time: "14:01" },
  { id: "4", text: "Room 3412. Bring your CMPT 361 notes if you can!", fromMe: false, time: "14:02" },
  { id: "5", text: "On it. See you in 10 👋", fromMe: true, time: "14:02" },
];

export default function ChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const scrollRef = useRef<ScrollView>(null);

  const meta = chatMeta[id ?? ""] ?? { name: "Chat", subtitle: "" };

  const [messages, setMessages] = useState<Message[]>(initialThread);
  const [draft, setDraft] = useState("");

  const handleSend = () => {
    const text = draft.trim();
    if (!text) return;

    setMessages((prev) => [
      ...prev,
      {
        id: String(prev.length + 1),
        text,
        fromMe: true,
        time: "Now",
      },
    ]);
    setDraft("");
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader>
        <Pressable
          style={styles.headerLeft}
          hitSlop={10}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />

          {meta.avatar ? (
            <Image source={{ uri: meta.avatar }} style={styles.headerAvatar} />
          ) : (
            <View style={styles.headerAvatarFallback}>
              <Ionicons name="chatbubble-ellipses" size={16} color="#FFFFFF" />
            </View>
          )}

          <View>
            <Text style={styles.headerName} numberOfLines={1}>
              {meta.name}
            </Text>
            {!!meta.subtitle && (
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {meta.subtitle}
              </Text>
            )}
          </View>
        </Pressable>

        <Pressable hitSlop={10}>
          <Ionicons name="ellipsis-horizontal" size={22} color="#FFFFFF" />
        </Pressable>
      </ScreenHeader>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.threadContent}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() =>
            scrollRef.current?.scrollToEnd({ animated: false })
          }
        >
          <Text style={styles.dayLabel}>Today</Text>

          {messages.map((message, index) => {
            const showTime =
              index === messages.length - 1 ||
              messages[index + 1].fromMe !== message.fromMe;

            return (
              <View
                key={message.id}
                style={[
                  styles.bubbleRow,
                  message.fromMe ? styles.rowMe : styles.rowThem,
                ]}
              >
                <View style={styles.bubbleColumn}>
                  <View
                    style={[
                      styles.bubble,
                      message.fromMe ? styles.bubbleMe : styles.bubbleThem,
                    ]}
                  >
                    <Text
                      style={message.fromMe ? styles.textMe : styles.textThem}
                    >
                      {message.text}
                    </Text>
                  </View>

                  {showTime && (
                    <Text
                      style={[
                        styles.timeLabel,
                        message.fromMe ? styles.timeRight : styles.timeLeft,
                      ]}
                    >
                      {message.time}
                    </Text>
                  )}
                </View>
              </View>
            );
          })}
        </ScrollView>

        <View style={[styles.inputBar, { paddingBottom: insets.bottom + 10 }]}>
          <View style={styles.inputWrap}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Message"
              placeholderTextColor={COLORS.mutedText}
              style={styles.input}
              multiline
            />
          </View>

          <Pressable
            style={[styles.sendButton, !draft.trim() && styles.sendDisabled]}
            onPress={handleSend}
            disabled={!draft.trim()}
          >
            <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  flex: { flex: 1 },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
    marginRight: 10,
  },
  headerAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#FFFFFF",
  },
  headerAvatarFallback: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerName: { fontSize: 16, fontWeight: "900", color: "#FFFFFF" },
  headerSubtitle: {
    fontSize: 11,
    fontWeight: "600",
    color: "rgba(255,255,255,0.8)",
  },
  threadContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  dayLabel: {
    alignSelf: "center",
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.mutedText,
    marginBottom: 14,
  },
  bubbleRow: {
    width: "100%",
    flexDirection: "row",
    marginBottom: 3,
  },
  rowMe: { justifyContent: "flex-end" },
  rowThem: { justifyContent: "flex-start" },
  bubbleColumn: { maxWidth: "78%" },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
  },
  bubbleMe: {
    backgroundColor: COLORS.primary,
    borderBottomRightRadius: 6,
  },
  bubbleThem: {
    backgroundColor: COLORS.incoming,
    borderBottomLeftRadius: 6,
  },
  textMe: { fontSize: 15, lineHeight: 20, color: "#FFFFFF", fontWeight: "500" },
  textThem: {
    fontSize: 15,
    lineHeight: 20,
    color: COLORS.textDark,
    fontWeight: "500",
  },
  timeLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: COLORS.mutedText,
    marginTop: 3,
    marginBottom: 8,
  },
  timeRight: { alignSelf: "flex-end", marginRight: 4 },
  timeLeft: { alignSelf: "flex-start", marginLeft: 4 },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  inputWrap: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    borderRadius: 21,
    backgroundColor: COLORS.inputGray,
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  input: {
    fontSize: 15,
    color: COLORS.textDark,
    fontWeight: "500",
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: { backgroundColor: "#D8C2C2" },
});
