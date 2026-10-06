/*
 * ทำให้ Dashboard.html เดิมรันบน GitHub Pages ได้โดยไม่ต้องแก้โค้ดหน้าเว็บ:
 * จำลอง google.script.run
 *   getDashboardData() -> อ่าน data/dashboard.json (สร้างโดย GitHub Actions)
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

  var impl = {
    getDashboardData: async function () {
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

  window.google = { script: {} };
  Object.defineProperty(window.google.script, 'run', { get: runner });
})();
