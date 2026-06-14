import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { kitchenApi, type KitchenTicket } from '../../api/endpoints';
import { useAuthStore } from '../../store/auth.store';
import { colors, spacing, radius, fontSize } from '../../utils/colors';

/** Elapsed-time color, mirroring the web KDS (green <5, amber 5–10, red >10). */
function elapsedColor(minutes: number): string {
  if (minutes > 10) return colors.danger;
  if (minutes >= 5) return colors.warning;
  return colors.success;
}

export default function KitchenScreen() {
  const locationId = useAuthStore((s) => s.locationId);
  const qc = useQueryClient();

  const ticketsQuery = useQuery({
    queryKey: ['kitchen', locationId],
    queryFn: () => kitchenApi.tickets(locationId ?? undefined),
    refetchInterval: 5000, // poll like the web KDS
  });

  const itemReady = useMutation({
    mutationFn: (itemId: string) => kitchenApi.itemReady(itemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kitchen'] }),
  });

  const bump = useMutation({
    mutationFn: (orderId: string) => kitchenApi.bump(orderId),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      qc.invalidateQueries({ queryKey: ['kitchen'] });
    },
  });

  function renderTicket({ item: ticket }: { item: KitchenTicket }) {
    const allReady = ticket.items.length > 0 && ticket.items.every((i) => i.ready);
    return (
      <View style={styles.ticket}>
        <View style={styles.ticketHeader}>
          <Text style={styles.orderNumber}>#{ticket.orderNumber}</Text>
          <Text style={[styles.elapsed, { color: elapsedColor(ticket.minutesOpen) }]}>
            {ticket.minutesOpen}m
          </Text>
        </View>
        {ticket.tableName && <Text style={styles.table}>{ticket.tableName}</Text>}

        {ticket.items.map((it) => (
          <TouchableOpacity
            key={it.id}
            style={styles.item}
            onPress={() => itemReady.mutate(it.id)}
            activeOpacity={0.7}
          >
            <Text style={[styles.itemQty, it.ready && styles.itemDone]}>{it.quantity}×</Text>
            <View style={styles.flex}>
              <Text style={[styles.itemName, it.ready && styles.itemDone]}>{it.name}</Text>
              {it.modifiers.map((m, idx) => (
                <Text key={idx} style={styles.modifier}>
                  + {m.name}
                </Text>
              ))}
              {it.specialInstructions && (
                <Text style={styles.special}>⚠ {it.specialInstructions}</Text>
              )}
            </View>
          </TouchableOpacity>
        ))}

        <TouchableOpacity
          style={[styles.bumpBtn, allReady && styles.bumpReady]}
          onPress={() => bump.mutate(ticket.id)}
        >
          <Text style={styles.bumpText}>{allReady ? '✓ Bump (all ready)' : 'Bump order'}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Kitchen</Text>
        {ticketsQuery.isFetching && <ActivityIndicator color={colors.primaryMid} />}
      </View>

      {ticketsQuery.isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={ticketsQuery.data ?? []}
          keyExtractor={(t) => t.id}
          numColumns={2}
          contentContainerStyle={styles.grid}
          renderItem={renderTicket}
          ListEmptyComponent={
            <Text style={styles.empty}>No open tickets. New orders appear here.</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.dark },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  title: { fontSize: fontSize.xxl, fontWeight: '800', color: colors.white },
  grid: { padding: spacing.sm },
  ticket: {
    flex: 1 / 2,
    margin: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.darkMid,
  },
  ticketHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  orderNumber: { fontSize: fontSize.lg, fontWeight: '800', color: colors.white },
  elapsed: { fontSize: fontSize.lg, fontWeight: '800' },
  table: { fontSize: fontSize.sm, color: colors.primaryMid, marginBottom: spacing.sm },
  item: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.sm },
  itemQty: { fontSize: fontSize.lg, fontWeight: '800', color: colors.primaryMid },
  itemName: { fontSize: fontSize.md, fontWeight: '600', color: colors.white },
  itemDone: { textDecorationLine: 'line-through', color: colors.gray },
  modifier: { fontSize: fontSize.sm, color: colors.grayLight },
  special: { fontSize: fontSize.sm, color: colors.warning, marginTop: spacing.xs },
  bumpBtn: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.gray,
    alignItems: 'center',
  },
  bumpReady: { backgroundColor: colors.success },
  bumpText: { color: colors.white, fontWeight: '700', fontSize: fontSize.md },
  empty: { color: colors.grayLight, textAlign: 'center', marginTop: spacing.xxl, width: '100%' },
});
