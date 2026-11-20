// Signal Sweep dashboard. Reads window.RADAR (data.js, written by main.ts beside
// this folder) and renders the ranked board, chain / category / watchlist filters,
// sortable columns, a tokenized set-aside view and a per-protocol detail drawer
// whose farm plan is the exact text board.json carries. Fully offline.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var C = DATA.counts;
  var state = { q: '', category: 'all', chain: 'all', watch: false, tab: 'board', sort: 'implied', dir: -1, selected: null };

  var usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFmt.format(n);
  }
  function fmtPct(n) { return n === null || n === undefined ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + ' yrs';
    return Math.round(d) + ' days';
  }
  // Recompute the three snapshot-only multipliers for a row, to show in the detail
  // view that the stored implied value is this arithmetic and nothing else. The
  // peer multiple itself is read from the row: it is a median over tokenized peers.
  function parts(row) {
    var m = DATA.model;
    var ch = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    ch = Math.min(m.momentum_cap, Math.max(m.momentum_floor, ch));
    var momentum = 1 + (ch / 100) * m.momentum_gain;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var longevity = m.longevity_floor + m.longevity_range * Math.sqrt(Math.min(Math.max(age, 0), m.longevity_days) / m.longevity_days);
    var breadth = 1 + m.breadth_step * Math.min(Math.max((row.chains || []).length - 1, 0), m.breadth_max_extra);
    return { momentum: momentum, longevity: longevity, breadth: breadth,
      check: Math.max(1, Math.round(row.tvl_usd * row.peer_multiple * momentum * longevity * breadth)) };
  }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    var p = new URLSearchParams(h);
    if (p.get('q')) state.q = p.get('q');
    if (p.get('category')) state.category = p.get('category');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('watch') === '1') state.watch = true;
    if (p.get('tab') === 'live') state.tab = 'live';
    if (p.get('sort')) state.sort = p.get('sort');
    if (p.get('p')) state.selected = p.get('p');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.watch) p.set('watch', '1');
    if (state.tab === 'live') p.set('tab', 'live');
    if (state.selected) p.set('p', state.selected);
    var s = p.toString();
    window.history.replaceState(null, '', s ? '#' + s : window.location.pathname + window.location.search);
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sorted(list) {
    var key = state.sort, dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'peer') { av = a.peer_multiple; bv = b.peer_multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'ring' }),
        el('div', null, el('b', { text: 'Signal Sweep' }), el('span', { text: 'token launch radar' }))),
      el('div', { class: 'meta' },
        'snapshot ' + DATA.as_of + ' · DefiLlama protocol index', el('br'),
        'model ' + DATA.model_version + ' · peer-anchored'));
  }
  function hero() {
    function stat(value, label, teal) {
      return el('div', { class: 'stat' + (teal ? ' teal' : '') }, el('b', { text: value }), el('span', { text: label }));
    }
    return el('section', { class: 'hero' },
      el('div', null,
        el('h1', { text: 'Pre-token protocols, priced by their tokenized peers' }),
        el('p', { html: '' },
          'Every protocol that records no token yet is a candidate; every one that already trades is set aside. ',
          el('b', { text: C.watchlist + ' of ' + C.watchlist + ' watchlist protocols are ranked' }),
          ', plus ' + C.early + ' earlier finds below the $' + Math.round(DATA.floor_usd / 1e6) + 'M watchlist floor. Implied value is a model estimate of what a launch could be worth if the record stayed as it is — not a prediction that one happens.')),
      el('div', { class: 'stats' },
        stat(String(C.board), 'launch candidates ranked'),
        stat(C.watchlist + ' / ' + C.watchlist, 'watchlist covered', true),
        stat(String(C.tokenized), 'already tokenized, set aside'),
        stat(String(C.not_own_launch), 'pre-token wrappers & exchanges, set aside')));
  }
  function controls() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Uncategorised'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains || []; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, slug, chain…', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    function select(id, label, values, current, onChange) {
      var s = el('select', { id: id, 'aria-label': label },
        el('option', { value: 'all', text: label + ': all' }),
        values.map(function (v) { return el('option', { value: v, text: v, selected: v === current ? 'selected' : null }); }));
      s.addEventListener('change', function () { onChange(s.value); writeHash(); render(); });
      return el('div', { class: 'field' }, el('label', { for: id, text: label }), s);
    }
    var watchBox = el('input', { type: 'checkbox', id: 'watch', 'aria-label': 'Watchlist only' });
    if (state.watch) watchBox.setAttribute('checked', '');
    watchBox.addEventListener('change', function () { state.watch = watchBox.checked; writeHash(); render(); });
    var boardBtn = el('button', { type: 'button', 'aria-pressed': state.tab === 'board' ? 'true' : 'false', text: 'Launch board', onclick: function () { state.tab = 'board'; writeHash(); render(); } });
    var liveBtn = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Already tokenized', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      select('chain', 'Chain', chains, state.chain, function (v) { state.chain = v; }),
      select('category', 'Category', cats, state.category, function (v) { state.category = v; }),
      el('label', { class: 'check' }, watchBox, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'View' }), el('div', { class: 'tabs' }, boardBtn, liveBtn)),
      el('span', { class: 'count', text: state.tab === 'board' ? visibleRows().length + ' of ' + C.board + ' rows' : DATA.live.length + ' shown of ' + C.tokenized + ' tokenized' }));
  }
  function sortHead(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () {
        if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; }
        render();
      } }, label + (state.sort === key ? (state.dir < 0 ? ' ↓' : ' ↑') : '')));
  }
  function boardTable() {
    var list = sorted(visibleRows());
    if (!list.length) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'Nothing on the sweep matches' }),
        el('p', { text: 'Clear the search or widen the chain and category filters.' }),
        el('button', { class: 'btn primary', type: 'button', text: 'Clear all filters', onclick: function () {
          state.q = ''; state.category = 'all'; state.chain = 'all'; state.watch = false; writeHash(); render();
        } })));
    }
    var max = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var tr = el('tr', { 'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } } },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('span', { class: 'name' }, el('b', { text: r.name }), r.watchlist ? el('span', { class: 'badge', text: 'watchlist' }) : null),
          el('div', { class: 'sub', text: (r.category || 'Uncategorised') + ' · ' + r.slug + ' · ' + (r.tier || '') })),
        el('td', { class: 'sub', text: (r.chains || []).slice(0, 2).join(', ') + ((r.chains || []).length > 2 ? ' +' + (r.chains.length - 2) : '') }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: r.peer_multiple.toFixed(3) + '×' }),
        el('td', null, el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })),
        el('td', null, el('span', null, el('span', { class: 'dot' }), 'no token')));
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' },
      el('table', null,
        el('caption', { text: 'Ranked by implied value. Select any row for its full model breakdown and farm plan.' }),
        el('thead', null, el('tr', null,
          sortHead('implied', '#'), sortHead('name', 'Protocol'), el('th', { scope: 'col', text: 'Chains' }),
          sortHead('tvl', 'TVL'), sortHead('growth', '7d'), sortHead('age', 'No-token age'),
          sortHead('peer', 'Peer ×'), sortHead('implied', 'Implied value'), el('th', { scope: 'col', text: 'Token' }))),
        tbody)));
  }
  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'name' }, el('b', { text: r.name })), el('div', { class: 'sub', text: (r.category || 'Uncategorised') + ' · ' + r.slug })),
        el('td', { class: 'sub', text: (r.chains || []).slice(0, 3).join(', ') }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.symbol || '—' }),
        el('td', null, el('span', null, el('span', { class: 'dot off' }), 'trades'))));
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' },
      el('table', null,
        el('caption', { text: 'Set aside, not ranked: these ' + C.tokenized + ' protocols already record a token, so the market prices them. The largest by market cap are shown; their category medians are the peer evidence behind the board.' }),
        el('thead', null, el('tr', null,
          el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Chains' }),
          el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }),
          el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Symbol' }), el('th', { scope: 'col', text: 'Token' }))),
        tbody)));
  }
  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How the sweep prices a protocol with no token' }),
      el('div', { class: 'formula', text: 'implied = TVL × peer_multiple × momentum × longevity × breadth' }),
      el('p', null,
        el('b', { text: 'Peer multiple — ' }),
        'the median market-cap ÷ TVL of tokenized protocols in the same category (global median ' + DATA.global_peer_multiple.toFixed(3) + '× across all categories). Each peer ratio is first winsorised into ' + m.ratio_winsor_low + '×–' + m.ratio_winsor_high + '× so one extreme peer cannot rule a category, the category median is shrunk toward the global median with weight ' + m.shrink_k + ', and the result is held between ' + m.peer_floor + '× and ' + m.peer_cap + '×. '),
      el('p', null,
        el('b', { text: 'Momentum — ' }),
        '1 + clamp(change_7d, ' + m.momentum_floor + '%, +' + m.momentum_cap + '%) × ' + m.momentum_gain + '. ' +
        el('b', { text: 'Longevity — ' }),
        m.longevity_floor + ' + ' + m.longevity_range + ' × √(age in days ÷ ' + m.longevity_days + '), age being days since DefiLlama first tracked the protocol (' + m.unknown_age_days + ' days when unreported): the longer it has run with no token, the more of its TVL the model trusts. '),
      el('p', null,
        el('b', { text: 'Breadth — ' }),
        '1 + ' + m.breadth_step + ' per extra chain beyond the first, up to ' + m.breadth_max_extra + ' extra chains. '),
      el('p', { text: 'Who is not ranked, and why: ' + C.tokenized + ' protocols already record a token (a gecko_id or a symbol in the snapshot) and are priced by the market, not by this model. Of the ' + C.pre_token + ' that record no token, ' + C.not_own_launch + ' are set aside as not a launch of their own — centralised exchanges, bridges and canonical bridges, liquid staking and restaking wrappers, wrapped or staked products and versioned pools of another protocol. The board ranks the other ' + C.board + ', including every one of the ' + C.watchlist + ' watchlist protocols.' }));
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'dtitle' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); render(); });
  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    var p = parts(row);
    dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'dhead' },
      el('div', null,
        el('span', { class: 'kicker', text: 'Rank ' + row.rank + ' of ' + C.board + (row.watchlist ? ' · watchlist' : ' · early find') }),
        el('h2', { id: 'dtitle', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Uncategorised') + ' · ' + row.slug + ' · records no token' })),
      el('button', { class: 'close', type: 'button', text: 'Close', onclick: function () { dialog.close(); } })));
    dialog.appendChild(el('section', { class: 'dsec' },
      el('h3', { text: 'The figures' }),
      el('div', { class: 'chips' }, (row.chains || []).map(function (c) { return el('span', { text: c }); })),
      el('div', { class: 'eq' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Change, 7 days' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Tracked since' }), el('b', { class: 'num', text: row.listed_at || 'unreported' })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Signal tier' }), el('b', { class: 'num', text: row.tier || '' })),
        el('div', null, el('span', { text: 'Implied ÷ TVL' }), el('b', { class: 'num', text: (row.implied_value_usd / row.tvl_usd).toFixed(3) + '×' })))));
    dialog.appendChild(el('section', { class: 'dsec' },
      el('h3', { text: 'How the model got this value' }),
      el('div', { class: 'eq' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: '× peer multiple (' + (row.category || 'category') + ', ' + row.peer_samples + ' tokenized peers)' }), el('b', { class: 'num', text: row.peer_multiple.toFixed(4) + '×' })),
        el('div', null, el('span', { text: '× momentum (7d change)' }), el('b', { class: 'num', text: p.momentum.toFixed(4) + '×' })),
        el('div', null, el('span', { text: '× longevity (no-token age)' }), el('b', { class: 'num', text: p.longevity.toFixed(4) + '×' })),
        el('div', null, el('span', { text: '× breadth (' + (row.chains || []).length + ' chains)' }), el('b', { class: 'num', text: p.breadth.toFixed(4) + '×' })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))),
      el('p', { class: 'note', text: 'Recomputed here from the row figures: ' + fmtUsd(p.check) + (p.check === row.implied_value_usd ? ' — the same number board.json carries.' : ' — differs from the board, so treat the board figure as stale.') + ' An estimate if the record stayed as it is, never a promise of a launch.' })));
    dialog.appendChild(el('section', { class: 'dsec' },
      el('h3', { text: 'Farm plan — ' + row.farm_steps.length + ' steps' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) { return el('li', { text: s }); }))));
    if (!dialog.isConnected && app.firstChild) app.appendChild(dialog);
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
    renderTableOnly();
  }
  function renderTableOnly() { /* selection highlight refreshes on next full render */ }
  function render() {
    var selected = state.selected;
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(hero());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'board' ? boardTable() : liveTable());
    if (state.tab === 'board') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (selected) {
      var keep = state.selected;
      state.selected = null;
      openDetail(keep);
    }
  }
  readHash();
  render();
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog.open) dialog.close(); });
})();
