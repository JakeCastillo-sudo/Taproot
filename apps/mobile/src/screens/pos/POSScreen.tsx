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
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { catalogApi, type ApiProduct, type OrderRow } from '../../api/endpoints';
import { useAuthStore } from '../../store/auth.store';
import { useCartStore, cartSubtotal, lineTotal } from '../../store/cart.store';
import { formatCents } from '../../utils/currency';
import { colors, spacing, radius, fontSize } from '../../utils/colors';
import ModifierSheet from '../../components/ModifierSheet';
import PaymentSheet from '../../components/PaymentSheet';

export default function POSScreen() {
  const user = useAuthStore((s) => s.user);
  const locationId = useAuthStore((s) => s.locationId);
  const logout = useAuthStore((s) => s.logout);
  const setSwitchingUser = useAuthStore((s) => s.setSwitchingUser);
  const qc = useQueryClient();

  const items = useCartStore((s) => s.items);
  const add = useCartStore((s) => s.add);
  const updateLine = useCartStore((s) => s.updateLine);
  const inc = useCartStore((s) => s.inc);
  const dec = useCartStore((s) => s.dec);
  const clear = useCartStore((s) => s.clear);

  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [modifierProduct, setModifierProduct] = useState<ApiProduct | null>(null);
  // When set, the sheet is editing an existing cart line (by key) rather than adding.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);

  const editingItem = editingKey ? items.find((i) => i.key === editingKey) ?? null : null;

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
    if (p.modifierGroups.length > 0) {
      // Has options → collect selections before adding.
      setEditingKey(null);
      setModifierProduct(p);
    } else {
      add({ productId: p.id, name: p.name, basePrice: p.defaultPrice });
    }
  }

  function startEdit(item: (typeof items)[number]) {
    // Re-open the sheet for an existing line. Needs the full product (modifier
    // groups), which we look up in the loaded list for the current category.
    const product = (productsQuery.data ?? []).find((p) => p.id === item.productId);
    if (!product || product.modifierGroups.length === 0) {
      Alert.alert('Open this item’s category to edit its options.');
      return;
    }
    Haptics.selectionAsync().catch(() => {});
    setEditingKey(item.key);
    setModifierProduct(product);
  }

  function onPaid(order: OrderRow) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    clear();
    setPaymentOpen(false);
    // Refresh kitchen tickets so the new order appears there.
    qc.invalidateQueries({ queryKey: ['kitchen'] });
    Alert.alert('Paid', `Order ${order.order_number} — ${formatCents(order.total)}`);
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
                {item.modifierGroups.length > 0 && <Text style={styles.tileMod}>+ options</Text>}
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
                <View style={styles.cartNameCol}>
                  <Text style={styles.cartName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.modifiers.map((m) => (
                    <Text key={m.modifierId} style={styles.cartMod} numberOfLines={1}>
                      + {m.name}
                      {m.priceDelta !== 0 ? ` (${formatCents(m.priceDelta)})` : ''}
                    </Text>
                  ))}
                </View>
                {item.modifiers.length > 0 && (
                  <TouchableOpacity onPress={() => startEdit(item)} style={styles.editBtn} hitSlop={8}>
                    <Ionicons name="pencil-outline" size={16} color={colors.gray} />
                  </TouchableOpacity>
                )}
                <View style={styles.qtyControls}>
                  <TouchableOpacity onPress={() => dec(item.key)} style={styles.qtyBtn}>
                    <Text style={styles.qtyBtnText}>−</Text>
                  </TouchableOpacity>
                  <Text style={styles.qty}>{item.quantity}</Text>
                  <TouchableOpacity onPress={() => inc(item.key)} style={styles.qtyBtn}>
                    <Text style={styles.qtyBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.cartLineTotal}>{formatCents(lineTotal(item))}</Text>
              </View>
            )}
          />
          <TouchableOpacity
            style={styles.chargeBtn}
            onPress={() => setPaymentOpen(true)}
            activeOpacity={0.85}
          >
            <Text style={styles.chargeText}>
              Charge {formatCents(subtotal)} · {cartCount} item{cartCount === 1 ? '' : 's'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <ModifierSheet
        product={modifierProduct}
        seedKey={editingKey ?? modifierProduct?.id}
        initialModifiers={editingItem?.modifiers}
        initialQuantity={editingItem?.quantity}
        onClose={() => {
          setModifierProduct(null);
          setEditingKey(null);
        }}
        onAdd={(modifiers, quantity) => {
          if (modifierProduct) {
            if (editingKey) {
              updateLine(editingKey, modifiers, quantity);
            } else {
              add(
                {
                  productId: modifierProduct.id,
                  name: modifierProduct.name,
                  basePrice: modifierProduct.defaultPrice,
                  modifiers,
                },
                quantity,
              );
            }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          }
          setModifierProduct(null);
          setEditingKey(null);
        }}
      />

      <PaymentSheet
        visible={paymentOpen}
        locationId={locationId}
        subtotal={subtotal}
        onClose={() => setPaymentOpen(false)}
        onPaid={onPaid}
      />
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
  cartNameCol: { flex: 1 },
  cartName: { fontSize: fontSize.md, color: colors.dark },
  cartMod: { fontSize: fontSize.xs, color: colors.gray },
  editBtn: { padding: spacing.xs, marginLeft: spacing.xs },
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
