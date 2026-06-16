import { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CardField, useStripe } from '@stripe/stripe-react-native';
import { ordersApi, paymentsApi, type OrderRow } from '../api/endpoints';
import { STRIPE_PUBLISHABLE_KEY } from '../api/config';
import { useCartStore } from '../store/cart.store';
import { formatCents, parseCents } from '../utils/currency';
import { colors, spacing, radius, fontSize } from '../utils/colors';

type Method = 'cash' | 'card';
type Step = 'tip' | 'payment';

/** Preset tip percentages — 0 renders as "No Tip". */
const TIP_PRESETS = [0, 15, 18, 20, 25];

interface Props {
  visible: boolean;
  locationId: string | null;
  subtotal: number; // preview (cents) — tips are computed off this
  onClose: () => void;
  onPaid: (order: OrderRow) => void;
}

const stripeReady =
  STRIPE_PUBLISHABLE_KEY.length > 0 && !STRIPE_PUBLISHABLE_KEY.includes('REPLACE');

/**
 * Two-step payment sheet:
 *   1. Tip selection (presets off subtotal + custom amount)
 *   2. Payment method (cash / Stripe card)
 *
 * The order is created server-side (authoritative tax/total); tipAmount rides
 * alongside on the payment so the API records tip_total separately.
 */
