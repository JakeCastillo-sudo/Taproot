import React, { createContext, useContext, useState, useCallback } from 'react';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [cart, setCart] = useState([]);
  const [settings, setSettings] = useState({
    business_name: 'My Business',
    tax_rate: '8.5',
    currency_symbol: '$',
    receipt_footer: 'Thank you for your business!',
  });

  const addToCart = useCallback((product) => {
    setCart(prev => {
      const existing = prev.find(i => i.id === product.id);
      if (existing) {
        return prev.map(i => i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  }, []);

  const updateQuantity = useCallback((id, qty) => {
    if (qty <= 0) {
      setCart(prev => prev.filter(i => i.id !== id));
    } else {
      setCart(prev => prev.map(i => i.id === id ? { ...i, quantity: qty } : i));
    }
  }, []);

  const removeFromCart = useCallback((id) => {
    setCart(prev => prev.filter(i => i.id !== id));
  }, []);

  const clearCart = useCallback(() => setCart([]), []);

  const taxRate = parseFloat(settings.tax_rate) || 0;
  const subtotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const tax = subtotal * taxRate / 100;
  const total = subtotal + tax;

  return (
    <AppContext.Provider value={{
      cart, addToCart, updateQuantity, removeFromCart, clearCart,
      subtotal, tax, total, taxRate,
      settings, setSettings,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
