/*
 * app.js — UI Tempelin: baca file laporan di perangkat, lalu kirim
 * baris-barisnya ke Apps Script untuk ditulis ke sheet "Sales".
 */
(function () {
  'use strict';

  var P = window.ReportParser;

  var DEFAULTS = {
    endpoint: 'https://script.google.com/macros/s/AKfycbygxwPBoFScd2_FsMGzLOieojjKG_dc7YzgJdQ5KFVdgvRfg2a_DjrRoy7sPWMLUECU/exec',
    sheetName: 'Sales',
    sheetUrl: 'https://docs.google.com/spreadsheets/d/173u7oW6wM1tLKLLNtYkMDSNpG82YDXOySfw2lLJmVMU/edit'
  };

  var STORE_KEY = 'tempelin.settings.v1';

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    settings: $('settings'), settingsSummary: $('settingsSummary'),
    endpoint: $('endpoint'), sheetName: $('sheetName'), sheetUrl: $('sheetUrl'),
    testBtn: $('testBtn'), diagBtn: $('diagBtn'), openSheet: $('openSheet'),
    drop: $('drop'), fileInput: $('fileInput'),
    listCard: $('listCard'), fileRows: $('fileRows'), fileCount: $('fileCount'),
    clearBtn: $('clearBtn'), checkBtn: $('checkBtn'), uploadBtn: $('uploadBtn'),
    progressWrap: $('progressWrap'), progressBar: $('progressBar'), progressText: $('progressText'),
    summaryCard: $('summaryCard'), statNew: $('statNew'), statSkip: $('statSkip'), statFiles: $('statFiles'),
    logCard: $('logCard'), log: $('log'), logClear: $('logClear'),
    netStatus: $('netStatus'), installBtn: $('installBtn')
  };

  var files = [];   // { id, name, date, rows, warnings, status, note }
  var busy = false;
  var nextId = 1;

  /* ----------------------------------------------------------- pengaturan */

  function loadSettings() {
    var saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
    } catch (e) { saved = {}; }

    el.endpoint.value = saved.endpoint || DEFAULTS.endpoint;
    el.sheetName.value = saved.sheetName || DEFAULTS.sheetName;
    el.sheetUrl.value = saved.sheetUrl || DEFAULTS.sheetUrl;
    refreshSettingsView();
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        endpoint: el.endpoint.value.trim(),
        sheetName: el.sheetName.value.trim(),
        sheetUrl: el.sheetUrl.value.trim()
      }));
    } catch (e) { /* mode privat: cukup jalan tanpa menyimpan */ }
    refreshSettingsView();
  }

  function refreshSettingsView() {
    var sheet = el.sheetName.value.trim() || DEFAULTS.sheetName;
    var url = el.endpoint.value.trim();
    var host = url ? (url.replace(/^https?:\/\//, '').split('/')[0] || url) : 'belum diatur';
    el.settingsSummary.textContent = 'sheet "' + sheet + '" · ' + host;

    var link = el.sheetUrl.value.trim();
    if (link) {
      el.openSheet.href = link;
      el.openSheet.removeAttribute('aria-disabled');
      el.openSheet.hidden = false;
    } else {
      el.openSheet.hidden = true;
    }
  }

  function endpoint() { return el.endpoint.value.trim(); }
  function sheetName() { return el.sheetName.value.trim() || DEFAULTS.sheetName; }

  /* ------------------------------------------------------------------ log */

  function log(msg, kind) {
    el.logCard.hidden = false;
    var line = document.createElement('div');
    var time = new Date().toLocaleTimeString('id-ID', { hour12: false });
    var stamp = document.createElement('span');
    stamp.className = 't';
    stamp.textContent = time + '  ';
    var body = document.createElement('span');
    if (kind) body.className = 'l-' + kind;
    body.textContent = msg;
    line.appendChild(stamp);
    line.appendChild(body);
    el.log.appendChild(line);
    el.log.scrollTop = el.log.scrollHeight;
  }

  /* -------------------------------------------------------- baca berkas */

  /*
   * File ekspor umumnya UTF-8, tapi sebagian tersimpan windows-1252.
   * Dekode UTF-8 dulu; kalau muncul karakter pengganti, coba windows-1252.
   */
  function decode(buffer) {
    var utf8 = new TextDecoder('utf-8').decode(buffer);
    if (utf8.indexOf('�') === -1) return utf8;
    try {
      return new TextDecoder('windows-1252').decode(buffer);
    } catch (e) {
      return utf8;
    }
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(decode(fr.result)); };
      fr.onerror = function () { reject(fr.error || new Error('Gagal membaca file.')); };
      fr.readAsArrayBuffer(file);
    });
  }

  function addFiles(fileList) {
    var incoming = Array.prototype.slice.call(fileList || []);
    if (!incoming.length) return;

    var jobs = incoming.map(function (file) {
      return readFile(file).then(function (text) {
        var parsed = P.parseFile(file.name, text);
        // Alasan gagal sudah dijelaskan oleh parsed.warnings, jadi note dibiarkan
        // kosong supaya pesannya tidak tampil dua kali.
        var status = 'siap', note = '';
        if (!parsed.date || !parsed.rows.length) status = 'gagal';

        var dup = files.filter(function (f) {
          return f.name === file.name && f.status !== 'gagal';
        }).length;
        if (dup && status === 'siap') {
          status = 'ganda';
          note = 'File dengan nama sama sudah ada di daftar.';
        }

        files.push({
          id: nextId++,
          name: file.name,
          date: parsed.date,
          rows: parsed.rows,
          warnings: parsed.warnings,
          status: status,
          note: note
        });

        log('Terbaca: ' + file.name + ' — ' + parsed.rows.length + ' baris' +
            (parsed.date ? ' (' + parsed.date + ')' : ''),
            status === 'gagal' ? 'err' : 'ok');
        parsed.warnings.forEach(function (w) { log('  ' + file.name + ': ' + w, 'warn'); });
      }).catch(function (err) {
        files.push({
          id: nextId++, name: file.name, date: null, rows: [], warnings: [],
          status: 'gagal', note: String(err && err.message ? err.message : err)
        });
        log('Gagal membaca ' + file.name + ': ' + err, 'err');
      });
    });

    Promise.all(jobs).then(render);
  }

  /* --------------------------------------------------------------- render */

  var STATUS_CLASS = {
    siap: 'pill--wait', ganda: 'pill--warn', gagal: 'pill--err',
    kirim: 'pill--wait', selesai: 'pill--ok', lewat: 'pill--warn', error: 'pill--err'
  };
  var STATUS_TEXT = {
    siap: 'Siap', ganda: 'Nama ganda', gagal: 'Gagal', kirim: 'Mengirim…',
    selesai: 'Selesai', lewat: 'Sudah ada', error: 'Error'
  };

  function render() {
    el.listCard.hidden = files.length === 0;
    if (!files.length) {
      el.fileRows.textContent = '';
      return;
    }

    var totalRows = files.reduce(function (a, f) { return a + f.rows.length; }, 0);
    el.fileCount.textContent = files.length + ' file · ' + totalRows + ' baris';

    el.fileRows.textContent = '';
    files.forEach(function (f) {
      var tr = document.createElement('tr');

      var tdName = document.createElement('td');
      tdName.className = 'name';
      tdName.textContent = f.name;
      (f.warnings || []).forEach(function (w) {
        var s = document.createElement('span');
        s.className = 'warn';
        s.textContent = w;
        tdName.appendChild(s);
      });
      if (f.note) {
        var n = document.createElement('span');
        n.className = 'warn';
        n.textContent = f.note;
        tdName.appendChild(n);
      }

      var tdDate = document.createElement('td');
      tdDate.className = 'num';
      tdDate.textContent = f.date || '—';

      var tdRows = document.createElement('td');
      tdRows.className = 'num';
      tdRows.textContent = f.rows.length;

      var tdStatus = document.createElement('td');
      var pill = document.createElement('span');
      pill.className = 'pill ' + (STATUS_CLASS[f.status] || 'pill--wait');
      pill.textContent = STATUS_TEXT[f.status] || f.status;
      tdStatus.appendChild(pill);

      tr.appendChild(tdName);
      tr.appendChild(tdDate);
      tr.appendChild(tdRows);
      tr.appendChild(tdStatus);
      el.fileRows.appendChild(tr);
    });

    var sendable = files.filter(canSend).length;
    el.uploadBtn.disabled = busy || sendable === 0;
    el.checkBtn.disabled = busy || sendable === 0;
    el.uploadBtn.textContent = sendable
      ? 'Upload ' + sendable + ' file ke spreadsheet'
      : 'Upload ke spreadsheet';
  }

  /*
   * Kunci baris harus sama persis dengan rowKey_() di Code.gs, supaya
   * duplikat antar-file dalam satu batch terhitung sama seperti di server.
   */
  function rowKey(row) {
    var toko = String(row.toko == null ? '' : row.toko).trim().toLowerCase().replace(/\s+/g, ' ');
    return String(row.tanggal || '') + '||' + toko;
  }

  function canSend(f) {
    return f.status !== 'gagal' && f.date && f.rows.length > 0;
  }

  function setBusy(state) {
    busy = state;
    [el.uploadBtn, el.checkBtn, el.clearBtn, el.testBtn, el.diagBtn].forEach(function (b) {
      b.disabled = state;
    });
    if (!state) render();
  }

  /* ----------------------------------------------------------- jaringan */

  /*
   * Apps Script tidak menangani preflight CORS, jadi kirim sebagai
   * "simple request": Content-Type text/plain dengan body JSON.
   */
  function callScript(payload) {
    var url = endpoint();
    if (!url) return Promise.reject(new Error('URL Apps Script belum diisi.'));

    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    }).then(function (res) {
      return res.text().then(function (text) {
        var data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          if (!res.ok) throw new Error('HTTP ' + res.status + ' dari Apps Script.');
          throw new Error(
            'Balasan bukan JSON. Pastikan deployment "Anyone" dan Code.gs terpasang. ' +
            'Potongan balasan: ' + text.slice(0, 120)
          );
        }
        if (!data.ok) throw new Error(data.error || 'Apps Script menolak permintaan.');
        return data;
      });
    });
  }

  function scriptGet(action) {
    var url = endpoint();
    if (!url) return Promise.reject(new Error('URL Apps Script belum diisi.'));
    var sep = url.indexOf('?') === -1 ? '?' : '&';
    var full = url + sep + 'action=' + encodeURIComponent(action) +
               '&sheet=' + encodeURIComponent(sheetName());
    return fetch(full, { method: 'GET', redirect: 'follow' })
      .then(function (res) { return res.text(); })
      .then(function (text) {
        var data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          throw new Error('Balasan bukan JSON: ' + text.slice(0, 120));
        }
        if (!data.ok) throw new Error(data.error || 'Permintaan ditolak.');
        return data;
      });
  }

  /* ------------------------------------------------------------- kirim */

  function send(dryRun) {
    var queue = files.filter(canSend);
    if (!queue.length) return;

    setBusy(true);
    el.progressWrap.hidden = false;
    el.progressText.hidden = false;
    el.summaryCard.hidden = true;

    var totalNew = 0, totalSkip = 0, done = 0, failed = 0;

    log(dryRun
      ? 'Mulai pengecekan ' + queue.length + ' file (tanpa menulis)…'
      : 'Mulai upload ' + queue.length + ' file ke sheet "' + sheetName() + '"…');

    // Kunci yang sudah diperhitungkan pada file-file sebelumnya di batch ini.
    var batchSeen = {};

    function step(i) {
      if (i >= queue.length) return finish();

      var f = queue[i];
      f.status = 'kirim';
      f.note = '';
      render();

      el.progressText.textContent =
        'File ' + (i + 1) + ' dari ' + queue.length + ': ' + f.name;

      /*
       * Buang dulu baris yang kembar dengan file sebelumnya di batch ini.
       * Server hanya membandingkan dengan isi sheet, dan saat "cek dulu"
       * belum ada yang ditulis — tanpa langkah ini hitungannya menggelembung.
       */
      var fresh = [];
      var dupInBatch = 0;
      for (var r = 0; r < f.rows.length; r++) {
        var key = rowKey(f.rows[r]);
        if (batchSeen[key]) { dupInBatch++; continue; }
        batchSeen[key] = true;
        fresh.push(f.rows[r]);
      }

      if (!fresh.length) {
        totalSkip += dupInBatch;
        f.status = 'lewat';
        f.note = dupInBatch + ' baris sama dengan file sebelumnya di daftar ini';
        log(f.name + ': ' + f.note, 'warn');
        done++;
        el.progressBar.style.width = Math.round(done / queue.length * 100) + '%';
        render();
        return step(i + 1);
      }

      // Satu file = satu request, supaya progres terlihat dan payload tetap kecil.
      return callScript({
        action: 'append',
        sheet: sheetName(),
        dryRun: !!dryRun,
        source: f.name,
        rows: fresh
      }).then(function (res) {
        var added = (dryRun ? res.wouldInsert : res.inserted) || 0;
        var skipped = ((dryRun ? res.wouldSkip : res.skipped) || 0) + dupInBatch;
        totalNew += added;
        totalSkip += skipped;

        f.status = (added > 0) ? (dryRun ? 'siap' : 'selesai') : 'lewat';
        f.note = dryRun
          ? (added + ' baris baru, ' + skipped + ' sudah ada')
          : (added + ' baris ditambahkan, ' + skipped + ' dilewati');

        if (dupInBatch) f.note += ' (' + dupInBatch + ' kembar dengan file lain di daftar ini)';
        if (res.invalid) f.note += ', ' + res.invalid + ' baris tidak valid';

        log(f.name + ': ' + f.note, added > 0 ? 'ok' : 'warn');
        if (res.mappingSource === 'urutan-kolom') {
          log('  Kolom sheet dipetakan memakai urutan A..AA (header tidak dikenali). ' +
              'Cek lewat "Periksa kolom sheet".', 'warn');
        }
      }).catch(function (err) {
        failed++;
        f.status = 'error';
        f.note = String(err && err.message ? err.message : err);
        log(f.name + ': ' + f.note, 'err');
      }).then(function () {
        done++;
        el.progressBar.style.width = Math.round(done / queue.length * 100) + '%';
        render();
        return step(i + 1);
      });
    }

    function finish() {
      el.statNew.textContent = totalNew;
      el.statSkip.textContent = totalSkip;
      el.statFiles.textContent = queue.length;
      el.summaryCard.hidden = false;
      el.progressText.textContent = dryRun
        ? 'Pengecekan selesai.'
        : 'Upload selesai.';

      log((dryRun ? 'Pengecekan' : 'Upload') + ' selesai — ' +
          totalNew + ' baris baru, ' + totalSkip + ' sudah ada' +
          (failed ? ', ' + failed + ' file gagal' : ''),
          failed ? 'warn' : 'ok');

      setBusy(false);
      el.progressBar.style.width = '0';
      el.progressWrap.hidden = true;
    }

    step(0);
  }

  /* -------------------------------------------------------------- events */

  el.drop.addEventListener('click', function () { el.fileInput.click(); });
  el.drop.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.fileInput.click(); }
  });

  el.fileInput.addEventListener('change', function () {
    addFiles(el.fileInput.files);
    el.fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach(function (ev) {
    el.drop.addEventListener(ev, function (e) {
      e.preventDefault();
      el.drop.classList.add('is-over');
    });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    el.drop.addEventListener(ev, function (e) {
      e.preventDefault();
      el.drop.classList.remove('is-over');
    });
  });
  el.drop.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });
  // Cegah browser membuka file kalau dijatuhkan di luar area drop.
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) { e.preventDefault(); });

  el.clearBtn.addEventListener('click', function () {
    files = [];
    el.summaryCard.hidden = true;
    render();
    log('Daftar file dibersihkan.');
  });

  el.uploadBtn.addEventListener('click', function () { send(false); });
  el.checkBtn.addEventListener('click', function () { send(true); });
  el.logClear.addEventListener('click', function () { el.log.textContent = ''; });

  el.testBtn.addEventListener('click', function () {
    setBusy(true);
    log('Menguji koneksi ke Apps Script…');
    scriptGet('ping').then(function (d) {
      log('Terhubung: spreadsheet "' + d.spreadsheet + '", sheet "' + d.sheet +
          '", ' + d.rows + ' baris data.', 'ok');
    }).catch(function (err) {
      log('Tes koneksi gagal: ' + err.message, 'err');
    }).then(function () { setBusy(false); });
  });

  el.diagBtn.addEventListener('click', function () {
    setBusy(true);
    log('Memeriksa kolom sheet…');
    scriptGet('diag').then(function (d) {
      log('Sheet "' + d.sheet + '": header ' + d.headerRows + ' baris, data mulai baris ' +
          d.firstDataRow + ', ' + d.existingRows + ' baris terisi.', 'ok');
      log('Pemetaan kolom: ' + d.mappingSource +
          ' (' + d.matchedByHeader + '/27 kolom cocok dengan header).',
          d.mappingSource === 'header' ? 'ok' : 'warn');
      log('Tanggal → kolom ' + d.mapping.tanggal + ', Toko → kolom ' + d.mapping.toko +
          ', Netto → kolom ' + d.mapping.netto + '.');
    }).catch(function (err) {
      log('Pemeriksaan gagal: ' + err.message, 'err');
    }).then(function () { setBusy(false); });
  });

  [el.endpoint, el.sheetName, el.sheetUrl].forEach(function (input) {
    input.addEventListener('change', saveSettings);
    input.addEventListener('blur', saveSettings);
  });

  /* ------------------------------------------------------ status & PWA */

  function updateNet() {
    var on = navigator.onLine;
    el.netStatus.className = 'pill ' + (on ? 'pill--muted' : 'pill--off');
    el.netStatus.textContent = on ? 'online' : 'offline';
    el.netStatus.title = on
      ? 'Terhubung ke internet'
      : 'Tidak ada koneksi — file tetap bisa dibaca, upload menunggu koneksi';
  }
  window.addEventListener('online', updateNet);
  window.addEventListener('offline', updateNet);

  var installEvent = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installEvent = e;
    el.installBtn.hidden = false;
  });
  el.installBtn.addEventListener('click', function () {
    if (!installEvent) return;
    installEvent.prompt();
    installEvent = null;
    el.installBtn.hidden = true;
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (err) {
        // Service worker butuh https atau localhost; aplikasi tetap jalan tanpanya.
        console.warn('Service worker tidak terdaftar:', err);
      });
    });
  }

  loadSettings();
  updateNet();
  render();
  if (!endpoint()) el.settings.open = true;
})();