export default function PaymentSheet({ visible, locationId, subtotal, onClose, onPaid }: Props) {
  const { createPaymentMethod } = useStripe();
  const items = useCartStore((s) => s.items);

  const [step, setStep] = useState<Step>('tip');
  const [tipAmount, setTipAmount] = useState(0);
  const [tipPct, setTipPct] = useState<number | null>(null); // null = custom active
  const [customTip, setCustomTip] = useState('');

  const [method, setMethod] = useState<Method>('cash');
  const [cardComplete, setCardComplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset to a clean tip step each time the sheet opens.
  useEffect(() => {
    if (visible) {
      setStep('tip');
      setTipAmount(0);
      setTipPct(null);
      setCustomTip('');
      setMethod('cash');
      setCardComplete(false);
      setError(null);
      setBusy(false);
    }
  }, [visible]);

  const customActive = customTip.trim() !== '';
  const effectivePct = subtotal > 0 ? Math.round((tipAmount / subtotal) * 100) : 0;
  const total = subtotal + tipAmount;

  function selectPreset(pct: number) {
    setCustomTip('');
    setTipPct(pct);
    setTipAmount(Math.round((subtotal * pct) / 100));
  }

  function onCustomChange(text: string) {
    setCustomTip(text);
    setTipPct(null);
    const cents = parseCents(text);
    setTipAmount(Number.isFinite(cents) ? Math.max(0, cents) : 0);
  }

  function skipTip() {
    setCustomTip('');
    setTipPct(0);
    setTipAmount(0);
    setStep('payment');
  }

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

      // amount = server total (incl. tax); tip is recorded separately.
      await paymentsApi.process(
        locationId,
        order.id,
        method === 'card'
          ? { paymentMethod: 'credit_card', amount: order.total, tipAmount, stripePaymentMethodId }
          : { paymentMethod: 'cash', amount: order.total, tipAmount, cashTendered: order.total },
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
          {/* Header */}
          <View style={styles.header}>
            {step === 'payment' ? (
              <TouchableOpacity onPress={() => setStep('tip')} hitSlop={8} disabled={busy}>
                <Text style={styles.back}>‹ Tip</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.title}>Add a tip?</Text>
            )}
            <TouchableOpacity onPress={onClose} hitSlop={8} disabled={busy}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>

          {step === 'tip' ? (
            <>
              <Text style={styles.subtitle}>For the team</Text>
              <Text style={styles.amount}>{formatCents(subtotal)}</Text>
              <Text style={styles.amountNote}>Order subtotal</Text>

              {/* Preset tip buttons */}
              <View style={styles.tipRow}>
                {TIP_PRESETS.map((pct) => {
                  const selected = !customActive && tipPct === pct;
                  const noTip = pct === 0;
                  return (
                    <TouchableOpacity
                      key={pct}
                      style={[styles.tipBtn, selected && styles.tipBtnActive, noTip && styles.tipBtnMuted]}
                      onPress={() => selectPreset(pct)}
                      activeOpacity={0.8}
                    >
                      {noTip ? (
                        <Text style={[styles.tipNoTip, selected && styles.tipTextActive]}>No Tip</Text>
                      ) : (
                        <>
                          <Text style={[styles.tipPct, selected && styles.tipTextActive]}>{pct}%</Text>
                          <Text style={[styles.tipAmt, selected && styles.tipTextActive]}>
                            {formatCents(Math.round((subtotal * pct) / 100))}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Custom tip */}
              <View style={[styles.customRow, customActive && styles.customRowActive]}>
                <Text style={styles.customLabel}>Custom</Text>
                <View style={styles.customInputWrap}>
                  <Text style={styles.dollar}>$</Text>
                  <TextInput
                    style={styles.customInput}
                    value={customTip}
                    onChangeText={onCustomChange}
                    placeholder="0.00"
                    placeholderTextColor={colors.gray}
                    keyboardType="decimal-pad"
                    returnKeyType="done"
                  />
                </View>
                {customActive && <Text style={styles.customPct}>{effectivePct}%</Text>}
              </View>

              {/* Summary */}
              <View style={styles.summary}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Subtotal</Text>
                  <Text style={styles.summaryValue}>{formatCents(subtotal)}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>
                    Tip{tipAmount > 0 ? ` (${effectivePct}%)` : ''}
                  </Text>
                  <Text style={styles.summaryValue}>{formatCents(tipAmount)}</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryTotalLabel}>Total</Text>
                  <Text style={styles.summaryTotalValue}>{formatCents(total)}</Text>
                </View>
                <Text style={styles.taxNote}>+ tax added at checkout</Text>
              </View>

              <TouchableOpacity style={styles.payBtn} onPress={() => setStep('payment')} activeOpacity={0.85}>
                <Text style={styles.payText}>Continue to Payment →</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={skipTip} style={styles.skipBtn}>
                <Text style={styles.skipText}>Skip tip</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.amount}>{formatCents(total)}</Text>
              <Text style={styles.amountNote}>
                {tipAmount > 0 ? `Incl. ${formatCents(tipAmount)} tip · ` : ''}tax added at checkout
              </Text>

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
                  <Text style={styles.payText}>Charge {formatCents(total)}</Text>
                )}
              </TouchableOpacity>
            </>
          )}
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
  back: { fontSize: fontSize.lg, color: colors.primary, fontWeight: '700' },
  close: { fontSize: fontSize.xl, color: colors.gray, paddingHorizontal: spacing.sm },
  subtitle: { fontSize: fontSize.sm, color: colors.gray, textAlign: 'center' },
  amount: { fontSize: fontSize.stat, fontWeight: '800', color: colors.dark, textAlign: 'center' },
  amountNote: { fontSize: fontSize.sm, color: colors.gray, textAlign: 'center', marginBottom: spacing.lg },

  // Tip presets
  tipRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md },
  tipBtn: {
    flex: 1,
    height: 72,
    borderRadius: radius.md,
    backgroundColor: colors.grayLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipBtnActive: { backgroundColor: colors.primary },
  tipBtnMuted: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border },
  tipPct: { fontSize: fontSize.lg, fontWeight: '800', color: colors.dark },
  tipAmt: { fontSize: fontSize.xs, color: colors.gray, marginTop: 2 },
  tipNoTip: { fontSize: fontSize.sm, fontWeight: '600', color: colors.gray, textAlign: 'center' },
  tipTextActive: { color: colors.white },

  // Custom tip
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  customRowActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  customLabel: { fontSize: fontSize.md, color: colors.darkMid, fontWeight: '600' },
  customInputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  dollar: { fontSize: fontSize.lg, color: colors.gray },
  customInput: { flex: 1, fontSize: fontSize.lg, color: colors.dark, paddingVertical: spacing.xs },
  customPct: { fontSize: fontSize.sm, color: colors.primaryDark, fontWeight: '700' },

  // Summary
  summary: {
    backgroundColor: colors.grayLight,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  summaryLabel: { fontSize: fontSize.md, color: colors.gray },
  summaryValue: { fontSize: fontSize.md, color: colors.dark },
  summaryDivider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
  summaryTotalLabel: { fontSize: fontSize.lg, fontWeight: '800', color: colors.dark },
  summaryTotalValue: { fontSize: fontSize.lg, fontWeight: '800', color: colors.dark },
  taxNote: { fontSize: fontSize.xs, color: colors.gray, textAlign: 'right', marginTop: spacing.xs },

  skipBtn: { alignItems: 'center', paddingVertical: spacing.sm, marginBottom: spacing.sm },
  skipText: { fontSize: fontSize.sm, color: colors.gray },

  // Payment method
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
