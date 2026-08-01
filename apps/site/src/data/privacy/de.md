# Datenschutzerklärung — Lingogram: Dual Subtitles & Transcript for YouTube

**Datum des Inkrafttretens:** 22. Juni 2026
**Zuletzt aktualisiert:** 13. Juli 2026

Diese Datenschutzerklärung erklärt, welche Informationen die Browser-Erweiterung
**Lingogram: Dual Subtitles & Transcript for YouTube** ("die Erweiterung") erfasst,
wie sie verwendet wird, wo sie gespeichert wird und welche Wahlmöglichkeiten Sie
haben.

---

## Kurzfassung (TL;DR)

* **Ohne Konto erfasst die Erweiterung nichts über Sie.** Das interaktive
  Transkript, die Hörherausforderung, die zweisprachigen Untertitel und das lokale
  Speichern von Wörtern laufen vollständig in Ihrem Browser, und es werden keine
  personenbezogenen Daten an uns gesendet.
* **Die Anmeldung ist optional.** Sie dient nur dazu, Ihren gespeicherten
  Wortschatz geräteübergreifend zu synchronisieren. Wenn Sie sich anmelden,
  erfassen wir Ihre **E-Mail-Adresse** und speichern die **von Ihnen ausdrücklich
  gespeicherten Wörter** (mit den umgebenden Untertitelzeilen) in unserer
  Cloud-Datenbank.
* **Diagnosen sind opt-in, mit einem Klick.** Wenn das Laden der Untertitel
  fehlschlägt, sendet eine Notfall-Schaltfläche **"Reload page"** (die nur nach
  einem fehlgeschlagenen erneuten Versuch angezeigt wird) mit einem Klick einen
  Diagnosebericht an uns — die Adresse des Videos sowie technische Details —,
  damit wir das Problem beheben können. Der Banner weist genau neben der
  Schaltfläche darauf hin; nichts wird automatisch gemeldet.
* Wir verkaufen Ihre Daten **nicht**, zeigen keine Werbung, betreiben keine
  Werbe- oder Analyse-Tracker von Drittanbietern und verfolgen nicht Ihren
  Browserverlauf.

---

## 1. Informationen, die wir erfassen

### a. Wenn Sie sich **nicht** anmelden
Die Erweiterung erfasst, überträgt oder speichert **keine** personenbezogenen
Daten auf unseren Servern. Ihre Sprach- und Layout-Einstellungen sowie ein
lokaler Zähler für "gespeicherte Wörter" werden nur in Ihrem Browser gespeichert
(siehe Abschnitt 3). Kein Konto, keine E-Mail und kein gespeichertes Wort
verlassen jemals Ihr Gerät.

### b. Wenn Sie sich anmelden (optionales Konto)
Die Anmeldung ermöglicht die geräteübergreifende Synchronisierung Ihres
gespeicherten Wortschatzes. Wenn Sie sich anmelden, erfassen und verarbeiten
wir:

* **Kontodaten** — Ihre **E-Mail-Adresse** und eine von Firebase generierte
  Benutzer-ID. Diese identifizieren Ihr Konto und ordnen die gespeicherten
  Wörter Ihnen zu.
* **Gespeicherter Wortschatz** — nur die Elemente, die Sie beim Ansehen
  ausdrücklich zum Speichern auswählen. Für jedes gespeicherte Element speichern
  wir:
  * das ausgewählte **Wort oder die Phrase**;
  * eine kleine Menge **Untertitelkontext** — die gespeicherte Untertitelzeile
    sowie die unmittelbar davor und danach stehende Zeile, nur in der primären
    Untertitelsprache des Videos;
  * eine **Quellenkennzeichnung**, die angibt, welche Erweiterung es gespeichert
    hat;
  * einen **Zeitstempel** und einen täglichen Zähler, der nur zur Durchsetzung
    eines täglichen Speicherlimits dient.
