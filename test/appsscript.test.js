/*
 * Test logika apps-script/Code.gs di luar Google, dengan stub layanan
 * SpreadsheetApp / ContentService / LockService / Utilities.
 *   node test/appsscript.test.js
 */
'use strict';
var fs = require('fs');
var vm = require('vm');
var path = require('path');

var SRC = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

var pass = 0, fail = 0;
function eq(actual, expected, label) {
  var a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) pass++;
  else { fail++; console.error('FAIL ' + label + '\n  expected: ' + b + '\n  actual:   ' + a); }
}
function ok(cond, label) { eq(!!cond, true, label); }

/* ------------------------------------------------------- stub spreadsheet */

function makeSheet(name, grid) {
  var data = grid.map(function (r) { return r.slice(); });

  function ensureRows(n) {
    while (data.length < n) data.push([]);
  }

  return {
    _data: data,
    getName: function () { return name; },
    getLastRow: function () {
      var last = 0;
      for (var i = 0; i < data.length; i++) {
        for (var j = 0; j < data[i].length; j++) {
          if (data[i][j] !== '' && data[i][j] !== null && data[i][j] !== undefined) { last = i + 1; break; }
        }
      }
      return last;
    },
    getLastColumn: function () {
      var w = 0;
      for (var i = 0; i < data.length; i++) if (data[i].length > w) w = data[i].length;
      return w;
    },
    getMaxRows: function () { return Math.max(data.length, 1000); },
    insertRowsAfter: function (after, count) { ensureRows(after + count); },
    getRange: function (row, col, numRows, numCols) {
      return {
        getValues: function () {
          var out = [];
          for (var r = 0; r < numRows; r++) {
            var line = [];
            for (var c = 0; c < numCols; c++) {
              var v = (data[row - 1 + r] || [])[col - 1 + c];
              line.push(v === undefined ? '' : v);
            }
            out.push(line);
          }
          return out;
        },
        getDisplayValues: function () {
          return this.getValues().map(function (line) {
            return line.map(function (v) {
              if (v === null || v === undefined) return '';
              if (Object.prototype.toString.call(v) === '[object Date]') {
                return v.getFullYear() + '-' + (v.getMonth() + 1) + '-' + v.getDate();
              }
              return String(v);
            });
          });
        },
        setValues: function (values) {
          ensureRows(row - 1 + values.length);
          for (var r = 0; r < values.length; r++) {
            var target = data[row - 1 + r];
            for (var c = 0; c < values[r].length; c++) target[col - 1 + c] = values[r][c];
          }
        }
      };
    }
  };
}

function loadScript(sheets, timezone) {
  var lastOutput = null;
  var sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: function () {
        return {
          getName: function () { return 'Test Spreadsheet'; },
          getSpreadsheetTimeZone: function () { return timezone || 'Asia/Jakarta'; },
          getSheetByName: function (n) { return sheets[n] || null; }
        };
      }
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: function (text) {
        lastOutput = text;
        return { setMimeType: function () { return { getContent: function () { return text; } }; } };
      }
    },
    LockService: {
      getScriptLock: function () {
        return { tryLock: function () { return true; }, releaseLock: function () {} };
      }
    },
    Utilities: {
      // Cukup untuk pola 'yyyy-MM-dd' yang dipakai skrip.
      formatDate: function (date, tz, fmt) {
        var p = function (n) { return (n < 10 ? '0' : '') + n; };
        return date.getFullYear() + '-' + p(date.getMonth() + 1) + '-' + p(date.getDate());
      }
    },
    console: console
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  sandbox.__lastOutput = function () { return lastOutput; };
  return sandbox;
}

function post(ctx, body) {
  var res = ctx.doPost({ postData: { contents: JSON.stringify(body) } });
  return JSON.parse(ctx.__lastOutput());
}
function get(ctx, params) {
  ctx.doGet({ parameter: params || {} });
  return JSON.parse(ctx.__lastOutput());
}

