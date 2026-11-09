'use strict';
const statusText = document.querySelector('#status');
const orderHeading = document.querySelector('#order-heading');
const refreshButton = document.querySelector('#refresh');
const animationFigure = document.querySelector('#status-animation');
const animationVideos = [...document.querySelectorAll('.status-animation video')];
let animationVideo = animationVideos[0];
const motionButton = document.querySelector('#motion-toggle');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const fadeDuration = 450;
let animationKey = '';
let animationClips = [];
let animationIndex = 0;
let motionPaused = reducedMotion.matches;
let transitionPending = false;
let transitionVersion = 0;
let fadeTimer;
function updateMotionButton() {
  const label = motionPaused ? 'Play animation' : 'Pause animation';
  motionButton.setAttribute('aria-label', label);
  motionButton.title = label;
  motionButton.dataset.paused = String(motionPaused);
}
function loadClip(video, clip) {
  if (video.dataset.clip === clip) return;
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.dataset.clip = clip;
  video.poster = `public/videos/order-status/${clip}.jpg`;
  video.src = `public/videos/order-status/${clip}.mp4`;
  video.load();
}
function prepareNextClip() {
  if (motionPaused || animationClips.length < 2) return;
  const next = animationVideos.find(video => video !== animationVideo);
  loadClip(next, animationClips[(animationIndex + 1) % animationClips.length]);
  next.currentTime = 0;
}
function stopTransition() {
  transitionVersion++;
  clearTimeout(fadeTimer);
  transitionPending = false;
  animationVideos.forEach(video => {
    video.pause();
    video.loop = false;
    video.classList.toggle('is-active', video === animationVideo);
  });
}
async function playAnimationClip(index = animationIndex) {
  const clip = animationClips[index];
  if (!clip || transitionPending) return;
  if (motionPaused) {
    animationVideo.poster = `public/videos/order-status/${clip}.jpg`;
    animationVideo.removeAttribute('src');
    delete animationVideo.dataset.clip;
    animationVideo.load();
    updateMotionButton();
    return;
  }
  transitionPending = true;
  const version = ++transitionVersion;
  const outgoing = animationVideo;
  // A repeated clip stays in one player, avoiding alternating rendering layers.
  const incoming = outgoing.dataset.clip === clip
    ? outgoing : animationVideos.find(video => video !== outgoing);
  loadClip(incoming, clip);
  incoming.loop = animationClips.length === 1;
  if (incoming !== outgoing) incoming.currentTime = 0;
  try {
    // Keep the outgoing frame visible until the next video can play.
    await incoming.play();
    if (version !== transitionVersion) return;
    animationIndex = index;
    animationVideo = incoming;
    incoming.classList.add('is-active');
    if (incoming === outgoing) {
      transitionPending = false;
      prepareNextClip();
      updateMotionButton();
      return;
    }
    outgoing.classList.remove('is-active');
    fadeTimer = setTimeout(() => {
      outgoing.pause();
      transitionPending = false;
      prepareNextClip();
    }, fadeDuration);
  } catch (_) {
    if (version !== transitionVersion) return;
    transitionPending = false;
    motionPaused = true;
    outgoing.poster = `public/videos/order-status/${clip}.jpg`;
    animationVideos.forEach(video => video.pause());
    updateMotionButton();
  }
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
  stopTransition();
  animationKey = key;
  animationClips = clips;
  animationIndex = 0;
  animationFigure.hidden = !clips.length;
  if (clips.length) playAnimationClip();
  else animationVideos.forEach(video => { video.removeAttribute('src'); delete video.dataset.clip; video.load(); });
}
animationVideos.forEach(video => {
  const advance = () => {
    if (video !== animationVideo || motionPaused || transitionPending || animationClips.length < 2) return;
    playAnimationClip((animationIndex + 1) % animationClips.length);
  };
  video.addEventListener('timeupdate', () => {
    if (video.duration - video.currentTime <= fadeDuration / 1000) advance();
  });
  video.addEventListener('ended', advance);
});
motionButton.addEventListener('click', () => {
  stopTransition();
  motionPaused = !motionPaused;
  if (!motionPaused) playAnimationClip();
  updateMotionButton();
});
reducedMotion.addEventListener('change', event => {
  stopTransition();
  motionPaused = event.matches;
  if (!motionPaused) playAnimationClip();
  updateMotionButton();
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