* **Diagnoseberichte** — nur wenn das Laden der Untertitel fehlschlägt und Sie
  ausdrücklich die Schaltfläche **"Reload page"** auf dem Fehlerbanner drücken
  (der angibt, dass ein Bericht gesendet wird). Jeder Bericht enthält: den
  Hostnamen der Website, die Adresse (URL) oder ID des Videos, bei dem der
  Fehler auftrat, das von Ihnen gewählte Untertitelsprachenpaar (die Sprache,
  die Sie lernen, und Ihre Muttersprache), die Version der Erweiterung, die
  Oberflächensprache Ihres Browsers, eine Quellenkennzeichnung zur Identifizierung
  der Erweiterung und einen Server-Zeitstempel. Berichte werden nur gesendet,
  während Sie angemeldet sind, sind auf einen pro Konto und Tag begrenzt und
  werden ausschließlich zur Untersuchung des Fehlers verwendet.

Wir erfassen **nicht**: Ihren Browserverlauf, die von Ihnen angesehenen Videos
(abgesehen vom Untertiteltext, den Sie ausdrücklich speichern, und der einzelnen
Videoadresse, die in einem von Ihnen ausdrücklich ausgelösten Diagnosebericht
enthalten ist), IP-basierte Standortverfolgung, Werbe-IDs, Tracking-Cookies oder
jegliche Analysen darüber, wie Sie die Erweiterung nutzen.

> Ihr Lingogram-Konto funktioniert auch mit unseren anderen Lingogram-Erweiterungen;
> wenn Sie sich mit demselben Konto anmelden, wird Ihr gespeicherter Wortschatz
> gemeinsam synchronisiert.

## 2. Wie wir Ihre Informationen verwenden

Wir verwenden die oben genannten Informationen **ausschließlich**, um:

* Sie zu authentifizieren und Sie über Sitzungen hinweg angemeldet zu halten;
* Ihren gespeicherten Wortschatz zu speichern und geräteübergreifend zu
  synchronisieren, damit Sie ihn später überprüfen können;
* ein angemessenes tägliches Limit für gespeicherte Wörter durchzusetzen, um
  Missbrauch zu verhindern;
* die von Ihnen ausdrücklich über die Schaltfläche **"Reload page"** gemeldeten
  Fehler beim Laden von Untertiteln zu untersuchen, damit wir sie beheben können.

Wir verwenden Ihre Informationen nicht für Werbung, Profilerstellung oder einen
anderen Zweck als die Bereitstellung der hier beschriebenen
Synchronisierungs- und Diagnosefunktionen.

## 3. Lokale Speicherung (auf Ihrem Gerät)

Die Erweiterung verwendet den Erweiterungsspeicher Ihres Browsers
(`chrome.storage`), um Folgendes ausschließlich auf Ihrem Gerät zu speichern:

* Ihre Sprach- und Untertitel-Layout-Einstellungen;
* eine lokale Zählung, wie viele Wörter Sie gespeichert haben;
* wenn Sie angemeldet sind: Ihre Authentifizierungstoken, Ihre E-Mail-Adresse
  und Ihre Benutzer-ID (damit Sie angemeldet bleiben) sowie eine kurzlebige
  Anmelde-Nonce im Sitzungsspeicher.

Diese lokalen Daten verlassen Ihren Browser niemals, außer in dem in Abschnitt 4
beschriebenen Fall (in die Cloud synchronisierte gespeicherte Wörter). Das
Abmelden entfernt die Authentifizierungstoken, die E-Mail und die Benutzer-ID
von Ihrem Gerät.

## 4. Cloud-Speicherung und Dienste von Drittanbietern

Wenn Sie angemeldet sind, werden Ihr Konto und Ihr gespeicherter Wortschatz mit
**Google Firebase** (Firebase Authentication, Cloud Firestore und Secure Token
Service) gespeichert, das vom Entwickler auf der Google-Cloud-Infrastruktur
betrieben wird. Google verarbeitet diese Daten als unser Dienstleister; siehe
die Datenschutzerklärung von Google unter https://policies.google.com/privacy.
Der Zugriff ist durch Firestore-Sicherheitsregeln eingeschränkt, sodass Sie nur
Ihre eigenen Daten lesen und schreiben können.

