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
  function loadLists() {
    readJsonFile('data/links.json').then(function (f) {
      var html = '';
      f.data.forEach(function (l, i) {
        html += '<li><span class="item-title">' + esc(l.title) +
          ' <span class="item-sub">' + esc(l.date || '') + '</span></span>' +
          '<button class="btn danger" data-del-link="' + i + '">Delete</button></li>';
      });
      $('linkList').innerHTML = html || '<li><span class="item-sub">No links yet.</span></li>';
    });
    readJsonFile('data/projects.json').then(function (f) {
      var html = '';
      f.data.forEach(function (p, i) {
        html += '<li><span class="item-title">' + esc(p.title) +
          ' <span class="item-sub">' + (p.images || []).length + ' images</span></span>' +
          '<button class="btn danger" data-del-proj="' + i + '">Delete</button></li>';
      });
      $('projList').innerHTML = html || '<li><span class="item-sub">No projects yet.</span></li>';
    });
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

  /* ================= ADD PROJECT ================= */
  $('projImages').addEventListener('change', function () {
    var prev = $('projPreview');
    prev.innerHTML = '';
    Array.from($('projImages').files).forEach(function (file) {
      var img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      prev.appendChild(img);
    });
  });

  $('addProjForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var files = Array.from($('projImages').files);
    if (!files.length) { status('Choose at least one image.', 'err'); return; }
    var btn = $('addProjBtn'); btn.disabled = true;

    var title = $('projTitle').value.trim();
    var slug = slugify(title) + '-' + Date.now().toString(36);
    var paths = [];
    var chain = Promise.resolve();

    files.forEach(function (file, i) {
      chain = chain.then(function () {
        status('Uploading image ' + (i + 1) + ' of ' + files.length + '…', 'busy');
        return fileToB64(file).then(function (r) {
          var path = 'images/projects/' + slug + '/' + String(i + 1).padStart(2, '0') + '.' + r.ext;
          paths.push(path);
          return ghPut(path, r.b64, 'Add project image: ' + title);
        });
      });
    });

    chain.then(function () {
      status('Saving project…', 'busy');
      return readJsonFile('data/projects.json').then(function (f) {
        f.data.push({
          id: slug,
          title: title,
          description: $('projDesc').value.trim(),
          date: today(),
          images: paths
        });
        return writeJsonFile('data/projects.json', f.data, 'Add project: ' + title, f.sha);
      });
    }).then(function () {
      status('Project saved with ' + paths.length + ' images. Live in about a minute.', 'ok');
      $('addProjForm').reset();
      $('projPreview').innerHTML = '';
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
          return chain;
        });
    }).then(function () { status('Project deleted.', 'ok'); loadLists(); })
      .catch(function (err) { status(err.message, 'err'); });
  });

})();
