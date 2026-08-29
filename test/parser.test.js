/*
 * Test parser tanpa dependensi eksternal: `node test/parser.test.js`
 * Berikan path file laporan asli sebagai argumen untuk ikut mengujinya:
 *   node test/parser.test.js /path/ke/Grand_Total_All_Store_20260722_20260722.xls
 */
'use strict';
var fs = require('fs');
var P = require('../assets/parser.js');

var pass = 0, fail = 0;
function eq(actual, expected, label) {
  var a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass++; }
  else { fail++; console.error('FAIL ' + label + '\n  expected: ' + b + '\n  actual:   ' + a); }
}
function ok(cond, label) { eq(!!cond, true, label); }

/* --- parseNumber: format Indonesia --- */
eq(P.parseNumber('4.178.700'), 4178700, 'ribuan dengan titik');
eq(P.parseNumber('32.143,85'), 32143.85, 'desimal dengan koma');
eq(P.parseNumber('111.000'), 111000, 'satu titik = ribuan');
eq(P.parseNumber('5.887'), 5887, 'empat digit ribuan');
eq(P.parseNumber('-40.000'), -40000, 'negatif');
eq(P.parseNumber('(1.500)'), -1500, 'negatif dalam tanda kurung');
eq(P.parseNumber('0'), 0, 'nol');
eq(P.parseNumber(''), 0, 'kosong -> 0');
eq(P.parseNumber('  '), 0, 'spasi -> 0');
eq(P.parseNumber('-'), 0, 'tanda minus saja -> 0');
eq(P.parseNumber('607.868.462,75'), 607868462.75, 'ratusan juta dengan desimal');
eq(P.parseNumber('Rp 1.234,50'), 1234.5, 'ada prefix mata uang');
eq(P.parseNumber('4'), 4, 'satuan');
eq(P.parseNumber('0,5'), 0.5, 'desimal < 1');
/* Format Inggris tetap benar karena pemisah desimal = tanda paling akhir. */
eq(P.parseNumber('4,178,700.85'), 4178700.85, 'format inggris');
eq(P.parseNumber('1,234'), 1234, 'satu koma + 3 digit = ribuan');

/* --- tanggal dari nama file --- */
eq(P.extractDate('Grand_Total_All_Store_20260722_20260722.xls').date, '2026-07-22', 'tanggal dari nama file');
eq(P.extractDate('Grand_Total_All_Store_20260722_20260722.xls').isRange, false, 'tanggal sama bukan rentang');
eq(P.extractDate('a12e242c-Grand_Total_All_Store_20260722_20260722.xls').date, '2026-07-22', 'nama file dengan prefix acak');
eq(P.extractDate('Grand_Total_All_Store_20260722_20260724.xls').isRange, true, 'tanggal beda = rentang');
eq(P.extractDate('Grand_Total_All_Store_20260722_20260724.xls').date, '2026-07-22', 'rentang memakai tanggal awal');
eq(P.extractDate('laporan 2026-07-22.xls').date, '2026-07-22', 'format bertanda hubung');
eq(P.extractDate('laporan.xls').date, null, 'tanpa tanggal');
eq(P.extractDate('report_20261332.xls').date, null, 'tanggal tidak valid diabaikan');
eq(P.extractDate('report_99999999999_20260722.xls').date, '2026-07-22', 'deret angka panjang tidak ikut terbaca');

/* --- extractRows: HTML dengan tag tidak tertutup rapi --- */
var messy = '<table><thead><tr><th>Toko</th></tr></thead><tbody>' +
  '<tr><td align=left>Toko A</td><td align=right>1.000</td></tr' +
  '<tr><td align=left>Toko B</td><td align=right>2.000</td></tr>' +
  '</tbody><tfoot><tr><th>Total</th><th>3.000</th></tr></tfoot></table>';
var mr = P.extractRows(messy);
eq(mr.length, 2, 'dua baris data terbaca dari html tidak rapi');
eq(mr[0], ['Toko A', '1.000'], 'sel baris pertama');
eq(mr[1], ['Toko B', '2.000'], 'sel baris kedua');

/* Tanpa <tbody>: thead & tfoot harus dibuang. */
var noTbody = '<table><thead><tr><th>Toko</th><th>Bruto</th></tr></thead>' +
  '<tr><td>Toko A</td><td>1.000</td></tr>' +
  '<tfoot><tr><td>Total</td><td>1.000</td></tr></tfoot></table>';
eq(P.extractRows(noTbody).length, 1, 'tanpa tbody, hanya baris data');

