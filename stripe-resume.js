(() => {
  'use strict';
  const api = window.AnisePos.api + '/api/website/';
  const button = document.querySelector('#resume');
  const message = document.querySelector('#message');
  const statusLink = document.querySelector('#status-link');
  const token = location.hash.slice(1);
  const validToken = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);
  let pending;
  try { pending = JSON.parse(sessionStorage.getItem('anise.pendingCardOrder') || 'null'); } catch (_) {}
  const canResume = validToken && pending?.requestId === token && pending.data &&
    typeof pending.data === 'object' && !Array.isArray(pending.data);
  let savedReturn;
  try { savedReturn = JSON.parse(sessionStorage.getItem('anise.cardReturnState') || 'null'); } catch (_) {}
  if (canResume && savedReturn?.requestId === token && Array.isArray(savedReturn.entries)) {
    location.replace('order?stripe_cancel=' + encodeURIComponent(token));
    return;
  }
  statusLink.hidden = !validToken;
  if (!validToken) {
    message.textContent = 'This payment link is incomplete. Return to the original checkout tab or call us before placing another order.';
    return;
  }
  statusLink.href = 'order-status#' + encodeURIComponent(token);

  async function post(path, data) {
    return fetch(api + path, {
      method: 'POST', credentials: 'omit', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(data), signal: AbortSignal.timeout(20000)
    });
  }

  async function checkStatus() {
    const response = await post('orders/status', {requestId: token});
    if (response.status === 200) {
      const order = await response.json();
      if (!Number.isInteger(order.orderNumber) || order.orderNumber <= 0) throw new Error();
      button.hidden = true;
      document.querySelector('h1').textContent = 'Order recorded';
      document.querySelector('#payment-explanation').hidden = true;
      message.textContent = 'Your order has already been recorded. Use the tracking link to check its status; you do not need to pay again.';
      statusLink.textContent = 'View order #' + order.orderNumber;
      return 'recorded';
    }
    if (response.status === 202) return 'pending';
    if (response.status === 404) return 'unknown';
    throw new Error();
  }

  async function inspect() {
    button.hidden = true;
    message.textContent = 'Checking your payment…';
    try {
      if (await checkStatus() === 'recorded') return;
      button.hidden = !canResume;
      message.textContent = canResume
        ? 'You can return to the same secure checkout. Your order will reach the restaurant once payment is confirmed.'
        : 'To resume payment, use the original checkout tab. If it is no longer available, call us before placing another order.';
    } catch (_) {
      button.hidden = !canResume;
      message.textContent = 'We could not check your payment. Check your order status or retry here using the same checkout; please do not place another order.';
    }
  }

  button.onclick = async () => {
    if (!canResume || button.disabled) return;
    button.disabled = true;
    message.textContent = 'Checking your payment before reopening checkout…';
    try {
      if (await checkStatus() === 'recorded') return;
      // Keep the original reference even if stored order data contains a requestId.
      const response = await post('stripe-checkout', {...pending.data, requestId: token});
      if (!response.ok) {
        message.textContent = response.status === 503
          ? 'Card checkout is temporarily unavailable. Your saved checkout has been kept. Check your order status or try again later.'
          : 'Could not reopen checkout. Your saved checkout has been kept. Check your order status or call us before trying again.';
        return;
      }
      const result = await response.json();
      const url = new URL(result.url);
      if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' || url.port || url.username || url.password) throw new Error();
      location.assign(url.href);
    } catch (_) {
      message.textContent = 'Could not safely reopen checkout. Check your order status or retry here; please do not place another order.';
    } finally { button.disabled = false; }
  };
  inspect();
})();
