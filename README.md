# Tempelin

PWA untuk mengunggah laporan **Grand Total All Store** ke Google Spreadsheet.
File laporan dibaca langsung di perangkat, lalu barisnya dikirim ke sheet
**Sales** lewat Google Apps Script.

- Bisa pilih **banyak file sekaligus** (drag & drop atau tombol pilih file).
- **Tanggal diambil dari nama file** dan ditulis ke **kolom A**.
- **Tidak menimpa dan tidak menggandakan**: baris yang sudah ada di sheet
  dilewati, jadi file yang sama aman diunggah berulang kali.
- Bisa dipasang di HP/desktop (installable) dan tetap terbuka saat offline.

---

## 1. Pasang backend (Apps Script)

1. Buka [spreadsheet tujuan](https://docs.google.com/spreadsheets/d/173u7oW6wM1tLKLLNtYkMDSNpG82YDXOySfw2lLJmVMU/edit)
   → menu **Extensions → Apps Script**.
2. Hapus isi `Code.gs`, lalu tempel seluruh isi [`apps-script/Code.gs`](apps-script/Code.gs).
3. **Deploy → New deployment → Web app**:
   | Kolom | Nilai |
   | --- | --- |
   | Execute as | **Me** |
   | Who has access | **Anyone** |
4. Salin URL yang berakhir `/exec`.

> Setiap kali `Code.gs` diubah, buat **New version** pada deployment yang sama
> supaya URL `/exec` tidak berubah.

## 2. Jalankan PWA

Aplikasi ini statis — cukup disajikan lewat HTTPS. Contoh dengan GitHub Pages:
**Settings → Pages → Source: Deploy from a branch**, pilih branch ini dan folder
`/ (root)`.

Untuk mencoba di komputer sendiri:

```bash
npx http-server . -p 8080
# lalu buka http://localhost:8080
```

> Service worker (mode offline & tombol "Pasang aplikasi") hanya aktif pada
> `https://` atau `http://localhost`. Dibuka langsung sebagai `file://`
> aplikasinya tetap jalan, hanya tanpa fitur PWA.

## 3. Pakai

1. Buka **Pengaturan tujuan**, tempel URL `/exec`, pastikan nama sheet `Sales`.
2. Klik **Tes koneksi** — harus menyebut nama spreadsheet.
3. Klik **Periksa kolom sheet** — pastikan tertulis `27/27 kolom cocok` dan
   `Tanggal → kolom A`.
4. Jatuhkan file laporan (boleh banyak), lalu:
   - **Cek dulu (tanpa menulis)** — lihat berapa baris yang baru, tanpa mengubah sheet.
   - **Upload ke spreadsheet** — tulis baris yang baru saja.

---

## Cara kerjanya

### Tanggal dari nama file

Deretan `YYYYMMDD` (boleh juga `YYYY-MM-DD`) dibaca dari nama file:

| Nama file | Tanggal |
| --- | --- |
| `Grand_Total_All_Store_20260722_20260722.xls` | `2026-07-22` |
| `Grand_Total_All_Store_20260722_20260724.xls` | `2026-07-22` + peringatan rentang |
| `laporan.xls` | ditolak, ditandai **Gagal** |

Nama file yang memuat dua tanggal berbeda dianggap laporan rentang: dipakai
tanggal awal, dan peringatannya ditampilkan di daftar file.

### Anti-duplikat

Kunci sebuah baris adalah **Tanggal + Toko** (nama toko dibandingkan tanpa
memperhatikan huruf besar/kecil dan spasi berlebih). Sebelum menulis, Apps
Script membaca kolom Tanggal & Toko yang sudah ada, lalu:

- baris yang kuncinya **sudah ada** → dilewati;
- baris yang kuncinya **belum ada** → ditambahkan di bawah data terakhir.

Duplikat antar-file dalam satu daftar unggahan juga disaring lebih dulu di sisi
aplikasi, supaya hitungan pada "Cek dulu" sama dengan hasil upload sungguhan.
`LockService` mencegah dua unggahan bersamaan menghasilkan baris ganda.

### Pemetaan kolom

Kolom A adalah Tanggal, lalu 26 kolom laporan mengikuti urutan aslinya:

```
A  Tanggal              J  GoFood CU              S  Diskon Online
B  Toko                 K  GrabFood Penjualan     T  Biaya Online
C  Bruto                L  GrabFood CU            U  Biaya Pemasaran
D  Rata-rata Bruto      M  ShopeeFood Penjualan   V  Biaya Pengemasan
E  Dine In Penjualan    N  ShopeeFood CU          W  Selisih Pembulatan
F  Dine In CU           O  Katering Penjualan     X  Selisih Setoran
G  Take Away Penjualan  P  Katering CU            Y  Diskon
H  Take Away CU         Q  Total CU               Z  Netto
I  GoFood Penjualan     R  Mdr                    AA Rata-rata Netto
```

Apps Script membaca header sheet lebih dulu dan mencocokkannya dengan nama-nama
di `HEADER_SYNONYMS` (header satu baris maupun dua baris ala laporan). Jadi kalau
urutan kolom di sheet berbeda, data tetap masuk ke kolom yang benar. Bila header
tidak cukup dikenali (< 20 dari 27 kolom cocok), dipakai urutan A..AA di atas dan
aplikasi menampilkan peringatan. Cek hasil pemetaan lewat tombol
**Periksa kolom sheet**.

Angka format Indonesia dikonversi ke angka asli (`4.178.700` → `4178700`,
`32.143,85` → `32143.85`), dan tanggal ditulis sebagai objek `Date` supaya
mengikuti format tanggal milik sheet.

---

## Struktur

```
index.html                 Halaman aplikasi
assets/parser.js           Pembaca file laporan (dipakai browser & test)
assets/app.js              UI, antrean upload, pemanggilan Apps Script
assets/style.css           Gaya, mendukung mode terang & gelap
assets/manifest.webmanifest, assets/icon-*.png
sw.js                      Service worker (app shell offline)
apps-script/Code.gs        Backend: pemetaan kolom, anti-duplikat, penulisan
test/parser.test.js        Test parser
test/appsscript.test.js    Test logika Code.gs (Google API distub)
```

## Test

Tanpa dependensi, cukup Node:

```bash
node test/parser.test.js                       # test parser
node test/parser.test.js /path/ke/laporan.xls  # sekaligus uji file asli
node test/appsscript.test.js                   # test logika Code.gs
```

`test/parser.test.js` dengan file asli juga memeriksa hasil penjumlahan tiap
kolom terhadap baris **Total** di laporan, jadi salah parsing angka akan
langsung terlihat.

## Catatan

- File laporan berekstensi `.xls` tetapi isinya HTML table; parser membacanya
  sebagai HTML, termasuk saat ada tag yang tidak tertutup rapi.
- Permintaan ke Apps Script dikirim sebagai `text/plain` berisi JSON. Ini
  disengaja: Apps Script tidak melayani preflight CORS, sehingga `application/json`
  akan gagal di browser.
- Isi file tidak dikirim ke mana pun selain Apps Script milik spreadsheet ini.
  URL dan nama sheet disimpan di `localStorage` perangkat.

### Kalau upload gagal

| Pesan | Penyebab umum |
| --- | --- |
| `Balasan bukan JSON` | Deployment belum **Anyone**, atau URL bukan `/exec` |
| `Sheet "Sales" tidak ditemukan` | Nama sheet berbeda (perhatikan huruf besar/kecil) |
| `Failed to fetch` | Tidak ada koneksi, atau URL salah |
| Peringatan `urutan-kolom` | Header sheet tidak dikenali — cek **Periksa kolom sheet** |
