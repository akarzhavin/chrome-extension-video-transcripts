*Cette traduction correspond à une version antérieure de la politique et n'inclut pas les modifications récentes. La version anglaise sur https://lingogram.ai/privacy/ fait foi.*

# Politique de confidentialité — Lingogram: Dual Subtitles & Transcript for YouTube

**Date d'entrée en vigueur :** 22 juin 2026
**Dernière mise à jour :** 13 juillet 2026

La présente Politique de confidentialité explique quelles informations
l'extension de navigateur **Lingogram: Dual Subtitles & Transcript for
YouTube** (« l'Extension ») collecte, comment elles sont utilisées, où elles
sont stockées, et quels sont vos choix.

---

## En bref

* **Sans compte, l'Extension ne collecte rien vous concernant.** La
  transcription interactive, l'exercice d'écoute, les sous-titres doubles et
  l'enregistrement local des mots fonctionnent entièrement dans votre
  navigateur, et aucune donnée personnelle ne nous est envoyée.
* **La connexion est facultative.** Elle existe uniquement pour synchroniser
  votre vocabulaire enregistré entre vos appareils. Si vous choisissez de vous
  connecter, nous collectons votre **adresse e-mail** et stockons les
  **mots que vous enregistrez explicitement** (avec les lignes de sous-titres
  environnantes) dans notre base de données cloud.
* **Les diagnostics sont facultatifs, en un clic.** Si les sous-titres ne se
  chargent pas, un bouton d'urgence **« Recharger la page »** (affiché
  uniquement après un nouvel essai infructueux) nous envoie, en un clic, un
  rapport de diagnostic — l'adresse de la vidéo ainsi que des détails
  techniques — afin que nous puissions résoudre le problème. La bannière
  l'indique juste à côté du bouton ; rien n'est signalé automatiquement.
* Nous ne **vendons** pas vos données, n'affichons pas de publicités,
  n'exploitons aucun traceur publicitaire ou analytique tiers, et ne suivons
  pas votre historique de navigation.

---

## 1. Informations que nous collectons

### a. Si vous ne vous connectez **pas**
L'Extension ne collecte, ne transmet ni ne stocke **aucune** donnée
personnelle sur nos serveurs. Vos préférences de langue et de mise en page,
ainsi qu'un compteur local de « mots enregistrés », sont conservés uniquement
dans votre navigateur (voir la Section 3). Aucun compte, e-mail ou mot
enregistré ne quitte jamais votre appareil.

### b. Si vous choisissez de vous connecter (compte facultatif)
La connexion permet la synchronisation de votre vocabulaire enregistré entre
vos appareils. Lorsque vous vous connectez, nous collectons et traitons :

* **Les données de compte** — votre **adresse e-mail** et un identifiant
  utilisateur généré par Firebase. Ceux-ci identifient votre compte et
  associent vos mots enregistrés à vous.
* **Le vocabulaire enregistré** — uniquement les éléments que vous choisissez
  explicitement d'enregistrer pendant le visionnage. Pour chaque élément
  enregistré, nous stockons :
  * le **mot ou l'expression** que vous avez sélectionné ;
  * une petite quantité de **contexte de sous-titre** — la ligne de
    sous-titre enregistrée ainsi que la ligne qui la précède et celle qui la
    suit immédiatement, dans la langue de sous-titre principale de la vidéo
    uniquement ;
  * une **balise source** indiquant quelle Extension l'a enregistré ;
  * un **horodatage** et un compteur quotidien utilisés uniquement pour
    appliquer une limite journalière d'enregistrement.
* **Les rapports de diagnostic** — uniquement si les sous-titres ne se
  chargent pas et que vous appuyez explicitement sur le bouton **« Recharger
  la page »** de la bannière d'erreur (qui précise qu'un rapport sera
  envoyé). Chaque rapport contient : le nom d'hôte du site web, l'adresse
  (URL) ou l'identifiant de la vidéo concernée par l'échec, la paire de
  langues de sous-titres que vous avez sélectionnée (la langue que vous
  apprenez et votre langue maternelle), la version de l'Extension, la langue
  de l'interface de votre navigateur, une balise source identifiant
  l'Extension, et un horodatage serveur. Les rapports ne sont envoyés que
  lorsque vous êtes connecté, sont limités à un par compte et par jour, et
  servent uniquement à enquêter sur l'échec.

Nous ne collectons **pas** : votre historique de navigation, les vidéos que
vous regardez (au-delà du texte de sous-titre que vous enregistrez
explicitement et de l'adresse unique de la vidéo incluse dans un rapport de
diagnostic que vous déclenchez explicitement), le suivi de localisation basé
sur l'IP, les identifiants publicitaires, les cookies de suivi, ni aucune
analyse de la façon dont vous utilisez l'Extension.

> Votre compte Lingogram fonctionne avec nos autres extensions Lingogram ; si
> vous vous connectez avec le même compte, votre vocabulaire enregistré se
> synchronise ensemble.

## 2. Comment nous utilisons vos informations

Nous utilisons les informations ci-dessus **uniquement** pour :

