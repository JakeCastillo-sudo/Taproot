/**
 * DemoMenuButton — "Try with a demo menu" option
 *
 * Loads a hardcoded sample menu so owners can experience the full
 * onboarding flow even without their menu PDF handy.
 * Items are marked isDemo=true and shown with a gray "DEMO" badge.
 */

import type { MenuReviewItem } from '../../store/onboarding.store';

// ─── Sample demo menu ─────────────────────────────────────────────────────────

export const DEMO_MENU_ITEMS: MenuReviewItem[] = [
  { id: 'demo-1', name: 'Classic Burger',        price: 1400, category: 'Mains',      description: 'Beef patty, lettuce, tomato, pickles', confidence: 0.99, isDemo: true },
  { id: 'demo-2', name: 'Chicken Sandwich',      price: 1350, category: 'Mains',      description: 'Crispy chicken, slaw, chipotle mayo',  confidence: 0.99, isDemo: true },
  { id: 'demo-3', name: 'Veggie Wrap',           price: 1200, category: 'Mains',      description: 'Grilled veggies, hummus, spinach',     confidence: 0.99, isDemo: true },
  { id: 'demo-4', name: 'Caesar Salad',          price: 1100, category: 'Starters',   description: 'Romaine, parmesan, croutons',          confidence: 0.99, isDemo: true },
  { id: 'demo-5', name: 'Truffle Fries',         price:  900, category: 'Starters',   description: 'Hand-cut fries, truffle oil, parsley', confidence: 0.99, isDemo: true },
  { id: 'demo-6', name: 'Soup of the Day',       price:  800, category: 'Starters',   description: 'Ask your server',                      confidence: 0.99, isDemo: true },
  { id: 'demo-7', name: 'Brownie Sundae',        price:  950, category: 'Desserts',   description: 'Warm brownie, vanilla ice cream',      confidence: 0.99, isDemo: true },
  { id: 'demo-8', name: 'Cheesecake',            price:  850, category: 'Desserts',   description: 'New York style, berry compote',        confidence: 0.99, isDemo: true },
  { id: 'demo-9', name: 'Drip Coffee',           price:  400, category: 'Beverages',  description: 'Single origin, free refills',          confidence: 0.99, isDemo: true },
  { id: 'demo-10',name: 'Cappuccino',            price:  550, category: 'Beverages',  description: 'Double shot, microfoam',               confidence: 0.99, isDemo: true },
  { id: 'demo-11',name: 'Fresh Orange Juice',    price:  650, category: 'Beverages',  description: 'Squeezed to order',                    confidence: 0.99, isDemo: true },
  { id: 'demo-12',name: 'House Lager',           price:  750, category: 'Bar',        description: 'Local craft, pint',                    confidence: 0.99, isDemo: true },
  { id: 'demo-13',name: 'Wine by the Glass',     price:  950, category: 'Bar',        description: 'Red or white, ask your server',        confidence: 0.99, isDemo: true },
  { id: 'demo-14',name: 'Taproot Tote Bag',      price: 2500, category: 'Merch',      description: 'Organic cotton',                       confidence: 0.99, isDemo: true },
];

// ─── Component ────────────────────────────────────────────────────────────────

interface DemoMenuButtonProps {
  onLoad: (items: MenuReviewItem[]) => void;
}

export function DemoMenuButton({ onLoad }: DemoMenuButtonProps) {
  return (
    <div className="mt-5 text-center">
      <button
        type="button"
        onClick={() => onLoad(DEMO_MENU_ITEMS)}
        className="text-sm text-primary hover:text-primary-dark transition-colors hover:underline"
      >
        Don&apos;t have your menu handy? Try with our demo menu →
      </button>
    </div>
  );
}
