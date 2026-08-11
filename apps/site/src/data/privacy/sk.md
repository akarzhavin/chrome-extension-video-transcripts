*Tento preklad vychádza zo staršej verzie zásad a neobsahuje najnovšie zmeny. Rozhodujúca je anglická verzia na https://lingogram.ai/privacy/.*

# Zásady ochrany osobných údajov — Lingogram: Dual Subtitles & Transcript for YouTube

**Dátum účinnosti:** 22. júna 2026
**Posledná aktualizácia:** 13. júla 2026

Tieto Zásady ochrany osobných údajov vysvetľujú, aké informácie zbiera rozšírenie
prehliadača **Lingogram: Dual Subtitles & Transcript for YouTube** ("Rozšírenie"),
ako sa používajú, kde sa uchovávajú a aké možnosti máte k dispozícii.

---

## TL;DR

* **Bez účtu Rozšírenie o vás nezbiera žiadne údaje.** Interaktívny prepis,
  poslucháčska výzva, duálne titulky a lokálne ukladanie slov fungujú výhradne vo
  vašom prehliadači a žiadne osobné údaje sa nám neodosielajú.
* **Prihlásenie je voliteľné.** Slúži výlučne na synchronizáciu vašej uloženej
  slovnej zásoby naprieč zariadeniami. Ak sa rozhodnete prihlásiť, zbierame vašu
  **e-mailovú adresu** a ukladáme **slová, ktoré ste výslovne uložili** (spolu s
  okolitými riadkami titulkov) v našej cloudovej databáze.
* **Diagnostika je dobrovoľná, jedným kliknutím.** Ak sa titulky nenačítajú,
  núdzové tlačidlo **"Reload page"** (zobrazí sa iba po neúspešnom opakovanom
  pokuse) odošle nám diagnostickú správu jedným kliknutím — adresu videa a
  technické podrobnosti — aby sme mohli problém vyriešiť. Banner to uvádza
  priamo vedľa tlačidla; nič sa neodosiela automaticky.
* Vaše údaje **nepredávame**, nezobrazujeme reklamy, nepoužívame sledovacie
  nástroje tretích strán na reklamu ani analytiku a nesledujeme históriu
  vášho prehliadania.

---

## 1. Informácie, ktoré zbierame

### a. Ak sa **neprihlásite**
Rozšírenie **nezbiera, neprenáša ani neukladá** žiadne osobné údaje na našich
serveroch. Vaše jazykové a rozvrhnuté preferencie a lokálny počítadlo "uložených
slov" sa uchovávajú iba vo vašom prehliadači (pozri časť 3). Žiadny účet, e-mail
ani uložené slovo nikdy neopustí vaše zariadenie.

### b. Ak sa rozhodnete prihlásiť (voliteľný účet)
Prihlásenie umožňuje synchronizáciu vašej uloženej slovnej zásoby naprieč
zariadeniami. Po prihlásení zbierame a spracúvame:

* **Údaje o účte** — vašu **e-mailovú adresu** a ID používateľa vygenerované
  službou Firebase. Tieto údaje identifikujú váš účet a spájajú vaše uložené
  slová s vami.
* **Uloženú slovnú zásobu** — iba položky, ktoré sa výslovne rozhodnete uložiť
  počas sledovania. Pre každú uloženú položku ukladáme:
  * vybrané **slovo alebo frázu**;
  * malé množstvo **kontextu titulkov** — uložený riadok titulkov spolu s
    riadkom bezprostredne pred ním a po ňom, iba v primárnom jazyku titulkov
    videa;
  * **zdrojový štítok** označujúci Rozšírenie, ktoré ho uložilo;
  * **časovú značku** a denný počítadlo používaný iba na presadenie denného
    limitu ukladania.
* **Diagnostické správy** — iba ak sa titulky nenačítajú a vy výslovne
  stlačíte tlačidlo **"Reload page"** na chybovom banneri (ktorý uvádza, že
  správa bude odoslaná). Každá správa obsahuje: názov hostiteľa webovej
  stránky, adresu (URL) alebo ID videa, pri ktorom nastala chyba, zvolenú
  dvojicu jazykov titulkov (jazyk, ktorý sa učíte, a váš materinský jazyk),
  verziu Rozšírenia, jazyk rozhrania vášho prehliadača, zdrojový štítok
  identifikujúci Rozšírenie a serverovú časovú značku. Správy sa odosielajú
  iba počas prihlásenia, sú obmedzené na jednu za účet denne a slúžia
  výlučne na vyšetrenie zlyhania.

**Nezbierame:** vašu históriu prehliadania, videá, ktoré sledujete (okrem
textu titulkov, ktorý výslovne uložíte, a jednej adresy videa zahrnutej v
diagnostickej správe, ktorú výslovne vyvoláte), sledovanie polohy na základe
IP adresy, reklamné identifikátory, sledovacie cookies ani žiadne analytické
údaje o tom, ako Rozšírenie používate.

> Váš účet Lingogram funguje naprieč našimi ďalšími rozšíreniami Lingogram;
> ak sa prihlásite rovnakým účtom, vaša uložená slovná zásoba sa
> synchronizuje spoločne.

## 2. Ako používame vaše informácie

Vyššie uvedené informácie používame **výlučne** na to, aby sme:

* vás overili a udržali prihlásených naprieč reláciami;
* uložili vašu uloženú slovnú zásobu a synchronizovali ju naprieč vašimi
  zariadeniami, aby ste si ju mohli neskôr prezrieť;
