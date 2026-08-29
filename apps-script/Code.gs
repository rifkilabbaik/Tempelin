/**
 * Tempelin — backend Google Apps Script untuk PWA upload laporan penjualan.
 *
 * Cara pakai:
 *   1. Buka spreadsheet tujuan -> Extensions -> Apps Script.
 *   2. Tempel seluruh isi file ini ke Code.gs.
 *   3. Deploy -> New deployment -> Web app
 *        Execute as       : Me
 *        Who has access   : Anyone
 *   4. Salin URL /exec, lalu masukkan ke kolom "URL Apps Script" di PWA.
 *
 * Endpoint:
 *   GET  ?action=ping   -> cek deployment hidup
 *   GET  ?action=diag   -> tampilkan header sheet + pemetaan kolom hasil deteksi
 *   POST {action:'append', rows:[...]} -> tambah baris yang belum ada
 *   POST {action:'append', rows:[...], dryRun:true} -> hitung saja, tanpa menulis
 *
 * Anti-duplikat: kunci baris = Tanggal + Toko. Baris yang kuncinya sudah ada
 * di sheet akan dilewati, jadi file yang sama boleh diunggah berulang kali.
 */

var SHEET_NAME = 'Sales';

/**
 * Urutan kolom bawaan bila header sheet tidak bisa dikenali.
 * Indeks 0 = kolom A, jadi 'tanggal' ada di kolom A sesuai permintaan.
 */
var FIELD_ORDER = [
  'tanggal',
  'toko',
  'bruto',
  'rata_rata_bruto',
  'dine_in_penjualan', 'dine_in_cu',
  'take_away_penjualan', 'take_away_cu',
  'gofood_penjualan', 'gofood_cu',
  'grabfood_penjualan', 'grabfood_cu',
  'shopeefood_penjualan', 'shopeefood_cu',
  'katering_penjualan', 'katering_cu',
  'total_cu',
  'mdr',
  'diskon_online',
  'biaya_online',
  'biaya_pemasaran',
  'biaya_pengemasan',
  'selisih_pembulatan',
  'selisih_setoran',
  'diskon',
  'netto',
  'rata_rata_netto'
];

/** Kolom yang isinya teks, sisanya diperlakukan sebagai angka. */
var TEXT_FIELDS = { toko: true };

/**
 * Nama header yang diterima untuk setiap kolom. Perbandingan dilakukan
 * setelah normalisasi (huruf kecil, tanpa spasi/tanda baca), jadi
 * "Rata-rata Bruto", "rata rata bruto", dan "RATARATABRUTO" sama saja.
 */
var HEADER_SYNONYMS = {
  tanggal: ['Tanggal', 'Date', 'Tgl', 'Tanggal Transaksi', 'Periode'],
  toko: ['Toko', 'Store', 'Outlet', 'Cabang', 'Nama Toko', 'Store Name'],
  bruto: ['Bruto', 'Penjualan Bruto', 'Total Bruto', 'Gross', 'Gross Sales'],
  rata_rata_bruto: ['Rata-rata Bruto', 'Rata2 Bruto', 'Rerata Bruto', 'Avg Bruto', 'Average Bruto'],
  dine_in_penjualan: ['Dine In Penjualan', 'Dine In', 'DineIn Penjualan', 'Penjualan Dine In', 'Dine In Sales'],
  dine_in_cu: ['Dine In CU', 'DineIn CU', 'CU Dine In'],
  take_away_penjualan: ['Take Away Penjualan', 'Take Away', 'TakeAway Penjualan', 'Penjualan Take Away'],
  take_away_cu: ['Take Away CU', 'TakeAway CU', 'CU Take Away'],
  gofood_penjualan: ['GoFood Penjualan', 'GoFood', 'Go Food Penjualan', 'Penjualan GoFood'],
  gofood_cu: ['GoFood CU', 'Go Food CU', 'CU GoFood'],
  grabfood_penjualan: ['GrabFood Penjualan', 'GrabFood', 'Grab Food Penjualan', 'Penjualan GrabFood'],
  grabfood_cu: ['GrabFood CU', 'Grab Food CU', 'CU GrabFood'],
  shopeefood_penjualan: ['ShopeeFood Penjualan', 'ShopeeFood', 'Shopee Food Penjualan', 'Penjualan ShopeeFood'],
  shopeefood_cu: ['ShopeeFood CU', 'Shopee Food CU', 'CU ShopeeFood'],
  katering_penjualan: ['Katering Penjualan', 'Katering', 'Catering Penjualan', 'Penjualan Katering'],
  katering_cu: ['Katering CU', 'Catering CU', 'CU Katering'],
  total_cu: ['Total CU', 'CU', 'Jumlah CU', 'Total Customer'],
  mdr: ['Mdr', 'MDR', 'Biaya MDR'],
  diskon_online: ['Diskon Online', 'Discount Online'],
  biaya_online: ['Biaya Online', 'Fee Online', 'Biaya Ojol'],
  biaya_pemasaran: ['Biaya Pemasaran', 'Marketing', 'Biaya Marketing'],
  biaya_pengemasan: ['Biaya Pengemasan', 'Packaging', 'Biaya Packaging'],
  selisih_pembulatan: ['Selisih Pembulatan', 'Pembulatan', 'Rounding'],
  selisih_setoran: ['Selisih Setoran', 'Setoran', 'Selisih Kas'],
  diskon: ['Diskon', 'Discount'],
  netto: ['Netto', 'Net', 'Penjualan Netto', 'Net Sales'],
  rata_rata_netto: ['Rata-rata Netto', 'Rata2 Netto', 'Rerata Netto', 'Avg Netto', 'Average Netto']
};

