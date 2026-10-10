import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  ShoppingWelcome,
  ShoppingSetup,
  StoreAccountMenu,
  StoreCommunity,
} from './shopping-setup.jsx';
import { whatsappNumber } from './whatsapp-order.mjs';
import {
  SHOP_DEPARTMENTS,
  departmentValue,
  matchesDepartment,
  selectionName,
} from './shop-departments.mjs';
import { GROCERY_CATEGORIES, normalizeCategory } from './grocery-categories.mjs';
import CategoryDirectory, { CategoryIcon } from './category-directory.jsx';
import ProductDetail from './product-detail.jsx';
import StoreCheckout, { OrderConfirmation } from './store-checkout.jsx';
import { useLiveRefresh } from './live.js';
import { useCart } from './hooks/useCart.js';
import { useCheckoutDraft } from './hooks/useCheckoutDraft.js';
import { api, get, post } from './lib/api.js';
import { loadStoreSettings } from './lib/settings.js';
import { formatPaisa as money, formatQty as qty } from './lib/money.js';
import {
  Truck,
  MessageCircle,
  Users,
  ShoppingBag,
  UserRound,
  ArrowUpRight,
  ArrowRight,
  Tag,
} from 'lucide-react';
import './market.css';
import './storefront.css';
import './storefront-hero.css';
import './storefront-home.css';

