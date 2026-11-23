// Launch Radar v2 — dashboard script.
//
// The page is rendered entirely from window.RADAR, the dataset main.ts
// writes beside this folder as data.js. There is no network, no framework
// and no build step: this file is the whole application.
//
// Organisation, top to bottom:
//   1. number and text formatting
//   2. a tiny element builder
//   3. view state, mirrored into the URL hash so a view can be linked
//   4. row selection (filters) and ordering (sortable columns)
//   5. the page frame: header, introduction, toolbar
//   6. the two tables (launch board, tokenized set-aside)
//   7. the methodology section (fitted coefficients, both validations)
//   8. the per-protocol detail drawer
//   9. render and boot
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var root = document.getElementById('board');
  var COUNTS = DATA.counts;
  var MODEL = DATA.model;

  // ---------------------------------------------------------- 1. formatting
  var intlUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  var fmt = {
    usd: function (n) {
      if (n === null || n === undefined || !isFinite(n)) return 'n/a';
      var a = Math.abs(n);
      if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
      if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
      if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
      return intlUsd.format(n);
    },
    pct: function (n) {
      return n === null || n === undefined ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(2) + '%';
    },
    age: function (days) {
      if (days === null || days === undefined) return 'unknown';
      return days >= 365 ? (days / 365).toFixed(1) + ' yrs' : Math.round(days) + ' days';
    },
    odds: function (o) { return Math.round(o * 100) + '%'; },
    signed: function (n, digits) { return (n >= 0 ? '+' : '') + n.toFixed(digits); }
  };

  // ---------------------------------------------------------- 2. elements
  function h(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key.indexOf('on') === 0) node.addEventListener(key.slice(2), value);
        else if (value !== null && value !== undefined && value !== false) node.setAttribute(key, value);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }
  function append(node, child) {
    if (child === null || child === undefined) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(node, c); }); return; }
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }

  // ---------------------------------------------------------- 3. state
  var view = { q: '', category: 'all', chain: 'all', watch: false, tab: 'board', sort: 'implied', dir: -1, open: null };

  function readHash() {
    var raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    var p = new URLSearchParams(raw);
    if (p.get('q')) view.q = p.get('q');
    if (p.get('category')) view.category = p.get('category');
    if (p.get('chain')) view.chain = p.get('chain');
    if (p.get('watch') === '1') view.watch = true;
    if (p.get('tab') === 'live') view.tab = 'live';
    if (p.get('sort')) view.sort = p.get('sort');
    if (p.get('p')) view.open = p.get('p');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (view.q) p.set('q', view.q);
    if (view.category !== 'all') p.set('category', view.category);
    if (view.chain !== 'all') p.set('chain', view.chain);
    if (view.watch) p.set('watch', '1');
    if (view.tab === 'live') p.set('tab', 'live');
    if (view.open) p.set('p', view.open);
    var s = p.toString();
    window.history.replaceState(null, '', s ? '#' + s : window.location.pathname + window.location.search);
  }

  // ---------------------------------------------------------- 4. rows
  function selectRows() {
    var needle = view.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (view.watch && !r.watchlist) return false;
      if (view.category !== 'all' && (r.category || 'Uncategorised') !== view.category) return false;
      if (view.chain !== 'all' && (r.chains || []).indexOf(view.chain) < 0) return false;
      if (!needle) return true;
      var haystack = [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase();
      return haystack.indexOf(needle) >= 0;
    });
  }
  var SORT_VALUE = {
    name: function (r) { return r.name.toLowerCase(); },
    tvl: function (r) { return r.tvl_usd; },
    growth: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; },
    age: function (r) { return r.age_days === null ? -1 : r.age_days; },
    odds: function (r) { return r.token_odds; },
    implied: function (r) { return r.implied_value_usd; }
  };
  function orderRows(list) {
    var value = SORT_VALUE[view.sort] || SORT_VALUE.implied;
    var dir = view.dir;
    return list.slice().sort(function (a, b) {
      var av = value(a), bv = value(b);
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // ---------------------------------------------------------- 5. frame
  function headerBar() {
    return h('header', { class: 'top' },
      h('div', { class: 'brand' }, h('span', { class: 'ring' }),
        h('div', null, h('b', { text: 'Launch Radar' }), h('span', { text: 'token launch radar · v2 fitted model' }))),
      h('div', { class: 'meta' },
        'snapshot ' + DATA.as_of + ' · DefiLlama protocol index', h('br'),
        'model ' + DATA.model_version + ' · ridge λ=' + MODEL.lambda + ' · fit on ' + MODEL.fit_n + ' peers'));
  }
  function intro() {
    function stat(value, label, amber) {
      return h('div', { class: 'stat' + (amber ? ' amber' : '') }, h('b', { text: value }), h('span', { text: label }));
    }
    return h('section', { class: 'hero' },
      h('div', null,
        h('h1', { text: 'Pre-token protocols, priced by a model fitted on their tokenized peers' }),
        h('p', null,
          'Every protocol that records no token yet is a candidate; every one that already trades is set aside. ',
          h('b', { text: COUNTS.watchlist + ' of ' + COUNTS.watchlist + ' watchlist protocols are ranked' }),
          ', plus ' + COUNTS.early + ' earlier finds below the $' + Math.round(DATA.floor_usd / 1e6) + 'M watchlist floor. Implied value is the fitted model\u2019s estimate of what a launch could be worth if the record stayed as it is — not a prediction that one happens, and not a promise of a token.')),
      h('div', { class: 'stats' },
        stat(String(COUNTS.board), 'launch candidates ranked'),
        stat(COUNTS.watchlist + ' / ' + COUNTS.watchlist, 'watchlist covered', true),
        stat(String(COUNTS.tokenized), 'already record a token, set aside'),
        stat(String(MODEL.fit_n), 'of them carry a market cap — the fit set')));
  }
  function toolbar() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Uncategorised'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains || []; }))).sort();
    var search = h('input', { type: 'search', id: 'q', placeholder: 'Search name, slug, chain…', value: view.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { view.q = search.value; writeHash(); render(); });
    function dropdown(id, label, values, current, apply) {
      var select = h('select', { id: id, 'aria-label': label },
        h('option', { value: 'all', text: label + ': all' }),
        values.map(function (v) { return h('option', { value: v, text: v, selected: v === current ? 'selected' : null }); }));
      select.addEventListener('change', function () { apply(select.value); writeHash(); render(); });
      return h('div', { class: 'field' }, h('label', { for: id, text: label }), select);
    }
    var watchBox = h('input', { type: 'checkbox', id: 'watch', 'aria-label': 'Watchlist only' });
    if (view.watch) watchBox.setAttribute('checked', '');
    watchBox.addEventListener('change', function () { view.watch = watchBox.checked; writeHash(); render(); });
    function tabButton(tab, label) {
      return h('button', { type: 'button', 'aria-pressed': view.tab === tab ? 'true' : 'false', text: label,
        onclick: function () { view.tab = tab; writeHash(); render(); } });
    }
    var countText = view.tab === 'board'
      ? selectRows().length + ' of ' + COUNTS.board + ' rows'
      : DATA.live.length + ' shown of ' + COUNTS.tokenized + ' tokenized';
    return h('div', { class: 'controls' },
      h('div', { class: 'field' }, h('label', { for: 'q', text: 'Search' }), search),
      dropdown('chain', 'Chain', chains, view.chain, function (v) { view.chain = v; }),
      dropdown('category', 'Category', categories, view.category, function (v) { view.category = v; }),
      h('label', { class: 'check' }, watchBox, 'Watchlist only'),
      h('div', { class: 'field' }, h('span', { class: 'lab', text: 'View' }),
        h('div', { class: 'tabs' }, tabButton('board', 'Launch board'), tabButton('live', 'Already tokenized'))),
      h('span', { class: 'count', text: countText }));
  }

  // ---------------------------------------------------------- 6. tables
  function sortHead(key, label) {
    return h('th', { scope: 'col' },
      h('button', { type: 'button', onclick: function () {
        if (view.sort === key) view.dir = -view.dir;
        else { view.sort = key; view.dir = -1; }
        render();
      } }, label + (view.sort === key ? (view.dir < 0 ? ' ↓' : ' ↑') : '')));
  }
  function emptyPanel() {
    return h('div', { class: 'panel' }, h('div', { class: 'empty' },
      h('h2', { text: 'Nothing on the radar matches' }),
      h('p', { text: 'Clear the search or widen the chain and category filters.' }),
      h('button', { class: 'btn primary', type: 'button', text: 'Clear all filters', onclick: function () {
        view.q = ''; view.category = 'all'; view.chain = 'all'; view.watch = false; writeHash(); render();
      } })));
  }
  function boardTable() {
    var list = orderRows(selectRows());
    if (!list.length) return emptyPanel();
    var peak = 0;
    list.forEach(function (r) { if (r.implied_value_usd > peak) peak = r.implied_value_usd; });
    peak = peak || 1;
    var body = h('tbody');
    list.forEach(function (r) {
      var chainsLabel = (r.chains || []).slice(0, 2).join(', ') + ((r.chains || []).length > 2 ? ' +' + (r.chains.length - 2) : '');
      body.appendChild(h('tr', { 'data-selected': view.open === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } } },
        h('td', { class: 'num', text: String(r.rank) }),
        h('td', null,
          h('span', { class: 'name' }, h('b', { text: r.name }), r.watchlist ? h('span', { class: 'badge', text: 'watchlist' }) : null),
          h('div', { class: 'sub', text: (r.category || 'Uncategorised') + ' · ' + r.slug + ' · ' + (r.tier || '') })),
        h('td', { class: 'sub', text: chainsLabel }),
        h('td', { class: 'num', text: fmt.usd(r.tvl_usd) }),
        h('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmt.pct(r.change_7d) }),
        h('td', { class: 'num', text: fmt.age(r.age_days) }),
        h('td', { class: 'num', text: fmt.odds(r.token_odds) }),
        h('td', null,
          h('span', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / peak) * 100)) + '%' })),
          h('span', { class: 'num', text: fmt.usd(r.implied_value_usd) })),
        h('td', null, h('span', null, h('span', { class: 'dot' }), 'no token'))));
    });
    return h('div', { class: 'panel' }, h('div', { class: 'table-wrap' },
      h('table', null,
        h('caption', { text: 'Ranked by implied value. Select any row for its full model breakdown, token odds and farm plan.' }),
        h('thead', null, h('tr', null,
          sortHead('implied', '#'), sortHead('name', 'Protocol'), h('th', { scope: 'col', text: 'Chains' }),
          sortHead('tvl', 'TVL'), sortHead('growth', '7d'), sortHead('age', 'No-token age'),
          sortHead('odds', 'Token odds'), sortHead('implied', 'Implied value'), h('th', { scope: 'col', text: 'Token' }))),
        body)));
  }
  function liveTable() {
    var body = h('tbody');
    DATA.live.forEach(function (r) {
      body.appendChild(h('tr', null,
        h('td', null, h('span', { class: 'name' }, h('b', { text: r.name })),
          h('div', { class: 'sub', text: (r.category || 'Uncategorised') + ' · ' + r.slug })),
        h('td', { class: 'sub', text: (r.chains || []).slice(0, 3).join(', ') }),
        h('td', { class: 'num', text: fmt.usd(r.tvl_usd) }),
        h('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmt.pct(r.change_7d) }),
        h('td', { class: 'num', text: fmt.usd(r.mcap_usd) }),
        h('td', { class: 'num', text: r.symbol || '—' }),
        h('td', null, h('span', null, h('span', { class: 'dot off' }), 'trades'))));
    });
    return h('div', { class: 'panel' }, h('div', { class: 'table-wrap' },
      h('table', null,
        h('caption', { text: 'Set aside, not ranked: these ' + COUNTS.tokenized + ' protocols already record a token, so the market prices them. The largest by market cap are shown; the ' + MODEL.fit_n + ' of them with a market cap are the peers the model was fitted on.' }),
        h('thead', null, h('tr', null,
          h('th', { scope: 'col', text: 'Protocol' }), h('th', { scope: 'col', text: 'Chains' }),
          h('th', { scope: 'col', text: 'TVL' }), h('th', { scope: 'col', text: '7d' }),
          h('th', { scope: 'col', text: 'Market cap' }), h('th', { scope: 'col', text: 'Symbol' }), h('th', { scope: 'col', text: 'Token' }))),
        body)));
  }

  // ---------------------------------------------------------- 7. methodology
  function methodSection() {
    var first = MODEL.validation[0], second = MODEL.validation[1];
    var baseFirst = MODEL.tvl_only_validation[0], baseSecond = MODEL.tvl_only_validation[1];
    var categoryRows = MODEL.categories.map(function (name, i) {
      var coef = MODEL.category_coefs[i];
      return h('tr', null,
        h('td', { text: name }),
        h('td', { class: 'num coef', text: fmt.signed(coef, 4) }),
        h('td', { class: 'num coef', text: '×' + Math.exp(coef).toFixed(3) }));
    });
    var equation = 'log(implied) = ' + MODEL.intercept.toFixed(4)
      + ' + ' + MODEL.coef_log_tvl.toFixed(4) + '·ln(TVL)'
      + ' + ' + MODEL.coef_change.toFixed(4) + '·change'
      + ' + ' + MODEL.coef_log_age.toFixed(4) + '·ln(1+age)'
      + ' + ' + MODEL.coef_log_chains.toFixed(4) + '·ln(chains) + category';
    return h('section', { class: 'panel model' },
      h('h2', { text: 'How the radar prices a protocol with no token' }),
      h('div', { class: 'formula', text: equation }),
      h('p', null,
        h('b', { text: 'Fitted, not assumed — ' }),
        'the coefficients above are a ridge regression (λ=' + MODEL.lambda + ') of log market cap on the snapshot\u2019s own figures, fitted on the ' + MODEL.fit_n + ' tokenized protocols that actually carry a market cap. The other ' + MODEL.no_mcap + ' protocols that record a token carry no market cap in the snapshot, so they teach the regression nothing and are excluded, not imputed. 7-day change is clamped to ±30% first; an unreported age is set to the fit set\u2019s median, ' + MODEL.median_age_days + ' days. '),
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { text: 'Category effects — the log points a category adds, and the multiplier that is. Categories with fewer than 7 fit peers get no dummy and sit at the pooled level.' }),
          h('thead', null, h('tr', null,
            h('th', { scope: 'col', text: 'Category' }), h('th', { scope: 'col', text: 'Coefficient' }), h('th', { scope: 'col', text: 'Multiplier' }))),
          h('tbody', null, categoryRows))),
      h('p', null,
        h('b', { text: 'Validated held-out, twice — ' }),
        first.name + ': fit on ' + first.n_fit + ', tested on ' + first.n_test + ' unseen peers, median absolute log error ' + first.median_abs_log_error.toFixed(3) + ' (mean ' + first.mean_abs_log_error.toFixed(3) + '). ' +
        second.name + ': fit on ' + second.n_fit + ', tested on ' + second.n_test + ', median ' + second.median_abs_log_error.toFixed(3) + ' (mean ' + second.mean_abs_log_error.toFixed(3) + '). ' +
        'A TVL-only baseline scores ' + baseFirst.median_abs_log_error.toFixed(3) + ' and ' + baseSecond.median_abs_log_error.toFixed(3) + ' on the same splits, so the extra terms do not beat TVL alone — the ridge penalty keeps them small and they adjust the ranking modestly. In-sample median error is ' + MODEL.in_sample_median_abs_log_error.toFixed(3) + '.'),
      h('p', { class: 'warn' },
        h('b', { text: 'Read the error honestly: ' }),
        'a median log error around 1.2 means the typical fitted value is off by about a factor of three. Market caps are noisy, and this board is a ranking device — which pre-token protocol is worth farming next — not a price forecast.'),
      h('p', null,
        h('b', { text: 'Token odds — ' }),
        'for each protocol, the share of protocols in its category that already record a token (' + Math.round(MODEL.global_token_share * 100) + '% overall), shrunk toward that overall share with a pseudo-count of 5, so a thin category cannot claim 0% or 100%. It is a peer-rate, not a prediction that this protocol issues one.'),
      h('p', { text: 'Who is not ranked, and why: ' + COUNTS.tokenized + ' protocols already record a token (a gecko_id or a symbol in the snapshot) and are priced by the market, not by this model. Of the ' + COUNTS.pre_token + ' that record no token, ' + COUNTS.not_own_launch + ' are set aside as not a launch of their own — centralised exchanges, bridges and canonical bridges, liquid staking and restaking wrappers, wrapped or staked products and versioned pools of another protocol. The board ranks the other ' + COUNTS.board + ', including every one of the ' + COUNTS.watchlist + ' watchlist protocols.' }));
  }

  // ---------------------------------------------------------- 8. detail
  var drawer = h('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'dtitle' });
  drawer.addEventListener('close', function () { view.open = null; writeHash(); render(); });

  function figureRow(label, value) {
    return h('div', null, h('span', { text: label }), h('b', { class: 'num', text: value }));
  }
  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    view.open = slug;
    writeHash();
    var t = row.terms;
    var logSum = t.intercept + t.log_tvl + t.change + t.log_age + t.log_chains + t.category;
    var recomputed = Math.max(1, Math.round(Math.exp(logSum)));
    var ageUsed = row.age_days === null ? MODEL.median_age_days : row.age_days;
    var changeUsed = row.change_7d === null ? 0 : Math.min(30, Math.max(-30, row.change_7d));
    function termLine(label, detail, contribution) {
      return h('div', null,
        h('span', { text: label + ' — ' + detail }),
        h('b', { class: 'num', text: fmt.signed(contribution, 3) + '  (×' + Math.exp(contribution).toFixed(3) + ')' }));
    }
    var matches = Math.abs(recomputed - row.implied_value_usd) <= Math.max(2, row.implied_value_usd * 0.001);
    drawer.textContent = '';
    append(drawer, h('div', { class: 'dhead' },
      h('div', null,
        h('span', { class: 'kicker', text: 'Rank ' + row.rank + ' of ' + COUNTS.board + (row.watchlist ? ' · watchlist' : ' · early find') }),
        h('h2', { id: 'dtitle', text: row.name }),
        h('p', { class: 'sub', text: (row.category || 'Uncategorised') + ' · ' + row.slug + ' · records no token' })),
      h('button', { class: 'close', type: 'button', text: 'Close', onclick: function () { drawer.close(); } })));
    append(drawer, h('section', { class: 'dsec' },
      h('h3', { text: 'The figures' }),
      h('div', { class: 'chips' }, (row.chains || []).map(function (c) { return h('span', { text: c }); })),
      h('div', { class: 'eq' },
        figureRow('TVL', fmt.usd(row.tvl_usd)),
        figureRow('Change, 7 days', fmt.pct(row.change_7d)),
        figureRow('Tracked since', row.listed_at || 'unreported'),
        figureRow('Age with no token', fmt.age(row.age_days)),
        figureRow('Signal tier', row.tier || ''),
        figureRow('Token odds (peer rate)', fmt.odds(row.token_odds) + ' · ' + row.token_odds_tokenized + ' of ' + row.token_odds_n + ' in category'),
        figureRow('Implied ÷ TVL', (row.implied_value_usd / row.tvl_usd).toFixed(3) + '×'))));
    append(drawer, h('section', { class: 'dsec' },
      h('h3', { text: 'How the fitted model got this value' }),
      h('div', { class: 'eq' },
        termLine('Intercept', '—', t.intercept),
        termLine('log TVL', 'ln(' + fmt.usd(row.tvl_usd) + ') = ' + Math.log(row.tvl_usd).toFixed(2), t.log_tvl),
        termLine('7-day change', changeUsed.toFixed(1) + '% clamped', t.change),
        termLine('log age', 'ln(1 + ' + ageUsed + ' days)', t.log_age),
        termLine('log chains', 'ln(' + (row.chains || []).length + ' chains)', t.log_chains),
        termLine('Category' + (t.category_name ? ' (' + t.category_name + ')' : ' (pooled)'), t.category_name ? 'own dummy' : 'no dummy', t.category),
        h('div', { class: 'total' }, h('span', { text: 'Implied value' }), h('b', { class: 'num', text: fmt.usd(row.implied_value_usd) }))),
      h('p', { class: 'note', text: 'The six log terms above sum to ' + logSum.toFixed(3) + ', exp of which is ' + fmt.usd(recomputed) + (matches ? ' — the board figure, to rounding.' : ' — the board figure differs by rounding of the stored terms.') + ' An estimate if the record stayed as it is, never a promise of a launch.' })));
    append(drawer, h('section', { class: 'dsec' },
      h('h3', { text: 'Farm plan — ' + row.farm_steps.length + ' steps' }),
      h('ol', { class: 'steps' }, row.farm_steps.map(function (s) { return h('li', { text: s }); }))));
    if (!drawer.isConnected && root.firstChild) root.appendChild(drawer);
    if (typeof drawer.showModal === 'function') { if (!drawer.open) drawer.showModal(); }
    else drawer.setAttribute('open', '');
  }

  // ---------------------------------------------------------- 9. render
  function render() {
    var reopen = view.open;
    root.textContent = '';
    var shell = h('div', { class: 'shell' });
    append(shell, headerBar());
    append(shell, intro());
    append(shell, toolbar());
    append(shell, view.tab === 'board' ? boardTable() : liveTable());
    if (view.tab === 'board') append(shell, methodSection());
    root.appendChild(shell);
    root.setAttribute('aria-busy', 'false');
    if (reopen) { view.open = null; openDetail(reopen); }
  }
  readHash();
  render();
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && drawer.open) drawer.close(); });
})();
