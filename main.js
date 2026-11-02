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
  const pad = (n) => String(n).padStart(2, '0');
  const STORE = 'einarkari-lang';

  const I18N = {
    is: {
      school: 'Skólaverkefni', schoolShort: 'Skóli', private: 'Eigin verkefni', privateShort: 'Eigin',
      navAi: 'Gervigreind', navAbout: 'Um mig', navAboutShort: 'Um',
      badge: 'Verkefnasafn 2026',
      hero: ['Verkefni sem ég smíða,', 'í skólanum og heima.'],
      quote: '„Hér safna ég saman verkefnum sem ég hef gert, bæði fyrir skólann og í frítíma.“',
      ctaWork: 'Skoða verkefnin', ctaAi: 'Hvernig ég nota gervigreind',
      schoolEyebrow: '01 · Í skólanum', schoolLead: 'Það sem ég geri í skólanum.',
      privateEyebrow: '02 · Í frítímanum', privateLead: 'Það sem ég smíða fyrir sjálfan mig.',
      aiEyebrow: 'Gervigreind', aiTitle: 'Hvernig ég nota gervigreind',
      aiLead: 'Ég nota gervigreind sem verkfæri þegar ég smíða. Hér sést hvaða tól ég hef notað og í hvað.',
      aiLabel: 'Gervigreind', count: (n) => `${n} verkefni`,
      aboutEyebrow: 'Um mig',
      about: ['Ég heiti Einar Kári. Hér safna ég saman því sem ég smíða, oft með Claude:',
        { chip: 'evropa' }, 'þrívíddarflug um Evrópu,',
        { chip: 'jarvis' }, 'minn eigin Jarvis,',
        { chip: 'skolabord' }, 'stundaskrá fyrir bekkinn og',
        { chip: 'idnbyltingin' }, 'teiknimynd um iðnbyltinguna.'],
      open: 'Opna verkefni', empty: 'Ekkert hér ennþá. Kemur bráðum.',
      builtWith: 'Smíðað með Claude',
      rights: '© 2026 Einar Kári Ólafsson', top: 'Aftur upp ↑',
      navLabel: 'Valmynd', home: 'Einar Kári, forsíða'
    },
    en: {
      school: 'School projects', schoolShort: 'School', private: 'Personal projects', privateShort: 'Personal',
      navAi: 'AI', navAbout: 'About', navAboutShort: 'About',
      badge: 'Portfolio 2026',
      hero: ['Things I build,', 'at school and at home.'],
      quote: '“This is where I collect the projects I’ve made, both for school and in my free time.”',
      ctaWork: 'See the projects', ctaAi: 'How I use AI',
      schoolEyebrow: '01 · At school', schoolLead: 'What I make at school.',
      privateEyebrow: '02 · In my free time', privateLead: 'Things I build for myself.',
      aiEyebrow: 'AI', aiTitle: 'How I use AI',
      aiLead: 'I use AI as a tool when I build things. Here’s which tools I’ve used, and for what.',
      aiLabel: 'AI', count: (n) => `${n} project${n === 1 ? '' : 's'}`,
      aboutEyebrow: 'About me',
      about: ['I’m Einar Kári. This is where I collect the things I build, often with Claude:',
        { chip: 'evropa' }, 'a 3D flight across Europe,',
        { chip: 'jarvis' }, 'my own Jarvis,',
        { chip: 'skolabord' }, 'a timetable for my class and',
        { chip: 'idnbyltingin' }, 'a cartoon about the Industrial Revolution.'],
      open: 'Open project', empty: 'Nothing here yet. Coming soon.',
      builtWith: 'Built with Claude',
      rights: '© 2026 Einar Kári Ólafsson', top: 'Back to top ↑',
      navLabel: 'Menu', home: 'Einar Kári, home'
    }
  };

  /* AI tools: colour and a one-line description. A tool not listed here still shows, without a description. */
  const TOOLS = {
    Claude: { color: '#d97757', desc: { is: 'Gervigreind frá Anthropic sem skrifar texta og kóða.', en: 'An AI from Anthropic that writes text and code.' } },
    ElevenLabs: { color: '#f3f3f1', ink: '#0f0f10', desc: { is: 'Gervigreind sem býr til raddir, talsetningu og raddspjall.', en: 'An AI that makes voices, voice-overs and voice conversations.' } }
  };

  const GROUPS = [
    { key: 'school', id: 'skolaverkefni', side: -1 },
    { key: 'private', id: 'eigin-verkefni', side: 1 }
  ];

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
  const inGroup = (g) => projects.filter((p) => p.group === g);
  const toolColor = (name) => (TOOLS[name] && TOOLS[name].color) || '#9a9aa2';

  let lang = 'is';
  try { const s = localStorage.getItem(STORE); if (s === 'is' || s === 'en') lang = s; } catch (e) { /* storage blocked */ }
  const t = (k) => I18N[lang][k];

  /* ---------- Rendering ---------- */
  function applyText() {
    doc.lang = lang;
    $$('[data-i18n]').forEach((el) => { const v = t(el.dataset.i18n); if (typeof v === 'string') el.textContent = v; });
    $$('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    $('#nav').setAttribute('aria-label', t('navLabel'));
    $('.brand').setAttribute('aria-label', t('home'));
    $$('[data-count]').forEach((el) => { el.textContent = '(' + pad(inGroup(el.dataset.count).length) + ')'; });
  }

  function renderHeadline() {
    let i = 0;
    $('#hero-title').innerHTML = t('hero').map((line) =>
      '<span class="line">' + line.split(' ').map((w) => `<span class="w"><span style="--i:${i++}">${esc(w)}</span></span>`).join(' ') + '</span>'
    ).join(' ');
  }

  /* Two fans: school projects on the left, personal on the right, each with a label. */
  function renderFan() {
    const G = 1.25;
    const S = 0.5;
    let html = '';
    let n = 0;
    GROUPS.forEach(({ key, id, side }) => {
      const list = inGroup(key).filter((p) => p.img).slice(0, 3);
      const m = list.length;
      list.forEach((p, i) => {
        const k = i - (m - 1) / 2;
        const inner = side < 0 ? i : m - 1 - i;
        const style = `--t:${(side * G + k * S).toFixed(3)};--ty:${(Math.abs(k) * 12).toFixed(1)}px;--r:${(k * 6 + side * 3).toFixed(2)}deg;--z:${10 + inner};--d:${280 + n++ * 90}ms`;
        html += `<a class="fcard" href="${esc(p.url)}" style="${style}"><img src="${esc(p.img)}" alt="" width="1440" height="900" decoding="async"><span class="fcard__tag">${esc(p.title)}</span></a>`;
      });
      if (inGroup(key).length) {
        html += `<a class="glabel glabel--${key}" href="#${id}" style="--t:${side * G}"><span data-i18n="${key}">${esc(t(key))}</span><sup>${pad(inGroup(key).length)}</sup></a>`;
      }
    });
    $('#fan').innerHTML = html;
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

  function aiBox(p) {
    if (!p.ai || !p.ai.length) return '';
    const rows = p.ai.map((a) => `<li style="--tool:${esc(toolColor(a.tool))}"><b>${esc(a.tool)}</b><span>${esc(pick(a.what, lang))}</span></li>`).join('');
    return `<div class="ai"><p class="ai__label">✦ ${esc(t('aiLabel'))}</p><ul>${rows}</ul></div>`;
  }

  function card(p, i) {
    const media = p.img
      ? `<img src="${esc(p.img)}" alt="" width="1440" height="900" loading="lazy" decoding="async">`
      : `<span class="pcard__ph">${esc(p.title)}</span>`;
    const course = pick(p.course, lang);
    return `<a class="pcard rv" href="${esc(p.url)}" style="--c:${esc(p.color || '#cfcfca')};--d:${(i % 2) * 90}ms">
      <div class="pcard__media">${media}</div>
      <div class="pcard__body">
        <div class="pcard__top"><span class="tag">${esc(t(p.group === 'school' ? 'school' : 'private'))}</span><span>${esc(pick(p.date, lang))}</span></div>
        <h3 class="pcard__title">${esc(p.title)}</h3>
        ${course ? `<p class="pcard__course">${esc(course)}</p>` : ''}
        <p class="pcard__text">${esc(pick(p.text, lang))}</p>
        ${aiBox(p)}
        <span class="pcard__go">${esc(t('open'))} ${ARROW}</span>
      </div>
    </a>`;
  }

  function renderGroups() {
    $$('[data-grid]').forEach((grid) => {
      const list = inGroup(grid.dataset.grid);
      grid.innerHTML = list.length ? list.map(card).join('') : `<p class="empty">${esc(t('empty'))}</p>`;
      observe($$('.rv', grid));
    });
  }

  function renderTools() {
    const uses = new Map();
    projects.forEach((p) => (p.ai || []).forEach((a) => {
      if (!uses.has(a.tool)) uses.set(a.tool, []);
      uses.get(a.tool).push({ p, what: a.what });
    }));
    const tools = Array.from(uses.entries()).sort((a, b) => b[1].length - a[1].length);
    $('#tools').innerHTML = tools.map(([name, list], i) => {
      const meta = TOOLS[name] || {};
      const items = list.map(({ p, what }) => `<li><a href="${esc(p.url)}">${p.img ? `<img src="${esc(p.img)}" alt="" width="1440" height="900" loading="lazy">` : '<span></span>'}<div><b>${esc(p.title)}</b><span>${esc(pick(what, lang))}</span></div></a></li>`).join('');
      return `<article class="tool rv" style="--tool:${esc(meta.color || '#9a9aa2')};--tool-ink:${esc(meta.ink || '#fff')};--d:${(i % 2) * 90}ms">
        <div class="tool__head"><span class="tool__mark" aria-hidden="true">${esc(name.charAt(0))}</span><h3>${esc(name)}</h3><span class="tool__count">${esc(t('count')(list.length))}</span></div>
        ${meta.desc ? `<p class="tool__desc">${esc(pick(meta.desc, lang))}</p>` : ''}
        <ul class="tool__uses">${items}</ul>
      </article>`;
    }).join('');
    observe($$('.rv', $('#tools')));
  }

  function renderAll() {
    applyText();
    renderHeadline();
    renderAbout();
    renderMarquee();
    renderGroups();
    renderTools();
    update(true);
  }

  /* ---------- Nav chip ---------- */
  function placeChip(target) {
    const chip = $('#nav .pill__chip');
    if (!target) { chip.classList.remove('is-on'); return; }
    chip.style.width = target.offsetWidth + 'px';
    chip.style.transform = `translateX(${target.offsetLeft}px)`;
    chip.classList.add('is-on');
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
  let activeSec;
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

    let current = null;
    sections.forEach((s) => { if (s.el && s.el.getBoundingClientRect().top <= vh * 0.45) current = s; });
    if (current !== activeSec || force) {
      activeSec = current;
      sections.forEach((s) => s.a.setAttribute('aria-current', String(s === current)));
      placeChip(current && current.a);
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

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => update(true));

  /* ---------- Start ---------- */
  renderFan();
  renderAll();
  const start = () => {
    $('#hero-title').classList.add('is-in');
    fan.classList.add('is-in');
    setTimeout(() => fan.classList.add('is-settled'), reduce ? 0 : 1500);
  };
  requestAnimationFrame(() => requestAnimationFrame(start));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => update(true));
})();
