# Integritetspolicy — Lingogram: Dual Subtitles & Transcript for YouTube

**Datum för ikraftträdande:** 22 juni 2026
**Senast uppdaterad:** 13 juli 2026

Denna integritetspolicy förklarar vilken information webbläsartillägget
**Lingogram: Dual Subtitles & Transcript for YouTube** ("Tillägget")
samlar in, hur den används, var den lagras och vilka val du har.

---

## TL;DR

* **Utan konto samlar Tillägget inte in något om dig.** Den interaktiva
  transkriptionen, lyssningsutmaningen, dubbla undertexter och lokal
  ordsparning körs helt och hållet i din webbläsare, och inga personuppgifter
  skickas till oss.
* **Inloggning är valfritt.** Den finns endast för att synkronisera ditt
  sparade ordförråd mellan enheter. Om du väljer att logga in samlar vi in
  din **e-postadress** och lagrar de **ord du uttryckligen sparar**
  (tillsammans med de omgivande undertextraderna) i vår molndatabas.
* **Diagnostik är valfritt, med ett klick.** Om undertexter inte laddas
  skickar en nödknapp, **"Reload page"** (visas endast efter ett
  misslyckat återförsök), en diagnostikrapport till oss med ett klick —
  videons adress plus tekniska detaljer — så att vi kan åtgärda problemet.
  Banderollen anger detta direkt bredvid knappen; ingenting rapporteras
  automatiskt.
* Vi **säljer inte** dina uppgifter, visar inte annonser, kör inte
  tredjeparts annons- eller analysspårare, och spårar inte din
  webbhistorik.

---

## 1. Information vi samlar in

### a. Om du **inte** loggar in
Tillägget samlar **inte** in, överför eller lagrar några personuppgifter på
våra servrar. Dina språk- och layoutinställningar samt en lokal räknare för
"sparade ord" lagras endast i din webbläsare (se avsnitt 3). Inget konto,
ingen e-post och inget sparat ord lämnar någonsin din enhet.

### b. Om du väljer att logga in (valfritt konto)
Inloggning möjliggör synkronisering av ditt sparade ordförråd mellan
enheter. När du loggar in samlar vi in och behandlar:

* **Kontouppgifter** — din **e-postadress** och ett Firebase-genererat
  användar-ID. Dessa identifierar ditt konto och kopplar dina sparade ord
  till dig.
* **Sparat ordförråd** — endast de objekt du uttryckligen väljer att spara
  medan du tittar. För varje sparat objekt lagrar vi:
  * det **ord eller uttryck** du valde;
  * en liten mängd **undertextkontext** — den sparade undertextraden samt
    raden omedelbart före och efter den, endast på videons primära
    undertextspråk;
  * en **källtagg** som anger vilket tillägg som sparade det;
  * en **tidsstämpel** och en daglig räknare som endast används för att
    upprätthålla en daglig sparbegränsning.
* **Diagnostikrapporter** — endast om undertexter misslyckas med att
  laddas och du uttryckligen trycker på knappen **"Reload page"** på
  felbanderollen (som anger att en rapport kommer att skickas). Varje
  rapport innehåller: webbplatsens värdnamn, adressen (URL) eller ID:t för
  videon där felet inträffade, det undertextspråkpar du valde (språket du
  lär dig och ditt modersmål), tilläggets version, ditt webbläsargränssnitts
  språk, en källtagg som identifierar Tillägget, samt en servertidsstämpel.
  Rapporter skickas endast medan du är inloggad, är begränsade till en per
  konto och dag, och används enbart för att undersöka felet.

Vi samlar **inte** in: din webbhistorik, videor du tittar på (utöver den
undertexttext du uttryckligen sparar och den enda videoadress som ingår i
en diagnostikrapport du uttryckligen utlöser), IP-baserad platsspårning,
annonsidentifierare, spårningskakor eller någon analys av hur du använder
Tillägget.

> Ditt Lingogram-konto fungerar mellan våra andra Lingogram-tillägg; om du
> loggar in med samma konto synkroniseras ditt sparade ordförråd
> tillsammans.

## 2. Hur vi använder din information

Vi använder ovanstående information **endast** för att:

* autentisera dig och hålla dig inloggad mellan sessioner;
* lagra ditt sparade ordförråd och synkronisera det mellan dina enheter så
  att du kan granska det senare;
* upprätthålla en rimlig daglig gräns för sparade ord för att förhindra
  missbruk;
