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
        document.documentElement.style.setProperty('--bg-img', 'url("' + p.image + '")');
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
      linkPreview(l.url, els.hero);
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
        var cover = p.images && p.images.length ? p.images[0] : '';
        html += '<a class="project-card" href="project.html?id=' + encodeURIComponent(p.id) + '">' +
          '<div class="thumb">' + (cover ? '<img src="' + esc(cover) + '" alt="' + esc(p.title) + '" loading="lazy">' : '') + '</div>' +
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

  /* ---------- Videos grid ---------- */
  // returns an embeddable player URL for known platforms, or null
  function videoEmbedUrl(url) {
    var m = String(url || '').match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
    if (m) return 'https://www.youtube.com/embed/' + m[1] + '?autoplay=1';
    m = String(url || '').match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (m) return 'https://player.vimeo.com/video/' + m[1] + '?autoplay=1';
    return null;
  }

  function closeVideoLightbox(lb) {
    lb.classList.remove('open');
    lb.innerHTML = ''; // removing the iframe/video stops playback
  }

  function renderVideos(el) {
    getJSON('data/videos.json').then(function (videos) {
      if (!videos.length) {
        el.innerHTML = '<p class="empty-note">No videos yet &mdash; check back soon.</p>';
        return;
      }
      var html = '';
      videos.slice().reverse().forEach(function (v) {
        var isFile = v.type === 'file';
        var embed = isFile ? null : videoEmbedUrl(v.url);
        var href = isFile ? v.src : v.url;
        var host = isFile ? 'video' : hostOf(v.url);
        html += '<a class="video-card" href="' + esc(href) + '"' +
          (!isFile && !embed ? ' target="_blank" rel="noopener"' : '') +
          ' data-embed="' + esc(embed || '') + '" data-file="' + (isFile ? esc(v.src) : '') + '">' +
          '<div class="vthumb">' +
          (v.thumb ? '<img src="' + esc(v.thumb) + '" alt="' + esc(v.title) + '" loading="lazy">' : '') +
          '<span class="play-badge">&#9654;</span></div>' +
          '<div class="meta"><h3>' + esc(v.title) + '</h3>' +
          (v.date ? '<div class="date">' + esc(v.date) + '</div>' : '') +
          '<div class="count">' + esc(host) + '</div></div></a>';
      });
      el.innerHTML = html;

      var lb = document.getElementById('lightbox');
      el.querySelectorAll('.video-card').forEach(function (card) {
        card.addEventListener('click', function (e) {
          var file = card.getAttribute('data-file');
          var embed = card.getAttribute('data-embed');
          if (!file && !embed) return; // unknown platform: follow the link in a new tab
          e.preventDefault();
          if (!lb) return;
          lb.innerHTML = '<div class="video-shell">' + (file
            ? '<video controls autoplay playsinline src="' + esc(file) + '"></video>'
            : '<iframe src="' + esc(embed) + '" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>') +
            '</div>';
          lb.classList.add('open');
        });
      });
      if (lb) {
        lb.addEventListener('click', function (e) {
          if (e.target === lb) closeVideoLightbox(lb);
        });
        document.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') closeVideoLightbox(lb);
        });
      }
    }).catch(function () {
      el.innerHTML = '<p class="empty-note">Could not load videos.</p>';
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
        html += '<figure class="zoom-frame" data-full="' + esc(src) + '">' +
          '<img src="' + esc(src) + '" alt="' + esc(p.title) + ' — image ' + (i + 1) + '" loading="lazy"></figure>';
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

  return { applyTheme: applyTheme, spotlight: spotlight, renderLinks: renderLinks, renderLink: renderLink, renderProjects: renderProjects, renderProject: renderProject, renderVideos: renderVideos };
})();
