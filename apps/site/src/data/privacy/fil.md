*Ang pagsasaling ito ay batay sa mas lumang bersyon ng patakaran at hindi kasama ang mga pinakabagong pagbabago. Ang bersyong Ingles sa https://lingogram.ai/privacy/ ang siyang masusunod.*

# Patakaran sa Privacy — Lingogram: Dual Subtitles & Transcript for YouTube

**Petsa ng bisa:** Hunyo 22, 2026
**Huling na-update:** Hulyo 13, 2026

Ipinapaliwanag ng Patakarang ito sa Privacy kung anong impormasyon ang
kinokolekta ng browser extension na **Lingogram: Dual Subtitles & Transcript
for YouTube** ("ang Extension"), kung paano ito ginagamit, kung saan ito
iniimbak, at ang mga pagpipilian mo.

---

## Buod

* **Kung walang account, walang kinokolekta ang Extension tungkol sa iyo.**
  Ang interactive na transcript, listening challenge, dual subtitles, at
  lokal na pag-save ng salita ay tuluyang tumatakbo sa loob ng iyong browser,
  at walang personal na datos na ipinapadala sa amin.
* **Opsyonal lang ang pag-sign in.** Layunin lang nito ay i-sync ang na-save
  mong bokabularyo sa iba't ibang device. Kung pipiliin mong mag-sign in,
  kinokolekta namin ang iyong **email address** at iniimbak ang **mga
  salitang tahasan mong sine-save** (kasama ang nakapaligid na linya ng
  subtitle) sa aming cloud database.
* **Opt-in ang diagnostics, isang click lang.** Kung hindi ma-load ang mga
  subtitle, ang emergency na butong **"Reload page"** (lumalabas lamang
  matapos ang isang hindi matagumpay na muling pagsubok) ay nagpapadala sa
  amin ng isang-click na diagnostic report — ang address ng video kasama ang
  mga teknikal na detalye — para masolusyunan namin ang problema. Sinasabi ito
  ng banner sa tabi mismo ng button; walang awtomatikong iniuulat.
* **Hindi** namin ibinebenta ang iyong datos, hindi nagpapakita ng ads, hindi
  nagpapatakbo ng third-party advertising o analytics trackers, at hindi
  sinusubaybayan ang kasaysayan ng iyong pagba-browse.

---

## 1. Impormasyong Kinokolekta Namin

### a. Kung **hindi** ka mag-sign in
Ang Extension ay **hindi** kumokolekta, nagpapadala, o nag-iimbak ng anumang
personal na datos sa aming mga server. Ang mga kagustuhan mo sa wika at
layout, pati na ang lokal na "words saved" counter, ay iniimbak lamang sa iyong
browser (tingnan ang Seksyon 3). Walang account, email, o na-save na salita na
umaalis sa iyong device.

### b. Kung pipiliin mong mag-sign in (opsyonal na account)
Ang pag-sign in ay nagbibigay-daan sa cross-device sync ng iyong na-save na
bokabularyo. Kapag nag-sign in ka, kinokolekta at pinoproseso namin ang:

* **Datos ng account** — ang iyong **email address** at isang user ID na
  ginawa ng Firebase. Ang mga ito ang nagbibigay-kakilanlan sa iyong account
  at nag-uugnay sa iyong mga na-save na salita sa iyo.
* **Na-save na bokabularyo** — mga item lamang na tahasan mong pinipiling
  i-save habang nanonood. Para sa bawat na-save na item, iniimbak namin ang:
  * ang **salita o parirala** na napili mo;
  * kaunting **konteksto ng subtitle** — ang na-save na linya ng subtitle
    kasama ang linyang kaagad bago at pagkatapos nito, sa pangunahing wika
    lamang ng subtitle ng video;
  * isang **source tag** na nagpapahiwatig kung aling Extension ang nag-save nito;
  * isang **timestamp** at isang per-day counter na ginagamit lamang para
    ipatupad ang limitasyon sa pang-araw-araw na pag-save.
* **Diagnostic reports** — kapag lang hindi na-load ang mga subtitle at
  tahasan mong pinindot ang butong **"Reload page"** sa error banner (na
  nagsasaad na may ipapadalang report). Ang bawat report ay naglalaman ng:
  hostname ng website, ang address (URL) o ID ng video na kinaroonan ng
  pagkabigo, ang pares ng wika ng subtitle na pinili mo (ang wikang
  pinag-aaralan mo at ang iyong katutubong wika), ang bersyon ng Extension,
  ang wika ng interface ng iyong browser, isang source tag na kumikilala sa
  Extension, at isang server timestamp. Ipinapadala lamang ang mga report
  habang naka-sign in ka, may limitasyong isa bawat account kada araw, at
  ginagamit lamang para siyasatin ang pagkabigo.

**Hindi** namin kinokolekta: ang kasaysayan ng iyong pagba-browse, ang mga
video na pinanood mo (maliban sa teksto ng subtitle na tahasan mong sine-save
at ang iisang address ng video na kasama sa isang diagnostic report na
tahasan mong ipinasimuno), pagsubaybay sa lokasyon batay sa IP, mga
advertising identifier, mga cookies para sa pagsubaybay, o anumang analytics
tungkol sa kung paano mo ginagamit ang Extension.

> Gumagana ang iyong Lingogram account sa aming ibang mga extension ng
> Lingogram; kung mag-sign in ka gamit ang parehong account, magkakasabay na
> mag-sy-sync ang iyong na-save na bokabularyo.

## 2. Paano Namin Ginagamit ang Iyong Impormasyon

Ginagamit lamang namin ang impormasyong nasa itaas para:

* patunayan ang pagkakakilanlan mo at panatilihin kang naka-sign in sa iba't
  ibang session;
