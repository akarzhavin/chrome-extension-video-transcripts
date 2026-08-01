# Politika privatnosti — Lingogram: Dual Subtitles & Transcript for YouTube

**Datum stupanja na snagu:** 22. jun 2026.
**Poslednje ažuriranje:** 13. jul 2026.

Ova Politika privatnosti objašnjava koje informacije prikuplja ekstenzija
za pregledač **Lingogram: Dual Subtitles & Transcript for YouTube**
("Ekstenzija"), kako se koriste, gde se čuvaju i koje opcije imate na
raspolaganju.

---

## TL;DR (ukratko)

* **Bez naloga, Ekstenzija ne prikuplja ništa o vama.** Interaktivni
  transkript, izazov slušanja, dvojni titlovi i lokalno čuvanje reči rade u
  potpunosti unutar vašeg pregledača, a lični podaci se nama ne šalju.
* **Prijavljivanje je opciono.** Postoji isključivo radi sinhronizacije
  vašeg sačuvanog rečnika na više uređaja. Ako se odlučite da se prijavite,
  prikupljamo vašu **imejl adresu** i čuvamo **reči koje izričito
  sačuvate** (zajedno sa okolnim linijama titla) u našoj bazi podataka u
  oblaku.
* **Dijagnostika je opciona, jednim klikom.** Ako se titlovi ne učitaju,
  dugme za hitne slučajeve **"Reload page"** (prikazuje se tek nakon
  neuspešnog ponovnog pokušaja) šalje nam dijagnostički izveštaj jednim
  klikom — adresu videa i tehničke detalje — kako bismo mogli da rešimo
  problem. To je jasno naznačeno na baneru odmah pored dugmeta; ništa se ne
  prijavljuje automatski.
* Vaše podatke **ne prodajemo**, ne prikazujemo oglase, ne koristimo
  reklamne ili analitičke alate za praćenje trećih strana i ne pratimo
  istoriju vašeg pregledanja.

---

## 1. Informacije koje prikupljamo

### a. Ako se **ne** prijavite
Ekstenzija **ne** prikuplja, ne prenosi niti čuva bilo kakve lične podatke
na našim serverima. Vaše jezičke postavke i postavke rasporeda, kao i
lokalni brojač "sačuvanih reči", čuvaju se samo u vašem pregledaču
(pogledajte odeljak 3). Nijedan nalog, imejl ili sačuvana reč nikada ne
napuštaju vaš uređaj.

### b. Ako se odlučite da se prijavite (opcioni nalog)
Prijavljivanje omogućava sinhronizaciju vašeg sačuvanog rečnika na više
uređaja. Kada se prijavite, prikupljamo i obrađujemo:

* **Podatke o nalogu** — vašu **imejl adresu** i korisnički ID generisan
  putem Firebase-a. Ovi podaci identifikuju vaš nalog i povezuju sačuvane
  reči sa vama.
* **Sačuvani rečnik** — samo stavke koje izričito odlučite da sačuvate dok
  gledate. Za svaku sačuvanu stavku čuvamo:
  * izabranu **reč ili frazu**;
  * malu količinu **konteksta titla** — sačuvanu liniju titla zajedno sa
    linijom neposredno pre i posle nje, samo na primarnom jeziku titla za
    dati video;
  * **oznaku izvora** koja označava koja je Ekstenzija sačuvala stavku;
  * **vremensku oznaku** i dnevni brojač koji se koristi isključivo za
    sprovođenje dnevnog ograničenja čuvanja.
* **Dijagnostičke izveštaje** — samo ako se titlovi ne učitaju i vi
  izričito pritisnete dugme **"Reload page"** na baneru sa greškom (koji
  navodi da će izveštaj biti poslat). Svaki izveštaj sadrži: naziv hosta
  veb-sajta, adresu (URL) ili ID videa na kojem je došlo do greške,
  izabrani jezički par titla (jezik koji učite i vaš maternji jezik),
  verziju Ekstenzije, jezik interfejsa vašeg pregledača, oznaku izvora
  koja identifikuje Ekstenziju i vremensku oznaku servera. Izveštaji se
  šalju samo dok ste prijavljeni, ograničeni su na jedan po nalogu dnevno i
  koriste se isključivo za istragu greške.

**Ne prikupljamo:** istoriju vašeg pregledanja, video-zapise koje gledate
(osim teksta titla koji izričito sačuvate i jedne adrese videa uključene u
dijagnostički izveštaj koji izričito pokrenete), praćenje lokacije na
osnovu IP adrese, reklamne identifikatore, kolačiće za praćenje ili bilo
kakvu analitiku o tome kako koristite Ekstenziju.

> Vaš Lingogram nalog radi i sa našim drugim Lingogram ekstenzijama; ako se
> prijavite istim nalogom, vaš sačuvani rečnik se sinhronizuje zajedno.

## 2. Kako koristimo vaše informacije

Gore navedene informacije koristimo **isključivo** da bismo:

* potvrdili vaš identitet i zadržali vas prijavljenim tokom sesija;
* sačuvali vaš rečnik i sinhronizovali ga na svim vašim uređajima kako
  biste ga kasnije mogli pregledati;
