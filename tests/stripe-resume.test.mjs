import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('../stripe-resume.js', import.meta.url), 'utf8');
const token = '10370cdd-355e-4071-9920-3eccb431c139';
async function scenario(responses, options = {}) {
  const elements = Object.fromEntries(['#resume', '#message', '#status-link', 'h1', '#payment-explanation'].map(x => [x, {hidden: x === '#resume'}]));
  const calls = [], redirects = [];
  const pending = options.missing ? null : {requestId: token, data: {name:'Test', requestId:'wrong'}};
  vm.runInNewContext(source, {
    document: {querySelector: x => elements[x]},
    location: {hash: options.invalid ? '#invalid' : '#' + token, assign: x => redirects.push(x)},
    sessionStorage: {getItem: () => {if(options.storageError) throw new Error(); return JSON.stringify(pending);}},
    URL, AbortSignal,
    fetch: async (url, init) => {
      calls.push({url, body:JSON.parse(init.body)});
      const next = responses.shift();
      if (next instanceof Error || !next) throw next || new Error('Unexpected request');
      return {status:next.status, ok:next.status>=200 && next.status<300, json:async()=>next.body};
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  return {elements,calls,redirects,click:async()=>elements['#resume'].onclick?.()};
}
const pending = {status:202}, paid = {status:200,body:{orderNumber:1075}};
let s = await scenario([paid]);
assert(s.elements['#resume'].hidden); assert.match(s.elements['#message'].textContent,/already/);
s = await scenario([pending, paid]); await s.click(); assert.equal(s.calls.length,2); assert.equal(s.redirects.length,0);
s = await scenario([pending,pending,{status:200,body:{url:'https://checkout.stripe.com/c/pay/cs_test_example'}}]);
await s.click(); assert.equal(s.redirects.length,1); assert.equal(s.calls[2].body.requestId,token);
s = await scenario([pending,new Error('offline')]); await s.click(); assert.equal(s.calls.length,2); assert.equal(s.redirects.length,0);
s = await scenario([pending,pending,{status:503}]); await s.click(); assert.match(s.elements['#message'].textContent,/temporarily unavailable/); assert.equal(s.elements['#resume'].disabled,false);
for (const url of ['https://checkout.stripe.com.evil.test/pay','javascript:alert(1)','https://user:pass@checkout.stripe.com/pay','http://checkout.stripe.com/pay']) {
 s = await scenario([pending,pending,{status:200,body:{url}}]); await s.click(); assert.equal(s.redirects.length,0);
}
for (const options of [{missing:true},{storageError:true}]) {s=await scenario([pending],options);assert(s.elements['#resume'].hidden);}
s = await scenario([],{invalid:true}); assert.equal(s.calls.length,0); assert(s.elements['#status-link'].hidden);
console.log('Passed resume checks: recorded order, payment race, same reference, network failure, disabled checkout, unsafe URLs, missing storage and invalid link.');
