import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import React, { useState } from "react";
import {
  Alert,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { auth, db } from "../lib/firebase";
import { getPhoneIdentityCandidates, normalizePhoneForAuth, normalizePhoneForTwilio } from "../lib/validations";
import { lookupEmailIndex } from "../lib/emailIndex";
import { lookupPhoneIndex } from "../lib/phoneIndex";
import { lookupPhoneLoginBlock } from "../lib/phoneLoginBlocks";
import { isExpectedNetworkError } from "../lib/networkErrors";
import i18n from "../locales/i18n";
import { useAuth } from "../context/AuthContext";
import FootballLoader from '../components/FootballLoader';

type Errors = {
  email?: string;
  password?: string;
  submit?: string;
};

const VALID_APP_ROLES = ['user', 'admin', 'player', 'parent', 'agent', 'academy', 'clinic'] as const;

const SignInScreen = () => {
  const router = useRouter();
  const { login } = useAuth();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [loading, setLoading] = useState(false);
  const [emailOrPhone, setEmailOrPhone] = useState("");
  const [focusedInput, setFocusedInput] = useState<string | null>(null);
  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const slideAnim = React.useRef(new Animated.Value(50)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.exp),
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        easing: Easing.out(Easing.exp),
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  // Validation function
  const validate = () => {
    let errs: Errors = {};
    if (!emailOrPhone) errs.email = i18n.t("required");
    if (!password) errs.password = i18n.t("required");
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // Signin handler with Firebase
  const handleSignin = async () => {
    if (!validate()) return;
    setLoading(true);
    let authEmail = "";
    try {
      // Check if input is email or phone
      const isEmail = emailOrPhone.includes("@");
      let email = emailOrPhone;
      authEmail = email;

      // If phone number, normalize the same way as signup so auth email matches
      if (!isEmail) {
        const normalizedPhone = normalizePhoneForAuth(normalizePhoneForTwilio(emailOrPhone));
        authEmail = `user_${normalizedPhone}@forsa.app`;
      } else {
        // User entered an email - try direct authentication first (for admin accounts)
        // If that fails, then try phone lookup (for regular users with user_{phone}@forsa.app format)
        authEmail = email.trim().toLowerCase();
      }

      // Sign in with Firebase Auth
      let userCredential: any;
      const digits = emailOrPhone.replace(/\D/g, "");
      const phoneCandidates = !isEmail ? getPhoneIdentityCandidates(emailOrPhone) : [];

      if (!isEmail) {
        for (const candidate of phoneCandidates) {
          const blockedAuthEmail = await lookupPhoneLoginBlock(candidate);
          if (blockedAuthEmail) {
            const e = new Error(`No account linked to "${emailOrPhone}". Please use your updated phone number or email.`) as any;
            e.code = "auth/user-not-found";
            throw e;
          }
        }
      }

      // We try multiple identifier formats to ensure legacy profiles still work
      const possibleAuthEmails = isEmail
        ? [authEmail]
        : [
          ...phoneCandidates.map((candidate) => `user_${candidate}@forsa.app`),
          `user_${digits}@forsa.app`,       // Legacy/Raw format
          `user_+${digits}@forsa.app`,      // Old Legacy Format
          `user_20${digits.startsWith('0') ? digits.substring(1) : digits}@forsa.app` // Temporary Format
        ];

      let lastError: any;
      for (const attemptEmail of possibleAuthEmails) {
        try {
          console.log("🔑 Attempting login with:", attemptEmail);
          userCredential = await signInWithEmailAndPassword(auth, attemptEmail, password);
          authEmail = attemptEmail; // Success!
          lastError = null;
          break;
        } catch (error: any) {
          lastError = error;
          // Continue to next format if not found
          if (error.code !== "auth/user-not-found" && error.code !== "auth/invalid-credential") {
            break; // If it's a wrong password, no point in trying other formats
          }
        }
      }

      // If all phone formats fail, try phone → authEmail lookup (e.g. account created with email + phone)
      if (!userCredential && !isEmail) {
        for (const candidate of phoneCandidates) {
          const indexedAuthEmail = await lookupPhoneIndex(candidate);
          if (indexedAuthEmail) {
            console.log("🔗 Found phone mapping! Attempting login with:", indexedAuthEmail);
            try {
              userCredential = await signInWithEmailAndPassword(auth, indexedAuthEmail, password);
              authEmail = indexedAuthEmail;
              lastError = null;
              break;
            } catch (error: any) {
              lastError = error;
            }
          }
        }
      }

      // If still no luck and input was email, try email mapping lookup
      if (!userCredential && isEmail) {
        const indexedAuthEmail = await lookupEmailIndex(emailOrPhone);
        if (indexedAuthEmail) {
          console.log("🔗 Found email mapping! Attempting login with:", indexedAuthEmail);
          try {
            userCredential = await signInWithEmailAndPassword(auth, indexedAuthEmail, password);
            authEmail = indexedAuthEmail;
            lastError = null;
          } catch (error: any) {
            lastError = error;
          }
        }
      }

      // If still no luck, throw the last error
      if (!userCredential) {
        if (isEmail && !lastError?.message.includes("linked")) {
          const e = new Error(`No account linked to "${emailOrPhone}". Please check your spelling or use your phone number.`) as any;
          e.code = "auth/user-not-found";
          throw e;
        }
        throw lastError;
      }

      const user = userCredential.user;
      console.log("User after login:", user?.uid);

      // Load user role/status from Firestore
      let userDoc;
      try {
        userDoc = await getDoc(doc(db, "users", user.uid));
      } catch (e: any) {
        if (isExpectedNetworkError(e)) {
          throw new Error("Login succeeded, but your profile could not load because the device is offline.");
        }

        console.error(
          "🔥 Failed to load user profile from Firestore:",
          e?.code ?? "unknown",
          e?.message ?? String(e)
        );
        throw new Error("Login succeeded, but loading your profile failed. Please try again.");
      }

      if (!userDoc.exists()) {
        throw new Error("User profile not found");
      }

      const userData: any = userDoc.data();
      const role = String(userData?.role || '').toLowerCase();
      const isSuspended = userData?.isSuspended === true || String(userData?.status || '').toLowerCase() === 'suspended';

      // Check if user is suspended
      if (isSuspended) {
        await auth.signOut();
        throw new Error("Your account has been suspended. Please contact support.");
      }

      const safeRole = VALID_APP_ROLES.includes(role as (typeof VALID_APP_ROLES)[number])
        ? (role as (typeof VALID_APP_ROLES)[number])
        : 'user';

      // Use the Integrated AuthContext for role-based navigation and state
      await login(authEmail, safeRole);

      // ✅ Navigate based on role
      if (role === "admin") {
        router.replace("/(admin)/dashboard");
      } else {
        switch (role) {
          case "player":
            router.replace("/player-feed");
            break;
          case "agent":
            router.replace("/agent-feed");
            break;
          case "academy":
            router.replace("/academy-feed");
            break;
          case "parent":
            router.replace("/parent-feed");
            break;
          case "clinic":
            router.replace("/clinic-feed");
            break;
          default:
            // Fail-safe: keep user in app even if role is malformed in Firestore.
            router.replace("/player-feed");
        }
      }

    } catch (err: any) {
      let errorMessage = i18n.t("loginFailed") || "Login failed";
      if (isExpectedNetworkError(err)) {
        errorMessage = "Unable to sign in while offline. Please check your Internet connection and try again.";
      } else if (err.code === "auth/user-not-found") {
        errorMessage = i18n.t("userNotFound") || "User not found";
      } else if (err.code === "auth/wrong-password") {
        errorMessage = i18n.t("incorrectPassword") || "Incorrect password";
      } else if (err.code === "auth/invalid-email") {
        errorMessage = i18n.t("invalidEmailAddress") || "Invalid email address";
      } else if (err.code === "auth/invalid-credential") {
        // This error occurs when email/password combination is wrong
        // For phone login, it might mean the phone number format doesn't match
        errorMessage = i18n.t("invalidCredentials") || "Invalid phone number or password. Please check your credentials.";
      } else if (err.message) {
        errorMessage = err.message;
      }
      setErrors({ submit: errorMessage });
      Alert.alert(i18n.t("loginFailed") || "Login failed", errorMessage);
      if (!isExpectedNetworkError(err)) {
        // Avoid logging raw Error objects in Expo/Hermes on Windows — it can trigger Metro
        // symbolication attempts against the pseudo-file `InternalBytecode.js` and spam ENOENT.
        console.error(
          "❌ Login error:",
          err?.code ?? "unknown",
          err?.message ?? String(err)
        );
        console.error("❌ Attempted identifier:", authEmail);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <LinearGradient
        colors={["#000000", "#1a1a1a", "#2d2d2d"]}
        style={styles.gradient}
      >
        <Animated.View
          style={[
            styles.content,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          {/* Back Button */}
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.welcomeText}>{i18n.t("welcome_back")}</Text>
              <Text style={styles.subtitleText}>
                {i18n.t("sign_in_to_continue")}
              </Text>
            </View>

            {/* Form Card */}
            <View style={styles.formCard}>
              {/* Email Input */}
              <View style={styles.inputContainer}>
                <View
                  style={[
                    styles.inputWrapper,
                    focusedInput === "email" && styles.inputWrapperFocused,
                    errors.email && styles.inputWrapperError,
                  ]}
                >
                  <Ionicons
                    name={emailOrPhone.includes("@") ? "mail-outline" : "call-outline"}
                    size={20}
                    color={focusedInput === "email" ? "#000" : "#999"}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder={i18n.t("email_or_phone") || "Email or Phone"}
                    placeholderTextColor="#999"
                    value={emailOrPhone}
                    onChangeText={setEmailOrPhone}
                    onFocus={() => setFocusedInput("email")}
                    onBlur={() => setFocusedInput(null)}
                    autoCapitalize="none"
                    keyboardType="default"
                    autoComplete="off"
                  />
                </View>
                {errors.email && (
                  <Text style={styles.errorText}>{errors.email}</Text>
                )}
              </View>

              {/* Password Input */}
              <View style={styles.inputContainer}>
                <View
                  style={[
                    styles.inputWrapper,
                    focusedInput === "password" && styles.inputWrapperFocused,
                    errors.password && styles.inputWrapperError,
                  ]}
                >
                  <Ionicons
                    name="lock-closed-outline"
                    size={20}
                    color={focusedInput === "password" ? "#000" : "#999"}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder={i18n.t("password")}
                    placeholderTextColor="#999"
                    value={password}
                    onChangeText={setPassword}
                    onFocus={() => setFocusedInput("password")}
                    onBlur={() => setFocusedInput(null)}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoComplete="password"
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword(!showPassword)}
                    style={styles.eyeIcon}
                  >
                    <Ionicons
                      name={showPassword ? "eye-outline" : "eye-off-outline"}
                      size={20}
                      color="#999"
                    />
                  </TouchableOpacity>
                </View>
                {errors.password && (
                  <Text style={styles.errorText}>{errors.password}</Text>
                )}
              </View>

              {/* Error Message */}
              {errors.submit && (
                <View style={styles.errorContainer}>
                  <Ionicons name="alert-circle" size={16} color="#ff3b30" />
                  <Text style={styles.errorSubmitText}>{errors.submit}</Text>
                </View>
              )}

              {/* Sign In Button */}
              <TouchableOpacity
                style={[
                  styles.signInButton,
                  loading && styles.signInButtonDisabled,
                ]}
                onPress={handleSignin}
                disabled={loading}
                activeOpacity={0.8}
              >
                {loading ? (
                  <FootballLoader color="#fff" />
                ) : (
                  <Text style={styles.signInButtonText}>{i18n.t("sign_in")}</Text>
                )}
              </TouchableOpacity>
              {/* Sign Up Link */}
              <View style={styles.signUpContainer}>
                <Text style={styles.signUpText}>{i18n.t("dontHaveAccount")}</Text>
                <TouchableOpacity onPress={() => router.push("/role")}>
                  <Text style={styles.signUpLink}>{i18n.t("signUp")}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </Animated.View>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: Platform.OS === "ios" ? 60 : 40,
    paddingBottom: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 30,
    position: "absolute",
    left: 20,
    top: Platform.OS === "ios" ? 40 : 30,
    zIndex: 2,
  },
  header: {
    marginBottom: 40,
    alignItems: "center",
    width: "100%",
  },
  welcomeText: {
    fontSize: 42,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 12,
    textAlign: "center",
    letterSpacing: 0.5,
  },
  subtitleText: {
    fontSize: 17,
    color: "rgba(255, 255, 255, 0.75)",
    textAlign: "center",
    lineHeight: 24,
  },
  formCard: {
    backgroundColor: "#fff",
    borderRadius: 28,
    padding: 32,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 12,
    width: "100%",
    maxWidth: 440,
  },
  inputContainer: {
    marginBottom: 20,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#f5f5f5",
    paddingHorizontal: 16,
    height: 56,
  },
  inputWrapperFocused: {
    borderColor: "#000",
    backgroundColor: "#fff",
  },
  inputWrapperError: {
    borderColor: "#ff3b30",
    backgroundColor: "#fff5f5",
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: "#000",
    paddingVertical: 0,
  },
  eyeIcon: {
    padding: 4,
  },
  errorText: {
    color: "#ff3b30",
    fontSize: 12,
    marginTop: 6,
    marginLeft: 4,
  },
  errorContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff5f5",
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  errorSubmitText: {
    color: "#ff3b30",
    fontSize: 14,
    marginLeft: 8,
    flex: 1,
  },
  forgotPassword: {
    alignSelf: "flex-end",
    marginBottom: 24,
  },
  forgotPasswordText: {
    color: "#007AFF",
    fontSize: 14,
    fontWeight: "600",
  },
  signInButton: {
    backgroundColor: "#000",
    borderRadius: 12,
    height: 56,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  signInButtonDisabled: {
    opacity: 0.6,
  },
  signInButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
    letterSpacing: 0.5,
  },
  signUpContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 20,
  },
  signUpText: {
    color: "#666",
    fontSize: 14,
  },
  signUpLink: {
    color: "#000",
    fontSize: 14,
    fontWeight: "bold",
    marginLeft: 4,
  },
});

export default SignInScreen;
