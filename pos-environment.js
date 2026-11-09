/* Select the POS from the website hostname. Unknown hosts fail closed. */
(function (global) {
  const origins = {
    'www.loveanise.co.uk': 'https://pos.loveanise.co.uk',
    'loveanise.co.uk': 'https://pos.loveanise.co.uk',
    'www.staging.loveanise.co.uk': 'https://pos-staging.loveanise.co.uk',
    'staging.loveanise.co.uk': 'https://pos-staging.loveanise.co.uk'
  };
  const origin = origins[global.location.hostname.toLowerCase()];
  if (!origin) throw new Error('Unsupported Anise website host; POS API disabled');
  global.AnisePos = Object.freeze({api: origin});
})(window);
