# Política de privacidad — Lingogram: Dual Subtitles & Transcript for YouTube

**Fecha de vigencia:** 22 de junio de 2026
**Última actualización:** 13 de julio de 2026

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
* **No** vendemos sus datos, no mostramos anuncios, no operamos rastreadores
  publicitarios ni analíticos de terceros, ni rastreamos su historial de
  navegación.

---

## 1. Información que recopilamos

### a. Si **no** inicia sesión
La Extensión **no** recopila, transmite ni almacena ningún dato personal en
nuestros servidores. Sus preferencias de idioma y diseño, así como un contador
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
incluida en un informe de diagnóstico que usted activa explícitamente), el
seguimiento de ubicación basado en IP, identificadores publicitarios, cookies de
rastreo, ni ningún análisis sobre cómo usa la Extensión.

> Su cuenta de Lingogram funciona con nuestras otras extensiones de Lingogram; si
> inicia sesión con la misma cuenta, su vocabulario guardado se sincroniza en
> conjunto.

## 2. Cómo usamos su información

Usamos la información anterior **únicamente** para:

* autenticarlo y mantenerlo con la sesión iniciada entre sesiones;
* almacenar su vocabulario guardado y sincronizarlo entre sus dispositivos para
  que pueda revisarlo más tarde;
* aplicar un límite diario razonable sobre las palabras guardadas para prevenir
  el abuso;
* investigar los fallos de carga de subtítulos que usted informa explícitamente
  mediante el botón **"Reload page"**, para que podamos solucionarlos.

No usamos su información para publicidad, elaboración de perfiles, ni ningún
propósito más allá de proporcionar las funciones de sincronización y diagnóstico
descritas aquí.

## 3. Almacenamiento local (en su dispositivo)

La Extensión utiliza el almacenamiento de extensiones de su navegador
(`chrome.storage`) para conservar, solo en su dispositivo:

* sus preferencias de idioma y diseño de subtítulos;
* un recuento local de cuántas palabras ha guardado;
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

Para mostrar subtítulos, la Extensión lee las pistas de subtítulos que el
reproductor de YouTube ya proporciona para el video que está viendo,
**directamente dentro de su navegador**. Este manejo de subtítulos:

* ocurre íntegramente en su navegador, sin ningún proxy intermediario nuestro;
* no envía datos de la cuenta ni palabras guardadas a YouTube;
* está sujeto a la propia política de privacidad y términos de YouTube.

## 5. Uso compartido y venta de datos

**No** vendemos, alquilamos ni comercializamos sus datos personales. No los
compartimos con ningún tercero excepto con Google Firebase como proveedor de
infraestructura descrito en la sección 4, o cuando lo exija la ley. No usamos
sus datos para publicidad.

## 6. Retención y eliminación de datos

* El **vocabulario guardado** se conserva en la nube hasta que usted lo elimine
  o solicite la eliminación de la cuenta.
* Los **informes de diagnóstico** se conservan solo para la resolución de
  problemas y están cubiertos por las solicitudes de eliminación de cuenta
  (están vinculados a su ID de usuario).
* Los **datos locales** pueden borrarse en cualquier momento cerrando sesión
  (elimina sus tokens, correo electrónico e ID de usuario) o eliminando la
  Extensión de su navegador.
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