/* ------------------------------------------------------------------ utils */

function normalizeHeader_(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name || SHEET_NAME);
  if (!sheet) {
    throw new Error(
      'Sheet "' + (name || SHEET_NAME) + '" tidak ditemukan pada spreadsheet ini.'
    );
  }
  return sheet;
}

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

/** Ubah nilai sel tanggal (Date atau teks) menjadi kunci "yyyy-MM-dd". */
function dateKey_(value, timezone) {
  if (value === '' || value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    return Utilities.formatDate(value, timezone, 'yyyy-MM-dd');
  }
  var s = String(value).trim();
  if (!s) return '';

  var iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (iso) return iso[1] + '-' + pad2_(+iso[2]) + '-' + pad2_(+iso[3]);

  // dd/MM/yyyy atau dd-MM-yyyy (urutan umum di locale Indonesia)
  var dmy = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/.exec(s);
  if (dmy) return dmy[3] + '-' + pad2_(+dmy[2]) + '-' + pad2_(+dmy[1]);

  var parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, timezone, 'yyyy-MM-dd');
  }
  return s; // biarkan apa adanya supaya tetap bisa dibandingkan
}

function tokoKey_(value) {
  return String(value == null ? '' : value).trim().toLowerCase().replace(/\s+/g, ' ');
}

function rowKey_(dateKey, toko) {
  return dateKey + '||' + tokoKey_(toko);
}

/* ----------------------------------------------------------- tata letak */

/**
 * Tentukan pemetaan field -> nomor kolom, dan baris pertama data.
 *
 * Mendukung header satu baris ("Dine In Penjualan") maupun dua baris
 * bergabung ala laporan ("Dine In" di baris 1, "Penjualan" di baris 2).
 * Bila header tidak cukup dikenali, dipakai urutan FIELD_ORDER (kolom A..AA).
 */
