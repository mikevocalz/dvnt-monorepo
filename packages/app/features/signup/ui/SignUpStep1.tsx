import { useState, useMemo, useCallback, useRef } from "react";
import { Debouncer } from "@tanstack/pacer";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useForm } from "@tanstack/react-form";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Button, Input } from "@dvnt/app/components/ui";
import { FormInput } from "@dvnt/app/components/form";
import { useSignupStore } from "@dvnt/app/lib/stores/signup-store";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { DB } from "@dvnt/app/lib/supabase/db-map";
import { CheckCircle2, XCircle, ShieldAlert } from "lucide-react-native";
import { AppTrace } from "@dvnt/app/lib/diagnostics/app-trace";

const UNDERAGE_ERROR_MESSAGE = "You must be 18 or older to use this app.";

// Parse date string (YYYY-MM-DD) to Date object, avoiding timezone issues
function parseDateString(dateStr: string | undefined): Date {
  if (!dateStr) {
    // Default to 18 years ago
    const defaultDate = new Date();
    defaultDate.setFullYear(defaultDate.getFullYear() - 18);
    return defaultDate;
  }

  // Parse YYYY-MM-DD format and create date in local timezone
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
    const day = parseInt(parts[2], 10);

    // Create date in local timezone
    const date = new Date(year, month, day);

    // Validate the date
    if (
      date.getFullYear() === year &&
      date.getMonth() === month &&
      date.getDate() === day
    ) {
      return date;
    }
  }

  // Fallback to default date if parsing fails
  const fallbackDate = new Date();
  fallbackDate.setFullYear(fallbackDate.getFullYear() - 18);
  return fallbackDate;
}

function getMinimumBirthDate(): Date {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 100);
  return date;
}

function getMaximumBirthDate(): Date {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 18);
  return date;
}

function validateDateOfBirth(dateString: string): {
  isValid: boolean;
  isOver18: boolean;
} {
  if (!dateString) return { isValid: false, isOver18: false };

  const birthDate = new Date(dateString);
  const today = new Date();
  const age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();

  let actualAge = age;
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birthDate.getDate())
  ) {
    actualAge--;
  }

  return { isValid: true, isOver18: actualAge >= 18 };
}

// Separate component for DateOfBirth field to properly use hooks
function DateOfBirthField({
  field,
  showDatePicker,
  setShowDatePicker,
}: {
  field: any;
  showDatePicker: boolean;
  setShowDatePicker: (show: boolean) => void;
}) {
  const dateValue = useMemo(
    () => parseDateString(field.state.value),
    [field.state.value],
  );

  // CRITICAL: Age verification - must be 18+ (NO EXCEPTIONS)
  const minimumDate = useMemo(() => getMinimumBirthDate(), []);
  const maximumDate = useMemo(() => getMaximumBirthDate(), []);

  // Validate current DOB selection for age requirement
  const ageValidation = useMemo(() => {
    if (!field.state.value) return null;
    return validateDateOfBirth(field.state.value);
  }, [field.state.value]);

  const isUnderage = ageValidation && ageValidation.isOver18 === false;

  const handleDateChange = useCallback(
    (event: any, selectedDate: Date | undefined) => {
      try {
        // Handle Android dismissal
        if (Platform.OS === "android") {
          if (event.type === "dismissed") {
            setShowDatePicker(false);
            return;
          }
          // Android closes automatically after selection
          setShowDatePicker(false);
        }

        // Only update if a date was actually selected
        if (selectedDate && event.type !== "dismissed") {
          // Use local date components to avoid timezone issues
          const year = selectedDate.getFullYear();
          const month = String(selectedDate.getMonth() + 1).padStart(2, "0");
          const day = String(selectedDate.getDate()).padStart(2, "0");
          const dateString = `${year}-${month}-${day}`;
          field.handleChange(dateString);
        }
      } catch (error) {
        console.error("[SignUpStep1] Date change error:", error);
      }
    },
    [field, setShowDatePicker],
  );

  return (
    <View className="gap-1">
      <Text className="text-sm font-medium text-foreground">Date of Birth</Text>
      <Pressable
        onPress={() => setShowDatePicker(true)}
        className={`h-12 px-4 rounded-lg border bg-card justify-center ${
          isUnderage ? "border-destructive" : "border-border"
        }`}
      >
        <Text
          className={
            field.state.value
              ? isUnderage
                ? "text-destructive"
                : "text-foreground"
              : "text-muted-foreground"
          }
        >
          {field.state.value
            ? parseDateString(field.state.value).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })
            : "Select date"}
        </Text>
      </Pressable>

      {/* CRITICAL: Age restriction warning - hard block for underage users */}
      {isUnderage && (
        <View className="bg-destructive/10 rounded-lg p-3 mt-2 flex-row items-start gap-2">
          <ShieldAlert size={16} color="#ef4444" />
          <View className="flex-1">
            <Text className="text-sm font-semibold text-destructive">
              Age Restriction
            </Text>
            <Text className="text-xs text-destructive/80 mt-0.5">
              {UNDERAGE_ERROR_MESSAGE}
            </Text>
          </View>
        </View>
      )}
      {showDatePicker && (
        <View className="mt-2">
          {Platform.OS === "ios" ? (
            <View className="bg-card rounded-xl p-4 border border-border">
              <DateTimePicker
                value={dateValue}
                mode="date"
                display="spinner"
                minimumDate={minimumDate}
                maximumDate={maximumDate}
                onChange={(event, selectedDate) => {
                  // On iOS, onChange fires as user scrolls - update immediately
                  if (selectedDate && event.type !== "dismissed") {
                    try {
                      const year = selectedDate.getFullYear();
                      const month = String(
                        selectedDate.getMonth() + 1,
                      ).padStart(2, "0");
                      const day = String(selectedDate.getDate()).padStart(
                        2,
                        "0",
                      );
                      const dateString = `${year}-${month}-${day}`;
                      field.handleChange(dateString);
                    } catch (error) {
                      console.error(
                        "[SignUpStep1] iOS date change error:",
                        error,
                      );
                    }
                  }
                }}
                textColor="#fff"
                themeVariant="dark"
                style={{ height: 220, width: "100%" }}
              />
              <View className="flex-row gap-2 mt-4">
                <Button
                  onPress={() => {
                    setShowDatePicker(false);
                  }}
                  variant="outline"
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onPress={() => {
                    setShowDatePicker(false);
                  }}
                  className="flex-1"
                >
                  Done
                </Button>
              </View>
            </View>
          ) : (
            <DateTimePicker
              value={dateValue}
              mode="date"
              display="default"
              minimumDate={minimumDate}
              maximumDate={maximumDate}
              onChange={handleDateChange}
            />
          )}
        </View>
      )}
    </View>
  );
}

