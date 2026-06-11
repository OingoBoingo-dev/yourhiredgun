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

  /* ---------- Art Links page ---------- */
  function renderLinks(el) {
    getJSON('data/links.json').then(function (links) {
      if (!links.length) {
        el.innerHTML = '<p class="empty-note">No links yet.</p>';
        return;
      }
      // group by date, newest group last-added first
      var groups = {}, order = [];
      links.forEach(function (l) {
        var d = l.date || '';
        if (!groups[d]) { groups[d] = []; order.push(d); }
        groups[d].push(l);
      });
      var html = '';
      order.reverse().forEach(function (d) {
        if (d) html += '<h3 class="link-group-date">' + esc(d) + '</h3>';
        html += '<ul class="link-list">';
        groups[d].forEach(function (l) {
          html += '<li><a href="' + esc(l.url) + '" target="_blank" rel="noopener">' +
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

  return { renderLinks: renderLinks, renderProjects: renderProjects, renderProject: renderProject, renderVideos: renderVideos };
})();
