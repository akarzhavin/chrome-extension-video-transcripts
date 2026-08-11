*Această traducere corespunde unei versiuni anterioare a politicii și nu include modificările recente. Versiunea în limba engleză de la https://lingogram.ai/privacy/ este cea valabilă.*

# Politica de confidențialitate — Lingogram: Dual Subtitles & Transcript for YouTube

**Data intrării în vigoare:** 22 iunie 2026
**Ultima actualizare:** 13 iulie 2026

Această Politică de confidențialitate explică ce informații colectează extensia de browser **Lingogram: Dual Subtitles & Transcript for YouTube** ("Extensia"), cum sunt utilizate, unde sunt stocate și ce opțiuni aveți la dispoziție.

---

## Pe scurt

* **Fără cont, Extensia nu colectează nimic despre dumneavoastră.** Transcrierea interactivă, exercițiul de ascultare, subtitrările duble și salvarea locală a cuvintelor funcționează în întregime în cadrul browserului dumneavoastră, iar niciun date cu caracter personal nu ne este trimis.
* **Autentificarea este opțională.** Aceasta există doar pentru a sincroniza vocabularul salvat între dispozitive. Dacă alegeți să vă autentificați, colectăm **adresa dumneavoastră de e-mail** și stocăm **cuvintele pe care le salvați în mod explicit** (împreună cu liniile de subtitrare din jur) în baza noastră de date din cloud.
* **Diagnosticarea este opțională (opt-in), cu un singur clic.** Dacă subtitrările nu se încarcă, un buton de urgență **„Reîncarcă pagina"** (afișat doar după o nouă încercare eșuată) trimite, cu un singur clic, un raport de diagnostic către noi — adresa videoclipului plus detalii tehnice — pentru a putea remedia problema. Bannerul menționează acest lucru chiar lângă buton; nimic nu este raportat automat.
* **Nu** vă vindem datele, nu afișăm reclame, nu utilizăm instrumente de urmărire publicitară sau de analiză ale unor terți și nu urmărim istoricul dumneavoastră de navigare.

---

## 1. Informații pe care le colectăm

### a. Dacă **nu** vă autentificați
Extensia **nu** colectează, transmite sau stochează niciun date cu caracter personal pe serverele noastre. Preferințele dumneavoastră de limbă și aspect, precum și un contor local pentru „cuvinte salvate", sunt păstrate doar în browserul dumneavoastră (a se vedea Secțiunea 3). Niciun cont, adresă de e-mail sau cuvânt salvat nu părăsește vreodată dispozitivul dumneavoastră.

### b. Dacă alegeți să vă autentificați (cont opțional)
Autentificarea permite sincronizarea între dispozitive a vocabularului salvat. Când vă autentificați, colectăm și procesăm:

* **Date despre cont** — **adresa dumneavoastră de e-mail** și un ID de utilizator generat de Firebase. Acestea identifică contul dumneavoastră și asociază cuvintele salvate cu dumneavoastră.
* **Vocabular salvat** — doar elementele pe care alegeți în mod explicit să le salvați în timp ce urmăriți conținutul. Pentru fiecare element salvat, stocăm:
  * **cuvântul sau expresia** selectată;
  * o cantitate mică de **context de subtitrare** — linia de subtitrare salvată, plus linia imediat anterioară și cea imediat următoare, doar în limba principală de subtitrare a videoclipului;
  * o **etichetă de sursă** care indică ce Extensie a salvat elementul respectiv;
  * o **marcă temporală** și un contor zilnic utilizat exclusiv pentru a aplica o limită zilnică de salvare.
* **Rapoarte de diagnostic** — doar dacă subtitrările nu se încarcă și apăsați în mod explicit butonul **„Reîncarcă pagina"** de pe bannerul de eroare (care menționează că va fi trimis un raport). Fiecare raport conține: numele de gazdă al site-ului web, adresa (URL) sau ID-ul videoclipului la care a apărut eroarea, perechea de limbi de subtitrare pe care ați selectat-o (limba pe care o învățați și limba dumneavoastră maternă), versiunea Extensiei, limba interfeței browserului dumneavoastră, o etichetă de sursă care identifică Extensia și o marcă temporală de server. Rapoartele sunt trimise doar cât timp sunteți autentificat(ă), sunt limitate la unul pe cont pe zi și sunt utilizate exclusiv pentru investigarea erorii.

**Nu** colectăm: istoricul dumneavoastră de navigare, videoclipurile pe care le urmăriți (dincolo de textul de subtitrare pe care îl salvați în mod explicit și de adresa unică a videoclipului inclusă într-un raport de diagnostic pe care îl declanșați în mod explicit), urmărirea locației pe baza IP-ului, identificatori publicitari, cookie-uri de urmărire sau orice analiză privind modul în care utilizați Extensia.

> Contul dumneavoastră Lingogram funcționează și cu celelalte extensii Lingogram ale noastre; dacă vă autentificați cu același cont, vocabularul salvat se sincronizează împreună.

## 2. Cum utilizăm informațiile dumneavoastră

Utilizăm informațiile de mai sus **doar** pentru a:

