/* Site shell: routing, ticker tape, backdrop, blog filter, clock, contact reveal. */
(() => {
  'use strict';
  const JW = (window.JW = window.JW || {});
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* Contact details — base64 so they are not sitting in the HTML for scrapers.
     Encode a new value in the browser console with btoa('text'). */
  const CONTACTS = [
    { k: 'Email', v: 'amFuLndlYmVyQHN0dWRlbnQua2l0LmVkdQ==', href: v => 'mailto:' + v },
    { k: 'LinkedIn', v: 'bGlua2VkaW4uY29tL2luL2phbi13ZWJlcg==', href: v => 'https://www.' + v },
    { k: 'GitHub', v: 'Z2l0aHViLmNvbS9qYW5td2ViZXI=', href: v => 'https://' + v },
  ];

  /* ---------- routing ---------- */
  const PAGES = ['home', 'about', 'projects', 'skills', 'blog', 'contact'];
  const cap = s => s[0].toUpperCase() + s.slice(1);
  function route() {
    const h = location.hash.slice(1);
    const page = PAGES.includes(h) ? h : 'home';
    $$('[data-page]').forEach(s => (s.hidden = s.dataset.page !== page));
    $$('.nav-links a').forEach(a => {
      const on = a.getAttribute('href') === '#' + page;
      a.classList.toggle('is-active', on);
      on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
    });
    document.title = page === 'home' ? 'Jan Weber · Quant research' : cap(page) + ' · Jan Weber';
    JW.page = page;
    window.scrollTo(0, 0);
    if (JW.onPage) JW.onPage(page);
  }
  window.addEventListener('hashchange', route);

  /* ---------- ticker tape ---------- */
  const TAPE = [
    { sym: 'JWBR', val: '100.00', chg: '+0.00%', live: true },
    { sym: 'MATH', val: 'KIT', chg: '▲' },
    { sym: 'STOCH', val: 'Itô', chg: '▲' },
    { sym: 'STATS', val: 'inference', chg: '▲' },
    { sym: 'PY', val: 'Python', chg: '▲' },
    { sym: 'CPP', val: 'C++', chg: '▲' },
    { sym: 'SQL', val: 'data', chg: '▲' },
    { sym: 'STATUS', val: 'open to offers', chg: '●' },
  ];
  const tapeHTML = TAPE.map(t =>
    `<span class="tape-item"><b>${t.sym}</b><span class="muted"${t.live ? ' data-bind="tape-val"' : ''}>${t.val}</span>` +
    `<span class="up"${t.live ? ' data-bind="tape-chg"' : ''}>${t.chg}</span></span>`).join('');
  $('#tape').innerHTML = tapeHTML + tapeHTML;

  /* ---------- random-walk backdrop ---------- */
  let walks = '';
  for (let j = 0; j < 7; j++) {
    let y = 300 + (Math.random() - 0.5) * 80;
    const pts = [];
    for (let x = 0; x <= 1000; x += 5) { pts.push(x + ',' + y.toFixed(1)); y += (Math.random() - 0.5) * 14; }
    walks += `<polyline points="${pts.join(' ')}" fill="none" stroke="#fff" stroke-opacity="${j === 0 ? 0.14 : 0.06}" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
  }
  $('#walks').innerHTML = walks;

  /* ---------- blog filter ---------- */
  $('#blog-tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    const f = b.dataset.filter;
    $$('.tab', $('#blog-tabs')).forEach(t => t.classList.toggle('is-active', t === b));
    $$('#posts .post').forEach(p => (p.hidden = f !== 'All' && p.dataset.sym !== f));
  });

  /* ---------- clock ---------- */
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZoneName: 'short' });
  function clock() {
    const parts = fmt.formatToParts(new Date());
    const get = t => (parts.find(p => p.type === t) || {}).value;
    let tz = get('timeZoneName') || 'CET';
    if (/GMT\+1$/.test(tz)) tz = 'CET';
    if (/GMT\+2$/.test(tz)) tz = 'CEST';
    $('#clock').textContent = `${get('hour')}:${get('minute')}:${get('second')} ${tz}`;
  }
  clock();
  setInterval(clock, 1000);

  /* ---------- contact rows + reveal ---------- */
  const decode = s => { try { return atob(s); } catch (e) { return ''; } };
  const rows = $('#contact-rows');
  rows.innerHTML = CONTACTS.map(c =>
    `<div class="c-row"><span class="c-k">${c.k}</span><a class="c-v" tabindex="-1">${'█'.repeat(decode(c.v).length)}</a><span class="c-lock">LOCKED</span></div>`).join('');
  const els = $$('.c-row', rows).map(r => ({ v: $('.c-v', r), lock: $('.c-lock', r) }));
  const GLYPHS = '0123456789abcdef#%&$@*+=<>/\\';
  let unlocked = false;

  JW.unlock = (animate = true) => {
    if (unlocked) return;
    unlocked = true;
    $('#g-skip').hidden = true;
    const vals = CONTACTS.map(c => decode(c.v));
    els.forEach((e, i) => {
      e.lock.textContent = 'UNLOCKED';
      e.lock.classList.add('is-open');
      e.v.href = CONTACTS[i].href(vals[i]);
      if (CONTACTS[i].k !== 'Email') { e.v.target = '_blank'; e.v.rel = 'noopener'; }
      e.v.removeAttribute('tabindex');
    });
    const finish = () => els.forEach((e, i) => { e.v.textContent = vals[i]; e.v.classList.add('is-open'); });
    if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return finish();
    const t0 = performance.now();
    (function frame(now) {
      const rk = (now - t0) / 24;
      let done = true;
      els.forEach((e, i) => {
        const s = vals[i];
        let out = '';
        for (let j = 0; j < s.length; j++) {
          if (j < rk) out += s[j];
          else if (j < rk + 5) out += GLYPHS[(Math.random() * GLYPHS.length) | 0];
          else out += '█';
        }
        e.v.textContent = out;
        if (rk < s.length) done = false;
        else e.v.classList.add('is-open');
      });
      done ? finish() : requestAnimationFrame(frame);
    })(t0);
  };

  $('#g-skip').addEventListener('click', () => JW.skip && JW.skip());

  route();
  if (JW.initGame) JW.initGame();
})();
