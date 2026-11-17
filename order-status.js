'use strict';
const statusText = document.querySelector('#status');
const orderHeading = document.querySelector('#order-heading');
const refreshButton = document.querySelector('#refresh');
const animationFigure = document.querySelector('#status-animation');
const animationVideo = document.querySelector('#status-video');
const motionButton = document.querySelector('#motion-toggle');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let animationKey = '';
let animationClips = [];
let animationIndex = 0;
let motionPaused = reducedMotion.matches;
let clipVersion = 0;
function updateMotionButton() {
  const label = motionPaused ? 'Play animation' : 'Pause animation';
  motionButton.setAttribute('aria-label', label);
  motionButton.title = label;
  motionButton.dataset.paused = String(motionPaused);
}
function showClip(index) {
  const clip = animationClips[index];
  if (!clip) return;
  const version = ++clipVersion;
  animationIndex = index;
  animationVideo.pause();
  animationVideo.poster = `public/videos/order-status/${clip}.jpg`;
  if (motionPaused) {
    animationVideo.removeAttribute('src');
  } else {
    animationVideo.src = `public/videos/order-status/${clip}.mp4`;
  }
  animationVideo.load();
  animationVideo.loop = !motionPaused && animationClips.length === 1;
  if (!motionPaused) animationVideo.play().catch(() => {
    if (version !== clipVersion) return;
    motionPaused = true;
    animationVideo.pause();
    updateMotionButton();
  });
  updateMotionButton();
}
function showOrderAnimation(order) {
  const clips = {
    Placed: ['order-received'], Accepted: ['order-accepted'],
    Preparing: ['prep1', 'prep2'],
    Completed: ['completed'],
    Ready: order.orderType === 'Delivery'
      ? [order.deliveryStarted ? 'delivery' : 'ready'] : ['ready', 'collection']
  }[order.status] || [];
  const key = clips.join(',');
  if (key === animationKey) return;
  animationKey = key;
  animationClips = clips;
  animationFigure.hidden = !clips.length;
  if (clips.length) showClip(0);
  else {
    clipVersion++;
    animationVideo.pause();
    animationVideo.removeAttribute('src');
    animationVideo.load();
  }
}
animationVideo.addEventListener('ended', () => {
  if (!motionPaused && animationClips.length > 1) showClip((animationIndex + 1) % animationClips.length);
});
motionButton.addEventListener('click', () => {
  motionPaused = !motionPaused;
  showClip(animationIndex);
});
reducedMotion.addEventListener('change', event => {
  motionPaused = event.matches;
  showClip(animationIndex);
});
const tokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function trackingToken() {
  const fragment = location.hash.slice(1);
  if (fragment) {
    try { return decodeURIComponent(fragment); } catch (_) { return fragment; }
  }
  // The checkout keeps a reference in this tab in case the browser loses the fragment.
  try {
    for (const key of ['anise.pendingCardOrder', 'anise.currentOrderStatus']) {
      const candidate = JSON.parse(sessionStorage.getItem(key) || 'null')?.requestId;
      if (typeof candidate === 'string' && tokenPattern.test(candidate)) {
        history.replaceState(null, '', location.pathname + location.search + '#' + candidate);
        return candidate;
      }
    }
  } catch (_) { /* Storage may be unavailable in private browsing. */ }
  return '';
}
const token = trackingToken();
let loading = false;
let timer;
async function refresh() {
  if (loading) return;
  if (location.protocol !== 'https:' || !tokenPattern.test(token)) {
    statusText.textContent = 'This private order link is incomplete or invalid. Please open the complete link from your order confirmation, or call us if you need help.'; return;
  }
  loading = true; refreshButton.disabled = true;
  try {
    const response = await fetch(window.AnisePos.api + '/api/website/orders/status', {
      method:'POST', headers:{'Content-Type':'application/json'}, credentials:'omit', cache:'no-store',
      body:JSON.stringify({requestId: token}), signal:AbortSignal.timeout(12000)
    });
    if (response.status === 202) { showOrderAnimation({}); statusText.textContent = 'I\'m checking your payment. Your order will appear here once confirmed — please don\'t place it again.'; return; }
    if (response.status === 404) { showOrderAnimation({}); statusText.textContent = 'I can\'t find this order, or its private link has expired. Please give the team a call so we can help.'; clearInterval(timer); return; }
    if (!response.ok) throw new Error();
    const order = await response.json();
    showOrderAnimation(order);
    if (!['Cancelled','Refunded'].includes(order.status)) window.AnisePromotionCookie.markReturning();
    try { const pending = JSON.parse(sessionStorage.getItem('anise.pendingCardOrder') || 'null'); if (pending?.requestId === token) sessionStorage.removeItem('anise.pendingCardOrder'); } catch (_) {}
    orderHeading.textContent = order.orderNumber == null ? 'Your order' : `Your order #${order.orderNumber}`;
    const delivery = order.orderType === 'Delivery';
    const messages = {
      Placed: "I've received your order! I'm waiting for the team to accept it.",
      Accepted: "Good news! The team has accepted your order. We'll get cooking soon!",
      Preparing: "We're busy cooking your favourites! I'll keep you posted.",
      Ready: delivery
        ? (order.deliveryStarted ? "Your food is on its way! Our driver is heading over with your order." : "Your food is ready! We're getting it ready to head your way.")
        : "All ready! Your food is waiting for you to collect. See you soon!",
      Completed: "Your order is complete. Thanks for choosing Anise — enjoy your food!",
      Cancelled: "I'm sorry, your order has been declined or cancelled. Please give the team a call if you'd like help.",
      Refunded: "Your order has been refunded. Please give the team a call if you have any questions."
    };
    const estimate = order.estimatedAtUtc ? new Date(order.estimatedAtUtc) : null;
    const time = estimate && !Number.isNaN(estimate.getTime()) && ['Accepted','Preparing','Ready'].includes(order.status)
      ? (delivery ? ' Estimated delivery: ' : ' Estimated collection: ') + estimate.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) + '.' : '';
    statusText.textContent = (messages[order.status] || "I'm checking the latest on your order. Please check back in a moment.") + time;
    if (['Completed','Cancelled','Refunded'].includes(order.status)) clearInterval(timer);
  } catch (_) { showOrderAnimation({}); statusText.textContent = 'I\'m having trouble checking your order right now. Please try again in a moment, or give the team a call.'; }
  finally { loading = false; refreshButton.disabled = false; }
}
refreshButton.addEventListener('click',refresh);
timer = setInterval(refresh,15000);
refresh();