* iimbak ang iyong na-save na bokabularyo at i-sync ito sa iyong mga device
  para masuri mo ito sa ibang pagkakataon;
* ipatupad ang makatwirang limitasyon sa araw-araw para sa mga na-save na
  salita upang maiwasan ang abuso;
* siyasatin ang mga pagkabigo sa pag-load ng subtitle na tahasan mong
  iniulat sa pamamagitan ng butong **"Reload page"**, para maayos namin ito.

Hindi namin ginagamit ang iyong impormasyon para sa advertising, profiling,
o anumang layunin na lampas sa pagbibigay ng mga tampok na sync at diagnostics
na inilarawan dito.

## 3. Lokal na Imbakan (Sa Iyong Device)

Ginagamit ng Extension ang extension storage ng iyong browser (`chrome.storage`)
para itago, sa iyong device lamang:

* ang iyong mga kagustuhan sa wika at layout ng subtitle;
* isang lokal na bilang kung ilang salita na ang na-save mo;
* kung naka-sign in ka: ang iyong mga authentication token, email address, at
  user ID (para manatili kang naka-sign in), at isang panandaliang sign-in
  nonce sa session storage.

Ang lokal na datos na ito ay hindi kailanman umaalis sa iyong browser maliban
sa inilarawan sa Seksyon 4 (na-save na salitang na-sync sa cloud). Ang
pag-sign out ay nag-aalis ng mga authentication token, email, at user ID mula
sa iyong device.

## 4. Cloud Storage at Third-Party Services

Kapag naka-sign in ka, ang iyong account at na-save na bokabularyo ay
iniimbak gamit ang **Google Firebase** (Firebase Authentication, Cloud
Firestore, at Secure Token Service), na pinapatakbo ng developer sa Google
Cloud infrastructure. Pinoproseso ng Google ang datos na ito bilang aming
service provider; tingnan ang Patakaran sa Privacy ng Google sa
https://policies.google.com/privacy. Ang access ay pinaghihigpitan ng mga
security rule ng Firestore para lang mabasa at masulatan mo ang sarili
mong datos.

Para ipakita ang mga subtitle, binabasa ng Extension ang mga subtitle
(caption) track na ibinibigay na ng YouTube player para sa video na pinapanood
mo, **direkta sa loob ng iyong browser**. Ang pagproseso ng subtitle na ito:

* nagaganap nang tuluyan sa iyong browser, na walang panamantalang proxy
  namin;
* hindi nagpapadala ng datos ng account o na-save na salita sa YouTube;
* napapailalim sa sariling patakaran sa privacy at mga tuntunin ng YouTube.

## 5. Pagbabahagi at Pagbebenta ng Datos

**Hindi** namin ibinebenta, ipinaparenta, o ipinagpapalit ang iyong personal
na datos. Hindi namin ito ibinabahagi sa anumang third party maliban sa
Google Firebase bilang tagapagbigay ng infrastructure na inilarawan sa
Seksyon 4, o kung hinihiling ng batas. Hindi namin ginagamit ang iyong datos
para sa advertising.

## 6. Pagpapanatili at Pagbura ng Datos

* **Ang na-save na bokabularyo** ay itinatago sa cloud hanggang sa burahin mo
  ito o humiling ng pagbura ng account.
* **Ang mga diagnostic report** ay itinatago lamang para sa troubleshooting
  at saklaw ng mga kahilingan sa pagbura ng account (naka-key ang mga ito sa
  iyong user ID).
* **Ang lokal na datos** ay maaaring burahin anumang oras sa pamamagitan ng
  pag-sign out (inaalis ang iyong mga token, email, at user ID) o sa pag-alis
  ng Extension mula sa iyong browser.
* Para **burahin ang iyong account at lahat ng kaugnay na datos sa cloud**
  (email, na-save na salita, at diagnostic reports), makipag-ugnayan sa
  developer gamit ang Seksyon 9. Buburahin namin ito sa loob ng makatwirang
  panahon.

## 7. Seguridad

Ang mga authentication token ay itinatago sa extension storage ng iyong
browser. Lahat ng network request ay ginagawa sa pamamagitan ng HTTPS. Ang
cloud data ay protektado ng Firebase Authentication at mga security rule ng
Firestore na naghihigpit sa bawat user sa sarili lamang nilang mga record.
Walang paraan ng transmission o storage na 100% ligtas, ngunit gumagawa kami
ng makatwirang mga hakbang para protektahan ang iyong impormasyon.

## 8. Privacy ng mga Bata

Ang Extension ay hindi nakatuon sa mga batang wala pang 13 taong gulang (o
katumbas na pinakamababang edad sa iyong hurisdiksyon), at hindi namin sinasadyang
kinokolekta ang personal na datos mula sa kanila.

## 9. Mga Pagbabago sa Patakarang Ito

Maaari naming i-update ang Patakarang ito sa Privacy paminsan-minsan. Ang mga
makabuluhang pagbabago ay ipapakita rito kasama ang na-update na petsa ng
"Huling na-update." Ang patuloy na paggamit ng Extension pagkatapos ng
isang update ay bumubuo ng pagtanggap sa binagong patakaran.

## 10. Contact

Para sa anumang tanong tungkol sa Patakarang ito sa Privacy, o para humiling
ng pagbura ng iyong account at datos, mangyaring makipag-ugnayan sa developer
sa pamamagitan ng opisyal na repository ng proyekto o sa pamamagitan ng
support page ng Chrome Web Store para sa Extension.

---

*Ang Lingogram ay isang independiyenteng tool at hindi kaakibat, pinahintulutan,
o inendorso ng YouTube o alinman sa mga video platform na sinusuportahan nito.*
