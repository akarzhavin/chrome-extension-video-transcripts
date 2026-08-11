# Política de privacidad — Lingogram: Dual Subtitles & Transcript for YouTube

**Fecha de vigencia:** 22 de junio de 2026
**Última actualización:** 10 de agosto de 2026

Esta Política de privacidad explica qué información recopila la extensión de
navegador **Lingogram: Dual Subtitles & Transcript for YouTube** ("la Extensión"),
cómo se utiliza, dónde se almacena y qué opciones tiene usted.

---

## Resumen (TL;DR)

* **Sin una cuenta, la Extensión no recopila nada sobre usted.** La transcripción
  interactiva, el desafío de escucha, los subtítulos dobles y el guardado local de
  palabras funcionan íntegramente dentro de su navegador, y no se envían datos
  personales a nosotros.
* **Iniciar sesión es opcional.** Existe únicamente para sincronizar su
  vocabulario guardado entre dispositivos. Si elige iniciar sesión, recopilamos su
  **dirección de correo electrónico** y almacenamos las **palabras que guarda
  explícitamente** (con las líneas de subtítulos circundantes) en nuestra base de
  datos en la nube.
* **El diagnóstico es opcional (opt-in), con un solo clic.** Si los subtítulos no
  se cargan, un botón de emergencia **"Reload page"** (que se muestra solo tras un
  reintento fallido) envía un informe de diagnóstico con un clic — la dirección
  del video más detalles técnicos — para que podamos solucionar el problema. El
  aviso lo indica justo al lado del botón; nada se informa automáticamente.
* **Contamos el uso de forma anónima, y usted puede desactivarlo.** La
  Extensión nos envía eventos de uso anónimos (por ejemplo: se instaló la
  Extensión, se cargaron los subtítulos, se guardó una palabra) etiquetados con
  un **identificador aleatorio generado en su dispositivo**, no con su correo
  electrónico ni con su cuenta. Ese identificador nunca se vincula a su cuenta
  de Lingogram. Abra la ventana emergente de la barra de herramientas →
  **Privacidad** → desmarque **"Compartir estadísticas de uso anónimas"** y la
  recopilación se detiene de inmediato.
* **No** vendemos sus datos, no mostramos anuncios, no operamos rastreadores
  publicitarios, no elaboramos perfiles publicitarios, ni rastreamos su
  historial de navegación.

---

## 1. Información que recopilamos

### a. Si **no** inicia sesión
Aparte de los análisis de uso anónimos descritos en la sección 1c (que puede
desactivar con un solo clic), la Extensión **no** recopila, transmite ni
almacena ningún dato personal en nuestros servidores. Sus preferencias de idioma y diseño, así como un contador
local de "palabras guardadas", se conservan solo en su navegador (véase la
sección 3). Ninguna cuenta, correo electrónico o palabra guardada sale jamás de
su dispositivo.

### b. Si elige iniciar sesión (cuenta opcional)
Iniciar sesión permite la sincronización entre dispositivos de su vocabulario
guardado. Cuando inicia sesión, recopilamos y procesamos:

* **Datos de la cuenta** — su **dirección de correo electrónico** y un ID de
  usuario generado por Firebase. Estos identifican su cuenta y asocian las
  palabras guardadas con usted.
* **Vocabulario guardado** — solo los elementos que elige explícitamente guardar
  mientras ve el contenido. Para cada elemento guardado, almacenamos:
  * la **palabra o frase** que seleccionó;
  * una pequeña cantidad de **contexto de subtítulos** — la línea de subtítulo
    guardada más la línea inmediatamente anterior y posterior, solo en el idioma
    principal de subtítulos del video;
  * una **etiqueta de origen** que indica qué Extensión lo guardó;
  * una **marca de tiempo** y un contador diario usado únicamente para aplicar un
    límite diario de guardado.
