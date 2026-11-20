import LegalLinks from "@/components/LegalLinks";
import { DeleteAccountButton } from "@/context/AccountDeletionProvider";
import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/context/ProfileContext";
import { getProfileAvatarSignedUrl } from "@/lib/avatars";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import ScreenHeader from "../../components/ScreenHeader";
import ProfileInterests from "../../components/ProfileInterests";
import PointsBalance from "../../components/PointsBalance";
import RatingSummary from "../../components/RatingSummary";
import ModerationEntry from "../../components/ModerationEntry";
import ProfileActionRow from "../../components/ProfileActionRow";

const COLORS = {
  primary: "#9B1C31",
  darkRed: "#8F1428",
  background: "#FFFFFF",
  cardWhite: "#FFFFFF",
  textDark: "#2B2525",
  mutedText: "#635C5C",
  border: "#EFE1E1",
  green: "#34A853",
  inactiveGray: "#A5AAB3",
};

export default function ProfileScreen() {
  const router = useRouter();
  const { signOut, user } = useAuth();
  const { profile } = useProfile();
  const [avatarSignedUrl, setAvatarSignedUrl] = useState<string | null>(null);
  const [isLoadingAvatar, setIsLoadingAvatar] = useState(
    Boolean(profile?.avatarPath)
  );

  const displayName = profile?.displayName ?? "Student";
  const major = profile?.major ?? "Major not added";

  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  useEffect(() => {
    let isActive = true;

    const loadAvatar = async () => {
      if (!profile?.avatarPath) {
        if (isActive) {
          setAvatarSignedUrl(null);
          setIsLoadingAvatar(false);
        }

        return;
      }

      setIsLoadingAvatar(true);

      try {
        const signedUrl = await getProfileAvatarSignedUrl(
          profile.avatarPath
        );

        if (isActive) {
          setAvatarSignedUrl(signedUrl);
        }
      } catch {
        if (isActive) {
          setAvatarSignedUrl(null);
        }
      } finally {
        if (isActive) {
          setIsLoadingAvatar(false);
        }
      }
    };

    void loadAvatar();

    return () => {
      isActive = false;
    };
  }, [profile?.avatarPath]);

  const signingOut = useRef(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const handleSignOut = async () => {
    if (signingOut.current) return;
    signingOut.current = true;
    setIsSigningOut(true);
    setSignOutError(null);

    try {
      const error = await signOut();
      if (error) throw error;
    } catch {
      setSignOutError("Unable to sign out. Please try again.");
    } finally {
      signingOut.current = false;
      setIsSigningOut(false);
    }
  };
  return (
    <View style={styles.safeArea}>
      <View style={styles.screen}>
        <ScreenHeader>
          <Text style={styles.headerTitle}>Profile</Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit profile"
            style={styles.headerIconButton}
            hitSlop={10}
            onPress={() => router.push("/profile/settings" as any)}
          >
            <Ionicons name="settings-sharp" size={23} color="#FFFFFF" />
          </Pressable>
        </ScreenHeader>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >

          <View style={styles.profileSection}>
            <View style={styles.avatarOuter}>
              {avatarSignedUrl ? (
                <Image
                  source={{ uri: avatarSignedUrl }}
                  style={styles.avatarImage}
                  contentFit="cover"
                />
              ) : isLoadingAvatar ? (
                <ActivityIndicator color={COLORS.primary} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarInitials}>
                    {initials || "S"}
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.profileInfo}>
              <Text style={styles.profileName}>{displayName}</Text>
              <Text style={styles.profileMajor}>{major}</Text>

              <Text style={styles.visibilityText}>
                {profile?.isDiscoverable
                  ? "Visible to other students"
                  : "Profile is private"}
              </Text>
            </View>
          </View>

          {user && <ProfileInterests key={`interests:${user.id}`} profileId={user.id} />}

          <PointsBalance key={`points:${user?.id}`} />
          {user && <RatingSummary key={`rating:${user.id}`} profileId={user.id} />}

          <View style={styles.accountSection}>
            <Text accessibilityRole="header" style={styles.accountHeading}>Your account</Text>
            <View style={styles.accountActions}>
              <ProfileActionRow label="Blocked students" icon="ban-outline"
                onPress={() => router.push('/profile/blocked' as any)} />
              <ProfileActionRow label="Account decisions & appeals" accessibilityLabel="Account decisions and appeals"
                icon="document-text-outline" onPress={() => router.push('/profile/appeals' as any)} />
              <DeleteAccountButton variant="profile" />
              {signOutError ? (
                <Text accessibilityLiveRegion="polite" style={styles.signOutError}>{signOutError}</Text>
              ) : null}
              <ProfileActionRow label="Log Out" icon="log-out-outline" chevron={false}
                busy={isSigningOut} onPress={() => { void handleSignOut(); }} />
            </View>
          </View>

          <LegalLinks variant="profile" />

          {user && <ModerationEntry key={`moderation:${user.id}`} userId={user.id} />}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  accountSection: { marginTop: 20 },
  accountHeading: { color: COLORS.textDark, fontSize: 18, fontWeight: '800', marginBottom: 14 },
  accountActions: { gap: 12 },
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
    paddingHorizontal: 17,
    backgroundColor: "#FBFAFA",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    flexDirection: "row",
    alignItems: "center",
  },

  headerIconButton: {
    minWidth: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },

  headerTitle: { flex: 1, minWidth: 0, fontSize: 20, fontWeight: "900", color: "#FFFFFF" },

  scrollView: {
    flex: 1,
  },

  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 24,
    paddingBottom: 32,
  },

  profileSection: {
    flexWrap: "wrap",
    gap: 16,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 25,
  },

  avatarOuter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    borderColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.cardWhite,
  },

  avatarImage: {
    width: 70,
    height: 70,
    borderRadius: 35,
  },

  avatarFallback: {
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F7E7EA",
  },

  avatarInitials: {
    fontSize: 23,
    fontWeight: "900",
    color: COLORS.primary,
  },

  profileInfo: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 240,
  },

  profileName: {
    fontSize: 23,
    fontWeight: "900",
    color: COLORS.textDark,
  },

  profileMajor: {
    marginTop: 1,
    fontSize: 16,
    color: COLORS.mutedText,
  },

  visibilityText: {
    marginTop: 5,
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.primary,
  },

  pointsCard: {
    backgroundColor: COLORS.cardWhite,
    borderRadius: 9,
    overflow: "hidden",
    marginBottom: 26,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
  },

  pointsTop: {
    backgroundColor: COLORS.darkRed,
    paddingHorizontal: 21,
    paddingTop: 20,
    paddingBottom: 22,
  },

  balanceLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#D6A8AF",
    marginBottom: 4,
  },

  balanceRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginBottom: 23,
  },

  balanceNumber: {
    fontSize: 40,
    lineHeight: 44,
    fontWeight: "900",
    color: COLORS.cardWhite,
  },

  balancePoints: {
    marginLeft: 8,
    marginBottom: 6,
    fontSize: 17,
    fontWeight: "800",
    color: COLORS.cardWhite,
  },

  pointsButtonRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  sendButton: {
    height: 41,
    paddingHorizontal: 16,
    borderRadius: 7,
    backgroundColor: COLORS.cardWhite,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 13,
  },

  earnButton: {
    height: 41,
    paddingHorizontal: 17,
    borderRadius: 7,
    backgroundColor: "#B95666",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },

  buttonIcon: {
    marginRight: 8,
  },

  sendButtonText: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.primary,
  },

  earnButtonText: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.cardWhite,
  },

  activityArea: {
    backgroundColor: COLORS.cardWhite,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
  },

  activityHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 15,
  },

  activityTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: COLORS.textDark,
  },

  seeAllText: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.primary,
  },

  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },

  activityIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 13,
  },

  activityTextWrap: {
    flex: 1,
  },

  activityName: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.textDark,
  },

  activityTime: {
    marginTop: 1,
    fontSize: 12,
    color: COLORS.mutedText,
  },

  activityPoints: {
    fontSize: 17,
    fontWeight: "900",
  },

  sectionTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: COLORS.textDark,
    marginBottom: 14,
  },

  settingsCard: {
    backgroundColor: COLORS.cardWhite,
    borderRadius: 9,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#F4EEEE",
    marginBottom: 30,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },

  settingsRow: {
    height: 56,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  settingsDivider: {
    borderBottomWidth: 1,
    borderBottomColor: "#F1ECEC",
  },

  settingsLeft: {
    flexDirection: "row",
    alignItems: "center",
  },

  settingsIcon: {
    width: 24,
    textAlign: "center",
    marginRight: 13,
  },

  settingsText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#6F6868",
  },

  signOutError: {
    marginBottom: 8,
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.primary,
    textAlign: "left",
  },
});
