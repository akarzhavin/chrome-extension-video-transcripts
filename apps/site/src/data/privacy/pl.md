*To tłumaczenie dotyczy wcześniejszej wersji polityki i nie zawiera najnowszych zmian. Wersją rozstrzygającą jest wersja angielska pod adresem https://lingogram.ai/privacy/.*

# Polityka prywatności — Lingogram: Dual Subtitles & Transcript for YouTube

**Data wejścia w życie:** 22 czerwca 2026
**Ostatnia aktualizacja:** 13 lipca 2026

Niniejsza Polityka prywatności wyjaśnia, jakie informacje zbiera rozszerzenie przeglądarki **Lingogram: Dual Subtitles & Transcript for YouTube** ("Rozszerzenie"), w jaki sposób są one wykorzystywane, gdzie są przechowywane oraz jakie masz możliwości wyboru.

---

## W skrócie

* **Bez konta Rozszerzenie nie zbiera o Tobie żadnych informacji.** Interaktywny transkrypt, ćwiczenie ze słuchania, dwujęzyczne napisy oraz lokalne zapisywanie słów działają wyłącznie w Twojej przeglądarce, a żadne dane osobowe nie są do nas przesyłane.
* **Logowanie jest opcjonalne.** Istnieje wyłącznie po to, aby synchronizować zapisane słownictwo między urządzeniami. Jeśli zdecydujesz się zalogować, zbieramy Twój **adres e-mail** i przechowujemy w naszej bazie danych w chmurze **słowa, które wyraźnie zapisałeś/aś** (wraz z otaczającymi je liniami napisów).
* **Diagnostyka jest opcjonalna (opt-in) i uruchamiana jednym kliknięciem.** Jeśli napisy nie ładują się poprawnie, przycisk awaryjny **„Odśwież stronę"** (wyświetlany dopiero po nieudanej ponownej próbie) jednym kliknięciem wysyła do nas raport diagnostyczny — adres filmu oraz szczegóły techniczne — abyśmy mogli rozwiązać problem. Baner informuje o tym bezpośrednio obok przycisku; nic nie jest zgłaszane automatycznie.
* **Nie** sprzedajemy Twoich danych, nie wyświetlamy reklam, nie korzystamy z zewnętrznych narzędzi śledzących do reklam ani analityki i nie śledzimy historii Twojego przeglądania.

---

## 1. Informacje, które zbieramy

### a. Jeśli **nie** logujesz się
Rozszerzenie **nie** zbiera, nie przesyła ani nie przechowuje żadnych danych osobowych na naszych serwerach. Twoje preferencje dotyczące języka i układu oraz lokalny licznik „zapisanych słów" są przechowywane wyłącznie w Twojej przeglądarce (patrz sekcja 3). Żadne konto, adres e-mail ani zapisane słowo nigdy nie opuszczają Twojego urządzenia.

### b. Jeśli zdecydujesz się zalogować (konto opcjonalne)
Zalogowanie się umożliwia synchronizację zapisanego słownictwa między urządzeniami. Po zalogowaniu zbieramy i przetwarzamy:

* **Dane konta** — Twój **adres e-mail** oraz identyfikator użytkownika wygenerowany przez Firebase. Identyfikują one Twoje konto i wiążą zapisane słowa z Twoją osobą.
* **Zapisane słownictwo** — wyłącznie elementy, które wyraźnie wybierzesz do zapisania podczas oglądania. Dla każdego zapisanego elementu przechowujemy:
  * wybrane **słowo lub wyrażenie**;
  * niewielką ilość **kontekstu napisów** — zapisaną linię napisów oraz linię bezpośrednio przed nią i po niej, wyłącznie w podstawowym języku napisów danego filmu;
  * **znacznik źródła** wskazujący, które Rozszerzenie zapisało dany element;
  * **znacznik czasu** oraz dzienny licznik, wykorzystywany wyłącznie do egzekwowania dziennego limitu zapisów.
* **Raporty diagnostyczne** — tylko wtedy, gdy napisy nie załadują się i wyraźnie naciśniesz przycisk **„Odśwież stronę"** na banerze błędu (który informuje, że raport zostanie wysłany). Każdy raport zawiera: nazwę hosta strony internetowej, adres (URL) lub identyfikator filmu, przy którym wystąpił błąd, wybraną przez Ciebie parę języków napisów (język, którego się uczysz, oraz Twój język ojczysty), wersję Rozszerzenia, język interfejsu Twojej przeglądarki, znacznik źródła identyfikujący Rozszerzenie oraz znacznik czasu serwera. Raporty są wysyłane wyłącznie wtedy, gdy jesteś zalogowany/a, są ograniczone do jednego na konto dziennie i służą wyłącznie do zbadania przyczyny błędu.

**Nie** zbieramy: historii Twojego przeglądania, oglądanych filmów (poza tekstem napisów, który wyraźnie zapisujesz, oraz pojedynczym adresem filmu zawartym w raporcie diagnostycznym, który sam/a wyraźnie uruchamiasz), śledzenia lokalizacji na podstawie adresu IP, identyfikatorów reklamowych, plików cookie śledzących ani żadnej analityki dotyczącej sposobu korzystania z Rozszerzenia.

> Twoje konto Lingogram działa również z naszymi innymi rozszerzeniami Lingogram; jeśli zalogujesz się na to samo konto, Twoje zapisane słownictwo zostanie zsynchronizowane wspólnie.

## 2. Jak wykorzystujemy Twoje informacje

Powyższe informacje wykorzystujemy **wyłącznie** w celu:

* uwierzytelnienia Cię i utrzymania zalogowania między sesjami;
* przechowywania zapisanego słownictwa i synchronizowania go między Twoimi urządzeniami, abyś mógł/mogła je później przejrzeć;
* egzekwowania rozsądnego dziennego limitu zapisywanych słów w celu zapobiegania nadużyciom;
* zbadania błędów ładowania napisów, które wyraźnie zgłaszasz za pomocą przycisku **„Odśwież stronę"**, abyśmy mogli je naprawić.

Nie wykorzystujemy Twoich informacji do celów reklamowych, profilowania ani żadnego innego celu wykraczającego poza opisane tu funkcje synchronizacji i diagnostyki.

## 3. Przechowywanie lokalne (na Twoim urządzeniu)

Rozszerzenie wykorzystuje pamięć rozszerzeń Twojej przeglądarki (`chrome.storage`), aby przechowywać wyłącznie na Twoim urządzeniu:

* Twoje preferencje dotyczące języka i układu napisów;
* lokalny licznik liczby zapisanych przez Ciebie słów;
* jeśli jesteś zalogowany/a: Twoje tokeny uwierzytelniające, adres e-mail oraz identyfikator użytkownika (aby utrzymać zalogowanie), a także krótkotrwały jednorazowy kod logowania (nonce) w pamięci sesji.

Te lokalne dane nigdy nie opuszczają Twojej przeglądarki, z wyjątkiem sytuacji opisanych w sekcji 4 (zapisane słowa synchronizowane z chmurą). Wylogowanie usuwa tokeny uwierzytelniające, adres e-mail i identyfikator użytkownika z Twojego urządzenia.

## 4. Przechowywanie w chmurze i usługi stron trzecich

Gdy jesteś zalogowany/a, Twoje konto i zapisane słownictwo są przechowywane za pomocą **Google Firebase** (Firebase Authentication, Cloud Firestore i Secure Token Service), obsługiwanego przez dewelopera w infrastrukturze Google Cloud. Google przetwarza te dane jako nasz dostawca usług; zobacz Politykę prywatności Google pod adresem https://policies.google.com/privacy. Dostęp jest ograniczony regułami bezpieczeństwa Firestore, dzięki czemu możesz odczytywać i zapisywać wyłącznie własne dane.

Aby wyświetlić napisy, Rozszerzenie odczytuje ścieżki napisów (napisy dialogowe), które odtwarzacz YouTube już udostępnia dla oglądanego filmu, **bezpośrednio w Twojej przeglądarce**. Ta obsługa napisów:

* odbywa się w całości w Twojej przeglądarce, bez żadnego pośredniczącego serwera proxy z naszej strony;
* nie wysyła żadnych danych konta ani zapisanych słów do YouTube;
* podlega własnej polityce prywatności i regulaminowi YouTube.

## 5. Udostępnianie i sprzedaż danych

**Nie** sprzedajemy, nie wynajmujemy ani nie wymieniamy Twoich danych osobowych. Nie udostępniamy ich żadnej stronie trzeciej, z wyjątkiem Google Firebase jako dostawcy infrastruktury opisanego w sekcji 4, lub gdy wymaga tego prawo. Nie wykorzystujemy Twoich danych do celów reklamowych.

## 6. Przechowywanie i usuwanie danych

* **Zapisane słownictwo** jest przechowywane w chmurze do momentu jego usunięcia lub złożenia wniosku o usunięcie konta.
* **Raporty diagnostyczne** są przechowywane wyłącznie w celach rozwiązywania problemów i są objęte wnioskami o usunięcie konta (są powiązane z Twoim identyfikatorem użytkownika).
* **Dane lokalne** można w dowolnym momencie wyczyścić, wylogowując się (usuwa Twoje tokeny, adres e-mail i identyfikator użytkownika) lub usuwając Rozszerzenie z przeglądarki.
* Aby **usunąć swoje konto i wszystkie powiązane dane w chmurze** (adres e-mail, zapisane słowa i raporty diagnostyczne), skontaktuj się z deweloperem, korzystając z sekcji 9. Usuniemy je w rozsądnym terminie.

## 7. Bezpieczeństwo

Tokeny uwierzytelniające są przechowywane w pamięci rozszerzeń Twojej przeglądarki. Wszystkie żądania sieciowe są wykonywane za pośrednictwem HTTPS. Dane w chmurze są chronione przez Firebase Authentication oraz reguły bezpieczeństwa Firestore, które ograniczają każdego użytkownika wyłącznie do jego własnych rekordów. Żadna metoda transmisji ani przechowywania danych nie jest w 100% bezpieczna, ale podejmujemy rozsądne środki w celu ochrony Twoich informacji.

## 8. Prywatność dzieci

Rozszerzenie nie jest kierowane do dzieci poniżej 13. roku życia (lub równoważnego minimalnego wieku w Twojej jurysdykcji), a my świadomie nie zbieramy od nich danych osobowych.

## 9. Zmiany w niniejszej Polityce

Możemy od czasu do czasu aktualizować niniejszą Politykę prywatności. Istotne zmiany zostaną tu odzwierciedlone poprzez zaktualizowanie daty „Ostatnia aktualizacja". Dalsze korzystanie z Rozszerzenia po aktualizacji oznacza akceptację zmienionej polityki.

## 10. Kontakt

W przypadku pytań dotyczących niniejszej Polityki prywatności lub w celu złożenia wniosku o usunięcie konta i danych, skontaktuj się z deweloperem za pośrednictwem oficjalnego repozytorium projektu lub strony pomocy technicznej Chrome Web Store dla Rozszerzenia.

---

*Lingogram jest niezależnym narzędziem i nie jest powiązany, autoryzowany ani popierany przez YouTube ani żadną z obsługiwanych przez niego platform wideo.*