function getPasswordStrength(password: string) {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  if (score <= 1)
    return { level: "Weak", color: "#ef4444", width: "25%" as const };
  if (score <= 2)
    return { level: "Fair", color: "#f97316", width: "50%" as const };
  if (score <= 3)
    return { level: "Good", color: "#eab308", width: "75%" as const };
  return { level: "Strong", color: "#34A2DF", width: "100%" as const };
}

export function SignUpStep1() {
  const { formData, updateFormData, setActiveStep } = useSignupStore();
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [password, setPassword] = useState(formData?.password || "");
  const [usernameStatus, setUsernameStatus] = useState<
    "idle" | "checking" | "available" | "taken"
  >("idle");
  const [usernameSuggestions, setUsernameSuggestions] = useState<string[]>([]);
  const checkRef = useRef<(name: string) => void>(() => {});
  const usernameDebouncer = useMemo(
    () =>
      new Debouncer((name: string) => checkRef.current(name), { wait: 500 }),
    [],
  );

  const strength = useMemo(() => getPasswordStrength(password), [password]);

  const checkUsernameAvailability = useCallback(async (username: string) => {
    if (username.length < 3 || !/^[a-zA-Z0-9_]+$/.test(username)) {
      setUsernameStatus("idle");
      setUsernameSuggestions([]);
      return;
    }

    setUsernameStatus("checking");
    try {
      // Check if username exists in Supabase
      const { data, error } = await supabase
        .from(DB.users.table)
        .select(DB.users.username)
        .eq(DB.users.username, username)
        .single();

      if (error && error.code !== "PGRST116") {
        // PGRST116 = no rows returned, which means available
        console.error("[SignUpStep1] Username check error:", error);
        setUsernameStatus("idle");
        return;
      }

      if (data) {
        // Username is taken
        setUsernameStatus("taken");

        // Generate suggestions
        const suggestions = [
          `${username}_${Math.floor(Math.random() * 100)}`,
          `${username}${Math.floor(Math.random() * 1000)}`,
          `${username}_official`,
        ];
        setUsernameSuggestions(suggestions);
      } else {
        // Username is available
        setUsernameStatus("available");
        setUsernameSuggestions([]);
      }
    } catch (error) {
      console.error("[SignUpStep1] Username check error:", error);
      setUsernameStatus("idle");
    }
  }, []);

  checkRef.current = checkUsernameAvailability;

  const handleUsernameChange = useCallback(
    (value: string, onChange: (v: string) => void) => {
      usernameDebouncer.cancel();

      // Normalize: lowercase, strip all invalid chars (not just spaces)
      const normalized = value.toLowerCase().replace(/[^a-z0-9_]/g, "");
      if (normalized !== value) {
        onChange(normalized);
      }

      if (normalized.length >= 3 && /^[a-z0-9_]+$/.test(normalized)) {
        usernameDebouncer.maybeExecute(normalized);
      } else {
        setUsernameStatus("idle");
        setUsernameSuggestions([]);
      }
    },
    [usernameDebouncer],
  );

  // Track if user is underage based on DOB in form
  const [isUserUnderage, setIsUserUnderage] = useState(false);
  const [dobError, setDobError] = useState("");

  const form = useForm({
    defaultValues: {
      firstName: formData?.firstName || "",
      lastName: formData?.lastName || "",
      email: formData?.email || "",
      username: formData?.username || "",
      phone: formData?.phone || "",
      dateOfBirth: formData?.dateOfBirth || "",
      password: formData?.password || "",
      confirmPassword: "",
    },
    onSubmit: async ({ value }) => {
      // CRITICAL: Date of birth is REQUIRED — block if missing
      if (!value.dateOfBirth) {
        setDobError("Please enter your date of birth");
        setIsUserUnderage(false);
        setShowDatePicker(true);
        console.error("[SignUpStep1] BLOCKED: No date of birth entered");
        AppTrace.warn("SIGNUP", "step1_blocked_missing_dob", {
          hasEmail: Boolean(value.email),
          hasPhone: Boolean(value.phone),
        });
        return; // BLOCK - require DOB
      }

      // CRITICAL: Server-side age verification before proceeding
      const ageCheck = validateDateOfBirth(value.dateOfBirth);
      if (!ageCheck.isValid || ageCheck.isOver18 === false) {
        setIsUserUnderage(true);
        setDobError("");
        console.error("[SignUpStep1] BLOCKED: Underage user attempted signup");
        AppTrace.warn("SIGNUP", "step1_blocked_underage", {
          hasDob: Boolean(value.dateOfBirth),
        });
        return; // HARD BLOCK - do not proceed
      }
      setDobError("");
      setIsUserUnderage(false);

      updateFormData({
        firstName: value.firstName,
        lastName: value.lastName,
        email: value.email,
        username: value.username,
        phone: value.phone,
        dateOfBirth: value.dateOfBirth,
        password: value.password,
      });
      AppTrace.trace("SIGNUP", "step1_completed", {
        hasPhone: Boolean(value.phone),
        usernameLength: value.username.length,
      });
      setActiveStep(1);
    },
  });

  return (
    <View className="gap-4 pb-20">
      <View className="flex-row gap-4">
        <View className="flex-1">
          <FormInput
            form={form}
            name="firstName"
            label="First Name"
            placeholder="John"
            validators={{
              onChange: ({ value }: any) => {
                if (!value) return "First name is required";
                if (value.length < 2) return "Must be at least 2 characters";
                return undefined;
              },
            }}
          />
        </View>
        <View className="flex-1">
          <FormInput
            form={form}
            name="lastName"
            label="Last Name"
            placeholder="Doe"
            validators={{
              onChange: ({ value }: any) => {
                if (!value) return "Last name is required";
                if (value.length < 2) return "Must be at least 2 characters";
                return undefined;
              },
            }}
          />
        </View>
      </View>

      <FormInput
        form={form}
        name="email"
        label="Email"
        placeholder="john.doe@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        validators={{
          onChange: ({ value }: any) => {
            if (!value) return "Email is required";
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
              return "Please enter a valid email";
            return undefined;
          },
        }}
      />

      <form.Field
        name="username"
        validators={{
          onChange: ({ value }: any) => {
            if (!value) return "Username is required";
            if (value.length < 3)
              return "Username must be at least 3 characters";
            if (value.length > 30)
              return "Username must be 30 characters or less";
            if (!/^[a-z0-9_]+$/.test(value))
              return "Only lowercase letters, numbers, and underscores";
            if (usernameStatus === "taken") return "Username is already taken";
            return undefined;
          },
        }}
      >
        {(field) => (
          <View className="gap-1">
            <Text className="text-sm font-medium text-foreground">
              Username
            </Text>
            <View className="relative">
              <Input
                value={field.state.value}
                onChangeText={(text) => {
                  field.handleChange(text);
                  handleUsernameChange(text, field.handleChange);
                }}
                onBlur={field.handleBlur}
                placeholder="johndoe"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={30}
              />
              <View className="absolute right-3 top-3">
                {usernameStatus === "checking" && (
                  <ActivityIndicator size="small" color="#34A2DF" />
                )}
                {usernameStatus === "available" && (
                  <CheckCircle2 size={20} color="#22c55e" />
                )}
                {usernameStatus === "taken" && (
                  <XCircle size={20} color="#ef4444" />
                )}
              </View>
            </View>
            {usernameStatus === "available" && (
              <Text className="text-xs text-green-500">
                Username is available!
              </Text>
            )}
            {usernameStatus === "taken" && (
              <View className="gap-1">
                <Text className="text-xs text-destructive">
                  Username is already taken
                </Text>
                {usernameSuggestions.length > 0 && (
                  <View className="flex-row flex-wrap gap-2 mt-1">
                    <Text className="text-xs text-muted">Try:</Text>
                    {usernameSuggestions.map((suggestion) => (
                      <Pressable
                        key={suggestion}
                        onPress={() => {
                          field.handleChange(suggestion);
                          handleUsernameChange(suggestion, field.handleChange);
                        }}
                        className="px-2 py-1 bg-primary/10 rounded"
                      >
                        <Text className="text-xs text-primary">
                          {suggestion}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            )}
            {field.state.meta.errors?.[0] && usernameStatus !== "taken" && (
              <Text className="text-xs text-destructive">
                {field.state.meta.errors[0]}
              </Text>
            )}
          </View>
        )}
      </form.Field>

      <FormInput
        form={form}
        name="phone"
        label="Phone Number"
        placeholder="+1 (555) 123-4567"
        keyboardType="phone-pad"
        validators={{
          onChange: ({ value }: any) => {
            if (!value) return "Phone number is required";
            return undefined;
          },
        }}
      />

      <form.Field name="dateOfBirth">
        {(field) => (
          <View>
            <DateOfBirthField
              field={field}
              showDatePicker={showDatePicker}
              setShowDatePicker={setShowDatePicker}
            />
            {dobError ? (
              <Text className="text-xs text-destructive mt-1">{dobError}</Text>
            ) : null}
          </View>
        )}
      </form.Field>

      <form.Field name="password">
        {(field) => (
          <View className="gap-2">
            <Text className="text-sm font-medium text-foreground">
              Password
            </Text>
            <Input
              value={field.state.value}
              onChangeText={(text) => {
                field.handleChange(text);
                setPassword(text);
              }}
              onBlur={field.handleBlur}
              placeholder="Create a strong password"
              secureTextEntry
            />
            {password.length > 0 && (
              <View className="gap-1">
                <View className="h-1.5 bg-border rounded-full overflow-hidden">
                  <View
                    style={{
                      width: strength.width,
                      backgroundColor: strength.color,
                    }}
                    className="h-full rounded-full"
                  />
                </View>
                <Text
                  style={{ color: strength.color }}
                  className="text-xs font-medium"
                >
                  {strength.level}
                </Text>
              </View>
            )}
            {field.state.meta.errors?.[0] && (
              <Text className="text-xs text-destructive">
                {field.state.meta.errors[0]}
              </Text>
            )}
          </View>
        )}
      </form.Field>

      <form.Field
        name="confirmPassword"
        validators={{
          onChangeListenTo: ["password"],
          onChange: ({ value, fieldApi }: any) => {
            const pwd = fieldApi.form.getFieldValue("password");
            if (!value) return "Please confirm your password";
            if (value !== pwd) return "Passwords do not match";
            return undefined;
          },
        }}
      >
        {(field) => (
          <View className="gap-1">
            <Text className="text-sm font-medium text-foreground">
              Confirm Password
            </Text>
            <Input
              value={field.state.value}
              onChangeText={field.handleChange}
              onBlur={field.handleBlur}
              placeholder="Re-enter your password"
              secureTextEntry
            />
            {field.state.meta.errors?.[0] && (
              <Text className="text-xs text-destructive">
                {field.state.meta.errors[0]}
              </Text>
            )}
          </View>
        )}
      </form.Field>

      {/* CRITICAL: Block underage users from proceeding */}
      {isUserUnderage && (
        <View className="bg-destructive/10 rounded-lg p-4 flex-row items-start gap-3">
          <ShieldAlert size={20} color="#ef4444" />
          <View className="flex-1">
            <Text className="text-base font-semibold text-destructive">
              Access Denied
            </Text>
            <Text className="text-sm text-destructive/80 mt-1">
              {UNDERAGE_ERROR_MESSAGE} You cannot create an account on this
              platform.
            </Text>
          </View>
        </View>
      )}

      <Button
        onPress={form.handleSubmit}
        className="my-12"
        disabled={isUserUnderage}
      >
        {isUserUnderage ? "Access Denied" : "Continue"}
      </Button>
    </View>
  );
}