function resolveLayout_(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), FIELD_ORDER.length);
  var probeRows = Math.min(2, Math.max(sheet.getLastRow(), 1));
  var values = sheet.getRange(1, 1, probeRows, lastCol).getDisplayValues();

  var row1 = values[0] || [];
  var row2 = probeRows > 1 ? (values[1] || []) : [];

  // Baris 2 dianggap sub-header bila berisi label seperti "Penjualan"/"CU".
  var subHeaderHits = 0;
  for (var i = 0; i < row2.length; i++) {
    var n = normalizeHeader_(row2[i]);
    if (n === 'cu' || n === 'penjualan' || n === 'sales') subHeaderHits++;
  }
  var hasSubHeader = subHeaderHits >= 2;

  // Gabungkan header dua baris, dengan forward-fill untuk sel yang digabung.
  var combined = [];
  var carry = '';
  for (var c = 0; c < lastCol; c++) {
    var top = String(row1[c] == null ? '' : row1[c]).trim();
    if (top) carry = top;
    var label = hasSubHeader ? (carry + ' ' + String(row2[c] == null ? '' : row2[c]).trim()) : top;
    combined.push(label.trim());
  }

  // Peta header ternormalisasi -> nomor kolom (kemunculan pertama menang).
  var byHeader = {};
  for (var k = 0; k < combined.length; k++) {
    var key = normalizeHeader_(combined[k]);
    if (key && !(key in byHeader)) byHeader[key] = k + 1;
  }

  var map = {};
  var matched = 0;
  for (var f = 0; f < FIELD_ORDER.length; f++) {
    var field = FIELD_ORDER[f];
    var options = HEADER_SYNONYMS[field] || [];
    for (var o = 0; o < options.length; o++) {
      var col = byHeader[normalizeHeader_(options[o])];
      if (col) { map[field] = col; matched++; break; }
    }
  }

  var headerRows = hasSubHeader ? 2 : 1;
  var confident = matched >= 20 && map.tanggal && map.toko;

  if (!confident) {
    map = {};
    for (var p = 0; p < FIELD_ORDER.length; p++) map[FIELD_ORDER[p]] = p + 1;
  }

  var width = 0;
  for (var key2 in map) {
    if (map[key2] > width) width = map[key2];
  }

  return {
    map: map,
    width: width,
    headerRows: headerRows,
    firstDataRow: headerRows + 1,
    matchedByHeader: matched,
    source: confident ? 'header' : 'urutan-kolom',
    detectedHeader: combined
  };
}

/** Kumpulkan kunci Tanggal+Toko yang sudah ada di sheet. */
function existingKeys_(sheet, layout, timezone) {
  var keys = {};
  var lastRow = sheet.getLastRow();
  var count = lastRow - layout.headerRows;
  if (count <= 0) return keys;

  var dateCol = layout.map.tanggal;
  var tokoCol = layout.map.toko;
  var from = Math.min(dateCol, tokoCol);
  var to = Math.max(dateCol, tokoCol);

  var block = sheet.getRange(layout.firstDataRow, from, count, to - from + 1).getValues();
  for (var i = 0; i < block.length; i++) {
    var row = block[i];
    var d = row[dateCol - from];
    var t = row[tokoCol - from];
    if ((d === '' || d === null) && (t === '' || t === null)) continue;
    keys[rowKey_(dateKey_(d, timezone), t)] = true;
  }
  return keys;
}

