// Refresh original photos and thumbnails when a new menu page is loaded.
const menuImageRevision = Date.now().toString();
function menuPhotoUrl(path) {
  const url = new URL(path, window.AnisePos.api + "/");
  if (url.origin === window.AnisePos.api) url.searchParams.set("v", menuImageRevision);
  return url.href;
}
const list = document.querySelector('#dish-list');
const links = document.querySelector('#category-links');
const basket = document.querySelector('#basket-items');
const count = document.querySelector('#count');
const dialog = document.querySelector('.dish-dialog');
const form = document.querySelector('#dish-form');
const quantityInput = document.querySelector('#dish-quantity');
const notesInput = document.querySelector('#dish-notes');
const options = document.querySelector('#dish-options');
const selected = new Map();
const money = value => new Intl.NumberFormat('en-GB', {style: 'currency', currency: 'GBP'}).format(value);
let currentDish;
let dishScrollLock = null;
let dishRemovalObserver = null;
const dishLockedBodyStyles = ['position', 'top', 'left', 'width', 'overflow'];
const dishLockedRootStyles = ['overflow-y', 'overscroll-behavior', 'scroll-behavior'];
function saveInlineStyles(element, properties) {
  return properties.map(property => [property, element.style.getPropertyValue(property), element.style.getPropertyPriority(property)]);
}
function restoreInlineStyles(element, styles) {
  styles.forEach(([property, value, priority]) => {
    if (value) element.style.setProperty(property, value, priority);
    else element.style.removeProperty(property);
  });
}
function updateDishLockedWidth() {
  if (dishScrollLock) document.body.style.width = `${document.documentElement.clientWidth}px`;
}
function lockDishPageScroll() {
  if (dishScrollLock) return;
  const root = document.documentElement;
  const body = document.body;
  dishScrollLock = {
    x: window.scrollX, y: window.scrollY,
    bodyStyles: saveInlineStyles(body, dishLockedBodyStyles),
    rootStyles: saveInlineStyles(root, dishLockedRootStyles)
  };
  const hasScrollbarGutter = window.innerWidth > root.clientWidth;
  // Keep the desktop scrollbar space while the fixed body leaves normal flow.
  root.style.overflowY = hasScrollbarGutter ? 'scroll' : 'hidden';
  root.style.overscrollBehavior = 'none';
  body.style.position = 'fixed';
  body.style.top = `-${dishScrollLock.y}px`;
  body.style.left = `-${dishScrollLock.x}px`;
  body.style.overflow = 'hidden';
  updateDishLockedWidth();
  window.addEventListener('resize', updateDishLockedWidth);
  dishRemovalObserver = new MutationObserver(() => { if (!dialog.isConnected) unlockDishPageScroll(); });
  dishRemovalObserver.observe(body, {childList: true});
}
function unlockDishPageScroll() {
  if (!dishScrollLock) return;
  const {x, y, bodyStyles, rootStyles} = dishScrollLock;
  dishScrollLock = null;
  dishRemovalObserver?.disconnect();
  dishRemovalObserver = null;
  window.removeEventListener('resize', updateDishLockedWidth);
  restoreInlineStyles(document.body, bodyStyles);
  restoreInlineStyles(document.documentElement, rootStyles);
  // The site's smooth scrolling must not animate the saved position back.
  document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
  window.scrollTo(x, y);
  restoreInlineStyles(document.documentElement, rootStyles);
}
dialog.addEventListener('close', () => { if (!dialog.open) unlockDishPageScroll(); });
window.addEventListener('pagehide', unlockDishPageScroll);
window.addEventListener('pageshow', () => { if (dialog.open) lockDishPageScroll(); });
const dishCards = [];
let itemDiscounts = new Map(), discountFetchSequence = 0, refreshOpenDishPrice = null;
function salePrice(price, discount) {
  const pence = Math.round(price * 100);
  return (pence - Math.round(pence * Math.round(discount.percent * 100) / 10000)) / 100;
}
function priceLabel(price, discount, prefix = '') {
  return discount && salePrice(price, discount) < price ? `${prefix}originally ${money(price)}, offer price ${money(salePrice(price, discount))}${discount.minimumSubtotal ? ` with a minimum food order of ${money(discount.minimumSubtotal)}` : ''}` : prefix + money(price);
}
function renderDishPrice(target, price, discount, prefix = '', quantity = 1) {
  target.replaceChildren();
  if (prefix) target.append(document.createTextNode(prefix));
  if (!discount || salePrice(price, discount) >= price) { target.append(document.createTextNode(money(price * quantity))); return; }
  const old = element('s', money(price * quantity), 'dish-price-old'); old.setAttribute('aria-label', 'Original price ' + money(price * quantity));
  const current = element('strong', money(salePrice(price, discount) * quantity), 'dish-price-sale'); current.setAttribute('aria-label', 'Offer price ' + money(salePrice(price, discount) * quantity));
  target.append(old, document.createTextNode(' '), current);
  if (discount.minimumSubtotal) target.append(element('small', `Minimum food order ${money(discount.minimumSubtotal)}`, 'dish-price-condition'));
}
function updateDishPrices() {
  for (const card of dishCards) {
    const price = Math.min(...card.product.variants.map(v => v.price));
    const prefix = card.product.variants.length > 1 ? 'From ' : '';
    const discount = itemDiscounts.get(card.product.id);
    renderDishPrice(card.price, price, discount, prefix);
    card.row.setAttribute('aria-label', `View ${card.product.name}, ${priceLabel(price, discount, prefix)}`);
  }
  if (dialog.open && refreshOpenDishPrice) refreshOpenDishPrice();
}
async function refreshItemDiscounts() {
  if (location.protocol !== 'https:') return;
  const sequence = ++discountFetchSequence;
  const orderType = document.querySelector('.fulfilment button.selected').textContent.trim();
  itemDiscounts = new Map(); updateDishPrices();
  try {
    const response = await fetch(window.AnisePos.api + '/api/website/item-discounts', {
      method: 'POST', credentials: 'omit', cache: 'no-store', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ orderType, isReturningCustomer: window.AnisePromotionCookie.isReturning() }), signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error('Discounts unavailable');
    const discounts = await response.json();
    if (sequence !== discountFetchSequence || !Array.isArray(discounts)) return;
    for (const discount of discounts) {
      if (typeof discount.productId !== 'string' || !Number.isFinite(discount.percent) || discount.percent <= 0 || discount.percent > 100 || !Number.isFinite(discount.minimumSubtotal) || discount.minimumSubtotal < 0) continue;
      const previous = itemDiscounts.get(discount.productId);
      if (!previous || discount.percent > previous.percent || discount.percent === previous.percent && discount.minimumSubtotal < previous.minimumSubtotal) itemDiscounts.set(discount.productId, discount);
    }
    updateDishPrices();
    trackMenuCategory();
  } catch (_) { if (sequence === discountFetchSequence) { itemDiscounts = new Map(); updateDishPrices(); } }
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function openDish(product, category) {
  currentDish = product;
  const dialogImage = dialog.querySelector('.dialog-image');
  dialogImage.querySelector('img')?.remove();
  dialogImage.setAttribute('aria-label', 'Dish image placeholder');
  if (product.imageUrl) {
    const photo = element('img');
    photo.alt = '';
    photo.decoding = 'async';
    photo.addEventListener('load', () => {
      if (photo.parentElement === dialogImage) dialogImage.setAttribute('aria-label', product.name);
    }, {once: true});
    photo.addEventListener('error', () => photo.remove(), {once: true});
    photo.src = menuPhotoUrl(product.imageUrl);
    dialogImage.append(photo);
  }
  document.querySelector('#dialog-title').textContent = product.name;
  document.querySelector('#dialog-category').textContent = category;
  document.querySelector('.dialog-description').textContent = product.description || '';
  quantityInput.value = 1;
  notesInput.value = '';
  options.replaceChildren();
  const highestPriceIndex = product.variants.reduce((highest, variant, index, variants) => variant.price > variants[highest].price ? index : highest, 0);
  const variantGroup = element('fieldset');
  if (product.variants.length > 1) variantGroup.append(element('legend', 'Choose an option'));
  product.variants.forEach((variant, index) => {
    const choice = element('label', null, 'variant-choice');
    const input = element('input'); input.type = 'radio'; input.name = 'dish-variant';
    input.value = String(index); input.checked = index === highestPriceIndex;
    const label = element('span'); label.append(document.createTextNode(` ${variant.name} — `));
    const variantPrice = element('span'); renderDishPrice(variantPrice, variant.price, itemDiscounts.get(product.id)); label.append(variantPrice);
    choice.append(input, label);
    variantGroup.append(choice);
  });
  if (product.variants.length === 1) variantGroup.hidden = true;
  options.append(variantGroup);
  (product.modifierGroups || []).forEach((group, index) => {
    const fieldset = element('fieldset');
    fieldset.append(element('legend', `${group.name} (choose ${group.minimumSelections}–${group.maximumSelections})`));
    group.modifiers.forEach((modifier, modifierIndex) => {
      const choice = element('label', null, 'modifier-choice');
      const input = element('input'); input.type = group.maximumSelections === 1 ? 'radio' : 'checkbox';
      input.name = `modifier-${index}`; input.value = String(modifierIndex);
      choice.append(input, document.createTextNode(` ${modifier.name}${modifier.priceAdjustment ? ` (${modifier.priceAdjustment > 0 ? '+' : '−'}${money(Math.abs(modifier.priceAdjustment))})` : ''}`));
      fieldset.append(choice);
    });
    options.append(fieldset);
  });
  const updatePrice = () => {
    let price = product.variants[Number(options.querySelector('input[name="dish-variant"]:checked').value)].price;
    (product.modifierGroups || []).forEach((group, index) => {
      options.querySelectorAll(`input[name="modifier-${index}"]:checked`).forEach(input => { price += group.modifiers[Number(input.value)].priceAdjustment; });
    });
    renderDishPrice(document.querySelector('.dialog-price'), price, itemDiscounts.get(product.id), '', Number(quantityInput.value) || 1);
  };
  refreshOpenDishPrice = () => {
    options.querySelectorAll('input[name="dish-variant"]').forEach(input => {
      const variant = product.variants[Number(input.value)];
      renderDishPrice(input.parentElement.querySelector('span span'), variant.price, itemDiscounts.get(product.id));
    });
    updatePrice();
  };
  options.onchange = updatePrice;
  quantityInput.oninput = updatePrice;
  updatePrice();
  if (!dialog.open) {
    lockDishPageScroll();
    try { dialog.showModal(); }
    catch (error) { unlockDishPageScroll(); throw error; }
  }
  dialog.querySelector('.dialog-scroll').scrollTop = 0;
}
async function loadMenu() {
  const status = document.querySelector('#menu-status');
  try {
    if (location.protocol === 'file:' && !window.aniseLocalMenuPreview) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.onload = resolve;
        script.onerror = reject;
        script.src = 'local-menu-preview.js';
        document.head.append(script);
      });
    }
    let categories;
    if (location.protocol === 'file:' && Array.isArray(window.aniseLocalMenuPreview)) {
      categories = window.aniseLocalMenuPreview;
      document.querySelector('.mockup-notice').textContent = 'Local preview using a saved menu. Prices and availability may change; orders cannot be placed yet.';
    } else {
      const response = await fetch(window.AnisePos.api + '/api/menu', {cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(12000)});
      if (!response.ok) throw new Error('Menu unavailable');
      categories = await response.json();
    }
    if (!Array.isArray(categories)) throw new Error('Invalid menu');
    let displayed = 0;
    categories.forEach((category, index) => {
      if (!Array.isArray(category.products)) return;
      const products = category.products.filter(product => Array.isArray(product.variants) && product.variants.length && product.variants.every(v => typeof v.price === 'number' && Number.isFinite(v.price)));
      if (!products.length) return;
      const id = `order-category-${index}`;
      const link = element('a', category.name); link.href = `#${id}`; links.append(link);
      const section = element('section', null, 'dish-section'); section.id = id;
      const heading = element('div', null, 'section-label'); heading.append(element('h3', category.name));
      const grid = element('div', null, 'dish-grid');
      products.forEach(product => {
        const row = element('button', null, 'dish'); row.type = 'button';
        row.setAttribute('aria-label', `View ${product.name}`);
        const image = element('div', null, 'dish-image'); image.setAttribute('aria-hidden', 'true');
        image.append(element('span', 'ANISE'), element('small', 'Chinese gourmet'));
        if (product.imageUrl) {
          const photo = element('img');
          photo.alt = '';
          photo.loading = 'lazy';
          photo.decoding = 'async';
          const original = menuPhotoUrl(product.imageUrl);
          const useThumbnail = location.protocol !== 'file:' &&
            product.imageUrl === `/api/menu/products/${product.id}/image`;
          if (useThumbnail) {
            photo.addEventListener('error', () => {
              photo.addEventListener('error', () => photo.remove(), {once: true});
              photo.removeAttribute('srcset');
              photo.src = original;
            }, {once: true});
            const thumbnail = 'dish-thumbnail.ashx?v=' + menuImageRevision + '&id=' + encodeURIComponent(product.id);
            photo.sizes = '(max-width: 600px) 30vw, (max-width: 800px) 25vw, 180px';
            photo.srcset = thumbnail + '&size=144 144w, ' + thumbnail + '&size=240 240w, ' + thumbnail + ' 480w';
            photo.src = thumbnail + '&size=240';
          } else {
            photo.addEventListener('error', () => photo.remove(), {once: true});
            photo.src = original;
          }
          image.append(photo);
        }
        const info = element('div', null, 'dish-info');
        const minPrice = Math.min(...product.variants.map(v => v.price));
        const price = element('p', null, 'dish-price');
        renderDishPrice(price, minPrice, itemDiscounts.get(product.id), product.variants.length > 1 ? 'From ' : '');
        info.append(element('h4', product.name), price);
        dishCards.push({row, price, product});
        if (product.description) info.append(element('p', product.description, 'dish-description'));
        row.append(image, info, element('span', 'Add to basket', 'dish-action'));
        row.addEventListener('click', () => openDish(product, category.name)); grid.append(row); displayed++;
      });
      section.append(heading, grid); list.append(section);
    });
    status.textContent = displayed ? '' : 'There are no dishes available right now. Please call us for the current menu.';
    updateDishPrices();
  } catch (_) {
    status.textContent = 'The menu is temporarily unavailable. Please call us on 020 7916 4976 for the current menu.';
  }
}
function trackMenuCategory() {
  const sections = [...document.querySelectorAll('#dish-list .dish-section')];
  const categoryLinks = [...links.querySelectorAll('a')];
  const navigation = links.closest('.category-nav');
  if (!sections.length) return;
  const mobile = window.matchMedia('(max-width: 800px)');
  let activeLink;
  let framePending = false;
  function update() {
    framePending = false;
    const offset = parseFloat(getComputedStyle(sections[0]).scrollMarginTop) || 110;
    let activeIndex = 0;
    sections.forEach((section, index) => {
      if (section.getBoundingClientRect().top <= offset + 2) activeIndex = index;
    });
    const next = categoryLinks[activeIndex];
    if (next === activeLink) return;
    activeLink = next;
    categoryLinks.forEach(link => {
      if (link === activeLink) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    const item = activeLink.getBoundingClientRect();
    const viewport = navigation.getBoundingClientRect();
    if (mobile.matches) {
      if (item.left < viewport.left + 12 || item.right > viewport.right - 12) {
        navigation.scrollBy({left: item.left - viewport.left - (viewport.width - item.width) / 2, behavior: 'instant'});
      }
    } else if (item.top < viewport.top || item.bottom > viewport.bottom) {
      navigation.scrollBy({top: item.top - viewport.top - (viewport.height - item.height) / 2, behavior: 'instant'});
    }
  }
  function schedule() {
    if (!framePending) { framePending = true; requestAnimationFrame(update); }
  }
  window.addEventListener('scroll', schedule, {passive: true});
  window.addEventListener('resize', () => { activeLink = null; schedule(); });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(schedule).observe(document.querySelector('#dish-list'));
  update();
}

form.addEventListener('submit', event => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const variant = currentDish.variants[Number(options.querySelector('input[name="dish-variant"]:checked').value)];
  const modifiers = [];
  for (const [index, group] of (currentDish.modifierGroups || []).entries()) {
    const choices = [...options.querySelectorAll(`input[name="modifier-${index}"]:checked`)];
    if (choices.length < group.minimumSelections || choices.length > group.maximumSelections) {
      alert(`Please choose ${group.minimumSelections}–${group.maximumSelections} options for ${group.name}.`); return;
    }
    choices.forEach(input => modifiers.push(group.modifiers[Number(input.value)]));
  }
  const notes = notesInput.value.trim();
  const key = JSON.stringify([variant.id, modifiers.map(m => m.id).sort(), notes]);
  const entry = selected.get(key) || {variantId: variant.id, productId: currentDish.id, displayedDiscount: itemDiscounts.get(currentDish.id) ? {...itemDiscounts.get(currentDish.id), orderType: document.querySelector('.fulfilment button.selected').textContent.trim()} : null, name: currentDish.name, variant: variant.name, notes, modifiers, price: variant.price + modifiers.reduce((sum, m) => sum + m.priceAdjustment, 0), quantity: 0};
  entry.quantity += Number(quantityInput.value); selected.set(key, entry); render(); dialog.close();
});
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
function change(key, amount) {
  const entry = selected.get(key); if (!entry) return;
  entry.quantity += amount; if (entry.quantity <= 0) selected.delete(key); render();
}
let deliveryMinimumAttempted = false;
function render() {
  const total = [...selected.values()].reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = [...selected.values()].reduce((sum, item) => sum + item.quantity * item.price, 0);
  count.textContent = `${total} ${total === 1 ? 'item' : 'items'}`;
  const delivery = document.querySelector('.fulfilment button.selected').textContent.trim() === 'Delivery';
  document.querySelector('#checkout-open').disabled = total === 0;
  if (!delivery || Math.round(subtotal * 100) >= 1800) deliveryMinimumAttempted = false;
  document.querySelector('#fulfilment-note').classList.toggle('delivery-minimum-error', deliveryMinimumAttempted);
  document.querySelector('#fulfilment-note').textContent = delivery
    ? (Math.round(subtotal * 100) < 1800 ? `Minimum food subtotal for delivery is £18.00. Add ${money((1800 - Math.round(subtotal * 100)) / 100)} more.` : 'Minimum food subtotal for delivery is £18.00. Delivery availability and charges are confirmed by postcode.')
    : 'Collect your order from Anise in Camden.';
  document.querySelector('.basket-trigger-count').textContent = `(${total})`;
  document.querySelector('.basket-trigger strong').textContent = money(subtotal);
  document.querySelector('#basket-subtotal').textContent = money(subtotal);
  basket.replaceChildren();
  if (!total) { const empty = element('div', null, 'empty'); empty.innerHTML = '<span aria-hidden="true">✳</span><p>Your table awaits.</p><small>Add a dish to start your basket.</small>'; basket.append(empty); return; }
  selected.forEach((item, key) => {
    const row = element('div', null, 'basket-row'), details = element('div');
    details.append(element('strong', item.name), element('p', `${item.variant} · ${money(item.price)} each`, 'basket-item-note'));
    if (item.modifiers.length) details.append(element('p', item.modifiers.map(m => m.name).join(', '), 'basket-item-note'));
    if (item.notes) details.append(element('p', `Note: ${item.notes}`, 'basket-item-note'));
    const controls = element('div', null, 'quantity');
    const minus = element('button', '−'); minus.type = 'button'; minus.setAttribute('aria-label', `Remove one ${item.name}`); minus.addEventListener('click', () => change(key, -1));
    const plus = element('button', '+'); plus.type = 'button'; plus.setAttribute('aria-label', `Add one ${item.name}`); plus.addEventListener('click', () => change(key, 1));
    controls.append(minus, element('span', item.quantity), plus); row.append(details, controls); basket.append(row);
  });
}
document.querySelectorAll('.fulfilment button').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.fulfilment button').forEach(other => { other.classList.toggle('selected', other === button); other.setAttribute('aria-pressed', String(other === button)); });
  render();
  refreshItemDiscounts();
}));
const basketDialog = document.querySelector('.basket-dialog');
document.querySelector('.basket-trigger').addEventListener('click', () => basketDialog.showModal());
basketDialog.addEventListener('click', event => { if (event.target === basketDialog) basketDialog.close(); });
loadMenu();
refreshItemDiscounts();
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshItemDiscounts(); });
setInterval(() => { if (!document.hidden) refreshItemDiscounts(); }, 60000);

