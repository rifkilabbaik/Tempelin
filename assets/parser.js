/*
 * parser.js — mengubah file laporan "Grand Total All Store" (.xls yang
 * sebenarnya berisi HTML table) menjadi baris data siap kirim.
 *
 * Dipakai di browser (window.ReportParser) dan di Node (module.exports)
 * supaya logika yang sama bisa diuji lewat test/parser.test.js.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReportParser = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Urutan kolom persis mengikuti tabel laporan (26 kolom setelah Tanggal). */
  var FIELDS = [
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

  /* Label yang enak dibaca, untuk preview di UI. */
  var LABELS = {
    tanggal: 'Tanggal',
    toko: 'Toko',
    bruto: 'Bruto',
    rata_rata_bruto: 'Rata-rata Bruto',
    dine_in_penjualan: 'Dine In Penjualan', dine_in_cu: 'Dine In CU',
    take_away_penjualan: 'Take Away Penjualan', take_away_cu: 'Take Away CU',
    gofood_penjualan: 'GoFood Penjualan', gofood_cu: 'GoFood CU',
    grabfood_penjualan: 'GrabFood Penjualan', grabfood_cu: 'GrabFood CU',
    shopeefood_penjualan: 'ShopeeFood Penjualan', shopeefood_cu: 'ShopeeFood CU',
    katering_penjualan: 'Katering Penjualan', katering_cu: 'Katering CU',
    total_cu: 'Total CU',
    mdr: 'Mdr',
    diskon_online: 'Diskon Online',
    biaya_online: 'Biaya Online',
    biaya_pemasaran: 'Biaya Pemasaran',
    biaya_pengemasan: 'Biaya Pengemasan',
    selisih_pembulatan: 'Selisih Pembulatan',
    selisih_setoran: 'Selisih Setoran',
    diskon: 'Diskon',
    netto: 'Netto',
    rata_rata_netto: 'Rata-rata Netto'
  };

  function stripTags(s) {
    return s.replace(/<[^>]*>/g, '');
  }

  var ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '
  };

  function decodeEntities(s) {
    return s
      .replace(/&#x([0-9a-f]+);/gi, function (_, h) {
        return String.fromCharCode(parseInt(h, 16));
      })
      .replace(/&#(\d+);/g, function (_, d) {
        return String.fromCharCode(parseInt(d, 10));
      })
      .replace(/&([a-z]+);/gi, function (m, name) {
        var k = name.toLowerCase();
        return Object.prototype.hasOwnProperty.call(ENTITIES, k) ? ENTITIES[k] : m;
      });
  }

  function cleanCell(s) {
    return decodeEntities(stripTags(s))
      .replace(/ /g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /*
   * Angka pada laporan memakai format Indonesia ("4.178.700", "32.143,85",
   * "-40.000"). Pemisah desimal ditentukan dari tanda yang muncul paling
   * akhir, jadi format Inggris ("4,178,700.85") juga ikut tertangani.
   */
  function parseNumber(raw) {
    var s = String(raw == null ? '' : raw).replace(/ /g, ' ').trim();
    if (!s) return 0;

    var negative = /^\(.*\)$/.test(s) || /^-/.test(s) || /-$/.test(s);
    s = s.replace(/[^0-9.,]/g, '');
    if (!s) return 0;

    var lastDot = s.lastIndexOf('.');
    var lastComma = s.lastIndexOf(',');
    var dotCount = s.split('.').length - 1;
    var commaCount = s.split(',').length - 1;
    var dec = '';

    if (lastDot > -1 && lastComma > -1) {
      dec = lastDot > lastComma ? '.' : ',';
    } else if (lastComma > -1) {
      // Satu koma dengan digit setelahnya != 3 -> desimal, sisanya ribuan.
      if (commaCount === 1 && s.length - lastComma - 1 !== 3) dec = ',';
    } else if (lastDot > -1) {
      if (dotCount === 1 && s.length - lastDot - 1 !== 3) dec = '.';
    }

    var intPart = s, decPart = '';
    if (dec) {
      var at = s.lastIndexOf(dec);
      intPart = s.slice(0, at);
      decPart = s.slice(at + 1);
    }
    intPart = intPart.replace(/[.,]/g, '');
    decPart = decPart.replace(/[.,]/g, '');

    var n = parseFloat((intPart || '0') + (decPart ? '.' + decPart : ''));
    if (!isFinite(n)) return 0;
    return negative ? -n : n;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function isValidYmd(y, m, d) {
    if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  /*
   * Tanggal diambil dari nama file, contoh:
   *   Grand_Total_All_Store_20260722_20260722.xls -> 2026-07-22
   * Nama file yang berisi dua tanggal (rentang) memakai tanggal awal, dan
   * pemanggil diberi tahu lewat flag `isRange`.
   */
  function datesFromFilename(name) {
    var base = String(name || '').replace(/\.[^.]+$/, '');
    var found = [];
    // Batas non-digit di kedua sisi supaya tidak memotong deret angka panjang.
    // Backreference \2 menjaga pemisah tetap konsisten (20260722 / 2026-07-22).
    var re = /(?:^|[^0-9])(\d{4})([-_.]?)(\d{2})\2(\d{2})(?![0-9])/g;
    var m;
    while ((m = re.exec(base)) !== null) {
      var y = +m[1], mo = +m[3], d = +m[4];
      if (isValidYmd(y, mo, d)) {
        var iso = y + '-' + pad2(mo) + '-' + pad2(d);
        if (found.indexOf(iso) === -1) found.push(iso);
      }
    }
    return found;
  }

  function extractDate(name) {
    var dates = datesFromFilename(name);
    if (!dates.length) {
      return { date: null, isRange: false, dates: [] };
    }
    return { date: dates[0], isRange: dates.length > 1, dates: dates };
  }

  /*
   * Ambil baris data dari HTML laporan. Tag pada file ekspor kadang tidak
   * tertutup rapi (`</tr` tanpa `>`), jadi pemisahan dilakukan dengan regex,
   * bukan DOMParser.
   */
  function extractRows(text) {
    var html = String(text || '');
    var body = html;
    var tbody = /<tbody[^>]*>([\s\S]*?)<\/tbody/i.exec(html);
    if (tbody) {
      body = tbody[1];
    } else {
      // Tanpa <tbody>: buang thead & tfoot supaya baris header/total tidak ikut.
      body = html
        .replace(/<thead[^>]*>[\s\S]*?<\/thead[^>]*>?/gi, '')
        .replace(/<tfoot[^>]*>[\s\S]*?<\/tfoot[^>]*>?/gi, '');
    }

    var chunks = body.split(/<tr\b[^>]*>/i).slice(1);
    var rows = [];
    for (var i = 0; i < chunks.length; i++) {
      // Pisah per <td>, lalu potong di </td (yang kadang tanpa '>').
      var cells = chunks[i].split(/<td\b[^>]*>/i).slice(1).map(function (part) {
        return cleanCell(part.split(/<\/td/i)[0]);
      });
      if (cells.length < 2) continue;
      if (/^(total|grand total|jumlah)$/i.test(cells[0])) continue;
      if (!cells[0]) continue;
      rows.push(cells);
    }
    return rows;
  }

  /* Bangun objek baris dari sel-sel mentah. */
  function toRecord(cells, isoDate) {
    var rec = { tanggal: isoDate };
    for (var i = 0; i < FIELDS.length; i++) {
      var field = FIELDS[i];
      var raw = cells[i];
      rec[field] = field === 'toko' ? String(raw == null ? '' : raw).trim() : parseNumber(raw);
    }
    return rec;
  }

  /*
   * parseFile(filename, text) -> {
   *   filename, date, isRange, dates, rows, warnings, columnCount
   * }
   */
  function parseFile(filename, text) {
    var warnings = [];
    var info = extractDate(filename);

    if (!info.date) {
      warnings.push('Tanggal tidak ditemukan pada nama file (format yang dikenali: YYYYMMDD).');
    } else if (info.isRange) {
      warnings.push(
        'Nama file memuat rentang tanggal ' + info.dates.join(' s/d ') +
        '. Data dicatat dengan tanggal ' + info.date + '.'
      );
    }

    var raw = extractRows(text);
    if (!raw.length) warnings.push('Tidak ada baris data yang terbaca dari file ini.');

    var rows = [];
    var shortRows = 0;
    for (var i = 0; i < raw.length; i++) {
      if (raw[i].length < FIELDS.length) shortRows++;
      var rec = toRecord(raw[i], info.date);
      if (!rec.toko) continue;
      rows.push(rec);
    }
    if (shortRows) {
      warnings.push(
        shortRows + ' baris memiliki kolom lebih sedikit dari ' + FIELDS.length +
        ' kolom laporan; kolom yang hilang diisi 0.'
      );
    }

    return {
      filename: filename,
      date: info.date,
      isRange: info.isRange,
      dates: info.dates,
      rows: rows,
      warnings: warnings,
      columnCount: raw.length ? raw[0].length : 0
    };
  }

  return {
    FIELDS: FIELDS,
    LABELS: LABELS,
    HEADER_FIELDS: ['tanggal'].concat(FIELDS),
    parseNumber: parseNumber,
    extractDate: extractDate,
    extractRows: extractRows,
    parseFile: parseFile,
    cleanCell: cleanCell
  };
});