* utreda de undertextladdningsfel du uttryckligen rapporterar via knappen
  **"Reload page"**, så att vi kan åtgärda dem.

Vi använder inte din information för annonsering, profilering eller något
syfte utöver att tillhandahålla de synkroniserings- och diagnostikfunktioner
som beskrivs här.

## 3. Lokal lagring (på din enhet)

Tillägget använder din webbläsares tilläggslagring (`chrome.storage`) för
att, endast på din enhet, lagra:

* dina språk- och undertextlayoutinställningar;
* en lokal räknare för hur många ord du har sparat;
* om du är inloggad: dina autentiseringstoken, din e-postadress och ditt
  användar-ID (så att du förblir inloggad), samt en kortlivad
  inloggningsnonce i sessionslagringen.

Dessa lokala uppgifter lämnar aldrig din webbläsare förutom där avsnitt 4
beskriver (sparade ord synkroniserade till molnet). Utloggning tar bort
autentiseringstoken, e-post och användar-ID från din enhet.

## 4. Molnlagring och tredjepartstjänster

När du är inloggad lagras ditt konto och ditt sparade ordförråd med hjälp
av **Google Firebase** (Firebase Authentication, Cloud Firestore och Secure
Token Service), som drivs av utvecklaren på Google Clouds infrastruktur.
Google behandlar dessa uppgifter som vår tjänsteleverantör; se Googles
integritetspolicy på https://policies.google.com/privacy. Åtkomsten är
begränsad av Firestores säkerhetsregler så att du endast kan läsa och
skriva dina egna uppgifter.

För att visa undertexter läser Tillägget de undertextspår som YouTube-
spelaren redan tillhandahåller för videon du tittar på, **direkt i din
webbläsare**. Denna undertexthantering:

* sker helt och hållet i din webbläsare, utan någon mellanliggande proxy
  från vår sida;
* skickar inga kontouppgifter eller sparade ord till YouTube;
* omfattas av YouTubes egen integritetspolicy och villkor.

## 5. Delning och försäljning av data

Vi **säljer, hyr eller byter inte bort** dina personuppgifter. Vi delar
dem inte med någon tredje part förutom Google Firebase som
infrastrukturleverantör enligt beskrivningen i avsnitt 4, eller där lagen
kräver det. Vi använder inte dina uppgifter för annonsering.

## 6. Datalagring och radering

* **Sparat ordförråd** behålls i molnet tills du raderar det eller begär
  radering av kontot.
* **Diagnostikrapporter** behålls endast för felsökning och omfattas av
  begäranden om kontoradering (de är kopplade till ditt användar-ID).
* **Lokala uppgifter** kan raderas när som helst genom att logga ut (tar
  bort dina token, din e-post och ditt användar-ID) eller genom att ta
  bort Tillägget från din webbläsare.
* För att **radera ditt konto och alla tillhörande molnuppgifter**
  (e-post, sparade ord och diagnostikrapporter), kontakta utvecklaren via
  avsnitt 9. Vi kommer att radera det inom rimlig tid.

## 7. Säkerhet

Autentiseringstoken lagras i din webbläsares tilläggslagring. Alla
nätverksförfrågningar görs över HTTPS. Molndata skyddas av Firebase
Authentication och Firestores säkerhetsregler som begränsar varje
användare till sina egna poster. Ingen överförings- eller
lagringsmetod är 100 % säker, men vi vidtar rimliga åtgärder för att
skydda din information.

## 8. Barns integritet

Tillägget riktar sig inte till barn under 13 år (eller motsvarande
lägsta ålder i din jurisdiktion), och vi samlar inte medvetet in
personuppgifter från dem.

## 9. Ändringar av denna policy

Vi kan uppdatera denna integritetspolicy från tid till annan. Väsentliga
ändringar kommer att återspeglas här med ett uppdaterat datum för "Senast
uppdaterad". Fortsatt användning av Tillägget efter en uppdatering utgör
ett godkännande av den reviderade policyn.

## 10. Kontakt

Om du har frågor om denna integritetspolicy, eller vill begära radering av
ditt konto och dina uppgifter, kontakta utvecklaren via projektets
officiella repository eller via Chrome Web Stores supportsida för
Tillägget.

---

*Lingogram är ett fristående verktyg och är inte anslutet till, godkänt
av eller understött av YouTube eller någon av de videoplattformar det
stöder.*
