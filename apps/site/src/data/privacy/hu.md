# Adatvédelmi szabályzat — Lingogram: Dual Subtitles & Transcript for YouTube

**Hatálybalépés dátuma:** 2026. június 22.
**Utolsó frissítés:** 2026. július 13.

Ez az Adatvédelmi szabályzat elmagyarázza, milyen információkat gyűjt a
**Lingogram: Dual Subtitles & Transcript for YouTube** böngészőbővítmény
("a Bővítmény"), hogyan használja fel azokat, hol tárolja őket, és milyen
választási lehetőségeid vannak.

---

## Röviden

* **Fiók nélkül a Bővítmény semmit sem gyűjt rólad.** Az interaktív
  átirat, a hallásértési kihívás, a kettős feliratok és a helyi szómentés
  teljes egészében a böngésződön belül fut, és semmilyen személyes adat nem
  kerül hozzánk elküldésre.
* **A bejelentkezés opcionális.** Kizárólag azért létezik, hogy a mentett
  szókincsedet szinkronizálja a különböző eszközök között. Ha úgy döntesz,
  hogy bejelentkezel, összegyűjtjük az **e-mail-címedet**, és felhő
  adatbázisunkban tároljuk **az általad kifejezetten elmentett szavakat**
  (a környező felirat sorokkal együtt).
* **A diagnosztika opt-in jellegű, egy kattintással.** Ha a feliratok
  betöltése sikertelen, egy vészhelyzeti **"Oldal újratöltése"** gomb (amely
  csak egy sikertelen újrapróbálkozás után jelenik meg) egy kattintással
  diagnosztikai jelentést küld nekünk — a videó címét és technikai
  részleteket —, hogy megoldhassuk a problémát. A banner erről közvetlenül a
  gomb mellett tájékoztat; semmi sem kerül automatikusan jelentésre.
* **Nem** adjuk el az adataidat, nem jelenítünk meg hirdetéseket, nem
  üzemeltetünk harmadik féltől származó hirdetési vagy elemzési
  nyomkövetőket, és nem követjük a böngészési előzményeidet.

---

## 1. Az általunk gyűjtött információk

### a. Ha **nem** jelentkezel be
A Bővítmény **nem** gyűjt, nem továbbít és nem tárol semmilyen személyes
adatot a szervereinken. A nyelvi és elrendezési beállításaid, valamint egy
helyi "mentett szavak" számláló kizárólag a böngésződben kerül tárolásra
(lásd a 3. szakaszt). Fiók, e-mail-cím vagy mentett szó soha nem hagyja el
az eszközödet.

### b. Ha úgy döntesz, hogy bejelentkezel (opcionális fiók)
A bejelentkezés lehetővé teszi a mentett szókincsed eszközök közötti
szinkronizálását. Bejelentkezéskor az alábbiakat gyűjtjük és dolgozzuk fel:

* **Fiókadatok** — az **e-mail-címed** és egy Firebase által generált
  felhasználói azonosító. Ezek azonosítják a fiókodat, és hozzád kötik a
  mentett szavaidat.
* **Mentett szókincs** — kizárólag azok az elemek, amelyeket nézés közben
  kifejezetten elmentesz. Minden mentett elemhez tároljuk:
  * a kiválasztott **szót vagy kifejezést**;
  * kis mennyiségű **feliratkontextust** — a mentett felirat sort, valamint
    a közvetlenül előtte és utána következő sort, kizárólag a videó elsődleges
    feliratnyelvén;
  * egy **forráscímkét**, amely jelzi, melyik Bővítmény mentette;
  * egy **időbélyeget** és egy napi számlálót, amelyet kizárólag a napi
    mentési korlát érvényesítésére használunk.
* **Diagnosztikai jelentések** — csak akkor, ha a feliratok betöltése
  sikertelen, és te kifejezetten megnyomod a hibaüzenet sávján lévő
  **"Oldal újratöltése"** gombot (amely jelzi, hogy jelentés kerül
  elküldésre). Minden jelentés tartalmazza: a weboldal állomásnevét, azon
  videó címét (URL-jét) vagy azonosítóját, amelynél a hiba történt, a
  kiválasztott feliratnyelv-párt (a tanult nyelvet és az anyanyelvedet), a
  Bővítmény verzióját, a böngésződ felületi nyelvét, egy, a Bővítményt
  azonosító forráscímkét, és egy szerveroldali időbélyeget. Jelentések
  kizárólag bejelentkezett állapotban kerülnek elküldésre, fiókonként és
  naponta legfeljebb egy alkalommal, és kizárólag a hiba kivizsgálására
  szolgálnak.

**Nem** gyűjtjük: a böngészési előzményeidet, a megtekintett videóidat (az
általad kifejezetten elmentett felirat szövegen és az általad kifejezetten
kiváltott diagnosztikai jelentésben szereplő egyetlen videócímen túl), az
IP-alapú helymeghatározást, hirdetési azonosítókat, nyomkövető sütiket, vagy
bármilyen elemzést arról, hogyan használod a Bővítményt.

> A Lingogram fiókod a többi Lingogram bővítményünkben is működik; ha
> ugyanazzal a fiókkal jelentkezel be, a mentett szókincsed együtt
> szinkronizálódik.

## 2. Hogyan használjuk az információidat

A fenti információkat **kizárólag** az alábbi célokra használjuk:

* a hitelesítésedre, és arra, hogy munkamenetek között bejelentkezve
  tartsunk;
* a mentett szókincsed tárolására és eszközeid közötti szinkronizálására,
  hogy később átnézhesd;
* egy ésszerű napi korlát érvényesítésére a mentett szavaknál a visszaélések
  megelőzése érdekében;
