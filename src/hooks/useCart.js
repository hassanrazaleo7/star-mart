import { useCallback, useEffect, useState } from 'react';
const KEY = 'star-mart-basket';
function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
// Basket {productId: units}. Every update is functional so rapid clicks never overwrite each other.
export function useCart() {
  const [cart, setCart] = useState(read);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(cart));
    } catch {
      /* private mode */
    }
  }, [cart]);
  const change = useCallback((id, delta, max = Infinity) => {
    let outcome = 'ok';
    setCart(prev => {
      const next = Number(prev[id] || 0) + delta;
      if (next > max) {
        outcome = 'max';
        return prev;
      }
      const copy = { ...prev };
      if (next <= 0) delete copy[id];
      else copy[id] = next;
      return copy;
    });
    return outcome;
  }, []);
  const set = useCallback((id, units, max = Infinity) => {
    setCart(prev => {
      const copy = { ...prev };
      const n = Math.min(max, Math.max(0, Math.floor(Number(units) || 0)));
      if (n <= 0) delete copy[id];
      else copy[id] = n;
      return copy;
    });
  }, []);
  const remove = useCallback(id => {
    setCart(prev => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  }, []);
  const clear = useCallback(() => setCart({}), []);
  return { cart, change, set, remove, clear };
}
