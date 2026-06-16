import { useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ApiProduct, ModifierGroup } from '../api/endpoints';
import type { CartModifier } from '../store/cart.store';
import { formatCents } from '../utils/currency';
import { colors, spacing, radius, fontSize } from '../utils/colors';

function isRequired(t: ModifierGroup['selectionType']): boolean {
  return t === 'required_single' || t === 'required_multiple';
}
function isSingle(t: ModifierGroup['selectionType']): boolean {
  return t === 'single' || t === 'required_single';
}

interface Props {
  product: ApiProduct | null;
  onClose: () => void;
  onAdd: (modifiers: CartModifier[], quantity: number) => void;
  /** When editing an existing cart line: pre-select these + seed the quantity. */
  initialModifiers?: CartModifier[];
  initialQuantity?: number;
  /** Unique per open (product id for add, cart-line key for edit) so the sheet
   *  re-seeds even when editing the same product it was last opened for. */
  seedKey?: string;
}

/**
 * Modifier selection sheet. Mirrors the web ModifierSheet: defaults pre-selected,
 * single groups behave as radios, required groups gate the Add button, and the
 * running price reflects modifier deltas × quantity. Selections flow back as
 * CartModifier[] plus the chosen quantity. When `initialModifiers` is supplied
 * (cart edit), those drive the initial selection instead of the group defaults.
 */
