(() => {
  'use strict';
  const api = window.AnisePos.api;
  const isOrder = /^\/order(?:\.html)?\/?$/i.test(location.pathname);
  const anchor = document.querySelector(isOrder ? '.order-intro' : '.hero');
  if (!anchor || location.protocol !== 'https:') return;
  const section = document.createElement('section'); section.className = 'promotion-display'; section.setAttribute('aria-labelledby','promotion-display-title');
  const heading = document.createElement('div'); heading.className = 'promotion-display-heading';
  const title = document.createElement('h2'); title.id = 'promotion-display-title'; title.textContent = 'A little something from Anise';
  const note = document.createElement('p'); note.textContent = 'Discover offers for your next order.'; heading.append(title,note);
  const offers = document.createElement('div'); offers.className = 'promotion-display-list';
  section.hidden = true;
  section.append(heading,offers); anchor.after(section);
  async function refresh() {
    try {
      const response = await fetch(api+'/api/website/promotions',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',body:JSON.stringify({isReturningCustomer:window.AnisePromotionCookie.isReturning()}),signal:AbortSignal.timeout(12000)});
      if (!response.ok) { const error=await response.json().catch(()=>({})); throw Error(error.message||'Offers are temporarily unavailable.'); }
      const data=await response.json(); offers.replaceChildren();
      for(const offer of data.offers.filter(x=>isOrder?x.showOnOrder:x.showOnHome)) {
        const article=document.createElement('article');article.className='promotion-display-item';
        if(offer.imageUrl){const image=document.createElement('img');image.src=api+offer.imageUrl;image.alt='';image.loading='lazy';article.append(image)}
        const copy=document.createElement('div');const name=document.createElement('h3');name.textContent=offer.name;copy.append(name);
        if(offer.description){const text=document.createElement('p');text.textContent=offer.description;copy.append(text)}
        if(offer.details){const details=document.createElement('p');details.textContent=offer.details;copy.append(details)}
        const type=document.createElement('small');type.textContent=offer.fulfilment===1||offer.fulfilment==='Collection'?'Collection only':offer.fulfilment===2||offer.fulfilment==='Delivery'?'Delivery only':'Collection and delivery';copy.append(type);
        const link=document.createElement('a');link.href=isOrder?'#dish-list':'order';link.textContent='Explore the menu →';copy.append(link);article.append(copy);offers.append(article);
      }
      section.hidden = !offers.childElementCount;
    } catch (_) { section.hidden=true; }
  }
  refresh();
})();
