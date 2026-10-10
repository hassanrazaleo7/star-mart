import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster, toast as notify } from 'sonner';
import {
  LayoutDashboard,
  ScanBarcode,
  Boxes,
  Truck,
  ShoppingBag,
  Users,
  ClipboardList,
  ReceiptText,
  BarChart3,
  UserRound,
  Menu,
  Search,
  Plus,
  Download,
  LogOut,
  AlertTriangle,
  Package,
  Camera,
  X,
  Minus,
  Printer,
  CircleCheck,
  ShieldCheck,
  RefreshCw,
  Upload,
  PackageCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge as UiBadge } from '@/components/ui/badge';
import { BarcodeCamera, ProductBarcode } from './barcode-scanner.jsx';
import { GROCERY_CATEGORIES } from './grocery-categories.mjs';
import {
  WorkspaceTabs,
  RecordTable,
  OrdersWorkspace,
  CustomersWorkspace,
  TeamWorkspace,
  SectionSwitcher,
} from './admin-workflow.jsx';
import PickupDesk from './pickup-desk.jsx';
import StoreSettings from './store-settings.jsx';
import { PasswordChange } from './account-security.jsx';
import PremiumDashboard from './premium-dashboard.jsx';
import AdminCommand from './admin-command.jsx';
import AdminDate from './admin-date.jsx';
import DailySales from './daily-sales.jsx';
import AdminCatalog from './admin-catalog.jsx';
import Reports from './reports.jsx';
import CreditCollection from './components/CreditCollection.jsx';
import NotFound from './components/NotFound.jsx';
import { useLiveRefresh } from './live.js';
import { api, get, post, seg, upload } from './lib/api.js';
import {
  formatPaisa as M,
  formatQty as Q,
  formatDateTime as date,
  lineTotalPaisa,
} from './lib/money.js';
import { resizeToJpeg } from './lib/image.js';
import { configured as firebaseConfigured, loadFirebase } from './firebase-config.js';
import './admin-theme.css';
import './style.css';
import './admin-premium.css';
import './brand.css';
import './admin-workflow.css';

// Portals outside the admin shell load on demand so the POS never downloads the storefront, and vice versa.
const Shop = lazy(() => import('./shop.jsx'));
const VendorPanel = lazy(() => import('./vendor.jsx'));
const VendorManagement = lazy(() => import('./vendor-admin.jsx'));
const StorePage = lazy(() => import('./store-pages.jsx'));
const CustomerDashboard = lazy(() => import('./customer-dashboard.jsx'));
const BulkImport = lazy(() => import('./bulk-import.jsx'));
const PasswordHelp = lazy(() =>
  import('./account-security.jsx').then(m => ({ default: m.PasswordHelp }))
);
const CustomerAuth = lazy(() =>
  import('./auth-pages.jsx').then(m => ({ default: m.CustomerAuth }))
);
const VendorApply = lazy(() => import('./auth-pages.jsx').then(m => ({ default: m.VendorApply })));

const categories = GROCERY_CATEGORIES;
const blank = {
  products: [],
  vendors: [],
  purchases: [],
  sales: [],
  receipts: [],
  adjustments: [],
  expenses: [],
  movements: [],
};
const emptyBill = {
  payment: 'Cash',
  discount: '',
  discountReason: '',
  tax: '',
  customer: '',
  customerId: '',
  redeemPoints: 0,
  received: '',
  note: '',
};
const nav = [
  ['dashboard', 'Overview', LayoutDashboard],
  ['pos', 'POS & barcode', ScanBarcode],
  ['orders', 'Customer orders', PackageCheck],
  ['products', 'Products & stock', Boxes],
  ['purchases', 'Purchases', Truck],
  ['sales', 'Sales & receipts', ShoppingBag],
  ['vendors', 'Vendors', Users],
  ['customers', 'Customers', UserRound],
  ['bulk', 'Bulk import', Upload],
  ['activity', 'Activity log', ClipboardList],
  ['adjustments', 'Adjustments', ClipboardList],
  ['expenses', 'Expenses', ReceiptText],
  ['reports', 'Reports', BarChart3],
  ['accounts', 'Team accounts', Users],
  ['settings', 'Store settings', ShieldCheck],
];
const roleViews = {
  admin: nav.map(n => n[0]),
  staff: ['pos', 'orders', 'products'],
  vendor: [],
};
const fields = {
  product: [
    ['name', 'Product name', 'text', true],
    ['sku', 'SKU'],
    ['barcode', 'Barcode / EAN'],
    ['brand', 'Brand'],
    ['category', 'Category', 'select', true, categories],
    ['packSize', 'Pack size'],
    ['unit', 'Unit', 'select', false, ['piece', 'kg', 'litre', 'pack', 'box']],
    ['location', 'Shelf / aisle'],
    ['vendorId', 'Preferred vendor', 'vendor'],
    ['opening', 'Opening stock', 'number'],
    ['cost', 'Cost per unit (Rs)', 'number'],
    ['price', 'Sell price per unit (Rs)', 'number'],
    ['reorder', 'Reorder level', 'number'],
    ['reorderQty', 'Reorder quantity', 'number'],
    ['taxRate', 'Tax rate % (applied at checkout)', 'number'],
    ['description', 'Description'],
  ],
  vendor: [
    ['name', 'Vendor name', 'text', true],
    ['contact', 'Contact person'],
    ['phone', 'Phone'],
    ['email', 'Email', 'email'],
    ['address', 'Address'],
    ['terms', 'Payment terms'],
    ['taxId', 'NTN / tax ID'],
  ],
  purchase: [
    ['productId', 'Product', 'product', true],
    ['vendorId', 'Vendor', 'vendor'],
    ['qty', 'Quantity received', 'number', true],
    ['cost', 'Cost / unit (Rs)', 'number', true],
    ['invoice', 'Invoice / bill number'],
    ['payment', 'Payment status', 'select', false, ['Paid', 'Unpaid', 'Part paid']],
    ['paid', 'Amount paid now (Rs, for part paid)', 'number'],
    ['paymentMethod', 'Paid via', 'select', false, ['Cash', 'Card', 'Bank transfer']],
    ['batch', 'Batch / lot'],
    ['expiry', 'Expiry date', 'date'],
    ['note', 'Notes'],
  ],
  adjustment: [
    ['productId', 'Product', 'product', true],
    ['change', 'Quantity change (+/−)', 'number', true],
    [
      'reason',
      'Reason',
      'select',
      false,
      [
        'Physical count',
        'Damaged',
        'Expired',
        'Shrinkage / missing',
        'Customer return',
        'Vendor return',
        'Correction',
      ],
    ],
    ['note', 'Explanation / reference', 'text', true],
  ],
  expense: [
    [
      'category',
      'Category',
      'select',
      false,
      [
        'Rent',
        'Utilities',
        'Salary',
        'Transport',
        'Packaging',
        'Maintenance',
        'Marketing',
        'Other',
      ],
    ],
    ['description', 'Description', 'text', true],
    ['amount', 'Amount (Rs)', 'number', true],
    ['payment', 'Payment', 'select', false, ['Cash', 'Card', 'Bank transfer']],
    ['reference', 'Receipt / reference'],
  ],
};
const model = {
  product: { opening: 0, cost: 0, price: 0, reorder: 5, reorderQty: 10, taxRate: 0, unit: 'piece' },
  purchase: { qty: 1, cost: 0, payment: 'Paid' },
  adjustment: { change: -1, reason: 'Physical count' },
  expense: { category: 'Rent', payment: 'Cash' },
};
const recordGroups = {
  product: [
    {
      title: 'Product details',
      keys: ['name', 'category', 'brand', 'packSize', 'unit', 'vendorId'],
    },
    { title: 'Price & stock', keys: ['opening', 'cost', 'price', 'reorder'] },
    {
      title: 'More details · barcode, shelf & notes',
      extra: true,
      keys: ['sku', 'location', 'reorderQty', 'taxRate', 'description'],
    },
  ],
  vendor: [
    { title: 'Business & contact', keys: ['name', 'contact', 'email', 'phone', 'address'] },
    { title: 'Payment & tax details', extra: true, keys: ['terms', 'taxId'] },
  ],
  purchase: [
    { title: 'Stock received', keys: ['productId', 'vendorId', 'qty', 'cost'] },
    { title: 'Payment', keys: ['payment', 'paid', 'paymentMethod'] },
    { title: 'Invoice, batch & expiry', extra: true, keys: ['invoice', 'batch', 'expiry', 'note'] },
  ],
  adjustment: [{ title: 'Stock correction', keys: ['productId', 'change', 'reason', 'note'] }],
  expense: [
    {
      title: 'Expense details',
      keys: ['category', 'description', 'amount', 'payment', 'reference'],
    },
  ],
};
const WHOLE_UNITS = ['opening', 'vendorAvailable', 'qty', 'change', 'reorder', 'reorderQty'];
const recordPaths = {
  product: '/products',
  vendor: '/vendors',
  purchase: '/purchases',
  adjustment: '/adjustments',
  expense: '/expenses',
};
const viewTitles = {
  dashboard: ['A clear view of your store.', 'Track every item, rupee and reorder point.'],
  pos: ['Point of sale.', 'Scan a barcode, prepare the bill and collect payment.'],
  products: ['Product inventory.', 'Every product, price, barcode and shelf in one place.'],
  orders: [
    'Customer orders.',
    'Review pickup and delivery requests; confirm, release or fulfill stock.',
  ],
  purchases: ['Purchase register.', 'Record received stock with invoice, vendor and expiry.'],
  sales: ['Sales & receipts.', 'Every checkout line and its receipt.'],
  vendors: [
    'Vendor workspace.',
    'Select a vendor to manage their details, products and accounts in one place.',
  ],
  adjustments: ['Stock adjustments.', 'Explain every stock correction and loss.'],
  expenses: ['Business expenses.', 'Keep operating expenses visible.'],
  reports: ['Reports & insights.', 'Figures calculated from recorded transactions.'],
  customers: ['Customer accounts.', 'Registered customers, credit and Star Points.'],
  bulk: ['Bulk import.', 'Load customers and products from a prepared ZIP.'],
  activity: ['Activity log.', 'Who changed what, and when.'],
  accounts: ['Team accounts.', 'Create staff access with limited permissions.'],
  settings: ['Store settings.', 'Store contact details, payment accounts and account security.'],
};
const addTypes = {
  products: 'product',
  vendors: 'vendor',
  purchases: 'purchase',
  adjustments: 'adjustment',
  expenses: 'expense',
};

