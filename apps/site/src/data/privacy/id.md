*Terjemahan ini mengacu pada versi kebijakan yang lebih lama dan belum memuat perubahan terbaru. Versi bahasa Inggris di https://lingogram.ai/privacy/ adalah versi yang berlaku.*

# Kebijakan Privasi — Lingogram: Dual Subtitles & Transcript for YouTube

**Tanggal berlaku:** 22 Juni 2026
**Terakhir diperbarui:** 13 Juli 2026

Kebijakan Privasi ini menjelaskan informasi apa yang dikumpulkan oleh
ekstensi browser **Lingogram: Dual Subtitles & Transcript for YouTube**
("Ekstensi"), bagaimana informasi tersebut digunakan, di mana disimpan, dan
pilihan apa yang Anda miliki.

---

## Ringkasan

* **Tanpa akun, Ekstensi tidak mengumpulkan apa pun tentang Anda.**
  Transkrip interaktif, tantangan mendengarkan, subtitle ganda, dan
  penyimpanan kata secara lokal semuanya berjalan sepenuhnya di dalam
  browser Anda, dan tidak ada data pribadi yang dikirim kepada kami.
* **Masuk (sign in) bersifat opsional.** Fitur ini hanya ada untuk
  menyinkronkan kosakata tersimpan Anda di berbagai perangkat. Jika Anda
  memilih untuk masuk, kami mengumpulkan **alamat email** Anda dan
  menyimpan **kata-kata yang secara eksplisit Anda simpan** (beserta baris
  subtitle di sekitarnya) di database cloud kami.
* **Diagnostik bersifat opt-in, hanya satu klik.** Jika subtitle gagal
  dimuat, tombol darurat **"Muat ulang halaman"** (hanya muncul setelah
  percobaan ulang yang gagal) mengirimkan laporan diagnostik dengan satu
  klik kepada kami — alamat video beserta detail teknis — agar kami dapat
  memperbaiki masalah tersebut. Banner menyatakan hal ini tepat di sebelah
  tombol; tidak ada yang dilaporkan secara otomatis.
* Kami **tidak** menjual data Anda, tidak menampilkan iklan, tidak
  menjalankan pelacak iklan atau analitik pihak ketiga, dan tidak melacak
  riwayat penjelajahan Anda.

---

## 1. Informasi yang Kami Kumpulkan

### a. Jika Anda **tidak** masuk (sign in)
Ekstensi **tidak** mengumpulkan, mengirimkan, atau menyimpan data pribadi
apa pun di server kami. Preferensi bahasa dan tata letak Anda, serta
penghitung "kata tersimpan" lokal, hanya disimpan di browser Anda (lihat
Bagian 3). Tidak ada akun, email, atau kata tersimpan yang pernah
meninggalkan perangkat Anda.

### b. Jika Anda memilih untuk masuk (akun opsional)
Masuk (sign in) memungkinkan sinkronisasi kosakata tersimpan Anda antar
perangkat. Saat Anda masuk, kami mengumpulkan dan memproses:

* **Data akun** — **alamat email** Anda dan ID pengguna yang dihasilkan oleh
  Firebase. Data ini mengidentifikasi akun Anda dan mengaitkan kata-kata
  tersimpan Anda dengan Anda.
* **Kosakata tersimpan** — hanya item yang secara eksplisit Anda pilih untuk
  disimpan saat menonton. Untuk setiap item yang disimpan, kami menyimpan:
  * **kata atau frasa** yang Anda pilih;
  * sejumlah kecil **konteks subtitle** — baris subtitle yang disimpan
    beserta baris tepat sebelum dan sesudahnya, hanya dalam bahasa subtitle
    utama video;
  * **tag sumber** yang menunjukkan Ekstensi mana yang menyimpannya;
  * **stempel waktu (timestamp)** dan penghitung per hari yang hanya
    digunakan untuk menegakkan batas penyimpanan harian.
* **Laporan diagnostik** — hanya jika subtitle gagal dimuat dan Anda secara
  eksplisit menekan tombol **"Muat ulang halaman"** pada banner kesalahan
  (yang menyatakan bahwa laporan akan dikirim). Setiap laporan berisi: nama
  host situs web, alamat (URL) atau ID video tempat terjadinya kegagalan,
  pasangan bahasa subtitle yang Anda pilih (bahasa yang sedang Anda pelajari
  dan bahasa ibu Anda), versi Ekstensi, bahasa antarmuka browser Anda, tag
  sumber yang mengidentifikasi Ekstensi, dan stempel waktu server. Laporan
  hanya dikirim saat Anda masuk (signed in), dibatasi hingga satu per akun
  per hari, dan digunakan semata-mata untuk menyelidiki kegagalan tersebut.

Kami **tidak** mengumpulkan: riwayat penjelajahan Anda, video yang Anda
tonton (selain teks subtitle yang secara eksplisit Anda simpan dan satu
alamat video yang disertakan dalam laporan diagnostik yang Anda picu secara
eksplisit), pelacakan lokasi berbasis IP, pengidentifikasi iklan, cookie
untuk pelacakan, atau analitik apa pun tentang bagaimana Anda menggunakan
Ekstensi.

> Akun Lingogram Anda berfungsi di ekstensi Lingogram kami yang lain; jika
> Anda masuk dengan akun yang sama, kosakata tersimpan Anda akan
> disinkronkan bersama.

## 2. Bagaimana Kami Menggunakan Informasi Anda

Kami menggunakan informasi di atas **hanya** untuk:

* mengautentikasi Anda dan membuat Anda tetap masuk (signed in) di seluruh
  sesi;