* **Informes de diagnóstico** — solo si los subtítulos no se cargan y usted
  presiona explícitamente el botón **"Reload page"** en el aviso de error (que
  indica que se enviará un informe). Cada informe contiene: el nombre de host del
  sitio web, la dirección (URL) o el ID del video en el que ocurrió el fallo, el
  par de idiomas de subtítulos que seleccionó (el idioma que está aprendiendo y
  su idioma nativo), la versión de la Extensión, el idioma de la interfaz de su
  navegador, una etiqueta de origen que identifica la Extensión, y una marca de
  tiempo del servidor. Los informes se envían solo mientras tiene la sesión
  iniciada, están limitados a uno por cuenta al día, y se utilizan únicamente
  para investigar el fallo.

**No** recopilamos: su historial de navegación, los videos que ve (más allá del
texto de subtítulos que guarda explícitamente y la única dirección de video
incluida en un informe de diagnóstico que usted activa explícitamente; los
análisis de la sección 1c registran solo una etiqueta genérica de plataforma
como `youtube`, nunca un video ni una URL), el seguimiento de ubicación basado
en IP, identificadores publicitarios, ni cookies de rastreo.

> Su cuenta de Lingogram funciona con nuestras otras extensiones de Lingogram; si
> inicia sesión con la misma cuenta, su vocabulario guardado se sincroniza en
> conjunto.

### c. Análisis de uso anónimos (activados de forma predeterminada, se desactivan con un clic)

La Extensión envía eventos de uso anónimos a **Google Analytics 4** para que
podamos ver cuántas personas la instalan, dónde falla la Extensión y en qué
pasos la gente abandona. Esto está **activado de forma predeterminada**. Para
desactivarlo, abra la ventana emergente de la barra de herramientas, vaya a la
sección **Privacidad** y desmarque **"Compartir estadísticas de uso anónimas"**.
La recopilación se detiene de inmediato.

**El identificador.** Cada evento lleva un **identificador aleatorio generado en
su dispositivo** la primera vez que se ejecuta la Extensión, almacenado en el
almacenamiento local de extensiones de su navegador. No es su correo
electrónico, no es su ID de usuario de Firebase y no deriva de ninguno de los
dos. **Nunca enviamos la identidad de su cuenta a Google Analytics**, por lo que
no existe ninguna clave que permita unir sus eventos de análisis con su cuenta:
la separación es estructural, no solo una promesa. Borrar el almacenamiento de
la Extensión o reinstalarla genera un identificador nuevo y sin relación con el
anterior.

**Los eventos que enviamos** (17 en total):

* `extension_installed`, `extension_updated` — la Extensión se instaló o se
  actualizó;
* `onboarding_shown`, `languages_configured` — vio la pantalla de primera
  ejecución, eligió sus idiomas;
* `subtitles_loaded`, `dual_subs_shown`, `no_subtitles`, `subs_partial`,
  `subs_rate_limited`, `subs_recovered` — los subtítulos se cargaron, se
  mostraron ambos idiomas, no se encontró ninguno, solo se cargó una parte, la
  plataforma limitó la frecuencia de nuestras solicitudes, o un reintento tuvo
  éxito;
* `word_save_attempt`, `word_saved` — intentó guardar una palabra, y se guardó;
* `signin_started` — comenzó el proceso de inicio de sesión;
* `analytics_opt_out` — desactivó estos análisis (se envía una sola vez, para
  que sepamos cuántas personas los desactivan);
* `retained_d2`, `retained_d7`, `retained_d14` — la Extensión seguía en uso 2, 7
  y 14 días después de la instalación.

**Los campos adjuntos a esos eventos**, y nada más:

* una **etiqueta genérica de plataforma** — una de `youtube`, `netflix`,
  `rezka` o `web`; no un nombre de host, no una URL;
* el **par de idiomas de subtítulos** que eligió (por ejemplo, `"en"` y `"es"`);
* **cuántas pistas de subtítulos** se cargaron;
* **si había iniciado sesión** — un indicador verdadero/falso, sin ningún
  identificador de cuenta;