/* Baris "Total" di dalam tbody juga harus dilewati. */
var totalInBody = '<table><tbody>' +
  '<tr><td>Toko A</td><td>1.000</td></tr>' +
  '<tr><td>Total</td><td>1.000</td></tr>' +
  '</tbody></table>';
eq(P.extractRows(totalInBody).length, 1, 'baris Total di tbody dilewati');

/* Entity HTML pada nama toko. */
eq(P.extractRows('<table><tbody><tr><td>Kopi &amp; Roti</td><td>1</td></tr></tbody></table>')[0][0],
   'Kopi & Roti', 'entity html didekode');

/* --- parseFile end-to-end pada HTML kecil --- */
var small = '<table><tbody><tr>' +
  ['Toko A', '4.178.700', '32.143,85'].map(function (v) { return '<td>' + v + '</td>'; }).join('') +
  '</tr></tbody></table>';
var pf = P.parseFile('Grand_Total_All_Store_20260722_20260722.xls', small);
eq(pf.rows.length, 1, 'parseFile menghasilkan 1 baris');
eq(pf.rows[0].tanggal, '2026-07-22', 'tanggal disisipkan ke baris');
eq(pf.rows[0].toko, 'Toko A', 'nama toko');
eq(pf.rows[0].bruto, 4178700, 'bruto');
eq(pf.rows[0].rata_rata_bruto, 32143.85, 'rata-rata bruto');
eq(pf.rows[0].netto, 0, 'kolom yang tidak ada diisi 0');
ok(pf.warnings.length > 0, 'baris pendek memunculkan peringatan');
eq(P.HEADER_FIELDS.length, 27, '27 kolom termasuk tanggal');

/* --- file laporan asli (opsional) --- */
var real = process.argv[2];
if (real && fs.existsSync(real)) {
  var res = P.parseFile(require('path').basename(real), fs.readFileSync(real, 'utf8'));
  console.log('\n--- file asli: ' + res.filename + ' ---');
  console.log('tanggal      :', res.date, '| rentang:', res.isRange);
  console.log('jumlah baris :', res.rows.length);
  console.log('kolom terbaca:', res.columnCount);
  console.log('peringatan   :', res.warnings.length ? res.warnings : '(tidak ada)');
  eq(res.date, '2026-07-22', '[asli] tanggal');
  eq(res.rows.length, 104, '[asli] 104 baris toko');
  eq(res.columnCount, 26, '[asli] 26 kolom');
  eq(res.warnings.length, 0, '[asli] tanpa peringatan');
  eq(res.rows[0].toko, 'LC cihampelas', '[asli] toko pertama');
  eq(res.rows[0].bruto, 4178700, '[asli] bruto baris pertama');
  eq(res.rows[0].rata_rata_bruto, 32143.85, '[asli] rata-rata bruto baris pertama');
  eq(res.rows[0].netto, 3544991, '[asli] netto baris pertama');
  eq(res.rows[0].rata_rata_netto, 27269.16, '[asli] rata-rata netto baris pertama');
  eq(res.rows[0].total_cu, 130, '[asli] total cu baris pertama');
  eq(res.rows[res.rows.length - 1].toko, 'Sedjati Coffee Majalengka', '[asli] toko terakhir');
  eq(res.rows[res.rows.length - 1].selisih_setoran, -40000, '[asli] selisih setoran negatif');

  /* Jumlah kolom harus cocok dengan baris Total pada laporan. */
  var sum = res.rows.reduce(function (a, r) { return a + r.bruto; }, 0);
  eq(Math.round(sum), 676006210, '[asli] jumlah bruto = baris Total laporan');
  var sumNetto = res.rows.reduce(function (a, r) { return a + r.netto; }, 0);
  eq(Math.round(sumNetto * 100) / 100, 607868462.75, '[asli] jumlah netto = baris Total laporan');
  var sumCu = res.rows.reduce(function (a, r) { return a + r.total_cu; }, 0);
  eq(sumCu, 18882, '[asli] jumlah Total CU = baris Total laporan');
  var sumDineIn = res.rows.reduce(function (a, r) { return a + r.dine_in_penjualan; }, 0);
  eq(sumDineIn, 140803000, '[asli] jumlah Dine In = baris Total laporan');
} else {
  console.log('\n(file laporan asli tidak diberikan, tes end-to-end dilewati)');
}

console.log('\n' + pass + ' lulus, ' + fail + ' gagal');
process.exit(fail ? 1 : 0);
