# Pravilnik o zasebnosti — Lingogram: Dual Subtitles & Transcript for YouTube

**Datum začetka veljavnosti:** 22. junij 2026
**Nazadnje posodobljeno:** 13. julij 2026

Ta Pravilnik o zasebnosti pojasnjuje, katere podatke zbira razširitev
brskalnika **Lingogram: Dual Subtitles & Transcript for YouTube**
("Razširitev"), kako se uporabljajo, kje se shranjujejo in kakšne izbire
imate na voljo.

---

## Povzetek (TL;DR)

* **Brez računa Razširitev o vas ne zbira ničesar.** Interaktivni prepis,
  poslušalski izziv, dvojni podnapisi in lokalno shranjevanje besed
  potekajo v celoti znotraj vašega brskalnika, osebni podatki pa se nam ne
  pošiljajo.
* **Prijava je neobvezna.** Obstaja izključno zaradi sinhronizacije vašega
  shranjenega besedišča med napravami. Če se odločite za prijavo, zbiramo
  vaš **e-poštni naslov** in v naši oblačni bazi podatkov shranjujemo
  **besede, ki jih izrecno shranite** (skupaj z okoliškimi vrsticami
  podnapisov).
* **Diagnostika je prostovoljna, z enim klikom.** Če se podnapisi ne
  naložijo, gumb za nujne primere **"Reload page"** (prikazan šele po
  neuspešnem ponovnem poskusu) pošlje diagnostično poročilo z enim klikom —
  naslov videoposnetka in tehnične podrobnosti — da lahko odpravimo težavo.
  To je jasno navedeno na pasici poleg gumba; nič se ne poroča samodejno.
* Vaših podatkov **ne prodajamo**, ne prikazujemo oglasov, ne uporabljamo
  oglaševalskih ali analitičnih sledilnikov tretjih oseb in ne sledimo
  vaši zgodovini brskanja.

---

## 1. Podatki, ki jih zbiramo

### a. Če se **ne** prijavite
Razširitev na naših strežnikih **ne** zbira, prenaša ali shranjuje nobenih
osebnih podatkov. Vaše jezikovne nastavitve in nastavitve postavitve ter
lokalni števec "shranjenih besed" se hranijo samo v vašem brskalniku
(glejte poglavje 3). Noben račun, e-poštni naslov ali shranjena beseda
nikoli ne zapusti vaše naprave.

### b. Če se odločite za prijavo (neobvezen račun)
Prijava omogoča sinhronizacijo vašega shranjenega besedišča med napravami.
Ob prijavi zbiramo in obdelujemo:

* **Podatke o računu** — vaš **e-poštni naslov** in uporabniški ID, ki ga
  ustvari Firebase. Ti podatki identificirajo vaš račun in povezujejo
  shranjene besede z vami.
* **Shranjeno besedišče** — samo elemente, ki jih med gledanjem izrecno
  izberete za shranjevanje. Za vsak shranjen element shranimo:
  * izbrano **besedo ali frazo**;
  * majhno količino **konteksta podnapisov** — shranjeno vrstico podnapisa
    ter vrstico neposredno pred njo in za njo, samo v primarnem jeziku
    podnapisov videoposnetka;
  * **oznako vira**, ki označuje Razširitev, ki je element shranila;
  * **časovni žig** in dnevni števec, ki se uporablja izključno za
    uveljavljanje dnevne omejitve shranjevanja.
* **Diagnostična poročila** — samo če se podnapisi ne naložijo in izrecno
  pritisnete gumb **"Reload page"** na pasici z napako (ki navaja, da bo
  poročilo poslano). Vsako poročilo vsebuje: ime gostitelja spletnega
  mesta, naslov (URL) ali ID videoposnetka, na katerem je prišlo do napake,
  izbrani jezikovni par podnapisov (jezik, ki se ga učite, in vaš materni
  jezik), različico Razširitve, jezik vmesnika vašega brskalnika, oznako
  vira, ki identificira Razširitev, in časovni žig strežnika. Poročila se
  pošiljajo samo, ko ste prijavljeni, omejena so na eno na račun na dan in
  se uporabljajo izključno za preiskavo napake.

**Ne zbiramo:** vaše zgodovine brskanja, videoposnetkov, ki jih gledate
(razen besedila podnapisov, ki ga izrecno shranite, in enega naslova
videoposnetka, vključenega v diagnostično poročilo, ki ga izrecno
sprožite), sledenja lokaciji na podlagi IP-naslova, oglaševalskih
identifikatorjev, sledilnih piškotkov ali kakršne koli analitike o tem,
kako uporabljate Razširitev.

> Vaš račun Lingogram deluje tudi pri naših drugih razširitvah Lingogram;
> če se prijavite z istim računom, se vaše shranjeno besedišče
> sinhronizira skupaj.

## 2. Kako uporabljamo vaše podatke

Zgoraj navedene podatke uporabljamo **izključno** za:

* preverjanje vaše pristnosti in ohranjanje prijave med sejami;
* shranjevanje vašega shranjenega besedišča in njegovo sinhronizacijo med
  vašimi napravami, da si ga lahko pozneje ogledate;
* uveljavljanje razumne dnevne omejitve shranjenih besed za preprečevanje
  zlorabe;