/* Header laporan versi satu baris (sudah didatarkan). */
var FLAT_HEADER = [
  'Tanggal', 'Toko', 'Bruto', 'Rata-rata Bruto',
  'Dine In Penjualan', 'Dine In CU',
  'Take Away Penjualan', 'Take Away CU',
  'GoFood Penjualan', 'GoFood CU',
  'GrabFood Penjualan', 'GrabFood CU',
  'ShopeeFood Penjualan', 'ShopeeFood CU',
  'Katering Penjualan', 'Katering CU',
  'Total CU', 'Mdr', 'Diskon Online', 'Biaya Online', 'Biaya Pemasaran',
  'Biaya Pengemasan', 'Selisih Pembulatan', 'Selisih Setoran', 'Diskon',
  'Netto', 'Rata-rata Netto'
];

function sampleRow(tanggal, toko, bruto) {
  return {
    tanggal: tanggal, toko: toko, bruto: bruto === undefined ? 1000 : bruto,
    rata_rata_bruto: 500, dine_in_penjualan: 100, dine_in_cu: 1,
    take_away_penjualan: 200, take_away_cu: 2, gofood_penjualan: 0, gofood_cu: 0,
    grabfood_penjualan: 0, grabfood_cu: 0, shopeefood_penjualan: 0, shopeefood_cu: 0,
    katering_penjualan: 0, katering_cu: 0, total_cu: 3, mdr: 10, diskon_online: 0,
    biaya_online: 0, biaya_pemasaran: 0, biaya_pengemasan: 0, selisih_pembulatan: 0,
    selisih_setoran: -40000, diskon: 0, netto: 900, rata_rata_netto: 450.25
  };
}

/* --- 1. header satu baris cocok penuh --- */
(function () {
  var sheet = makeSheet('Sales', [FLAT_HEADER]);
  var ctx = loadScript({ Sales: sheet });
  var d = get(ctx, { action: 'diag' });
  eq(d.mappingSource, 'header', 'header datar: pemetaan lewat header');
  eq(d.matchedByHeader, 27, 'header datar: 27 kolom cocok');
  eq(d.headerRows, 1, 'header datar: 1 baris header');
  eq(d.mapping.tanggal, 'A', 'header datar: tanggal di kolom A');
  eq(d.mapping.toko, 'B', 'header datar: toko di kolom B');
  eq(d.mapping.rata_rata_netto, 'AA', 'header datar: kolom terakhir AA');

  var r = post(ctx, { rows: [sampleRow('2026-07-22', 'LC cihampelas')] });
  eq(r.ok, true, 'header datar: post ok');
  eq(r.inserted, 1, 'header datar: 1 baris masuk');
  eq(r.skipped, 0, 'header datar: tidak ada yang dilewati');

  var written = sheet._data[1];
  ok(Object.prototype.toString.call(written[0]) === '[object Date]', 'kolom A ditulis sebagai Date');
  eq(written[0].getFullYear(), 2026, 'tahun benar');
  eq(written[0].getMonth() + 1, 7, 'bulan benar');
  eq(written[0].getDate(), 22, 'hari benar');
  eq(written[1], 'LC cihampelas', 'nama toko ditulis');
  eq(written[2], 1000, 'bruto ditulis sebagai angka');
  eq(written[23], -40000, 'selisih setoran negatif ditulis');
  eq(written[26], 450.25, 'rata-rata netto desimal ditulis');
  eq(written.length, 27, 'lebar baris 27 kolom');
})();

/* --- 2. header dua baris ala laporan --- */
(function () {
  var row1 = ['Tanggal', 'Toko', 'Bruto', 'Rata-rata Bruto',
    'Dine In', '', 'Take Away', '', 'GoFood', '', 'GrabFood', '',
    'ShopeeFood', '', 'Katering', '',
    'Total CU', 'Mdr', 'Diskon Online', 'Biaya Online', 'Biaya Pemasaran',
    'Biaya Pengemasan', 'Selisih Pembulatan', 'Selisih Setoran', 'Diskon',
    'Netto', 'Rata-rata Netto'];
  var row2 = ['', '', '', '', 'Penjualan', 'CU', 'Penjualan', 'CU', 'Penjualan', 'CU',
    'Penjualan', 'CU', 'Penjualan', 'CU', 'Penjualan', 'CU',
    '', '', '', '', '', '', '', '', '', '', ''];
  var sheet = makeSheet('Sales', [row1, row2]);
  var ctx = loadScript({ Sales: sheet });
  var d = get(ctx, { action: 'diag' });
  eq(d.headerRows, 2, 'header dua baris: terdeteksi 2 baris');
  eq(d.firstDataRow, 3, 'header dua baris: data mulai baris 3');
  eq(d.mappingSource, 'header', 'header dua baris: pemetaan lewat header');
  eq(d.mapping.dine_in_penjualan, 'E', 'header dua baris: dine in penjualan di E');
  eq(d.mapping.dine_in_cu, 'F', 'header dua baris: dine in CU di F');
  eq(d.mapping.katering_cu, 'P', 'header dua baris: katering CU di P');

  var r = post(ctx, { rows: [sampleRow('2026-07-22', 'LC cihampelas')] });
  eq(r.inserted, 1, 'header dua baris: 1 baris masuk');
  eq(sheet._data[2][4], 100, 'header dua baris: nilai dine in di kolom E baris 3');
})();