const PAGE = 30;
export default function Shop() {
  const [products, setProducts] = useState([]),
    [status, setStatus] = useState('loading'),
    [loadError, setLoadError] = useState(''),
    [visible, setVisible] = useState(PAGE),
    [category, setCategory] = useState('all'),
    [search, setSearch] = useState(''),
    [selectedProduct, setSelectedProduct] = useState(null),
    [basketOpen, setBasketOpen] = useState(false),
    [user, setUser] = useState(null),
    [identityReady, setIdentityReady] = useState(false),
    [preferencesReady, setPreferencesReady] = useState(false),
    [preference, setPreference] = useState(null),
    [setupOpen, setSetupOpen] = useState(false),
    [communityOpen, setCommunityOpen] = useState(false),
    [store, setStore] = useState({}),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [placedOrder, setPlacedOrder] = useState(null);
  const { cart, change, set: setQuantity, remove, clear } = useCart();
  const checkoutDraft = useCheckoutDraft();
  const { draft, update } = checkoutDraft;
  const checkoutLock = useRef(false),
    noticeTimer = useRef(null);

  function message(s) {
    setNotice(s);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 3500);
  }
  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  useEffect(() => {
    loadStoreSettings().then(setStore);
  }, []);
  async function load() {
    try {
      const j = await get('/public/products');
      setProducts(j.products.map(p => ({ ...p, category: normalizeCategory(p.category) })));
      setStatus('ready');
      setLoadError('');
    } catch (e) {
      if (status !== 'ready') setStatus('error');
      setLoadError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  useLiveRefresh(load, 10000);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.has('signup')) location.href = '/signup';
    if (params.get('vendor') === 'apply') location.href = '/become-a-vendor';
  }, []);
  useEffect(() => {
    get('/customer/me')
      .then(j => {
        if (j?.user) {
          setUser(j.user);
          update({ name: j.user.name || '', phone: j.user.phone || '' });
        }
      })
      .catch(() => {})
      .finally(() => setIdentityReady(true));
  }, []);
  // After signing in from checkout, bring the shopper straight back to the basket with their details intact.
  useEffect(() => {
    if (!user) return;
    if (checkoutDraft.restore()) setBasketOpen(true);
  }, [user?.id]);
  useEffect(() => {
    if (!user) {
      setPreferencesReady(false);
      setPreference(null);
      return;
    }
    let active = true;
    get('/customer/preferences')
      .then(j => {
        if (!active) return;
        if (j.preference) {
          setPreference(j.preference);
          checkoutDraft.applyPreference(j.preference);
        } else if (user.linked !== false) setSetupOpen(true);
        setPreferencesReady(true);
      })
      .catch(e => {
        if (!active) return;
        setError(e.message);
        setPreferencesReady(true);
      });
    return () => {
      active = false;
    };
  }, [user?.id]);
  async function savePreference(p) {
    const j = await post('/customer/preferences', p);
    setPreference(j.preference);
    update({
      fulfillment: j.preference.fulfillment,
      phone: j.preference.phone,
      address: j.preference.address || '',
    });
    setSetupOpen(false);
    message('Shopping preferences saved.');
  }
  async function customerLogout() {
    try {
      await post('/customer/logout');
    } catch {
      /* the cookie is cleared server-side on the next request anyway */
    }
    setUser(null);
    setPreference(null);
    setSetupOpen(false);
    checkoutDraft.reset();
  }
  useEffect(() => {
    localStorage.setItem('star-mart-basket-seen', String(Date.now()));
  }, [cart]);

  const catalog = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const items = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, quantity]) => ({ p: catalog.get(id), quantity: Number(quantity) }))
        .filter(x => x.p && x.quantity > 0),
    [cart, catalog]
  );
  const total = useMemo(
    () =>
      items.reduce((sum, { p, quantity }) => sum + Math.round(Number(p.price_paisa) * quantity), 0),
    [items]
  );
  const categories = useMemo(
    () => [...new Set([...GROCERY_CATEGORIES, ...products.map(p => p.category).filter(Boolean)])],
    [products]
  );
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(
      p =>
        matchesDepartment(p.category, category) &&
        (!q ||
          (p.name + ' ' + p.brand + ' ' + p.barcode + ' ' + p.category).toLowerCase().includes(q))
    );
  }, [products, category, search]);
  const available = useMemo(
    () => products.filter(p => Number(p.stock_milli) > 0).length,
    [products]
  );
  const itemCount = items.reduce((n, x) => n + x.quantity, 0);

  function add(id, amount = 1) {
    const p = catalog.get(id);
    if (!p) {
      message('Product unavailable.');
      return false;
    }
    const outcome = change(id, amount, Math.floor(Number(p.stock_milli) / 1000));
    if (outcome === 'max') {
      message('More stock is not available.');
      return false;
    }
    message(p.name + ' added to basket.');
    return true;
  }
  function adjust(id, delta) {
    const p = catalog.get(id);
    if (change(id, delta, Math.floor(Number(p?.stock_milli || 0) / 1000)) === 'max')
      message('Not enough stock.');
  }
  async function checkout(channel = 'checkout') {
    setError('');
    if (!items.length || checkoutLock.current) return;
    if (channel !== 'whatsapp' && !user) {
      checkoutDraft.saveForSignIn();
      location.href = '/signup';
      return;
    }
    if (!(draft.name || user?.name || '').trim()) {
      setError('Enter your name.');
      return;
    }
    if (!(draft.phone || user?.phone || '').trim()) {
      setError('Enter your mobile number.');
      return;
    }
    let whatsappWindow = null;
    try {
      checkoutLock.current = true;
      setBusy(true);
      if (channel === 'whatsapp') {
        whatsappWindow = window.open('about:blank', '_blank');
        if (whatsappWindow) whatsappWindow.opener = null;
      }
      const orderPayload = {
        lines: items.map(({ p, quantity }) => ({ productId: p.id, qty: quantity })),
        name: draft.name || user?.name || 'Customer',
        phone: draft.phone || user?.phone || '',
        fulfillment: draft.fulfillment,
        address: draft.address,
        note: draft.note,
        paymentMethod: draft.paymentMethod,
        paymentReference: draft.paymentReference,
      };
      orderPayload.requestKey = checkoutDraft.requestKey({ channel, ...orderPayload });
      const j = await api(channel === 'whatsapp' ? '/public/whatsapp-order' : '/customer/orders', {
        method: 'POST',
        body: orderPayload,
      });
      checkoutDraft.clearAttempt();
      if (whatsappWindow && /^https:\/\/wa\.me\/[0-9]+\?text=/.test(j.whatsappUrl || ''))
        whatsappWindow.location.href = j.whatsappUrl;
      else whatsappWindow?.close();
      setPlacedOrder({
        ...j,
        fulfillment: draft.fulfillment,
        paymentMethod: draft.paymentMethod,
        channel,
      });
      clear();
      setBasketOpen(false);
      update({ paymentReference: '', note: '' });
      await load();
      message(
        'Order ' +
          j.id +
          ' saved. ' +
          (j.status === 'Inquiry'
            ? 'The store will confirm it on WhatsApp.'
            : j.paymentStatus || 'Payment pending') +
          '.'
      );
    } catch (e) {
      whatsappWindow?.close();
      setError(e.message);
    } finally {
      checkoutLock.current = false;
      setBusy(false);
    }
  }
  const storeWhatsApp = whatsappNumber(store.whatsapp || store.phone);
  return (
    <div className="market">
      <div className="announcement">
        <div className="container">
          Welcome to Star Mart <span>✦</span> House of Groceries{' '}
          <a href="#products">Browse available items ↗</a>
        </div>
      </div>
      <header className="store-header">
        <div className="container header-row">
          <a className="logo" href="/shop">
            <img className="store-logo" src="/logo.png" alt="Star Mart — House of Groceries" />
          </a>
          <nav className="main-nav" aria-label="Main navigation">
            <a href="/shop">Home</a>
            <a href="#categories">Categories</a>
            <a href="#products">Shop</a>
            <a href="/about">About</a>
            <a href="/contact">Contact</a>
            <a href="/become-a-vendor">Become a vendor</a>
          </nav>
          <a className="header-cta" href="#products">
            Shop now ↗
          </a>
          {user ? (
            <StoreAccountMenu
              user={user}
              fulfillment={draft.fulfillment}
              onChange={() => setSetupOpen(true)}
              onLogout={customerLogout}
            />
          ) : (
            <a
              className="header-icon account-button"
              href="/signup"
              aria-label="Create account or sign in"
              title="Create account or sign in"
            >
              <UserRound size={20} />
            </a>
          )}
          <button
            className="header-icon cart-button"
            onClick={() => {
              setError('');
              setBasketOpen(true);
            }}
            aria-label={'Open basket, ' + itemCount + ' items'}
            title="Basket"
          >
            <ShoppingBag size={20} />
            <b>{itemCount}</b>
          </button>
        </div>
      </header>
      <main id="home">
        <section className="hero" aria-labelledby="hero-title">
          <div className="container hero-inner">
            <div className="hero-text">
              <span className="hero-tag">Your neighbourhood grocery store</span>
              <h1 id="hero-title">
                Good food.
                <br />
                <em>Good every day.</em>
              </h1>
              <p>
                From pantry favourites to fresh picks, find your everyday groceries in one easy
                place.
              </p>
              <div className="hero-actions">
                <a className="shop-button" href="#products">
                  Shop the collection <ArrowUpRight size={18} aria-hidden="true" />
                </a>
                <a className="hero-secondary" href="#categories">
                  Browse categories <ArrowRight size={16} aria-hidden="true" />
                </a>
              </div>
              <ul className="hero-proof" aria-label="Why shop with Star Mart">
                <li>
                  <Tag size={15} aria-hidden="true" />
                  Live prices &amp; stock
                </li>
                <li>
                  <Truck size={15} aria-hidden="true" />
                  Delivery or self pickup
                </li>
                <li>
                  <MessageCircle size={15} aria-hidden="true" />
                  Order on WhatsApp
                </li>
              </ul>
            </div>
          </div>
        </section>
        <CategoryDirectory
          selected={category}
          onSelect={name => {
            setCategory(name);
            setSearch('');
            setVisible(PAGE);
            document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' });
          }}
        />
        <section className="container feature-grid" aria-label="Shop highlights">
          <a className="feature-card feature-fresh" href="#products">
            <span>FRESH FINDS</span>
            <h2>
              A little freshness
              <br />
              for every day.
            </h2>
            <strong>Explore produce ↗</strong>
          </a>
          <a className="feature-card feature-pantry" href="#products">
            <span>YOUR ESSENTIALS</span>
            <h2>
              Everything for
              <br />
              the everyday.
            </h2>
            <strong>Browse the shelves ↗</strong>
          </a>
          <div className="feature-card feature-simple">
            <span>SHOP WITH EASE</span>
            <h2>
              See what’s in
              <br />
              stock right now.
            </h2>
            <p>Our catalog shows current prices and availability.</p>
            <a href="#products">Start shopping ↗</a>
          </div>
        </section>
        <section className="section container products-section" id="products">
          <div className="section-heading products-heading">
            <div>
              <span className="kicker">THE STAR MART SELECTION</span>
              <h2>Shop our products</h2>
              <p>
                Available stock is live. Browse products supplied to Star Mart. Actual orders
                require available stock.
              </p>
            </div>
            <div className="search">
              <span>⌕</span>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                type="search"
                placeholder="Search products or barcode"
                aria-label="Search products"
              />
            </div>
          </div>
          <div className="filter-tabs" aria-label="Filter products">
            <button
              className={category === 'all' ? 'active' : ''}
              onClick={() => setCategory('all')}
            >
              All products
            </button>
            <select
              value={category}
              onChange={e => {
                setCategory(e.target.value);
                setVisible(PAGE);
              }}
              aria-label="Product category"
            >
              <option value="all">Shop by department</option>
              {SHOP_DEPARTMENTS.map(d => (
                <optgroup key={d.id} label={d.name}>
                  <option value={departmentValue(d.id)}>All {d.name}</option>
                  {d.categories
                    .filter(c => categories.includes(c))
                    .map(c => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                </optgroup>
              ))}
              {categories
                .filter(c => !SHOP_DEPARTMENTS.some(d => d.categories.includes(c)))
                .map(c => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
            </select>
            {category !== 'all' && (
              <span className="selected-aisle">{selectionName(category)}</span>
            )}
          </div>
          {loadError && status === 'ready' && (
            <p className="catalog-count" role="status">
              Showing the last loaded catalog · {loadError}
            </p>
          )}
          {status !== 'ready' ? (
            <div className="empty-products">
              {status === 'loading' ? 'Loading catalog…' : loadError || 'Products unavailable'}
            </div>
          ) : (
            <div className="product-grid">
              {shown.length ? (
                shown.slice(0, visible).map(p => {
                  const out = Number(p.stock_milli) < 1000;
                  return (
                    <article className="product-card" key={p.id}>
                      <button
                        type="button"
                        className="product-image product-image-button"
                        disabled={out}
                        aria-label={'View ' + p.name}
                        onClick={() => setSelectedProduct(p)}
                      >
                        {p.image ? (
                          <img
                            src={p.image}
                            alt={p.name}
                            loading="lazy"
                            onError={e => (e.currentTarget.style.display = 'none')}
                          />
                        ) : (
                          <span>
                            <CategoryIcon name={p.category} />
                          </span>
                        )}
                      </button>
                      <div className="product-content">
                        <small>
                          {p.category || 'Everyday essentials'} · {p.brand || 'Star Mart'}
                        </small>
                        <button
                          type="button"
                          className="sm-product-title"
                          disabled={out}
                          onClick={() => setSelectedProduct(p)}
                        >
                          {p.name}
                        </button>
                        <p>
                          {p.pack_size || p.unit} · {qty(p.stock_milli)} in stock
                        </p>
                        <div className="price-row">
                          <strong>{money(p.price_paisa)}</strong>
                          <button
                            disabled={out}
                            onClick={() => setSelectedProduct(p)}
                            aria-label={'View ' + p.name + ' and add to basket'}
                          >
                            {out ? 'Out of stock' : 'Add to cart +'}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="empty-products">
                  <strong>No products in this selection yet.</strong>Try another search or category.
                </div>
              )}
            </div>
          )}
          {shown.length > visible && (
            <button className="sample-more" onClick={() => setVisible(visible + PAGE)}>
              Show more products
            </button>
          )}
          <div className="catalog-count">
            Showing {Math.min(shown.length, visible)} of {shown.length} items · {available}{' '}
            currently available
          </div>
        </section>
        <section className="story" id="story">
          <div className="container story-inner">
            <div className="story-photo">
              <img src="/produce.jpg" alt="Basket of fresh produce" loading="lazy" />
            </div>
            <div className="story-copy">
              <span className="kicker">A BETTER WAY TO SHOP</span>
              <h2>Your whole grocery list, all in one place.</h2>
              <p>
                Star Mart brings groceries and daily essentials together. Browse what is available,
                add items to your basket and place a pickup or delivery request.
              </p>
              <a className="shop-button" href="#products">
                Explore the store ↗
              </a>
            </div>
          </div>
        </section>
        <section className="benefits">
          <div className="container benefits-row">
            <div>
              <span>✦</span>
              <strong>Everyday selection</strong>
              <small>Groceries for your routine</small>
            </div>
            <div>
              <span>▣</span>
              <strong>Live availability</strong>
              <small>See current store stock</small>
            </div>
            <div>
              <span>♡</span>
              <strong>Simple ordering</strong>
              <small>Request pickup or delivery</small>
            </div>
          </div>
        </section>
      </main>
      <footer>
        <div className="container footer-main">
          <div>
            <a className="logo" href="/shop">
              <img className="store-logo" src="/logo.png" alt="Star Mart" />
            </a>
            <p>House of Groceries. Everyday essentials made easy.</p>
            {store.phone && <a href={'tel:' + store.phone}>{store.phone}</a>}
            {store.address && <p>{store.address}</p>}
            {store.hours && <p>{store.hours}</p>}
          </div>
          <div>
            <strong>Explore</strong>
            <a href="#categories">Categories</a>
            <a href="#products">Products</a>
            <a href="/about">About Star Mart</a>
            <a href="/contact">Contact us</a>
          </div>
          <div>
            <strong>Work with us</strong>
            <a href="/become-a-vendor">Become a vendor</a>
            <a href="/vendor">Vendor sign in</a>
            <a href="/staff">Staff sign in</a>
            <a href="/admin">Owner sign in</a>
          </div>
          <div>
            <strong>Your account</strong>
            <a href={user ? '/account' : '/signup'}>{user ? 'My dashboard' : 'Create account'}</a>
            <button
              onClick={() => {
                setError('');
                setBasketOpen(true);
              }}
            >
              Your basket
            </button>
          </div>
        </div>
        <div className="container footer-bottom">
          © {new Date().getFullYear()} Star Mart · House of Groceries{' '}
          <a href="/category-photos/credits.html" target="_blank" rel="noopener noreferrer">
            Photo credits
          </a>
          <a href="/shop">Back to top ↑</a>
        </div>
      </footer>
      {notice && (
        <div className="toast show" role="status">
          {notice}
        </div>
      )}
      <div className="store-floating-contact">
        <button
          type="button"
          className="store-community-float"
          onClick={() => setCommunityOpen(true)}
        >
          <Users size={20} />
          <span>Community</span>
        </button>
        {storeWhatsApp ? (
          <a
            className="store-whatsapp-float"
            href={'https://wa.me/' + storeWhatsApp}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageCircle size={22} />
            <span>WhatsApp</span>
          </a>
        ) : (
          <button
            type="button"
            className="store-whatsapp-float"
            onClick={() => setCommunityOpen(true)}
          >
            <MessageCircle size={22} />
            <span>WhatsApp</span>
          </button>
        )}
      </div>
      {identityReady && !user && <ShoppingWelcome />}
      {user && preferencesReady && setupOpen && (
        <ShoppingSetup
          initial={
            preference || {
              fulfillment: draft.fulfillment,
              phone: draft.phone,
              address: draft.address,
            }
          }
          store={store}
          onSave={savePreference}
          onClose={preference ? () => setSetupOpen(false) : undefined}
        />
      )}
      {communityOpen && <StoreCommunity store={store} onClose={() => setCommunityOpen(false)} />}
      {selectedProduct && (
        <ProductDetail
          product={catalog.get(selectedProduct.id) || selectedProduct}
          quantity={Number(cart[selectedProduct.id] || 0)}
          onAdd={(id, amount) => add(id, amount)}
          onQuantity={n =>
            setQuantity(
              selectedProduct.id,
              n,
              Math.floor(Number(selectedProduct.stock_milli || 0) / 1000)
            )
          }
          onCart={() => {
            setSelectedProduct(null);
            setBasketOpen(true);
          }}
          onClose={() => setSelectedProduct(null)}
        />
      )}
      {basketOpen && (
        <StoreCheckout
          items={items}
          total={total}
          busy={busy}
          error={error}
          user={user}
          store={store}
          draft={draft}
          update={update}
          adjust={adjust}
          remove={remove}
          onClose={() => {
            setBasketOpen(false);
            setError('');
          }}
          onSubmit={() => checkout('checkout')}
          onWhatsApp={storeWhatsApp ? () => checkout('whatsapp') : undefined}
        />
      )}
      {placedOrder && (
        <OrderConfirmation order={placedOrder} onClose={() => setPlacedOrder(null)} />
      )}
    </div>
  );
}