* az általad a **"Oldal újratöltése"** gombon keresztül kifejezetten
  jelentett feliratbetöltési hibák kivizsgálására, hogy kijavíthassuk azokat.

Az információidat nem használjuk hirdetési célokra, profilalkotásra, vagy
bármilyen olyan célra, amely túlmutat az itt leírt szinkronizálási és
diagnosztikai funkciók biztosításán.

## 3. Helyi tárolás (az eszközödön)

A Bővítmény a böngésződ bővítménytárolóját (`chrome.storage`) használja,
hogy kizárólag az eszközödön tárolja:

* a nyelvi és felirat-elrendezési beállításaidat;
* egy helyi számlálót arról, hány szót mentettél el;
* ha be vagy jelentkezve: a hitelesítési tokenjeidet, az e-mail-címedet és
  a felhasználói azonosítódat (hogy bejelentkezve maradj), valamint egy
  rövid élettartamú bejelentkezési nonce-ot a munkamenet-tárolóban.

Ezek a helyi adatok soha nem hagyják el a böngésződet, kivéve a 4.
szakaszban leírt esetet (a felhőbe szinkronizált mentett szavak). A
kijelentkezés eltávolítja a hitelesítési tokeneket, az e-mail-címet és a
felhasználói azonosítót az eszközödről.

## 4. Felhőalapú tárolás és harmadik féltől származó szolgáltatások

Amikor be vagy jelentkezve, a fiókod és a mentett szókincsed a **Google
Firebase** (Firebase Authentication, Cloud Firestore és Secure Token
Service) segítségével kerül tárolásra, amelyet a fejlesztő üzemeltet a
Google Cloud infrastruktúráján. A Google szolgáltatóként dolgozza fel ezeket
az adatokat a nevünkben; lásd a Google Adatvédelmi szabályzatát a
https://policies.google.com/privacy címen. A hozzáférést a Firestore
biztonsági szabályai korlátozzák úgy, hogy kizárólag a saját adataidat
olvashatod és írhatod.

A feliratok megjelenítéséhez a Bővítmény beolvassa azokat a felirat
(captions) sávokat, amelyeket a YouTube lejátszó már biztosít az éppen
nézett videóhoz, **közvetlenül a böngésződön belül**. Ez a
feliratkezelés:

* teljes egészében a böngésződben zajlik, közvetítő proxy nélkül a
  részünkről;
* nem küld fiókadatokat vagy mentett szavakat a YouTube-nak;
* a YouTube saját adatvédelmi szabályzatának és feltételeinek hatálya alá
  tartozik.

## 5. Adatmegosztás és -értékesítés

**Nem** adjuk el, béreljük ki, vagy cseréljük el a személyes adataidat.
Nem osztjuk meg harmadik féllel, kivéve a Google Firebase-t mint a 4.
szakaszban leírt infrastruktúra-szolgáltatót, vagy ha ezt törvény írja elő.
Nem használjuk az adataidat hirdetési célokra.

## 6. Adatmegőrzés és törlés

* **A mentett szókincs** a felhőben marad, amíg nem törlöd, vagy nem kéred
  a fiók törlését.
* **A diagnosztikai jelentések** kizárólag hibaelhárítási célból kerülnek
  megőrzésre, és a fiók törlésére vonatkozó kérelmek hatálya alá tartoznak
  (a felhasználói azonosítódhoz vannak kötve).
* **A helyi adatok** bármikor törölhetők kijelentkezéssel (ami eltávolítja
  a tokenjeidet, e-mail-címedet és felhasználói azonosítódat), vagy a
  Bővítmény böngésződből történő eltávolításával.
* **A fiókod és az összes kapcsolódó felhőadat törléséhez** (e-mail,
  mentett szavak és diagnosztikai jelentések) lépj kapcsolatba a
  fejlesztővel a 9. szakasz szerint. Az adatokat ésszerű időn belül
  töröljük.

## 7. Biztonság

A hitelesítési tokeneket a böngésződ bővítménytárolójában őrizzük. Minden
hálózati kérés HTTPS-en keresztül történik. A felhőalapú adatokat a
Firebase Authentication és a Firestore biztonsági szabályai védik, amelyek
minden felhasználót a saját rekordjaira korlátoznak. Egyetlen továbbítási
vagy tárolási módszer sem 100%-ban biztonságos, de ésszerű intézkedéseket
teszünk az információid védelme érdekében.

## 8. Gyermekek adatvédelme

A Bővítmény nem 13 év alatti gyermekeknek szól (vagy a joghatóságod szerinti
ezzel egyenértékű minimális életkor alattiaknak), és tudatosan nem gyűjtünk
tőlük személyes adatokat.

## 9. A szabályzat módosításai

Időről időre frissíthetjük ezt az Adatvédelmi szabályzatot. A lényeges
változásokat egy frissített "Utolsó frissítés" dátummal tüntetjük fel itt.
A Bővítmény frissítés utáni további használata a felülvizsgált szabályzat
elfogadását jelenti.

## 10. Kapcsolat

Az Adatvédelmi szabályzattal kapcsolatos bármilyen kérdés esetén, vagy a
fiókod és adataid törlésének kéréséhez, kérjük, lépj kapcsolatba a
fejlesztővel a projekt hivatalos tárolóján keresztül, vagy a Bővítmény
Chrome Web Store támogatási oldalán keresztül.

---

*A Lingogram egy független eszköz, és nem áll kapcsolatban a YouTube-bal
vagy az általa támogatott videóplatformok egyikével sem, azok nem
engedélyezik és nem hagyják jóvá.*
