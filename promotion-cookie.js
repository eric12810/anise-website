(() => {
  'use strict';
  const name = 'anise_returning_customer';
  window.AnisePromotionCookie = {
    isReturning: () => document.cookie.split(';').some(part => part.trim() === name + '=1'),
    markReturning: () => { document.cookie = name + '=1; Path=/; Max-Age=31536000; SameSite=Lax; Secure'; }
  };
  try { localStorage.removeItem('anise-promotion-phone'); } catch (_) {}
})();
