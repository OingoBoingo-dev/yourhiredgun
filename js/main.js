/* Shared rendering for public pages (Art Links / Projects) */

var YHG = (function () {

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch (e) { return ''; }
  }

  function getJSON(path) {
    // cache-bust so new uploads show up right after a rebuild
    return fetch(path + '?v=' + Date.now()).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  }

  /* ---------- Theme (admin-managed background + font) ---------- */
  function applyTheme(page) {
    return getJSON('data/theme.json').then(function (t) {
      if (t.font && t.font.gf) {
        var l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = 'https://fonts.googleapis.com/css2?family=' + t.font.gf + '&display=swap';
        document.head.appendChild(l);
      }
      if (t.font && t.font.stack) {
        document.documentElement.style.setProperty('--mono', t.font.stack);
      }
      var p = page && t.pages && t.pages[page];
      if (p && p.image) {
        // root-absolute path: browsers resolve url() in CSS variables against
        // the stylesheet folder, not the page, so relative paths 404
        var img = /^(https?:)?\//.test(p.image) ? p.image : '/' + p.image;
        document.documentElement.style.setProperty('--bg-img', 'url("' + img + '")');
        document.documentElement.style.setProperty('--bg-pos', p.position || 'center');
      }
    }).catch(function () { /* no theme.json yet — CSS defaults apply */ });
  }

  /* ---------- Spotlight blob (landing, section pages, admin preview) ----------
     root = the .m1 mask wrapper; box (optional) = a container the blob should
     live in instead of the whole viewport (used by the admin preview). */
  function spotlight(root, box) {
    if (!root) return;
    var useBox = !!box;
    function size() {
      if (!useBox) return { w: window.innerWidth, h: window.innerHeight };
      var r = box.getBoundingClientRect();
      return { w: r.width || 320, h: r.height || 180 };
    }
    var s0 = size();
    var tx = s0.w / 2, ty = s0.h / 2, x = tx, y = ty;
    var hasMouse = useBox ? false : window.matchMedia('(pointer: fine)').matches;
    var wander = 0;

    (useBox ? box : document).addEventListener('mousemove', function (e) {
      if (useBox) {
        var r = box.getBoundingClientRect();
        tx = e.clientX - r.left; ty = e.clientY - r.top;
      } else { tx = e.clientX; ty = e.clientY; }
      hasMouse = true;
    });
    if (useBox) {
      box.addEventListener('mouseleave', function () { hasMouse = false; });
    } else {
      document.addEventListener('touchmove', function (e) {
        if (e.touches.length) { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }
      }, { passive: true });
    }

    // each lobe of the blob drifts and breathes on its own rhythm
    var lobes = [
      { fx: 0.9, fy: 1.3, px: 0.0, py: 2.1, fr: 0.7, pr: 0.5 },
      { fx: 1.4, fy: 0.8, px: 4.2, py: 0.7, fr: 1.1, pr: 2.6 },
      { fx: 0.6, fy: 1.1, px: 2.4, py: 5.0, fr: 0.9, pr: 4.1 }
    ];

    function frame(now) {
      var t = now / 1000;
      var d = size();
      if (!hasMouse) {
        // no pointer: the spotlight slowly wanders the painting
        wander += 0.004;
        tx = d.w * (0.5 + 0.38 * Math.sin(wander));
        ty = d.h * (0.5 + 0.30 * Math.sin(wander * 0.7 + 1.3));
      }
      x += (tx - x) * 0.12;
      y += (ty - y) * 0.12;

      var R = Math.max(useBox ? 40 : 160, d.w * 0.115);
      var amp = R * 0.32;

      lobes.forEach(function (l, i) {
        var n = i + 1;
        root.style.setProperty('--x' + n, (x + amp * Math.sin(t * l.fx + l.px)) + 'px');
        root.style.setProperty('--y' + n, (y + amp * Math.cos(t * l.fy + l.py)) + 'px');
        root.style.setProperty('--r' + n, (R * (1 + 0.22 * Math.sin(t * l.fr + l.pr))) + 'px');
      });
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ---------- Art Links page ---------- */
  function renderLinks(el) {
    getJSON('data/links.json').then(function (links) {
      if (!links.length) {
        el.innerHTML = '<p class="empty-note">No links yet.</p>';
        return;
      }
      // group by date, newest group last-added first
      var groups = {}, order = [];
      links.forEach(function (l, i) {
        if ((l.hide || []).indexOf('links') !== -1) return; // blocked from this page
        var d = l.date || '';
        if (!groups[d]) { groups[d] = []; order.push(d); }
        groups[d].push({ l: l, i: i });
      });
      var html = '';
      order.reverse().forEach(function (d) {
        if (d) html += '<h3 class="link-group-date">' + esc(d) + '</h3>';
        html += '<ul class="link-list">';
        groups[d].forEach(function (g) {
          var l = g.l;
          html += '<li><a href="link.html?i=' + g.i + '">' +
            '<span class="link-title">' + esc(l.title) + '</span>' +
            '<span class="link-host">' + esc(hostOf(l.url)) + '</span></a>' +
            (l.note ? '<span class="link-note">' + esc(l.note) + '</span>' : '') +
            '</li>';
        });
        html += '</ul>';
      });
      el.innerHTML = html;
    }).catch(function () {
      el.innerHTML = '<p class="empty-note">Could not load links.</p>';
    });
  }

  /* ---------- Single link landing page ---------- */
  // Preview image comes from the linked site itself: its og:image via
  // microlink (CORS-friendly), falling back to a live page screenshot.
  function linkPreview(url, heroEl) {
    var img = document.createElement('img');
    img.alt = 'Preview of ' + hostOf(url);
    img.loading = 'lazy';
    var triedFallback = false;
    img.onerror = function () {
      if (!triedFallback) {
        triedFallback = true;
        img.src = 'https://image.thum.io/get/width/1200/' + url;
      } else {
        heroEl.style.display = 'none';
      }
    };
    fetch('https://api.microlink.io/?url=' + encodeURIComponent(url))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var d = j && j.data;
        var src = d && ((d.image && d.image.url) || (d.logo && d.logo.url));
        if (src) img.src = src; else img.onerror();
      })
      .catch(function () { img.onerror(); });
    var a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    a.appendChild(img);
    heroEl.appendChild(a);
  }

  // attached upload (image / audio / video) shown in the hero slot
  function renderLinkMedia(m, heroEl) {
    function abs(p) { return /^(https?:)?\//.test(p) ? p : '/' + p; }
    var html;
    if (m.kind === 'image') {
      html = '<img src="' + esc(abs(m.src)) + '" alt="' + esc(m.filename || '') + '" loading="lazy">';
    } else if (m.kind === 'audio') {
      html = '<audio controls preload="metadata" src="' + esc(abs(m.src)) + '"></audio>';
    } else if (m.kind === 'video') {
      html = '<video controls playsinline preload="metadata"' +
        (m.thumb ? ' poster="' + esc(abs(m.thumb)) + '"' : '') +
        ' src="' + esc(abs(m.src)) + '"></video>';
    } else { heroEl.style.display = 'none'; return; }
    heroEl.innerHTML = html;
  }

  function renderLink(els) {
    var i = parseInt(new URLSearchParams(location.search).get('i'), 10);
    getJSON('data/links.json').then(function (links) {
      var l = links[i];
      if (!l) {
        els.title.textContent = 'Not found';
        els.host.textContent = 'This link doesn’t exist (yet).';
        els.visit.style.display = 'none';
        els.hero.style.display = 'none';
        return;
      }
      document.title = l.title + ' — Your Hired Gun';
      els.title.textContent = l.title;
      els.host.textContent = hostOf(l.url);
      els.note.textContent = l.note || '';
      if (!l.note) els.note.style.display = 'none';
      els.visit.href = l.url;
      if (l.media && l.media.src) {
        renderLinkMedia(l.media, els.hero);
      } else {
        linkPreview(l.url, els.hero);
      }
      var sup = l.links || [];
      if (sup.length) {
        var html = '<h3 class="link-group-date">Supporting links</h3><ul class="link-list">';
        sup.forEach(function (s) {
          html += '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' +
            '<span class="link-title">' + esc(s.title || s.url) + '</span>' +
            '<span class="link-host">' + esc(hostOf(s.url)) + '</span></a></li>';
        });
        els.support.innerHTML = html + '</ul>';
      }
    }).catch(function () {
      els.title.textContent = 'Could not load link.';
    });
  }

  /* ---------- Projects grid ---------- */
  function renderProjects(el) {
    getJSON('data/projects.json').then(function (projects) {
      if (!projects.length) {
        el.innerHTML = '<p class="empty-note">No projects yet &mdash; check back soon.</p>';
        return;
      }
      var html = '';
      projects.slice().reverse().forEach(function (p) {
        if ((p.hide || []).indexOf('projects') !== -1) return; // blocked from this page
        var cover = p.images && p.images.length ? p.images[0] : '';
        var coverName = p.names && p.names[cover];
        html += '<a class="project-card" href="project.html?id=' + encodeURIComponent(p.id) + '">' +
          '<div class="thumb">' + (cover ? '<img src="' + esc(cover) + '" alt="' + esc(p.title) + '" loading="lazy">' +
            (coverName ? '<div class="file-cap">' + esc(coverName) + '</div>' : '') : '') + '</div>' +
          '<div class="meta"><h3>' + esc(p.title) + '</h3>' +
          (p.date ? '<div class="date">' + esc(p.date) + '</div>' : '') +
          '<div class="count">' + (p.images ? p.images.length : 0) + ' image' + ((p.images || []).length === 1 ? '' : 's') +
          (p.interactive ? ' &middot; interactive' : '') + '</div>' +
          '</div></a>';
      });
      el.innerHTML = html;
    }).catch(function () {
      el.innerHTML = '<p class="empty-note">Could not load projects.</p>';
    });
  }

  /* ---------- Videos / Music grids (shared) ----------
     Both are a grid of cards that open an inline lightbox player; only the
     embed resolver and the player markup differ, so they share renderMediaGrid. */

  // returns an embeddable player URL for known platforms, or null
  function videoEmbedUrl(url) {
    var m = String(url || '').match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
    if (m) return 'https://www.youtube.com/embed/' + m[1] + '?autoplay=1';
    m = String(url || '').match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (m) return 'https://player.vimeo.com/video/' + m[1] + '?autoplay=1';
    return null;
  }

  // returns { src, kind } for an embeddable player, or null (unknown -> open link)
  function musicEmbedUrl(url) {
    var s = String(url || '');
    var m = s.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
    if (m) return { src: 'https://www.youtube.com/embed/' + m[1] + '?autoplay=1', kind: 'video' };
    m = s.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]+)/);
    if (m) return { src: 'https://open.spotify.com/embed/' + m[1] + '/' + m[2] + '?utm_source=generator', kind: 'audio' };
    if (/soundcloud\.com\//.test(s)) return { src: 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(s) + '&auto_play=true&color=%23d9762b', kind: 'audio' };
    return null;
  }

  function closeLightbox(lb) {
    lb.classList.remove('open');
    lb.innerHTML = ''; // removing the iframe/video/audio stops playback
  }

  // background-click + Escape to close; wired once per lightbox element
  function wireLightbox(lb) {
    if (!lb || lb._wired) return;
    lb._wired = true;
    lb.addEventListener('click', function (e) { if (e.target === lb) closeLightbox(lb); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeLightbox(lb); });
  }

  // opts: { pageKey, cardClass, fileHost, emptyMsg, errMsg, inlineOf(item,isFile), player(item,isFile) }
  function renderMediaGrid(el, path, opts) {
    getJSON(path).then(function (rows) {
      if (!rows.length) { el.innerHTML = '<p class="empty-note">' + opts.emptyMsg + '</p>'; return; }
      var html = '';
      for (var i = rows.length - 1; i >= 0; i--) { // newest first
        var item = rows[i];
        if ((item.hide || []).indexOf(opts.pageKey) !== -1) continue; // blocked from this page
        var isFile = item.type === 'file';
        var inline = opts.inlineOf(item, isFile);
        var href = isFile ? (item.src || '') : (item.url || '');
        var host = isFile ? opts.fileHost : hostOf(item.url);
        html += '<a class="' + opts.cardClass + '" href="' + esc(href) + '"' +
          (!inline ? ' target="_blank" rel="noopener"' : '') +
          ' data-idx="' + i + '">' +
          '<div class="vthumb">' +
          (item.thumb ? '<img src="' + esc(item.thumb) + '" alt="' + esc(item.title) + '" loading="lazy">' : '') +
          (isFile && item.filename ? '<div class="file-cap">' + esc(item.filename) + '</div>' : '') +
          '<span class="play-badge">&#9654;</span></div>' +
          '<div class="meta"><h3>' + esc(item.title) + '</h3>' +
          (item.date ? '<div class="date">' + esc(item.date) + '</div>' : '') +
          '<div class="count">' + esc(host) + '</div></div></a>';
      }
      el.innerHTML = html;

      var lb = document.getElementById('lightbox');
      el.querySelectorAll('a[data-idx]').forEach(function (card) {
        card.addEventListener('click', function (e) {
          var item = rows[Number(card.getAttribute('data-idx'))];
          if (!item) return;
          var inner = opts.player(item, item.type === 'file');
          if (inner == null) return; // unknown platform: follow the link in a new tab
          e.preventDefault();
          if (!lb) return;
          lb.innerHTML = inner;
          lb.classList.add('open');
        });
      });
      wireLightbox(lb);
    }).catch(function () {
      el.innerHTML = '<p class="empty-note">' + opts.errMsg + '</p>';
    });
  }

  function renderVideos(el) {
    renderMediaGrid(el, 'data/videos.json', {
      pageKey: 'videos',
      cardClass: 'video-card',
      fileHost: 'video',
      emptyMsg: 'No videos yet &mdash; check back soon.',
      errMsg: 'Could not load videos.',
      inlineOf: function (item, isFile) { return isFile || !!videoEmbedUrl(item.url); },
      player: function (item, isFile) {
        var embed = isFile ? null : videoEmbedUrl(item.url);
        if (!isFile && !embed) return null;
        return '<div class="video-shell">' + (isFile
          ? '<video controls autoplay playsinline src="' + esc(item.src) + '"></video>'
          : '<iframe src="' + esc(embed) + '" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>') +
          '</div>';
      }
    });
  }

  function renderMusic(el) {
    renderMediaGrid(el, 'data/music.json', {
      pageKey: 'music',
      cardClass: 'video-card music-card',
      fileHost: 'audio file',
      emptyMsg: 'No music yet &mdash; check back soon.',
      errMsg: 'Could not load music.',
      inlineOf: function (item, isFile) { return isFile || !!musicEmbedUrl(item.url) || !!item.embedHtml; },
      player: function (item, isFile) {
        var emb = isFile ? null : musicEmbedUrl(item.url);
        if (!isFile && !emb && !item.embedHtml) return null;
        if (isFile) return '<div class="music-shell file">' +
          (item.thumb ? '<img class="music-cover" src="' + esc(item.thumb) + '" alt="">' : '') +
          '<div class="music-title">' + esc(item.title) + '</div>' +
          '<audio controls autoplay src="' + esc(item.src) + '"></audio></div>';
        if (emb) return '<div class="music-shell ' + emb.kind + '">' +
          '<iframe src="' + esc(emb.src) + '" allow="autoplay; encrypted-media; clipboard-write; fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>';
        return '<div class="music-shell raw">' + item.embedHtml + '</div>';
      }
    });
  }

  /* ---------- Combined feed ----------
     Aggregates every content source into one date-sorted stream. New sources
     just need an entry in data/feed.json plus (optionally) a branch in
     feedEntry() — everything else (sorting, blocking, cards) is generic. */

  var DEFAULT_FEED_SOURCES = [
    { key: 'projects', label: 'Project', file: 'data/projects.json', page: 'projects.html', enabled: true },
    { key: 'videos',   label: 'Video',   file: 'data/videos.json',   page: 'videos.html',   enabled: true },
    { key: 'music',    label: 'Music',   file: 'data/music.json',     page: 'music.html',     enabled: true },
    { key: 'links',    label: 'Link',    file: 'data/links.json',     page: 'about.html',     enabled: true }
  ];

  // dates are stored as MM/DD/YY — turn one into a sortable timestamp
  function feedDateVal(s) {
    var m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (!m) return 0;
    var y = +m[3]; if (y < 100) y += 2000;
    return new Date(y, (+m[1]) - 1, +m[2]).getTime();
  }

  // a stable identifier so admin can block / order an item across rebuilds
  function feedKey(srcKey, item, i) {
    var base = item.id || item.url || item.src || (item.title + '|' + (item.date || '') + '|' + i);
    return srcKey + '::' + base;
  }

  // normalize one raw record into a card-ready entry
  function feedEntry(src, item, i) {
    var e = {
      kind: src.key,
      label: src.label || src.key,
      title: item.title || '(untitled)',
      date: item.date || '',
      dateVal: feedDateVal(item.date),
      key: feedKey(src.key, item, i),
      hide: item.hide || [],
      thumb: '',
      sub: '',
      href: src.page || '#',
      external: false,
      play: false
    };
    if (src.key === 'projects') {
      e.thumb = (item.images && item.images.length) ? item.images[0] : '';
      e.href = 'project.html?id=' + encodeURIComponent(item.id);
      var n = (item.images || []).length;
      e.sub = n + ' image' + (n === 1 ? '' : 's') + (item.interactive ? ' · interactive' : '');
    } else if (src.key === 'videos') {
      e.thumb = item.thumb || '';
      e.sub = (item.type === 'file') ? 'video' : hostOf(item.url);
      e.href = 'videos.html';
      e.play = true;
    } else if (src.key === 'music') {
      e.thumb = item.thumb || '';
      e.sub = (item.type === 'file') ? 'audio file' : hostOf(item.url);
      e.href = 'music.html';
      e.play = true;
    } else if (src.key === 'links') {
      e.sub = hostOf(item.url);
      e.href = 'link.html?i=' + i;
    } else {
      // generic future source — best-effort thumbnail + open-in-place
      e.thumb = item.thumb || (item.images && item.images[0]) || '';
      e.sub = item.host || hostOf(item.url) || '';
      e.href = src.page || item.url || '#';
      e.external = /^https?:/.test(e.href);
    }
    return e;
  }

  function feedSort(entries, mode, order) {
    if (mode === 'manual' && order && order.length) {
      var idx = {};
      order.forEach(function (k, n) { idx[k] = n; });
      return entries.slice().sort(function (a, b) {
        var ia = (a.key in idx) ? idx[a.key] : Infinity;
        var ib = (b.key in idx) ? idx[b.key] : Infinity;
        if (ia !== ib) return ia - ib;
        return b.dateVal - a.dateVal; // leftovers: newest first
      });
    }
    var dir = (mode === 'oldest') ? 1 : -1;
    return entries.slice().sort(function (a, b) { return dir * (a.dateVal - b.dateVal); });
  }

  function feedCard(e) {
    var thumb = e.thumb
      ? '<img src="' + esc(e.thumb) + '" alt="' + esc(e.title) + '" loading="lazy">'
      : '<div class="post-noimg">' + esc(e.label) + '</div>';
    if (e.play) thumb += '<span class="play-badge">&#9654;</span>';
    thumb += '<span class="post-badge post-' + esc(e.kind) + '">' + esc(e.label) + '</span>';
    return '<a class="post-card" href="' + esc(e.href) + '"' +
      (e.external ? ' target="_blank" rel="noopener"' : '') +
      ' data-key="' + esc(e.key) + '">' +
      '<div class="post-thumb">' + thumb + '</div>' +
      '<div class="meta"><h3>' + esc(e.title) + '</h3>' +
      (e.date ? '<div class="date">' + esc(e.date) + '</div>' : '') +
      '<div class="count">' + esc(e.sub || '') + '</div>' +
      '</div></a>';
  }

  function renderFeed(el, opts) {
    opts = opts || {};
    getJSON('data/feed.json').catch(function () { return {}; }).then(function (cfg) {
      cfg = cfg || {};
      if (opts.titleEl && cfg.title) opts.titleEl.textContent = cfg.title;
      if (opts.introEl && cfg.intro != null) opts.introEl.textContent = cfg.intro;
      var sources = (cfg.sources && cfg.sources.length ? cfg.sources : DEFAULT_FEED_SOURCES)
        .filter(function (s) { return s.enabled !== false; });
      return Promise.all(sources.map(function (s) {
        return getJSON(s.file)
          .then(function (rows) { return { s: s, rows: rows || [] }; })
          .catch(function () { return { s: s, rows: [] }; });
      })).then(function (sets) {
        var entries = [];
        sets.forEach(function (set) {
          set.rows.forEach(function (item, i) {
            var e = feedEntry(set.s, item, i);
            if ((e.hide || []).indexOf('feed') !== -1) return; // blocked from the feed
            entries.push(e);
          });
        });
        entries = feedSort(entries, cfg.sort || 'newest', cfg.order);
        el.innerHTML = entries.length
          ? entries.map(feedCard).join('')
          : '<p class="empty-note">Nothing here yet.</p>';
      });
    }).catch(function () {
      el.innerHTML = '<p class="empty-note">Could not load the feed.</p>';
    });
  }

  /* ---------- Single project page ---------- */
  function renderProject(titleEl, descEl, stackEl) {
    var id = new URLSearchParams(location.search).get('id');
    getJSON('data/projects.json').then(function (projects) {
      var p = projects.find(function (x) { return x.id === id; });
      if (!p) {
        titleEl.textContent = 'Not found';
        stackEl.innerHTML = '<p class="empty-note">This project doesn’t exist (yet).</p>';
        return;
      }
      document.title = p.title + ' — Your Hired Gun';
      titleEl.textContent = p.title;
      descEl.textContent = p.description || '';
      if (p.interactive) {
        descEl.insertAdjacentHTML('afterend',
          '<p class="interactive-cta"><a class="btn" href="' + esc(p.interactive) +
          '" target="_blank" rel="noopener">Open interactive version &nearr;</a></p>');
      }
      var html = '';
      (p.images || []).forEach(function (src, i) {
        var nm = p.names && p.names[src];
        html += '<figure class="zoom-frame" data-full="' + esc(src) + '">' +
          '<img src="' + esc(src) + '" alt="' + esc(p.title) + ' — image ' + (i + 1) + '" loading="lazy">' +
          (nm ? '<div class="file-cap">' + esc(nm) + '</div>' : '') + '</figure>';
      });
      stackEl.innerHTML = html;
      attachZoom(stackEl);
    });
  }

  /* hover-zoom follows the cursor; click opens lightbox */
  function attachZoom(scope) {
    var lb = document.getElementById('lightbox');
    var lbImg = lb ? lb.querySelector('img') : null;
    scope.querySelectorAll('.zoom-frame').forEach(function (f) {
      f.addEventListener('mousemove', function (e) {
        var r = f.getBoundingClientRect();
        f.querySelector('img').style.setProperty('--zx', ((e.clientX - r.left) / r.width * 100) + '%');
        f.querySelector('img').style.setProperty('--zy', ((e.clientY - r.top) / r.height * 100) + '%');
      });
      f.addEventListener('click', function () {
        if (!lb) return;
        lbImg.src = f.getAttribute('data-full');
        lb.classList.add('open');
      });
    });
    if (lb) {
      lb.addEventListener('click', function () { lb.classList.remove('open'); lbImg.src = ''; });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') lb.classList.remove('open');
      });
    }
  }

  return { applyTheme: applyTheme, spotlight: spotlight, renderLinks: renderLinks, renderLink: renderLink, renderProjects: renderProjects, renderProject: renderProject, renderVideos: renderVideos, renderMusic: renderMusic, renderFeed: renderFeed, musicEmbedUrl: musicEmbedUrl,
    // shared helpers reused by admin.js (admin.html loads main.js first; keep in sync)
    esc: esc, hostOf: hostOf, feedDateVal: feedDateVal, feedKey: feedKey, DEFAULT_FEED_SOURCES: DEFAULT_FEED_SOURCES };
})();
