import { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TextInput,
  RefreshControl,
  Modal,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { ordersApi, type OrderHistoryRow } from '../../api/endpoints';
import { formatCents } from '../../utils/currency';
import { colors, spacing, radius, fontSize } from '../../utils/colors';

type DatePreset = 'today' | '7d' | '30d' | 'all';
const STATUSES = ['all', 'completed', 'voided', 'refunded'] as const;
const PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'all', label: 'All' },
];

/** Build a {from,to} ISO range for a preset. App runtime — new Date() is fine. */
function presetRange(p: DatePreset): { from?: string; to?: string } {
  if (p === 'all') return {};
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (p === 'today') return { from: start.toISOString() };
  const days = p === '7d' ? 7 : 30;
  start.setDate(start.getDate() - (days - 1));
  return { from: start.toISOString() };
}

function statusColor(status: string): string {
  if (status === 'completed') return colors.success;
  if (status === 'voided') return colors.danger;
  if (status === 'refunded' || status === 'partially_refunded') return colors.warning;
  return colors.gray;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function OrdersScreen() {
  const [status, setStatus] = useState<string>('all');
  const [preset, setPreset] = useState<DatePreset>('7d');
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);

  const range = useMemo(() => presetRange(preset), [preset]);

  const ordersQuery = useQuery({
    queryKey: ['orders', 'history', { status, preset, search }],
    queryFn: () =>
      ordersApi.history({
        status,
        from: range.from,
        to: range.to,
        search: search.trim() || undefined,
        limit: 100,
      }),
  });

  const orders = ordersQuery.data?.orders ?? [];

  function renderRow({ item }: { item: OrderHistoryRow }) {
    return (
      <TouchableOpacity style={styles.row} onPress={() => setDetailId(item.id)} activeOpacity={0.7}>
        <View style={styles.rowMain}>
          <Text style={styles.orderNum}>#{item.order_number}</Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {fmtTime(item.created_at)} · {item.item_count} item{item.item_count === 1 ? '' : 's'}
            {item.employee_name ? ` · ${item.employee_name}` : ''}
          </Text>
          {item.payment_methods && (
            <Text style={styles.payMethods}>{item.payment_methods.replace(/_/g, ' ')}</Text>
          )}
        </View>
        <View style={styles.rowRight}>
          <Text style={styles.rowTotal}>{formatCents(item.total)}</Text>
          <View style={[styles.badge, { backgroundColor: statusColor(item.status) }]}>
            <Text style={styles.badgeText}>{item.status.replace(/_/g, ' ')}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Orders</Text>
        {ordersQuery.isFetching && !ordersQuery.isLoading && (
          <ActivityIndicator color={colors.primaryMid} />
        )}
      </View>

      <TextInput
        style={styles.search}
        value={search}
        onChangeText={setSearch}
        placeholder="Search order #, customer…"
        placeholderTextColor={colors.gray}
        autoCapitalize="none"
        returnKeyType="search"
      />

      {/* Status chips */}
      <View style={styles.chipRow}>
        {STATUSES.map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.chip, status === s && styles.chipActive]}
            onPress={() => setStatus(s)}
          >
            <Text style={[styles.chipText, status === s && styles.chipTextActive]}>{s}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Date preset chips */}
      <View style={styles.chipRow}>
        {PRESETS.map((p) => (
          <TouchableOpacity
            key={p.key}
            style={[styles.chip, preset === p.key && styles.chipActive]}
            onPress={() => setPreset(p.key)}
          >
            <Text style={[styles.chipText, preset === p.key && styles.chipTextActive]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {ordersQuery.isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : ordersQuery.isError ? (
        <View style={styles.centered}>
          <Text style={styles.muted}>Could not load orders.</Text>
          <TouchableOpacity onPress={() => ordersQuery.refetch()}>
            <Text style={styles.link}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          renderItem={renderRow}
          contentContainerStyle={orders.length === 0 && styles.flexGrow}
          refreshControl={
            <RefreshControl refreshing={ordersQuery.isFetching} onRefresh={() => ordersQuery.refetch()} />
          }
          ListEmptyComponent={<Text style={styles.empty}>No orders for this filter.</Text>}
        />
      )}

      <OrderDetailModal orderId={detailId} onClose={() => setDetailId(null)} />
    </SafeAreaView>
  );
}

function OrderDetailModal({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const receiptQuery = useQuery({
    queryKey: ['orders', 'receipt', orderId],
    queryFn: () => ordersApi.receipt(orderId as string),
    enabled: !!orderId,
  });
  const r = receiptQuery.data;

  return (
    <Modal visible={!!orderId} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{r ? `Order #${r.orderNumber}` : 'Order'}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>

          {receiptQuery.isLoading || !r ? (
            <View style={styles.detailLoading}>
              <ActivityIndicator color={colors.primary} size="large" />
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.detailBody}>
              <Text style={styles.detailMeta}>
                {fmtTime(r.createdAt)} · {r.employeeName}
                {r.customerName ? ` · ${r.customerName}` : ''}
              </Text>

              {r.lineItems.map((li, i) => (
                <View key={i} style={[styles.liRow, li.voided && styles.liVoided]}>
                  <Text style={styles.liQty}>{li.quantity}×</Text>
                  <View style={styles.flex}>
                    <Text style={styles.liName}>{li.name}</Text>
                    {li.modifiers.map((m, j) => (
                      <Text key={j} style={styles.liMod}>
                        + {m.name}
                      </Text>
                    ))}
                  </View>
                  <Text style={styles.liTotal}>{formatCents(li.total)}</Text>
                </View>
              ))}

              <View style={styles.divider} />
              <TotalRow label="Subtotal" value={r.subtotal} />
              {r.discountTotal > 0 && <TotalRow label="Discount" value={-r.discountTotal} />}
              <TotalRow label="Tax" value={r.taxTotal} />
              {r.tipTotal > 0 && <TotalRow label="Tip" value={r.tipTotal} />}
              <TotalRow label="Total" value={r.total} bold />
              <TotalRow label="Paid" value={r.amountPaid} />
              {r.changeDue > 0 && <TotalRow label="Change" value={r.changeDue} />}

              <View style={styles.divider} />
              {r.payments.map((p, i) => (
                <View key={i} style={styles.payRow}>
                  <Text style={styles.payLabel}>
                    {p.method.replace(/_/g, ' ')}
                    {p.brand ? ` · ${p.brand} ····${p.last4}` : ''}
                  </Text>
                  <Text style={styles.payAmt}>{formatCents(p.amount + p.tipAmount)}</Text>
                </View>
              ))}
            </ScrollView>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function TotalRow({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <View style={styles.totalRow}>
      <Text style={[styles.totalLabel, bold && styles.totalBold]}>{label}</Text>
      <Text style={[styles.totalValue, bold && styles.totalBold]}>{formatCents(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  flex: { flex: 1 },
  flexGrow: { flexGrow: 1, justifyContent: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  muted: { color: colors.gray, fontSize: fontSize.md },
  link: { color: colors.primary, fontSize: fontSize.md, fontWeight: '600' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  title: { fontSize: fontSize.xxl, fontWeight: '800', color: colors.dark },
  search: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
    color: colors.dark,
  },
  chipRow: { flexDirection: 'row', paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.grayLight,
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.darkMid, textTransform: 'capitalize' },
  chipTextActive: { color: colors.white },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowMain: { flex: 1, gap: 2 },
  orderNum: { fontSize: fontSize.lg, fontWeight: '700', color: colors.dark },
  rowMeta: { fontSize: fontSize.sm, color: colors.gray },
  payMethods: { fontSize: fontSize.xs, color: colors.gray, textTransform: 'capitalize' },
  rowRight: { alignItems: 'flex-end', gap: spacing.xs },
  rowTotal: { fontSize: fontSize.lg, fontWeight: '700', color: colors.dark },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.full },
  badgeText: { fontSize: fontSize.xs, color: colors.white, fontWeight: '700', textTransform: 'capitalize' },
  empty: { textAlign: 'center', color: colors.gray, fontSize: fontSize.md },
  // Detail modal
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '85%',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetTitle: { fontSize: fontSize.xl, fontWeight: '800', color: colors.dark },
  close: { fontSize: fontSize.xl, color: colors.gray, paddingHorizontal: spacing.sm },
  detailLoading: { padding: spacing.xxl, alignItems: 'center' },
  detailBody: { padding: spacing.md },
  detailMeta: { fontSize: fontSize.sm, color: colors.gray, marginBottom: spacing.md },
  liRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
  liVoided: { opacity: 0.4 },
  liQty: { fontSize: fontSize.md, fontWeight: '700', color: colors.primaryDark },
  liName: { fontSize: fontSize.md, color: colors.dark },
  liMod: { fontSize: fontSize.xs, color: colors.gray },
  liTotal: { fontSize: fontSize.md, color: colors.dark },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  totalLabel: { fontSize: fontSize.md, color: colors.gray },
  totalValue: { fontSize: fontSize.md, color: colors.dark },
  totalBold: { fontWeight: '800', color: colors.dark },
  payRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  payLabel: { fontSize: fontSize.md, color: colors.darkMid, textTransform: 'capitalize' },
  payAmt: { fontSize: fontSize.md, color: colors.dark, fontWeight: '600' },
});
