# Personvernerklæring — Lingogram: Dual Subtitles & Transcript for YouTube

**Ikrafttredelsesdato:** 22. juni 2026
**Sist oppdatert:** 13. juli 2026

Denne personvernerklæringen forklarer hvilken informasjon nettleserutvidelsen **Lingogram: Dual Subtitles & Transcript for YouTube** ("Utvidelsen") samler inn, hvordan den brukes, hvor den lagres, og hvilke valg du har.

---

## Kort oppsummert

* **Uten en konto samler ikke Utvidelsen inn noe som helst om deg.** Det interaktive transkriptet, lytteøvelsen, doble undertekster og lokal lagring av ord kjører fullstendig i nettleseren din, og ingen personopplysninger sendes til oss.
* **Innlogging er valgfritt.** Den finnes bare for å synkronisere det lagrede ordforrådet ditt på tvers av enheter. Hvis du velger å logge inn, samler vi inn **e-postadressen** din og lagrer **ordene du eksplisitt lagrer** (sammen med de omkringliggende undertekstlinjene) i vår skybaserte database.
* **Diagnostikk er opt-in, med ett klikk.** Hvis undertekster ikke lastes inn, sender en nødknapp, **"Last inn siden på nytt"** (som bare vises etter et mislykket nytt forsøk), med ett klikk en diagnoserapport til oss — videoens adresse pluss tekniske detaljer — slik at vi kan løse problemet. Dette står tydelig i banneret rett ved siden av knappen; ingenting rapporteres automatisk.
* Vi selger **ikke** dataene dine, viser ikke annonser, kjører ikke tredjeparts annonse- eller analysesporing, og sporer ikke nettleserhistorikken din.

---

## 1. Informasjon vi samler inn

### a. Hvis du **ikke** logger inn
Utvidelsen samler **ikke** inn, overfører eller lagrer noen personopplysninger på våre servere. Dine språk- og layoutpreferanser og en lokal teller for "lagrede ord" oppbevares bare i nettleseren din (se avsnitt 3). Ingen konto, e-post eller lagret ord forlater noen gang enheten din.

### b. Hvis du velger å logge inn (valgfri konto)
Innlogging gjør det mulig å synkronisere det lagrede ordforrådet ditt på tvers av enheter. Når du logger inn, samler og behandler vi:

* **Kontodata** — **e-postadressen** din og en Firebase-generert bruker-ID. Disse identifiserer kontoen din og knytter lagrede ord til deg.
* **Lagret ordforråd** — bare elementene du eksplisitt velger å lagre mens du ser på video. For hvert lagrede element lagrer vi:
  * **ordet eller uttrykket** du valgte;
  * en liten mengde **undertekstkontekst** — den lagrede undertekstlinjen samt linjen umiddelbart før og etter, kun på videoens primære undertekstspråk;
  * en **kildemerking** som angir hvilken Utvidelse som lagret det;
  * et **tidsstempel** og en daglig teller som kun brukes til å håndheve en daglig lagringsgrense.
* **Diagnoserapporter** — bare hvis undertekster ikke lastes inn, og du eksplisitt trykker på knappen **"Last inn siden på nytt"** på feilbanneret (som opplyser at en rapport vil bli sendt). Hver rapport inneholder: nettstedets vertsnavn, adressen (URL-en) eller ID-en til videoen der feilen oppsto, undertekst-språkparet du valgte (språket du lærer og morsmålet ditt), Utvidelsens versjon, nettleserens grensesnittspråk, en kildemerking som identifiserer Utvidelsen, og et serverbasert tidsstempel. Rapporter sendes bare mens du er innlogget, er begrenset til én per konto per dag, og brukes utelukkende til å undersøke feilen.

Vi samler **ikke** inn: din nettleserhistorikk, videoene du ser på (utover undertekstteksten du eksplisitt lagrer og den ene videoadressen som inngår i en diagnoserapport du eksplisitt utløser), IP-basert stedssporing, annonseidentifikatorer, sporingsinformasjonskapsler, eller noen analyse av hvordan du bruker Utvidelsen.

> Lingogram-kontoen din fungerer på tvers av våre andre Lingogram-utvidelser; hvis du logger inn med samme konto, synkroniseres det lagrede ordforrådet ditt sammen.

## 2. Hvordan vi bruker informasjonen din

Vi bruker informasjonen ovenfor **kun** til å:

