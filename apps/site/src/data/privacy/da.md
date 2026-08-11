*Denne oversættelse er baseret på en ældre version af politikken og indeholder ikke de seneste ændringer. Den engelske version på https://lingogram.ai/privacy/ er den gældende.*

# Privatlivspolitik — Lingogram: Dual Subtitles & Transcript for YouTube

**Ikrafttrædelsesdato:** 22. juni 2026
**Sidst opdateret:** 13. juli 2026

Denne Privatlivspolitik forklarer, hvilke oplysninger browserudvidelsen **Lingogram:
Dual Subtitles & Transcript for YouTube** ("Udvidelsen") indsamler, hvordan de bruges,
hvor de opbevares, og hvilke valgmuligheder du har.

---

## Kort fortalt (TL;DR)

* **Uden en konto indsamler Udvidelsen intet om dig.** Den interaktive transskription,
  lytteudfordringen, dobbelte undertekster og lokal ordgemning kører udelukkende i din
  browser, og der sendes ingen personoplysninger til os.
* **Login er valgfrit.** Det findes udelukkende for at synkronisere dit gemte
  ordforråd på tværs af enheder. Hvis du vælger at logge ind, indsamler vi din
  **e-mailadresse** og gemmer **de ord, du udtrykkeligt gemmer** (sammen med de
  omgivende undertekstlinjer) i vores skydatabase.
* **Diagnostik er valgfri (opt-in) med ét klik.** Hvis undertekster ikke kan indlæses,
  sender en nødknap, **"Reload page"** (vises kun efter et mislykket
  genindlæsningsforsøg), en diagnosticeringsrapport med ét klik — videoens adresse
  plus tekniske detaljer — så vi kan løse problemet. Banneret oplyser dette lige ved
  siden af knappen; intet rapporteres automatisk.
* Vi **sælger ikke** dine data, viser ikke annoncer, kører ikke tredjeparts
  annoncering eller analysesporing, og sporer ikke din browserhistorik.

---

## 1. Oplysninger, vi indsamler

### a. Hvis du **ikke** logger ind
Udvidelsen indsamler, overfører eller opbevarer **ikke** nogen personoplysninger på
vores servere. Dine sprog- og layoutpræferencer samt en lokal tæller for "gemte ord"
opbevares kun i din browser (se afsnit 3). Ingen konto, e-mail eller gemt ord
forlader nogensinde din enhed.

### b. Hvis du vælger at logge ind (valgfri konto)
Login muliggør synkronisering af dit gemte ordforråd på tværs af enheder. Når du
logger ind, indsamler og behandler vi:

* **Kontodata** — din **e-mailadresse** og et Firebase-genereret bruger-ID. Disse
  identificerer din konto og knytter gemte ord til dig.
* **Gemt ordforråd** — kun de elementer, du udtrykkeligt vælger at gemme, mens du ser
  video. For hvert gemt element gemmer vi:
  * det **ord eller udtryk**, du valgte;
  * en lille mængde **undertekstkontekst** — den gemte undertekstlinje plus linjen
    umiddelbart før og efter den, kun på videoens primære undertekstsprog;
  * et **kildemærke**, der angiver hvilken Udvidelse der gemte det;
  * et **tidsstempel** og en daglig tæller, der udelukkende bruges til at håndhæve en
    daglig gemmegrænse.
* **Diagnosticeringsrapporter** — kun hvis undertekster ikke kan indlæses, og du
  udtrykkeligt trykker på knappen **"Reload page"** på fejlbanneret (som angiver, at
  en rapport vil blive sendt). Hver rapport indeholder: webstedets værtsnavn, adressen
  (URL) eller ID'et på den video, hvor fejlen opstod, det undertekstsprogpar du har
  valgt (sproget du lærer og dit modersmål), Udvidelsens version, din browsers
  grænsefladesprog, et kildemærke der identificerer Udvidelsen, og et
  servertidsstempel. Rapporter sendes kun, mens du er logget ind, er begrænset til én
  pr. konto pr. dag, og bruges udelukkende til at undersøge fejlen.

Vi indsamler **ikke**: din browserhistorik, de videoer du ser (ud over den
undertekst­tekst du udtrykkeligt gemmer, og den enkelte videoadresse inkluderet i en
diagnosticeringsrapport du udtrykkeligt udløser), IP-baseret placeringssporing,
annonce-identifikatorer, sporingscookies eller nogen analyse af, hvordan du bruger
Udvidelsen.

> Din Lingogram-konto virker på tværs af vores andre Lingogram-udvidelser; hvis du
> logger ind med samme konto, synkroniseres dit gemte ordforråd sammen.

## 2. Sådan bruger vi dine oplysninger

Vi bruger ovenstående oplysninger **udelukkende** til at:

