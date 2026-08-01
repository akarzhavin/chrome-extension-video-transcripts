# Privacybeleid — Lingogram: Dual Subtitles & Transcript for YouTube

**Ingangsdatum:** 22 juni 2026
**Laatst bijgewerkt:** 13 juli 2026

Dit Privacybeleid legt uit welke informatie de browserextensie **Lingogram: Dual Subtitles & Transcript for YouTube** ("de Extensie") verzamelt, hoe deze wordt gebruikt, waar deze wordt opgeslagen en welke keuzes u heeft.

---

## Kort samengevat

* **Zonder account verzamelt de Extensie niets over u.** Het interactieve transcript, de luisteropdracht, de dubbele ondertiteling en het lokaal opslaan van woorden werken volledig binnen uw browser, en er worden geen persoonsgegevens naar ons verzonden.
* **Inloggen is optioneel.** Het bestaat uitsluitend om uw opgeslagen woordenschat te synchroniseren tussen apparaten. Als u ervoor kiest in te loggen, verzamelen wij uw **e-mailadres** en slaan wij de **woorden die u expliciet opslaat** (samen met de omliggende ondertitelregels) op in onze clouddatabase.
* **Diagnostiek is opt-in, met één klik.** Als ondertitels niet kunnen worden geladen, stuurt een noodknop **"Pagina herladen"** (die alleen verschijnt na een mislukte nieuwe poging) met één klik een diagnostisch rapport naar ons — het adres van de video plus technische details — zodat we het probleem kunnen oplossen. De banner vermeldt dit direct naast de knop; er wordt niets automatisch gerapporteerd.
* Wij verkopen uw gegevens **niet**, tonen geen advertenties, gebruiken geen advertentie- of analysetrackers van derden en volgen uw browsegeschiedenis niet.

---

## 1. Informatie die wij verzamelen

### a. Als u **niet** inlogt
De Extensie verzamelt, verzendt of slaat **geen** persoonsgegevens op onze servers op. Uw taal- en indelingsvoorkeuren en een lokale teller van "opgeslagen woorden" worden alleen in uw browser bewaard (zie Sectie 3). Geen account, e-mailadres of opgeslagen woord verlaat ooit uw apparaat.

### b. Als u ervoor kiest in te loggen (optioneel account)
Inloggen maakt synchronisatie van uw opgeslagen woordenschat tussen apparaten mogelijk. Wanneer u inlogt, verzamelen en verwerken wij:

* **Accountgegevens** — uw **e-mailadres** en een door Firebase gegenereerde gebruikers-ID. Deze identificeren uw account en koppelen uw opgeslagen woorden aan u.
* **Opgeslagen woordenschat** — alleen de items die u expliciet kiest op te slaan tijdens het kijken. Voor elk opgeslagen item bewaren wij:
  * het **woord of de zinsnede** die u heeft geselecteerd;
  * een kleine hoeveelheid **ondertitelcontext** — de opgeslagen ondertitelregel plus de regel direct ervoor en erna, uitsluitend in de primaire ondertitelingstaal van de video;
  * een **bron-tag** die aangeeft welke Extensie het heeft opgeslagen;
  * een **tijdstempel** en een dagelijkse teller die uitsluitend wordt gebruikt om een dagelijkse opslaglimiet te handhaven.
* **Diagnostische rapporten** — alleen als ondertitels niet kunnen worden geladen en u expliciet op de knop **"Pagina herladen"** op de foutbanner drukt (waarop staat dat er een rapport zal worden verzonden). Elk rapport bevat: de hostnaam van de website, het adres (URL) of de ID van de video waarbij de fout optrad, het door u geselecteerde ondertitelingstaalpaar (de taal die u leert en uw moedertaal), de versie van de Extensie, de interfacetaal van uw browser, een bron-tag die de Extensie identificeert, en een servertijdstempel. Rapporten worden alleen verzonden terwijl u bent ingelogd, zijn beperkt tot maximaal één per account per dag, en worden uitsluitend gebruikt om de fout te onderzoeken.

Wij verzamelen **niet**: uw browsegeschiedenis, de video's die u bekijkt (afgezien van de ondertiteltekst die u expliciet opslaat en het enkele video-adres dat is opgenomen in een diagnostisch rapport dat u expliciet activeert), locatietracking op basis van IP-adres, advertentie-identificatiegegevens, trackingcookies, of enige analyse van hoe u de Extensie gebruikt.

> Uw Lingogram-account werkt ook met onze andere Lingogram-extensies; als u inlogt met hetzelfde account, wordt uw opgeslagen woordenschat gezamenlijk gesynchroniseerd.

## 2. Hoe wij uw informatie gebruiken

Wij gebruiken de bovenstaande informatie **uitsluitend** om:

* u te authenticeren en u tussen sessies ingelogd te houden;
* uw opgeslagen woordenschat te bewaren en te synchroniseren tussen uw apparaten, zodat u deze later kunt bekijken;
* een redelijke dagelijkse limiet op opgeslagen woorden te handhaven om misbruik te voorkomen;
* de ondertitelingsproblemen te onderzoeken die u expliciet meldt via de knop **"Pagina herladen"**, zodat we ze kunnen oplossen.

Wij gebruiken uw informatie niet voor advertenties, profilering of enig ander doel dan het bieden van de hierboven beschreven synchronisatie- en diagnostiekfuncties.

## 3. Lokale opslag (op uw apparaat)

De Extensie gebruikt de extensieopslag van uw browser (`chrome.storage`) om, uitsluitend op uw apparaat, het volgende te bewaren:

* uw taal- en ondertitelindelingsvoorkeuren;
* een lokale telling van hoeveel woorden u heeft opgeslagen;
* als u bent ingelogd: uw authenticatietokens, uw e-mailadres en uw gebruikers-ID (zodat u ingelogd blijft), en een kortlevende inlog-nonce in sessieopslag.

Deze lokale gegevens verlaten uw browser nooit, behalve zoals beschreven in Sectie 4 (opgeslagen woorden die naar de cloud worden gesynchroniseerd). Uitloggen verwijdert de authenticatietokens, het e-mailadres en de gebruikers-ID van uw apparaat.

## 4. Cloudopslag en diensten van derden

Wanneer u bent ingelogd, worden uw account en opgeslagen woordenschat opgeslagen met behulp van **Google Firebase** (Firebase Authentication, Cloud Firestore en Secure Token Service), beheerd door de ontwikkelaar op de infrastructuur van Google Cloud. Google verwerkt deze gegevens als onze dienstverlener; zie het privacybeleid van Google op https://policies.google.com/privacy. De toegang is beperkt door Firestore-beveiligingsregels, zodat u alleen uw eigen gegevens kunt lezen en schrijven.

Om ondertitels weer te geven, leest de Extensie de ondertitelsporen die de YouTube-speler al levert voor de video die u bekijkt, **rechtstreeks binnen uw browser**. Deze verwerking van ondertitels:

* vindt volledig plaats in uw browser, zonder enige tussenliggende proxy van ons;
* verzendt geen accountgegevens of opgeslagen woorden naar YouTube;
* valt onder het eigen privacybeleid en de eigen voorwaarden van YouTube.

## 5. Delen en verkopen van gegevens

Wij verkopen, verhuren of verhandelen uw persoonsgegevens **niet**. Wij delen deze met geen enkele derde partij, behalve met Google Firebase als de in Sectie 4 beschreven infrastructuurleverancier, of indien wettelijk vereist. Wij gebruiken uw gegevens niet voor advertenties.

## 6. Bewaring en verwijdering van gegevens

* **Opgeslagen woordenschat** wordt in de cloud bewaard totdat u deze verwijdert of verwijdering van uw account aanvraagt.
* **Diagnostische rapporten** worden alleen bewaard voor probleemoplossing en vallen onder verzoeken tot accountverwijdering (ze zijn gekoppeld aan uw gebruikers-ID).
* **Lokale gegevens** kunnen op elk moment worden gewist door uit te loggen (waardoor uw tokens, e-mailadres en gebruikers-ID worden verwijderd) of door de Extensie uit uw browser te verwijderen.
* Om **uw account en alle bijbehorende cloudgegevens te verwijderen** (e-mailadres, opgeslagen woorden en diagnostische rapporten), neemt u contact op met de ontwikkelaar via Sectie 9. Wij zullen deze binnen een redelijke termijn verwijderen.

## 7. Beveiliging

Authenticatietokens worden bewaard in de extensieopslag van uw browser. Alle netwerkverzoeken verlopen via HTTPS. Cloudgegevens worden beschermd door Firebase Authentication en Firestore-beveiligingsregels die elke gebruiker beperken tot zijn eigen records. Geen enkele methode van verzending of opslag is 100% veilig, maar wij nemen redelijke maatregelen om uw informatie te beschermen.

## 8. Privacy van kinderen

De Extensie is niet gericht op kinderen onder de 13 jaar (of de gelijkwaardige minimumleeftijd in uw rechtsgebied), en wij verzamelen niet bewust persoonsgegevens van hen.

## 9. Wijzigingen in dit beleid

Wij kunnen dit Privacybeleid van tijd tot tijd bijwerken. Materiële wijzigingen worden hier weergegeven met een bijgewerkte datum "Laatst bijgewerkt". Voortgezet gebruik van de Extensie na een update houdt aanvaarding van het herziene beleid in.

## 10. Contact

Voor vragen over dit Privacybeleid, of om verwijdering van uw account en gegevens aan te vragen, neemt u contact op met de ontwikkelaar via de officiële repository van het project of via de ondersteuningspagina van de Chrome Web Store voor de Extensie.

---

*Lingogram is een onafhankelijke tool en is niet gelieerd aan, geautoriseerd door of onderschreven door YouTube of enig ander videoplatform dat het ondersteunt.*