Um Untertitel anzuzeigen, liest die Erweiterung die Untertitelspuren, die der
YouTube-Player für das von Ihnen angesehene Video bereits bereitstellt,
**direkt in Ihrem Browser**. Diese Untertitelverarbeitung:

* erfolgt vollständig in Ihrem Browser, ohne zwischengeschalteten Proxy
  unsererseits;
* sendet keine Kontodaten oder gespeicherten Wörter an YouTube;
* unterliegt der eigenen Datenschutzerklärung und den Nutzungsbedingungen von
  YouTube.

## 5. Datenweitergabe und -verkauf

Wir verkaufen, vermieten oder handeln **nicht** mit Ihren personenbezogenen
Daten. Wir geben sie an keine Drittpartei weiter, außer an Google Firebase als
den in Abschnitt 4 beschriebenen Infrastrukturanbieter oder wenn dies
gesetzlich vorgeschrieben ist. Wir verwenden Ihre Daten nicht für Werbung.

## 6. Datenspeicherung und -löschung

* **Gespeicherter Wortschatz** wird in der Cloud aufbewahrt, bis Sie ihn löschen
  oder die Löschung Ihres Kontos beantragen.
* **Diagnoseberichte** werden nur zur Fehlerbehebung aufbewahrt und sind von
  Anträgen auf Kontolöschung erfasst (sie sind an Ihre Benutzer-ID gebunden).
* **Lokale Daten** können jederzeit durch Abmelden (entfernt Ihre Token,
  E-Mail und Benutzer-ID) oder durch Entfernen der Erweiterung aus Ihrem
  Browser gelöscht werden.
* Um **Ihr Konto und alle zugehörigen Cloud-Daten zu löschen** (E-Mail,
  gespeicherte Wörter und Diagnoseberichte), kontaktieren Sie den Entwickler
  über Abschnitt 9. Wir werden sie innerhalb eines angemessenen Zeitraums
  löschen.

## 7. Sicherheit

Authentifizierungstoken werden im Erweiterungsspeicher Ihres Browsers
aufbewahrt. Alle Netzwerkanfragen erfolgen über HTTPS. Cloud-Daten sind durch
Firebase Authentication und Firestore-Sicherheitsregeln geschützt, die jeden
Benutzer auf seine eigenen Datensätze beschränken. Keine Methode der
Übertragung oder Speicherung ist zu 100 % sicher, aber wir ergreifen
angemessene Maßnahmen zum Schutz Ihrer Informationen.

## 8. Datenschutz für Kinder

Die Erweiterung richtet sich nicht an Kinder unter 13 Jahren (oder dem
entsprechenden Mindestalter in Ihrer Rechtsordnung), und wir erfassen
wissentlich keine personenbezogenen Daten von ihnen.

## 9. Änderungen dieser Richtlinie

Wir können diese Datenschutzerklärung von Zeit zu Zeit aktualisieren.
Wesentliche Änderungen werden hier mit einem aktualisierten Datum "Zuletzt
aktualisiert" widergespiegelt. Die fortgesetzte Nutzung der Erweiterung nach
einer Aktualisierung stellt die Annahme der überarbeiteten Richtlinie dar.

## 10. Kontakt

Bei Fragen zu dieser Datenschutzerklärung oder um die Löschung Ihres Kontos
und Ihrer Daten zu beantragen, wenden Sie sich bitte über das offizielle
Repository des Projekts oder über die Support-Seite der Erweiterung im Chrome
Web Store an den Entwickler.

---

*Lingogram ist ein unabhängiges Tool und steht in keiner Verbindung zu YouTube
oder einer der von ihm unterstützten Videoplattformen und wird von diesen
weder autorisiert noch unterstützt.*