* menyimpan kosakata tersimpan Anda dan menyinkronkannya di seluruh
  perangkat Anda sehingga Anda dapat meninjaunya nanti;
* menegakkan batas harian yang wajar pada kata-kata tersimpan untuk
  mencegah penyalahgunaan;
* menyelidiki kegagalan pemuatan subtitle yang secara eksplisit Anda
  laporkan melalui tombol **"Muat ulang halaman"**, agar kami dapat
  memperbaikinya.

Kami tidak menggunakan informasi Anda untuk iklan, pembuatan profil
(profiling), atau tujuan apa pun di luar penyediaan fitur sinkronisasi dan
diagnostik yang dijelaskan di sini.

## 3. Penyimpanan Lokal (di Perangkat Anda)

Ekstensi menggunakan penyimpanan ekstensi browser Anda (`chrome.storage`)
untuk menyimpan, hanya di perangkat Anda:

* preferensi bahasa dan tata letak subtitle Anda;
* jumlah lokal berapa banyak kata yang telah Anda simpan;
* jika Anda masuk (signed in): token autentikasi Anda, alamat email Anda,
  dan ID pengguna Anda (agar Anda tetap masuk), dan nonce sign-in berumur
  singkat dalam penyimpanan sesi.

Data lokal ini tidak pernah meninggalkan browser Anda kecuali sebagaimana
dijelaskan dalam Bagian 4 (kata tersimpan yang disinkronkan ke cloud).
Keluar (sign out) menghapus token autentikasi, email, dan ID pengguna dari
perangkat Anda.

## 4. Penyimpanan Cloud dan Layanan Pihak Ketiga

Saat Anda masuk (signed in), akun dan kosakata tersimpan Anda disimpan
menggunakan **Google Firebase** (Firebase Authentication, Cloud Firestore,
dan Secure Token Service), yang dioperasikan oleh pengembang pada
infrastruktur Google Cloud. Google memproses data ini sebagai penyedia
layanan kami; lihat Kebijakan Privasi Google di
https://policies.google.com/privacy. Akses dibatasi oleh aturan keamanan
Firestore sehingga Anda hanya dapat membaca dan menulis data Anda sendiri.

Untuk menampilkan subtitle, Ekstensi membaca trek subtitle (caption) yang
sudah disediakan oleh pemutar YouTube untuk video yang Anda tonton,
**langsung di dalam browser Anda**. Penanganan subtitle ini:

* terjadi sepenuhnya di browser Anda, tanpa proxy perantara apa pun dari
  kami;
* tidak mengirimkan data akun atau kata tersimpan ke YouTube;
* tunduk pada kebijakan privasi dan persyaratan YouTube sendiri.

## 5. Berbagi dan Penjualan Data

Kami **tidak** menjual, menyewakan, atau memperdagangkan data pribadi Anda.
Kami tidak membagikannya dengan pihak ketiga mana pun kecuali Google
Firebase sebagai penyedia infrastruktur yang dijelaskan di Bagian 4, atau
jika diwajibkan oleh hukum. Kami tidak menggunakan data Anda untuk iklan.

## 6. Retensi dan Penghapusan Data

* **Kosakata tersimpan** disimpan di cloud hingga Anda menghapusnya atau
  meminta penghapusan akun.
* **Laporan diagnostik** disimpan hanya untuk keperluan pemecahan masalah
  dan tercakup dalam permintaan penghapusan akun (laporan tersebut ditandai
  dengan ID pengguna Anda).
* **Data lokal** dapat dihapus kapan saja dengan keluar (sign out)
  (menghapus token, email, dan ID pengguna Anda) atau dengan menghapus
  Ekstensi dari browser Anda.
* Untuk **menghapus akun Anda dan semua data cloud terkait** (email, kata
  tersimpan, dan laporan diagnostik), hubungi pengembang melalui Bagian 9.
  Kami akan menghapusnya dalam jangka waktu yang wajar.

## 7. Keamanan

Token autentikasi disimpan dalam penyimpanan ekstensi browser Anda. Semua
permintaan jaringan dilakukan melalui HTTPS. Data cloud dilindungi oleh
Firebase Authentication dan aturan keamanan Firestore yang membatasi setiap
pengguna hanya pada catatan miliknya sendiri. Tidak ada metode transmisi
atau penyimpanan yang 100% aman, tetapi kami mengambil langkah-langkah yang
wajar untuk melindungi informasi Anda.

## 8. Privasi Anak-Anak

Ekstensi ini tidak ditujukan untuk anak-anak di bawah usia 13 tahun (atau
usia minimum setara di yurisdiksi Anda), dan kami tidak dengan sengaja
mengumpulkan data pribadi dari mereka.

## 9. Perubahan pada Kebijakan Ini

Kami dapat memperbarui Kebijakan Privasi ini dari waktu ke waktu. Perubahan
material akan tercermin di sini dengan tanggal "Terakhir diperbarui" yang
diperbarui. Penggunaan berkelanjutan atas Ekstensi setelah pembaruan
merupakan penerimaan atas kebijakan yang direvisi.

## 10. Kontak

Untuk pertanyaan apa pun tentang Kebijakan Privasi ini, atau untuk meminta
penghapusan akun dan data Anda, silakan hubungi pengembang melalui
repositori resmi proyek atau melalui halaman dukungan Chrome Web Store
untuk Ekstensi.

---

*Lingogram adalah alat independen dan tidak berafiliasi, diotorisasi, atau
didukung oleh YouTube atau platform video mana pun yang didukungnya.*
