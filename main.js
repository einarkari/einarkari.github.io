/* einarkari.com — rendering, language switch and scroll motion. No libraries. */
(() => {
  'use strict';

  const doc = document.documentElement;
  doc.classList.add('js');
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STORE = 'einarkari-lang';

  const I18N = {
    is: {
      navHome: 'Forsíða', navAbout: 'Um mig', navWork: 'Verkefni',
      badge: 'Verkefnasafn 2026',
      hero: ['Verkefni sem ég smíða,', 'í skólanum og heima.'],
      quote: '„Hér safna ég saman verkefnum sem ég hef gert, bæði fyrir skólann og í frítíma.“',
      ctaWork: 'Skoða verkefnin', ctaAbout: 'Um mig',
      aboutEyebrow: 'Um mig',
      about: ['Ég heiti Einar Kári. Hér safna ég saman því sem ég smíða, oft með Claude:',
        { chip: 'evropa' }, 'þrívíddarflug um Evrópu,',
        { chip: 'jarvis' }, 'minn eigin Jarvis,',
        { chip: 'skolabord' }, 'stundaskrá fyrir bekkinn og',
        { chip: 'idnbyltingin' }, 'teiknimynd um iðnbyltinguna.'],
      workEyebrow: 'Verkefnasafn', workTitle: 'Verkefni', workLead: 'Allt sem ég hef smíðað, nýjast fyrst.',
      tabAll: 'Allt', school: 'Skólaverkefni', private: 'Eigin verkefni',
      open: 'Opna verkefni', empty: 'Ekkert hér ennþá. Kemur bráðum.',
      builtWith: 'Smíðað með Claude',
      rights: '© 2026 Einar Kári Ólafsson', top: 'Aftur upp ↑',
      navLabel: 'Valmynd', tabsLabel: 'Sía verkefni', home: 'Einar Kári, forsíða'
    },
    en: {
      navHome: 'Home', navAbout: 'About', navWork: 'Projects',
      badge: 'Portfolio 2026',
      hero: ['Things I build,', 'at school and at home.'],
      quote: '“This is where I collect the projects I’ve made, both for school and in my free time.”',
      ctaWork: 'See the projects', ctaAbout: 'About me',
      aboutEyebrow: 'About me',
      about: ['I’m Einar Kári. This is where I collect the things I build, often with Claude:',
        { chip: 'evropa' }, 'a 3D flight across Europe,',
        { chip: 'jarvis' }, 'my own Jarvis,',
        { chip: 'skolabord' }, 'a timetable for my class and',
        { chip: 'idnbyltingin' }, 'a cartoon about the Industrial Revolution.'],
      workEyebrow: 'Portfolio', workTitle: 'Projects', workLead: 'Everything I’ve built, newest first.',
      tabAll: 'All', school: 'School projects', private: 'Personal projects',
      open: 'Open project', empty: 'Nothing here yet. Coming soon.',
      builtWith: 'Built with Claude',
      rights: '© 2026 Einar Kári Ólafsson', top: 'Back to top ↑',
      navLabel: 'Menu', tabsLabel: 'Filter projects', home: 'Einar Kári, home'
    }
  };

  /* ---------- Projects ---------- */
  const MONTHS = ['janúar', 'febrúar', 'mars', 'apríl', 'maí', 'júní', 'júlí', 'ágúst', 'september', 'október', 'nóvember', 'desember'];
  const MONTHS_EN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const pick = (v, l) => (v == null ? '' : typeof v === 'string' ? v : (v[l] || v.is || v.en || ''));
  const dateKey = (d) => {
    const s = (pick(d, 'is') + ' ' + pick(d, 'en')).toLowerCase();
    const y = (s.match(/\d{4}/) || [0])[0];
    let m = 0;
    MONTHS.forEach((n, i) => { if (s.includes(n)) m = i + 1; });
    if (!m) MONTHS_EN.forEach((n, i) => { if (s.includes(n)) m = i + 1; });
    return Number(y) * 100 + m;
  };
  const projects = (window.PROJECTS || [])
    .map((p, i) => ({ ...p, _i: i, id: String(p.url || '').replace(/\/+$/, '').split('/').pop() }))
    .sort((a, b) => dateKey(b.date) - dateKey(a.date) || a._i - b._i);
  const byId = Object.fromEntries(projects.map((p) => [p.id, p]));

  let lang = 'is';
  try { const s = localStorage.getItem(STORE); if (s === 'is' || s === 'en') lang = s; } catch (e) { /* storage blocked */ }
  let filter = 'all';
  const t = (k) => I18N[lang][k];

  /* ---------- Rendering ---------- */
  function applyText() {
    doc.lang = lang;
    $$('[data-i18n]').forEach((el) => { const v = t(el.dataset.i18n); if (typeof v === 'string') el.textContent = v; });
    $$('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    $('#nav').setAttribute('aria-label', t('navLabel'));
    $('#tabs').setAttribute('aria-label', t('tabsLabel'));
    $('.brand').setAttribute('aria-label', t('home'));
  }

  function renderHeadline() {
    let i = 0;
    $('#hero-title').innerHTML = t('hero').map((line) =>
      '<span class="line">' + line.split(' ').map((w) => `<span class="w"><span style="--i:${i++}">${esc(w)}</span></span>`).join(' ') + '</span>'
    ).join(' ');
  }

  function renderFan() {
    const list = projects.filter((p) => p.img).slice(0, 5);
    const n = list.length;
    $('#fan').innerHTML = list.map((p, i) => {
      const k = i - (n - 1) / 2;
      const style = `--t:${k};--ty:${(Math.pow(Math.abs(k), 1.6) * 16).toFixed(1)}px;--r:${(k * 7).toFixed(2)}deg;--z:${10 - Math.round(Math.abs(k) * 2)};--d:${280 + i * 90}ms`;
      return `<a class="fcard" href="${esc(p.url)}" style="${style}"><img src="${esc(p.img)}" alt="" width="1440" height="900" decoding="async"><span class="fcard__tag">${esc(p.title)}</span></a>`;
    }).join('');
  }

  let revealItems = [];
  let revealLit = -1;
  function renderAbout() {
    let ci = 0;
    $('#about-text').innerHTML = t('about').map((seg) => {
      if (typeof seg === 'string') return seg.split(' ').map((w) => `<span class="rw">${esc(w)}</span>`).join(' ');
      const p = byId[seg.chip];
      if (!p || !p.img) return '';
      const r = [-6, 5, -4, 6][ci++ % 4];
      return `<span class="chip" style="--cr:${r}deg"><img src="${esc(p.img)}" alt="" width="1440" height="900" loading="lazy"></span>`;
    }).join(' ');
    revealItems = $$('#about-text .rw, #about-text .chip');
    revealLit = -1;
  }

  function renderMarquee() {
    const items = projects.map((p) =>
      `<span>${esc(p.title)}</span>${p.img ? `<img src="${esc(p.img)}" alt="" loading="lazy">` : ''}<span class="marquee__star">✦</span>`
    ).join('') + `<span>${esc(t('builtWith'))}</span><span class="marquee__star">✦</span>`;
    $('#marquee').innerHTML = `<div class="marquee__group">${items}</div><div class="marquee__group">${items}</div>`;
  }

  const ARROW = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 10.5l7-7M5 3.5h5.5V9"/></svg>';
  function card(p, i) {
    const label = t(p.group === 'school' ? 'school' : 'private');
    const media = p.img
      ? `<img src="${esc(p.img)}" alt="" width="1440" height="900" loading="lazy" decoding="async">`
      : `<span class="pcard__ph">${esc(p.title)}</span>`;
    const course = pick(p.course, lang);
    return `<a class="pcard rv" href="${esc(p.url)}" style="--c:${esc(p.color || '#cfcfca')};--d:${(i % 2) * 90}ms">
      <div class="pcard__media">${media}</div>
      <div class="pcard__body">
        <div class="pcard__top"><span class="tag">${esc(label)}</span><span>${esc(pick(p.date, lang))}</span></div>
        <h3 class="pcard__title">${esc(p.title)}</h3>
        ${course ? `<p class="pcard__course">${esc(course)}</p>` : ''}
        <p class="pcard__text">${esc(pick(p.text, lang))}</p>
        <span class="pcard__go">${esc(t('open'))} ${ARROW}</span>
      </div>
    </a>`;
  }

  function renderGrid() {
    const list = projects.filter((p) => filter === 'all' || p.group === filter);
    const grid = $('#grid');
    grid.innerHTML = list.length ? list.map(card).join('') : `<p class="empty">${esc(t('empty'))}</p>`;
    observe($$('.rv', grid));
  }

  function renderTabs() {
    const counts = { all: projects.length, school: projects.filter((p) => p.group === 'school').length, private: projects.filter((p) => p.group === 'private').length };
    $$('#tabs button').forEach((b) => {
      $('sup', b).textContent = String(counts[b.dataset.filter]).padStart(2, '0');
      b.setAttribute('aria-selected', String(b.dataset.filter === filter));
    });
    $('#work-count').textContent = '(' + String(projects.length).padStart(2, '0') + ')';
  }

  function renderAll() {
    applyText();
    renderHeadline();
    renderAbout();
    renderMarquee();
    renderTabs();
    renderGrid();
    placeChip($('#tabs'), $('#tabs [aria-selected="true"]'));
    update(true);
  }

  /* ---------- Pill chips (nav + tabs) ---------- */
  function placeChip(pill, target) {
    const chip = $('.pill__chip', pill);
    if (!chip || !target) return;
    chip.style.width = target.offsetWidth + 'px';
    chip.style.transform = `translateX(${target.offsetLeft}px)`;
  }

  /* ---------- Reveal on scroll ---------- */
  const io = 'IntersectionObserver' in window && !reduce
    ? new IntersectionObserver((entries) => entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); }
      }), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' })
    : null;
  function observe(els) { els.forEach((el) => (io ? io.observe(el) : el.classList.add('is-visible'))); }

  /* ---------- Scroll-driven motion ---------- */
  const hero = $('#top');
  const fan = $('#fan');
  const wordmark = $('.wordmark');
  const sections = $$('#nav a').map((a) => ({ a, el: document.getElementById(a.dataset.sec) }));
  let activeSec = null;
  let ticking = false;

  function update(force) {
    ticking = false;
    const vh = window.innerHeight;

    if (!reduce) {
      const hr = hero.getBoundingClientRect();
      const sp = clamp(-hr.top / (hr.height * 0.75), 0, 1);
      fan.style.setProperty('--spread', sp.toFixed(3));
      wordmark.style.setProperty('--drift', (-sp * 70).toFixed(1) + 'px');
    }

    const para = $('#about-text');
    const pr = para.getBoundingClientRect();
    const start = vh * 0.85;
    const end = vh * 0.4;
    const prog = reduce ? 1 : clamp((start - pr.top) / (pr.height + start - end), 0, 1);
    const lit = Math.round(prog * revealItems.length);
    if (lit !== revealLit || force) {
      revealItems.forEach((el, i) => el.classList.toggle('is-lit', i < lit));
      revealLit = lit;
    }

    let current = sections[0];
    sections.forEach((s) => { if (s.el && s.el.getBoundingClientRect().top <= vh * 0.45) current = s; });
    if (current !== activeSec || force) {
      activeSec = current;
      sections.forEach((s) => s.a.setAttribute('aria-current', String(s === current)));
      placeChip($('#nav'), current.a);
    }
  }
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(() => update(false)); } };

  /* ---------- Events ---------- */
  $$('.lang button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.lang === lang) return;
    lang = b.dataset.lang;
    try { localStorage.setItem(STORE, lang); } catch (e) { /* not saved */ }
    renderAll();
    $('#hero-title').classList.add('is-in');
  }));

  $$('#tabs button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.filter === filter) return;
    filter = b.dataset.filter;
    renderTabs();
    renderGrid();
    placeChip($('#tabs'), b);
  }));

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => {
    placeChip($('#nav'), activeSec && activeSec.a);
    placeChip($('#tabs'), $('#tabs [aria-selected="true"]'));
    update(true);
  });

  /* ---------- Start ---------- */
  renderFan();
  renderAll();
  const start = () => {
    $('#hero-title').classList.add('is-in');
    fan.classList.add('is-in');
    setTimeout(() => fan.classList.add('is-settled'), reduce ? 0 : 1500);
  };
  requestAnimationFrame(() => requestAnimationFrame(start));
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      placeChip($('#nav'), activeSec && activeSec.a);
      placeChip($('#tabs'), $('#tabs [aria-selected="true"]'));
    });
  }
})();