* un **recuento acumulado de palabras guardadas en este dispositivo**;
* la **versión y la edición de la Extensión**;
* los **días transcurridos desde la instalación**;
* un **código técnico de fallo** cuando los subtítulos fallan;
* un **ID de sesión** que agrupa los eventos de una misma sesión de navegación.

**Lo que nunca se envía:** el video que está viendo (ni título, ni URL, ni ID),
las palabras que guarda, el texto de los subtítulos, el contenido de la página,
su dirección de correo electrónico, su ID de usuario de Firebase y su historial
de navegación.

**El papel de Google.** Google Analytics procesa estos eventos por nosotros como
nuestro proveedor de servicios; consulte la Política de privacidad de Google en
https://policies.google.com/privacy. En nuestra propiedad de Analytics, **Google
Signals está desactivado**, por lo que Google no asocia a estos eventos una
edad, un género, una categoría de intereses ni una audiencia publicitaria, y no
los vincula entre sus dispositivos. **La recopilación granular de ubicación está
desactivada**: los eventos se resuelven **solo hasta el país**, nunca hasta una
ciudad o región. Cada envío incluye `non_personalized_ads: true`. Google
Analytics no se utiliza para elaborar un perfil suyo ni para dirigir
publicidad.

## 2. Cómo usamos su información

Usamos la información anterior **únicamente** para:

* autenticarlo y mantenerlo con la sesión iniciada entre sesiones;
* almacenar su vocabulario guardado y sincronizarlo entre sus dispositivos para
  que pueda revisarlo más tarde;
* aplicar un límite diario razonable sobre las palabras guardadas para prevenir
  el abuso;
* investigar los fallos de carga de subtítulos que usted informa explícitamente
  mediante el botón **"Reload page"**, para que podamos solucionarlos;
* contar el uso de forma anónima y agregada — cuántas instalaciones hay, con
  qué frecuencia fallan los subtítulos, en qué punto la gente abandona antes de
  terminar la configuración — para poder arreglar lo que está roto y mejorar lo
  que resulta confuso. Nunca lo usamos para identificarlo ni para elaborar un
  perfil suyo.

No usamos su información para publicidad, elaboración de perfiles, ni ningún
propósito más allá de proporcionar las funciones de sincronización y diagnóstico
descritas aquí y el recuento de uso agregado también descrito aquí.

## 3. Almacenamiento local (en su dispositivo)

La Extensión utiliza el almacenamiento de extensiones de su navegador
(`chrome.storage`) para conservar, solo en su dispositivo:

* sus preferencias de idioma y diseño de subtítulos;
* un recuento local de cuántas palabras ha guardado;
* su **ajuste de análisis activados/desactivados**, el **identificador aleatorio
  de análisis** descrito en la sección 1c y la **fecha en que instaló** la
  Extensión, además de un **ID de sesión** de análisis en el almacenamiento de
  sesión;
* si tiene la sesión iniciada: sus tokens de autenticación, su dirección de
  correo electrónico y su ID de usuario (para que permanezca con la sesión
  iniciada), y un nonce de inicio de sesión de corta duración en el
  almacenamiento de sesión.

Estos datos locales nunca salen de su navegador, excepto en el caso descrito en
la sección 4 (palabras guardadas sincronizadas con la nube). Cerrar sesión
elimina los tokens de autenticación, el correo electrónico y el ID de usuario de
su dispositivo.

## 4. Almacenamiento en la nube y servicios de terceros

Cuando tiene la sesión iniciada, su cuenta y vocabulario guardado se almacenan
mediante **Google Firebase** (Firebase Authentication, Cloud Firestore y Secure
Token Service), operado por el desarrollador en la infraestructura de Google
Cloud. Google procesa estos datos como nuestro proveedor de servicios; consulte
la Política de privacidad de Google en https://policies.google.com/privacy. El
acceso está restringido por las reglas de seguridad de Firestore, de modo que
usted solo puede leer y escribir sus propios datos.

