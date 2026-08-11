*Questa traduzione si riferisce a una versione precedente dell'informativa e non include le modifiche più recenti. Fa fede la versione inglese su https://lingogram.ai/privacy/.*

# Informativa sulla privacy — Lingogram: Dual Subtitles & Transcript for YouTube

**Data di entrata in vigore:** 22 giugno 2026
**Ultimo aggiornamento:** 13 luglio 2026

La presente Informativa sulla privacy spiega quali informazioni raccoglie
l'estensione del browser **Lingogram: Dual Subtitles & Transcript for
YouTube** ("l'Estensione"), come vengono utilizzate, dove sono conservate e
quali sono le tue possibilità di scelta.

---

## In breve

* **Senza un account, l'Estensione non raccoglie nulla su di te.** La
  trascrizione interattiva, l'esercizio di ascolto, i sottotitoli doppi e il
  salvataggio locale delle parole funzionano interamente all'interno del tuo
  browser e nessun dato personale ci viene inviato.
* **L'accesso è facoltativo.** Esiste unicamente per sincronizzare il tuo
  vocabolario salvato tra i vari dispositivi. Se scegli di accedere,
  raccogliamo il tuo **indirizzo email** e conserviamo le **parole che
  scegli esplicitamente di salvare** (insieme alle righe di sottotitoli
  circostanti) nel nostro database cloud.
* **La diagnostica è facoltativa, con un solo clic.** Se i sottotitoli non
  si caricano, un pulsante di emergenza **"Ricarica pagina"** (mostrato solo
  dopo un nuovo tentativo fallito) ci invia, con un clic, un rapporto
  diagnostico — l'indirizzo del video e dettagli tecnici — per permetterci
  di risolvere il problema. Il banner lo indica proprio accanto al pulsante;
  nulla viene segnalato automaticamente.
* **Non** vendiamo i tuoi dati, non mostriamo pubblicità, non utilizziamo
  strumenti di tracciamento pubblicitario o analitico di terze parti e non
  tracciamo la cronologia di navigazione.

---

## 1. Informazioni che raccogliamo

### a. Se **non** accedi
L'Estensione **non** raccoglie, trasmette o memorizza alcun dato personale
sui nostri server. Le tue preferenze di lingua e layout, e un contatore
locale delle "parole salvate", sono conservate solo nel tuo browser (vedi
Sezione 3). Nessun account, email o parola salvata lascia mai il tuo
dispositivo.

### b. Se scegli di accedere (account facoltativo)
L'accesso consente la sincronizzazione tra dispositivi del tuo vocabolario
salvato. Quando accedi, raccogliamo ed elaboriamo:

* **Dati dell'account** — il tuo **indirizzo email** e un ID utente generato
  da Firebase. Questi identificano il tuo account e associano le tue parole
  salvate a te.
* **Vocabolario salvato** — solo gli elementi che scegli esplicitamente di
  salvare mentre guardi. Per ogni elemento salvato, conserviamo:
  * la **parola o frase** selezionata;
  * una piccola quantità di **contesto del sottotitolo** — la riga di
    sottotitolo salvata insieme alla riga immediatamente precedente e
    successiva, solo nella lingua principale dei sottotitoli del video;
  * un **tag di origine** che indica quale Estensione l'ha salvata;
  * un **timestamp** e un contatore giornaliero utilizzati esclusivamente
    per applicare un limite giornaliero di salvataggio.
* **Rapporti diagnostici** — solo se i sottotitoli non si caricano e premi
  esplicitamente il pulsante **"Ricarica pagina"** sul banner di errore
  (che indica che verrà inviato un rapporto). Ogni rapporto contiene: il
  nome host del sito web, l'indirizzo (URL) o l'ID del video in cui si è
  verificato l'errore, la coppia di lingue dei sottotitoli selezionata (la
  lingua che stai imparando e la tua lingua madre), la versione
  dell'Estensione, la lingua dell'interfaccia del tuo browser, un tag di
  origine che identifica l'Estensione e un timestamp del server. I rapporti
  vengono inviati solo mentre sei connesso, sono limitati a uno per account
  al giorno e vengono utilizzati esclusivamente per indagare sull'errore.

Non raccogliamo: la tua cronologia di navigazione, i video che guardi (oltre
al testo dei sottotitoli che salvi esplicitamente e all'indirizzo del
singolo video incluso in un rapporto diagnostico che attivi esplicitamente),
il tracciamento della posizione basato su IP, identificatori pubblicitari,
cookie di tracciamento, o qualsiasi analitica su come utilizzi
l'Estensione.

> Il tuo account Lingogram funziona con le altre nostre estensioni
> Lingogram; se accedi con lo stesso account, il tuo vocabolario salvato si
> sincronizza insieme.

## 2. Come utilizziamo le tue informazioni

Utilizziamo le informazioni sopra indicate **esclusivamente** per:

* autenticarti e mantenerti connesso tra le sessioni;
* memorizzare il tuo vocabolario salvato e sincronizzarlo tra i tuoi
  dispositivi in modo che tu possa consultarlo in seguito;