const stock = p => Number(p?.stock_milli || 0),
  reserved = p => Number(p?.reserved_milli || 0),
  sellable = p => stock(p) - reserved(p);
function IconButton({ icon: Icon, children, ...props }) {
  return (
    <Button {...props}>
      <Icon size={17} />
      {children}
    </Button>
  );
}
function Badge({ children, warn }) {
  return (
    <UiBadge variant={warn ? 'outline' : 'secondary'} className={'badge ' + (warn ? 'warn' : '')}>
      {children}
    </UiBadge>
  );
}
function Empty({ text }) {
  return (
    <div className="empty">
      <Package size={30} />
      <span>{text || 'No records yet. Add your first entry to get started.'}</span>
    </div>
  );
}
const flash = s => notify.success(s);
const viewFromPath = (pathname, role) => {
  const view = pathname.split('/')[2];
  return view && roleViews[role]?.includes(view) ? view : null;
};

// Generic record form used for products, vendors, purchases, adjustments and expenses.
function RecordField({ field, form, setForm, modal, products, vendors, stock, product }) {
  const [key, label, type = 'text', required = false, options] = field;
  const update = value => setForm(prev => ({ ...prev, [key]: value }));
  if (type === 'select')
    return (
      <label>
        {label}
        {required && ' *'}
        <select
          aria-label={label}
          required={required}
          value={form[key] ?? options[0]}
          onChange={e => update(e.target.value)}
        >
          {(key === 'category' &&
          modal === 'product' &&
          form.category &&
          !options.includes(form.category)
            ? [...options, form.category]
            : options
          ).map(x => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </label>
    );
  if (type === 'product' || type === 'vendor')
    return (
      <label>
        {label}
        {required && ' *'}
        <select
          aria-label={label}
          required={required}
          value={form[key] ?? ''}
          onChange={e => {
            const v = e.target.value;
            setForm(prev => ({
              ...prev,
              [key]: v,
              ...(key === 'productId' && modal === 'purchase'
                ? {
                    cost: Number(product(v)?.cost_paisa || 0) / 100,
                    vendorId: product(v)?.vendor_id || '',
                  }
                : {}),
            }));
          }}
        >
          <option value="">{type === 'product' ? 'Select product' : 'No vendor selected'}</option>
          {(type === 'product'
            ? products.filter(p => !p.deleted_at && p.catalog_status !== 'archived')
            : vendors
          ).map(x => (
            <option value={x.id} key={x.id}>
              {x.name}
              {type === 'product' ? ' (' + Q(stock(x)) + ' in stock)' : ''}
            </option>
          ))}
        </select>
      </label>
    );
  const fractional =
    modal === 'product'
      ? form.unit && form.unit !== 'piece'
      : product(form.productId)?.unit && product(form.productId)?.unit !== 'piece';
  return (
    <label>
      {label}
      {required && ' *'}
      <input
        aria-label={label}
        type={type}
        min={type === 'number' && key !== 'change' ? 0 : undefined}
        step={
          type === 'number'
            ? WHOLE_UNITS.includes(key)
              ? fractional
                ? '0.001'
                : '1'
              : '0.01'
            : undefined
        }
        required={required}
        value={form[key] ?? ''}
        onChange={e => update(e.target.value)}
        placeholder={key === 'change' ? 'e.g. -2 or 3' : ''}
      />
    </label>
  );
}

function App({ portal }) {
  const [mode, setMode] = useState('loading'),
    [password, setPassword] = useState(''),
    [owner, setOwner] = useState(''),
    [user, setUser] = useState(''),
    [role, setRole] = useState('admin'),
    [email, setEmail] = useState(''),
    [accounts, setAccounts] = useState([]),
    [view, setView] = useState(
      () => viewFromPath(location.pathname, portal) || (portal === 'staff' ? 'pos' : 'dashboard')
    ),
    [posTab, setPosTab] = useState('counter'),
    [data, setData] = useState(blank),
    [orders, setOrders] = useState([]),
    [activities, setActivities] = useState([]),
    [customers, setCustomers] = useState([]),
    [customerInfo, setCustomerInfo] = useState(null),
    [modal, setModal] = useState(null),
    [form, setForm] = useState({}),
    [error, setError] = useState(''),
    [modalError, setModalError] = useState(''),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all'),
    [sidebar, setSidebar] = useState(false),
    [busy, setBusy] = useState(false),
    [cart, setCart] = useState({}),
    [scan, setScan] = useState(''),
    [search, setSearch] = useState(''),
    [bill, setBill] = useState(emptyBill),
    [receipt, setReceipt] = useState(null),
    [legacyImport, setLegacyImport] = useState(null),
    [camera, setCamera] = useState(false),
    [linkOpen, setLinkOpen] = useState(false),
    [adminPhone, setAdminPhone] = useState(''),
    [adminCode, setAdminCode] = useState(''),
    [adminPhoneResult, setAdminPhoneResult] = useState(null),
    [refreshToken, setRefreshToken] = useState(0);
  const scanRef = useRef(),
    adminVerifier = useRef(),
    requestKey = useRef(null);

  async function refresh() {
    const me = await get('/me');
    if (me.user.role === 'vendor') return;
    const [v, o, c] = await Promise.all([get('/state'), get('/orders'), get('/customers')]);
    setData(v);
    setOrders(o.orders);
    setCustomers(c.customers);
    if (me.user.role === 'admin') setActivities((await get('/admin/activity')).events);
    setRefreshToken(n => n + 1);
  }
  const sync = useLiveRefresh(() => {
    if (mode === 'ready' && portal !== 'vendor') return refresh();
  });

  // URL ↔ view: /admin/orders opens the orders view and the back button works.
  useEffect(() => {
    const onPop = () =>
      setView(viewFromPath(location.pathname, role) || (role === 'staff' ? 'pos' : 'dashboard'));
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, [role]);

  useEffect(() => {
    (async () => {
      try {
        const setup = await get('/setup/status');
        if (!setup.setup) {
          setMode(portal === 'admin' ? 'setup' : 'login');
          setError(portal === 'admin' ? '' : 'First create the store owner account at /admin.');
          return;
        }
        const me = await get('/me');
        if (me.user.role !== portal) {
          setMode('login');
          setError(
            'This account belongs to the ' +
              me.user.role +
              ' panel. Open /' +
              me.user.role +
              ' instead.'
          );
          return;
        }
        enter(me.user.name, me.user.role);
        await refresh();
        setMode('ready');
      } catch (e) {
        setMode(e.status === 401 ? 'login' : 'error');
        setError(e.status === 401 ? '' : e.message);
      }
    })();
  }, []);

  function enter(name, nextRole) {
    setUser(name);
    setRole(nextRole);
    const target =
      viewFromPath(location.pathname, nextRole) || (nextRole === 'staff' ? 'pos' : 'dashboard');
    setView(target);
    if (nextRole !== 'vendor') history.replaceState(null, '', '/' + portal + '/' + target);
  }
  async function sign(e) {
    e.preventDefault();
    setError('');
    try {
      setBusy(true);
      if (mode === 'setup') {
        await post('/setup', { name: owner, password });
        const r = await post('/login', { password });
        enter(r.name, 'admin');
        await refresh();
        setMode('ready');
        setPassword('');
        flash('Store owner account created.');
      } else {
        if (portal !== 'admin' && !email) throw Error('Enter your ' + portal + ' account email.');
        const r = await post(
          portal === 'admin' ? '/login' : '/account/login',
          portal === 'admin' ? { password } : { email, password }
        );
        if ((r.role || 'admin') !== portal) {
          await post('/logout');
          throw Error(
            'This account belongs to the ' + r.role + ' panel. Open /' + r.role + ' instead.'
          );
        }
        enter(r.name, r.role || 'admin');
        await refresh();
        setMode('ready');
        setPassword('');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function handleFirebaseIdentity(identity, link = false) {
    if (portal !== 'admin') throw Error('Google/mobile sign-in is for linked store owners only.');
    const token = await identity.getIdToken();
    const j = await api('/admin/' + (link ? 'link' : 'firebase-login'), {
      method: 'POST',
      body: {},
      headers: { authorization: 'Bearer ' + token },
    });
    if (link) {
      setLinkOpen(false);
      flash('Verified account linked for admin sign-in.');
    } else {
      enter(j.name, 'admin');
      await refresh();
      setMode('ready');
      flash('Signed in securely.');
    }
  }
  async function adminGoogle(link = false) {
    if (!firebaseConfigured) {
      setError('Configure Firebase before enabling Google sign-in.');
      return;
    }
    setError('');
    try {
      setBusy(true);
      const fb = await loadFirebase();
      const result = await fb.signInWithPopup(fb.auth, new fb.GoogleAuthProvider());
      await handleFirebaseIdentity(result.user, link);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function adminPhoneSend() {
    setError('');
    try {
      if (!/^\+[1-9]\d{7,14}$/.test(adminPhone))
        throw Error('Use a number with country code, e.g. +923001234567');
      setBusy(true);
      const fb = await loadFirebase();
      adminVerifier.current ||= new fb.RecaptchaVerifier(fb.auth, 'admin-recaptcha', {
        size: 'normal',
      });
      setAdminPhoneResult(
        await fb.signInWithPhoneNumber(fb.auth, adminPhone, adminVerifier.current)
      );
      flash('Verification code sent.');
    } catch (e) {
      setError(e.message);
      adminVerifier.current?.clear();
      adminVerifier.current = null;
    } finally {
      setBusy(false);
    }
  }
  async function adminPhoneVerify(link = false) {
    setError('');
    try {
      setBusy(true);
      const result = await adminPhoneResult.confirm(adminCode);
      await handleFirebaseIdentity(result.user, link);
      setAdminPhoneResult(null);
      setAdminCode('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function loadAccounts() {
    setAccounts((await get('/accounts')).accounts);
  }
  async function uploadPicture(productId, file) {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const blob = await resizeToJpeg(file);
      await upload('/products/' + seg(productId) + '/image', blob, 'image/jpeg');
      flash('Product image uploaded.');
      await sync().catch(() => {});
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      await post('/logout');
    } catch (e) {
      setError('Could not sign out. ' + e.message);
      return;
    }
    setMode('login');
    setRole('admin');
    setUser('');
    setData(blank);
    setOrders([]);
    setCustomers([]);
    setActivities([]);
    setAccounts([]);
    setCustomerInfo(null);
    setCart({});
    setBill(emptyBill);
    setReceipt(null);
    setError('');
    history.replaceState(null, '', '/' + portal);
  }
  // A successful write is reported as success even when the follow-up refresh fails (no accidental double sale).
  async function action(path, method, payload, onDone, { report = setError } = {}) {
    setBusy(true);
    report('');
    let result;
    try {
      result = await api(path, { method, body: payload });
    } catch (e) {
      report(e.message);
      setBusy(false);
      return null;
    }
    onDone?.(result);
    flash('Saved successfully.');
    try {
      await sync();
    } catch {
      notify.message('Saved. The screen will refresh in a moment.');
    }
    setBusy(false);
    return result;
  }
  const productMap = useMemo(() => new Map(data.products.map(p => [p.id, p])), [data.products]);
  const product = id => productMap.get(id);
  const inStock = useMemo(
    () =>
      data.products.filter(
        p => !p.deleted_at && sellable(p) > 0 && p.catalog_status !== 'archived'
      ),
    [data.products]
  );
  const low = useMemo(
    () => data.products.filter(p => !p.deleted_at && stock(p) <= Number(p.reorder_milli || 0)),
    [data.products]
  );
  const quickAdd = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (
      q
        ? inStock.filter(p =>
            (p.name + ' ' + p.barcode + ' ' + p.sku + ' ' + p.category + ' ' + p.brand)
              .toLowerCase()
              .includes(q)
          )
        : inStock
    ).slice(0, 40);
  }, [inStock, search]);
  function receiveStock(p, vendorId = '') {
    setModalError('');
    setModal('purchase');
    setForm({
      ...model.purchase,
      payment: 'Unpaid',
      productId: p?.id || '',
      vendorId: p?.vendor_id || vendorId,
      cost: p ? Number(p.cost_paisa) / 100 : 0,
    });
  }
  function open(type, item) {
    setModalError('');
    setModal(type);
    const v = item || model[type] || {};
    setForm(
      item
        ? {
            ...v,
            opening: 0,
            cost: Number(item.cost_paisa) / 100,
            price: Number(item.price_paisa) / 100,
            reorder: Number(item.reorder_milli) / 1000,
            reorderQty: Number(item.reorder_qty_milli) / 1000,
            taxRate: Number(item.tax_rate_bps) / 100,
            packSize: item.pack_size,
            vendorId: item.vendor_id || '',
            taxId: item.tax_id || '',
          }
        : v
    );
  }
  async function submit(e) {
    e.preventDefault();
    const type = modal,
      id = form.id;
    let path = recordPaths[type];
    if (id && (type === 'product' || type === 'vendor')) path += '/' + seg(id);
    const result = await action(path, id ? 'PUT' : 'POST', form, () => setModal(null), {
      report: setModalError,
    });
    if (result && type === 'purchase') go('purchases');
  }
  const orderAction = (id, status, payload) =>
    action('/orders/' + seg(id) + '/' + seg(status), 'POST', payload);
  function go(v) {
    setCamera(false);
    setView(v);
    setQuery('');
    setFilter('all');
    setSidebar(false);
    setError('');
    if (location.pathname !== '/' + portal + '/' + v)
      history.pushState(null, '', '/' + portal + '/' + v);
    if (v === 'accounts' || v === 'vendors') loadAccounts().catch(e => setError(e.message));
    if (v === 'pos') setTimeout(() => scanRef.current?.focus(), 80);
  }
  function add(p) {
    if (!p) {
      setError('Barcode / SKU not found. Add this product in inventory first.');
      return;
    }
    if (p.deleted_at || p.catalog_status === 'archived') {
      setError('This product is archived or removed. Restore it before selling.');
      return;
    }
    const next = Number(cart[p.id] || 0) + 1000;
    if (next > sellable(p)) {
      setError(
        p.name +
          ' has only ' +
          Q(sellable(p)) +
          ' available' +
          (reserved(p) ? ' (' + Q(reserved(p)) + ' reserved by online orders).' : '.')
      );
      return;
    }
    setCart(prev => ({ ...prev, [p.id]: Number(prev[p.id] || 0) + 1000 }));
    setError('');
    setScan('');
    scanRef.current?.focus();
  }
  function scanAdd(text = scan) {
    const q = text.trim().toLowerCase();
    if (!q) return;
    let p = data.products.find(x => x.barcode?.toLowerCase() === q || x.sku?.toLowerCase() === q);
    if (!p) {
      const hits = data.products.filter(x => x.name.toLowerCase().includes(q));
      if (hits.length === 1) p = hits[0];
    }
    add(p);
  }
  function updateCart(id, delta) {
    const p = product(id),
      next = Number(cart[id] || 0) + delta;
    if (next > sellable(p)) {
      setError('Not enough stock for ' + p.name);
      return;
    }
    setCart(prev => {
      const copy = { ...prev },
        n = Number(prev[id] || 0) + delta;
      if (n <= 0) delete copy[id];
      else copy[id] = n;
      return copy;
    });
    setError('');
  }
  function clearBill() {
    setCart({});
    requestKey.current = null;
  }
  const lines = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => ({ p: productMap.get(id), qty }))
        .filter(x => x.p),
    [cart, productMap]
  );
  const subtotal = lines.reduce((a, x) => a + lineTotalPaisa(x.qty, x.p.price_paisa), 0),
    discount = Math.round(Number(bill.discount || 0) * 100),
    loyaltyDiscount = (Number(bill.redeemPoints || 0) / 100) * 5000,
    taxOverride =
      role === 'admin' && bill.tax !== '' ? Math.round(Number(bill.tax || 0) * 100) : null,
    taxEstimate =
      taxOverride ??
      lines.reduce(
        (n, x) =>
          n +
          Math.round(
            (lineTotalPaisa(x.qty, x.p.price_paisa) *
              (1 - (discount + loyaltyDiscount) / Math.max(1, subtotal)) *
              Number(x.p.tax_rate_bps || 0)) /
              10000
          ),
        0
      ),
    total = Math.max(0, subtotal - discount - loyaltyDiscount + taxEstimate);
  async function loadCustomer(customerId) {
    if (!customerId) {
      setCustomerInfo(null);
      return;
    }
    try {
      setCustomerInfo(await get('/customers/' + seg(customerId) + '/overview'));
    } catch (e) {
      setError(e.message);
    }
  }
  async function checkout() {
    if (!lines.length) return;
    if (discount > 0 && !bill.discountReason.trim()) {
      setError('Enter a reason for the discount.');
      return;
    }
    requestKey.current ||= crypto.randomUUID();
    const payload = {
      lines: lines.map(x => ({ productId: x.p.id, qty: x.qty / 1000 })),
      ...bill,
      tax: role === 'admin' && bill.tax !== '' ? bill.tax : undefined,
      requestKey: requestKey.current,
    };
    const r = await action('/checkout', 'POST', payload, () => {
      setCart({});
      setBill(emptyBill);
      requestKey.current = null;
    });
    if (r) {
      setReceipt(r);
      if (payload.customerId) await loadCustomer(payload.customerId);
    }
  }
  function printReceipt(r = receipt) {
    const popup = window.open('', '_blank', 'width=430,height=700');
    if (!popup) {
      flash('Allow popups to print receipt.');
      return;
    }
    const esc = s =>
      String(s ?? '').replace(
        /[&<>"']/g,
        c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
      );
    popup.document.write(
      `<!doctype html><html><head><title>Star Mart ${esc(r.receipt)}</title><style>body{font:14px Arial;width:320px;margin:25px auto;color:#222}h1{text-align:center;color:#fc2600;margin-bottom:0}.sub{text-align:center;letter-spacing:2px;font-size:11px}table{width:100%;border-collapse:collapse;margin:20px 0}td{padding:9px 0;border-bottom:1px dashed #ccc}.row{display:flex;justify-content:space-between;padding:5px 0}.total{font-weight:bold;font-size:18px;border-top:2px solid;margin-top:12px;padding-top:12px}</style></head><body><h1>★ Star Mart</h1><div class="sub">HOUSE OF GROCERIES</div><p>${esc(r.receipt)}<br>${esc(date(r.createdAt))}<br>${esc(r.customer)} · ${esc(r.payment)}</p><table>${r.lines.map(x => `<tr><td>${esc(x.name)}<br>${Q(x.qty)} × ${M(x.unitPrice)}</td><td align="right">${M(x.total)}</td></tr>`).join('')}</table><div class="row"><span>Subtotal</span><b>${M(r.subtotal)}</b></div><div class="row"><span>Discount</span><b>− ${M(r.discount)}</b></div><div class="row"><span>Tax</span><b>${M(r.tax)}</b></div><div class="row total"><span>Total</span><b>${M(r.total)}</b></div><div class="row"><span>Received</span><b>${M(r.received)}</b></div><div class="row"><span>Change</span><b>${M(Math.max(0, Number(r.received) - Number(r.total)))}</b></div><p style="text-align:center;margin-top:25px">Thank you for shopping!</p></body></html>`
    );
    popup.document.close();
    setTimeout(() => popup.print(), 250);
  }
  async function uploadLegacy(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    try {
      setLegacyImport({ data: JSON.parse(await file.text()), name: file.name });
    } catch {
      setError('Could not read this backup. Select a valid Star Mart JSON file.');
    }
  }
  async function confirmLegacyImport() {
    setBusy(true);
    setModalError('');
    try {
      const result = await post('/import-legacy', legacyImport.data);
      setLegacyImport(null);
      flash('Imported ' + result.products + ' products and ' + result.sales + ' sales.');
      await sync().catch(() => {});
    } catch (ex) {
      setModalError(ex.message);
    } finally {
      setBusy(false);
    }
  }
  async function exportBackup() {
    setBusy(true);
    try {
      const full = await get('/state?from=2000-01-01');
      const blob = new Blob(
        [
          JSON.stringify(
            {
              format: 'star-mart-server-export-v2',
              exportedAt: new Date().toISOString(),
              note:
                'Operational export, up to ' +
                (full.window?.limit || 5000) +
                ' rows per table. Not a database backup.',
              ...full,
            },
            null,
            2
          ),
        ],
        { type: 'application/json' }
      );
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'star-mart-export-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'ready' && portal === 'vendor')
    return (
      <Suspense fallback={<div className="boot">Loading vendor workspace…</div>}>
        <VendorPanel onLogout={logout} />
      </Suspense>
    );
  if (mode === 'loading') return <div className="boot">Loading Star Mart…</div>;
  if (mode !== 'ready')
    return (
      <div className={'sm-auth sm-portal sm-' + portal}>
        <header className="auth-header">
          <a href="/shop">
            <img src="/logo.png" alt="Star Mart" />
          </a>
          <nav>
            <a href="/shop">Back to store</a>
          </nav>
        </header>
        <main className="sm-auth-scene">
          <div className="sm-auth-copy">
            <span className="sm-eyebrow">STAR MART · HOUSE OF GROCERIES</span>
            <h1>
              {portal === 'vendor' ? (
                <>
                  Grow your grocery
                  <br />
                  <em>business with us.</em>
                </>
              ) : portal === 'staff' ? (
                <>
                  A smoother day
                  <br />
                  <em>at the counter.</em>
                </>
              ) : (
                <>
                  Your store,
                  <br />
                  <em>in clear view.</em>
                </>
              )}
            </h1>
            <p>
              {portal === 'vendor'
                ? 'View your products, stock and sales with your Star Mart vendor account.'
                : portal === 'staff'
                  ? 'Your counter and stock tools are ready when you are.'
                  : 'Manage grocery stock, customers, vendors and sales in one workspace.'}
            </p>
          </div>
          <form onSubmit={sign} className="sm-auth-card">
            <div className="sm-card-mark">✦ {portal.toUpperCase()} ACCESS</div>
            <h2>
              {mode === 'setup'
                ? 'Create owner account'
                : mode === 'error'
                  ? 'Connection problem'
                  : portal === 'admin'
                    ? 'Owner sign in'
                    : portal === 'staff'
                      ? 'Staff sign in'
                      : 'Vendor sign in'}
            </h2>
            <p>
              {mode === 'setup'
                ? 'Set the store owner name and a password of at least 8 characters.'
                : portal === 'vendor'
                  ? 'Use your email and the password you chose. Your application must be approved first.'
                  : portal === 'staff'
                    ? 'Use the staff account created by the owner.'
                    : 'Enter your owner password to access the admin panel.'}
            </p>
            {mode === 'setup' && (
              <label className="sm-field">
                <span>Your name</span>
                <span className="sm-input">
                  <input
                    value={owner}
                    onChange={e => setOwner(e.target.value)}
                    required
                    autoComplete="name"
                  />
                </span>
              </label>
            )}
            {portal !== 'admin' && mode === 'login' && (
              <label className="sm-field">
                <span>Email address</span>
                <span className="sm-input">
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </span>
              </label>
            )}
            {mode !== 'error' && (
              <label className="sm-field">
                <span>Password</span>
                <span className="sm-input">
                  <input
                    type="password"
                    value={password}
                    onChange={e => {
                      setPassword(e.target.value);
                      setError('');
                    }}
                    required
                    minLength={mode === 'setup' ? 8 : 1}
                    autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
                  />
                </span>
              </label>
            )}
            {error && (
              <p className="sm-error" role="alert">
                {error}
              </p>
            )}
            {mode === 'error' ? (
              <button type="button" className="sm-primary" onClick={() => location.reload()}>
                Retry connection
              </button>
            ) : (
              <button className="sm-primary" disabled={busy}>
                {busy ? 'Please wait…' : mode === 'setup' ? 'Create owner account' : 'Sign in'} →
              </button>
            )}
            {mode === 'login' && portal === 'admin' && firebaseConfigured && (
              <button
                type="button"
                className="security-link"
                disabled={busy}
                onClick={() => adminGoogle(false)}
              >
                Sign in with linked Google account
              </button>
            )}
            {mode === 'login' && portal !== 'admin' && (
              <p className="sm-switch">
                <a href={'/forgot-password?kind=' + portal}>Forgot password?</a>
              </p>
            )}
            {portal === 'vendor' && mode === 'login' && (
              <p className="sm-switch">
                New supplier? <a href="/become-a-vendor">Become a vendor</a>
              </p>
            )}
          </form>
        </main>
      </div>
    );
  const visibleNav = nav.filter(([key]) => roleViews[role].includes(key));
  return (
    <div className="shell sm-premium">
      <aside className={'sidebar ' + (sidebar ? 'side-open' : '')}>
        <div className="side-top">
          <img src="/logo.png" alt="Star Mart" />
          <button className="side-close" onClick={() => setSidebar(false)} aria-label="Close menu">
            <X size={20} />
          </button>
        </div>
        <div className="side-label">STORE WORKSPACE</div>
        <nav>
          {visibleNav.map(([key, label, Icon]) => (
            <button key={key} onClick={() => go(key)} className={view === key ? 'active' : ''}>
              <Icon size={19} />
              <span>{label}</span>
              {key === 'products' && low.length > 0 && <em>{low.length}</em>}
            </button>
          ))}
        </nav>
        <div className="side-footer">
          <div className="profile">
            <span>{user.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{user}</strong>
              <small>
                {portal === 'admin'
                  ? 'Store administrator'
                  : portal === 'staff'
                    ? 'Store staff'
                    : 'Vendor portal'}
              </small>
            </div>
          </div>
          <button onClick={logout}>
            <LogOut size={17} /> Sign out
          </button>
        </div>
      </aside>
      <div className="work">
        <header className="topbar">
          <div className="top-left">
            <button className="hamburger" onClick={() => setSidebar(true)} aria-label="Open menu">
              <Menu size={22} />
            </button>
            <div>
              <small>STAR MART / OPERATIONS</small>
              <strong>{nav.find(n => n[0] === view)?.[1]}</strong>
            </div>
          </div>
          <div className="top-right">
            <AdminCommand nav={visibleNav} onNavigate={go} />
            <AdminDate />
            <IconButton
              icon={RefreshCw}
              className="quiet"
              onClick={() => sync().catch(e => setError(e.message))}
            >
              Refresh
            </IconButton>
            {role === 'admin' && firebaseConfigured && (
              <button
                className="quiet"
                onClick={() => {
                  setError('');
                  setLinkOpen(true);
                }}
              >
                Link sign-in
              </button>
            )}
            {role === 'admin' && (
              <label className="quiet upload-label">
                <Upload size={17} />
                Import old backup
                <input type="file" accept=".json,application/json" hidden onChange={uploadLegacy} />
              </label>
            )}
            <a
              className="quiet shop-admin-link"
              href="/shop"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ShoppingBag size={17} />
              View shop
            </a>
            {role === 'admin' && (
              <IconButton icon={Download} className="quiet" disabled={busy} onClick={exportBackup}>
                Export
              </IconButton>
            )}
          </div>
        </header>
        <main className="main">
          <div
            className={
              'page-header ' + (view === 'dashboard' && role === 'admin' ? 'pdash-page-header' : '')
            }
          >
            <div>
              <span className="eyebrow">
                {view === 'dashboard'
                  ? 'STORE OVERVIEW'
                  : view === 'pos'
                    ? 'COUNTER BILLING'
                    : 'STORE OPERATIONS'}
              </span>
              <h1>{viewTitles[view]?.[0]}</h1>
              <p>{viewTitles[view]?.[1]}</p>
            </div>
            {view === 'dashboard' && role !== 'vendor' ? (
              <IconButton icon={ScanBarcode} className="primary" onClick={() => go('pos')}>
                Open POS
              </IconButton>
            ) : addTypes[view] &&
              (role === 'admin' || (role === 'staff' && view === 'adjustments')) ? (
              <IconButton icon={Plus} className="primary" onClick={() => open(addTypes[view])}>
                Add {addTypes[view]}
              </IconButton>
            ) : null}
          </div>
          {role === 'staff' && <PasswordChange kind="staff" />}
          {error && !modal && (
            <div className="error banner">
              <AlertTriangle size={17} />
              {error}
              <button onClick={() => setError('')} aria-label="Dismiss">
                <X size={16} />
              </button>
            </div>
          )}
          {view === 'dashboard' && role === 'admin' && (
            <PremiumDashboard
              data={data}
              low={low}
              go={go}
              stock={stock}
              orders={orders}
              user={user}
            />
          )}
          {view === 'activity' && role === 'admin' && (
            <RecordTable
              title="Store activity · latest 150 changes"
              columns={['When', 'Action', 'Source', 'Record', 'ID']}
              rows={activities.map(e => (
                <tr key={e.id}>
                  <td>{date(e.created_at)}</td>
                  <td>
                    <strong>{e.action}</strong>
                  </td>
                  <td>{e.actor}</td>
                  <td>{e.entity.replaceAll('_', ' ')}</td>
                  <td>
                    <small>{e.entity_id}</small>
                  </td>
                </tr>
              ))}
            />
          )}
          {view === 'pos' && (
            <WorkspaceTabs
              value={posTab}
              onChange={setPosTab}
              items={[
                ['counter', 'Counter sale'],
                [
                  'pickup',
                  'Pickup orders',
                  orders.filter(o => o.fulfillment === 'Pickup' && o.status === 'Pending').length,
                ],
              ]}
            />
          )}
          {view === 'pos' && posTab === 'pickup' && (
            <PickupDesk
              orders={orders}
              onComplete={async r => {
                setReceipt(r);
                flash('Pickup sale closed. Receipt and rewards updated.');
                await sync().catch(() => {});
              }}
              onError={setError}
            />
          )}
          {view === 'pos' && posTab === 'counter' && (
            <div className="pos-grid">
              <div className="pos-left">
                <section className="card scan-card">
                  <div className="card-title">
                    <div>
                      <span className="eyebrow">BARCODE STATION</span>
                      <h2>Scan or search</h2>
                    </div>
                    <ScanBarcode size={26} color="#fc2600" />
                  </div>
                  <div className="scan-input">
                    <ScanBarcode size={19} />
                    <input
                      ref={scanRef}
                      value={scan}
                      onChange={e => setScan(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          scanAdd();
                        }
                      }}
                      placeholder="Scan barcode / SKU, then Enter"
                      aria-label="Scan barcode or SKU"
                      autoFocus
                    />
                    <button onClick={() => scanAdd()}>Add</button>
                  </div>
                  <div className="scan-help">
                    USB scanners type into this field. Set the scanner suffix to Enter.
                  </div>
                  <div className="scan-tools">
                    <button onClick={() => setCamera(c => !c)}>
                      <Camera size={17} />
                      {camera ? 'Stop camera' : 'Use camera'}
                    </button>
                    <button onClick={() => scanRef.current?.focus()}>
                      <ScanBarcode size={17} />
                      Focus scanner
                    </button>
                  </div>
                  {camera && (
                    <BarcodeCamera
                      onClose={() => setCamera(false)}
                      onScan={code => scanAdd(code)}
                    />
                  )}
                </section>
                <section className="card catalog-card">
                  <div className="card-title">
                    <div>
                      <span className="eyebrow">PRODUCT CATALOG</span>
                      <h2>Quick add</h2>
                    </div>
                    <span className="count-pill">{inStock.length} available</span>
                  </div>
                  <div className="search-field">
                    <Search size={18} />
                    <input
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Search name, brand, category, barcode"
                      aria-label="Search catalog"
                    />
                  </div>
                  <div className="catalog-list">
                    {quickAdd.map(p => (
                      <button className="catalog-row" key={p.id} onClick={() => add(p)}>
                        <span className="product-avatar">
                          <Package size={21} />
                        </span>
                        <span className="catalog-name">
                          <strong>{p.name}</strong>
                          <small>
                            {p.category || 'Grocery'} · {p.barcode || p.sku || 'No barcode'} ·{' '}
                            {Q(sellable(p))} available
                          </small>
                        </span>
                        <b>{M(p.price_paisa)}</b>
                        <Plus size={17} />
                      </button>
                    ))}
                    {!inStock.length && (
                      <Empty text="Add products and receive stock to start billing." />
                    )}
                  </div>
                </section>
              </div>
              <section className="card checkout-card">
                <div className="card-title">
                  <div>
                    <span className="eyebrow">CURRENT TRANSACTION</span>
                    <h2>
                      Bill details{' '}
                      <span className="count-pill">
                        {lines.reduce((n, x) => n + x.qty / 1000, 0)} items
                      </span>
                    </h2>
                  </div>
                  <button
                    className="text-btn"
                    disabled={!lines.length}
                    onClick={() => {
                      clearBill();
                      flash('Bill cleared.');
                    }}
                  >
                    Clear bill
                  </button>
                </div>
                <div className="bill-lines">
                  {lines.map(({ p, qty }) => (
                    <div className="bill-line" key={p.id}>
                      <div>
                        <strong>{p.name}</strong>
                        <small>{M(p.price_paisa)} each</small>
                      </div>
                      <div className="stepper">
                        <button
                          onClick={() => updateCart(p.id, -1000)}
                          aria-label={'Reduce ' + p.name}
                        >
                          <Minus size={14} />
                        </button>
                        <span>{Q(qty)}</span>
                        <button
                          onClick={() => updateCart(p.id, 1000)}
                          aria-label={'Increase ' + p.name}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                      <b>{M(lineTotalPaisa(qty, p.price_paisa))}</b>
                    </div>
                  ))}
                  {!lines.length && (
                    <div className="bill-empty">
                      <ShoppingBag size={35} />
                      <strong>Ready for the first item</strong>
                      <span>Scan a product or use quick add.</span>
                    </div>
                  )}
                </div>
                <div className="bill-form">
                  <label>
                    Registered customer
                    <select
                      aria-label="Registered customer"
                      value={bill.customerId || ''}
                      onChange={e => {
                        const id = e.target.value,
                          c = customers.find(x => x.id === id);
                        setBill(b => ({
                          ...b,
                          customerId: id,
                          customer: c?.name || '',
                          redeemPoints: 0,
                        }));
                        loadCustomer(id);
                      }}
                    >
                      <option value="">Walk-in (no account)</option>
                      {customers.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name} · {c.email}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Customer name
                    <input
                      value={bill.customer}
                      onChange={e => setBill(b => ({ ...b, customer: e.target.value }))}
                      placeholder="Walk-in customer"
                    />
                  </label>
                  {bill.customerId && customerInfo && (
                    <div className="pos-loyalty">
                      <strong>{customerInfo.summary.points} points available</strong>
                      <span>Credit due: {M(customerInfo.summary.outstandingPaisa)}</span>
                      <label>
                        Redeem points
                        <select
                          value={bill.redeemPoints || 0}
                          onChange={e =>
                            setBill(b => ({ ...b, redeemPoints: Number(e.target.value) }))
                          }
                        >
                          {Array.from(
                            {
                              length: Math.min(
                                2,
                                Math.floor(Math.max(0, customerInfo.summary.points) / 100) + 1
                              ),
                            },
                            (_, i) => (
                              <option key={i} value={i * 100}>
                                {i ? i * 100 + ' points · Rs ' + i * 50 + ' off' : 'No points'}
                              </option>
                            )
                          )}
                        </select>
                      </label>
                      <small>
                        Next bill only · Rs 3,000 minimum · one Rs 50 reward · cannot combine
                        discounts · margin check at checkout.
                      </small>
                    </div>
                  )}
                  <label>
                    Payment method
                    <select
                      aria-label="Payment method"
                      value={bill.payment}
                      onChange={e => setBill(b => ({ ...b, payment: e.target.value }))}
                    >
                      {['Cash', 'Card', 'Bank transfer', 'Credit'].map(x => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Discount (Rs)
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={bill.discount}
                      onChange={e => setBill(b => ({ ...b, discount: e.target.value }))}
                      placeholder="0"
                    />
                    {role !== 'admin' && (
                      <small>Staff discounts are limited; the owner can approve larger ones.</small>
                    )}
                  </label>
                  {discount > 0 && (
                    <label>
                      Discount reason *
                      <input
                        value={bill.discountReason}
                        onChange={e => setBill(b => ({ ...b, discountReason: e.target.value }))}
                        placeholder="e.g. damaged pack, promotion"
                        maxLength={200}
                        required
                      />
                    </label>
                  )}
                  {role === 'admin' && (
                    <label>
                      Tax override (Rs, optional)
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={bill.tax}
                        onChange={e => setBill(b => ({ ...b, tax: e.target.value }))}
                        placeholder="Calculated from product rates"
                      />
                    </label>
                  )}
                  <label>
                    Received (Rs)
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={bill.received}
                      onChange={e => setBill(b => ({ ...b, received: e.target.value }))}
                      placeholder="Exact amount"
                    />
                  </label>
                  <label>
                    Reference
                    <input
                      value={bill.note}
                      onChange={e => setBill(b => ({ ...b, note: e.target.value }))}
                      placeholder="Optional"
                    />
                  </label>
                </div>
                <div className="totals">
                  <div>
                    <span>Subtotal</span>
                    <b>{M(subtotal)}</b>
                  </div>
                  <div>
                    <span>Discount</span>
                    <b>− {M(discount)}</b>
                  </div>
                  {loyaltyDiscount > 0 && (
                    <div>
                      <span>Points reward</span>
                      <b>− {M(loyaltyDiscount)}</b>
                    </div>
                  )}
                  <div>
                    <span>
                      Tax{taxOverride === null && role !== 'admin' ? ' (final at checkout)' : ''}
                    </span>
                    <b>{M(taxEstimate)}</b>
                  </div>
                  <div className="grand">
                    <span>Amount due</span>
                    <b>{M(total)}</b>
                  </div>
                  <div>
                    <span>Change</span>
                    <b>{M(Math.max(0, Math.round(Number(bill.received || 0) * 100) - total))}</b>
                  </div>
                </div>
                <button
                  className="primary full"
                  disabled={busy || !lines.length}
                  onClick={checkout}
                >
                  <CircleCheck size={18} />
                  Complete sale
                </button>
                <p className="checkout-note">
                  Stock, prices and tax are checked again on the server before the sale is saved.
                </p>
                {bill.customerId && (
                  <CreditCollection
                    customerId={bill.customerId}
                    info={customerInfo}
                    reload={() => loadCustomer(bill.customerId)}
                    flash={flash}
                    setError={setError}
                  />
                )}
              </section>
            </div>
          )}
          {view === 'orders' && (
            <OrdersWorkspace
              orders={orders}
              role={role}
              onAction={orderAction}
              onPickup={() => {
                setPosTab('pickup');
                go('pos');
              }}
            />
          )}
          {view === 'products' && role === 'admin' && (
            <AdminCatalog
              products={data.products}
              vendors={data.vendors}
              onEdit={p => open('product', p)}
              onImage={uploadPicture}
              onRefresh={sync}
              stock={stock}
              onReceive={receiveStock}
            />
          )}
          {view === 'products' && role !== 'admin' && (
            <RecordTable
              title="All products"
              search={query}
              setSearch={setQuery}
              filter={filter}
              setFilter={setFilter}
              filters={['all', 'low', 'available']}
              columns={[
                'Product',
                'SKU / Barcode',
                'Category / Shelf',
                'In stock',
                'Reserved',
                'Reorder',
                'Sell price',
              ]}
              rows={data.products
                .filter(
                  p =>
                    !p.deleted_at &&
                    (p.name + ' ' + p.sku + ' ' + p.barcode + ' ' + p.brand)
                      .toLowerCase()
                      .includes(query.toLowerCase())
                )
                .filter(p =>
                  filter === 'low'
                    ? low.includes(p)
                    : filter === 'available'
                      ? sellable(p) > 0
                      : true
                )
                .map(p => (
                  <tr key={p.id}>
                    <td>
                      <span className="product-mini">
                        {p.image && <img src={p.image} alt="" />}
                        <strong>{p.name}</strong>
                      </span>
                      <small>
                        {p.brand} {p.pack_size} · {p.unit}
                      </small>
                    </td>
                    <td>
                      {p.sku || '—'}
                      <small>{p.barcode || 'No barcode'}</small>
                    </td>
                    <td>
                      {p.category || '—'}
                      <small>{p.location || 'No shelf'}</small>
                    </td>
                    <td>
                      <Badge warn={stock(p) <= Number(p.reorder_milli)}>{Q(stock(p))}</Badge>
                    </td>
                    <td>{reserved(p) ? Q(reserved(p)) : '—'}</td>
                    <td>{Q(p.reorder_milli)}</td>
                    <td>
                      <strong>{M(p.price_paisa)}</strong>
                    </td>
                  </tr>
                ))}
            />
          )}
          {view === 'purchases' && (
            <RecordTable
              title="Stock received"
              columns={[
                'Date',
                'Product',
                'Vendor',
                'Quantity',
                'Batch / Expiry',
                'Unit cost',
                'Total',
                'Payment',
              ]}
              rows={data.purchases.map(x => (
                <tr key={x.id}>
                  <td>
                    {date(x.created_at)}
                    <small>{x.invoice || 'No invoice'}</small>
                  </td>
                  <td>
                    <strong>{product(x.product_id)?.name || 'Historical product'}</strong>
                  </td>
                  <td>{data.vendors.find(v => v.id === x.vendor_id)?.name || '—'}</td>
                  <td>{Q(x.qty_milli)}</td>
                  <td>
                    {x.batch || '—'}
                    <small>{x.expiry ? String(x.expiry).slice(0, 10) : 'No expiry'}</small>
                  </td>
                  <td>{M(x.unit_cost_paisa)}</td>
                  <td>
                    <strong>{M(lineTotalPaisa(x.qty_milli, x.unit_cost_paisa))}</strong>
                  </td>
                  <td>
                    <Badge warn={x.payment === 'Unpaid'}>{x.payment}</Badge>
                    <small>
                      Paid now:{' '}
                      {M(
                        x.payment === 'Paid'
                          ? lineTotalPaisa(x.qty_milli, x.unit_cost_paisa)
                          : x.paid_paisa
                      )}
                    </small>
                  </td>
                </tr>
              ))}
            />
          )}
          {view === 'sales' && (
            <SectionSwitcher
              items={
                role === 'admin'
                  ? [
                      ['daily', 'Daily summary'],
                      ['items', 'Product sales'],
                    ]
                  : [['items', 'Product sales']]
              }
            >
              {role === 'admin' && <DailySales refreshToken={refreshToken} />}
              <RecordTable
                title="Sales line items"
                columns={[
                  'Date / receipt',
                  'Product',
                  'Quantity',
                  'Unit price',
                  'Line total',
                  'Customer',
                  'Payment',
                ]}
                rows={data.sales.map(x => (
                  <tr key={x.id}>
                    <td>
                      {date(x.created_at)}
                      <small>{x.receipt}</small>
                    </td>
                    <td>
                      <strong>{product(x.product_id)?.name || 'Historical product'}</strong>
                    </td>
                    <td>{Q(x.qty_milli)}</td>
                    <td>{M(x.unit_price_paisa)}</td>
                    <td>
                      <strong>{M(x.line_total_paisa)}</strong>
                    </td>
                    <td>{x.customer}</td>
                    <td>{x.payment}</td>
                  </tr>
                ))}
              />
            </SectionSwitcher>
          )}
          {view === 'bulk' && role === 'admin' && (
            <Suspense fallback={<p>Loading importer…</p>}>
              <BulkImport onImported={sync} />
            </Suspense>
          )}
          {view === 'customers' && role === 'admin' && (
            <CustomersWorkspace
              customers={customers}
              onPOS={c => {
                setBill(b => ({ ...b, customerId: c.id, customer: c.name }));
                setPosTab('counter');
                go('pos');
                loadCustomer(c.id);
              }}
              renderCredit={(id, info, reload) => (
                <CreditCollection
                  customerId={id}
                  info={info}
                  reload={reload}
                  flash={flash}
                  setError={setError}
                />
              )}
            />
          )}
          {view === 'vendors' && role === 'admin' && (
            <Suspense fallback={<p>Loading vendor workspace…</p>}>
              <VendorManagement
                vendors={data.vendors}
                products={data.products}
                accounts={accounts}
                onEditVendor={v => open('vendor', v)}
                onChanged={async () => {
                  await sync().catch(() => {});
                  await loadAccounts().catch(() => {});
                }}
                renderCatalog={v => (
                  <AdminCatalog
                    key={v.id}
                    products={data.products.filter(p => p.vendor_id === v.id)}
                    vendors={[v]}
                    onEdit={p => open('product', p)}
                    onImage={uploadPicture}
                    onRefresh={sync}
                    stock={stock}
                    onReceive={receiveStock}
                  />
                )}
              />
            </Suspense>
          )}
          {view === 'adjustments' && (
            <RecordTable
              title="Stock movement corrections"
              columns={['Date', 'Product', 'Reason', 'Change', 'Explanation']}
              rows={data.adjustments.map(x => (
                <tr key={x.id}>
                  <td>{date(x.created_at)}</td>
                  <td>
                    <strong>{product(x.product_id)?.name || 'Historical product'}</strong>
                  </td>
                  <td>{x.reason}</td>
                  <td>
                    <Badge warn={Number(x.qty_milli) < 0}>
                      {Number(x.qty_milli) > 0 ? '+' : ''}
                      {Q(x.qty_milli)}
                    </Badge>
                  </td>
                  <td>{x.note}</td>
                </tr>
              ))}
            />
          )}
          {view === 'expenses' && (
            <RecordTable
              title="Operating costs"
              columns={['Date', 'Category', 'Description', 'Amount', 'Payment', 'Reference']}
              rows={data.expenses.map(x => (
                <tr key={x.id}>
                  <td>{date(x.created_at)}</td>
                  <td>{x.category}</td>
                  <td>
                    <strong>{x.description}</strong>
                  </td>
                  <td>
                    <strong>{M(x.amount_paisa)}</strong>
                  </td>
                  <td>{x.payment}</td>
                  <td>{x.reference || '—'}</td>
                </tr>
              ))}
            />
          )}
          {view === 'settings' && role === 'admin' && <StoreSettings />}
          {view === 'accounts' && role === 'admin' && (
            <TeamWorkspace
              accounts={accounts}
              vendors={data.vendors}
              onCreate={async f => {
                const r = await action('/accounts', 'POST', f);
                if (r) await loadAccounts();
                return r;
              }}
              onToggle={async a => {
                const r = await action('/accounts/' + seg(a.id), 'PATCH', { active: !a.active });
                if (r) await loadAccounts();
                return r;
              }}
            />
          )}
          {view === 'reports' && role === 'admin' && (
            <Reports
              products={data.products}
              purchases={data.purchases}
              low={low}
              stock={stock}
              refreshToken={refreshToken}
            />
          )}
        </main>
      </div>
      <Toaster position="bottom-right" richColors closeButton visibleToasts={2} duration={2600} />
      <Dialog
        open={!!modal}
        onOpenChange={isOpen => {
          if (!isOpen && !busy) setModal(null);
        }}
      >
        {modal && (
          <DialogContent
            className="sm-record-dialog"
            showCloseButton={false}
            onEscapeKeyDown={e => {
              if (document.querySelector('.sm-barcode-overlay')) e.preventDefault();
            }}
          >
            <DialogTitle className="sr-only">
              {form.id ? 'Edit' : 'Add'} {modal}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Complete the fields and save this store record.
            </DialogDescription>
            <form className="modal" onSubmit={submit}>
              <div className="modal-head">
                <div>
                  <span className="eyebrow">STAR MART / {form.id ? 'EDIT' : 'NEW'} RECORD</span>
                  <h2>
                    {form.id ? 'Edit' : 'Add'} {modal}
                  </h2>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setModal(null)}
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>
              {modal === 'product' && (
                <ProductBarcode
                  value={form.barcode}
                  onChange={code => setForm(prev => ({ ...prev, barcode: code }))}
                />
              )}
              {modal === 'product' && form.vendor_proposed_price_paisa != null && (
                <p className="aw-note">
                  Vendor proposed a new selling price of {M(form.vendor_proposed_price_paisa)}.
                  Review it from the product list.
                </p>
              )}
              <div className="aw-form-groups">
                {recordGroups[modal].map(group => {
                  const groupFields = group.keys
                    .map(key => fields[modal].find(f => f[0] === key))
                    .filter(Boolean)
                    .filter(
                      ([key]) =>
                        !(form.id && modal === 'product' && key === 'opening') &&
                        !(modal === 'purchase' && key === 'paid' && form.payment !== 'Part paid')
                    );
                  const body = (
                    <div className="modal-fields">
                      {groupFields.map(field => (
                        <RecordField
                          key={field[0]}
                          field={field}
                          form={form}
                          setForm={setForm}
                          modal={modal}
                          products={data.products}
                          vendors={data.vendors}
                          stock={stock}
                          product={product}
                        />
                      ))}
                    </div>
                  );
                  return group.extra ? (
                    <details className="aw-form-group" key={group.title}>
                      <summary>{group.title}</summary>
                      {body}
                    </details>
                  ) : (
                    <fieldset className="aw-form-group" key={group.title}>
                      <legend>{group.title}</legend>
                      {body}
                    </fieldset>
                  );
                })}
              </div>
              {modalError && (
                <div className="error" role="alert">
                  {modalError}
                </div>
              )}
              <div className="modal-foot">
                <button
                  type="button"
                  className="quiet"
                  disabled={busy}
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button className="primary" disabled={busy}>
                  {busy
                    ? 'Saving…'
                    : {
                        product: form.id ? 'Save product' : 'Add product',
                        vendor: 'Save vendor',
                        purchase: 'Receive stock',
                        adjustment: 'Save stock adjustment',
                        expense: 'Record expense',
                      }[modal]}
                </button>
              </div>
            </form>
          </DialogContent>
        )}
      </Dialog>
      <Dialog
        open={Boolean(legacyImport)}
        onOpenChange={v => {
          if (!v && !busy) setLegacyImport(null);
        }}
      >
        <DialogContent className="aw-dialog">
          <DialogTitle>Import old store backup?</DialogTitle>
          <DialogDescription>
            {legacyImport?.name}. This import only works when the database is empty. Existing store
            records will not be overwritten.
          </DialogDescription>
          {modalError && (
            <p className="aw-error" role="alert">
              {modalError}
            </p>
          )}
          <div className="aw-actions">
            <button className="quiet" disabled={busy} onClick={() => setLegacyImport(null)}>
              Cancel import
            </button>
            <button className="primary" disabled={busy} onClick={confirmLegacyImport}>
              {busy ? 'Importing…' : 'Import this backup'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      {linkOpen && (
        <div
          className="overlay"
          onMouseDown={e => {
            if (e.target === e.currentTarget && !busy) setLinkOpen(false);
          }}
        >
          <div
            className="receipt-modal admin-link-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="link-title"
          >
            <h2 id="link-title">Link admin sign-in</h2>
            <p>
              Only the current owner can link a verified Google or mobile account. Once linked, it
              can sign in without the owner password.
            </p>
            <button className="quiet" disabled={busy} onClick={() => adminGoogle(true)}>
              Link Google account
            </button>
            <label>
              Mobile number
              <input
                value={adminPhone}
                onChange={e => setAdminPhone(e.target.value)}
                placeholder="+923001234567"
              />
            </label>
            <div id="admin-recaptcha" />
            {adminPhoneResult ? (
              <>
                <input
                  value={adminCode}
                  onChange={e => setAdminCode(e.target.value)}
                  placeholder="SMS code"
                  aria-label="SMS code"
                />
                <button className="quiet" disabled={busy} onClick={() => adminPhoneVerify(true)}>
                  Verify and link mobile
                </button>
              </>
            ) : (
              <button className="quiet" disabled={busy} onClick={adminPhoneSend}>
                Send mobile code
              </button>
            )}
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <button className="quiet" disabled={busy} onClick={() => setLinkOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
      <Dialog
        open={!!receipt}
        onOpenChange={v => {
          if (!v) setReceipt(null);
        }}
      >
        {receipt && (
          <DialogContent className="aw-dialog aw-success">
            <CircleCheck size={48} color="#00745c" />
            <DialogTitle>
              {receipt.replayed ? 'Sale already recorded' : 'Sale completed'}
            </DialogTitle>
            <DialogDescription>
              {receipt.receipt} · {receipt.customer}
            </DialogDescription>
            <div className="aw-total">
              <span>Sale total</span>
              <strong>{M(receipt.total)}</strong>
            </div>
            <div className="aw-note">
              {receipt.replayed
                ? 'This bill was already saved by an earlier attempt. Nothing was charged twice.'
                : 'Receipt saved. Stock, sales and eligible customer rewards have updated.'}
            </div>
            <div className="aw-actions">
              <IconButton icon={Printer} className="primary" onClick={() => printReceipt()}>
                Print receipt
              </IconButton>
              <button
                className="quiet"
                onClick={() => {
                  setReceipt(null);
                  scanRef.current?.focus();
                }}
              >
                Next customer
              </button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

const path = location.pathname.replace(/\/$/, '') || '/';
const portalMatch = path.match(/^\/(admin|staff|vendor)(?:\/[a-z-]+)?$/);
const page = ['/about', '/contact', '/contact-us'].includes(path) ? (
  <StorePage kind={path === '/about' ? 'about' : 'contact'} />
) : ['/forgot-password', '/reset-password'].includes(path) ? (
  <PasswordHelp />
) : path === '/account' ? (
  <CustomerDashboard />
) : path === '/signup' || path === '/login' ? (
  <CustomerAuth initialMode={path === '/login' ? 'login' : 'signup'} />
) : path === '/become-a-vendor' ? (
  <VendorApply />
) : ['/', '/shop'].includes(path) ? (
  <Shop />
) : portalMatch ? (
  <App portal={portalMatch[1]} />
) : (
  <NotFound />
);
createRoot(document.getElementById('root')).render(
  <Suspense fallback={<div className="boot">Loading Star Mart…</div>}>{page}</Suspense>
);
