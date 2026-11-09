/* Load the current POS menu when the service is available. */
(async () => {
  const list = document.querySelector('.menu-list');
  const links = document.querySelector('.menu-categories');
  const status = document.createElement('p');
  status.className = 'menu-live-status';
  status.setAttribute('role', 'status');
  document.querySelector('.menu-layout').before(status);
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const chineseNames = {
    'Anise Creations': '創意之作', 'Starters': '頭盤', 'Soup': '湯類',
    'Chicken': '雞肉', 'Beef': '牛肉', 'Lamb': '羊肉', 'Seafood': '海鮮',
    'Vegetables': '蔬菜', 'Rice': '飯類', 'Noodles': '麵類', 'Other': '其他',
    'Mains': '主菜', 'Sides': '配菜',
    'Vegan': '素食', 'Vegan starters': '素食頭盤', 'Vegan Starters': '素食頭盤',
    'Vegan soups': '素食湯類', 'Vegan Soups': '素食湯類',
    'Vegan mains': '素食主菜', 'Vegan Mains': '素食主菜',
    'Vegan sides': '素食配菜', 'Vegan Sides': '素食配菜'
  };
  function section(title, products, id) {
    const group = element('section', null, 'menu-group'); group.id = id;
    const heading = element('div', null, 'menu-group-heading');
    const label = element('h2');
    label.append(element('span', title, 'menu-heading-english'));
    const veganNames = { 'vegan starter': '素食頭盤', 'vegan starters': '素食頭盤', 'vegan soup': '素食湯類', 'vegan soups': '素食湯類', 'vegan main': '素食主菜', 'vegan mains': '素食主菜', 'vegan side': '素食配菜', 'vegan sides': '素食配菜' };
    const chineseName = chineseNames[title] || veganNames[title.trim().toLowerCase()];
    if (chineseName) {
      const chinese = element('span', chineseName, 'menu-heading-chinese');
      chinese.lang = 'zh-Hant';
      label.append(chinese);
    }
    heading.append(label);
    const items = element('ul', null, 'menu-items');
    products.forEach(product => {
      const item = element('li');
      if (product.chineseName && product.chineseName.trim()) {
        const chinese = element('span', product.chineseName, 'menu-item-chinese');
        chinese.lang = 'zh-Hant';
        item.append(chinese);
      }
      item.append(element('span', product.name, 'menu-item-english'));
      if (product.description) item.append(element('small', product.description, 'menu-description'));
      items.append(item);
    });
    group.append(heading, items); return group;
  }
  try {
    const response = await fetch(window.AnisePos.api + '/api/menu', {cache:'no-store', credentials:'omit', signal:AbortSignal.timeout(12000)});
    if (!response.ok) throw new Error('Menu unavailable');
    const categories = await response.json();
    if (!Array.isArray(categories) || !categories.every(c => Array.isArray(c.products) && c.products.every(p => Array.isArray(p.variants)))) throw new Error('Menu format unavailable');
    const groups = categories.filter(c => c.products.length);
    if (!groups.length) throw new Error("Menu is empty");
    const content = document.createDocumentFragment(), navigation = document.createDocumentFragment();
    const regularGroups = groups.filter(c => c.name.trim().toLowerCase() !== 'drinks');
    const displayGroups = [
      {name: 'Anise Creations', categories: ['anise creations']},
      {name: 'Starters', categories: ['starters', 'starter', 'soup', 'soups']},
      {name: 'Mains', categories: ['chicken', 'beef', 'lamb', 'seafood', 'vegetables']},
      {name: 'Sides', categories: ['rice', 'noodles']}
    ];
    const mapped = new Set(displayGroups.flatMap(g => g.categories));
    const sections = displayGroups.map(g => ({name: g.name, products: g.categories.flatMap(name => regularGroups.filter(c => c.name.trim().toLowerCase() === name).flatMap(c => c.products))}));
    sections.push(...regularGroups.filter(c => !mapped.has(c.name.trim().toLowerCase())));
    const veganCategories = sections.filter(c => c.products.length && c.name.trim().toLowerCase().includes('vegan'));
    sections.filter(c => c.products.length && !c.name.trim().toLowerCase().includes('vegan')).forEach((c, index) => {
      const id = `menu-category-${index}`;
      content.append(section(c.name, c.products, id));
      const link = element('a', c.name); link.href = `#${id}`; navigation.append(link);
    });
    if (veganCategories.length) {
      const veganSection = element('section', null, 'vegan-menu-section'); veganSection.id = 'vegan-menu';
      const intro = element('div', null, 'vegan-menu-intro');
      intro.append(element('p', 'Plant-based at Anise', 'eyebrow'), element('h2', 'Our vegan menu.'), element('p', 'Inspired by the rich tradition of Chinese vegan cooking. Please let us know you are ordering from the vegan menu.'));
      veganSection.append(intro);
      veganCategories.forEach((category, index) => {
        veganSection.append(section(category.name, category.products, index === 0 ? 'vegan-starters' : `vegan-category-${index}`));
      });
      content.append(veganSection);
      const link = element('a', 'Vegan menu'); link.href = '#vegan-menu'; navigation.append(link);
    }
    list.replaceChildren(content); links.replaceChildren(navigation); status.textContent = '';
    const target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target && list.contains(target)) target.scrollIntoView();
  } catch (_) {
    status.textContent = 'Live menu unavailable. The dishes below may be out of date; please call us to confirm availability and vegan options.';
  }
})();
