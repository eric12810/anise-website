/* Analytics is deliberately disabled until an ID and an explicit choice exist. */
(function (global) {
  'use strict';
  const ids = global.AniseAnalyticsConfig || {};
  const host = global.location.hostname.toLowerCase();
  const staging = ['staging.loveanise.co.uk', 'www.staging.loveanise.co.uk'].includes(host);
  const production = ['loveanise.co.uk', 'www.loveanise.co.uk'].includes(host);
  const id = staging ? ids.staging : production ? ids.production : null;
  const valid = /^G-[A-Z0-9]+$/.test(id || '') && ids.staging !== ids.production;
  const key = 'anise.analytics.choice.v1';
  let choice = null;
  try { choice = localStorage.getItem(key); } catch (_) {}
  let loaded = false;
  function enable() {
    if (loaded || !valid || choice !== 'yes') return;
    loaded = true;
    global.dataLayer = global.dataLayer || [];
    global.gtag = function () { global.dataLayer.push(arguments); };
    global.gtag('js', new Date());
    global.gtag('config', id, {send_page_view: true, page_location: global.location.origin + global.location.pathname, allow_google_signals: false, allow_ad_personalization_signals: false});
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
    document.head.append(script);
  }
  function choose(value) {
    choice = value ? 'yes' : 'no';
    try { localStorage.setItem(key, choice); } catch (_) {}
    document.querySelector('#analytics-consent')?.remove();
    if (value) enable();
    else if (loaded) {
      global.gtag('consent', 'update', {analytics_storage: 'denied'});
      document.cookie.split(';').forEach(part => {
        const name = part.trim().split('=')[0];
        if (/^_ga(?:_|$)/.test(name)) {
          document.cookie = name + '=; Max-Age=0; path=/';
          document.cookie = name + '=; Max-Age=0; path=/; domain=.loveanise.co.uk';
        }
      });
      global.location.reload();
    }
  }
  function banner() {
    if (choice === 'yes') { enable(); return; }
    if (choice === 'no') return;
    const box = document.createElement('div');
    box.id = 'analytics-consent';
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', 'Analytics cookies');
    box.innerHTML = '<p>May we use optional analytics cookies to understand how people use this website? Ordering works without them.</p><button type="button" data-choice="no">Reject analytics</button> <button type="button" data-choice="yes">Accept analytics</button>';
    box.querySelectorAll('button').forEach(button => button.addEventListener('click', () => choose(button.dataset.choice === 'yes')));
    document.body.append(box);
  }
  function event(name, data) {
    if (choice !== 'yes' || !valid) return false;
    enable();
    global.gtag('event', name, data);
    return true;
  }
  function item(row) {
    return {item_id: String(row.productId), item_variant: String(row.variantId), item_name: String(row.name).slice(0, 100), price: Number(row.price), quantity: Number(row.quantity) || 1};
  }
  function items(rows) { return rows.map(item); }
  function purchase(requestId, order, snapshot) {
    if (!snapshot || snapshot.requestId !== requestId || !Number.isSafeInteger(Number(order.orderNumber))) return false;
    if (snapshot.payment === 'cash' ? !['Accepted', 'Preparing', 'Ready', 'Completed'].includes(order.status) : !['Placed', 'Accepted', 'Preparing', 'Ready', 'Completed'].includes(order.status)) return false;
    if (choice !== 'yes' || !valid) return false;
    const dedupe = 'anise.analytics.purchase.' + order.orderNumber;
    try {
      if (localStorage.getItem(dedupe)) return false;
      localStorage.setItem(dedupe, '1');
    } catch (_) { return false; }
    return event('purchase', {transaction_id: String(order.orderNumber), currency: 'GBP', value: snapshot.value, items: snapshot.items});
  }
  global.AniseAnalytics = Object.freeze({event, item, items, purchase, choose});
  function settings() {
    const button = document.createElement('button');
    button.type = 'button'; button.id = 'analytics-settings'; button.textContent = 'Analytics cookies';
    button.addEventListener('click', () => {
      if (document.querySelector('#analytics-consent')) return;
      choice = null; banner();
    });
    document.body.append(button);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { settings(); banner(); }, {once: true}); else { settings(); banner(); }
})(window);
