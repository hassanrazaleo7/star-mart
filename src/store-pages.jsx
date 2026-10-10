import React, { useState, useEffect } from 'react';
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Truck,
  Store,
  ShieldCheck,
  Phone,
  MapPin,
  Clock,
  MessageCircle,
} from 'lucide-react';
import { whatsappNumber } from './whatsapp-order.mjs';
import './store-pages.css';
const slides = [
  {
    tag: 'THE EVERYDAY EDIT',
    title: 'Your pantry.\nPerfectly stocked.',
    text: 'Discover groceries, household favourites and the brands you love.',
    image: '/grocery-hero.png',
    link: '/shop#products',
    cta: 'Explore groceries',
  },
  {
    tag: 'SHOP YOUR WAY',
    title: 'Pick it up.\nOr bring it home.',
    text: 'Choose self pickup or delivery, then shop available products at your pace.',
    image: '/vendor-grocery.png',
    link: '/shop#products',
    cta: 'Start shopping',
  },
  {
    tag: 'PARTNER WITH STAR MART',
    title: 'Great products.\nBetter together.',
    text: 'Bring your products to Star Mart. Apply as a vendor and manage your own catalog.',
    image: '/grocery-hero.png',
    link: '/become-a-vendor',
    cta: 'Become a vendor',
  },
];
export function HomeSlider() {
  const [index, setIndex] = useState(0),
    [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => setIndex(i => (i + 1) % slides.length), 6500);
    return () => clearInterval(timer);
  }, [paused]);
  const s = slides[index];
  return (
    <section
      className="sm-home-slider"
      aria-label="Star Mart highlights"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={e => {
        if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false);
      }}
    >
      <div className="container sm-slide-layout">
        <div className="sm-slide-copy" key={index}>
          <span>{s.tag}</span>
          <h1>
            {s.title.split('\n').map((line, i) => (
              <React.Fragment key={i}>
                {i > 0 && <br />}
                {line}
              </React.Fragment>
            ))}
          </h1>
          <p>{s.text}</p>
          <a className="sm-red-link" href={s.link}>
            {s.cta}
            <ArrowUpRight size={18} />
          </a>
          <div className="sm-slider-controls">
            <button
              aria-label="Previous slide"
              onClick={() => setIndex((index + slides.length - 1) % slides.length)}
            >
              <ChevronLeft size={18} />
            </button>
            {slides.map((_, i) => (
              <button
                key={i}
                aria-label={'Show slide ' + (i + 1)}
                aria-current={index === i ? 'true' : undefined}
                className={'sm-slide-dot ' + (index === i ? 'active' : '')}
                onClick={() => setIndex(i)}
              />
            ))}
            <button aria-label="Next slide" onClick={() => setIndex((index + 1) % slides.length)}>
              <ChevronRight size={18} />
            </button>
            <button className="sm-pause" onClick={() => setPaused(!paused)}>
              {paused ? 'Play' : 'Pause'}
            </button>
          </div>
        </div>
        <div className="sm-slide-photo">
          <img
            src={s.image}
            alt={
              index === 2
                ? 'Packaged groceries for Star Mart vendors'
                : 'Grocery essentials at Star Mart'
            }
          />
          <span>STAR MART · HOUSE OF GROCERIES</span>
        </div>
      </div>
    </section>
  );
}
export function HomePromotions() {
  return (
    <section className="container sm-promotions">
      <div className="sm-promotions-heading">
        <div>
          <span>MORE TO EXPLORE</span>
          <h2>Good picks for every day.</h2>
        </div>
        <a href="/shop#products">
          Browse the store <ArrowUpRight size={17} />
        </a>
      </div>
      <div className="sm-promo-grid">
        <a href="/shop#products" className="sm-promo-tile">
          <img src="/grocery-hero.png" alt="Everyday grocery collection" loading="lazy" />
          <div>
            <small>THE PANTRY COLLECTION</small>
            <h3>Essentials, all together.</h3>
            <span>
              Shop available products <ArrowUpRight size={17} />
            </span>
          </div>
        </a>
        <a href="/account" className="sm-promo-tile sm-promo-loyalty">
          <div>
            <small>HAPPY STAR REWARDS</small>
            <h3>Your next visit has more to offer.</h3>
            <p>
              Check your points, purchase history and eligible rewards in your customer account.
            </p>
            <span>
              Explore your account <ArrowUpRight size={17} />
            </span>
          </div>
        </a>
      </div>
      <div className="sm-service-strip">
        {[
          [Store, 'Self pickup', 'Collect your groceries from the store.'],
          [Truck, 'Delivery', 'Choose delivery during checkout.'],
          [ShieldCheck, 'Clear shopping', 'See current prices and available stock.'],
        ].map(([Icon, title, text]) => (
          <div key={title}>
            <Icon size={24} />
            <span>
              <strong>{title}</strong>
              <small>{text}</small>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
export default function StorePage({ kind }) {
  const [settings, setSettings] = useState({});
  useEffect(() => {
    fetch('/api/public/settings')
      .then(r => r.json())
      .then(setSettings)
      .catch(() => {});
  }, []);
  const number = whatsappNumber(settings.whatsapp || settings.phone || '');
  const about = kind === 'about';
  return (
    <div className="sm-info-page">
      <header className="sm-info-header">
        <a href="/shop">
          <img src="/logo.png" alt="Star Mart" />
        </a>
        <nav>
          <a href="/shop">Home</a>
          <a href="/shop#products">Shop</a>
          <a href="/about" aria-current={about ? 'page' : undefined}>
            About us
          </a>
          <a href="/contact" aria-current={!about ? 'page' : undefined}>
            Contact
          </a>
          <a className="sm-red-link" href="/become-a-vendor">
            Become a vendor
          </a>
        </nav>
      </header>
      <main>
        <section className="sm-info-hero">
          <div>
            <span>{about ? 'GET TO KNOW STAR MART' : 'WE’RE HERE TO HELP'}</span>
            <h1>{about ? 'Everyday shopping.\nA little easier.' : 'Let’s stay in touch.'}</h1>
            <p>
              {about
                ? 'Your groceries, household needs and everyday favourites—together in one store.'
                : 'Questions about a product, pickup, delivery or a vendor application? Get in touch with Star Mart.'}
            </p>
          </div>
          <img src="/grocery-hero.png" alt="Star Mart grocery essentials" />
        </section>
        {about ? (
          <section className="sm-info-body">
            <span>HOUSE OF GROCERIES</span>
            <h2>A store built around your everyday needs.</h2>
            <p>
              Star Mart brings groceries, packaged foods, personal care and household essentials
              into one convenient shopping experience. Browse categories, check available products
              and choose pickup or delivery.
            </p>
            <div className="sm-about-grid">
              {[
                ['Shop with clarity', 'Current prices and stock help you plan your basket.'],
                [
                  'Choose your convenience',
                  'Use the regular checkout or send your order through WhatsApp.',
                ],
                [
                  'Keep everything together',
                  'Your account brings orders, shopping history and rewards into one place.',
                ],
              ].map(([title, text]) => (
                <article key={title}>
                  <ShieldCheck />
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </div>
            <a className="sm-red-link" href="/shop#products">
              Explore the store <ArrowUpRight size={18} />
            </a>
          </section>
        ) : (
          <section className="sm-info-body">
            <h2>Contact the store</h2>
            <div className="sm-contact-grid">
              {settings.phone && (
                <a href={'tel:' + settings.phone}>
                  <Phone />
                  <strong>Call us</strong>
                  <span>{settings.phone}</span>
                </a>
              )}
              {settings.address && (
                <article>
                  <MapPin />
                  <strong>Visit Star Mart</strong>
                  <span>{settings.address}</span>
                </article>
              )}
              {settings.hours && (
                <article>
                  <Clock />
                  <strong>Store hours</strong>
                  <span>{settings.hours}</span>
                </article>
              )}
              {number && (
                <a href={'https://wa.me/' + number} target="_blank" rel="noopener noreferrer">
                  <MessageCircle />
                  <strong>WhatsApp</strong>
                  <span>Chat with the store →</span>
                </a>
              )}
            </div>
            {!settings.phone && !settings.address && !number && (
              <p>
                Store contact details are being updated. You can check your orders in your account
                or apply through our vendor page.
              </p>
            )}
            <div className="sm-contact-note">
              <h3>Interested in supplying products?</h3>
              <p>
                Start with the vendor application. After approval, you can access your vendor panel.
              </p>
              <a className="sm-red-link" href="/become-a-vendor">
                Become a vendor <ArrowUpRight size={18} />
              </a>
            </div>
          </section>
        )}
      </main>
      <footer className="sm-info-footer">
        <a href="/shop">Star Mart · House of Groceries</a>
        <a href="/about">About us</a>
        <a href="/contact">Contact us</a>
        <a href="/become-a-vendor">Become a vendor</a>
      </footer>
    </div>
  );
}