* presadili primeraný denný limit uložených slov na zabránenie zneužitiu;
* vyšetrili zlyhania načítania titulkov, ktoré výslovne nahlásite
  prostredníctvom tlačidla **"Reload page"**, aby sme ich mohli opraviť.

Vaše informácie nepoužívame na reklamu, profilovanie ani na žiadny iný účel
nad rámec poskytovania funkcií synchronizácie a diagnostiky opísaných tu.

## 3. Lokálne úložisko (na vašom zariadení)

Rozšírenie používa úložisko rozšírenia vášho prehliadača (`chrome.storage`)
na uchovávanie, iba na vašom zariadení:

* vašich jazykových preferencií a preferencií rozloženia titulkov;
* lokálneho počítadla toho, koľko slov ste uložili;
* ak ste prihlásení: vašich overovacích tokenov, vašej e-mailovej adresy a
  vášho ID používateľa (aby ste zostali prihlásení), a krátkodobého
  prihlasovacieho nonce v úložisku relácie.

Tieto lokálne údaje nikdy neopustia váš prehliadač, s výnimkou prípadov
opísaných v časti 4 (uložené slová synchronizované do cloudu). Odhlásenie
odstráni overovacie tokeny, e-mail a ID používateľa z vášho zariadenia.

## 4. Cloudové úložisko a služby tretích strán

Keď ste prihlásení, váš účet a uložená slovná zásoba sa ukladajú pomocou
služby **Google Firebase** (Firebase Authentication, Cloud Firestore a
Secure Token Service), prevádzkovanej vývojárom na infraštruktúre Google
Cloud. Google spracúva tieto údaje ako náš poskytovateľ služieb; pozri
Zásady ochrany osobných údajov spoločnosti Google na
https://policies.google.com/privacy. Prístup je obmedzený pravidlami
zabezpečenia Firestore tak, aby ste mohli čítať a zapisovať iba svoje
vlastné údaje.

Na zobrazenie titulkov Rozšírenie číta stopy titulkov (captions), ktoré
prehrávač YouTube už poskytuje pre video, ktoré sledujete, **priamo vo vašom
prehliadači**. Táto práca s titulkami:

* prebieha výhradne vo vašom prehliadači, bez akéhokoľvek sprostredkujúceho
  proxy servera z našej strany;
* neodosiela žiadne údaje o účte ani uložené slová do YouTube;
* podlieha vlastným zásadám ochrany osobných údajov a podmienkam YouTube.

## 5. Zdieľanie a predaj údajov

Vaše osobné údaje **nepredávame, neprenajímame ani neobchodujeme** s nimi.
Nezdieľame ich so žiadnou treťou stranou okrem Google Firebase ako
poskytovateľa infraštruktúry opísaného v časti 4, alebo ak to vyžaduje
zákon. Vaše údaje nepoužívame na reklamu.

## 6. Uchovávanie a vymazanie údajov

* **Uložená slovná zásoba** sa uchováva v cloude, kým ju nevymažete alebo
  nepožiadate o vymazanie účtu.
* **Diagnostické správy** sa uchovávajú iba na účely riešenia problémov a
  vzťahuje sa na ne žiadosť o vymazanie účtu (sú viazané na vaše ID
  používateľa).
* **Lokálne údaje** je možné kedykoľvek vymazať odhlásením (odstráni vaše
  tokeny, e-mail a ID používateľa) alebo odstránením Rozšírenia z vášho
  prehliadača.
* Ak chcete **vymazať svoj účet a všetky súvisiace cloudové údaje**
  (e-mail, uložené slová a diagnostické správy), kontaktujte vývojára
  pomocou časti 9. Vymažeme ich v primeranej lehote.

## 7. Bezpečnosť

Overovacie tokeny sa uchovávajú v úložisku rozšírenia vášho prehliadača.
Všetky sieťové požiadavky sa uskutočňujú cez HTTPS. Cloudové údaje sú
chránené službou Firebase Authentication a pravidlami zabezpečenia
Firestore, ktoré obmedzujú každého používateľa iba na jeho vlastné
záznamy. Žiadny spôsob prenosu ani ukladania nie je 100 % bezpečný, ale
prijímame primerané opatrenia na ochranu vašich informácií.

## 8. Ochrana súkromia detí

Rozšírenie nie je určené deťom mladším ako 13 rokov (alebo príslušnému
minimálnemu veku vo vašej jurisdikcii) a vedome od nich nezbierame osobné
údaje.

## 9. Zmeny týchto zásad

Tieto Zásady ochrany osobných údajov môžeme z času na čas aktualizovať.
Podstatné zmeny sa premietnu tu s aktualizovaným dátumom "Posledná
aktualizácia". Pokračovanie v používaní Rozšírenia po aktualizácii
predstavuje súhlas s revidovanými zásadami.

## 10. Kontakt

V prípade akýchkoľvek otázok týkajúcich sa týchto Zásad ochrany osobných
údajov, alebo ak chcete požiadať o vymazanie svojho účtu a údajov,
kontaktujte vývojára prostredníctvom oficiálneho repozitára projektu alebo
prostredníctvom stránky podpory Chrome Web Store pre Rozšírenie.

---

*Lingogram je nezávislý nástroj a nie je pridružený, autorizovaný ani
podporovaný službou YouTube ani žiadnou z videoplatforiem, ktoré podporuje.*