// Card checkout is enabled only when the POS reports a configured Stripe integration.
let appliedPromo = null;
const promoInput = document.querySelector('#promo-code');
const promoResult = document.querySelector('#promo-result');
function promoDiscount(subtotal) { return appliedPromo ? Math.round((subtotal * appliedPromo.percent + Number.EPSILON) ) / 100 : 0; }
function promoTotal(subtotal, fee = 0) { return Math.round((subtotal + fee - promoDiscount(subtotal)) * 100) / 100; }
function showPromo(subtotal) {
  if (appliedPromo && subtotal < appliedPromo.minimumSubtotal) {
    promoResult.textContent = 'This code requires a food subtotal of at least ' + money(appliedPromo.minimumSubtotal) + '. Please apply it again when your basket qualifies.';
    appliedPromo = null;
  }
  document.querySelector('#promo-discount-row').hidden = !appliedPromo;
  document.querySelector('#promo-discount').textContent = '−' + money(promoDiscount(subtotal));
}
promoInput.addEventListener('input', () => {
  if (appliedPromo && promoInput.value.trim().toUpperCase() !== appliedPromo.code) {
    appliedPromo = null; promoResult.textContent = 'Apply the new code to update your total.';
    const subtotal = [...selected.values()].reduce((sum, item) => sum + item.quantity * item.price, 0);
    showPromo(subtotal);
    document.querySelector('#checkout-total').textContent = money(promoTotal(subtotal, checkoutDelivery.hidden ? 0 : (confirmedDeliveryFee || 0)));
    document.querySelector('#checkout-review-total').textContent = !checkoutDelivery.hidden && confirmedDeliveryFee === null ? 'Delivery check required' : document.querySelector('#checkout-total').textContent;
    if (checkoutDialog.open) refreshPotentialOffer();
  }
});
document.querySelector('#apply-promo').addEventListener('click', async () => {
  const code = promoInput.value.trim().toUpperCase();
  appliedPromo = null;
  promoResult.textContent = 'Checking code…';
  try {
    const response = await fetch(window.AnisePos.api + '/api/website/promo-quote', { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }), signal: AbortSignal.timeout(12000) });
    const result = await response.json();
    if (promoInput.value.trim().toUpperCase() !== code) return;
    if (!response.ok) throw new Error(result.message || 'Could not check this code. Please try again.');
    const subtotal = [...selected.values()].reduce((sum, item) => sum + item.quantity * item.price, 0);
    if (subtotal < result.minimumSubtotal) throw new Error('This code requires a food subtotal of at least ' + money(result.minimumSubtotal) + '.');
    appliedPromo = { code, percent: result.percent, minimumSubtotal: result.minimumSubtotal };
    promoResult.textContent = 'Promo code applied.';
  } catch (error) { promoResult.textContent = error.message || 'Could not check this code. Please try again.'; }
  const subtotal = [...selected.values()].reduce((sum, item) => sum + item.quantity * item.price, 0);
  showPromo(subtotal);
  document.querySelector('#checkout-total').textContent = money(promoTotal(subtotal, checkoutDelivery.hidden ? 0 : (confirmedDeliveryFee || 0)));
  document.querySelector('#checkout-review-total').textContent = !checkoutDelivery.hidden && confirmedDeliveryFee === null ? 'Delivery check required' : document.querySelector('#checkout-total').textContent;
  if (checkoutDialog.open) refreshPotentialOffer();
});
const checkoutDialog = document.querySelector('.checkout-dialog');
const checkoutOpen = document.querySelector('#checkout-open');
const checkoutForm = document.querySelector('#checkout-form');
const checkoutDelivery = document.querySelector('#checkout-delivery');
let potentialSaving = 0, potentialOffer = null, potentialSequence = 0, acceptedOfferSignature = null;
function selectedItemPotential() {
  const groups = new Map();
  const orderType = checkoutDelivery.hidden ? 'Collection' : 'Delivery';
  for (const item of selected.values()) {
    const d = item.displayedDiscount;
    if (!d || d.orderType !== orderType) continue;
    const id = d.promotionId || [d.name, d.percent, d.minimumSubtotal].join('|');
    const group = groups.get(id) || {name:d.name || 'Item offer', percent:d.percent, minimumSubtotal:d.minimumSubtotal, pence:0};
    group.pence += Math.round(item.price * 100) * item.quantity; groups.set(id, group);
  }
  return [...groups.values()].map(g => ({ ...g, amount: Math.round(g.pence * Math.round(g.percent * 100) / 10000) / 100 }))
    .sort((a,b) => b.amount - a.amount)[0] || null;
}
function showPotential(candidate) {
  potentialOffer = candidate;
  potentialSaving = candidate?.amount || 0;
  const row = document.querySelector('#potential-offer'); row.hidden = !potentialSaving;
  if (!potentialSaving) return;
  document.querySelector('#potential-value').textContent = '−' + money(potentialSaving);
  const condition = candidate.minimumSubtotal ? ` Minimum food order ${money(candidate.minimumSubtotal)}.` : '';
  document.querySelector('#potential-note').textContent = (candidate.name ? candidate.name + '.' : 'Offer.') + condition + ' Potential saving; your best eligible offer is confirmed before the order is placed.';
}
function discountChangeReason(offer, discount) {
  const subtotal = [...selected.values()].reduce((sum, item) => sum + item.price * item.quantity, 0);
  if (offer?.minimumSubtotal > subtotal + 0.005) {
    const remaining = Math.round((offer.minimumSubtotal - subtotal) * 100) / 100;
    return `${offer.name || 'This offer'} requires a food subtotal of at least ${money(offer.minimumSubtotal)}. Your food subtotal is ${money(subtotal)}; add ${money(remaining)} more to qualify.`;
  }
  return discount > 0
    ? 'The previous offer is no longer available at the displayed amount. The best currently eligible offer has been applied.'
    : 'The previously displayed offer is no longer available or its conditions are no longer met. Please check the offer details or contact us for more information.';
}
async function refreshPotentialOffer() {
  const sequence = ++potentialSequence;
  const subtotal = [...selected.values()].reduce((sum,item) => sum + item.price * item.quantity, 0);
  let candidate = selectedItemPotential();
  const codeSaving = promoDiscount(subtotal);
  if (codeSaving > (candidate?.amount || 0)) candidate = {amount:codeSaving, name:'Promo code', minimumSubtotal:0};
  showPotential(candidate);
  if (!selected.size || location.protocol !== 'https:') return;
  const body = { orderType: checkoutDelivery.hidden ? 'Collection' : 'Delivery', phone:null,
    deliveryFee: checkoutDelivery.hidden ? 0 : (confirmedDeliveryFee || 0), promoCode:null,
    isReturningCustomer: window.AnisePromotionCookie.isReturning(),
    lines:[...selected.values()].map(item => ({variantId:item.variantId,quantity:item.quantity,modifierIds:item.modifiers.map(m => m.id),notes:item.notes})) };
  try {
    const response = await fetch(window.AnisePos.api + '/api/website/offer-quote', {method:'POST',credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
    if (!response.ok) return;
    const result = await response.json();
    if (sequence !== potentialSequence || !checkoutDialog.open || checkingOffer) return;
    if (Number.isFinite(result.discount) && result.discount > (candidate?.amount || 0)) candidate = {amount:result.discount, name:result.name || 'Offer', minimumSubtotal:0};
    showPotential(candidate);
  } catch (_) { /* The server will check again when the order is submitted. */ }
}
function confirmChangedOffer(message, total, discount) {
  const modal = document.querySelector('.offer-confirm-dialog');
  document.querySelector('#offer-confirm-message').textContent = message + ' Confirmed saving: ' + money(discount) + '. Order total: ' + money(total) + '. Would you like to continue?';
  modal.returnValue = '';
  return new Promise(resolve => { modal.addEventListener('close', () => resolve(modal.returnValue === 'continue'), {once:true}); modal.showModal(); });
}

checkoutOpen.addEventListener('click', () => {
  const foodSubtotal = [...selected.values()].reduce((sum, item) => sum + item.quantity * item.price, 0);
  if (document.querySelector('.fulfilment button.selected').textContent.trim() === 'Delivery' && Math.round(foodSubtotal * 100) < 1800) {
    deliveryMinimumAttempted = true;
    render();
    const note = document.querySelector('#fulfilment-note');
    note.setAttribute('tabindex', '-1');
    note.focus();
    return;
  }
  clearCheckoutError();
  reviewedOffer = null; document.querySelector('#offer-row').hidden = true;
  const delivery = document.querySelector('.fulfilment button.selected').textContent.trim() === 'Delivery';
  checkoutDelivery.hidden = !delivery;
  clearDeliveryQuote();
  checkoutDelivery.querySelectorAll('input').forEach(input => { input.setCustomValidity(''); input.removeAttribute('aria-invalid'); document.getElementById(input.id + '-error').textContent = ''; });
  document.querySelector('#checkout-fulfilment').textContent = delivery
    ? 'Delivery · Check your postcode for availability and charge.' : 'Collection · 1 Kent House, Ferdinand Street, London NW1 8ET.';
  const summary = document.querySelector('#checkout-summary');
  summary.replaceChildren();
  let subtotal = 0;
  selected.forEach(item => {
    subtotal += item.price * item.quantity;
    const row = element('div', null, 'checkout-summary-row');
    const description = element('div');
    description.append(element('strong', `${item.quantity} × ${item.name}`), element('small', [item.variant, ...item.modifiers.map(m => m.name)].join(' · ')));
    if (item.notes) description.append(element('small', `Note: ${item.notes}`));
    row.append(description, element('span', money(item.price * item.quantity)));
    summary.append(row);
  });
  showPromo(subtotal);
  document.querySelector('#checkout-total').textContent = money(promoTotal(subtotal));
  document.querySelector('#checkout-review-total').textContent = delivery ? 'Delivery check required' : money(promoTotal(subtotal));
  document.querySelector('#checkout-review-note').textContent = delivery ? 'Check your postcode to confirm the delivery fee and total.' : 'Prices will be confirmed before your order is placed.';
  checkoutDelivery.querySelector('#checkout-address-line1').required = delivery;
  checkoutDelivery.querySelector('#checkout-postcode').required = delivery;
  basketDialog.close();
  checkoutDialog.showModal();
  refreshPotentialOffer();
});
checkoutDialog.addEventListener('click', event => { if (event.target === checkoutDialog) checkoutDialog.close(); });
const checkoutFields = ['checkout-name', 'checkout-phone', 'checkout-email', 'checkout-address-line1', 'checkout-address-line2', 'checkout-postcode'].map(id => document.getElementById(id));
function validateCheckoutField(input) {
  const value = input.value.trim();
  let message = '';
  if (input.id === 'checkout-name' && (!/\p{L}/u.test(value) || /[\x00-\x1f\x7f]/.test(value))) message = 'Enter your name.';
  if (input.id === 'checkout-email' && (!value || input.validity.typeMismatch)) message = 'Enter a valid email address.';
  if (input.id === 'checkout-phone') {
    const digits = value.replace(/[^0-9]/g, '');
    if (!/^[+() 0-9-]+$/.test(value) || digits.length < 7 || digits.length > 15 || (value.match(/\+/g) || []).length > 1 || (value.includes('+') && !value.startsWith('+'))) message = 'Enter a phone number with 7 to 15 digits.';
  }
  if (!checkoutDelivery.hidden && input.id.startsWith('checkout-address-line')) {
    if ((input.id === 'checkout-address-line1' && !value) || (value && (!/[\p{L}\p{N}]/u.test(value) || /[\x00-\x1f\x7f]/.test(value)))) message = 'Enter a valid address line.';
  }
  if (!checkoutDelivery.hidden && input.id === 'checkout-postcode') {
    const compact = value.replace(/ /g, '');
    if (!/^[a-z0-9 ]+$/i.test(value) || compact.length < 5 || compact.length > 7 || !/[a-z]/i.test(compact) || !/[0-9]/.test(compact)) message = 'Enter a valid UK postcode.';
  }
  input.setCustomValidity(message);
  const error = document.getElementById(input.id + '-error');
  error.textContent = message;
  input.setAttribute('aria-invalid', String(Boolean(message)));
  return !message;
}
checkoutFields.forEach(input => {
  input.addEventListener('blur', () => validateCheckoutField(input));
  input.addEventListener('input', () => { if (input.getAttribute('aria-invalid') === 'true') validateCheckoutField(input); });
});
const deliveryResult = document.querySelector('#delivery-result');
const deliveryFeeRow = document.querySelector('#delivery-fee-row');
const deliveryPostcode = document.querySelector('#checkout-postcode');
let deliveryQuoteSequence = 0;
let pendingDeliverySequence = null;
let confirmedDeliveryFee = null;
let deliveryRequiresApproval = false;
function clearDeliveryQuote() {
  deliveryQuoteSequence++;
  confirmedDeliveryFee = null;
  deliveryRequiresApproval = false;
  document.querySelector('#outside-radius-warning').hidden = true;
  document.querySelector('#outside-radius-acknowledgement').checked = false;
  deliveryFeeRow.hidden = true;
  deliveryResult.textContent = '';
  const subtotal = [...selected.values()].reduce((sum, item) => sum + item.quantity * item.price, 0);
  showPromo(subtotal);
  document.querySelector('#checkout-total').textContent = money(promoTotal(subtotal));
  document.querySelector('#checkout-review-total').textContent = checkoutDelivery.hidden ? money(promoTotal(subtotal)) : 'Delivery check required';
  document.querySelector('#checkout-review-note').textContent = checkoutDelivery.hidden ? 'Prices will be confirmed before your order is placed.' : 'Check your postcode to confirm the delivery fee and total.';
}
deliveryPostcode.addEventListener('input', () => { clearDeliveryQuote(); potentialSequence++; showPotential(selectedItemPotential()); });
async function checkDeliveryAvailability() {
  if (checkoutDelivery.hidden || pendingDeliverySequence === deliveryQuoteSequence) return;
  clearDeliveryQuote();
  if (!validateCheckoutField(deliveryPostcode)) return;
  const sequence = deliveryQuoteSequence;
  pendingDeliverySequence = sequence;
  const button = document.querySelector('#check-delivery');
  button.disabled = true;
  deliveryResult.textContent = 'Checking delivery availability…';
  try {
    const response = await fetch(window.AnisePos.api + '/api/website/delivery-quote', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'omit',
      body: JSON.stringify({postcode: deliveryPostcode.value.trim()}), signal: AbortSignal.timeout(12000)
    });
    const result = await response.json().catch(() => ({}));
    if (sequence !== deliveryQuoteSequence || checkoutDelivery.hidden) return;
    if (!response.ok) { deliveryResult.textContent = result.message || 'Delivery availability is temporarily unavailable. Please try again later.'; return; }
    if (!result.eligible) { deliveryResult.textContent = 'Sorry, this postcode is outside our delivery area.'; return; }
    if (typeof result.deliveryFee !== 'number' || !Number.isFinite(result.deliveryFee) || result.deliveryFee < 0) throw new Error('Invalid delivery fee');
    confirmedDeliveryFee = result.deliveryFee;
    deliveryRequiresApproval = result.requiresApproval === true;
    document.querySelector('#outside-radius-warning').hidden = !deliveryRequiresApproval;
    deliveryResult.textContent = deliveryRequiresApproval ? 'This address is outside our normal delivery radius. Your order will be sent to Anise for review and we may decline it.' : 'Delivery is available for this postcode.';
    document.querySelector('#delivery-fee').textContent = money(result.deliveryFee);
    deliveryFeeRow.hidden = false;
    const subtotal = [...selected.values()].reduce((sum, item) => sum + item.quantity * item.price, 0);
    document.querySelector('#checkout-total').textContent = money(promoTotal(subtotal, result.deliveryFee));
    document.querySelector('#checkout-review-total').textContent = money(promoTotal(subtotal, result.deliveryFee));
    refreshPotentialOffer();
    document.querySelector('#checkout-review-note').textContent = deliveryRequiresApproval ? 'This address is outside our normal delivery radius. Anise will review your order and may decline it.' : 'Prices and availability will be checked again when you place your order.';
  } catch (_) {
    if (sequence === deliveryQuoteSequence && !checkoutDelivery.hidden) deliveryResult.textContent = 'Delivery availability is temporarily unavailable. Please try again later.';
  } finally {
    if (pendingDeliverySequence === sequence) {
      pendingDeliverySequence = null;
      button.disabled = false;
    }
  }
}
document.querySelector('#check-delivery').addEventListener('click', checkDeliveryAvailability);
deliveryPostcode.addEventListener('blur', () => {
  if (!checkoutDelivery.hidden && deliveryPostcode.value.trim() && confirmedDeliveryFee === null) checkDeliveryAvailability();
});
const checkoutStatus = document.querySelector('#checkout-status');
function showCheckoutError(message, field) {
  checkoutStatus.classList.add('checkout-status-error');
  checkoutStatus.setAttribute('role', 'alert');
  checkoutStatus.setAttribute('tabindex', '-1');
  checkoutStatus.textContent = message;
  if (field) {
    field.setAttribute('aria-invalid', 'true');
    field.focus();
    field.scrollIntoView({block: 'center'});
  } else {
    checkoutStatus.focus();
    checkoutStatus.scrollIntoView({block: 'center'});
  }
}
function clearCheckoutError() {
  checkoutStatus.classList.remove('checkout-status-error');
  checkoutStatus.setAttribute('role', 'status');
}
checkoutForm.addEventListener('invalid', event => {
  const input = event.target;
  if (checkoutFields.includes(input)) validateCheckoutField(input);
  input.setAttribute('aria-invalid', 'true');
  checkoutStatus.classList.add('checkout-status-error');
  checkoutStatus.setAttribute('role', 'alert');
  checkoutStatus.textContent = 'Please correct the highlighted fields before continuing.';
}, true);

let reviewedOffer = null;
let checkingOffer = false;
const checkoutSubmit = checkoutForm.querySelector('button[type="submit"]');
const pendingKey = 'anise.pendingCashOrder';
const pendingCardKey = 'anise.pendingCardOrder';
let cardAvailable = false;
fetch(window.AnisePos.api + '/api/website/card-availability', {method:'POST',credentials:'omit',signal:AbortSignal.timeout(12000)}).then(r => r.ok ? r.json() : {}).then(result => { cardAvailable = result.available === true; updateCheckoutPayment(); }).catch(() => {});
const trackingKey = 'anise.currentOrderStatus';
const tracking = document.createElement('p');
tracking.setAttribute('role', 'status');
tracking.hidden = true;
document.querySelector('.order-intro').append(tracking);
const checkoutTracking = document.createElement('p');
checkoutTracking.setAttribute('role', 'status');
checkoutStatus.after(checkoutTracking);
const trackingLink = document.createElement('a');
trackingLink.textContent = 'View and save your private order tracking link';
trackingLink.hidden = true;
checkoutTracking.after(trackingLink);
function showTracking(text) { tracking.textContent = text; checkoutTracking.textContent = text; }
let trackingTimer;
async function refreshOrderStatus() {
  if (location.protocol !== 'https:') return;
  let saved;
  try { saved = JSON.parse(sessionStorage.getItem(trackingKey) || 'null'); } catch (_) { return; }
  if (!saved?.requestId || !saved?.orderNumber) return;
  trackingLink.href = 'order-status#' + encodeURIComponent(saved.requestId);
  trackingLink.hidden = false;
  tracking.hidden = false;
  try {
    const response = await fetch(window.AnisePos.api + '/api/website/orders/status', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'omit', cache: 'no-store',
      body: JSON.stringify({requestId: saved.requestId}), signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error();
    const order = await response.json();
    const labels = {Placed: 'awaiting acceptance', Accepted: 'accepted', Preparing: 'being prepared', Ready: 'ready', Completed: 'completed', Cancelled: 'declined or cancelled', Refunded: 'refunded'};
    const status = labels[order.status] || 'being updated';
    const time = order.estimatedAtUtc && ['Accepted', 'Preparing', 'Ready'].includes(order.status)
      ? ' Estimated ' + order.orderType.toLowerCase() + ' time: ' + new Date(order.estimatedAtUtc).toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit'}) + '.' : '';
    showTracking(`Order #${order.orderNumber}: ${status}.${time}`);
    if (['Completed', 'Cancelled', 'Refunded'].includes(order.status)) clearInterval(trackingTimer);
  } catch (_) { showTracking(`Order #${saved.orderNumber}: status temporarily unavailable. Please call 020 7916 4976 if you need an update.`); }
}
if (location.protocol === 'https:') {
  refreshOrderStatus();
  trackingTimer = setInterval(refreshOrderStatus, 15000);
}
function updateCheckoutPayment() {
  const cash = checkoutForm.elements.payment.value === 'cash';
  document.querySelector('#checkout-review-payment').textContent = cash ? 'Cash' : 'Card';
  checkoutSubmit.disabled = checkingOffer || (!cash && !cardAvailable);
  checkoutSubmit.textContent = cash ? 'Place cash order' : 'Continue to card payment';
  checkoutStatus.textContent = cash ? 'Your order will be sent to the restaurant for confirmation. Cash payment is due on collection or delivery.' : cardAvailable ? 'You will continue to Stripe’s secure checkout. Your order will be sent to the restaurant after payment is confirmed.' : 'Card payment is not available yet.';
}
checkoutForm.addEventListener('change', event => {
  if (event.target.name === 'payment') { clearCheckoutError(); updateCheckoutPayment(); }
});
checkoutForm.addEventListener('input', () => {
  if (!reviewedOffer) return;
  reviewedOffer = null;
  document.querySelector('#offer-row').hidden = true;
  const subtotal = [...selected.values()].reduce((sum,item) => sum + item.quantity * item.price, 0);
  showPromo(subtotal);
  const total = promoTotal(subtotal, checkoutDelivery.hidden ? 0 : (confirmedDeliveryFee || 0));
  document.querySelector('#checkout-total').textContent = money(total);
  document.querySelector('#checkout-review-total').textContent = !checkoutDelivery.hidden && confirmedDeliveryFee === null ? 'Delivery check required' : money(total);
});
checkoutForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (location.protocol !== 'https:') { showCheckoutError('Please open the secure website before placing your order.'); return; }
  if (checkingOffer) return;
  clearCheckoutError();
  const foodSubtotal = [...selected.values()].reduce((sum, item) => sum + item.quantity * item.price, 0);
  if (!checkoutDelivery.hidden && Math.round(foodSubtotal * 100) < 1800) { showCheckoutError('The minimum food subtotal for delivery is £18.00.'); return; }
  const validFields = checkoutFields.map(validateCheckoutField).every(Boolean);
  if (!validFields) { showCheckoutError('Please correct the highlighted fields before continuing.', checkoutFields.find(input => input.getAttribute('aria-invalid') === 'true')); return; }
  if (!checkoutForm.reportValidity()) return;
  if (!selected.size) { showCheckoutError('Your basket is empty. Add a dish before placing your order.'); return; }
  if (checkoutForm.elements.payment.value === 'card' && !cardAvailable) { showCheckoutError('Card payment is not available. Please choose another payment method.'); return; }
  if (!checkoutDelivery.hidden && confirmedDeliveryFee === null) { showCheckoutError('Check delivery availability before placing your order.', deliveryPostcode); return; }
  if (deliveryRequiresApproval && !checkoutDelivery.hidden && !document.querySelector('#outside-radius-acknowledgement').checked) { showCheckoutError('Please confirm you understand we may decline this delivery order.'); document.querySelector('#outside-radius-acknowledgement').focus(); return; }
  const data = {
    outsideRadiusAcknowledged: !checkoutDelivery.hidden && deliveryRequiresApproval && document.querySelector('#outside-radius-acknowledgement').checked,
    orderType: checkoutDelivery.hidden ? 'Collection' : 'Delivery',
    expectedTotal: promoTotal([...selected.values()].reduce((sum, item) => sum + item.quantity * item.price, 0), checkoutDelivery.hidden ? 0 : confirmedDeliveryFee),
    promoCode: appliedPromo?.code || null,
    name: checkoutForm.elements.name.value.trim(), phone: checkoutForm.elements.phone.value.trim(), email: checkoutForm.elements.email.value.trim(),
    addressLine1: checkoutDelivery.hidden ? null : checkoutForm.elements.addressLine1.value.trim(),
    addressLine2: checkoutDelivery.hidden ? null : checkoutForm.elements.addressLine2.value.trim(),
    postcode: checkoutDelivery.hidden ? null : checkoutForm.elements.postcode.value.trim(),
    lines: [...selected.values()].map(item => ({variantId: item.variantId, quantity: item.quantity,
      modifierIds: item.modifiers.map(modifier => modifier.id), notes: item.notes}))
  };
  if (window.AnisePromotionCookie.isReturning()) data.isReturningCustomer = true;
  const quoteRequest = { isReturningCustomer: data.isReturningCustomer || false, orderType: data.orderType, phone: data.phone, deliveryFee: checkoutDelivery.hidden ? 0 : confirmedDeliveryFee, lines: data.lines, promoCode: data.promoCode };
  const quoteKey = JSON.stringify(quoteRequest);
  const formFingerprint = () => JSON.stringify([checkoutFields.map(x => x.value), checkoutForm.elements.payment.value,
    checkoutDelivery.hidden, confirmedDeliveryFee, document.querySelector('#outside-radius-acknowledgement').checked,
    appliedPromo?.code || null, [...selected.values()].map(x => [x.variantId,x.quantity,x.modifiers.map(m => m.id),x.notes])]);
  const submittedFingerprint = formFingerprint();
  const expectedSaving = potentialSaving;
  const expectedOffer = potentialOffer;
  potentialSequence++;
  checkingOffer = true; checkoutSubmit.disabled = true; checkoutStatus.textContent = 'Checking your best available offer…';
  try {
    let response = await fetch(window.AnisePos.api + '/api/website/offer-quote', { method:'POST', credentials:'omit', headers:{'Content-Type':'application/json'}, body:JSON.stringify(quoteRequest), signal:AbortSignal.timeout(12000) });
    let quote = await response.json().catch(() => ({}));
    let unavailableCode = null;
    if (!response.ok && quote.code === 'promo_unavailable' && data.promoCode) {
      unavailableCode = quote.message || 'Your promo code can no longer be applied.';
      response = await fetch(window.AnisePos.api + '/api/website/offer-quote', { method:'POST', credentials:'omit', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...quoteRequest,promoCode:null}), signal:AbortSignal.timeout(12000) });
      quote = await response.json().catch(() => ({}));
      if (response.ok) data.promoCode = null;
    }
    if (!response.ok) throw new Error(quote.message || 'Could not check your order. Please try again.');
    if (!Number.isFinite(quote.total) || !Number.isFinite(quote.discount)) throw new Error('Could not check your order. Please try again.');
    if (submittedFingerprint !== formFingerprint()) throw new Error('Your order changed while we checked it. Please review it and try again.');
    const previousTotal = data.expectedTotal;
    data.expectedTotal = quote.total;
    const offerRow = document.querySelector('#offer-row'); offerRow.hidden = !quote.discount;
    document.querySelector('#offer-name').textContent = quote.name || 'Offer';
    document.querySelector('#offer-discount').textContent = '−' + money(quote.discount);
    document.querySelector('#promo-discount-row').hidden = true;
    document.querySelector('#checkout-total').textContent = money(quote.total);
    document.querySelector('#checkout-review-total').textContent = money(quote.total);
    const signature = JSON.stringify([quoteKey,quote.total,quote.discount,quote.name]);
    let confirmedChange = false;
    if (acceptedOfferSignature !== signature && (unavailableCode || quote.discount + 0.005 < expectedSaving || quote.total > previousTotal + 0.005)) {
      const reason = unavailableCode || (quote.discount + 0.005 < expectedSaving ? discountChangeReason(expectedOffer, quote.discount) : 'The order total has increased since it was displayed.');
      confirmedChange = await confirmChangedOffer(reason, quote.total, quote.discount);
      if (!confirmedChange) { checkingOffer = false; updateCheckoutPayment(); showCheckoutError('Your order has not been placed. You can change your basket or try again.'); return; }
      if (submittedFingerprint !== formFingerprint()) throw new Error('Your order changed while we checked it. Please review it and try again.');
    }
    if (!confirmedChange && acceptedOfferSignature !== signature && (quote.discount > 0 || quote.total !== previousTotal) && reviewedOffer !== signature) {
      reviewedOffer = signature;
      checkoutStatus.textContent = 'Your best available offer is shown above. Please review the total and press the button again to continue.';
      checkingOffer = false; checkoutSubmit.disabled = false; return;
    }
    reviewedOffer = signature;
    acceptedOfferSignature = null;
  } catch (error) {
    checkingOffer = false; updateCheckoutPayment(); showCheckoutError(error.message || 'Could not check your order. Please try again.'); return;
  }
  checkingOffer = false; checkoutSubmit.disabled = false;
  const isCard = checkoutForm.elements.payment.value === 'card';
  const activePendingKey = isCard ? pendingCardKey : pendingKey;
  const otherPendingKey = isCard ? pendingKey : pendingCardKey;
  if (sessionStorage.getItem(otherPendingKey)) { showCheckoutError('A previous order has not been confirmed. Please call us before placing another order.'); return; }
  let pending;
  try { pending = JSON.parse(sessionStorage.getItem(activePendingKey) || 'null'); } catch (_) { pending = null; }
  if (pending && JSON.stringify(pending.data) !== JSON.stringify(data)) {
    showCheckoutError('Your previous order could not be confirmed. Please call us on 020 7916 4976 before placing another order.');
    return;
  }
  if (!pending) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
    pending = {requestId: `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`, data};
    try { sessionStorage.setItem(activePendingKey, JSON.stringify(pending)); }
    catch (_) { showCheckoutError('Your browser cannot safely save this order. Please call us to order.'); return; }
  }
  checkoutSubmit.disabled = true;
  checkoutStatus.textContent = 'Sending your order…';
  try {
    const response = await fetch(isCard ? window.AnisePos.api + '/api/website/stripe-checkout' : window.AnisePos.api + '/api/website/orders/cash', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'omit',
      body: JSON.stringify({requestId: pending.requestId, ...data}), signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
        sessionStorage.removeItem(activePendingKey);
        const detail = await response.json().catch(() => ({}));
        if ((response.status === 409 && detail.message?.startsWith('The order total has changed.')) || detail.code === 'promo_unavailable') {
          checkingOffer = true;
          checkoutStatus.textContent = 'Checking the updated total…';
          let revisedRequest = {...quoteRequest};
          let revisedResponse = await fetch(window.AnisePos.api + '/api/website/offer-quote', {method:'POST', credentials:'omit', headers:{'Content-Type':'application/json'}, body:JSON.stringify(revisedRequest), signal:AbortSignal.timeout(12000)});
          let revised = await revisedResponse.json().catch(() => ({}));
          if (!revisedResponse.ok && revised.code === 'promo_unavailable' && revisedRequest.promoCode) {
            revisedRequest.promoCode = null;
            revisedResponse = await fetch(window.AnisePos.api + '/api/website/offer-quote', {method:'POST', credentials:'omit', headers:{'Content-Type':'application/json'}, body:JSON.stringify(revisedRequest), signal:AbortSignal.timeout(12000)});
            revised = await revisedResponse.json().catch(() => ({}));
          }
          if (!revisedResponse.ok || !Number.isFinite(revised.total) || !Number.isFinite(revised.discount)) throw new Error('Unable to check the updated total.');
          if (submittedFingerprint !== formFingerprint()) throw new Error('Your order changed while we checked it.');
          document.querySelector('#offer-row').hidden = !revised.discount;
          document.querySelector('#offer-name').textContent = revised.name || 'Offer';
          document.querySelector('#offer-discount').textContent = '−' + money(revised.discount);
          document.querySelector('#promo-discount-row').hidden = true;
          document.querySelector('#checkout-total').textContent = money(revised.total);
          document.querySelector('#checkout-review-total').textContent = money(revised.total);
          const reason = detail.code === 'promo_unavailable' ? detail.message : revised.discount + 0.005 < expectedSaving ? discountChangeReason(expectedOffer, revised.discount) : 'The order total has changed since it was displayed.';
          const proceed = await confirmChangedOffer(reason, revised.total, revised.discount);
          if (proceed && submittedFingerprint === formFingerprint()) {
            if (!revisedRequest.promoCode && appliedPromo) { appliedPromo = null; promoResult.textContent = 'The promo code is no longer available.'; }
            acceptedOfferSignature = JSON.stringify([JSON.stringify(revisedRequest),revised.total,revised.discount,revised.name]);
            potentialSaving = revised.discount;
            checkingOffer = false;
            checkoutForm.requestSubmit();
            return;
          }
          checkingOffer = false;
          showCheckoutError('Your order has not been placed. You can change your basket or try again.');
          return;
        }
        showCheckoutError(detail.message || 'Please check your order and try again.');
      } else showCheckoutError('We could not confirm your order. Retry without changing it, or call us on 020 7916 4976.');
      return;
    }
    const result = await response.json();
    if (isCard) {
      const url = new URL(result.url);
      if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' || url.port || url.username || url.password) throw new Error('Unexpected checkout address');
      location.assign(url.href); return;
    }
    if (!result.orderNumber) throw new Error('Missing order number');
    window.AnisePromotionCookie.markReturning();
    if (location.protocol === 'https:') {
      try { sessionStorage.setItem(trackingKey, JSON.stringify({requestId: pending.requestId, orderNumber: result.orderNumber})); } catch (_) {}
      clearInterval(trackingTimer);
      trackingTimer = setInterval(refreshOrderStatus, 15000);
      refreshOrderStatus();
    }
    sessionStorage.removeItem(pendingKey);
    selected.clear(); render();
    checkoutSubmit.disabled = true;
    location.assign('order-status#' + encodeURIComponent(pending.requestId));
  } catch (error) {
    if (checkingOffer) { checkingOffer = false; showCheckoutError(error.message || 'Could not check your updated total. Please try again.'); }
    else showCheckoutError('We could not confirm your order. Retry without changing it, or call us on 020 7916 4976.');
  } finally { if (selected.size && (checkoutForm.elements.payment.value === 'cash' || cardAvailable)) checkoutSubmit.disabled = false; }
});