* preiskovanje napak pri nalaganju podnapisov, ki jih izrecno prijavite z
  gumbom **"Reload page"**, da jih lahko odpravimo.

Vaših podatkov ne uporabljamo za oglaševanje, profiliranje ali kateri koli
drug namen, ki presega zagotavljanje tukaj opisanih funkcij sinhronizacije
in diagnostike.

## 3. Lokalno shranjevanje (v vaši napravi)

Razširitev uporablja shrambo brskalnika za razširitve (`chrome.storage`),
kjer samo v vaši napravi hrani:

* vaše jezikovne nastavitve in nastavitve postavitve podnapisov;
* lokalni števec, koliko besed ste shranili;
* če ste prijavljeni: vaše žetone za preverjanje pristnosti, vaš
  e-poštni naslov in vaš uporabniški ID (da ostanete prijavljeni) ter
  kratkotrajni prijavni nonce v shrambi seje.

Ti lokalni podatki nikoli ne zapustijo vašega brskalnika, razen kot je
opisano v poglavju 4 (shranjene besede, sinhronizirane v oblak). Odjava
odstrani žetone za preverjanje pristnosti, e-poštni naslov in uporabniški
ID z vaše naprave.

## 4. Oblačno shranjevanje in storitve tretjih oseb

Ko ste prijavljeni, se vaš račun in shranjeno besedišče shranjujejo s
pomočjo **Google Firebase** (Firebase Authentication, Cloud Firestore in
Secure Token Service), ki jih upravlja razvijalec na infrastrukturi Google
Cloud. Google te podatke obdeluje kot naš ponudnik storitev; glejte
Googlov Pravilnik o zasebnosti na https://policies.google.com/privacy.
Dostop je omejen s pravili varnosti Firestore, tako da lahko berete in
zapisujete samo svoje lastne podatke.

Za prikaz podnapisov Razširitev bere sledi podnapisov, ki jih predvajalnik
YouTube že zagotavlja za videoposnetek, ki ga gledate, **neposredno znotraj
vašega brskalnika**. To ravnanje s podnapisi:

* poteka v celoti v vašem brskalniku, brez kakršnega koli našega vmesnega
  posredniškega strežnika;
* ne pošilja nobenih podatkov o računu ali shranjenih besed na YouTube;
* zanj veljajo lastni pravilnik o zasebnosti in pogoji uporabe YouTuba.

## 5. Deljenje in prodaja podatkov

Vaših osebnih podatkov **ne prodajamo, ne oddajamo v najem in ne
trgujemo** z njimi. Ne delimo jih z nobeno tretjo osebo, razen z Google
Firebase kot ponudnikom infrastrukture, opisanim v poglavju 4, ali kadar
to zahteva zakon. Vaših podatkov ne uporabljamo za oglaševanje.

## 6. Hramba in izbris podatkov

* **Shranjeno besedišče** se v oblaku hrani, dokler ga ne izbrišete ali
  zahtevate izbrisa računa.
* **Diagnostična poročila** se hranijo izključno za odpravljanje težav in
  jih zajema zahteva za izbris računa (povezana so z vašim uporabniškim
  ID-jem).
* **Lokalne podatke** lahko kadar koli izbrišete z odjavo (odstrani vaše
  žetone, e-poštni naslov in uporabniški ID) ali z odstranitvijo
  Razširitve iz vašega brskalnika.
* Za **izbris svojega računa in vseh povezanih oblačnih podatkov**
  (e-poštnega naslova, shranjenih besed in diagnostičnih poročil)
  kontaktirajte razvijalca s pomočjo poglavja 9. Podatke bomo izbrisali v
  razumnem roku.

## 7. Varnost

Žetoni za preverjanje pristnosti se hranijo v shrambi brskalnika za
razširitve. Vse omrežne zahteve potekajo prek HTTPS. Oblačni podatki so
zaščiteni s Firebase Authentication in pravili varnosti Firestore, ki
vsakega uporabnika omejujejo na njegove lastne zapise. Noben način
prenosa ali shranjevanja ni 100-odstotno varen, vendar sprejemamo razumne
ukrepe za zaščito vaših podatkov.

## 8. Zasebnost otrok

Razširitev ni namenjena otrokom, mlajšim od 13 let (ali ustrezni najnižji
starosti v vaši jurisdikciji), in od njih zavestno ne zbiramo osebnih
podatkov.

## 9. Spremembe tega pravilnika

Ta Pravilnik o zasebnosti lahko občasno posodobimo. Bistvene spremembe
bodo tukaj označene s posodobljenim datumom "Nazadnje posodobljeno".
Nadaljnja uporaba Razširitve po posodobitvi pomeni sprejetje spremenjenega
pravilnika.

## 10. Stik

Za kakršna koli vprašanja o tem Pravilniku o zasebnosti ali za zahtevo za
izbris vašega računa in podatkov se obrnite na razvijalca prek uradnega
repozitorija projekta ali prek strani za podporo Chrome Web Store za
Razširitev.

---

*Lingogram je neodvisno orodje in ni povezan, pooblaščen ali podprt s
strani YouTuba ali katere koli druge video platforme, ki jo podpira.*
