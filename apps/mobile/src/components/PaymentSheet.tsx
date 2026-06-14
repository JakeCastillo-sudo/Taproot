import { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CardField, useStripe } from '@stripe/stripe-react-native';
import { ordersApi, paymentsApi, type OrderRow } from '../api/endpoints';
import { STRIPE_PUBLISHABLE_KEY } from '../api/config';
import { useCartStore } from '../store/cart.store';
import { formatCents } from '../utils/currency';
import { colors, spacing, radius, fontSize } from '../utils/colors';

type Method = 'cash' | 'card';

interface Props {
  visible: boolean;
  locationId: string | null;
  subtotal: number; // preview (cents)
  onClose: () => void;
  onPaid: (order: OrderRow) => void;
}

const stripeReady =
  STRIPE_PUBLISHABLE_KEY.length > 0 && !STRIPE_PUBLISHABLE_KEY.includes('REPLACE');

/**
 * Payment sheet. Creates the order (server-authoritative totals) then charges it.
 * Cash records immediately; Card tokenizes via Stripe (CardField → PaymentMethod)
 * and sends stripePaymentMethodId, which the API confirms into a PaymentIntent.
 */
export default function PaymentSheet({ visible, locationId, subtotal, onClose, onPaid }: Props) {
  const { createPaymentMethod } = useStripe();
  const items = useCartStore((s) => s.items);

  const [method, setMethod] = useState<Method>('cash');
  const [cardComplete, setCardComplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    if (!locationId) {
      setError('Your account has no assigned location.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Card: tokenize first so a failure never leaves an orphan order.
      let stripePaymentMethodId: string | undefined;
      if (method === 'card') {
        const { paymentMethod, error: pmError } = await createPaymentMethod({
          paymentMethodType: 'Card',
        });
        if (pmError || !paymentMethod) {
          throw new Error(pmError?.message ?? 'Card entry incomplete');
        }
        stripePaymentMethodId = paymentMethod.id;
      }

      const order = await ordersApi.create(locationId, {
        items: items.map((i) => ({
          productId: i.productId,
          variantId: null,
          quantity: i.quantity,
          unitPrice: i.basePrice,
          modifiers: i.modifiers,
        })),
      });

      await paymentsApi.process(
        locationId,
        order.id,
        method === 'card'
          ? { paymentMethod: 'credit_card', amount: order.total, stripePaymentMethodId }
          : { paymentMethod: 'cash', amount: order.total, cashTendered: order.total },
      );

      onPaid(order);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed');
    } finally {
      setBusy(false);
    }
  }

  const canPay = !busy && items.length > 0 && (method === 'cash' || (stripeReady && cardComplete));

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.header}>
            <Text style={styles.title}>Payment</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8} disabled={busy}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.amount}>{formatCents(subtotal)}</Text>
          <Text style={styles.amountNote}>Subtotal — tax added at checkout</Text>

          {/* Method toggle */}
          <View style={styles.methods}>
            <TouchableOpacity
              style={[styles.methodBtn, method === 'cash' && styles.methodActive]}
              onPress={() => setMethod('cash')}
              disabled={busy}
            >
              <Text style={[styles.methodText, method === 'cash' && styles.methodTextActive]}>Cash</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.methodBtn, method === 'card' && styles.methodActive]}
              onPress={() => setMethod('card')}
              disabled={busy}
            >
              <Text style={[styles.methodText, method === 'card' && styles.methodTextActive]}>Card</Text>
            </TouchableOpacity>
          </View>

          {method === 'card' && (
            <View style={styles.cardArea}>
              <CardField
                postalCodeEnabled={false}
                placeholders={{ number: '4242 4242 4242 4242' }}
                style={styles.cardField}
                cardStyle={{ textColor: colors.dark, fontSize: fontSize.lg }}
                onCardChange={(d) => setCardComplete(d.complete)}
              />
              {!stripeReady && (
                <Text style={styles.warn}>
                  Stripe key not configured (EXPO_PUBLIC_STRIPE_KEY) — card charges are
                  inert until a real key is set.
                </Text>
              )}
            </View>
          )}

          {error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity
            style={[styles.payBtn, !canPay && styles.payBtnDisabled]}
            onPress={pay}
            disabled={!canPay}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.payText}>
                {method === 'card' ? 'Charge card' : 'Take cash'}
              </Text>
            )}
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.dark },
  close: { fontSize: fontSize.xl, color: colors.gray, paddingHorizontal: spacing.sm },
  amount: { fontSize: fontSize.stat, fontWeight: '800', color: colors.dark, textAlign: 'center' },
  amountNote: { fontSize: fontSize.sm, color: colors.gray, textAlign: 'center', marginBottom: spacing.lg },
  methods: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  methodBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
  },
  methodActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  methodText: { fontSize: fontSize.lg, fontWeight: '700', color: colors.darkMid },
  methodTextActive: { color: colors.primaryDark },
  cardArea: { marginBottom: spacing.md },
  cardField: { width: '100%', height: 50, marginVertical: spacing.sm },
  warn: { fontSize: fontSize.xs, color: colors.warning },
  error: { color: colors.danger, fontSize: fontSize.sm, marginBottom: spacing.sm, textAlign: 'center' },
  payBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  payBtnDisabled: { opacity: 0.5 },
  payText: { color: colors.white, fontSize: fontSize.lg, fontWeight: '700' },
});