* vă autentifica și a vă menține conectat(ă) între sesiuni;
* stoca vocabularul dumneavoastră salvat și a-l sincroniza între dispozitivele dumneavoastră, astfel încât să îl puteți revizui ulterior;
* aplica o limită zilnică rezonabilă pentru cuvintele salvate, pentru a preveni abuzurile;
* investiga erorile de încărcare a subtitrărilor pe care le raportați în mod explicit prin butonul **„Reîncarcă pagina"**, astfel încât să le putem remedia.

Nu utilizăm informațiile dumneavoastră în scopuri publicitare, de creare de profiluri sau în orice alt scop dincolo de furnizarea funcțiilor de sincronizare și diagnosticare descrise aici.

## 3. Stocare locală (pe dispozitivul dumneavoastră)

Extensia utilizează spațiul de stocare pentru extensii al browserului dumneavoastră (`chrome.storage`) pentru a păstra, doar pe dispozitivul dumneavoastră:

* preferințele dumneavoastră de limbă și aspect al subtitrărilor;
* un număr local al cuvintelor pe care le-ați salvat;
* dacă sunteți autentificat(ă): token-urile dumneavoastră de autentificare, adresa dumneavoastră de e-mail și ID-ul dumneavoastră de utilizator (pentru a rămâne autentificat(ă)), precum și un nonce de autentificare de scurtă durată în spațiul de stocare al sesiunii.

Aceste date locale nu părăsesc niciodată browserul dumneavoastră, cu excepția cazurilor descrise în Secțiunea 4 (cuvinte salvate sincronizate cu cloud-ul). Deconectarea elimină token-urile de autentificare, adresa de e-mail și ID-ul de utilizator de pe dispozitivul dumneavoastră.

## 4. Stocare în cloud și servicii terțe

Când sunteți autentificat(ă), contul dumneavoastră și vocabularul salvat sunt stocate folosind **Google Firebase** (Firebase Authentication, Cloud Firestore și Secure Token Service), operat de dezvoltator pe infrastructura Google Cloud. Google prelucrează aceste date în calitate de furnizor de servicii al nostru; consultați Politica de confidențialitate Google la https://policies.google.com/privacy. Accesul este restricționat prin reguli de securitate Firestore, astfel încât puteți citi și scrie doar propriile dumneavoastră date.

Pentru a afișa subtitrările, Extensia citește pistele de subtitrare (captions) pe care playerul YouTube le furnizează deja pentru videoclipul pe care îl urmăriți, **direct în cadrul browserului dumneavoastră**. Această procesare a subtitrărilor:

* are loc în întregime în browserul dumneavoastră, fără niciun proxy intermediar al nostru;
* nu trimite date despre cont sau cuvinte salvate către YouTube;
* face obiectul propriei politici de confidențialitate și al termenilor și condițiilor YouTube.

## 5. Partajarea și vânzarea datelor

**Nu** vindem, nu închiriem și nu comercializăm datele dumneavoastră cu caracter personal. Nu le partajăm cu niciun terț, cu excepția Google Firebase, în calitate de furnizor de infrastructură descris în Secțiunea 4, sau atunci când legea o impune. Nu utilizăm datele dumneavoastră în scopuri publicitare.

## 6. Păstrarea și ștergerea datelor

* **Vocabularul salvat** este păstrat în cloud până când îl ștergeți sau solicitați ștergerea contului.
* **Rapoartele de diagnostic** sunt păstrate doar în scopul depanării și sunt acoperite de solicitările de ștergere a contului (sunt asociate cu ID-ul dumneavoastră de utilizator).
* **Datele locale** pot fi șterse în orice moment prin deconectare (elimină token-urile, adresa de e-mail și ID-ul de utilizator) sau prin eliminarea Extensiei din browserul dumneavoastră.
* Pentru a **șterge contul dumneavoastră și toate datele din cloud asociate** (e-mail, cuvinte salvate și rapoarte de diagnostic), contactați dezvoltatorul folosind Secțiunea 9. Le vom șterge într-un termen rezonabil.

## 7. Securitate

Token-urile de autentificare sunt păstrate în spațiul de stocare pentru extensii al browserului dumneavoastră. Toate solicitările de rețea sunt efectuate prin HTTPS. Datele din cloud sunt protejate prin Firebase Authentication și reguli de securitate Firestore care restricționează fiecare utilizator la propriile sale înregistrări. Nicio metodă de transmitere sau stocare nu este 100% sigură, dar luăm măsuri rezonabile pentru a vă proteja informațiile.

## 8. Confidențialitatea copiilor

Extensia nu este destinată copiilor cu vârsta sub 13 ani (sau vârsta minimă echivalentă din jurisdicția dumneavoastră), iar noi nu colectăm cu bună știință date cu caracter personal de la aceștia.

## 9. Modificări ale acestei politici

Este posibil să actualizăm periodic această Politică de confidențialitate. Modificările semnificative vor fi reflectate aici printr-o dată „Ultima actualizare" actualizată. Utilizarea în continuare a Extensiei după o actualizare constituie acceptarea politicii revizuite.

## 10. Contact

Pentru orice întrebări referitoare la această Politică de confidențialitate sau pentru a solicita ștergerea contului și a datelor dumneavoastră, vă rugăm să contactați dezvoltatorul prin intermediul depozitului oficial al proiectului sau prin pagina de asistență Chrome Web Store pentru Extensie.

---

*Lingogram este un instrument independent și nu este afiliat, autorizat sau susținut de YouTube sau de oricare dintre platformele video pe care le suportă.*