/* --- 3. urutan kolom diacak, pemetaan harus ikut header --- */
(function () {
  var shuffled = FLAT_HEADER.slice();
  shuffled[0] = 'Toko'; shuffled[1] = 'Tanggal';
  var sheet = makeSheet('Sales', [shuffled]);
  var ctx = loadScript({ Sales: sheet });
  var d = get(ctx, { action: 'diag' });
  eq(d.mapping.toko, 'A', 'header diacak: toko ikut ke kolom A');
  eq(d.mapping.tanggal, 'B', 'header diacak: tanggal ikut ke kolom B');
  post(ctx, { rows: [sampleRow('2026-07-22', 'LC cihampelas')] });
  eq(sheet._data[1][0], 'LC cihampelas', 'header diacak: toko tertulis di A');
  ok(Object.prototype.toString.call(sheet._data[1][1]) === '[object Date]', 'header diacak: tanggal tertulis di B');
})();

/* --- 4. header tidak dikenali -> fallback urutan kolom --- */
(function () {
  var sheet = makeSheet('Sales', [['Kol1', 'Kol2', 'Kol3']]);
  var ctx = loadScript({ Sales: sheet });
  var d = get(ctx, { action: 'diag' });
  eq(d.mappingSource, 'urutan-kolom', 'header asing: fallback ke urutan kolom');
  eq(d.mapping.tanggal, 'A', 'header asing: tanggal tetap kolom A');
  eq(d.mapping.rata_rata_netto, 'AA', 'header asing: kolom terakhir AA');
})();

/* --- 5. anti-duplikat terhadap data yang sudah ada --- */
(function () {
  var existing = [FLAT_HEADER, [new Date(2026, 6, 22), 'LC cihampelas'].concat(new Array(25).fill(0))];
  var sheet = makeSheet('Sales', existing);
  var ctx = loadScript({ Sales: sheet });
  var r = post(ctx, {
    rows: [
      sampleRow('2026-07-22', 'LC cihampelas'),   // sudah ada -> dilewati
      sampleRow('2026-07-22', 'LC Alfathu'),      // toko baru -> masuk
      sampleRow('2026-07-23', 'LC cihampelas')    // tanggal baru -> masuk
    ]
  });
  eq(r.inserted, 2, 'dedup: 2 baris baru masuk');
  eq(r.skipped, 1, 'dedup: 1 baris duplikat dilewati');
  eq(r.received, 3, 'dedup: 3 baris diterima');
  eq(sheet.getLastRow(), 4, 'dedup: sheet jadi 4 baris');

  // Unggah ulang file yang sama: semuanya harus dilewati.
  var again = post(ctx, {
    rows: [
      sampleRow('2026-07-22', 'LC cihampelas'),
      sampleRow('2026-07-22', 'LC Alfathu'),
      sampleRow('2026-07-23', 'LC cihampelas')
    ]
  });
  eq(again.inserted, 0, 'dedup: unggah ulang tidak menambah baris');
  eq(again.skipped, 3, 'dedup: semua dilewati saat unggah ulang');
  eq(sheet.getLastRow(), 4, 'dedup: jumlah baris tidak berubah');
})();

/* --- 6. duplikat di dalam satu payload --- */
(function () {
  var sheet = makeSheet('Sales', [FLAT_HEADER]);
  var ctx = loadScript({ Sales: sheet });
  var r = post(ctx, {
    rows: [sampleRow('2026-07-22', 'LC cihampelas'), sampleRow('2026-07-22', 'LC cihampelas')]
  });
  eq(r.inserted, 1, 'payload duplikat: hanya 1 yang masuk');
  eq(r.skipped, 1, 'payload duplikat: 1 dilewati');
})();

