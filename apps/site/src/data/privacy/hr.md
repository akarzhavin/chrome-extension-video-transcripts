*Ovaj se prijevod odnosi na stariju verziju pravila i ne uključuje najnovije izmjene. Mjerodavna je engleska verzija na https://lingogram.ai/privacy/.*

# Pravila privatnosti — Lingogram: Dual Subtitles & Transcript for YouTube

**Datum stupanja na snagu:** 22. lipnja 2026.
**Zadnje ažurirano:** 13. srpnja 2026.

Ova Pravila privatnosti objašnjavaju koje informacije prikuplja proširenje
za preglednik **Lingogram: Dual Subtitles & Transcript for YouTube**
("Proširenje"), kako se ti podaci koriste, gdje se pohranjuju i koje su vaše
mogućnosti izbora.

---

## Sažetak

* **Bez računa, Proširenje o vama ne prikuplja ništa.** Interaktivni
  transkript, izazov slušanja, dvostruki titlovi i lokalno spremanje riječi
  u potpunosti se izvode unutar vašeg preglednika, a nikakvi osobni podaci
  se ne šalju nama.
* **Prijava je neobavezna.** Postoji isključivo radi sinkronizacije vašeg
  spremljenog vokabulara na više uređaja. Ako odaberete prijavu, prikupljamo
  vašu **adresu e-pošte** i u našoj oblak bazi podataka pohranjujemo
  **riječi koje izričito spremite** (zajedno s okolnim linijama titlova).
* **Dijagnostika je opcionalna, jednim klikom.** Ako se titlovi ne uspiju
  učitati, gumb za hitne slučajeve **"Ponovno učitaj stranicu"** (prikazuje
  se samo nakon neuspješnog ponovnog pokušaja) šalje nam jednim klikom
  dijagnostičko izvješće — adresu videozapisa i tehničke pojedinosti — kako
  bismo mogli riješiti problem. Traka s obavijesti to navodi točno pored
  gumba; ništa se ne prijavljuje automatski.
* **Ne** prodajemo vaše podatke, ne prikazujemo oglase, ne koristimo
  oglašivačke ili analitičke alate trećih strana za praćenje, niti pratimo
  vašu povijest pregledavanja.

---

## 1. Informacije koje prikupljamo

### a. Ako se **ne** prijavite
Proširenje **ne** prikuplja, prenosi niti pohranjuje nikakve osobne podatke
na našim poslužiteljima. Vaše postavke jezika i izgleda, kao i lokalni
brojač "spremljenih riječi", čuvaju se isključivo u vašem pregledniku
(pogledajte odjeljak 3). Nikakav račun, e-pošta ili spremljena riječ nikada
ne napuštaju vaš uređaj.

### b. Ako odaberete prijavu (neobavezan račun)
Prijava omogućuje sinkronizaciju vašeg spremljenog vokabulara na više
uređaja. Kada se prijavite, prikupljamo i obrađujemo:

* **Podatke o računu** — vašu **adresu e-pošte** i korisnički ID generiran
  putem Firebasea. Oni identificiraju vaš račun i povezuju vaše spremljene
  riječi s vama.
* **Spremljeni vokabular** — samo stavke koje izričito odlučite spremiti
  tijekom gledanja. Za svaku spremljenu stavku pohranjujemo:
  * **riječ ili izraz** koji ste odabrali;
  * malu količinu **konteksta titlova** — spremljenu liniju titla te liniju
    neposredno prije i poslije nje, isključivo na primarnom jeziku titlova
    videozapisa;
  * **oznaku izvora** koja označava koje je Proširenje spremilo stavku;
  * **vremensku oznaku** i dnevni brojač koji se koristi isključivo za
    provođenje dnevnog ograničenja spremanja.
* **Dijagnostička izvješća** — samo ako se titlovi ne uspiju učitati i vi
  izričito pritisnete gumb **"Ponovno učitaj stranicu"** na traci s
  obavijesti o pogrešci (koja navodi da će izvješće biti poslano). Svako
  izvješće sadrži: naziv hosta web-mjesta, adresu (URL) ili ID videozapisa
  na kojem se dogodila greška, par jezika titlova koji ste odabrali (jezik
  koji učite i vaš materinji jezik), verziju Proširenja, jezik sučelja vašeg
  preglednika, oznaku izvora koja identificira Proširenje te vremensku
  oznaku poslužitelja. Izvješća se šalju samo dok ste prijavljeni,
  ograničena su na jedno po računu dnevno, i koriste se isključivo za
  istragu greške.

Mi **ne** prikupljamo: vašu povijest pregledavanja, videozapise koje
gledate (osim teksta titlova koji izričito spremite i pojedinačne adrese
videozapisa uključene u dijagnostičko izvješće koje izričito pokrenete),
praćenje lokacije putem IP adrese, oglašivačke identifikatore, kolačiće za
praćenje, ili bilo kakvu analitiku o tome kako koristite Proširenje.

> Vaš Lingogram račun radi u svim našim ostalim Lingogram proširenjima; ako
> se prijavite istim računom, vaš spremljeni vokabular sinkronizirat će se
> zajedno.

## 2. Kako koristimo vaše informacije

Gore navedene informacije koristimo **isključivo** za:

