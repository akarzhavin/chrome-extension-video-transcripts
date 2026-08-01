# Dasar Privasi — Lingogram: Dual Subtitles & Transcript for YouTube

**Tarikh berkuat kuasa:** 22 Jun 2026
**Kemas kini terakhir:** 13 Julai 2026

Dasar Privasi ini menerangkan maklumat yang dikumpulkan oleh sambungan pelayar **Lingogram: Dual Subtitles & Transcript for YouTube** ("Sambungan"), cara ia digunakan, di mana ia disimpan, dan pilihan yang anda ada.

---

## Ringkasan (TL;DR)

* **Tanpa akaun, Sambungan tidak mengumpul apa-apa pun tentang anda.** Transkrip interaktif, cabaran mendengar, sari kata dwibahasa, dan penyimpanan perkataan tempatan semuanya berjalan sepenuhnya di dalam pelayar anda, dan tiada data peribadi dihantar kepada kami.
* **Log masuk adalah pilihan.** Ia wujud semata-mata untuk menyegerakkan perbendaharaan kata yang disimpan merentasi peranti. Jika anda memilih untuk log masuk, kami mengumpul **alamat e-mel** anda dan menyimpan **perkataan yang anda simpan secara eksplisit** (berserta baris sari kata sekeliling) dalam pangkalan data awan kami.
* **Diagnostik adalah opt-in, satu klik sahaja.** Jika sari kata gagal dimuatkan, butang kecemasan **"Muat semula halaman"** (yang hanya dipaparkan selepas percubaan semula gagal) menghantar laporan diagnostik satu klik kepada kami — alamat video dan butiran teknikal — supaya kami dapat menyelesaikan masalah tersebut. Sepanduk tersebut menyatakan perkara ini tepat di sebelah butang; tiada apa yang dilaporkan secara automatik.
* Kami **tidak** menjual data anda, memaparkan iklan, menjalankan penjejak pengiklanan atau analitik pihak ketiga, atau menjejaki sejarah pelayaran anda.

---

## 1. Maklumat yang Kami Kumpulkan

### a. Jika anda **tidak** log masuk
Sambungan **tidak** mengumpul, menghantar, atau menyimpan sebarang data peribadi pada pelayan kami. Keutamaan bahasa dan susun atur anda serta kaunter "perkataan disimpan" tempatan hanya disimpan dalam pelayar anda (lihat Seksyen 3). Tiada akaun, e-mel, atau perkataan yang disimpan akan meninggalkan peranti anda.

### b. Jika anda memilih untuk log masuk (akaun pilihan)
Log masuk membolehkan penyegerakan perbendaharaan kata yang disimpan merentasi peranti. Apabila anda log masuk, kami mengumpul dan memproses:

* **Data akaun** — **alamat e-mel** anda dan ID pengguna yang dijana oleh Firebase. Ini mengenal pasti akaun anda dan mengaitkan perkataan yang disimpan dengan anda.
* **Perbendaharaan kata yang disimpan** — hanya item yang anda pilih secara eksplisit untuk disimpan semasa menonton. Bagi setiap item yang disimpan, kami menyimpan:
  * **perkataan atau frasa** yang anda pilih;
  * sedikit **konteks sari kata** — baris sari kata yang disimpan berserta baris sebelum dan selepasnya sahaja, dalam bahasa sari kata utama video sahaja;
  * **tag sumber** yang menunjukkan Sambungan yang menyimpannya;
  * **cap masa** dan kaunter harian yang digunakan semata-mata untuk menguatkuasakan had penyimpanan harian.
* **Laporan diagnostik** — hanya jika sari kata gagal dimuatkan dan anda menekan butang **"Muat semula halaman"** pada sepanduk ralat secara eksplisit (yang menyatakan bahawa laporan akan dihantar). Setiap laporan mengandungi: nama hos laman web, alamat (URL) atau ID video tempat kegagalan berlaku, pasangan bahasa sari kata yang anda pilih (bahasa yang anda pelajari dan bahasa ibunda anda), versi Sambungan, bahasa antara muka pelayar anda, tag sumber yang mengenal pasti Sambungan, dan cap masa pelayan. Laporan hanya dihantar semasa anda log masuk, dihadkan kepada satu bagi setiap akaun setiap hari, dan digunakan semata-mata untuk menyiasat kegagalan tersebut.

Kami **tidak** mengumpul: sejarah pelayaran anda, video yang anda tonton (selain teks sari kata yang anda simpan secara eksplisit dan satu alamat video yang disertakan dalam laporan diagnostik yang anda cetuskan secara eksplisit), penjejakan lokasi berasaskan IP, pengecam pengiklanan, kuki penjejakan, atau sebarang analitik tentang cara anda menggunakan Sambungan.

> Akaun Lingogram anda berfungsi merentasi sambungan Lingogram kami yang lain; jika anda log masuk dengan akaun yang sama, perbendaharaan kata yang anda simpan akan disegerakkan bersama.

## 2. Cara Kami Menggunakan Maklumat Anda

Kami menggunakan maklumat di atas **hanya** untuk:

* mengesahkan identiti anda dan mengekalkan anda log masuk merentasi sesi;
* menyimpan perbendaharaan kata yang anda simpan dan menyegerakkannya merentasi peranti anda supaya anda boleh menyemaknya kemudian;
* menguatkuasakan had harian yang munasabah bagi perkataan yang disimpan untuk mencegah penyalahgunaan;
* menyiasat kegagalan pemuatan sari kata yang anda laporkan secara eksplisit melalui butang **"Muat semula halaman"**, supaya kami dapat membaikinya.

Kami tidak menggunakan maklumat anda untuk pengiklanan, pemprofilan, atau sebarang tujuan lain di luar ciri penyegerakan dan diagnostik yang diterangkan di sini.

## 3. Storan Tempatan (Pada Peranti Anda)

Sambungan menggunakan storan sambungan pelayar anda (`chrome.storage`) untuk menyimpan, hanya pada peranti anda:

* keutamaan bahasa dan susun atur sari kata anda;
* kiraan tempatan bilangan perkataan yang telah anda simpan;
* jika anda log masuk: token pengesahan anda, alamat e-mel anda, dan ID pengguna anda (supaya anda kekal log masuk), serta nonce log masuk sementara dalam storan sesi.

Data tempatan ini tidak akan meninggalkan pelayar anda kecuali seperti yang diterangkan dalam Seksyen 4 (perkataan yang disimpan disegerakkan ke awan). Log keluar akan mengalih keluar token pengesahan, e-mel, dan ID pengguna daripada peranti anda.

## 4. Storan Awan dan Perkhidmatan Pihak Ketiga

Apabila anda log masuk, akaun dan perbendaharaan kata yang disimpan disimpan menggunakan **Google Firebase** (Firebase Authentication, Cloud Firestore, dan Secure Token Service), yang dikendalikan oleh pembangun pada infrastruktur Google Cloud. Google memproses data ini sebagai penyedia perkhidmatan kami; lihat Dasar Privasi Google di https://policies.google.com/privacy. Akses dihadkan oleh peraturan keselamatan Firestore supaya anda hanya boleh membaca dan menulis data anda sendiri.

Untuk memaparkan sari kata, Sambungan membaca trek sari kata (kapsyen) yang telah disediakan oleh pemain YouTube bagi video yang sedang anda tonton, **secara langsung di dalam pelayar anda**. Pengendalian sari kata ini:

* berlaku sepenuhnya di dalam pelayar anda, tanpa sebarang proksi perantaraan daripada kami;
* tidak menghantar sebarang data akaun atau perkataan yang disimpan kepada YouTube;
* tertakluk kepada dasar privasi dan terma YouTube sendiri.

## 5. Perkongsian dan Penjualan Data

Kami **tidak** menjual, menyewakan, atau berdagang data peribadi anda. Kami tidak berkongsi data anda dengan mana-mana pihak ketiga kecuali Google Firebase sebagai penyedia infrastruktur yang diterangkan dalam Seksyen 4, atau apabila dikehendaki oleh undang-undang. Kami tidak menggunakan data anda untuk pengiklanan.

## 6. Pengekalan dan Pemadaman Data

* **Perbendaharaan kata yang disimpan** dikekalkan di awan sehingga anda memadamkannya atau meminta pemadaman akaun.
* **Laporan diagnostik** disimpan hanya untuk tujuan penyelesaian masalah dan dilindungi oleh permintaan pemadaman akaun (ia dikaitkan dengan ID pengguna anda).
* **Data tempatan** boleh dikosongkan pada bila-bila masa dengan log keluar (mengalih keluar token, e-mel, dan ID pengguna anda) atau dengan mengalih keluar Sambungan daripada pelayar anda.
* Untuk **memadamkan akaun anda dan semua data awan yang berkaitan** (e-mel, perkataan yang disimpan, dan laporan diagnostik), hubungi pembangun menggunakan Seksyen 9. Kami akan memadamkannya dalam tempoh yang munasabah.

## 7. Keselamatan

Token pengesahan disimpan dalam storan sambungan pelayar anda. Semua permintaan rangkaian dibuat melalui HTTPS. Data awan dilindungi oleh Firebase Authentication dan peraturan keselamatan Firestore yang menghadkan setiap pengguna kepada rekod mereka sendiri sahaja. Tiada kaedah penghantaran atau penyimpanan yang 100% selamat, tetapi kami mengambil langkah munasabah untuk melindungi maklumat anda.

## 8. Privasi Kanak-Kanak

Sambungan ini tidak ditujukan kepada kanak-kanak di bawah umur 13 tahun (atau umur minimum yang setara di bidang kuasa anda), dan kami tidak mengumpul data peribadi daripada mereka secara sengaja.

## 9. Perubahan kepada Dasar Ini

Kami mungkin mengemas kini Dasar Privasi ini dari semasa ke semasa. Perubahan penting akan dicerminkan di sini dengan tarikh "Kemas kini terakhir" yang dikemas kini. Penggunaan berterusan Sambungan selepas kemas kini merupakan penerimaan terhadap dasar yang disemak.

## 10. Hubungi Kami

Untuk sebarang pertanyaan mengenai Dasar Privasi ini, atau untuk meminta pemadaman akaun dan data anda, sila hubungi pembangun melalui repositori rasmi projek atau melalui halaman sokongan Chrome Web Store untuk Sambungan tersebut.

---

*Lingogram adalah alat bebas dan tidak bergabung, dibenarkan, atau disokong oleh YouTube atau mana-mana platform video yang disokongnya.*