* autentisere deg og holde deg innlogget på tvers av økter;
* lagre ordforrådet ditt og synkronisere det på tvers av enhetene dine, slik at du kan se over det senere;
* håndheve en rimelig daglig grense for lagrede ord for å forhindre misbruk;
* undersøke feil ved lasting av undertekster som du eksplisitt rapporterer via knappen **"Last inn siden på nytt"**, slik at vi kan rette dem.

Vi bruker ikke informasjonen din til annonsering, profilering, eller noe formål utover å tilby de synkroniserings- og diagnostikkfunksjonene som er beskrevet her.

## 3. Lokal lagring (på din enhet)

Utvidelsen bruker nettleserens utvidelseslagring (`chrome.storage`) for å oppbevare, kun på din enhet:

* dine språk- og undertekst-layoutpreferanser;
* et lokalt antall av hvor mange ord du har lagret;
* hvis du er innlogget: dine autentiseringstokener, e-postadressen din og bruker-ID-en din (slik at du forblir innlogget), samt en kortvarig innloggings-nonce i øktlagring (session storage).

Disse lokale dataene forlater aldri nettleseren din, bortsett fra der avsnitt 4 beskriver (lagrede ord synkronisert til skyen). Utlogging fjerner autentiseringstokener, e-post og bruker-ID fra enheten din.

## 4. Skylagring og tredjepartstjenester

Når du er innlogget, lagres kontoen din og lagret ordforråd ved hjelp av **Google Firebase** (Firebase Authentication, Cloud Firestore og Secure Token Service), driftet av utvikleren på Google Cloud-infrastruktur. Google behandler disse dataene som vår tjenesteleverandør; se Googles personvernerklæring på https://policies.google.com/privacy. Tilgangen er begrenset av Firestore-sikkerhetsregler, slik at du bare kan lese og skrive dine egne data.

For å vise undertekster leser Utvidelsen undertekstsporene som YouTube-spilleren allerede tilbyr for videoen du ser på, **direkte i nettleseren din**. Denne undertekstbehandlingen:

* skjer utelukkende i nettleseren din, uten noen mellomliggende proxy fra vår side;
* sender ingen kontodata eller lagrede ord til YouTube;
* er underlagt YouTubes egen personvernerklæring og vilkår.

## 5. Deling og salg av data

Vi selger, leier ikke ut, eller handler **ikke** med dine personopplysninger. Vi deler dem ikke med noen tredjepart, bortsett fra Google Firebase som infrastrukturleverandør beskrevet i avsnitt 4, eller der loven krever det. Vi bruker ikke dataene dine til annonsering.

## 6. Lagring og sletting av data

* **Lagret ordforråd** oppbevares i skyen inntil du sletter det eller ber om sletting av kontoen.
* **Diagnoserapporter** oppbevares kun for feilsøkingsformål og omfattes av forespørsler om kontosletting (de er knyttet til din bruker-ID).
* **Lokale data** kan når som helst tømmes ved å logge ut (fjerner tokenene, e-posten og bruker-ID-en din) eller ved å fjerne Utvidelsen fra nettleseren din.
* For å **slette kontoen din og alle tilknyttede skydata** (e-post, lagrede ord og diagnoserapporter), kontakt utvikleren via avsnitt 9. Vi vil slette dem innen rimelig tid.

## 7. Sikkerhet

Autentiseringstokener oppbevares i nettleserens utvidelseslagring. Alle nettverksforespørsler sendes over HTTPS. Skydata er beskyttet av Firebase Authentication og Firestore-sikkerhetsregler som begrenser hver bruker til sine egne poster. Ingen overførings- eller lagringsmetode er 100 % sikker, men vi tar rimelige forholdsregler for å beskytte informasjonen din.

## 8. Barns personvern

Utvidelsen er ikke rettet mot barn under 13 år (eller tilsvarende minstealder i din jurisdiksjon), og vi samler ikke bevisst inn personopplysninger fra dem.

## 9. Endringer i denne erklæringen

Vi kan oppdatere denne personvernerklæringen fra tid til annen. Vesentlige endringer vil bli gjenspeilet her med en oppdatert "Sist oppdatert"-dato. Fortsatt bruk av Utvidelsen etter en oppdatering utgjør aksept av den reviderte erklæringen.

## 10. Kontakt

For spørsmål om denne personvernerklæringen, eller for å be om sletting av kontoen og dataene dine, vennligst kontakt utvikleren via prosjektets offisielle repositorium eller via Chrome Web Store-støttesiden for Utvidelsen.

---

*Lingogram er et uavhengig verktøy og er ikke tilknyttet, autorisert av eller godkjent av YouTube eller noen av videoplattformene det støtter.*
