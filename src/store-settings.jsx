import React, { useEffect, useState } from 'react';
import { PasswordChange, RecoveryQueue } from './account-security.jsx';
import { WorkspaceTabs } from './admin-workflow.jsx';
import { Button } from '@/components/ui/button';
import { post } from './lib/api.js';
import { loadStoreSettings } from './lib/settings.js';
const sections = {
  store: [
    ['phone', 'Store phone'],
    ['whatsapp', 'WhatsApp orders number (e.g. 03001234567)'],
    ['communityUrl', 'WhatsApp community / channel invite link'],
    ['address', 'Store address'],
    ['hours', 'Opening hours'],
    ['deliveryNote', 'Delivery information'],
  ],
  payments: [
    ['accountName', 'Payment account holder'],
    ['jazzcash', 'JazzCash number'],
    ['easypaisa', 'Easypaisa number'],
    ['bank', 'Bank name + IBAN / account number'],
  ],
};
export default function StoreSettings() {
  const [form, setForm] = useState({}),
    [tab, setTab] = useState('store'),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [loaded, setLoaded] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  async function load() {
    setLoading(true);
    setError('');
    try {
      const j = await loadStoreSettings(true);
      if (!Object.keys(j).length) throw Error('Could not load settings');
      setForm(j);
      setLoaded(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    setError('');
    try {
      await post('/admin/settings', form);
      loadStoreSettings(true);
      setMessage(
        tab === 'payments'
          ? 'Official payment accounts saved. Checkout will use these details.'
          : 'Store details saved successfully.'
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <WorkspaceTabs
        value={tab}
        onChange={v => {
          setTab(v);
          setMessage('');
        }}
        items={[
          ['store', 'Store details'],
          ['payments', 'Payment accounts'],
          ['security', 'Owner security'],
          ['recovery', 'Password recovery'],
        ]}
      />
      {error && (
        <p role="alert" className="aw-error">
          {error}
          <button className="quiet" onClick={load}>
            Reload settings
          </button>
        </p>
      )}
      {tab === 'security' ? (
        <section className="aw-card">
          <h2>Owner account security</h2>
          <PasswordChange kind="admin" />
        </section>
      ) : tab === 'recovery' ? (
        <RecoveryQueue />
      ) : (
        <section className="aw-card">
          <h2>
            {tab === 'payments' ? 'Official payment accounts' : 'Store contact & delivery details'}
          </h2>
          {tab === 'payments' && (
            <p className="aw-note">
              Add official Star Mart accounts only. JazzCash, Easypaisa and bank transfer appear at
              checkout after their details are added. Verify transfers before closing an order.
            </p>
          )}
          {loading ? (
            <p>Loading store details…</p>
          ) : (
            <form className="settings-grid" onSubmit={save}>
              {sections[tab].map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    value={form[key] || ''}
                    maxLength={500}
                    onChange={e => setForm({ ...form, [key]: e.target.value })}
                  />
                </label>
              ))}
              <Button className="primary" disabled={busy || !loaded}>
                {busy
                  ? 'Saving…'
                  : tab === 'payments'
                    ? 'Save payment accounts'
                    : 'Save store details'}
              </Button>
              {message && (
                <p className="aw-note" role="status">
                  {message}
                </p>
              )}
            </form>
          )}
        </section>
      )}
    </>
  );
}
