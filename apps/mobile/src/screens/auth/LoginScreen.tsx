import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/auth.store';
import { ApiError } from '../../api/client';
import { colors, spacing, radius, fontSize } from '../../utils/colors';

export default function LoginScreen() {
  const login = useAuthStore((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  async function onSubmit() {
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      // Auth store flips status → AppNavigator swaps to the authed shell.
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.status === 401
            ? 'Incorrect email or password.'
            : e.message
          : 'Could not reach the server. Check your connection.';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.container}>
          <Text style={styles.logo}>🌿 Taproot</Text>
          <Text style={styles.subtitle}>Point of Sale</Text>

          <View style={styles.form}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="you@restaurant.com"
              placeholderTextColor={colors.gray}
              editable={!busy}
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="••••••••"
              placeholderTextColor={colors.gray}
              editable={!busy}
              onSubmitEditing={() => canSubmit && onSubmit()}
              returnKeyType="go"
            />

            {error && <Text style={styles.error}>{error}</Text>}

            <TouchableOpacity
              style={[styles.button, !canSubmit && styles.buttonDisabled]}
              onPress={onSubmit}
              disabled={!canSubmit}
              activeOpacity={0.85}
            >
              {busy ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.buttonText}>Sign in</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  flex: { flex: 1 },
  container: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg },
  logo: { fontSize: fontSize.xxxl, fontWeight: '800', color: colors.primary, textAlign: 'center' },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.gray,
    textAlign: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
  },
  form: { gap: spacing.sm },
  label: { fontSize: fontSize.sm, fontWeight: '600', color: colors.darkMid, marginTop: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSize.lg,
    color: colors.dark,
    backgroundColor: colors.white,
  },
  error: { color: colors.danger, fontSize: fontSize.sm, marginTop: spacing.sm },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.white, fontSize: fontSize.lg, fontWeight: '700' },
});
