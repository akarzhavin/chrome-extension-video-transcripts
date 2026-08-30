*Tento překlad vychází ze starší verze zásad a neobsahuje poslední změny. Závazná je anglická verze na https://lingogram.ai/privacy/.*

# Zásady ochrany osobních údajů — Lingogram: Dual Subtitles & Transcript for YouTube

**Datum účinnosti:** 22. června 2026
**Poslední aktualizace:** 13. července 2026

Tyto Zásady ochrany osobních údajů vysvětlují, jaké informace shromažďuje rozšíření
prohlížeče **Lingogram: Dual Subtitles & Transcript for YouTube** ("Rozšíření"), jak
jsou tyto informace používány, kde jsou uloženy a jaké možnosti máte k dispozici.

---

## Stručně (TL;DR)

* **Bez účtu Rozšíření o vás neshromažďuje vůbec nic.** Interaktivní přepis,
  poslechová výzva, duální titulky a lokální ukládání slov běží zcela ve vašem
  prohlížeči a žádné osobní údaje nám nejsou odesílány.
* **Přihlášení je volitelné.** Existuje pouze pro synchronizaci vaší uložené slovní
  zásoby napříč zařízeními. Pokud se rozhodnete přihlásit, shromažďujeme vaši
  **e-mailovou adresu** a ukládáme **slova, která výslovně uložíte** (spolu s
  okolními řádky titulků) do naší cloudové databáze.
* **Diagnostika je volitelná (opt-in), na jedno kliknutí.** Pokud se titulky nepodaří
  načíst, tlačítko nouzového obnovení **"Reload page"** (zobrazí se pouze po
  neúspěšném opakovaném pokusu) odešle jedním kliknutím diagnostickou zprávu — adresu
  videa a technické podrobnosti —, abychom mohli problém opravit. Banner to uvádí
  přímo vedle tlačítka; nic se nehlásí automaticky.
* Vaše údaje **ne**prodáváme, nezobrazujeme reklamy, neprovozujeme reklamní ani
  analytické sledovací nástroje třetích stran, ani nesledujeme historii vašeho
  prohlížení.

---

## 1. Informace, které shromažďujeme

### a. Pokud se **ne**přihlásíte
Rozšíření **ne**shromažďuje, nepřenáší ani neukládá žádné osobní údaje na našich
serverech. Vaše jazykové a rozvržení preferencí a lokální počítadlo "uložených slov"
jsou uchovávány pouze ve vašem prohlížeči (viz oddíl 3). Žádný účet, e-mail ani
uložené slovo nikdy neopustí vaše zařízení.

### b. Pokud se rozhodnete přihlásit (volitelný účet)
Přihlášení umožňuje synchronizaci vaší uložené slovní zásoby napříč zařízeními. Po
přihlášení shromažďujeme a zpracováváme:

* **Údaje o účtu** — vaši **e-mailovou adresu** a uživatelské ID vygenerované službou
  Firebase. Ty identifikují váš účet a spojují uložená slova s vámi.
* **Uloženou slovní zásobu** — pouze položky, které se výslovně rozhodnete uložit
  během sledování. Pro každou uloženou položku uchováváme:
  * **slovo nebo frázi**, kterou jste vybrali;
  * malé množství **kontextu titulků** — uložený řádek titulků plus řádek
    bezprostředně před a po něm, pouze v primárním jazyce titulků videa;
  * **značku zdroje** udávající, které Rozšíření slovo uložilo;
  * **časové razítko** a denní počítadlo používané pouze k vynucení denního limitu
    ukládání.
* **Diagnostické zprávy** — pouze pokud se titulky nepodaří načíst a vy výslovně
  stisknete tlačítko **"Reload page"** na chybovém banneru (který uvádí, že bude
  odeslána zpráva). Každá zpráva obsahuje: název hostitele webu, adresu (URL) nebo ID
  videa, u kterého k selhání došlo, vámi zvolenou dvojici jazyků titulků (jazyk, který
  se učíte, a váš rodný jazyk), verzi Rozšíření, jazyk rozhraní vašeho prohlížeče,
  značku zdroje identifikující Rozšíření a časové razítko serveru. Zprávy se
  odesílají pouze tehdy, když jste přihlášeni, jsou omezeny na jednu zprávu na účet
  denně a slouží výhradně k vyšetření selhání.

**Ne**shromažďujeme: historii vašeho prohlížení, videa, která sledujete (kromě textu
titulků, který výslovně uložíte, a jediné adresy videa zahrnuté v diagnostické zprávě,
kterou výslovně vyvoláte), sledování polohy na základě IP adresy, reklamní
identifikátory, sledovací soubory cookie ani žádnou analytiku o tom, jak Rozšíření
používáte.

> Váš účet Lingogram funguje napříč našimi dalšími rozšířeními Lingogram; pokud se
> přihlásíte stejným účtem, vaše uložená slovní zásoba se synchronizuje společně.

## 2. Jak vaše informace používáme

Výše uvedené informace používáme **pouze** k tomu, abychom:

* vás ověřili a udrželi přihlášené napříč relacemi;
* uchovávali vaši uloženou slovní zásobu a synchronizovali ji napříč vašimi
  zařízeními, abyste si ji mohli později prohlédnout;
