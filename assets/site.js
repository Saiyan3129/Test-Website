/* Tester.io — shared site behaviour
 * Owns: header/footer rendering, theme toggle, currency, cart (localStorage),
 * search overlay, quick-look modal, cookie banner, newsletter + contact forms,
 * product card hooks (swatch image swap, add-to-cart, quick look).
 *
 * Pages either provide their own <header>/<footer> markup or use placeholders
 * <div data-site-header></div> and <div data-site-footer></div> which this
 * module fills. Either way, behaviour is wired the same.
 */
(function () {
  'use strict';

  // ------------------------------------------------------------ Currency
  // PHP is the source of truth — every price on every page is written in pesos.
  // Conversion rates are static (good enough for a marketing site).
  var CURRENCIES = {
    PHP: { symbol: '₱', label: 'Philippines (PHP ₱)', rate: 1, decimals: 0 },
    GBP: { symbol: '£', label: 'United Kingdom (GBP £)', rate: 0.0140, decimals: 0 },
    USD: { symbol: '$',    label: 'United States (USD $)',     rate: 0.0177, decimals: 0 },
  };
  function getCurrency() {
    try { return localStorage.getItem('currency') || 'PHP'; } catch (_) { return 'PHP'; }
  }
  function setCurrency(code) {
    if (!CURRENCIES[code]) return;
    try { localStorage.setItem('currency', code); } catch (_) {}
    applyCurrency();
  }
  function formatPrice(php, code) {
    var c = CURRENCIES[code] || CURRENCIES.PHP;
    var amount = php * c.rate;
    var rounded = c.decimals === 0 ? Math.round(amount) : amount.toFixed(c.decimals);
    var num = Number(rounded).toLocaleString('en-US', {
      minimumFractionDigits: c.decimals, maximumFractionDigits: c.decimals,
    });
    return c.symbol + num;
  }
  function applyCurrency() {
    var code = getCurrency();
    document.querySelectorAll('[data-price-php]').forEach(function (el) {
      var php = Number(el.getAttribute('data-price-php'));
      if (!Number.isFinite(php)) return;
      el.textContent = formatPrice(php, code);
    });
    document.querySelectorAll('[data-currency-symbol]').forEach(function (el) {
      el.textContent = (CURRENCIES[code] || CURRENCIES.PHP).symbol;
    });
    document.querySelectorAll('[data-currency-select]').forEach(function (sel) {
      sel.value = code;
    });
    document.dispatchEvent(new CustomEvent('site:currencychange', { detail: { code: code } }));
  }

  // ------------------------------------------------------------ Cart (localStorage)
  function readCart() {
    try {
      var raw = localStorage.getItem('cart');
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }
  function writeCart(items) {
    try { localStorage.setItem('cart', JSON.stringify(items)); } catch (_) {}
    updateCartCounts();
    document.dispatchEvent(new CustomEvent('site:cartchange', { detail: { items: items } }));
  }
  function cartCount() {
    return readCart().reduce(function (n, item) { return n + (Number(item.qty) || 0); }, 0);
  }
  function cartTotalPHP() {
    return readCart().reduce(function (n, item) {
      return n + (Number(item.price) || 0) * (Number(item.qty) || 0);
    }, 0);
  }
  function addToCart(item) {
    if (!item || !item.id) return;
    var qty = Number(item.qty) || 1;
    var items = readCart();
    var hit = items.find(function (it) { return it.id === item.id && it.size === item.size && it.color === item.color; });
    if (hit) hit.qty = (Number(hit.qty) || 1) + qty;
    else items.push({
      id: String(item.id),
      name: String(item.name || 'Untitled'),
      price: Number(item.price) || 0,
      image: String(item.image || ''),
      color: item.color || null,
      size: item.size || null,
      qty: qty,
    });
    writeCart(items);
  }
  function removeFromCart(id, size, color) {
    var items = readCart().filter(function (it) {
      return !(it.id === id && (it.size || null) === (size || null) && (it.color || null) === (color || null));
    });
    writeCart(items);
  }
  function updateCartItem(id, size, color, patch) {
    var items = readCart().map(function (it) {
      if (it.id === id && (it.size || null) === (size || null) && (it.color || null) === (color || null)) {
        return Object.assign({}, it, patch);
      }
      return it;
    }).filter(function (it) { return Number(it.qty) > 0; });
    writeCart(items);
  }
  function clearCart() { writeCart([]); }
  function updateCartCounts() {
    var n = cartCount();
    document.querySelectorAll('[data-cart-count]').forEach(function (el) {
      el.textContent = String(n);
    });
    document.querySelectorAll('[data-cart-label]').forEach(function (el) {
      el.textContent = 'Cart (' + n + ')';
    });
  }

  // ------------------------------------------------------------ Theme
  function getTheme() {
    try {
      var saved = localStorage.getItem('theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (_) {}
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  function setTheme(t) {
    document.documentElement.classList.toggle('dark', t === 'dark');
    try { localStorage.setItem('theme', t); } catch (_) {}
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(t === 'dark'));
    });
  }
  function toggleTheme() {
    setTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark');
  }

  // ------------------------------------------------------------ Toast
  function ensureToastHost() {
    var host = document.getElementById('site-toast-host');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'site-toast-host';
    host.className = 'site-toast-host';
    document.body.appendChild(host);
    return host;
  }
  function toast(message, opts) {
    var host = ensureToastHost();
    var el = document.createElement('div');
    el.className = 'site-toast' + (opts && opts.kind === 'error' ? ' site-toast--error' : '');
    el.textContent = message;
    host.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('in'); });
    setTimeout(function () {
      el.classList.remove('in');
      setTimeout(function () { el.remove(); }, 320);
    }, (opts && opts.duration) || 2400);
  }

  // ------------------------------------------------------------ Search overlay
  var SEARCH_INDEX = [
    { name: 'Plus Court Cream Sneaker', href: 'product.html', tag: 'Sneaker' },
    { name: 'Plus Court Black Sneaker', href: 'product.html', tag: 'Sneaker' },
    { name: 'Plus Court Vintage White', href: 'product.html', tag: 'Sneaker' },
    { name: 'Plus Court White Sneaker — Women’s', href: 'product.html', tag: 'Sneaker' },
    { name: 'Plus Court Diamond — Women’s', href: 'product.html', tag: 'Sneaker' },
    { name: 'Ezra Black Tumbled — Men’s', href: 'product.html', tag: 'Loafer' },
    { name: 'Ezra Tan Suede — Men’s', href: 'product.html', tag: 'Loafer' },
    { name: 'Ezra Brown Pebble — Men’s', href: 'product.html', tag: 'Loafer' },
    { name: 'Ezra Brown Pebble — Women’s', href: 'product.html', tag: 'Loafer' },
    { name: 'Wilde NY Penny Loafer', href: 'product.html', tag: 'Loafer' },
    { name: 'Atelier Brown Suede Loafer', href: 'product.html', tag: 'Capsule' },
    { name: 'Atelier Black Loafer — Men’s', href: 'product.html', tag: 'Capsule' },
    { name: 'Atelier Essex Jersey Tee', href: 'product.html', tag: 'Apparel' },
    { name: 'Hadley Black Box Stitch', href: 'product.html', tag: 'Bestseller' },
    { name: 'Bloomsbury Lips Embroidered', href: 'product.html', tag: 'Bestseller' },
    { name: 'Tester Smart Watch Pro', href: 'TesterTech.html', tag: 'Tech' },
    { name: 'Tester Lens', href: 'TesterTech.html', tag: 'Tech' },
    { name: 'Custom Made-to-Order', href: 'custom.html', tag: 'Service' },
    { name: 'Loyalty Programme', href: 'loyalty.html', tag: 'Programme' },
    { name: 'Northampton Showroom', href: 'showrooms.html', tag: 'Visit' },
    { name: 'Manila Showroom', href: 'showrooms.html', tag: 'Visit' },
    { name: 'Shipping & Delivery', href: 'shipping.html', tag: 'Help' },
    { name: 'Returns & Exchanges', href: 'returns.html', tag: 'Help' },
    { name: 'Frequently Asked Questions', href: 'faq.html', tag: 'Help' },
  ];
  function ensureSearchOverlay() {
    var existing = document.getElementById('site-search');
    if (existing) return existing;
    var overlay = document.createElement('div');
    overlay.id = 'site-search';
    overlay.className = 'site-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML =
      '<div class="site-overlay__scrim" data-overlay-close></div>' +
      '<div class="site-overlay__panel site-search__panel" role="dialog" aria-modal="true" aria-label="Search">' +
        '<div class="site-search__top">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
          '<input type="search" class="site-search__input" placeholder="Search the atelier — sneakers, loafers, ateliers…" aria-label="Search" autocomplete="off" />' +
          '<button type="button" class="site-search__close" data-overlay-close aria-label="Close search">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="site-search__results" role="listbox"></div>' +
        '<div class="site-search__hint">Try “losafer”, “sneaker”, “Northampton”, or “returns”.</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var input = overlay.querySelector('.site-search__input');
    var results = overlay.querySelector('.site-search__results');

    function render(query) {
      var q = (query || '').trim().toLowerCase();
      results.innerHTML = '';
      if (!q) {
        results.innerHTML = '<p class="site-search__empty">Start typing to search.</p>';
        return;
      }
      var hits = SEARCH_INDEX.filter(function (it) {
        return it.name.toLowerCase().indexOf(q) !== -1 || it.tag.toLowerCase().indexOf(q) !== -1;
      }).slice(0, 8);
      if (!hits.length) {
        results.innerHTML = '<p class="site-search__empty">No matches. Try a different word.</p>';
        return;
      }
      hits.forEach(function (it) {
        var row = document.createElement('a');
        row.className = 'site-search__row';
        row.href = it.href;
        row.innerHTML =
          '<span class="site-search__row-name">' + it.name + '</span>' +
          '<span class="site-search__row-tag">' + it.tag + '</span>';
        results.appendChild(row);
      });
    }
    input.addEventListener('input', function () { render(input.value); });
    overlay.querySelectorAll('[data-overlay-close]').forEach(function (el) {
      el.addEventListener('click', closeSearch);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('open')) closeSearch();
    });
    render('');
    return overlay;
  }
  function openSearch() {
    var overlay = ensureSearchOverlay();
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(function () {
      var input = overlay.querySelector('.site-search__input');
      if (input) input.focus();
    }, 60);
  }
  function closeSearch() {
    var overlay = document.getElementById('site-search');
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  // ------------------------------------------------------------ Quick look modal
  function ensureQuickLook() {
    var existing = document.getElementById('site-quicklook');
    if (existing) return existing;
    var overlay = document.createElement('div');
    overlay.id = 'site-quicklook';
    overlay.className = 'site-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML =
      '<div class="site-overlay__scrim" data-overlay-close></div>' +
      '<div class="site-overlay__panel site-quicklook__panel" role="dialog" aria-modal="true" aria-label="Quick look">' +
        '<button type="button" class="site-quicklook__close" data-overlay-close aria-label="Close">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg>' +
        '</button>' +
        '<div class="site-quicklook__grid">' +
          '<div class="site-quicklook__media"><img alt="" /></div>' +
          '<div class="site-quicklook__info">' +
            '<p class="site-quicklook__eyebrow"><span class="vol">Quick Look</span><span class="rule"></span><span class="site-quicklook__tag"></span></p>' +
            '<h3 class="site-quicklook__name"></h3>' +
            '<p class="site-quicklook__price" data-price-php=""></p>' +
            '<p class="site-quicklook__desc"></p>' +
            '<div class="site-quicklook__swatches" role="radiogroup" aria-label="Colour"></div>' +
            '<div class="site-quicklook__sizes" role="radiogroup" aria-label="Size"></div>' +
            '<div class="site-quicklook__actions">' +
              '<button type="button" class="btn btn-dark site-quicklook__add">Add to cart</button>' +
              '<a class="site-quicklook__more" href="product.html">View full details →</a>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-overlay-close]').forEach(function (el) {
      el.addEventListener('click', closeQuickLook);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('open')) closeQuickLook();
    });
    return overlay;
  }
  function openQuickLook(product) {
    var overlay = ensureQuickLook();
    var imgEl = overlay.querySelector('.site-quicklook__media img');
    var nameEl = overlay.querySelector('.site-quicklook__name');
    var priceEl = overlay.querySelector('.site-quicklook__price');
    var descEl = overlay.querySelector('.site-quicklook__desc');
    var tagEl = overlay.querySelector('.site-quicklook__tag');
    var swEl = overlay.querySelector('.site-quicklook__swatches');
    var szEl = overlay.querySelector('.site-quicklook__sizes');
    var addBtn = overlay.querySelector('.site-quicklook__add');

    var images = product.images || (product.image ? [product.image] : []);
    var swatches = product.swatches || [];
    var sizes = product.sizes || ['VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    var current = { color: swatches[0] && swatches[0].name, size: sizes[1] || sizes[0] };

    imgEl.src = images[0] || '';
    imgEl.alt = product.name || '';
    nameEl.textContent = product.name || '';
    priceEl.setAttribute('data-price-php', String(product.price || 0));
    priceEl.textContent = formatPrice(product.price || 0, getCurrency());
    descEl.textContent = product.desc || 'A considered piece from the Tester atelier — hand-finished in our Northampton workshop.';
    tagEl.textContent = product.tag || 'Atelier';

    swEl.innerHTML = '';
    swatches.forEach(function (sw, i) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'site-quicklook__sw';
      btn.style.background = sw.hex;
      btn.title = sw.name;
      btn.setAttribute('aria-label', sw.name);
      if (i === 0) btn.classList.add('is-active');
      btn.addEventListener('click', function () {
        swEl.querySelectorAll('.site-quicklook__sw').forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        current.color = sw.name;
        if (sw.image) imgEl.src = sw.image;
      });
      swEl.appendChild(btn);
    });

    szEl.innerHTML = '';
    sizes.forEach(function (sz) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'site-quicklook__sz';
      btn.textContent = sz;
      if (sz === current.size) btn.classList.add('is-active');
      btn.addEventListener('click', function () {
        szEl.querySelectorAll('.site-quicklook__sz').forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        current.size = sz;
      });
      szEl.appendChild(btn);
    });

    var moreLink = overlay.querySelector('.site-quicklook__more');
    if (moreLink && product.href) moreLink.href = product.href;

    addBtn.onclick = function () {
      addToCart({
        id: product.id || product.name,
        name: product.name,
        price: product.price,
        image: imgEl.src,
        color: current.color,
        size: current.size,
        qty: 1,
      });
      toast('Added to cart — ' + product.name);
      closeQuickLook();
    };

    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function closeQuickLook() {
    var overlay = document.getElementById('site-quicklook');
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  // ------------------------------------------------------------ Cookie banner
  function setCookiePref(value) {
    try { localStorage.setItem('cookiePref', value); } catch (_) {}
  }
  function getCookiePref() {
    try { return localStorage.getItem('cookiePref'); } catch (_) { return null; }
  }
  function dismissCookieBanner(banner) {
    banner.style.transition = 'opacity 320ms cubic-bezier(0.22,1,0.36,1), transform 320ms cubic-bezier(0.22,1,0.36,1)';
    banner.style.opacity = '0';
    banner.style.transform = 'translateY(20px)';
    setTimeout(function () { banner.remove(); }, 320);
  }
  function wireCookieBanner() {
    var banner = document.querySelector('[data-cookie-banner]');
    if (!banner) return;
    if (getCookiePref()) { banner.remove(); return; }
    banner.querySelectorAll('[data-cookie-action]').forEach(function (el) {
      el.addEventListener('click', function (ev) {
        ev.preventDefault();
        var action = el.getAttribute('data-cookie-action');
        if (action === 'accept') {
          setCookiePref('accepted');
          toast('Preferences saved — cookies accepted.');
        } else if (action === 'decline') {
          setCookiePref('declined');
          toast('Preferences saved — only essential cookies.');
        } else if (action === 'settings') {
          openCookieSettings();
          return; // settings flow handles dismissal itself
        }
        dismissCookieBanner(banner);
      });
    });
  }
  function openCookieSettings() {
    var existing = document.getElementById('site-cookie-settings');
    if (existing) { existing.classList.add('open'); return; }
    var overlay = document.createElement('div');
    overlay.id = 'site-cookie-settings';
    overlay.className = 'site-overlay';
    overlay.innerHTML =
      '<div class="site-overlay__scrim" data-overlay-close></div>' +
      '<div class="site-overlay__panel site-cookies__panel" role="dialog" aria-modal="true" aria-label="Cookie settings">' +
        '<button type="button" class="site-quicklook__close" data-overlay-close aria-label="Close">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg>' +
        '</button>' +
        '<p class="site-cookies__eyebrow"><span class="vol">N° — 04</span><span class="rule"></span><span>Preferences</span></p>' +
        '<h3 class="site-cookies__title">Cookies, on your terms.</h3>' +
        '<p class="site-cookies__body">Essential cookies are required for the site to work. The rest are optional.</p>' +
        '<label class="site-cookies__row"><span><strong>Essential</strong><br/><em>Always on — needed for cart, checkout, and login.</em></span><input type="checkbox" checked disabled/></label>' +
        '<label class="site-cookies__row"><span><strong>Analytics</strong><br/><em>Helps us understand how the site is used. Anonymous.</em></span><input type="checkbox" data-cookie-pref="analytics"/></label>' +
        '<label class="site-cookies__row"><span><strong>Marketing</strong><br/><em>Lets us tailor offers to your interests. Off by default.</em></span><input type="checkbox" data-cookie-pref="marketing"/></label>' +
        '<div class="site-cookies__actions">' +
          '<button type="button" class="btn btn-light site-cookies__decline">Reject all</button>' +
          '<button type="button" class="btn btn-dark site-cookies__save">Save preferences</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.classList.add('open');
    function close() {
      overlay.classList.remove('open');
      setTimeout(function () { overlay.remove(); }, 320);
      var banner = document.querySelector('[data-cookie-banner]');
      if (banner) dismissCookieBanner(banner);
    }
    overlay.querySelectorAll('[data-overlay-close]').forEach(function (el) { el.addEventListener('click', close); });
    overlay.querySelector('.site-cookies__decline').addEventListener('click', function () {
      setCookiePref('declined'); toast('Preferences saved — only essential cookies.'); close();
    });
    overlay.querySelector('.site-cookies__save').addEventListener('click', function () {
      var prefs = {};
      overlay.querySelectorAll('[data-cookie-pref]').forEach(function (i) { prefs[i.getAttribute('data-cookie-pref')] = i.checked; });
      try { localStorage.setItem('cookiePrefs', JSON.stringify(prefs)); } catch (_) {}
      setCookiePref('custom'); toast('Preferences saved.'); close();
    });
  }

  // ------------------------------------------------------------ Forms
  function wireNewsletterForm() {
    document.querySelectorAll('[data-newsletter-form]').forEach(function (form) {
      if (form.__wired) return;
      form.__wired = true;
      form.addEventListener('submit', async function (ev) {
        ev.preventDefault();
        var input = form.querySelector('input[type="email"]');
        var btn = form.querySelector('button[type="submit"]');
        var email = (input && input.value || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          toast('Please enter a valid email address.', { kind: 'error' });
          if (input) input.focus();
          return;
        }
        var orig = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
        try {
          var res = await fetch('/api/newsletter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email }),
          });
          var data = {};
          try { data = await res.json(); } catch (_) {}
          if (!res.ok) throw new Error(data.error || 'Could not subscribe.');
          form.reset();
          toast('Subscribed — watch your inbox for a confirmation.');
        } catch (err) {
          toast(err.message || 'Network error. Please try again.', { kind: 'error' });
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = orig; }
        }
      });
    });
  }

  // ------------------------------------------------------------ Product card hooks
  function parseProductFromCard(card) {
    var name = card.getAttribute('data-name') || '';
    var price = Number(card.getAttribute('data-price-php') || card.getAttribute('data-price') || 0);
    var images = (card.getAttribute('data-images') || '').split('|').filter(Boolean);
    var image = card.getAttribute('data-image') || images[0] || '';
    var swatchesRaw = card.getAttribute('data-swatches') || '';
    var swatches = swatchesRaw.split('|').filter(Boolean).map(function (entry) {
      var parts = entry.split(',');
      return { name: parts[0] || '', hex: parts[1] || '#888', image: parts[2] || '' };
    });
    return {
      id: card.getAttribute('data-id') || name,
      name: name,
      price: price,
      tag: card.getAttribute('data-tag') || '',
      desc: card.getAttribute('data-desc') || '',
      href: card.getAttribute('data-href') || 'product.html',
      image: image,
      images: images,
      swatches: swatches,
    };
  }
  function wireProductCards() {
    document.querySelectorAll('[data-product-card]').forEach(function (card) {
      if (card.__wired) return;
      card.__wired = true;
      // Quick look
      card.querySelectorAll('[data-quick-look]').forEach(function (trigger) {
        trigger.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          openQuickLook(parseProductFromCard(card));
        });
      });
      // Swatch hover/click swaps the main image
      var imgEl = card.querySelector('img[data-product-image]') || card.querySelector('img');
      card.querySelectorAll('[data-swatch]').forEach(function (sw) {
        sw.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var newImage = sw.getAttribute('data-swatch-image');
          if (newImage && imgEl) imgEl.src = newImage;
          card.querySelectorAll('[data-swatch]').forEach(function (s) { s.classList.remove('is-active'); });
          sw.classList.add('is-active');
        });
      });
      // Add-to-cart trigger inside cards
      card.querySelectorAll('[data-add-to-cart]').forEach(function (b) {
        b.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var p = parseProductFromCard(card);
          addToCart({ id: p.id, name: p.name, price: p.price, image: p.image, qty: 1 });
          toast('Added to cart — ' + p.name);
        });
      });
    });
  }

  // ------------------------------------------------------------ Header / Footer
  function navItems(activePage) {
    var items = [
      { href: 'new.html', label: 'New' },
      { href: 'men.html', label: 'Men' },
      { href: 'women.html', label: 'Women' },
      { href: 'custom.html', label: 'Custom' },
      { href: 'loyalty.html', label: 'Loyalty', desktopOnly: 'lg' },
    ];
    return items.map(function (it) {
      var hide = it.desktopOnly === 'lg' ? ' hidden lg:inline-block' : '';
      var aria = (activePage === it.href) ? ' aria-current="page"' : '';
      return '<li><a class="nav-link' + hide + '" href="' + it.href + '"' + aria + '>' + it.label + '</a></li>';
    }).join('');
  }
  function renderHeader(activePage) {
    return (
      '<header class="sticky top-0 z-40 site-header bg-white/95 dark:bg-[#0f0f0f]/95 backdrop-blur border-b border-border dark:border-[#252422]">' +
      '<nav class="flex md:grid md:grid-cols-3 items-center px-4 sm:px-6 lg:px-10 h-[59px] gap-3">' +
        '<button data-nav-open class="md:hidden inline-flex items-center justify-center w-10 h-10 -ml-2" aria-label="Open menu" type="button">' +
          '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>' +
        '</button>' +
        '<ul class="hidden md:flex items-center gap-5 lg:gap-7">' + navItems(activePage) + '</ul>' +
        '<a href="index.html" class="flex-1 md:flex-none md:justify-self-center flex items-center justify-center gap-2 group" aria-label="Tester.io home">' +
          '<img src="brand_assets/Tester%20Logo.png" alt="" class="h-7 sm:h-8 w-auto drop-shadow-[0_4px_10px_rgba(198,165,89,0.35)] transition-transform duration-300 ease-spring group-hover:-translate-y-0.5"/>' +
          '<span class="text-[1.05rem] sm:text-[1.15rem] font-bold tracking-tight text-gold-grad">Tester<span class="font-medium">.io</span></span>' +
        '</a>' +
        '<ul class="flex items-center gap-1 md:gap-5 lg:gap-7 md:justify-self-end">' +
          '<li class="hidden md:inline-block"><a class="nav-link" href="account.html"' + (activePage === 'account.html' ? ' aria-current="page"' : '') + '>Account</a></li>' +
          '<li class="hidden md:inline-block"><a class="nav-link" href="#" data-search-open>Search</a></li>' +
          '<li class="md:hidden"><button class="inline-flex items-center justify-center w-9 h-9" aria-label="Search" data-search-open>' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
          '</button></li>' +
          '<li>' +
            '<a class="nav-link hidden md:inline-block" href="cart.html"' + (activePage === 'cart.html' ? ' aria-current="page"' : '') + '><span data-cart-label>Cart (0)</span></a>' +
            '<a class="md:hidden inline-flex items-center justify-center w-9 h-9 relative" aria-label="Cart" href="cart.html">' +
              '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2l3 12h11l2-8H6"/><circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/></svg>' +
              '<span class="cart-pip" data-cart-count>0</span>' +
            '</a>' +
          '</li>' +
          '<li>' +
            '<button data-theme-toggle class="theme-toggle" aria-label="Toggle dark mode" type="button">' +
              '<svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                '<circle cx="12" cy="12" r="4"></circle>' +
                '<path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path>' +
              '</svg>' +
              '<svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>' +
              '</svg>' +
            '</button>' +
          '</li>' +
        '</ul>' +
      '</nav>' +
      '</header>' +
      '<div data-nav-drawer class="fixed inset-0 z-50 hidden" aria-hidden="true">' +
        '<div class="absolute inset-0 bg-black/55 backdrop-blur-sm" data-nav-close></div>' +
        '<aside class="absolute top-0 left-0 bottom-0 w-[82%] max-w-[340px] bg-white dark:bg-[#0f0f0f] border-r border-border dark:border-[#252422] shadow-elev2 flex flex-col">' +
          '<div class="flex items-center justify-between px-5 h-[59px] border-b border-border dark:border-[#252422]">' +
            '<span class="text-[1.05rem] font-bold tracking-tight text-gold-grad">Tester<span class="font-medium">.io</span></span>' +
            '<button class="inline-flex items-center justify-center w-9 h-9 -mr-1" aria-label="Close menu" data-nav-close type="button">' +
              '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg>' +
            '</button>' +
          '</div>' +
          '<nav class="flex-1 px-5 py-7 overflow-y-auto">' +
            '<ul class="space-y-5">' +
              '<li><a class="nav-link block !text-[0.84rem]" href="new.html">New</a></li>' +
              '<li><a class="nav-link block !text-[0.84rem]" href="men.html">Men</a></li>' +
              '<li><a class="nav-link block !text-[0.84rem]" href="women.html">Women</a></li>' +
              '<li><a class="nav-link block !text-[0.84rem]" href="custom.html">Custom</a></li>' +
              '<li><a class="nav-link block !text-[0.84rem]" href="loyalty.html">Loyalty</a></li>' +
            '</ul>' +
            '<div class="mt-10 pt-7 border-t border-border dark:border-[#252422]">' +
              '<ul class="space-y-4">' +
                '<li><a class="nav-link block !text-[0.74rem]" href="account.html">Account</a></li>' +
                '<li><a class="nav-link block !text-[0.74rem]" href="#" data-search-open>Search</a></li>' +
                '<li><a class="nav-link block !text-[0.74rem]" href="cart.html"><span data-cart-label>Cart (0)</span></a></li>' +
                '<li><a class="nav-link block !text-[0.74rem]" href="showrooms.html">Showrooms</a></li>' +
                '<li><a class="nav-link block !text-[0.74rem]" href="contact.html">Contact</a></li>' +
              '</ul>' +
            '</div>' +
          '</nav>' +
          '<div class="px-5 py-5 border-t border-border dark:border-[#252422] text-[0.7rem] tracking-[0.18em] uppercase text-ink/60 dark:text-[rgba(232,230,225,0.5)]">Hand-Lasted in Northampton</div>' +
        '</aside>' +
      '</div>' +
      '<div class="brand-marquee overflow-hidden py-2.5">' +
        '<div class="track marquee-thin">' +
          '<span>Hand-Lasted in Northampton</span><span class="dot"></span>' +
          '<span>Complimentary Shipping over <span data-currency-symbol>₱</span><span data-price-php="20000">20,000</span></span><span class="dot"></span>' +
          '<span>The Atelier Loyalty Programme</span><span class="dot"></span>' +
          '<span>Made-to-Order Available</span><span class="dot"></span>' +
          '<span>Established 2014</span><span class="dot"></span>' +
          '<span>Hand-Lasted in Northampton</span><span class="dot"></span>' +
          '<span>Complimentary Shipping over <span data-currency-symbol>₱</span><span data-price-php="20000">20,000</span></span><span class="dot"></span>' +
          '<span>The Atelier Loyalty Programme</span><span class="dot"></span>' +
          '<span>Made-to-Order Available</span><span class="dot"></span>' +
          '<span>Established 2014</span><span class="dot"></span>' +
        '</div>' +
      '</div>'
    );
  }
  function renderFooter() {
    return (
      '<footer class="border-t border-border dark:border-[#252422] pt-16 pb-8 px-6 lg:px-10">' +
        '<div class="pb-12 mb-12 border-b border-border dark:border-[#252422] reveal in">' +
          '<div class="grid grid-cols-1 md:grid-cols-12 gap-8 items-end">' +
            '<div class="md:col-span-7">' +
              '<p class="editorial-eyebrow mb-5"><span class="vol">House Mark</span><span class="rule"></span><span>Est. 2014 — Northampton &amp; Manila</span></p>' +
              '<h2 class="footer-mark text-ink dark:text-[#e8e6e1]">Tester<em>.io</em></h2>' +
            '</div>' +
            '<div class="md:col-span-5">' +
              '<p class="text-[0.96rem] leading-[1.85] italic text-ink/75 dark:text-[rgba(232,230,225,0.7)]" style="font-family:\'Cormorant Garamond\',Georgia,serif;font-size:1.12rem">A small workshop making considered footwear. Every pair is hand-lasted, double-stitched, and finished in the same room it was cut in.</p>' +
              '<a href="story.html" class="inline-block mt-5 text-[0.7rem] tracking-[0.28em] uppercase font-semibold text-[#9c8240] hover:text-[#C6A559] border-b border-[rgba(198,165,89,0.4)] pb-1">Read our story →</a>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="grid grid-cols-2 md:grid-cols-4 gap-10">' +
          '<div>' +
            '<h4 class="text-[0.74rem] tracking-[0.22em] uppercase font-medium mb-5">Social</h4>' +
            '<ul class="flex items-center gap-4 text-ink/80 dark:text-[rgba(232,230,225,0.78)]">' +
              '<li><a href="https://facebook.com" target="_blank" rel="noopener" aria-label="Facebook" class="hover:text-ink dark:hover:text-[#E6B979] transition-colors duration-200"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5 3.66 9.14 8.44 9.94v-7.03H7.9v-2.91h2.54V9.84c0-2.51 1.49-3.9 3.77-3.9 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.87h2.78l-.44 2.91h-2.34V22c4.78-.8 8.44-4.94 8.44-9.94z"/></svg></a></li>' +
              '<li><a href="https://instagram.com" target="_blank" rel="noopener" aria-label="Instagram" class="hover:text-ink dark:hover:text-[#E6B979] transition-colors duration-200"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16zm0 1.96c-3.14 0-3.51.01-4.75.07-1.07.05-1.65.23-2.04.38-.51.2-.88.44-1.27.83-.39.39-.63.76-.83 1.27-.15.39-.33.97-.38 2.04C2.13 9.49 2.12 9.86 2.12 13s.01 3.51.07 4.75c.05 1.07.23 1.65.38 2.04.2.51.44.88.83 1.27.39.39.76.63 1.27.83.39.15.97.33 2.04.38 1.24.06 1.61.07 4.75.07s3.51-.01 4.75-.07c1.07-.05 1.65-.23 2.04-.38.51-.2.88-.44 1.27-.83.39-.39.63-.76.83-1.27.15-.39.33-.97.38-2.04.06-1.24.07-1.61.07-4.75s-.01-3.51-.07-4.75c-.05-1.07-.23-1.65-.38-2.04a3.42 3.42 0 0 0-.83-1.27 3.42 3.42 0 0 0-1.27-.83c-.39-.15-.97-.33-2.04-.38-1.24-.06-1.61-.07-4.75-.07zm0 3.34a4.54 4.54 0 1 1 0 9.08 4.54 4.54 0 0 1 0-9.08zm0 7.5a2.96 2.96 0 1 0 0-5.92 2.96 2.96 0 0 0 0 5.92zm5.78-7.7a1.06 1.06 0 1 1-2.12 0 1.06 1.06 0 0 1 2.12 0z"/></svg></a></li>' +
              '<li><a href="https://tiktok.com" target="_blank" rel="noopener" aria-label="TikTok" class="hover:text-ink dark:hover:text-[#E6B979] transition-colors duration-200"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M16.6 5.82s.51.5 0 0A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 0 1-2.59 2.5c-1.42 0-2.59-1.16-2.59-2.59a2.59 2.59 0 0 1 3.59-2.39V9.78a6.06 6.06 0 0 0-1-.08 6 6 0 1 0 6 6V8.83a8.16 8.16 0 0 0 4.77 1.52V7.26a4.85 4.85 0 0 1-2.03-1.44z"/></svg></a></li>' +
              '<li><a href="https://youtube.com" target="_blank" rel="noopener" aria-label="YouTube" class="hover:text-ink dark:hover:text-[#E6B979] transition-colors duration-200"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.13C19.6 3.6 12 3.6 12 3.6s-7.6 0-9.4.47A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.13C4.4 20.4 12 20.4 12 20.4s7.6 0 9.4-.47a3 3 0 0 0 2.1-2.13A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.6V8.4l6.4 3.6-6.4 3.6z"/></svg></a></li>' +
            '</ul>' +
          '</div>' +
          '<div>' +
            '<h4 class="text-[0.74rem] tracking-[0.22em] uppercase font-medium mb-5">Help</h4>' +
            '<ul class="space-y-2 text-[0.85rem] text-ink/80 dark:text-[rgba(232,230,225,0.78)]">' +
              '<li><a class="hover:text-ink dark:hover:text-[#E6B979] transition-colors duration-200" href="shipping.html">Shipping</a></li>' +
              '<li><a class="hover:text-ink dark:hover:text-[#E6B979] transition-colors duration-200" href="returns.html">Returns</a></li>' +
              '<li><a class="hover:text-ink dark:hover:text-[#E6B979] transition-colors duration-200" href="faq.html">FAQs</a></li>' +
              '<li><a class="hover:text-ink dark:hover:text-[#E6B979] transition-colors duration-200" href="faq.html#sizing">Sizing Guide</a></li>' +
              '<li><a class="hover:text-ink dark:hover:text-[#E6B979] transition-colors duration-200" href="faq.html#care">Product Care</a></li>' +
              '<li><a class="hover:text-ink dark:hover:text-[#E6B979] transition-colors duration-200" href="contact.html">Contact Us</a></li>' +
            '</ul>' +
          '</div>' +
          '<div>' +
            '<h4 class="text-[0.74rem] tracking-[0.22em] uppercase font-medium mb-5">Brand</h4>' +
            '<ul class="space-y-2 text-[0.85rem] text-ink/80 dark:text-[rgba(232,230,225,0.78)]">' +
              '<li><a class="hover:text-ink dark:hover:text-[#E6B979] transition-colors duration-200" href="story.html">Our Story</a></li>' +
              '<li><a class="hover:text-ink dark:hover:text-[#E6B979] transition-colors duration-200" href="story.html#factory">The Factory</a></li>' +
              '<li><a class="hover:text-ink dark:hover:text-[#E6B979] transition-colors duration-200" href="loyalty.html">Tester World</a></li>' +
              '<li><a class="hover:text-ink dark:hover:text-[#E6B979] transition-colors duration-200" href="showrooms.html">Showrooms</a></li>' +
              '<li><a class="hover:text-ink dark:hover:text-[#E6B979] transition-colors duration-200" href="showrooms.html">Visit Our Stores</a></li>' +
              '<li><a class="hover:text-ink dark:hover:text-[#E6B979] transition-colors duration-200" href="loyalty.html#programmes">FA.Q. — Programmes</a></li>' +
            '</ul>' +
          '</div>' +
          '<div class="col-span-2 md:col-span-1">' +
            '<h4 class="text-[0.74rem] tracking-[0.22em] uppercase font-medium mb-5">Mail</h4>' +
            '<p class="text-[0.85rem] text-ink/80 dark:text-[rgba(232,230,225,0.78)] leading-relaxed mb-4">Sign up for 10% off your first order plus the latest Tester.io news, events and exclusive early access to product drops. Conditions apply.</p>' +
            '<form data-newsletter-form class="flex flex-col items-stretch border border-ink dark:border-[rgba(230,185,121,0.55)] min-w-0">' +
              '<input type="email" name="email" required placeholder="Enter Your Email Address" class="min-w-0 flex-1 px-3 py-3 text-[0.82rem] bg-transparent outline-none placeholder:text-ink/50 dark:placeholder:text-[rgba(232,230,225,0.45)] dark:text-[#e8e6e1] border-b border-ink/15 dark:border-[rgba(230,185,121,0.25)]" />' +
              '<button type="submit" class="px-5 py-3 bg-ink text-white dark:bg-[#E6B979] dark:text-[#1a1410] text-[0.72rem] tracking-[0.2em] uppercase transition-colors duration-200 hover:bg-ink/85 dark:hover:bg-[#F4DBA4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink dark:focus-visible:outline-[#E6B979]">Subscribe</button>' +
            '</form>' +
          '</div>' +
        '</div>' +
        '<div class="divider-y mt-12 pt-6 flex flex-col md:flex-row md:flex-wrap items-start md:items-center justify-between gap-4">' +
          '<p class="text-[0.78rem] text-ink/70 dark:text-[rgba(232,230,225,0.55)] order-1">© 2026 — Tester.io &nbsp;·&nbsp; Privacy &nbsp;·&nbsp; Terms &amp; Conditions</p>' +
          '<div class="flex items-center gap-3 order-3 md:order-2">' +
            '<select data-currency-select class="text-[0.78rem] bg-transparent border border-border dark:border-[#2a2a2a] dark:text-[#e8e6e1] px-3 py-2 outline-none w-full sm:w-auto" aria-label="Currency">' +
              '<option value="PHP">Philippines (PHP ₱)</option>' +
              '<option value="GBP">United Kingdom (GBP £)</option>' +
              '<option value="USD">United States (USD $)</option>' +
            '</select>' +
          '</div>' +
          '<div class="flex items-center flex-wrap gap-2 text-ink/70 dark:text-[rgba(232,230,225,0.55)] order-2 md:order-3">' +
            '<span class="px-2 py-1 border border-border dark:border-[#2a2a2a] text-[0.7rem] font-medium">PayPal</span>' +
            '<span class="px-2 py-1 border border-border dark:border-[#2a2a2a] text-[0.7rem] font-medium">MC</span>' +
            '<span class="px-2 py-1 border border-border dark:border-[#2a2a2a] text-[0.7rem] font-medium">VISA</span>' +
            '<span class="px-2 py-1 border border-border dark:border-[#2a2a2a] text-[0.7rem] font-medium">AMEX</span>' +
            '<span class="px-2 py-1 border border-border dark:border-[#2a2a2a] text-[0.7rem] font-medium">JCB</span>' +
            '<span class="px-2 py-1 border border-border dark:border-[#2a2a2a] text-[0.7rem] font-medium">DISC</span>' +
          '</div>' +
        '</div>' +
      '</footer>'
    );
  }
  function renderCookieBanner() {
    return (
      '<div class="cookie fixed bottom-4 right-4 left-4 md:left-auto md:max-w-[340px] z-40 border border-border dark:border-[#2a2a2a] shadow-elev2" data-cookie-banner>' +
        '<div class="px-4 py-3">' +
          '<p class="text-[0.74rem] leading-[1.55] text-ink/85 dark:text-[rgba(232,230,225,0.85)] mb-3">We use cookies to personalise your experience.</p>' +
          '<div class="flex items-center gap-2 flex-wrap">' +
            '<button type="button" class="btn btn-dark !py-1.5 !px-3 !text-[0.62rem]" data-cookie-action="accept">Accept</button>' +
            '<button type="button" class="btn btn-light !py-1.5 !px-3 !text-[0.62rem]" data-cookie-action="settings">Settings</button>' +
            '<button type="button" class="text-[0.62rem] tracking-[0.18em] uppercase font-medium text-ink/60 dark:text-[rgba(232,230,225,0.55)] hover:text-ink dark:hover:text-[#E6B979] transition-colors duration-200 ml-auto py-1.5 px-1" data-cookie-action="decline" aria-label="Decline">Decline</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }
  function injectFromTemplate(selector, html) {
    document.querySelectorAll(selector).forEach(function (slot) {
      var page = slot.getAttribute('data-active') || '';
      slot.outerHTML = html.replace(/__ACTIVE__/g, page);
    });
  }
  function renderInto(slot, html) {
    var temp = document.createElement('div');
    temp.innerHTML = html;
    while (temp.firstChild) slot.parentNode.insertBefore(temp.firstChild, slot);
    slot.remove();
  }

  function wireMobileNav() {
    var drawer = document.querySelector('[data-nav-drawer]');
    var openers = document.querySelectorAll('[data-nav-open]');
    if (!drawer) return;
    function open() {
      drawer.classList.remove('hidden');
      drawer.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }
    function close() {
      drawer.classList.add('hidden');
      drawer.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }
    openers.forEach(function (b) { b.addEventListener('click', open); });
    drawer.querySelectorAll('[data-nav-close]').forEach(function (el) { el.addEventListener('click', close); });
    drawer.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', close); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !drawer.classList.contains('hidden')) close();
    });
  }

  function wireSearchOpeners() {
    document.querySelectorAll('[data-search-open]').forEach(function (b) {
      if (b.__wired) return;
      b.__wired = true;
      b.addEventListener('click', function (ev) { ev.preventDefault(); openSearch(); });
    });
  }
  function wireThemeToggles() {
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
      if (b.__wired) return;
      b.__wired = true;
      b.addEventListener('click', toggleTheme);
      b.setAttribute('aria-pressed', String(document.documentElement.classList.contains('dark')));
    });
  }
  function wireCurrencySelects() {
    document.querySelectorAll('[data-currency-select]').forEach(function (sel) {
      if (sel.__wired) return;
      sel.__wired = true;
      sel.value = getCurrency();
      sel.addEventListener('change', function () { setCurrency(sel.value); });
    });
  }
  function wireRevealObserver() {
    var els = document.querySelectorAll('.reveal');
    if (!els.length) return;
    if (!('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    els.forEach(function (el) { io.observe(el); });
  }

  // ------------------------------------------------------------ Bootstrap
  function bootstrap(activePage) {
    // Header / footer / cookie injection from declared slots
    document.querySelectorAll('[data-site-header]').forEach(function (slot) {
      var page = slot.getAttribute('data-active') || activePage || '';
      renderInto(slot, renderHeader(page));
    });
    document.querySelectorAll('[data-site-footer]').forEach(function (slot) {
      renderInto(slot, renderFooter());
    });
    document.querySelectorAll('[data-site-cookie]').forEach(function (slot) {
      renderInto(slot, renderCookieBanner());
    });

    setTheme(getTheme());
    wireThemeToggles();
    wireMobileNav();
    wireSearchOpeners();
    wireCurrencySelects();
    wireNewsletterForm();
    wireProductCards();
    wireCookieBanner();
    wireRevealObserver();

    applyCurrency();
    updateCartCounts();
  }

  // Public surface
  window.Site = {
    bootstrap: bootstrap,
    cart: { read: readCart, add: addToCart, remove: removeFromCart, update: updateCartItem, clear: clearCart, count: cartCount, totalPHP: cartTotalPHP },
    currency: { get: getCurrency, set: setCurrency, format: formatPrice, codes: Object.keys(CURRENCIES) },
    theme: { get: getTheme, set: setTheme, toggle: toggleTheme },
    quickLook: openQuickLook,
    search: { open: openSearch, close: closeSearch },
    toast: toast,
    refresh: function () {
      wireProductCards();
      wireNewsletterForm();
      applyCurrency();
      updateCartCounts();
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { bootstrap(document.body.getAttribute('data-page') || ''); });
  } else {
    bootstrap(document.body.getAttribute('data-page') || '');
  }
})();