/* --- 7. nama toko beda spasi/kapital dianggap sama --- */
(function () {
  var sheet = makeSheet('Sales', [FLAT_HEADER, [new Date(2026, 6, 22), 'LC cihampelas'].concat(new Array(25).fill(0))]);
  var ctx = loadScript({ Sales: sheet });
  var r = post(ctx, { rows: [sampleRow('2026-07-22', '  LC CIHAMPELAS  ')] });
  eq(r.skipped, 1, 'kunci toko tidak peka kapital/spasi');
})();

/* --- 8. tanggal existing berupa teks --- */
(function () {
  var sheet = makeSheet('Sales', [FLAT_HEADER, ['22/07/2026', 'LC cihampelas'].concat(new Array(25).fill(0))]);
  var ctx = loadScript({ Sales: sheet });
  var r = post(ctx, { rows: [sampleRow('2026-07-22', 'LC cihampelas')] });
  eq(r.skipped, 1, 'tanggal existing format dd/MM/yyyy dikenali');
})();
(function () {
  var sheet = makeSheet('Sales', [FLAT_HEADER, ['2026-07-22', 'LC cihampelas'].concat(new Array(25).fill(0))]);
  var ctx = loadScript({ Sales: sheet });
  var r = post(ctx, { rows: [sampleRow('2026-07-22', 'LC cihampelas')] });
  eq(r.skipped, 1, 'tanggal existing format ISO dikenali');
})();

/* --- 9. baris tanpa tanggal atau toko ditolak --- */
(function () {
  var sheet = makeSheet('Sales', [FLAT_HEADER]);
  var ctx = loadScript({ Sales: sheet });
  var r = post(ctx, {
    rows: [sampleRow(null, 'Toko X'), sampleRow('2026-07-22', ''), sampleRow('2026-07-22', 'Toko Y')]
  });
  eq(r.invalid, 2, 'baris tanpa tanggal/toko dihitung invalid');
  eq(r.inserted, 1, 'hanya baris valid yang masuk');
})();

/* --- 10. dryRun tidak menulis --- */
(function () {
  var sheet = makeSheet('Sales', [FLAT_HEADER]);
  var ctx = loadScript({ Sales: sheet });
  var r = post(ctx, { rows: [sampleRow('2026-07-22', 'Toko X')], dryRun: true });
  eq(r.dryRun, true, 'dryRun ditandai');
  eq(r.wouldInsert, 1, 'dryRun melaporkan calon baris');
  eq(sheet.getLastRow(), 1, 'dryRun tidak menambah baris');
})();

/* --- 11. penanganan error --- */
(function () {
  var ctx = loadScript({});
  var r = post(ctx, { rows: [sampleRow('2026-07-22', 'Toko X')] });
  eq(r.ok, false, 'sheet tidak ada -> ok:false');
  ok(/tidak ditemukan/.test(r.error), 'pesan error menyebut sheet tidak ditemukan');

  var ctx2 = loadScript({ Sales: makeSheet('Sales', [FLAT_HEADER]) });
  var empty = post(ctx2, { rows: [] });
  eq(empty.ok, false, 'rows kosong -> ok:false');
  var p = get(ctx2, { action: 'ping' });
  eq(p.ok, true, 'ping ok');
  eq(p.sheet, 'Sales', 'ping menyebut nama sheet');
  var unknown = get(ctx2, { action: 'entahlah' });
  eq(unknown.ok, false, 'action tidak dikenal -> ok:false');
})();

/* --- 12. sheet kosong tanpa header sama sekali --- */
(function () {
  var sheet = makeSheet('Sales', [[]]);
  var ctx = loadScript({ Sales: sheet });
  var r = post(ctx, { rows: [sampleRow('2026-07-22', 'Toko X')] });
  eq(r.ok, true, 'sheet kosong tetap bisa ditulis');
  eq(r.inserted, 1, 'sheet kosong: 1 baris masuk');
})();

console.log(pass + ' lulus, ' + fail + ' gagal');
process.exit(fail ? 1 : 0);
