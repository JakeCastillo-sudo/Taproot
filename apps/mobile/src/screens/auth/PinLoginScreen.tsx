import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useAuthStore } from '../../store/auth.store';
import { employeesApi, type SelectableEmployee } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import { colors, spacing, radius, fontSize } from '../../utils/colors';

const PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

/**
 * PIN switch-user screen. Rendered over the authed shell when
 * auth.switchingUser is true. The device is already authenticated, so this swaps
 * the active employee via /auth/pin-login.
 */
export default function PinLoginScreen() {
  const pinLogin = useAuthStore((s) => s.pinLogin);
  const setSwitchingUser = useAuthStore((s) => s.setSwitchingUser);

  const [roster, setRoster] = useState<SelectableEmployee[] | null>(null);
  const [selected, setSelected] = useState<SelectableEmployee | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    employeesApi
      .selectable()
      .then(setRoster)
      .catch(() => setRoster([]));
  }, []);

  async function submit(fullPin: string, emp: SelectableEmployee) {
    setBusy(true);
    setError(null);
    try {
      await pinLogin(emp.id, fullPin);
      // success → store flips switchingUser off
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setError(e instanceof ApiError ? 'Incorrect PIN' : 'Could not sign in');
      setPin('');
      setBusy(false);
    }
  }

  function press(key: string) {
    if (busy || !selected) return;
    if (key === '⌫') {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (key === '') return;
    const next = (pin + key).slice(0, 6);
    setPin(next);
    if (next.length >= 4) {
      // Auto-submit at 4 digits (PINs are 4–6; try at 4, server validates).
      void submit(next, selected);
    }
  }

  if (roster === null) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>{selected ? `Enter PIN` : 'Switch user'}</Text>
        <TouchableOpacity onPress={() => setSwitchingUser(false)}>
          <Text style={styles.cancel}>Cancel</Text>
        </TouchableOpacity>
      </View>

      {!selected ? (
        <FlatList
          data={roster}
          keyExtractor={(e) => e.id}
          numColumns={2}
          contentContainerStyle={styles.grid}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.empCard} onPress={() => setSelected(item)}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {item.first_name[0]}
                  {item.last_name[0]}
                </Text>
              </View>
              <Text style={styles.empName}>
                {item.first_name} {item.last_name}
              </Text>
              <Text style={styles.empRole}>{item.role}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No employees found.</Text>}
        />
      ) : (
        <View style={styles.pinArea}>
          <Text style={styles.empName}>
            {selected.first_name} {selected.last_name}
          </Text>
          <View style={styles.dots}>
            {Array.from({ length: 6 }).map((_, i) => (
              <View key={i} style={[styles.dot, i < pin.length && styles.dotFilled]} />
            ))}
          </View>
          {error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.pad}>
            {PAD.map((key, i) => (
              <TouchableOpacity
                key={i}
                style={[styles.key, key === '' && styles.keyEmpty]}
                onPress={() => press(key)}
                disabled={key === '' || busy}
                activeOpacity={0.7}
              >
                <Text style={styles.keyText}>{key}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity onPress={() => { setSelected(null); setPin(''); setError(null); }}>
            <Text style={styles.cancel}>Choose someone else</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: fontSize.xl, fontWeight: '700', color: colors.dark },
  cancel: { fontSize: fontSize.md, color: colors.primary, fontWeight: '600' },
  grid: { padding: spacing.md, gap: spacing.md },
  empCard: {
    flex: 1,
    margin: spacing.xs,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.grayLight,
    alignItems: 'center',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  avatarText: { color: colors.white, fontSize: fontSize.xl, fontWeight: '700' },
  empName: { fontSize: fontSize.lg, fontWeight: '700', color: colors.dark, textAlign: 'center' },
  empRole: { fontSize: fontSize.sm, color: colors.gray, textTransform: 'capitalize' },
  empty: { textAlign: 'center', color: colors.gray, marginTop: spacing.xl },
  pinArea: { flex: 1, alignItems: 'center', paddingTop: spacing.xl },
  dots: { flexDirection: 'row', gap: spacing.md, marginVertical: spacing.lg },
  dot: {
    width: 16,
    height: 16,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  dotFilled: { backgroundColor: colors.primary },
  error: { color: colors.danger, fontSize: fontSize.md, marginBottom: spacing.sm },
  pad: { width: 280, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  key: {
    width: 80,
    height: 80,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    margin: spacing.xs,
    backgroundColor: colors.grayLight,
  },
  keyEmpty: { backgroundColor: 'transparent' },
  keyText: { fontSize: fontSize.xxl, fontWeight: '600', color: colors.dark },
});
