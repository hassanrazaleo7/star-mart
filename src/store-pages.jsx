import React, { useState, useEffect } from 'react';
import { ArrowUpRight, ShieldCheck, Phone, MapPin, Clock, MessageCircle } from 'lucide-react';
import { whatsappNumber } from './whatsapp-order.mjs';
import { loadStoreSettings } from './lib/settings.js';
import './store-pages.css';
export default function StorePage({ kind }) {
  const [settings, setSettings] = useState({});
  useEffect(() => {
    loadStoreSettings().then(setSettings);
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
          <img src="/grocery-hero.jpg" alt="Star Mart grocery essentials" />
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
