/* ============================================================
   ADMIN — edits the live site by committing to the GitHub repo.
   The password unlocks this screen; the GitHub token (yours
   alone) is what actually authorizes changes.
   ============================================================ */

(function () {
  'use strict';

  // sha-256 of the admin password
  var PASS_HASH = 'eb624dbe56eb6620ae62080c10a273cab73ae8eca98ab17b731446a31c79393a';

  var $ = function (id) { return document.getElementById(id); };
  var enc = new TextEncoder();

  function sha256(str) {
    return crypto.subtle.digest('SHA-256', enc.encode(str)).then(function (buf) {
      return Array.from(new Uint8Array(buf)).map(function (b) {
        return b.toString(16).padStart(2, '0');
      }).join('');
    });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------------- status bar ---------------- */
  function status(msg, kind) {
    var el = $('statusMsg');
    el.textContent = msg;
    el.className = 'status-msg show ' + (kind || 'busy');
    if (kind === 'ok') setTimeout(function () { el.className = 'status-msg'; }, 6000);
  }

  /* ---------------- GitHub API ---------------- */
  function ghCfg() {
    return {
      owner: localStorage.getItem('gh_owner') || '',
      repo: localStorage.getItem('gh_repo') || '',
      branch: localStorage.getItem('gh_branch') || 'main',
      token: sessionStorage.getItem('gh_token') || localStorage.getItem('gh_token') || ''
    };
  }

  function ghUrl(path) {
    var c = ghCfg();
    return 'https://api.github.com/repos/' + c.owner + '/' + c.repo + '/contents/' + path;
  }

  function ghHeaders() {
    return {
      'Authorization': 'Bearer ' + ghCfg().token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }

  // get file -> { sha, json } (null if file missing)
  function ghGet(path) {
    return fetch(ghUrl(path) + '?ref=' + ghCfg().branch + '&t=' + Date.now(), { headers: ghHeaders() })
      .then(function (r) {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error('GitHub read failed (' + r.status + ')');
        return r.json();
      });
  }

  function b64EncodeUtf8(str) {
    return btoa(String.fromCharCode.apply(null, enc.encode(str)));
  }

  function b64DecodeUtf8(b64) {
    var bin = atob(b64.replace(/\n/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // create or update a file. contentB64 = base64 string
  function ghPut(path, contentB64, message, sha) {
    var body = { message: message, content: contentB64, branch: ghCfg().branch };
    if (sha) body.sha = sha;
    return fetch(ghUrl(path), {
      method: 'PUT', headers: ghHeaders(), body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (j) {
        throw new Error('GitHub write failed (' + r.status + '): ' + (j.message || ''));
      });
      return r.json();
    });
  }

  // create or replace a file regardless of whether it already exists
  function ghPutAuto(path, contentB64, message) {
    return ghGet(path).then(function (f) {
      return ghPut(path, contentB64, message, f && f.sha);
    });
  }

  function ghDelete(path, message) {
    return ghGet(path).then(function (f) {
      if (!f) return null;
      return fetch(ghUrl(path), {
        method: 'DELETE', headers: ghHeaders(),
        body: JSON.stringify({ message: message, sha: f.sha, branch: ghCfg().branch })
      });
    });
  }

  function readJsonFile(path) {
    return ghGet(path).then(function (f) {
      if (!f) return { sha: null, data: [] };
      return { sha: f.sha, data: JSON.parse(b64DecodeUtf8(f.content)) };
    });
  }

  function writeJsonFile(path, data, message, sha) {
    return ghPut(path, b64EncodeUtf8(JSON.stringify(data, null, 2)), message, sha);
  }

  /* ---------------- image helpers ---------------- */
  // downscale big images in the browser so the repo stays light
  function fileToB64(file) {
    return new Promise(function (resolve, reject) {
      var needsResize = file.size > 900 * 1024;
      if (!needsResize) {
        var fr = new FileReader();
        fr.onload = function () { resolve({ b64: fr.result.split(',')[1], ext: extOf(file.name) }); };
        fr.onerror = reject;
        fr.readAsDataURL(file);
        return;
      }
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 1800;
        var scale = Math.min(1, max / Math.max(img.width, img.height));
        var cv = document.createElement('canvas');
        cv.width = Math.round(img.width * scale);
        cv.height = Math.round(img.height * scale);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        resolve({ b64: cv.toDataURL('image/jpeg', 0.86).split(',')[1], ext: 'jpg' });
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  // read any file as base64, untouched (used for the interactive HTML page)
  function fileToB64Raw(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result.split(',')[1]); };
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  /* ---------------- PDF helpers ---------------- */
  // PDFs are split into one JPEG per page, in the browser, before upload.
  var PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';

  function isPdf(file) {
    return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  }

  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = PDFJS_CDN + 'pdf.min.js';
      s.onload = function () {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_CDN + 'pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      s.onerror = function () { reject(new Error('Could not load the PDF reader — check your connection and try again.')); };
      document.head.appendChild(s);
    });
  }

  // file (PDF) -> [{ b64, ext:'jpg' }], one per page
  function pdfToImages(file, onPage) {
    return loadPdfJs().then(function (pdfjsLib) {
      return file.arrayBuffer().then(function (buf) {
        return pdfjsLib.getDocument({ data: buf }).promise;
      });
    }).then(function (pdf) {
      var out = [];
      var chain = Promise.resolve();
      for (var n = 1; n <= pdf.numPages; n++) {
        (function (n) {
          chain = chain.then(function () {
            if (onPage) onPage(n, pdf.numPages);
            return pdf.getPage(n).then(function (page) {
              var vp1 = page.getViewport({ scale: 1 });
              // aim for ~1800px on the long side; cap upscaling at 3x
              var scale = Math.min(3, 1800 / Math.max(vp1.width, vp1.height));
              var vp = page.getViewport({ scale: scale });
              var cv = document.createElement('canvas');
              cv.width = Math.round(vp.width);
              cv.height = Math.round(vp.height);
              return page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise.then(function () {
                out.push({ b64: cv.toDataURL('image/jpeg', 0.86).split(',')[1], ext: 'jpg' });
                cv.width = cv.height = 0; // free memory
              });
            });
          });
        })(n);
      }
      return chain.then(function () { return out; });
    });
  }

  /* ---------------- video helpers ---------------- */
  // single-file uploads (MP4s, interactive HTML) go through the GitHub API
  // as one base64 commit — keep them modest so commits stay reliable
  var MAX_FILE_MB = 25;

  function tooBig(file) {
    if (file && file.size > MAX_FILE_MB * 1024 * 1024) {
      status('“' + file.name + '” is ' + (file.size / 1048576).toFixed(1) +
        ' MB — the limit is ' + MAX_FILE_MB + ' MB. For video, upload it to YouTube (unlisted works) and add it by URL instead.', 'err');
      return true;
    }
    return false;
  }

  function ytIdOf(url) {
    var m = String(url || '').match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
    return m ? m[1] : null;
  }

  // oEmbed lookup via noembed.com (CORS-friendly) — title + thumbnail for most platforms
  function fetchOembed(url) {
    return fetch('https://noembed.com/embed?url=' + encodeURIComponent(url))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return (j && !j.error) ? j : null; })
      .catch(function () { return null; });
  }

  // merge two oEmbed-ish results, preferring fields already present in `a`
  function mergeMeta(a, b) {
    a = a || {}; b = b || {};
    return {
      title: a.title || b.title || '',
      thumbnail_url: a.thumbnail_url || b.thumbnail_url || '',
      html: a.html || b.html || ''
    };
  }

  // reads a page's og:title / og:image via microlink (CORS-friendly) — the
  // reliable last-resort for sites noembed can't resolve (e.g. Bandcamp).
  function microlinkMeta(url) {
    return fetch('https://api.microlink.io/?url=' + encodeURIComponent(url))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var d = j && j.data;
        if (!d) return null;
        return {
          title: d.title || '',
          thumbnail_url: (d.image && d.image.url) || (d.logo && d.logo.url) || '',
          html: ''
        };
      })
      .catch(function () { return null; });
  }

  // music metadata: noembed first (YouTube/SoundCloud/Bandcamp), then Spotify's
  // own oEmbed, then microlink's og:image/title — so a flaky/unsupported lookup
  // never leaves us with a blank thumbnail and a URL-slug title.
  function fetchMusicMeta(url) {
    return fetchOembed(url).then(function (info) {
      if (info && info.thumbnail_url && info.title) return info;
      var spotify = /open\.spotify\.com\//.test(url);
      var next = spotify
        ? fetch('https://open.spotify.com/oembed?url=' + encodeURIComponent(url))
            .then(function (r) { return r.ok ? r.json() : null; })
            .catch(function () { return null; })
        : Promise.resolve(null);
      return next.then(function (sp) {
        var merged = mergeMeta(info, sp);
        if (merged.thumbnail_url && merged.title) return merged;
        return microlinkMeta(url).then(function (ml) { return mergeMeta(merged, ml); });
      });
    });
  }

  // grab a thumbnail from ~1s into an MP4, as base64 jpeg (null if it fails)
  function captureVideoThumb(file) {
    return new Promise(function (resolve) {
      var v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      var url = URL.createObjectURL(file);
      var done = false;
      function finish(b64) { if (done) return; done = true; URL.revokeObjectURL(url); resolve(b64); }
      setTimeout(function () { finish(null); }, 15000);
      v.onloadeddata = function () {
        try { v.currentTime = Math.min(1, (v.duration || 2) / 2); } catch (e) { finish(null); }
      };
      v.onseeked = function () {
        try {
          var scale = Math.min(1, 1280 / (v.videoWidth || 1280));
          var cv = document.createElement('canvas');
          cv.width = Math.round(v.videoWidth * scale);
          cv.height = Math.round(v.videoHeight * scale);
          cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
          finish(cv.toDataURL('image/jpeg', 0.84).split(',')[1]);
        } catch (e) { finish(null); }
      };
      v.onerror = function () { finish(null); };
      v.src = url;
    });
  }

  function extOf(name) {
    var m = name.toLowerCase().match(/\.(jpe?g|png|gif|webp)$/);
    return m ? (m[1] === 'jpeg' ? 'jpg' : m[1]) : 'jpg';
  }

  function slugify(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
  }

  function today() {
    var d = new Date();
    return String(d.getMonth() + 1).padStart(2, '0') + '/' +
           String(d.getDate()).padStart(2, '0') + '/' +
           String(d.getFullYear()).slice(2);
  }

  /* ---------------- upload preview (shows each file's name, bottom-left) ---------------- */
  // short type glyph for non-image files; null means "render an image thumbnail"
  function fileGlyph(file) {
    var t = (file.type || '') + ' ' + file.name.toLowerCase();
    if (/^image\//.test(file.type) || /\.(jpe?g|png|gif|webp|bmp|svg)$/.test(t)) return null;
    if (/audio|\.(mp3|wav|m4a|ogg|oga|flac|aac)$/.test(t)) return '♪';      // music note
    if (/video|\.(mp4|mov|webm|mkv|avi)$/.test(t)) return '▶';              // play
    if (/pdf|\.pdf$/.test(t)) return 'PDF';
    if (/\.(html?|htm)$/.test(t)) return '</>';
    if (/\.pptx?$/.test(t) || /presentation/.test(t)) return 'PPT';
    if (/\.docx?$/.test(t) || /wordprocessing/.test(t)) return 'DOC';
    if (/\.xlsx?$/.test(t) || /spreadsheet/.test(t)) return 'XLS';
    return 'FILE';
  }

  // render selected files into a .thumb-preview container, each with its filename caption
  function filePreview(container, files) {
    if (!container) return;
    container.innerHTML = '';
    Array.from(files || []).forEach(function (file) {
      var item = document.createElement('div');
      item.className = 'up-item';
      item.title = file.name;
      var glyph = fileGlyph(file);
      if (glyph === null) {
        var img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        item.appendChild(img);
      } else {
        item.classList.add('file');
        var g = document.createElement('span');
        g.className = 'glyph';
        g.textContent = glyph;
        item.appendChild(g);
      }
      var cap = document.createElement('div');
      cap.className = 'file-cap';
      cap.textContent = file.name;
      item.appendChild(cap);
      container.appendChild(item);
    });
  }

  /* ================= LOGIN ================= */
  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    sha256($('pw').value).then(function (h) {
      if (h !== PASS_HASH) { status('Wrong password.', 'err'); return; }
      // save GitHub settings
      localStorage.setItem('gh_owner', $('ghOwner').value.trim());
      localStorage.setItem('gh_repo', $('ghRepo').value.trim());
      localStorage.setItem('gh_branch', $('ghBranch').value.trim() || 'main');
      var tok = $('ghToken').value.trim();
      if (tok) {
        if ($('rememberToken').checked) localStorage.setItem('gh_token', tok);
        else { sessionStorage.setItem('gh_token', tok); localStorage.removeItem('gh_token'); }
      }
      var c = ghCfg();
      if (!c.owner || !c.repo || !c.token) {
        status('Fill in GitHub username, repo and token — they’re required for saving changes.', 'err');
        return;
      }
      // verify token works
      status('Checking GitHub access…', 'busy');
      ghGet('data/links.json').then(function () {
        $('loginView').style.display = 'none';
        $('panelView').style.display = 'block';
        status('Connected to ' + c.owner + '/' + c.repo + '.', 'ok');
        loadLists();
        thInit();
      }).catch(function (err) {
        status('Could not reach the repo: ' + err.message + ' — check the settings below.', 'err');
      });
    });
  });

  // prefill saved settings
  $('ghOwner').value = localStorage.getItem('gh_owner') || '';
  $('ghRepo').value = localStorage.getItem('gh_repo') || '';
  $('ghBranch').value = localStorage.getItem('gh_branch') || 'main';
  if (localStorage.getItem('gh_token')) {
    $('ghToken').placeholder = '•••••••• (saved on this browser)';
    $('rememberToken').checked = true;
  }

  $('logoutBtn').addEventListener('click', function () {
    sessionStorage.removeItem('gh_token');
    location.reload();
  });

  /* ================= TABS ================= */
  document.querySelectorAll('.admin-tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.admin-tabs button').forEach(function (x) { x.classList.remove('active'); });
      document.querySelectorAll('.admin-section').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      $(b.getAttribute('data-tab')).classList.add('active');
    });
  });

  /* ================= LISTS ================= */
  var cache = { links: [], projects: [], videos: [], music: [] };

  function loadLists() {
    readJsonFile('data/links.json').then(function (f) {
      cache.links = f.data;
      var html = '';
      f.data.forEach(function (l, i) {
        html += '<li><div class="item-row"><span class="item-title">' + esc(l.title) +
          ' <span class="item-sub">' + esc(l.date || '') +
          ((l.links || []).length ? ' · ' + l.links.length + ' supporting' : '') + '</span></span>' +
          '<span class="item-btns">' +
          '<button class="btn mini" data-edit-link="' + i + '">Edit</button>' +
          '<button class="btn danger" data-del-link="' + i + '">Delete</button>' +
          '</span></div><div class="edit-slot"></div></li>';
      });
      $('linkList').innerHTML = html || '<li><span class="item-sub">No links yet.</span></li>';
    });
    readJsonFile('data/projects.json').then(function (f) {
      cache.projects = f.data;
      var html = '';
      f.data.forEach(function (p, i) {
        html += '<li><div class="item-row"><span class="item-title">' + esc(p.title) +
          ' <span class="item-sub">' + (p.images || []).length + ' images' +
          (p.interactive ? ' · interactive' : '') + '</span></span>' +
          '<span class="item-btns">' +
          '<button class="btn mini" data-edit-proj="' + i + '">Edit</button>' +
          '<button class="btn danger" data-del-proj="' + i + '">Delete</button>' +
          '</span></div><div class="edit-slot"></div></li>';
      });
      $('projList').innerHTML = html || '<li><span class="item-sub">No projects yet.</span></li>';
    });
    readJsonFile('data/videos.json').then(function (f) {
      cache.videos = f.data;
      var html = '';
      f.data.forEach(function (v, i) {
        html += '<li><div class="item-row"><span class="item-title">' + esc(v.title) +
          ' <span class="item-sub">' + (v.type === 'file' ? 'mp4' : esc(v.url || '').replace(/^https?:\/\/(www\.)?/, '').split('/')[0]) +
          ' · ' + esc(v.date || '') + '</span></span>' +
          '<span class="item-btns">' +
          '<button class="btn mini" data-edit-vid="' + i + '">Edit</button>' +
          '<button class="btn danger" data-del-vid="' + i + '">Delete</button>' +
          '</span></div><div class="edit-slot"></div></li>';
      });
      $('vidList').innerHTML = html || '<li><span class="item-sub">No videos yet.</span></li>';
    });
    readJsonFile('data/music.json').then(function (f) {
      cache.music = f.data;
      var html = '';
      f.data.forEach(function (m, i) {
        var where = m.type === 'file' ? 'audio file'
          : esc(m.url || '').replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
        html += '<li><div class="item-row"><span class="item-title">' + esc(m.title) +
          ' <span class="item-sub">' + where + ' · ' + esc(m.date || '') + '</span></span>' +
          '<span class="item-btns">' +
          '<button class="btn mini" data-edit-mus="' + i + '">Edit</button>' +
          '<button class="btn danger" data-del-mus="' + i + '">Delete</button>' +
          '</span></div><div class="edit-slot"></div></li>';
      });
      $('musList').innerHTML = html || '<li><span class="item-sub">No music yet.</span></li>';
    });
  }

  function closeEditSlots(listEl) {
    listEl.querySelectorAll('.edit-slot').forEach(function (s) { s.innerHTML = ''; });
  }

  /* ================= ADD LINK ================= */
  $('addLinkForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('addLinkBtn'); btn.disabled = true;
    status('Saving link…', 'busy');
    readJsonFile('data/links.json').then(function (f) {
      f.data.push({
        title: $('linkTitle').value.trim(),
        url: $('linkUrl').value.trim(),
        note: $('linkNote').value.trim(),
        date: today()
      });
      return writeJsonFile('data/links.json', f.data, 'Add link: ' + $('linkTitle').value.trim(), f.sha);
    }).then(function () {
      status('Link saved. It’ll be live in about a minute (GitHub Pages rebuild).', 'ok');
      $('addLinkForm').reset();
      loadLists();
    }).catch(function (err) { status(err.message, 'err'); })
      .finally(function () { btn.disabled = false; });
  });

  /* ================= DELETE LINK ================= */
  $('linkList').addEventListener('click', function (e) {
    var i = e.target.getAttribute('data-del-link');
    if (i === null) return;
    if (!confirm('Delete this link?')) return;
    status('Deleting…', 'busy');
    readJsonFile('data/links.json').then(function (f) {
      var removed = f.data.splice(Number(i), 1)[0];
      return writeJsonFile('data/links.json', f.data, 'Delete link: ' + (removed ? removed.title : ''), f.sha);
    }).then(function () { status('Deleted.', 'ok'); loadLists(); })
      .catch(function (err) { status(err.message, 'err'); });
  });

  /* ================= EDIT LINK ================= */
  function supRowHtml(s) {
    s = s || { title: '', url: '' };
    return '<div class="sup-row">' +
      '<input type="text" class="ef-sup-title" placeholder="Title" value="' + esc(s.title) + '">' +
      '<input type="url" class="ef-sup-url" placeholder="https://…" value="' + esc(s.url) + '">' +
      '<button class="btn danger" data-rm-sup type="button">&times;</button>' +
      '</div>';
  }

  $('linkList').addEventListener('click', function (e) {
    var t = e.target;
    if (t.hasAttribute('data-cancel-edit')) { closeEditSlots($('linkList')); return; }

    // supporting-links rows: add / remove
    if (t.hasAttribute('data-add-sup')) {
      t.insertAdjacentHTML('beforebegin', supRowHtml());
      return;
    }
    if (t.hasAttribute('data-rm-sup')) {
      t.closest('.sup-row').remove();
      return;
    }

    var ei = t.getAttribute('data-edit-link');
    if (ei !== null) {
      closeEditSlots($('linkList'));
      var l = cache.links[Number(ei)];
      if (!l) return;
      var supHtml = (l.links || []).map(supRowHtml).join('');
      t.closest('li').querySelector('.edit-slot').innerHTML =
        '<div class="edit-form">' +
        '<div class="field"><label>Title</label><input type="text" class="ef-title" value="' + esc(l.title) + '"></div>' +
        '<div class="field"><label>URL</label><input type="url" class="ef-url" value="' + esc(l.url) + '"></div>' +
        '<div class="field"><label>Note</label><input type="text" class="ef-note" value="' + esc(l.note || '') + '"></div>' +
        '<div class="field"><label>Supporting links (shown on the link’s page)</label>' +
        supHtml +
        '<button class="btn mini" data-add-sup type="button">+ Add supporting link</button></div>' +
        '<button class="btn primary" data-save-link="' + ei + '">Save changes</button> ' +
        '<button class="btn" data-cancel-edit>Cancel</button>' +
        '</div>';
      return;
    }

    var si = t.getAttribute('data-save-link');
    if (si === null) return;
    var form = t.closest('.edit-form');
    var title = form.querySelector('.ef-title').value.trim();
    var url = form.querySelector('.ef-url').value.trim();
    var note = form.querySelector('.ef-note').value.trim();
    if (!title || !url) { status('Title and URL can’t be empty.', 'err'); return; }
    var sup = [];
    form.querySelectorAll('.sup-row').forEach(function (row) {
      var su = row.querySelector('.ef-sup-url').value.trim();
      var st = row.querySelector('.ef-sup-title').value.trim();
      if (su) sup.push({ title: st || su, url: su });
    });
    t.disabled = true;
    status('Saving changes…', 'busy');
    readJsonFile('data/links.json').then(function (f) {
      var l2 = f.data[Number(si)];
      if (!l2) throw new Error('Link not found — reload and try again.');
      l2.title = title; l2.url = url; l2.note = note;
      if (sup.length) l2.links = sup; else delete l2.links;
      return writeJsonFile('data/links.json', f.data, 'Edit link: ' + title, f.sha);
    }).then(function () { status('Link updated. Live in about a minute.', 'ok'); loadLists(); })
      .catch(function (err) { status(err.message, 'err'); t.disabled = false; });
  });

  /* ================= THEME ================= */
  var TH_FONTS = [
    { name: 'Space Mono', stack: '"Space Mono", "Courier New", monospace', gf: 'Space+Mono:ital,wght@0,400;0,700;1,400' },
    { name: 'IBM Plex Mono', stack: '"IBM Plex Mono", monospace', gf: 'IBM+Plex+Mono:ital,wght@0,400;0,700;1,400' },
    { name: 'Courier Prime', stack: '"Courier Prime", "Courier New", monospace', gf: 'Courier+Prime:ital,wght@0,400;0,700;1,400' },
    { name: 'Special Elite (typewriter)', stack: '"Special Elite", "Courier New", monospace', gf: 'Special+Elite' },
    { name: 'EB Garamond (serif)', stack: '"EB Garamond", Georgia, serif', gf: 'EB+Garamond:ital,wght@0,400;0,700;1,400' },
    { name: 'Cormorant Garamond (serif)', stack: '"Cormorant Garamond", Georgia, serif', gf: 'Cormorant+Garamond:ital,wght@0,400;0,700;1,400' },
    { name: 'Syne (display)', stack: '"Syne", sans-serif', gf: 'Syne:wght@400;700' },
    { name: 'Work Sans (sans)', stack: '"Work Sans", sans-serif', gf: 'Work+Sans:ital,wght@0,400;0,700;1,400' },
    { name: 'Inter (sans)', stack: '"Inter", sans-serif', gf: 'Inter:ital,wght@0,400;0,700;1,400' },
    { name: 'Courier New (no download)', stack: '"Courier New", monospace', gf: null }
  ];
  var TH_DEFAULTS = {
    font: TH_FONTS[0],
    pages: {
      landing: { image: 'assets/traveller.jpg', position: 'center 18%' },
      links: { image: 'assets/traveller.jpg', position: 'center' },
      projects: { image: 'assets/traveller.jpg', position: 'center' },
      videos: { image: 'assets/videos-bg.jpg', position: 'center' },
      music: { image: 'assets/videos-bg.jpg', position: 'center' }
    }
  };
  var th = { data: null, pending: null, page: 'landing', inited: false };

  function thFont() { return TH_FONTS[Number($('thFont').value)] || TH_FONTS[0]; }
  function thCur() { return th.data.pages[th.page]; }

  // pull a Google Font into the admin page so the preview text can use it
  function thGFLoad(gf) {
    if (!gf) return;
    var id = 'gf' + gf.replace(/[^A-Za-z0-9]/g, '');
    if (document.getElementById(id)) return;
    var l = document.createElement('link');
    l.id = id; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=' + gf + '&display=swap';
    document.head.appendChild(l);
  }

  function thSetPos(v) {
    var sel = $('thPos');
    var has = Array.prototype.some.call(sel.options, function (o) { return o.value === v; });
    if (!has) {
      var o = document.createElement('option');
      o.value = v; o.textContent = 'Custom (current)';
      sel.appendChild(o);
    }
    sel.value = v;
  }

  function thPreview() {
    var src = th.pending || thCur().image;
    var pos = $('thPos').value;
    [$('thPrevColor'), $('thPrevGray')].forEach(function (el) {
      el.style.backgroundImage = 'url("' + src + '")';
      el.style.backgroundPosition = pos;
    });
    var f = thFont();
    thGFLoad(f.gf);
    $('thPrevText').style.fontFamily = f.stack;
    $('thImgNote').textContent = th.pending
      ? 'New image ready — press “Save theme” to publish it.'
      : 'Current: ' + (thCur().image || '').split('/').pop();
  }

  // draw src (a path or data URL) to a canvas, optionally turned 90°,
  // capped at 2000px on the long side; returns a JPEG data URL
  function thBake(src, rotate) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height;
        var ow = rotate ? h : w, oh = rotate ? w : h;
        var scale = Math.min(1, 2000 / Math.max(ow, oh));
        var cv = document.createElement('canvas');
        cv.width = Math.round(ow * scale);
        cv.height = Math.round(oh * scale);
        var cx = cv.getContext('2d');
        cx.translate(cv.width / 2, cv.height / 2);
        if (rotate) cx.rotate(Math.PI / 2);
        cx.scale(scale, scale);
        cx.drawImage(img, -w / 2, -h / 2);
        resolve(cv.toDataURL('image/jpeg', 0.88));
      };
      img.onerror = function () { reject(new Error('Could not load the image.')); };
      img.src = src;
    });
  }

  function thInit() {
    if (th.inited) return;
    th.inited = true;

    var sel = $('thFont');
    TH_FONTS.forEach(function (f, i) {
      var o = document.createElement('option');
      o.value = i; o.textContent = f.name;
      sel.appendChild(o);
    });

    ghGet('data/theme.json').then(function (f) {
      var t = null;
      if (f) { try { t = JSON.parse(b64DecodeUtf8(f.content)); } catch (e) { t = null; } }
      th.data = t || JSON.parse(JSON.stringify(TH_DEFAULTS));
      if (!th.data.pages) th.data.pages = JSON.parse(JSON.stringify(TH_DEFAULTS.pages));
      Object.keys(TH_DEFAULTS.pages).forEach(function (k) {
        if (!th.data.pages[k]) th.data.pages[k] = JSON.parse(JSON.stringify(TH_DEFAULTS.pages[k]));
      });
      var fi = -1;
      TH_FONTS.forEach(function (x, i) { if (th.data.font && x.name === th.data.font.name) fi = i; });
      sel.value = fi === -1 ? 0 : fi;
      thSetPos(thCur().position || 'center');
      thPreview();
      YHG.spotlight($('thPrevMask'), $('thPrev'));
    }).catch(function (err) { status(err.message, 'err'); });

    $('thPage').addEventListener('change', function () {
      th.page = $('thPage').value;
      th.pending = null;
      $('thImage').value = '';
      thSetPos(thCur().position || 'center');
      thPreview();
    });
    $('thPos').addEventListener('change', thPreview);
    $('thFont').addEventListener('change', thPreview);

    $('thImage').addEventListener('change', function () {
      var file = $('thImage').files[0];
      if (!file) return;
      var url = URL.createObjectURL(file);
      thBake(url, false).then(function (d) {
        URL.revokeObjectURL(url);
        th.pending = d;
        thPreview();
        $('thImgNote').textContent = file.name + ' — ready. Press “Save theme” to publish it.';
      }).catch(function (err) { status(err.message, 'err'); });
    });

    $('thRotate').addEventListener('click', function () {
      thBake(th.pending || thCur().image, true).then(function (d) {
        th.pending = d;
        thPreview();
      }).catch(function (err) { status(err.message, 'err'); });
    });

    $('thSave').addEventListener('click', function () {
      var btn = $('thSave');
      btn.disabled = true;
      status('Saving theme…', 'busy');
      var t = JSON.parse(JSON.stringify(th.data));
      t.font = thFont();
      t.pages[th.page].position = $('thPos').value;
      var chain = Promise.resolve();
      if (th.pending) {
        var path = 'images/site/bg-' + th.page + '-' + Date.now() + '.jpg';
        var old = t.pages[th.page].image;
        chain = ghPut(path, th.pending.split(',')[1], 'Theme: new ' + th.page + ' background').then(function () {
          t.pages[th.page].image = path;
          // tidy up the previous admin-uploaded background (never the original art)
          if (/^images\/site\//.test(old)) {
            return ghDelete(old, 'Theme: remove old ' + th.page + ' background').catch(function () {});
          }
        });
      }
      chain.then(function () {
        return ghGet('data/theme.json');
      }).then(function (f) {
        return ghPut('data/theme.json', b64EncodeUtf8(JSON.stringify(t, null, 2)), 'Theme update', f && f.sha);
      }).then(function () {
        th.data = t;
        th.pending = null;
        $('thImage').value = '';
        thPreview();
        status('Theme saved. Live in about a minute.', 'ok');
      }).catch(function (err) { status(err.message, 'err'); })
        .finally(function () { btn.disabled = false; });
    });
  }

  /* ================= EDIT PROJECT ================= */
  $('projList').addEventListener('click', function (e) {
    var t = e.target;
    if (t.hasAttribute('data-cancel-edit')) { closeEditSlots($('projList')); return; }

    // toggle an image's "remove" mark
    if (t.getAttribute('data-rm-img') !== null) {
      t.parentElement.classList.toggle('rm');
      return;
    }

    var ei = t.getAttribute('data-edit-proj');
    if (ei !== null) {
      closeEditSlots($('projList'));
      var p = cache.projects[Number(ei)];
      if (!p) return;
      var thumbs = (p.images || []).map(function (path) {
        return '<span class="edit-thumb"><img src="' + esc(path) + '" alt="">' +
          '<button type="button" data-rm-img="' + esc(path) + '" title="Mark for removal">&times;</button></span>';
      }).join('');
      t.closest('li').querySelector('.edit-slot').innerHTML =
        '<div class="edit-form">' +
        '<div class="field"><label>Title</label><input type="text" class="ef-title" value="' + esc(p.title) + '"></div>' +
        '<div class="field"><label>Description</label><textarea class="ef-desc">' + esc(p.description || '') + '</textarea></div>' +
        '<div class="field"><label>Images (click &times; to mark for removal)</label>' +
        '<div class="edit-imgs">' + thumbs + '</div></div>' +
        '<div class="field"><label>Add images or a PDF</label>' +
        '<input type="file" class="ef-add" accept="image/*,application/pdf,.pdf" multiple></div>' +
        '<div class="field"><label>Interactive page</label>' +
        (p.interactive
          ? '<div class="hint">Currently attached. Upload a new file to replace it, or tick <label style="display:inline"><input type="checkbox" class="ef-rm-int"> remove</label>.</div>'
          : '<div class="hint">None yet — upload a self-contained HTML file to add one.</div>') +
        '<input type="file" class="ef-int" accept=".html,.htm,text/html"></div>' +
        '<button class="btn primary" data-save-proj="' + ei + '">Save changes</button> ' +
        '<button class="btn" data-cancel-edit>Cancel</button>' +
        '</div>';
      return;
    }

    var si = t.getAttribute('data-save-proj');
    if (si === null) return;
    var p0 = cache.projects[Number(si)];
    if (!p0) return;
    var form = t.closest('.edit-form');
    var title = form.querySelector('.ef-title').value.trim();
    var desc = form.querySelector('.ef-desc').value.trim();
    var rmPaths = Array.from(form.querySelectorAll('.edit-thumb.rm button')).map(function (b) {
      return b.getAttribute('data-rm-img');
    });
    var addFiles = Array.from(form.querySelector('.ef-add').files);
    var intFile = form.querySelector('.ef-int').files[0];
    var rmIntEl = form.querySelector('.ef-rm-int');
    var rmInt = rmIntEl ? rmIntEl.checked : false;
    if (!title) { status('Title can’t be empty.', 'err'); return; }
    if (tooBig(intFile)) return;
    t.disabled = true;

    // convert any new files (PDFs expand to one image per page)
    var items = [];
    var addNames = [];
    var prep = Promise.resolve();
    addFiles.forEach(function (file) {
      prep = prep.then(function () {
        if (isPdf(file)) {
          status('Reading PDF…', 'busy');
          return pdfToImages(file, function (n, total) {
            status('Converting PDF page ' + n + ' of ' + total + '…', 'busy');
          }).then(function (pages) {
            pages.forEach(function (x, idx) {
              items.push(x);
              addNames.push(pages.length > 1 ? file.name + ' (p ' + (idx + 1) + ')' : file.name);
            });
          });
        }
        return fileToB64(file).then(function (r) { items.push(r); addNames.push(file.name); });
      });
    });

    var newPaths = [];
    prep.then(function () {
      if ((p0.images || []).length - rmPaths.length + items.length < 1) {
        throw new Error('A project needs at least one image.');
      }
      // continue numbering after the highest existing image
      var maxN = 0;
      (p0.images || []).forEach(function (path) {
        var m = path.match(/(\d+)\.\w+$/);
        if (m) maxN = Math.max(maxN, Number(m[1]));
      });
      var chain = Promise.resolve();
      items.forEach(function (it, i) {
        chain = chain.then(function () {
          status('Uploading image ' + (i + 1) + ' of ' + items.length + '…', 'busy');
          var path = 'images/projects/' + p0.id + '/' + String(maxN + i + 1).padStart(2, '0') + '.' + it.ext;
          newPaths.push(path);
          return ghPut(path, it.b64, 'Add image to project: ' + title);
        });
      });
      return chain;
    }).then(function () {
      if (!intFile) return null;
      status('Uploading interactive page…', 'busy');
      return fileToB64Raw(intFile).then(function (b64) {
        var path = 'images/projects/' + p0.id + '/interactive.html';
        return ghPutAuto(path, b64, 'Update interactive page: ' + title).then(function () { return path; });
      });
    }).then(function (intPath) {
      // delete images marked for removal (and the interactive page if requested)
      var chain = Promise.resolve();
      rmPaths.forEach(function (path) {
        chain = chain.then(function () {
          status('Removing image…', 'busy');
          return ghDelete(path, 'Remove image from project: ' + title);
        });
      });
      if (rmInt && !intFile && p0.interactive) {
        chain = chain.then(function () { return ghDelete(p0.interactive, 'Remove interactive page: ' + title); });
      }
      return chain.then(function () { return intPath; });
    }).then(function (intPath) {
      status('Saving project…', 'busy');
      return readJsonFile('data/projects.json').then(function (f) {
        var p2 = f.data.find(function (x) { return x.id === p0.id; });
        if (!p2) throw new Error('Project not found — reload and try again.');
        p2.title = title;
        p2.description = desc;
        p2.images = (p2.images || []).filter(function (x) { return rmPaths.indexOf(x) === -1; }).concat(newPaths);
        var nm = Object.assign({}, p2.names || {});
        rmPaths.forEach(function (x) { delete nm[x]; });
        newPaths.forEach(function (pth, i) { nm[pth] = addNames[i]; });
        if (Object.keys(nm).length) p2.names = nm; else delete p2.names;
        if (intPath) p2.interactive = intPath;
        else if (rmInt) delete p2.interactive;
        return writeJsonFile('data/projects.json', f.data, 'Edit project: ' + title, f.sha);
      });
    }).then(function () {
      status('Project updated. Live in about a minute.', 'ok');
      loadLists();
    }).catch(function (err) { status(err.message, 'err'); t.disabled = false; });
  });

  /* ================= VIDEOS ================= */
  $('addVidUrlForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var url = $('vidUrl').value.trim();
    var manual = $('vidUrlTitle').value.trim();
    var btn = $('addVidUrlBtn'); btn.disabled = true;
    status('Looking up video info…', 'busy');
    fetchOembed(url).then(function (info) {
      var yt = ytIdOf(url);
      var thumb = (info && info.thumbnail_url) || (yt ? 'https://i.ytimg.com/vi/' + yt + '/hqdefault.jpg' : '');
      var title = manual || (info && info.title) || url.replace(/^https?:\/\/(www\.)?/, '');
      status('Saving video…', 'busy');
      return readJsonFile('data/videos.json').then(function (f) {
        f.data.push({ type: 'embed', title: title, url: url, thumb: thumb, date: today() });
        return writeJsonFile('data/videos.json', f.data, 'Add video: ' + title, f.sha);
      }).then(function () {
        status(thumb
          ? 'Video saved. Live in about a minute.'
          : 'Video saved, but no thumbnail was found for this platform — the card will show a plain play button.', 'ok');
        $('addVidUrlForm').reset();
        loadLists();
      });
    }).catch(function (err) { status(err.message, 'err'); })
      .finally(function () { btn.disabled = false; });
  });

  $('addVidFileForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var file = $('vidFile').files[0];
    var title = $('vidFileTitle').value.trim();
    if (!file) { status('Choose an MP4 file.', 'err'); return; }
    if (tooBig(file)) return;
    var btn = $('addVidFileBtn'); btn.disabled = true;
    var slug = slugify(title) + '-' + Date.now().toString(36);
    status('Grabbing a thumbnail from the video…', 'busy');
    captureVideoThumb(file).then(function (thumbB64) {
      var thumbPath = '';
      var p = Promise.resolve();
      if (thumbB64) {
        thumbPath = 'images/videos/' + slug + '.jpg';
        p = p.then(function () { return ghPut(thumbPath, thumbB64, 'Add video thumbnail: ' + title); });
      }
      return p.then(function () {
        status('Uploading video (' + (file.size / 1048576).toFixed(1) + ' MB)… this can take a minute.', 'busy');
        return fileToB64Raw(file);
      }).then(function (b64) {
        var srcPath = 'videos/' + slug + '.mp4';
        return ghPut(srcPath, b64, 'Add video: ' + title).then(function () {
          status('Saving video…', 'busy');
          return readJsonFile('data/videos.json').then(function (f) {
            f.data.push({ type: 'file', title: title, src: srcPath, thumb: thumbPath, filename: file.name, date: today() });
            return writeJsonFile('data/videos.json', f.data, 'Add video: ' + title, f.sha);
          });
        });
      });
    }).then(function () {
      status('Video uploaded. Live in about a minute.', 'ok');
      $('addVidFileForm').reset();
      $('vidFilePreview').innerHTML = '';
      loadLists();
    }).catch(function (err) { status(err.message, 'err'); })
      .finally(function () { btn.disabled = false; });
  });

  /* ================= EDIT / DELETE VIDEO ================= */
  $('vidList').addEventListener('click', function (e) {
    var t = e.target;
    if (t.hasAttribute('data-cancel-edit')) { closeEditSlots($('vidList')); return; }

    var di = t.getAttribute('data-del-vid');
    if (di !== null) {
      if (!confirm('Delete this video?')) return;
      status('Deleting video…', 'busy');
      readJsonFile('data/videos.json').then(function (f) {
        var removed = f.data.splice(Number(di), 1)[0];
        return writeJsonFile('data/videos.json', f.data, 'Delete video: ' + (removed ? removed.title : ''), f.sha)
          .then(function () {
            var chain = Promise.resolve();
            ['src', 'thumb'].forEach(function (k) {
              var p = removed && removed[k];
              if (p && !/^https?:/i.test(p)) {
                chain = chain.then(function () { return ghDelete(p, 'Remove file for deleted video'); });
              }
            });
            return chain;
          });
      }).then(function () { status('Video deleted.', 'ok'); loadLists(); })
        .catch(function (err) { status(err.message, 'err'); });
      return;
    }

    var ei = t.getAttribute('data-edit-vid');
    if (ei !== null) {
      closeEditSlots($('vidList'));
      var v = cache.videos[Number(ei)];
      if (!v) return;
      t.closest('li').querySelector('.edit-slot').innerHTML =
        '<div class="edit-form">' +
        '<div class="field"><label>Title</label><input type="text" class="ef-title" value="' + esc(v.title) + '"></div>' +
        (v.type === 'embed'
          ? '<div class="field"><label>URL</label><input type="url" class="ef-url" value="' + esc(v.url) + '">' +
            '<div class="hint">If you change the URL, the thumbnail refreshes automatically.</div></div>'
          : '') +
        '<button class="btn primary" data-save-vid="' + ei + '">Save changes</button> ' +
        '<button class="btn" data-cancel-edit>Cancel</button>' +
        '</div>';
      return;
    }

    var si = t.getAttribute('data-save-vid');
    if (si === null) return;
    var v0 = cache.videos[Number(si)];
    if (!v0) return;
    var form = t.closest('.edit-form');
    var title = form.querySelector('.ef-title').value.trim();
    var urlEl = form.querySelector('.ef-url');
    var url = urlEl ? urlEl.value.trim() : '';
    if (!title || (urlEl && !url)) { status('Title' + (urlEl ? ' and URL' : '') + ' can’t be empty.', 'err'); return; }
    t.disabled = true;
    status('Saving changes…', 'busy');
    var lookup = (urlEl && url !== v0.url) ? fetchOembed(url) : Promise.resolve(undefined);
    lookup.then(function (info) {
      return readJsonFile('data/videos.json').then(function (f) {
        var v2 = f.data[Number(si)];
        if (!v2) throw new Error('Video not found — reload and try again.');
        v2.title = title;
        if (urlEl) {
          v2.url = url;
          if (info !== undefined) {
            var yt = ytIdOf(url);
            v2.thumb = (info && info.thumbnail_url) || (yt ? 'https://i.ytimg.com/vi/' + yt + '/hqdefault.jpg' : '');
          }
        }
        return writeJsonFile('data/videos.json', f.data, 'Edit video: ' + title, f.sha);
      });
    }).then(function () { status('Video updated. Live in about a minute.', 'ok'); loadLists(); })
      .catch(function (err) { status(err.message, 'err'); t.disabled = false; });
  });

  /* ================= MUSIC ================= */
  $('addMusUrlForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var url = $('musUrl').value.trim();
    var manual = $('musUrlTitle').value.trim();
    var btn = $('addMusUrlBtn'); btn.disabled = true;
    status('Looking up track info…', 'busy');
    fetchMusicMeta(url).then(function (info) {
      var yt = ytIdOf(url);
      var thumb = (info && info.thumbnail_url) || (yt ? 'https://i.ytimg.com/vi/' + yt + '/hqdefault.jpg' : '');
      var title = manual || (info && info.title) || url.replace(/^https?:\/\/(www\.)?/, '');
      var entry = { type: 'embed', title: title, url: url, thumb: thumb, date: today() };
      // platforms we can't build an embed URL for (e.g. Bandcamp): keep the oEmbed iframe so it still plays inline
      if (!YHG.musicEmbedUrl(url) && info && info.html) entry.embedHtml = info.html;
      status('Saving music…', 'busy');
      return readJsonFile('data/music.json').then(function (f) {
        f.data.push(entry);
        return writeJsonFile('data/music.json', f.data, 'Add music: ' + title, f.sha);
      }).then(function () {
        var playable = !!(YHG.musicEmbedUrl(url) || entry.embedHtml);
        status(playable
          ? (thumb ? 'Music saved. Live in about a minute.'
                   : 'Music saved, but no cover art was found — the card shows a plain play button.')
          : 'Saved. This platform can’t play inline, so the card opens the link in a new tab.', 'ok');
        $('addMusUrlForm').reset();
        loadLists();
      });
    }).catch(function (err) { status(err.message, 'err'); })
      .finally(function () { btn.disabled = false; });
  });

  $('addMusFileForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var file = $('musFile').files[0];
    var cover = $('musCover').files[0];
    var title = $('musFileTitle').value.trim();
    if (!file) { status('Choose an audio file.', 'err'); return; }
    if (tooBig(file)) return;
    var btn = $('addMusFileBtn'); btn.disabled = true;
    var slug = slugify(title) + '-' + Date.now().toString(36);
    var am = file.name.toLowerCase().match(/\.(mp3|wav|m4a|ogg|oga|flac|aac)$/);
    var aext = am ? am[1] : 'mp3';
    var thumbPath = '';
    var p = Promise.resolve();
    if (cover) {
      status('Processing cover image…', 'busy');
      p = fileToB64(cover).then(function (o) {
        thumbPath = 'images/music/' + slug + '.' + o.ext;
        return ghPut(thumbPath, o.b64, 'Add music cover: ' + title);
      });
    }
    p.then(function () {
      status('Uploading audio (' + (file.size / 1048576).toFixed(1) + ' MB)… this can take a minute.', 'busy');
      return fileToB64Raw(file);
    }).then(function (b64) {
      var srcPath = 'audio/' + slug + '.' + aext;
      return ghPut(srcPath, b64, 'Add music: ' + title).then(function () {
        status('Saving music…', 'busy');
        return readJsonFile('data/music.json').then(function (f) {
          f.data.push({ type: 'file', title: title, src: srcPath, thumb: thumbPath, filename: file.name, date: today() });
          return writeJsonFile('data/music.json', f.data, 'Add music: ' + title, f.sha);
        });
      });
    }).then(function () {
      status('Music uploaded. Live in about a minute.', 'ok');
      $('addMusFileForm').reset();
      $('musFilePreview').innerHTML = '';
      $('musCoverPreview').innerHTML = '';
      loadLists();
    }).catch(function (err) { status(err.message, 'err'); })
      .finally(function () { btn.disabled = false; });
  });

  /* ================= EDIT / DELETE MUSIC ================= */
  $('musList').addEventListener('click', function (e) {
    var t = e.target;
    if (t.hasAttribute('data-cancel-edit')) { closeEditSlots($('musList')); return; }

    var di = t.getAttribute('data-del-mus');
    if (di !== null) {
      if (!confirm('Delete this music entry?')) return;
      status('Deleting music…', 'busy');
      readJsonFile('data/music.json').then(function (f) {
        var removed = f.data.splice(Number(di), 1)[0];
        return writeJsonFile('data/music.json', f.data, 'Delete music: ' + (removed ? removed.title : ''), f.sha)
          .then(function () {
            var chain = Promise.resolve();
            ['src', 'thumb'].forEach(function (k) {
              var p = removed && removed[k];
              if (p && !/^https?:/i.test(p)) {
                chain = chain.then(function () { return ghDelete(p, 'Remove file for deleted music'); });
              }
            });
            return chain;
          });
      }).then(function () { status('Music deleted.', 'ok'); loadLists(); })
        .catch(function (err) { status(err.message, 'err'); });
      return;
    }

    var ei = t.getAttribute('data-edit-mus');
    if (ei !== null) {
      closeEditSlots($('musList'));
      var m = cache.music[Number(ei)];
      if (!m) return;
      t.closest('li').querySelector('.edit-slot').innerHTML =
        '<div class="edit-form">' +
        '<div class="field"><label>Title</label><input type="text" class="ef-title" value="' + esc(m.title) + '"></div>' +
        (m.type === 'embed'
          ? '<div class="field"><label>URL</label><input type="url" class="ef-url" value="' + esc(m.url) + '">' +
            '<div class="hint">If you change the URL, the cover art refreshes automatically.</div></div>'
          : '') +
        '<button class="btn primary" data-save-mus="' + ei + '">Save changes</button> ' +
        '<button class="btn" data-cancel-edit>Cancel</button>' +
        '</div>';
      return;
    }

    var si = t.getAttribute('data-save-mus');
    if (si === null) return;
    var m0 = cache.music[Number(si)];
    if (!m0) return;
    var form = t.closest('.edit-form');
    var title = form.querySelector('.ef-title').value.trim();
    var urlEl = form.querySelector('.ef-url');
    var url = urlEl ? urlEl.value.trim() : '';
    if (!title || (urlEl && !url)) { status('Title' + (urlEl ? ' and URL' : '') + ' can’t be empty.', 'err'); return; }
    t.disabled = true;
    status('Saving changes…', 'busy');
    var lookup = (urlEl && url !== m0.url) ? fetchMusicMeta(url) : Promise.resolve(undefined);
    lookup.then(function (info) {
      return readJsonFile('data/music.json').then(function (f) {
        var m2 = f.data[Number(si)];
        if (!m2) throw new Error('Music entry not found — reload and try again.');
        m2.title = title;
        if (urlEl) {
          m2.url = url;
          if (info !== undefined) {
            var yt = ytIdOf(url);
            m2.thumb = (info && info.thumbnail_url) || (yt ? 'https://i.ytimg.com/vi/' + yt + '/hqdefault.jpg' : '');
            if (!YHG.musicEmbedUrl(url) && info && info.html) m2.embedHtml = info.html;
            else delete m2.embedHtml;
          }
        }
        return writeJsonFile('data/music.json', f.data, 'Edit music: ' + title, f.sha);
      });
    }).then(function () { status('Music updated. Live in about a minute.', 'ok'); loadLists(); })
      .catch(function (err) { status(err.message, 'err'); t.disabled = false; });
  });

  /* ================= ADD PROJECT ================= */
  $('projImages').addEventListener('change', function () {
    filePreview($('projPreview'), $('projImages').files);
  });
  $('projExtra').addEventListener('change', function () {
    filePreview($('projExtraPreview'), $('projExtra').files);
  });
  $('vidFile').addEventListener('change', function () {
    filePreview($('vidFilePreview'), $('vidFile').files);
  });
  $('musFile').addEventListener('change', function () {
    filePreview($('musFilePreview'), $('musFile').files);
  });
  $('musCover').addEventListener('change', function () {
    filePreview($('musCoverPreview'), $('musCover').files);
  });

  $('addProjForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var files = Array.from($('projImages').files);
    if (!files.length) { status('Choose at least one image or PDF.', 'err'); return; }
    if (tooBig($('projExtra').files[0])) return;
    var btn = $('addProjBtn'); btn.disabled = true;

    var title = $('projTitle').value.trim();
    var slug = slugify(title) + '-' + Date.now().toString(36);

    // 1) turn every selected file into one or more images (PDFs expand to one per page)
    var items = []; // { b64, ext }
    var names = []; // original filename per generated image (parallel to items)
    var prep = Promise.resolve();
    files.forEach(function (file) {
      prep = prep.then(function () {
        if (isPdf(file)) {
          status('Reading PDF…', 'busy');
          return pdfToImages(file, function (n, total) {
            status('Converting PDF page ' + n + ' of ' + total + '…', 'busy');
          }).then(function (pages) {
            pages.forEach(function (p, idx) {
              items.push(p);
              names.push(pages.length > 1 ? file.name + ' (p ' + (idx + 1) + ')' : file.name);
            });
          });
        }
        return fileToB64(file).then(function (r) { items.push(r); names.push(file.name); });
      });
    });

    // 2) upload the images
    var paths = [];
    prep.then(function () {
      var chain = Promise.resolve();
      items.forEach(function (it, i) {
        chain = chain.then(function () {
          status('Uploading image ' + (i + 1) + ' of ' + items.length + '…', 'busy');
          var path = 'images/projects/' + slug + '/' + String(i + 1).padStart(2, '0') + '.' + it.ext;
          paths.push(path);
          return ghPut(path, it.b64, 'Add project image: ' + title);
        });
      });
      return chain;
    }).then(function () {
      // 3) optional interactive HTML page
      var extra = $('projExtra').files[0];
      if (!extra) return null;
      status('Uploading interactive page…', 'busy');
      return fileToB64Raw(extra).then(function (b64) {
        var path = 'images/projects/' + slug + '/interactive.html';
        return ghPut(path, b64, 'Add interactive page: ' + title).then(function () { return path; });
      });
    }).then(function (interactivePath) {
      status('Saving project…', 'busy');
      return readJsonFile('data/projects.json').then(function (f) {
        var nameMap = {};
        paths.forEach(function (pth, i) { nameMap[pth] = names[i]; });
        var rec = {
          id: slug,
          title: title,
          description: $('projDesc').value.trim(),
          date: today(),
          images: paths,
          names: nameMap
        };
        if (interactivePath) rec.interactive = interactivePath;
        f.data.push(rec);
        return writeJsonFile('data/projects.json', f.data, 'Add project: ' + title, f.sha);
      });
    }).then(function () {
      status('Project saved with ' + paths.length + ' images. Live in about a minute.', 'ok');
      $('addProjForm').reset();
      $('projPreview').innerHTML = '';
      $('projExtraPreview').innerHTML = '';
      loadLists();
    }).catch(function (err) { status(err.message, 'err'); })
      .finally(function () { btn.disabled = false; });
  });

  /* ================= DELETE PROJECT ================= */
  $('projList').addEventListener('click', function (e) {
    var i = e.target.getAttribute('data-del-proj');
    if (i === null) return;
    if (!confirm('Delete this project and its images?')) return;
    status('Deleting project…', 'busy');
    readJsonFile('data/projects.json').then(function (f) {
      var removed = f.data.splice(Number(i), 1)[0];
      return writeJsonFile('data/projects.json', f.data, 'Delete project: ' + (removed ? removed.title : ''), f.sha)
        .then(function () {
          var chain = Promise.resolve();
          (removed.images || []).forEach(function (p) {
            chain = chain.then(function () { return ghDelete(p, 'Remove image for deleted project'); });
          });
          if (removed.interactive) {
            chain = chain.then(function () { return ghDelete(removed.interactive, 'Remove interactive page for deleted project'); });
          }
          return chain;
        });
    }).then(function () { status('Project deleted.', 'ok'); loadLists(); })
      .catch(function (err) { status(err.message, 'err'); });
  });

})();