* vynucovali přiměřený denní limit uložených slov, abychom zabránili zneužití;
* vyšetřovali selhání načítání titulků, která výslovně nahlásíte pomocí tlačítka
  **"Reload page"**, abychom je mohli opravit.

Vaše informace nepoužíváme pro reklamu, profilování ani žádný jiný účel nad rámec
poskytování zde popsaných funkcí synchronizace a diagnostiky.

## 3. Lokální úložiště (ve vašem zařízení)

Rozšíření využívá úložiště rozšíření vašeho prohlížeče (`chrome.storage`) k
uchovávání, pouze ve vašem zařízení:

* vašich jazykových preferencí a preferencí rozvržení titulků;
* lokálního počtu slov, která jste uložili;
* pokud jste přihlášeni: vašich autentizačních tokenů, e-mailové adresy a uživatelského
  ID (abyste zůstali přihlášeni), a krátkodobého přihlašovacího nonce v úložišti
  relace.

Tato lokální data nikdy neopustí váš prohlížeč s výjimkou případů popsaných v oddíle 4
(uložená slova synchronizovaná do cloudu). Odhlášením se z vašeho zařízení odstraní
autentizační tokeny, e-mail a uživatelské ID.

## 4. Cloudové úložiště a služby třetích stran

Když jste přihlášeni, váš účet a uložená slovní zásoba jsou ukládány pomocí služby
**Google Firebase** (Firebase Authentication, Cloud Firestore a Secure Token
Service), provozované vývojářem na infrastruktuře Google Cloud. Google tato data
zpracovává jako náš poskytovatel služeb; viz Zásady ochrany osobních údajů společnosti
Google na adrese https://policies.google.com/privacy. Přístup je omezen
bezpečnostními pravidly Firestore tak, abyste mohli číst a zapisovat pouze svá
vlastní data.

Pro zobrazení titulků Rozšíření čte titulkové (popisné) stopy, které přehrávač
YouTube již poskytuje pro video, které sledujete, **přímo ve vašem prohlížeči**. Toto
zpracování titulků:

* probíhá zcela ve vašem prohlížeči, bez jakéhokoli zprostředkujícího proxy z naší
  strany;
* neodesílá žádné údaje o účtu ani uložená slova na YouTube;
* podléhá vlastním zásadám ochrany osobních údajů a podmínkám YouTube.

## 5. Sdílení a prodej dat

Vaše osobní údaje **ne**prodáváme, nepronajímáme ani s nimi neobchodujeme. Nesdílíme
je s žádnou třetí stranou kromě služby Google Firebase jako poskytovatele
infrastruktury popsaného v oddíle 4, nebo pokud to vyžaduje zákon. Vaše údaje
nepoužíváme pro reklamu.

## 6. Uchovávání a mazání dat

* **Uložená slovní zásoba** je uchovávána v cloudu, dokud ji nesmažete nebo
  nepožádáte o smazání účtu.
* **Diagnostické zprávy** jsou uchovávány pouze pro účely řešení problémů a jsou
  zahrnuty do žádostí o smazání účtu (jsou vázány na vaše uživatelské ID).
* **Lokální data** lze kdykoli vymazat odhlášením (odstraní vaše tokeny, e-mail a
  uživatelské ID) nebo odebráním Rozšíření z vašeho prohlížeče.
* Pro **smazání vašeho účtu a všech souvisejících cloudových dat** (e-mail, uložená
  slova a diagnostické zprávy)
  kontaktujte vývojáře pomocí oddílu 9. Data smažeme v přiměřené lhůtě.

## 7. Bezpečnost

Autentizační tokeny jsou uchovávány v úložišti rozšíření vašeho prohlížeče. Všechny
síťové požadavky jsou prováděny přes HTTPS. Cloudová data jsou chráněna službou
Firebase Authentication a bezpečnostními pravidly Firestore, které omezují každého
uživatele pouze na jeho vlastní záznamy. Žádná metoda přenosu ani ukládání není
100% bezpečná, ale přijímáme přiměřená opatření k ochraně vašich informací.

## 8. Ochrana soukromí dětí

Rozšíření není určeno dětem mladším 13 let (nebo odpovídajícímu minimálnímu věku ve
vaší jurisdikci) a vědomě od nich neshromažďujeme osobní údaje.

## 9. Změny těchto zásad

Tyto Zásady ochrany osobních údajů můžeme čas od času aktualizovat. Podstatné změny
budou zde uvedeny s aktualizovaným datem "Poslední aktualizace". Pokračování v
používání Rozšíření po aktualizaci představuje přijetí revidovaných zásad.

## 10. Kontakt

V případě jakýchkoli dotazů týkajících se těchto Zásad ochrany osobních údajů, nebo
pro požadavek na smazání vašeho účtu a dat, kontaktujte prosím vývojáře
prostřednictvím oficiálního repozitáře projektu nebo prostřednictvím stránky
podpory Chrome Web Store pro Rozšíření.

---

*Lingogram je nezávislý nástroj a není přidružen, autorizován ani schválen službou
YouTube ani žádnou z video platforem, které podporuje.*