* autentificere dig og holde dig logget ind på tværs af sessioner;
* gemme dit gemte ordforråd og synkronisere det på tværs af dine enheder, så du kan
  gennemgå det senere;
* håndhæve en rimelig daglig grænse for gemte ord for at forhindre misbrug;
* undersøge de fejl ved indlæsning af undertekster, du udtrykkeligt rapporterer via
  knappen **"Reload page"**, så vi kan løse dem.

Vi bruger ikke dine oplysninger til annoncering, profilering eller noget formål ud
over at levere de synkroniserings- og diagnosticeringsfunktioner, der er beskrevet
her.

## 3. Lokal opbevaring (på din enhed)

Udvidelsen bruger din browsers udvidelseslager (`chrome.storage`) til udelukkende at
opbevare, på din enhed:

* dine sprog- og undertekstlayoutpræferencer;
* et lokalt antal af, hvor mange ord du har gemt;
* hvis du er logget ind: dine autentificeringstokens, din e-mailadresse og dit
  bruger-ID (så du forbliver logget ind), samt en kortvarig login-nonce i
  sessionslager.

Disse lokale data forlader aldrig din browser, undtagen hvor afsnit 4 beskriver det
(gemte ord synkroniseret til skyen). Logning ud fjerner autentificeringstokens,
e-mail og bruger-ID fra din enhed.

## 4. Skyopbevaring og tredjepartstjenester

Når du er logget ind, opbevares din konto og dit gemte ordforråd ved hjælp af
**Google Firebase** (Firebase Authentication, Cloud Firestore og Secure Token
Service), som drives af udvikleren på Google Cloud-infrastruktur. Google behandler
disse data som vores tjenesteudbyder; se Googles Privatlivspolitik på
https://policies.google.com/privacy. Adgang er begrænset af Firestore-sikkerhedsregler,
så du kun kan læse og skrive dine egne data.

For at vise undertekster læser Udvidelsen de undertekstspor (billedtekster), som
YouTube-afspilleren allerede leverer til den video, du ser, **direkte i din browser**.
Denne underteksthåndtering:

* sker udelukkende i din browser, uden nogen mellemliggende proxy fra vores side;
* sender ingen kontodata eller gemte ord til YouTube;
* er underlagt YouTubes egen privatlivspolitik og vilkår.

## 5. Datadeling og -salg

Vi **sælger, udlejer eller handler ikke** med dine personoplysninger. Vi deler dem
ikke med nogen tredjepart bortset fra Google Firebase som infrastrukturudbyder
beskrevet i afsnit 4, eller hvor det kræves ved lov. Vi bruger ikke dine data til
annoncering.

## 6. Dataopbevaring og -sletning

* **Gemt ordforråd** opbevares i skyen, indtil du sletter det, eller anmoder om
  kontosletning.
* **Diagnosticeringsrapporter** opbevares kun til fejlfinding og er omfattet af
  anmodninger om kontosletning (de er knyttet til dit bruger-ID).
* **Lokale data** kan når som helst ryddes ved at logge ud (fjerner dine tokens,
  e-mail og bruger-ID) eller ved at fjerne Udvidelsen fra din browser.
* For at **slette din konto og alle tilknyttede skydata** (e-mail, gemte ord og
  diagnosticeringsrapporter),
  kontakt udvikleren via afsnit 9. Vi sletter dem inden for en rimelig periode.

## 7. Sikkerhed

Autentificeringstokens opbevares i din browsers udvidelseslager. Alle
netværksanmodninger foretages over HTTPS. Skydata er beskyttet af Firebase
Authentication og Firestore-sikkerhedsregler, der begrænser hver bruger til deres
egne poster. Ingen overførsels- eller opbevaringsmetode er 100% sikker, men vi
træffer rimelige foranstaltninger for at beskytte dine oplysninger.

## 8. Børns privatliv

Udvidelsen er ikke rettet mod børn under 13 år (eller den tilsvarende
minimumsalder i din jurisdiktion), og vi indsamler ikke bevidst personoplysninger
fra dem.

## 9. Ændringer af denne politik

Vi kan opdatere denne Privatlivspolitik fra tid til anden. Væsentlige ændringer vil
blive afspejlet her med en opdateret "Sidst opdateret"-dato. Fortsat brug af
Udvidelsen efter en opdatering udgør accept af den reviderede politik.

## 10. Kontakt

Hvis du har spørgsmål om denne Privatlivspolitik, eller ønsker at anmode om sletning
af din konto og dine data, bedes du kontakte udvikleren via projektets officielle
repository eller via Chrome Web Store-supportsiden for Udvidelsen.

---

*Lingogram er et uafhængigt værktøj og er ikke tilknyttet, autoriseret eller
godkendt af YouTube eller nogen af de videoplatforme, det understøtter.*
