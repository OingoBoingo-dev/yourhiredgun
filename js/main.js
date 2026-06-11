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
          '<div class="count">' + (p.images ? p.images.length : 0) + ' image' + ((p.images || []).length === 1 ? '' : 's') + '</div>' +
          '</div></a>';
      });
      el.innerHTML = html;
    }).catch(function () {
      el.innerHTML = '<p class="empty-note">Could not load projects.</p>';
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

  return { renderLinks: renderLinks, renderProjects: renderProjects, renderProject: renderProject };
})();
