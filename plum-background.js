(() => {
  const main = document.querySelector('main');
  if (!main) return;
  const start = main.querySelector('[data-plum-start]');
  const stop = main.querySelector('[data-plum-stop]');
  if (!start || !stop) return;
  const dishList = main.querySelector('#dish-list');
  let startCenter = 0;
  let stopCenter = 0;
  function update() {
    const center = window.scrollY + window.innerHeight / 2;
    main.classList.toggle('plum-fixed', center >= startCenter && center < stopCenter);
    main.classList.toggle('plum-stopped', center >= stopCenter);
  }
  function measure() {
    const mainTop = main.getBoundingClientRect().top + window.scrollY;
    const first = start.getBoundingClientRect();
    const last = stop.getBoundingClientRect();
    startCenter = first.top + window.scrollY + first.height / 2;
    stopCenter = last.top + window.scrollY + last.height / 2;
    main.style.setProperty('--plum-start', `${startCenter - mainTop}px`);
    main.style.setProperty('--plum-stop', `${stopCenter - mainTop}px`);
    if (dishList && dishList.childElementCount) main.classList.add('order-plum-ready');
    update();
  }
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', measure);
  window.addEventListener('load', measure);
  // Recalculate when images, menu data, or promotions change section sizes.
  const observer = new ResizeObserver(measure);
  observer.observe(main);
  observer.observe(start);
  observer.observe(stop);
  measure();
})();