* sproveli razumno dnevno ograničenje sačuvanih reči radi sprečavanja
  zloupotrebe;
* istražili greške pri učitavanju titla koje izričito prijavite putem
  dugmeta **"Reload page"**, kako bismo ih mogli otkloniti.

Vaše informacije ne koristimo za oglašavanje, profilisanje niti bilo koju
drugu svrhu izvan pružanja ovde opisanih funkcija sinhronizacije i
dijagnostike.

## 3. Lokalno skladištenje (na vašem uređaju)

Ekstenzija koristi skladište pregledača za ekstenzije (`chrome.storage`) da
bi, samo na vašem uređaju, čuvala:

* vaše jezičke postavke i postavke rasporeda titla;
* lokalni brojač koliko ste reči sačuvali;
* ako ste prijavljeni: vaše tokene za autentifikaciju, vašu imejl adresu i
  vaš korisnički ID (kako biste ostali prijavljeni), kao i kratkotrajni
  nonce za prijavu u skladištu sesije.

Ovi lokalni podaci nikada ne napuštaju vaš pregledač, osim kako je opisano
u odeljku 4 (sačuvane reči sinhronizovane u oblak). Odjavljivanje uklanja
tokene za autentifikaciju, imejl i korisnički ID sa vašeg uređaja.

## 4. Skladištenje u oblaku i usluge trećih strana

Kada ste prijavljeni, vaš nalog i sačuvani rečnik čuvaju se pomoću
**Google Firebase** (Firebase Authentication, Cloud Firestore i Secure
Token Service), kojima upravlja programer na infrastrukturi Google Cloud.
Google obrađuje ove podatke kao naš pružalac usluga; pogledajte Google-ovu
Politiku privatnosti na https://policies.google.com/privacy. Pristup je
ograničen pravilima bezbednosti Firestore-a tako da možete čitati i
upisivati samo svoje sopstvene podatke.

Za prikaz titlova, Ekstenzija čita zapise titla (natpisa) koje YouTube
plejer već obezbeđuje za video koji gledate, **direktno unutar vašeg
pregledača**. Ovo rukovanje titlovima:

* odvija se u potpunosti u vašem pregledaču, bez ikakvog posredničkog
  proksija sa naše strane;
* ne šalje nikakve podatke o nalogu niti sačuvane reči ka YouTube-u;
* podleže sopstvenoj politici privatnosti i uslovima korišćenja YouTube-a.

## 5. Deljenje i prodaja podataka

Vaše lične podatke **ne prodajemo, ne iznajmljujemo niti razmenjujemo**.
Ne delimo ih ni sa jednom trećom stranom, osim sa Google Firebase-om kao
pružaocem infrastrukture opisanim u odeljku 4, ili kada to zahteva zakon.
Vaše podatke ne koristimo za oglašavanje.

## 6. Zadržavanje i brisanje podataka

* **Sačuvani rečnik** se čuva u oblaku dok ga ne obrišete ili ne zatražite
  brisanje naloga.
* **Dijagnostički izveštaji** se čuvaju isključivo radi rešavanja problema
  i obuhvaćeni su zahtevima za brisanje naloga (povezani su sa vašim
  korisničkim ID-om).
* **Lokalni podaci** mogu se obrisati u bilo kom trenutku odjavljivanjem
  (uklanja vaše tokene, imejl i korisnički ID) ili uklanjanjem Ekstenzije
  iz vašeg pregledača.
* Za **brisanje vašeg naloga i svih povezanih podataka u oblaku** (imejl,
  sačuvane reči i dijagnostičke izveštaje), kontaktirajte programera
  putem odeljka 9. Obrisaćemo ih u razumnom roku.

## 7. Bezbednost

Tokeni za autentifikaciju čuvaju se u skladištu pregledača za ekstenzije.
Svi mrežni zahtevi se obavljaju putem HTTPS-a. Podaci u oblaku su
zaštićeni pomoću Firebase Authentication i pravila bezbednosti
Firestore-a koja ograničavaju svakog korisnika samo na sopstvene zapise.
Nijedan način prenosa ili skladištenja nije 100% bezbedan, ali
preduzimamo razumne mere za zaštitu vaših informacija.

## 8. Privatnost dece

Ekstenzija nije namenjena deci mlađoj od 13 godina (ili odgovarajućem
minimalnom uzrastu u vašoj jurisdikciji), i mi svesno ne prikupljamo lične
podatke od njih.

## 9. Izmene ove Politike

Ovu Politiku privatnosti možemo s vremena na vreme ažurirati. Značajne
izmene će ovde biti prikazane sa ažuriranim datumom "Poslednje
ažuriranje". Nastavak korišćenja Ekstenzije nakon ažuriranja predstavlja
prihvatanje izmenjene politike.

## 10. Kontakt

Za sva pitanja u vezi sa ovom Politikom privatnosti, ili da biste
zatražili brisanje svog naloga i podataka, kontaktirajte programera preko
zvaničnog repozitorijuma projekta ili preko stranice podrške Chrome Web
Store-a za Ekstenziju.

---

*Lingogram je nezavisan alat i nije povezan sa, ovlašćen niti podržan od
strane YouTube-a ili bilo koje video platforme koju podržava.*
