/* Guest basket data only. Prices and availability are rebuilt from /api/menu. */
(function (global) {
  const key = 'anise.guestBasket.v1';
  const lifetime = 7 * 24 * 60 * 60 * 1000;
  function read() {
    try {
      const raw = global.localStorage.getItem(key);
      if (!raw) return null;
      const value = JSON.parse(raw);
      if (value?.version !== 1 || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now() ||
          !['Collection', 'Delivery'].includes(value.orderType) || !Array.isArray(value.items) || value.items.length > 200 ||
          value.items.some(item => !item || typeof item.productId !== 'string' || typeof item.variantId !== 'string' ||
            !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 9999 ||
            !Array.isArray(item.modifierIds) || item.modifierIds.length > 100 || item.modifierIds.some(id => typeof id !== 'string') ||
            typeof item.notes !== 'string' || item.notes.length > 500 ||
            (item.unitPrice !== undefined && !Number.isFinite(item.unitPrice)))) return null;
      return value;
    } catch (_) { return null; }
  }
  function write(items, orderType, expiresAt = Date.now() + lifetime) {
    try {
      global.localStorage.setItem(key, JSON.stringify({version:1, expiresAt, orderType,
        items:items.map(item => ({productId:item.productId, variantId:item.variantId, quantity:item.quantity,
          modifierIds:item.modifiers.map(modifier => modifier.id), notes:item.notes, unitPrice:item.price}))}));
      return true;
    } catch (_) { return false; }
  }
  function clear() { try { global.localStorage.removeItem(key); } catch (_) {} }
  function clearIfMatches(lines, orderType) {
    const saved = read();
    if (!saved || saved.orderType !== orderType || !Array.isArray(lines)) return false;
    const normalize = values => values.map(item => JSON.stringify([item.variantId, item.quantity,
      (item.modifierIds || []).slice().sort(), item.notes || ''])).sort();
    if (JSON.stringify(normalize(saved.items)) !== JSON.stringify(normalize(lines))) return false;
    clear();
    return true;
  }
  function resolve(saved, categories) {
    const products = new Map();
    categories.forEach(category => (category.products || []).forEach(product => products.set(product.id, product)));
    const entries = new Map(), notices = [];
    for (const item of saved?.items || []) {
      const product = products.get(item.productId);
      const variant = product?.variants?.find(value => value.id === item.variantId);
      if (!variant || !Number.isFinite(variant.price)) { notices.push('A saved dish is no longer available and was removed.'); continue; }
      const availableModifiers = new Map();
      let valid = true;
      for (const group of product.modifierGroups || []) {
        const groupModifiers = group.modifiers.filter(modifier => item.modifierIds.includes(modifier.id));
        if (groupModifiers.length < group.minimumSelections || groupModifiers.length > group.maximumSelections) valid = false;
        groupModifiers.forEach(modifier => availableModifiers.set(modifier.id, modifier));
      }
      if (!valid || availableModifiers.size !== item.modifierIds.length || new Set(item.modifierIds).size !== item.modifierIds.length) {
        notices.push(`${product.name} has a modifier that is no longer available and was removed.`); continue;
      }
      const modifiers = item.modifierIds.map(id => availableModifiers.get(id));
      const price = variant.price + modifiers.reduce((sum, modifier) => sum + modifier.priceAdjustment, 0);
      if (!Number.isFinite(price)) { notices.push(`${product.name} is unavailable and was removed.`); continue; }
      if (Number.isFinite(item.unitPrice) && Math.abs(item.unitPrice - price) >= 0.005)
        notices.push(`${product.name} has a new price. Please review your basket.`);
      const basketKey = JSON.stringify([variant.id, item.modifierIds.slice().sort(), item.notes]);
      const previous = entries.get(basketKey);
      if (previous) previous.quantity = Math.min(9999, previous.quantity + item.quantity);
      else entries.set(basketKey, {productId:product.id, variantId:variant.id, name:product.name,
        variant:variant.name, modifiers, notes:item.notes, quantity:item.quantity, price, displayedDiscount:null});
    }
    return {entries, notices};
  }
  global.AniseBasketStorage = Object.freeze({key, read, write, clear, clearIfMatches, resolve});
})(window);