/* -------------------------------------------------------------- handlers */

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'ping';
  var sheetName = (e && e.parameter && e.parameter.sheet) || SHEET_NAME;

  try {
    if (action === 'ping') {
      var s = getSheet_(sheetName);
      return jsonOut_({
        ok: true,
        action: 'ping',
        sheet: s.getName(),
        rows: Math.max(s.getLastRow() - 1, 0),
        spreadsheet: SpreadsheetApp.getActiveSpreadsheet().getName()
      });
    }

    if (action === 'diag') {
      var sheet = getSheet_(sheetName);
      var layout = resolveLayout_(sheet);
      var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
      var mapping = {};
      for (var f = 0; f < FIELD_ORDER.length; f++) {
        var field = FIELD_ORDER[f];
        mapping[field] = layout.map[field] ? columnLetter_(layout.map[field]) : null;
      }
      return jsonOut_({
        ok: true,
        action: 'diag',
        sheet: sheet.getName(),
        timezone: tz,
        headerRows: layout.headerRows,
        firstDataRow: layout.firstDataRow,
        mappingSource: layout.source,
        matchedByHeader: layout.matchedByHeader,
        detectedHeader: layout.detectedHeader,
        mapping: mapping,
        existingRows: Math.max(sheet.getLastRow() - layout.headerRows, 0)
      });
    }

    if (action === 'keys') {
      var sh = getSheet_(sheetName);
      var lay = resolveLayout_(sh);
      var tzz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
      var keys = existingKeys_(sh, lay, tzz);
      var list = [];
      for (var k in keys) list.push(k);
      return jsonOut_({ ok: true, action: 'keys', sheet: sh.getName(), count: list.length, keys: list });
    }

    return jsonOut_({ ok: false, error: 'Action tidak dikenal: ' + action });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function columnLetter_(col) {
  var s = '';
  while (col > 0) {
    var m = (col - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s;
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    // Kunci supaya dua unggahan bersamaan tidak menghasilkan duplikat.
    if (!lock.tryLock(30000)) {
      return jsonOut_({ ok: false, error: 'Proses lain sedang menulis. Coba lagi sebentar.' });
    }

    var body = readBody_(e);
    var rows = body.rows;
    if (!rows || !rows.length) {
      return jsonOut_({ ok: false, error: 'Payload tidak memuat data (field "rows" kosong).' });
    }

    var sheet = getSheet_(body.sheet || SHEET_NAME);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tz = ss.getSpreadsheetTimeZone();
    var layout = resolveLayout_(sheet);
    var seen = existingKeys_(sheet, layout, tz);

    var toAppend = [];
    var inserted = 0, skipped = 0, invalid = 0;
    var skippedSample = [];

    for (var i = 0; i < rows.length; i++) {
      var src = rows[i] || {};
      var dk = dateKey_(src.tanggal, tz);
      var toko = String(src.toko == null ? '' : src.toko).trim();

      if (!dk || !toko) { invalid++; continue; }

      var key = rowKey_(dk, toko);
      if (seen[key]) {
        skipped++;
        if (skippedSample.length < 5) skippedSample.push(dk + ' — ' + toko);
        continue;
      }
      seen[key] = true; // cegah duplikat di dalam payload yang sama

      toAppend.push(buildRow_(src, layout, dk));
      inserted++;
    }

    if (body.dryRun) {
      return jsonOut_({
        ok: true, dryRun: true, sheet: sheet.getName(),
        wouldInsert: inserted, wouldSkip: skipped, invalid: invalid,
        skippedSample: skippedSample, mappingSource: layout.source
      });
    }

    if (toAppend.length) {
      var startRow = Math.max(sheet.getLastRow() + 1, layout.firstDataRow);
      // Tambah baris dulu bila sheet kurang panjang, lalu tulis sekali jalan.
      var needed = startRow + toAppend.length - 1 - sheet.getMaxRows();
      if (needed > 0) sheet.insertRowsAfter(sheet.getMaxRows(), needed);
      sheet.getRange(startRow, 1, toAppend.length, layout.width).setValues(toAppend);
    }

    return jsonOut_({
      ok: true,
      sheet: sheet.getName(),
      received: rows.length,
      inserted: inserted,
      skipped: skipped,
      invalid: invalid,
      skippedSample: skippedSample,
      mappingSource: layout.source,
      totalRows: Math.max(sheet.getLastRow() - layout.headerRows, 0)
    });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

/** Terima body JSON mentah (text/plain) maupun form field "payload". */
function readBody_(e) {
  if (e && e.postData && e.postData.contents) {
    return JSON.parse(e.postData.contents);
  }
  if (e && e.parameter && e.parameter.payload) {
    return JSON.parse(e.parameter.payload);
  }
  throw new Error('Request tanpa body.');
}

/** Susun satu baris sesuai pemetaan kolom; kolom lain dibiarkan kosong. */
function buildRow_(src, layout, dateKeyStr) {
  var out = [];
  for (var i = 0; i < layout.width; i++) out.push('');

  for (var f = 0; f < FIELD_ORDER.length; f++) {
    var field = FIELD_ORDER[f];
    var col = layout.map[field];
    if (!col) continue;

    var value;
    if (field === 'tanggal') {
      var parts = dateKeyStr.split('-');
      // Date object supaya Sheets memakai format tanggal milik sheet sendiri.
      value = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    } else if (TEXT_FIELDS[field]) {
      value = String(src[field] == null ? '' : src[field]).trim();
    } else {
      var n = Number(src[field]);
      value = isFinite(n) ? n : 0;
    }
    out[col - 1] = value;
  }
  return out;
}