export default function ModifierSheet({
  product,
  onClose,
  onAdd,
  initialModifiers,
  initialQuantity,
  seedKey,
}: Props) {
  // Per-group selected modifier-id sets, initialized from isDefault (or initialModifiers when editing).
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  const [quantity, setQuantity] = useState(1);
  const initFor = (p: ApiProduct) => {
    const init: Record<string, Set<string>> = {};
    const editIds = initialModifiers?.length ? new Set(initialModifiers.map((m) => m.modifierId)) : null;
    p.modifierGroups.forEach((g) => {
      init[g.id] = new Set(
        g.modifiers.filter((m) => (editIds ? editIds.has(m.id) : m.isDefault)).map((m) => m.id),
      );
    });
    return init;
  };
  // Lazily seed state the first render of each open (keyed on seedKey ?? product id).
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const currentSeed = seedKey ?? product?.id ?? null;
  if (product && seededFor !== currentSeed) {
    setSeededFor(currentSeed);
    setSelected(initFor(product));
    setQuantity(Math.max(1, initialQuantity ?? 1));
  }

  const groups = product?.modifierGroups ?? [];

  function toggle(group: ModifierGroup, modId: string) {
    const single = isSingle(group.selectionType);
    setSelected((prev) => {
      const set = new Set(prev[group.id] ?? []);
      if (single) {
        // Radio: selecting replaces; tapping the selected one keeps it (required).
        set.clear();
        set.add(modId);
      } else if (set.has(modId)) {
        set.delete(modId);
      } else {
        const max = group.maxSelections ?? Infinity;
        if (set.size >= max) return prev; // cap multi-select at max
        set.add(modId);
      }
      return { ...prev, [group.id]: set };
    });
  }

  const appliedModifiers = useMemo<CartModifier[]>(() => {
    return groups.flatMap((g) =>
      g.modifiers
        .filter((m) => selected[g.id]?.has(m.id))
        .map((m) => ({ modifierId: m.id, name: m.name, priceDelta: m.priceDelta })),
    );
  }, [groups, selected]);

  const requiredSatisfied = groups
    .filter((g) => isRequired(g.selectionType))
    .every((g) => (selected[g.id]?.size ?? 0) >= Math.max(1, g.minSelections));

  const modSum = appliedModifiers.reduce((s, m) => s + m.priceDelta, 0);
  const unitPrice = (product?.defaultPrice ?? 0) + modSum;
  const lineTotal = unitPrice * quantity;

  function confirm() {
    if (!requiredSatisfied) return;
    onAdd(appliedModifiers, quantity);
    setSeededFor(null); // reset for next open
  }

  return (
    <Modal visible={!!product} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {product?.name}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {groups.map((group) => {
              const single = isSingle(group.selectionType);
              return (
                <View key={group.id} style={styles.group}>
                  <View style={styles.groupHeader}>
                    <Text style={styles.groupName}>{group.name}</Text>
                    {isRequired(group.selectionType) ? (
                      <Text style={styles.required}>Required</Text>
                    ) : (
                      <Text style={styles.optional}>Optional</Text>
                    )}
                  </View>
                  {group.modifiers.map((mod) => {
                    const on = selected[group.id]?.has(mod.id) ?? false;
                    return (
                      <TouchableOpacity
                        key={mod.id}
                        style={styles.option}
                        onPress={() => toggle(group, mod.id)}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.indicator, single ? styles.radio : styles.checkbox, on && styles.indicatorOn]}>
                          {on && <Text style={styles.indicatorMark}>{single ? '●' : '✓'}</Text>}
                        </View>
                        <Text style={styles.optionName}>{mod.name}</Text>
                        {mod.priceDelta !== 0 && (
                          <Text style={styles.delta}>
                            {mod.priceDelta > 0 ? '+' : ''}
                            {formatCents(mod.priceDelta)}
                          </Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.qtyRow}>
            <Text style={styles.qtyLabel}>Quantity</Text>
            <View style={styles.qtyStepper}>
              <TouchableOpacity
                style={styles.qtyBtn}
                onPress={() => setQuantity((q) => Math.max(1, q - 1))}
                hitSlop={8}
              >
                <Text style={styles.qtyBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.qtyValue}>{quantity}</Text>
              <TouchableOpacity
                style={styles.qtyBtn}
                onPress={() => setQuantity((q) => q + 1)}
                hitSlop={8}
              >
                <Text style={styles.qtyBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          {!requiredSatisfied && (
            <Text style={styles.warn}>Please make all required selections above.</Text>
          )}
          <TouchableOpacity
            style={[styles.addBtn, !requiredSatisfied && styles.addBtnDisabled]}
            onPress={confirm}
            disabled={!requiredSatisfied}
            activeOpacity={0.85}
          >
            <Text style={styles.addText}>Add to order · {formatCents(lineTotal)}</Text>
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
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { flex: 1, fontSize: fontSize.xl, fontWeight: '800', color: colors.dark },
  close: { fontSize: fontSize.xl, color: colors.gray, paddingHorizontal: spacing.sm },
  body: { flexGrow: 0 },
  bodyContent: { padding: spacing.md, gap: spacing.lg },
  group: { gap: spacing.xs },
  groupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  groupName: { fontSize: fontSize.lg, fontWeight: '700', color: colors.dark },
  required: { fontSize: fontSize.xs, color: colors.danger, fontWeight: '700' },
  optional: { fontSize: fontSize.xs, color: colors.gray },
  option: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  indicator: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.border,
    marginRight: spacing.md,
  },
  radio: { borderRadius: radius.full },
  checkbox: { borderRadius: radius.sm },
  indicatorOn: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  indicatorMark: { color: colors.primary, fontSize: fontSize.sm, fontWeight: '800' },
  optionName: { flex: 1, fontSize: fontSize.md, color: colors.dark },
  delta: { fontSize: fontSize.sm, color: colors.gray },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  qtyLabel: { fontSize: fontSize.lg, fontWeight: '700', color: colors.dark },
  qtyStepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  qtyBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.grayLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnText: { fontSize: fontSize.xl, color: colors.dark, fontWeight: '700' },
  qtyValue: { fontSize: fontSize.lg, fontWeight: '700', minWidth: 28, textAlign: 'center', color: colors.dark },
  warn: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center', paddingHorizontal: spacing.md },
  addBtn: {
    backgroundColor: colors.primary,
    margin: spacing.md,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  addBtnDisabled: { opacity: 0.5 },
  addText: { color: colors.white, fontSize: fontSize.lg, fontWeight: '700' },
});