* vous authentifier et vous maintenir connecté d'une session à l'autre ;
* stocker votre vocabulaire enregistré et le synchroniser entre vos appareils
  afin que vous puissiez le consulter ultérieurement ;
* appliquer une limite quotidienne raisonnable sur les mots enregistrés afin
  de prévenir les abus ;
* enquêter sur les échecs de chargement des sous-titres que vous signalez
  explicitement via le bouton **« Recharger la page »**, afin que nous
  puissions les corriger.

Nous n'utilisons pas vos informations à des fins publicitaires, de profilage,
ou à toute autre fin au-delà de la fourniture des fonctionnalités de
synchronisation et de diagnostic décrites ici.

## 3. Stockage local (sur votre appareil)

L'Extension utilise le stockage d'extension de votre navigateur
(`chrome.storage`) pour conserver, sur votre appareil uniquement :

* vos préférences de langue et de mise en page des sous-titres ;
* un compteur local du nombre de mots que vous avez enregistrés ;
* si vous êtes connecté : vos jetons d'authentification, votre adresse
  e-mail et votre identifiant utilisateur (afin que vous restiez connecté),
  ainsi qu'un nonce de connexion à courte durée de vie dans le stockage de
  session.

Ces données locales ne quittent jamais votre navigateur, sauf dans le cas
décrit à la Section 4 (mots enregistrés synchronisés vers le cloud). La
déconnexion supprime les jetons d'authentification, l'e-mail et
l'identifiant utilisateur de votre appareil.

## 4. Stockage cloud et services tiers

Lorsque vous êtes connecté, votre compte et votre vocabulaire enregistré sont
stockés à l'aide de **Google Firebase** (Firebase Authentication, Cloud
Firestore et Secure Token Service), exploité par le développeur sur
l'infrastructure Google Cloud. Google traite ces données en tant que
prestataire de services pour notre compte ; consultez la Politique de
confidentialité de Google à l'adresse
https://policies.google.com/privacy. L'accès est restreint par les règles de
sécurité Firestore afin que vous ne puissiez lire et écrire que vos propres
données.

Pour afficher les sous-titres, l'Extension lit les pistes de sous-titres
(captions) déjà fournies par le lecteur YouTube pour la vidéo que vous
regardez, **directement dans votre navigateur**. Ce traitement des
sous-titres :

* se déroule entièrement dans votre navigateur, sans aucun proxy
  intermédiaire de notre part ;
* n'envoie aucune donnée de compte ni mot enregistré à YouTube ;
* est soumis à la propre politique de confidentialité et aux conditions
  d'utilisation de YouTube.

## 5. Partage et vente de données

Nous ne **vendons**, ne louons ni n'échangeons vos données personnelles.
Nous ne les partageons avec aucun tiers, à l'exception de Google Firebase en
tant que fournisseur d'infrastructure décrit à la Section 4, ou lorsque la
loi l'exige. Nous n'utilisons pas vos données à des fins publicitaires.

## 6. Conservation et suppression des données

* **Le vocabulaire enregistré** est conservé dans le cloud jusqu'à ce que
  vous le supprimiez ou que vous demandiez la suppression de votre compte.
* **Les rapports de diagnostic** sont conservés uniquement à des fins de
  dépannage et sont couverts par les demandes de suppression de compte (ils
  sont associés à votre identifiant utilisateur).
* **Les données locales** peuvent être effacées à tout moment en vous
  déconnectant (ce qui supprime vos jetons, votre e-mail et votre
  identifiant utilisateur) ou en supprimant l'Extension de votre navigateur.
* Pour **supprimer votre compte et toutes les données cloud associées**
  (e-mail, mots enregistrés et rapports de diagnostic), contactez le
  développeur via la Section 9. Nous les supprimerons dans un délai
  raisonnable.

## 7. Sécurité

Les jetons d'authentification sont conservés dans le stockage d'extension de
votre navigateur. Toutes les requêtes réseau sont effectuées via HTTPS. Les
données cloud sont protégées par Firebase Authentication et par des règles
de sécurité Firestore qui limitent chaque utilisateur à ses propres
enregistrements. Aucune méthode de transmission ou de stockage n'est
sécurisée à 100 %, mais nous prenons des mesures raisonnables pour protéger
vos informations.

## 8. Confidentialité des mineurs

L'Extension ne s'adresse pas aux enfants de moins de 13 ans (ou à l'âge
minimum équivalent dans votre juridiction), et nous ne collectons pas
sciemment de données personnelles les concernant.

## 9. Modifications de la présente politique

Nous pouvons mettre à jour cette Politique de confidentialité de temps à
autre. Les changements importants seront reflétés ici avec une date de
« dernière mise à jour » actualisée. La poursuite de l'utilisation de
l'Extension après une mise à jour vaut acceptation de la politique révisée.

## 10. Contact

Pour toute question concernant cette Politique de confidentialité, ou pour
demander la suppression de votre compte et de vos données, veuillez
contacter le développeur via le dépôt officiel du projet ou via la page
d'assistance du Chrome Web Store pour l'Extension.

---

*Lingogram est un outil indépendant qui n'est affilié à, autorisé ou
approuvé par YouTube ni par aucune des plateformes vidéo qu'il prend en
charge.*
