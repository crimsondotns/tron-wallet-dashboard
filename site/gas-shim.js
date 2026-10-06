/*
 * ทำให้ Dashboard.html เดิมรันบน GitHub Pages ได้โดยไม่ต้องแก้โค้ดหน้าเว็บ:
 * จำลอง google.script.run
 *   getDashboardData() -> อ่าน data/dashboard.bin (เข้ารหัส ต้องใส่รหัสผ่าน) หรือ data/dashboard.json (ไม่เข้ารหัส)
 *   setAddressLabel()  -> POST ไป GAS Web App (บันทึกลงชีต AddressBook)
 *   exportTxs()        -> POST ไป GAS Web App (สร้างไฟล์ใน Google Drive)
 * การเขียน (ตั้งชื่อ / Export) ต้องใส่รหัสแก้ไข (EDIT_KEY ใน Script Properties ของ GAS) ครั้งเดียว แล้วเบราว์เซอร์จะจำไว้
 */
(function () {
  var cfg = window.DASH_CONFIG || {};
  var KEY_STORE = 'dash-edit-key';
  var en = function () { return window.LANG === 'en'; };

  function getKey() {
    var k = null;
    try { k = localStorage.getItem(KEY_STORE); } catch (e) {}
    if (!k) {
      k = window.prompt(en() ? 'Enter the edit key (EDIT_KEY)' : 'ใส่รหัสแก้ไข (EDIT_KEY)');
      if (!k) throw new Error(en() ? 'Cancelled: no edit key' : 'ยกเลิก: ไม่ได้ใส่รหัสแก้ไข');
      try { localStorage.setItem(KEY_STORE, k); } catch (e) {}
    }
    return k;
  }

  async function post(body) {
    if (!cfg.gasUrl) throw new Error(en() ? 'gasUrl is not set in config.js' : 'ยังไม่ได้ตั้ง gasUrl ใน config.js');
    body.key = getKey();
    var res = await fetch(cfg.gasUrl, { method: 'POST', body: JSON.stringify(body) });
    var j = await res.json();
    if (j.error) {
      if (j.error === 'bad_key') { try { localStorage.removeItem(KEY_STORE); } catch (e) {} }
      throw new Error(j.message || j.error);
    }
    return j.result;
  }

  /* ---------- ข้อมูลเข้ารหัส: "TWD1" + salt(16) + iv(12) + AES-256-GCM(gzip(JSON)) ตรงกับ scripts/sync.mjs ---------- */
  var PASS_STORE = 'dash-pass';
  var ITER = 310000;

  async function decrypt(buf, pass) {
    var b = new Uint8Array(buf);
    if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'TWD1') throw new Error('bad format');
    var base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    var key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b.slice(4, 20), iterations: ITER, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    var gz = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(20, 32) }, key, b.slice(32));
    return await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  }

  function savedPass() {
    try { return sessionStorage.getItem(PASS_STORE) || localStorage.getItem(PASS_STORE); } catch (e) { return null; }
  }
  function forgetPass() {
    try { sessionStorage.removeItem(PASS_STORE); localStorage.removeItem(PASS_STORE); } catch (e) {}
  }

  /* หน้าใส่รหัสผ่าน (ตาม Design System ใน CLAUDE.md) คืนค่า Promise ที่ resolve เมื่อถอดรหัสสำเร็จ */
  function askPass(buf, errMsg) {
    return new Promise(function (resolve) {
      var t = en()
        ? { title: 'Enter password', sub: 'This dashboard is encrypted', ph: 'Password', remember: 'Remember on this device', go: 'Unlock', bad: 'Wrong password', busy: 'Unlocking…' }
        : { title: 'ใส่รหัสผ่าน', sub: 'Dashboard นี้เข้ารหัสไว้', ph: 'รหัสผ่าน', remember: 'จำรหัสในเครื่องนี้', go: 'ปลดล็อก', bad: 'รหัสผ่านไม่ถูกต้อง', busy: 'กำลังปลดล็อก…' };
      var css = document.createElement('style');
      css.textContent =
        '#lock{position:fixed;inset:0;z-index:100;background:var(--background-base,#121212);display:flex;align-items:center;justify-content:center;padding:16px;font-family:var(--font-ui,sans-serif)}' +
        '#lock form{background:var(--background-highlight,#1f1f1f);border-radius:8px;padding:32px;width:100%;max-width:360px;display:flex;flex-direction:column;gap:16px}' +
        '#lock .ic{width:48px;height:48px;border-radius:9999px;background:var(--background-card,#292929);display:flex;align-items:center;justify-content:center;color:#fff}' +
        '#lock h2{margin:0;font-family:var(--font-title,sans-serif);font-size:20px;font-weight:700;line-height:1.3;color:#fff}' +
        '#lock p{margin:-8px 0 0;font-size:14px;line-height:1.5;color:#b3b3b3}' +
        '#lock input[type=password]{background:#292929;color:#fff;border:1px solid transparent;border-radius:9999px;padding:12px 16px;font-size:14px;font-family:inherit;outline:none}' +
        '#lock input[type=password]::placeholder{color:#777}' +
        '#lock input[type=password]:focus{border-color:#535353;box-shadow:inset 0 0 0 1px #fff}' +
        '#lock label{display:flex;align-items:center;gap:8px;font-size:14px;color:#b3b3b3;cursor:pointer;min-height:32px}' +
        '#lock label input{accent-color:#1ed760;width:16px;height:16px;margin:0}' +
        '#lock button{background:#fff;color:#101010;border:none;border-radius:9999px;padding:12px 32px;font-size:14px;font-weight:700;line-height:1;font-family:inherit;cursor:pointer;transition:transform .15s ease-out}' +
        '#lock button:hover{transform:scale(1.05)}#lock button:active{background:#c5c5c5;transform:scale(1)}#lock button:disabled{opacity:.5;transform:none}' +
        '#lock :focus-visible{outline:2px solid rgba(255,255,255,.5);outline-offset:2px}' +
        '#lock .err{font-size:12px;line-height:1.5;color:#ff6b6b;min-height:18px;margin:-8px 0 0}';
      var box = document.createElement('div');
      box.id = 'lock';
      box.innerHTML =
        '<form autocomplete="on">' +
        '<div class="ic"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>' +
        '<h2></h2><p></p>' +
        '<input type="password" name="password" autocomplete="current-password" required>' +
        '<div class="err" role="alert"></div>' +
        '<label><input type="checkbox"><span></span></label>' +
        '<button type="submit"></button></form>';
      var f = box.querySelector('form'), inp = box.querySelector('input[type=password]'), chk = box.querySelector('input[type=checkbox]');
      var btn = box.querySelector('button'), err = box.querySelector('.err');
      box.querySelector('h2').textContent = t.title;
      box.querySelector('p').textContent = t.sub;
      box.querySelector('label span').textContent = t.remember;
      inp.placeholder = t.ph;
      btn.textContent = t.go;
      err.textContent = errMsg ? t.bad : '';
      document.head.appendChild(css);
      document.body.appendChild(box);
      inp.focus();
      f.onsubmit = async function (e) {
        e.preventDefault();
        btn.disabled = true; btn.textContent = t.busy; err.textContent = '';
        try {
          var text = await decrypt(buf, inp.value);
          try {
            sessionStorage.setItem(PASS_STORE, inp.value);
            if (chk.checked) localStorage.setItem(PASS_STORE, inp.value);
          } catch (x) {}
          box.remove(); css.remove();
          resolve(text);
        } catch (x) {
          err.textContent = t.bad; btn.disabled = false; btn.textContent = t.go; inp.select();
        }
      };
    });
  }

  var impl = {
    getDashboardData: async function () {
      var enc = await fetch('data/dashboard.bin?t=' + Date.now(), { cache: 'no-store' });
      if (enc.ok) {
        var lb = document.getElementById('btnLock'); if (lb) lb.hidden = false;
        var buf = await enc.arrayBuffer();
        var p = savedPass();
        if (p) {
          try { return await decrypt(buf, p); } catch (e) { forgetPass(); return await askPass(buf, true); }
        }
        return await askPass(buf, false);
      }
      var res = await fetch('data/dashboard.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error((en() ? 'Could not load data/dashboard.json: HTTP ' : 'โหลด data/dashboard.json ไม่ได้: HTTP ') + res.status +
        (en() ? ' (has the first GitHub Actions run finished?)' : ' (GitHub Actions รันรอบแรกเสร็จหรือยัง?)'));
      return await res.text();
    },
    setAddressLabel: function (address, name, type, lang) {
      return post({ action: 'label', address: address, name: name, type: type, lang: lang });
    },
    exportTxs: function (payload) {
      return post({ action: 'export', payload: payload });
    },
  };

  function runner() {
    var ok = function () {}, fail = function () {};
    var p = new Proxy({}, {
      get: function (_, k) {
        if (k === 'withSuccessHandler') return function (fn) { ok = fn; return p; };
        if (k === 'withFailureHandler') return function (fn) { fail = fn; return p; };
        return function () {
          var args = arguments;
          Promise.resolve().then(function () {
            if (!impl[k]) throw new Error('Unknown function: ' + String(k));
            return impl[k].apply(null, args);
          }).then(function (r) { ok(r); }, function (e) { fail(e instanceof Error ? e : new Error(String(e))); });
        };
      },
    });
    return p;
  }

  /* ล็อกหน้าเว็บอีกครั้ง (ลบรหัสที่จำไว้) */
  window.dashLock = function () { forgetPass(); location.reload(); };

  window.google = { script: {} };
  Object.defineProperty(window.google.script, 'run', { get: runner });
})();
