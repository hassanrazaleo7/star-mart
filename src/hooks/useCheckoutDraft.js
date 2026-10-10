import { useCallback, useEffect, useState } from 'react';
const FULFILLMENT = 'star-mart-fulfillment',
  RETURN = 'star-checkout-return',
  DETAILS = 'star-checkout-details',
  ATTEMPT = 'star-order-attempt';
const EMPTY = {
  name: '',
  phone: '',
  fulfillment: 'Pickup',
  address: '',
  note: '',
  paymentMethod: 'Cash on pickup',
  paymentReference: '',
};
export const paymentFor = (method, fulfillment) => {
  if (fulfillment === 'Delivery' && ['Cash on pickup', 'POS card on pickup'].includes(method))
    return method === 'Cash on pickup' ? 'Cash on delivery' : 'POS card on delivery';
  if (fulfillment === 'Pickup' && ['Cash on delivery', 'POS card on delivery'].includes(method))
    return method === 'Cash on delivery' ? 'Cash on pickup' : 'POS card on pickup';
  return method;
};
const storage = (area, fn, fallback) => {
  try {
    return fn(window[area]);
  } catch {
    return fallback;
  }
};
// Simple non-cryptographic fingerprint so the idempotency key is reused for the same basket without storing PII.
function fingerprint(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return String(h >>> 0);
}
// Owns every piece of checkout state that survives a sign-in redirect, and the sessionStorage keys behind it.
export function useCheckoutDraft() {
  const [draft, setDraft] = useState(() => {
    const fulfillment =
      storage('localStorage', s => s.getItem(FULFILLMENT), null) === 'Delivery'
        ? 'Delivery'
        : 'Pickup';
    return { ...EMPTY, fulfillment, paymentMethod: paymentFor('Cash on pickup', fulfillment) };
  });
  const [returning] = useState(() =>
    storage('sessionStorage', s => s.getItem(RETURN) === '1', false)
  );
  useEffect(() => {
    storage('localStorage', s => s.setItem(FULFILLMENT, draft.fulfillment));
  }, [draft.fulfillment]);
  const update = useCallback(patch => {
    setDraft(prev => {
      const next = { ...prev, ...patch };
      if (patch.fulfillment && patch.fulfillment !== prev.fulfillment) {
        next.paymentMethod = paymentFor(next.paymentMethod, patch.fulfillment);
        next.paymentReference = '';
      }
      if (patch.paymentMethod && patch.paymentMethod !== prev.paymentMethod)
        next.paymentReference = patch.paymentReference ?? '';
      return next;
    });
  }, []);
  // Called once the customer is known: restores what they typed before being sent to sign in.
  const restore = useCallback(() => {
    if (!returning) return false;
    storage('sessionStorage', s => s.removeItem(RETURN));
    const saved = storage('sessionStorage', s => JSON.parse(s.getItem(DETAILS) || 'null'), null);
    storage('sessionStorage', s => s.removeItem(DETAILS));
    if (saved) setDraft(prev => ({ ...prev, ...saved }));
    return Boolean(saved);
  }, [returning]);
  const saveForSignIn = useCallback(() => {
    storage('sessionStorage', s => {
      s.setItem(RETURN, '1');
      s.setItem(DETAILS, JSON.stringify(draft));
    });
  }, [draft]);
  // Fills missing fields from saved preferences without overwriting what the shopper already typed.
  const applyPreference = useCallback(
    p => {
      if (!p) return;
      setDraft(prev => ({
        ...prev,
        phone: prev.phone || p.phone || '',
        address: prev.address || p.address || '',
        fulfillment: returning ? prev.fulfillment : p.fulfillment || prev.fulfillment,
        paymentMethod: returning
          ? prev.paymentMethod
          : paymentFor(prev.paymentMethod, p.fulfillment || prev.fulfillment),
      }));
    },
    [returning]
  );
  const requestKey = useCallback(payload => {
    const print = fingerprint(JSON.stringify(payload));
    let attempt = storage('sessionStorage', s => JSON.parse(s.getItem(ATTEMPT) || 'null'), null);
    if (!attempt || attempt.fingerprint !== print) {
      attempt = { fingerprint: print, key: crypto.randomUUID() };
      storage('sessionStorage', s => s.setItem(ATTEMPT, JSON.stringify(attempt)));
    }
    return attempt.key;
  }, []);
  const clearAttempt = useCallback(() => storage('sessionStorage', s => s.removeItem(ATTEMPT)), []);
  const reset = useCallback(() => {
    setDraft(prev => ({
      ...EMPTY,
      fulfillment: prev.fulfillment,
      paymentMethod: paymentFor('Cash on pickup', prev.fulfillment),
      name: prev.name,
      phone: prev.phone,
      address: prev.address,
    }));
    clearAttempt();
  }, [clearAttempt]);
  return {
    draft,
    update,
    restore,
    saveForSignIn,
    applyPreference,
    requestKey,
    clearAttempt,
    reset,
  };
}