* provjeru vašeg identiteta i održavanje vaše prijave kroz sesije;
* pohranu vašeg spremljenog vokabulara i njegovu sinkronizaciju na vašim
  uređajima kako biste ga kasnije mogli pregledati;
* provođenje razumnog dnevnog ograničenja spremljenih riječi radi
  sprječavanja zlouporabe;
* istraživanje grešaka pri učitavanju titlova koje izričito prijavite putem
  gumba **"Ponovno učitaj stranicu"**, kako bismo ih mogli ispraviti.

Vaše informacije ne koristimo za oglašavanje, profiliranje, niti za bilo
koju svrhu izvan pružanja ovdje opisanih značajki sinkronizacije i
dijagnostike.

## 3. Lokalna pohrana (na vašem uređaju)

Proširenje koristi prostor za pohranu proširenja vašeg preglednika
(`chrome.storage`) kako bi isključivo na vašem uređaju čuvalo:

* vaše postavke jezika i izgleda titlova;
* lokalni broj riječi koje ste spremili;
* ako ste prijavljeni: vaše autentifikacijske tokene, adresu e-pošte i
  korisnički ID (kako biste ostali prijavljeni), te kratkotrajni nonce za
  prijavu u pohrani sesije.

Ovi lokalni podaci nikada ne napuštaju vaš preglednik, osim u slučaju
opisanom u odjeljku 4 (spremljene riječi sinkronizirane u oblak). Odjava
uklanja autentifikacijske tokene, e-poštu i korisnički ID s vašeg uređaja.

## 4. Pohrana u oblaku i usluge trećih strana

Kada ste prijavljeni, vaš račun i spremljeni vokabular pohranjuju se putem
**Google Firebasea** (Firebase Authentication, Cloud Firestore i Secure
Token Service), kojim upravlja programer na Google Cloud infrastrukturi.
Google obrađuje te podatke kao naš pružatelj usluga; pogledajte Googleova
Pravila privatnosti na https://policies.google.com/privacy. Pristup je
ograničen Firestore sigurnosnim pravilima tako da možete čitati i pisati
isključivo vlastite podatke.

Za prikaz titlova, Proširenje čita zapise titlova koje YouTube player već
pruža za videozapis koji gledate, **izravno unutar vašeg preglednika**.
Ovo rukovanje titlovima:

* u potpunosti se odvija u vašem pregledniku, bez ikakvog posredničkog
  proxyja s naše strane;
* ne šalje podatke o računu niti spremljene riječi YouTubeu;
* podliježe vlastitim pravilima privatnosti i uvjetima YouTubea.

## 5. Dijeljenje i prodaja podataka

Mi **ne** prodajemo, iznajmljujemo niti trgujemo vašim osobnim podacima. Ne
dijelimo ih ni s jednom trećom stranom osim Google Firebasea kao pružatelja
infrastrukture opisanog u odjeljku 4, ili kada to zahtijeva zakon. Ne
koristimo vaše podatke za oglašavanje.

## 6. Zadržavanje i brisanje podataka

* **Spremljeni vokabular** zadržava se u oblaku dok ga ne izbrišete ili ne
  zatražite brisanje računa.
* **Dijagnostička izvješća** čuvaju se isključivo radi rješavanja problema
  i obuhvaćena su zahtjevima za brisanje računa (povezana su s vašim
  korisničkim ID-om).
* **Lokalni podaci** mogu se izbrisati u bilo kojem trenutku odjavom (čime
  se uklanjaju vaši tokeni, e-pošta i korisnički ID) ili uklanjanjem
  Proširenja iz preglednika.
* Za **brisanje vašeg računa i svih povezanih podataka u oblaku**
  (e-pošta, spremljene riječi i dijagnostička izvješća), kontaktirajte
  programera putem odjeljka 9. Podatke ćemo izbrisati u razumnom roku.

## 7. Sigurnost

Autentifikacijski tokeni čuvaju se u prostoru za pohranu proširenja vašeg
preglednika. Svi mrežni zahtjevi šalju se putem HTTPS-a. Podaci u oblaku
zaštićeni su Firebase Authenticationom i sigurnosnim pravilima Firestorea
koji ograničavaju svakog korisnika isključivo na vlastite zapise. Nijedna
metoda prijenosa ili pohrane nije 100% sigurna, no poduzimamo razumne mjere
za zaštitu vaših informacija.

## 8. Privatnost djece

Proširenje nije namijenjeno djeci mlađoj od 13 godina (ili ekvivalentnoj
minimalnoj dobi u vašoj jurisdikciji), i mi svjesno ne prikupljamo osobne
podatke od njih.

## 9. Izmjene ovih pravila

S vremena na vrijeme možemo ažurirati ova Pravila privatnosti. Bitne
promjene bit će prikazane ovdje s ažuriranim datumom "Zadnje ažurirano".
Nastavak korištenja Proširenja nakon ažuriranja predstavlja prihvaćanje
revidiranih pravila.

## 10. Kontakt

Za sva pitanja u vezi s ovim Pravilima privatnosti, ili za zahtjev za
brisanje vašeg računa i podataka, obratite se programeru putem službenog
repozitorija projekta ili putem stranice za podršku u Chrome Web Storeu za
Proširenje.

---

*Lingogram je nezavisni alat i nije povezan s, ovlašten niti podržan od
strane YouTubea ili bilo koje od videoplatformi koje podržava.*
