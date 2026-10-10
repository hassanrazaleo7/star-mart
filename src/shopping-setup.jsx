import React, { useEffect, useRef, useState } from 'react';
import {
  Truck,
  Store,
  X,
  UserRound,
  Camera,
  MapPin,
  MessageCircle,
  Users,
  LogOut,
} from 'lucide-react';
import { whatsappNumber } from './whatsapp-order.mjs';
import './shopping-setup.css';
export function ShoppingWelcome() {
  return (
    <div className="shopping-overlay">
      <section
        className="shopping-dialog shopping-welcome"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
      >
        <img src="/logo.png" alt="Star Mart" />
        <span className="kicker">YOUR EVERYDAY GROCERY STORE</span>
        <h2 id="welcome-title">Welcome to Star Mart.</h2>
        <p>Create your account, choose delivery or self pickup, and start shopping.</p>
        <a className="shopping-primary" href="/signup">
          Create account
        </a>
        <a className="shopping-secondary" href="/login">
          Already a member? Sign in
        </a>
      </section>
    </div>
  );
}
export function ShoppingSetup({ initial, onSave, onClose }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const panel = useRef(null);
  useEffect(() => {
    panel.current?.querySelector('button')?.focus();
  }, []);
  async function choose(fulfillment) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onSave({ ...initial, fulfillment, modeOnly: true });
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  return (
    <div className="shopping-overlay">
      <section
        ref={panel}
        className="shopping-dialog fulfillment-choice"
        role="dialog"
        aria-modal="true"
        aria-label="Choose Self Pickup or Delivery"
        onKeyDown={e => {
          if (e.key === 'Escape' && onClose && !busy) onClose();
          if (e.key === 'Tab') {
            const buttons = Array.from(panel.current.querySelectorAll('button')).filter(
              b => !b.disabled
            );
            if (!buttons.length) return;
            const first = buttons[0],
              last = buttons.at(-1);
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <div className="fulfillment-choice-tabs">
          {[
            ['Pickup', 'Self Pickup', Store],
            ['Delivery', 'Delivery', Truck],
          ].map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              disabled={busy}
              onClick={() => choose(value)}
              aria-label={label}
            >
              <Icon size={30} strokeWidth={1.6} />
              <strong>{label}</strong>
            </button>
          ))}
        </div>
        {error && (
          <p role="alert" className="shopping-error">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
export function StoreAccountMenu({ user, fulfillment, onChange, onLogout }) {
  const ref = useRef(null),
    file = useRef(null),
    [open, setOpen] = useState(false),
    [avatar, setAvatar] = useState(user.avatar || null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => setAvatar(user.avatar || null), [user.id, user.avatar]);
  useEffect(() => {
    const close = e => {
        if (!ref.current?.contains(e.target)) setOpen(false);
      },
      key = e => {
        if (e.key === 'Escape') setOpen(false);
      };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', key);
    };
  }, []);
  async function upload(e) {
    const image = e.target.files?.[0];
    if (!image) return;
    setError('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.type) || image.size > 1_000_000) {
      setError('Choose a JPG, PNG or WebP picture under 1 MB.');
      e.target.value = '';
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/customer/avatar', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': image.type },
          body: image,
        }),
        j = await r.json();
      if (!r.ok) throw Error(j.error || 'Picture could not be uploaded');
      setAvatar(j.image);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  }
  const name = user.name || user.displayName || 'Your account';
  return (
    <div className="store-account-menu" ref={ref}>
      <button
        className="header-icon account-button"
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {avatar ? (
          <img
            className="account-header-photo"
            src={avatar}
            alt="Your profile"
            onError={() => setAvatar(null)}
          />
        ) : (
          <UserRound size={21} strokeWidth={1.6} />
        )}
      </button>
      {open && (
        <div className="store-account-dropdown">
          <div className="account-profile-head">
            <button
              className="account-photo-edit"
              onClick={() => file.current?.click()}
              disabled={busy}
              aria-label="Upload or change profile picture"
            >
              {avatar ? (
                <img src={avatar} alt="Your profile" />
              ) : (
                <span>{name.charAt(0).toUpperCase()}</span>
              )}
              <i>
                <Camera size={12} />
              </i>
            </button>
            <div>
              <strong>{name}</strong>
              <small className="account-mode-pill">
                {fulfillment === 'Delivery' ? 'Delivery' : 'Self Pickup'} selected
              </small>
            </div>
          </div>
          <input
            ref={file}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={upload}
          />
          <button
            className="account-upload-link"
            onClick={() => file.current?.click()}
            disabled={busy}
          >
            {busy ? 'Uploading…' : avatar ? 'Change profile picture' : 'Add profile picture'}
          </button>
          {error && (
            <p className="shopping-error" role="alert">
              {error}
            </p>
          )}
          <div className="account-menu-links">
            <a href="/account">
              <UserRound size={19} /> My dashboard
            </a>
            <button
              onClick={() => {
                setOpen(false);
                onChange();
              }}
            >
              <MapPin size={19} /> Change delivery / pickup
            </button>
            <button
              className="account-signout"
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
            >
              <LogOut size={19} /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
export function StoreCommunity({ store, onClose }) {
  const n = whatsappNumber(store.whatsapp || store.phone);
  return (
    <div className="shopping-overlay">
      <section
        className="shopping-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="community-title"
      >
        <header>
          <h2 id="community-title">Star Mart Community</h2>
          <button className="shopping-close" onClick={onClose} aria-label="Close community">
            <X />
          </button>
        </header>
        <div className="community-mark">
          <Users size={42} />
        </div>
        <p>Stay connected for store news, member offers and new arrivals.</p>
        {store.communityUrl ? (
          <a
            className="shopping-primary"
            href={store.communityUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Join our community
          </a>
        ) : (
          <p className="shopping-store">
            Community invitations will be available here once Star Mart connects its group or
            channel.
          </p>
        )}
        {n && (
          <a
            className="shopping-secondary"
            href={'https://wa.me/' + n}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageCircle size={18} /> Contact Star Mart on WhatsApp
          </a>
        )}
      </section>
    </div>
  );
}
