import { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { catalogApi, ordersApi, paymentsApi, type ApiProduct } from '../../api/endpoints';
import { useAuthStore } from '../../store/auth.store';
import { useCartStore, cartSubtotal } from '../../store/cart.store';
import { formatCents } from '../../utils/currency';
import { colors, spacing, radius, fontSize } from '../../utils/colors';

export default function POSScreen() {
  const user = useAuthStore((s) => s.user);
  const locationId = useAuthStore((s) => s.locationId);
  const logout = useAuthStore((s) => s.logout);
  const setSwitchingUser = useAuthStore((s) => s.setSwitchingUser);
  const qc = useQueryClient();

  const items = useCartStore((s) => s.items);
  const add = useCartStore((s) => s.add);
  const inc = useCartStore((s) => s.inc);
  const dec = useCartStore((s) => s.dec);
  const clear = useCartStore((s) => s.clear);

  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [charging, setCharging] = useState(false);

  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => catalogApi.categories(),
  });

  const productsQuery = useQuery({
    queryKey: ['products', activeCategory],
    queryFn: () => catalogApi.products({ categoryId: activeCategory ?? undefined }),
  });

  const subtotal = useMemo(() => cartSubtotal(items), [items]);
  const cartCount = items.reduce((n, i) => n + i.quantity, 0);

  function onTapProduct(p: ApiProduct) {
    Haptics.selectionAsync().catch(() => {});
    add({ productId: p.id, name: p.name, unitPrice: p.defaultPrice });
  }

  async function charge() {
    if (!locationId) {
      Alert.alert('No location', 'Your account has no assigned location.');
      return;
    }
    if (items.length === 0) return;

    setCharging(true);
    try {
      const order = await ordersApi.create(locationId, {
        items: items.map((i) => ({
          productId: i.productId,
          variantId: null,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
        })),
      });
      // Server is authoritative for totals (tax/discounts). Charge order.total as cash.
      await paymentsApi.process(locationId, order.id, {
        paymentMethod: 'cash',
        amount: order.total,
        cashTendered: order.total,
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      clear();
      // Refresh kitchen tickets so the new order appears there.
      qc.invalidateQueries({ queryKey: ['kitchen'] });
      Alert.alert('Paid', `Order ${order.order_number} — ${formatCents(order.total)} (cash)`);
    } catch (e) {
      Alert.alert('Payment failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setCharging(false);
    }
  }

  function confirmCharge() {
    Alert.alert(
      'Take cash payment',
      `Charge ${formatCents(subtotal)} subtotal (tax added at checkout)?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Charge', onPress: () => void charge() },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>{user ? `${user.firstName} ${user.lastName}` : 'POS'}</Text>
          <Text style={styles.role}>{user?.role}</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => setSwitchingUser(true)} style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>Switch</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => void logout()} style={styles.headerBtn}>
            <Text style={[styles.headerBtnText, { color: colors.danger }]}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Category chips */}
      <View style={styles.chipRow}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={[{ id: '__all', name: 'All' }, ...(categoriesQuery.data ?? [])]}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.chipContent}
          renderItem={({ item }) => {
            const id = item.id === '__all' ? null : item.id;
            const active = activeCategory === id;
            return (
              <TouchableOpacity
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setActiveCategory(id)}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{item.name}</Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {/* Product grid */}
      <View style={styles.flex}>
        {productsQuery.isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : productsQuery.isError ? (
          <View style={styles.centered}>
            <Text style={styles.muted}>Could not load products.</Text>
            <TouchableOpacity onPress={() => productsQuery.refetch()}>
              <Text style={styles.link}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={productsQuery.data ?? []}
            keyExtractor={(p) => p.id}
            numColumns={3}
            contentContainerStyle={styles.gridContent}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.tile} onPress={() => onTapProduct(item)} activeOpacity={0.8}>
                <Text style={styles.tileName} numberOfLines={2}>
                  {item.name}
                </Text>
                <Text style={styles.tilePrice}>{formatCents(item.defaultPrice)}</Text>
                {item.hasModifiers && <Text style={styles.tileMod}>+ options</Text>}
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={styles.empty}>No products in this category.</Text>}
          />
        )}
      </View>

      {/* Cart summary bar */}
      {cartCount > 0 && (
        <View style={styles.cartBar}>
          <FlatList
            data={items}
            keyExtractor={(i) => i.key}
            style={styles.cartList}
            renderItem={({ item }) => (
              <View style={styles.cartRow}>
                <Text style={styles.cartName} numberOfLines={1}>
                  {item.name}
                </Text>
                <View style={styles.qtyControls}>
                  <TouchableOpacity onPress={() => dec(item.key)} style={styles.qtyBtn}>
                    <Text style={styles.qtyBtnText}>−</Text>
                  </TouchableOpacity>
                  <Text style={styles.qty}>{item.quantity}</Text>
                  <TouchableOpacity onPress={() => inc(item.key)} style={styles.qtyBtn}>
                    <Text style={styles.qtyBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.cartLineTotal}>{formatCents(item.unitPrice * item.quantity)}</Text>
              </View>
            )}
          />
          <TouchableOpacity
            style={[styles.chargeBtn, charging && styles.buttonDisabled]}
            onPress={confirmCharge}
            disabled={charging}
            activeOpacity={0.85}
          >
            {charging ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.chargeText}>
                Charge {formatCents(subtotal)} · {cartCount} item{cartCount === 1 ? '' : 's'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  muted: { color: colors.gray, fontSize: fontSize.md },
  link: { color: colors.primary, fontSize: fontSize.md, fontWeight: '600' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  greeting: { fontSize: fontSize.lg, fontWeight: '700', color: colors.dark },
  role: { fontSize: fontSize.xs, color: colors.gray, textTransform: 'capitalize' },
  headerActions: { flexDirection: 'row', gap: spacing.md },
  headerBtn: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  headerBtnText: { fontSize: fontSize.md, color: colors.primary, fontWeight: '600' },
  chipRow: { borderBottomWidth: 1, borderBottomColor: colors.border },
  chipContent: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.grayLight,
    marginRight: spacing.sm,
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.darkMid },
  chipTextActive: { color: colors.white },
  gridContent: { padding: spacing.sm },
  tile: {
    flex: 1 / 3,
    margin: spacing.xs,
    minHeight: 96,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    justifyContent: 'space-between',
  },
  tileName: { fontSize: fontSize.sm, fontWeight: '700', color: colors.dark },
  tilePrice: { fontSize: fontSize.md, fontWeight: '700', color: colors.primaryDark },
  tileMod: { fontSize: fontSize.xs, color: colors.gray },
  empty: { textAlign: 'center', color: colors.gray, marginTop: spacing.xl, width: '100%' },
  cartBar: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  cartList: { maxHeight: 160 },
  cartRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
  cartName: { flex: 1, fontSize: fontSize.md, color: colors.dark },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.md },
  qtyBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.grayLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnText: { fontSize: fontSize.xl, color: colors.dark, fontWeight: '600' },
  qty: { fontSize: fontSize.md, fontWeight: '700', minWidth: 20, textAlign: 'center' },
  cartLineTotal: { fontSize: fontSize.md, fontWeight: '700', color: colors.dark, minWidth: 64, textAlign: 'right' },
  chargeBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonDisabled: { opacity: 0.6 },
  chargeText: { color: colors.white, fontSize: fontSize.lg, fontWeight: '700' },
});