Los eventos de uso anónimos descritos en la sección 1c se envían a **Google
Analytics 4** (mediante el Measurement Protocol), salvo que desactive los
análisis. Google procesa esos eventos por nosotros como nuestro proveedor de
servicios, bajo la misma Política de privacidad de Google. Firebase y Google
Analytics se utilizan como dos servicios separados, y no enviamos a Google
Analytics nada que permita unir ambos.

Para mostrar subtítulos, la Extensión lee las pistas de subtítulos que el
reproductor de YouTube ya proporciona para el video que está viendo,
**directamente dentro de su navegador**. Este manejo de subtítulos:

* ocurre íntegramente en su navegador, sin ningún proxy intermediario nuestro;
* no envía datos de la cuenta ni palabras guardadas a YouTube;
* está sujeto a la propia política de privacidad y términos de YouTube.

## 5. Uso compartido y venta de datos

**No** vendemos, alquilamos ni comercializamos sus datos personales. No los
compartimos con ningún tercero excepto con Google Firebase y Google Analytics
como proveedores de infraestructura y de análisis descritos en la sección 4, o
cuando lo exija la ley. No usamos
sus datos para publicidad.

## 6. Retención y eliminación de datos

* El **vocabulario guardado** se conserva en la nube hasta que usted lo elimine
  o solicite la eliminación de la cuenta.
* Los **informes de diagnóstico** se conservan solo para la resolución de
  problemas y están cubiertos por las solicitudes de eliminación de cuenta
  (están vinculados a su ID de usuario).
* Los **eventos de uso anónimos** se conservan en Google Analytics durante **2
  meses** y después se eliminan. Como estos eventos no llevan ningún
  identificador de cuenta, **no podemos consultar ni eliminar los eventos que
  pertenecen a una persona concreta, y usted tampoco.** No tenemos forma de
  saber qué eventos provinieron de usted. Desactivar los análisis en la ventana
  emergente de la barra de herramientas detiene cualquier recopilación
  posterior, pero no puede eliminar retroactivamente los eventos ya enviados;
  esos caducan según el plazo de 2 meses.
* Los **datos locales** pueden borrarse en cualquier momento cerrando sesión
  (elimina sus tokens, correo electrónico e ID de usuario) o eliminando la
  Extensión de su navegador (lo que también elimina el identificador aleatorio
  de análisis).
* Para **eliminar su cuenta y todos los datos en la nube asociados** (correo
  electrónico, palabras guardadas e informes de diagnóstico), contacte al
  desarrollador mediante la sección 9. Los eliminaremos dentro de un plazo
  razonable.

## 7. Seguridad

Los tokens de autenticación se conservan en el almacenamiento de extensiones de
su navegador. Todas las solicitudes de red se realizan mediante HTTPS. Los datos
en la nube están protegidos por Firebase Authentication y las reglas de
seguridad de Firestore, que restringen a cada usuario a sus propios registros.
Ningún método de transmisión o almacenamiento es 100% seguro, pero tomamos
medidas razonables para proteger su información.

## 8. Privacidad de los menores

La Extensión no está dirigida a menores de 13 años (o la edad mínima equivalente
en su jurisdicción), y no recopilamos a sabiendas datos personales de ellos.

## 9. Cambios en esta política

Podemos actualizar esta Política de privacidad de vez en cuando. Los cambios
importantes se reflejarán aquí con una fecha de "Última actualización"
actualizada. El uso continuado de la Extensión después de una actualización
constituye la aceptación de la política revisada.

## 10. Contacto

Para cualquier pregunta sobre esta Política de privacidad, o para solicitar la
eliminación de su cuenta y datos, comuníquese con el desarrollador a través del
repositorio oficial del proyecto o mediante la página de soporte de la Chrome
Web Store para la Extensión.

---

*Lingogram es una herramienta independiente y no está afiliada, autorizada ni
respaldada por YouTube ni por ninguna de las plataformas de video que admite.*