* applicare un limite giornaliero ragionevole alle parole salvate per
  prevenire abusi;
* indagare sugli errori di caricamento dei sottotitoli che segnali
  esplicitamente tramite il pulsante **"Ricarica pagina"**, in modo da
  poterli correggere.

Non utilizziamo le tue informazioni per pubblicità, profilazione o per
qualsiasi scopo diverso dalla fornitura delle funzionalità di
sincronizzazione e diagnostica qui descritte.

## 3. Archiviazione locale (sul tuo dispositivo)

L'Estensione utilizza lo spazio di archiviazione delle estensioni del tuo
browser (`chrome.storage`) per conservare, esclusivamente sul tuo
dispositivo:

* le tue preferenze di lingua e layout dei sottotitoli;
* un conteggio locale di quante parole hai salvato;
* se sei connesso: i tuoi token di autenticazione, il tuo indirizzo email e
  il tuo ID utente (per rimanere connesso), e un nonce di accesso di breve
  durata nell'archiviazione di sessione.

Questi dati locali non lasciano mai il tuo browser, salvo quanto descritto
nella Sezione 4 (parole salvate sincronizzate sul cloud). La disconnessione
rimuove i token di autenticazione, l'email e l'ID utente dal tuo
dispositivo.

## 4. Archiviazione cloud e servizi di terze parti

Quando sei connesso, il tuo account e il tuo vocabolario salvato vengono
memorizzati utilizzando **Google Firebase** (Firebase Authentication,
Cloud Firestore e Secure Token Service), gestito dallo sviluppatore
sull'infrastruttura Google Cloud. Google elabora questi dati in qualità di
nostro fornitore di servizi; consulta l'Informativa sulla privacy di Google
all'indirizzo https://policies.google.com/privacy. L'accesso è limitato
dalle regole di sicurezza di Firestore, in modo da poter leggere e scrivere
solo i tuoi dati.

Per visualizzare i sottotitoli, l'Estensione legge le tracce dei
sottotitoli (caption) già fornite dal player di YouTube per il video che
stai guardando, **direttamente all'interno del tuo browser**. Questa
gestione dei sottotitoli:

* avviene interamente nel tuo browser, senza alcun proxy intermedio da
  parte nostra;
* non invia dati dell'account né parole salvate a YouTube;
* è soggetta all'informativa sulla privacy e ai termini propri di YouTube.

## 5. Condivisione e vendita dei dati

**Non** vendiamo, affittiamo o scambiamo i tuoi dati personali. Non li
condividiamo con terze parti, ad eccezione di Google Firebase in qualità di
fornitore dell'infrastruttura descritto nella Sezione 4, o laddove richiesto
dalla legge. Non utilizziamo i tuoi dati per la pubblicità.

## 6. Conservazione e cancellazione dei dati

* **Il vocabolario salvato** viene conservato nel cloud finché non lo
  elimini o non richiedi la cancellazione dell'account.
* **I rapporti diagnostici** vengono conservati solo a fini di risoluzione
  dei problemi e sono coperti dalle richieste di cancellazione
  dell'account (sono associati al tuo ID utente).
* **I dati locali** possono essere cancellati in qualsiasi momento
  disconnettendosi (rimuove i tuoi token, email e ID utente) o rimuovendo
  l'Estensione dal tuo browser.
* Per **eliminare il tuo account e tutti i dati cloud associati** (email,
  parole salvate e rapporti diagnostici), contatta lo sviluppatore tramite
  la Sezione 9. Li elimineremo entro un periodo di tempo ragionevole.

## 7. Sicurezza

I token di autenticazione sono conservati nello spazio di archiviazione
delle estensioni del tuo browser. Tutte le richieste di rete vengono
effettuate tramite HTTPS. I dati cloud sono protetti da Firebase
Authentication e dalle regole di sicurezza di Firestore che limitano ogni
utente ai propri record. Nessun metodo di trasmissione o archiviazione è
sicuro al 100%, ma adottiamo misure ragionevoli per proteggere le tue
informazioni.

## 8. Privacy dei minori

L'Estensione non è rivolta a minori di 13 anni (o all'età minima
equivalente nella tua giurisdizione), e non raccogliamo consapevolmente
dati personali da loro.

## 9. Modifiche alla presente informativa

Potremmo aggiornare periodicamente questa Informativa sulla privacy. Le
modifiche sostanziali saranno riportate qui con una data di "Ultimo
aggiornamento" aggiornata. L'uso continuato dell'Estensione dopo un
aggiornamento costituisce accettazione della politica rivista.

## 10. Contatti

Per qualsiasi domanda su questa Informativa sulla privacy, o per richiedere
la cancellazione del tuo account e dei tuoi dati, contatta lo sviluppatore
tramite il repository ufficiale del progetto o tramite la pagina di
supporto del Chrome Web Store per l'Estensione.

---

*Lingogram è uno strumento indipendente e non è affiliato, autorizzato o
approvato da YouTube o da nessuna delle piattaforme video che supporta.*
