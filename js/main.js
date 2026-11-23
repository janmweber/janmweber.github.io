/* Site shell: golden spiral, principles carousel, scroll effects, blog filter, clock, contact reveal. */
(() => {
  'use strict';
  const JW = (window.JW = window.JW || {});
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Contact details — base64 so they are not sitting in the HTML for scrapers.
     Encode a new value in the browser console with btoa('text'). */
  const CONTACTS = [
    { k: 'Email', v: 'amFuLndlYmVyQHN0dWRlbnQua2l0LmVkdQ==', href: v => 'mailto:' + v },
    { k: 'LinkedIn', v: 'bGlua2VkaW4uY29tL2luL2phbi13ZWJlcg==', href: v => 'https://www.' + v },
    { k: 'GitHub', v: 'Z2l0aHViLmNvbS9qYW5td2ViZXI=', href: v => 'https://' + v },
  ];

  /* ---------- golden spiral (layout grid of the experience section) ---------- */
  (function golden() {
    const PHI = (1 + Math.sqrt(5)) / 2;
    let x = 0, y = 0, w = PHI, h = 1, sq = '', sp = 'M0 1';
    const f = n => +n.toFixed(5);
    for (let i = 0; i < 12; i++) {
      const d = i % 4;
      if (d === 0) { const s = h; sq += `M${f(x + s)} ${f(y)}V${f(y + s)}`; sp += `A${f(s)} ${f(s)} 0 0 1 ${f(x + s)} ${f(y)}`; x += s; w -= s; }
      else if (d === 1) { const s = w; sq += `M${f(x)} ${f(y + s)}H${f(x + s)}`; sp += `A${f(s)} ${f(s)} 0 0 1 ${f(x + s)} ${f(y + s)}`; y += s; h -= s; }
      else if (d === 2) { const s = h; sq += `M${f(x + w - s)} ${f(y)}V${f(y + s)}`; sp += `A${f(s)} ${f(s)} 0 0 1 ${f(x + w - s)} ${f(y + s)}`; w -= s; }
      else { const s = w; sq += `M${f(x)} ${f(y + h - s)}H${f(x + s)}`; sp += `A${f(s)} ${f(s)} 0 0 1 ${f(x)} ${f(y + h - s)}`; h -= s; }
    }
    sq += `M0 0H${f(PHI)}V1H0Z`;
    $('.g-squares').setAttribute('d', sq);
    const spiral = $('.g-spiral');
    spiral.setAttribute('d', sp);
    spiral.removeAttribute('pathLength');
    const len = spiral.getTotalLength();
    spiral.style.strokeDasharray = len;
    spiral.style.strokeDashoffset = reduce ? 0 : len;
  })();

  /* ---------- wavy line ornaments (stoa section) ---------- */
  (function waves() {
    let out = '';
    const bundle = (x0, y0, len, amp, rot, n, op) => {
      for (let i = 0; i < n; i++) {
        let d = '';
        for (let s = 0; s <= 60; s++) {
          const t = s / 60, x = x0 + t * len, y = y0 + i * 3.2 + Math.sin(t * Math.PI * 1.6 + i * 0.05) * amp * (0.6 + 0.4 * Math.sin(i * 0.12));
          d += (s ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
        }
        out += `<path d="${d}" transform="rotate(${rot} ${x0} ${y0})" fill="none" stroke="#c9b48a" stroke-opacity="${op}" stroke-width=".6"/>`;
      }
    };
    bundle(-80, 640, 620, 70, -18, 26, 0.35);
    bundle(820, 120, 520, 60, 62, 22, 0.28);
    $('.stoa-waves').innerHTML = out;
  })();

  /* ---------- principles carousel ---------- */
  const QUOTES = [
    { topic: 'On risk', name: 'Epictetus', shape: 'sphere',
      text: '“Some things are within our power, while others are not.”',
      note: 'Enchiridion, §1. The first rule of any position: know what you control — your size and your exit, not the price.',
      aside: 'Stoic philosopher, c. 50–135 CE. Born a slave in Hierapolis, he taught that discipline is about separating what is up to us from what is not.' },
    { topic: 'On probability', name: 'Laplace', shape: 'bell',
      text: '“Probability theory is nothing but common sense reduced to calculation.”',
      note: 'Essai philosophique sur les probabilités, 1814.',
      aside: 'Pierre-Simon Laplace, 1749–1827. Gave the central limit theorem its first general form — the reason the bell curve is everywhere.' },
    { topic: 'On models', name: 'Box', shape: 'saddle',
      text: '“All models are wrong, but some are useful.”',
      note: 'George E. P. Box. A good reminder before trusting any backtest.',
      aside: 'George Box, 1919–2013, statistician. Time series, experimental design, and a healthy distrust of the perfect fit.' },
    { topic: 'On mathematics', name: 'Gauss', shape: 'torus',
      text: '“Mathematics is the queen of the sciences.”',
      note: 'Attributed by his biographer Sartorius von Waltershausen, 1856.',
      aside: 'Carl Friedrich Gauss, 1777–1855. Least squares, the normal distribution, and a habit of publishing only what was finished.' },
  ];
  let qi = 0, qArt = null;
  const tabs = $('#stoa-tabs'), thumbs = $('#q-thumbs');
  tabs.innerHTML = QUOTES.map((q, i) => `<button data-i="${i}">${q.topic.replace('On ', '').replace(/^./, c => c.toUpperCase())}</button>`).join('');
  thumbs.innerHTML = QUOTES.map((q, i) => `<button class="thumb" data-i="${i}" aria-label="${q.name}"><canvas></canvas></button>`).join('');
  function showQuote(i, animate = true) {
    qi = (i + QUOTES.length) % QUOTES.length;
    const q = QUOTES[qi];
    const els = [$('.stoa-text'), $('#q-aside'), $('#q-art')];
    const apply = () => {
      $('#q-topic').textContent = q.topic;
      $('#q-name').textContent = q.name;
      $('#q-text').textContent = q.text;
      $('#q-note').textContent = q.note;
      $('#q-aside').textContent = q.aside;
      if (qArt) qArt.setShape(q.shape);
      els.forEach(e => e.classList.remove('fade'));
    };
    $$('button', tabs).forEach(b => b.classList.toggle('is-on', +b.dataset.i === qi));
    $$('.thumb', thumbs).forEach(b => b.classList.toggle('is-on', +b.dataset.i === qi));
    if (!animate || reduce) return apply();
    els.forEach(e => e.classList.add('fade'));
    setTimeout(apply, 380);
  }
  tabs.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) showQuote(+b.dataset.i); });
  thumbs.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) showQuote(+b.dataset.i); });
  $('#q-prev').addEventListener('click', () => showQuote(qi - 1));
  $('#q-next').addEventListener('click', () => showQuote(qi + 1));

  /* ---------- blog filter ---------- */
  $('#blog-tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    const f = b.dataset.filter;
    $$('[data-filter]', $('#blog-tabs')).forEach(t => t.classList.toggle('is-active', t === b));
    $$('#posts .post').forEach(p => (p.hidden = f !== 'All' && p.dataset.sym !== f));
  });

  /* ---------- scroll reveal, golden spiral draw-in, section spy, game visibility ---------- */
  const rvIO = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); rvIO.unobserve(e.target); } }), { threshold: 0.15 });
  $$('.rv').forEach(el => rvIO.observe(el));
  rvIO.observe($('#golden'));

  const spy = $$('.index a');
  const spyIO = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    spy.forEach(a => a.classList.toggle('is-on', a.dataset.spy === e.target.id));
  }), { rootMargin: '-45% 0px -50% 0px' });
  $$('main section[id]').forEach(s => spyIO.observe(s));

  new IntersectionObserver(es => es.forEach(e => { JW.gameVisible = e.isIntersecting; })).observe($('#game'));

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
    `<div class="c-row"><span class="c-k">${c.k}</span><a class="c-v" tabindex="-1">${'█'.repeat(decode(c.v).length)}</a><span class="c-lock">Locked</span></div>`).join('');
  const els = $$('.c-row', rows).map(r => ({ v: $('.c-v', r), lock: $('.c-lock', r) }));
  const GLYPHS = '0123456789abcdefφσμλ∂∫Σ';
  let unlocked = false;

  JW.unlock = (animate = true) => {
    if (unlocked) return;
    unlocked = true;
    $('#g-skip').hidden = true;
    const vals = CONTACTS.map(c => decode(c.v));
    els.forEach((e, i) => {
      e.lock.textContent = 'Unlocked';
      e.lock.classList.add('is-open');
      e.v.href = CONTACTS[i].href(vals[i]);
      if (CONTACTS[i].k !== 'Email') { e.v.target = '_blank'; e.v.rel = 'noopener'; }
      e.v.removeAttribute('tabindex');
    });
    const finish = () => els.forEach((e, i) => { e.v.textContent = vals[i]; e.v.classList.add('is-open'); });
    if (!animate || reduce) return finish();
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

  /* ---------- boot ---------- */
  if (JW.initArt) JW.initArt();
  qArt = $('#q-art')._sculpt || null;
  $$('.thumb canvas', thumbs).forEach((cv, i) => {
    requestAnimationFrame(() => new JW.Sculpture(cv, { shape: QUOTES[i].shape, color: '#dccaa4', static: true, speed: 0, yaw: 0.9 }));
  });
  showQuote(0, false);
  if (JW.initGame) JW.initGame();
})();
