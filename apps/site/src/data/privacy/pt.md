# Política de Privacidade — Lingogram: Dual Subtitles & Transcript for YouTube

**Data de entrada em vigor:** 22 de junho de 2026
**Última atualização:** 13 de julho de 2026

Esta Política de Privacidade explica que informação a extensão de navegador **Lingogram: Dual Subtitles & Transcript for YouTube** ("a Extensão") recolhe, como é utilizada, onde é armazenada e as opções que tem à sua disposição.

---

## Resumo

* **Sem uma conta, a Extensão não recolhe absolutamente nada sobre si.** A transcrição interativa, o exercício de compreensão auditiva, as legendas duplas e a gravação local de palavras funcionam inteiramente dentro do seu navegador, e nenhum dado pessoal nos é enviado.
* **Iniciar sessão é opcional.** Existe apenas para sincronizar o seu vocabulário guardado entre dispositivos. Se optar por iniciar sessão, recolhemos o seu **endereço de e-mail** e armazenamos as **palavras que guarda explicitamente** (com as linhas de legenda envolventes) na nossa base de dados na nuvem.
* **O diagnóstico é opcional (opt-in), com um único clique.** Se as legendas não carregarem, um botão de emergência **"Recarregar página"** (mostrado apenas após uma nova tentativa falhada) envia-nos, com um único clique, um relatório de diagnóstico — o endereço do vídeo mais detalhes técnicos — para que possamos resolver o problema. O aviso indica isto mesmo junto ao botão; nada é reportado automaticamente.
* **Não** vendemos os seus dados, não apresentamos anúncios, não utilizamos rastreadores de publicidade ou análise de terceiros, nem rastreamos o seu histórico de navegação.

---

## 1. Informação que recolhemos

### a. Se **não** iniciar sessão
A Extensão **não** recolhe, transmite ou armazena quaisquer dados pessoais nos nossos servidores. As suas preferências de idioma e disposição, bem como um contador local de "palavras guardadas", são mantidos apenas no seu navegador (ver Secção 3). Nenhuma conta, e-mail ou palavra guardada sai alguma vez do seu dispositivo.

### b. Se optar por iniciar sessão (conta opcional)
Iniciar sessão permite a sincronização entre dispositivos do seu vocabulário guardado. Quando inicia sessão, recolhemos e processamos:

* **Dados da conta** — o seu **endereço de e-mail** e um ID de utilizador gerado pelo Firebase. Estes identificam a sua conta e associam-lhe as palavras guardadas.
* **Vocabulário guardado** — apenas os itens que escolhe explicitamente guardar enquanto assiste. Para cada item guardado, armazenamos:
  * a **palavra ou expressão** que selecionou;
  * uma pequena quantidade de **contexto de legenda** — a linha de legenda guardada, mais a linha imediatamente anterior e posterior, apenas no idioma principal de legendagem do vídeo;
  * uma **etiqueta de origem** que indica qual Extensão a guardou;
  * uma **marca temporal** e um contador diário utilizado apenas para aplicar um limite diário de gravações.
* **Relatórios de diagnóstico** — apenas se as legendas não carregarem e o utilizador premir explicitamente o botão **"Recarregar página"** no aviso de erro (que indica que será enviado um relatório). Cada relatório contém: o nome de anfitrião do site, o endereço (URL) ou ID do vídeo em que ocorreu a falha, o par de idiomas de legendagem que selecionou (o idioma que está a aprender e o seu idioma nativo), a versão da Extensão, o idioma da interface do seu navegador, uma etiqueta de origem que identifica a Extensão e uma marca temporal do servidor. Os relatórios só são enviados enquanto tiver sessão iniciada, estão limitados a um por conta por dia, e são utilizados exclusivamente para investigar a falha.

**Não** recolhemos: o seu histórico de navegação, os vídeos que assiste (para além do texto de legenda que guarda explicitamente e do endereço único do vídeo incluído num relatório de diagnóstico que aciona explicitamente), rastreio de localização com base em IP, identificadores publicitários, cookies de rastreio, ou qualquer análise sobre como utiliza a Extensão.

> A sua conta Lingogram funciona nas nossas outras extensões Lingogram; se iniciar sessão com a mesma conta, o seu vocabulário guardado é sincronizado em conjunto.

## 2. Como utilizamos a sua informação

Utilizamos a informação acima **apenas** para:

* autenticá-lo(a) e manter a sua sessão iniciada entre sessões de navegação;
* armazenar o seu vocabulário guardado e sincronizá-lo entre os seus dispositivos, para que possa consultá-lo mais tarde;
* aplicar um limite diário razoável de palavras guardadas, para evitar abusos;
* investigar as falhas de carregamento de legendas que reporta explicitamente através do botão **"Recarregar página"**, para que possamos corrigi-las.

Não utilizamos a sua informação para publicidade, definição de perfis, ou qualquer finalidade além de fornecer as funcionalidades de sincronização e diagnóstico aqui descritas.

## 3. Armazenamento local (no seu dispositivo)

A Extensão utiliza o armazenamento de extensões do seu navegador (`chrome.storage`) para manter, apenas no seu dispositivo:

* as suas preferências de idioma e disposição das legendas;
* uma contagem local de quantas palavras guardou;
* se tiver sessão iniciada: os seus tokens de autenticação, o seu endereço de e-mail e o seu ID de utilizador (para que permaneça com a sessão iniciada), e um nonce de início de sessão de curta duração no armazenamento de sessão.

Estes dados locais nunca saem do seu navegador, exceto conforme descrito na Secção 4 (palavras guardadas sincronizadas com a nuvem). Terminar a sessão remove os tokens de autenticação, o e-mail e o ID de utilizador do seu dispositivo.

## 4. Armazenamento na nuvem e serviços de terceiros

Quando tem sessão iniciada, a sua conta e o vocabulário guardado são armazenados através do **Google Firebase** (Firebase Authentication, Cloud Firestore e Secure Token Service), operado pelo programador na infraestrutura da Google Cloud. A Google processa estes dados como nosso prestador de serviços; consulte a Política de Privacidade da Google em https://policies.google.com/privacy. O acesso é restrito por regras de segurança do Firestore, pelo que só pode ler e escrever os seus próprios dados.

Para apresentar legendas, a Extensão lê as faixas de legendas que o leitor do YouTube já fornece para o vídeo que está a assistir, **diretamente dentro do seu navegador**. Este processamento de legendas:

* ocorre inteiramente no seu navegador, sem qualquer proxy intermediário nosso;
* não envia quaisquer dados de conta ou palavras guardadas para o YouTube;
* está sujeito à própria política de privacidade e aos termos do YouTube.

## 5. Partilha e venda de dados

**Não** vendemos, arrendamos ou negociamos os seus dados pessoais. Não os partilhamos com terceiros, exceto o Google Firebase, enquanto fornecedor de infraestrutura descrito na Secção 4, ou sempre que exigido por lei. Não utilizamos os seus dados para publicidade.

## 6. Retenção e eliminação de dados

* O **vocabulário guardado** é retido na nuvem até que o elimine ou solicite a eliminação da conta.
* Os **relatórios de diagnóstico** são conservados apenas para efeitos de resolução de problemas e são abrangidos por pedidos de eliminação de conta (estão associados ao seu ID de utilizador).
* Os **dados locais** podem ser apagados a qualquer momento, terminando a sessão (remove os seus tokens, e-mail e ID de utilizador) ou removendo a Extensão do seu navegador.
* Para **eliminar a sua conta e todos os dados na nuvem associados** (e-mail, palavras guardadas e relatórios de diagnóstico), contacte o programador através da Secção 9. Iremos eliminá-los num prazo razoável.

## 7. Segurança

Os tokens de autenticação são mantidos no armazenamento de extensões do seu navegador. Todos os pedidos de rede são efetuados através de HTTPS. Os dados na nuvem são protegidos pelo Firebase Authentication e por regras de segurança do Firestore que restringem cada utilizador aos seus próprios registos. Nenhum método de transmissão ou armazenamento é 100% seguro, mas tomamos medidas razoáveis para proteger a sua informação.

## 8. Privacidade das crianças

A Extensão não se destina a crianças com menos de 13 anos (ou a idade mínima equivalente na sua jurisdição), e não recolhemos conscientemente dados pessoais de menores.

## 9. Alterações a esta Política

Podemos atualizar esta Política de Privacidade periodicamente. As alterações substanciais serão refletidas aqui através de uma data de "Última atualização" atualizada. A utilização continuada da Extensão após uma atualização constitui aceitação da política revista.

## 10. Contacto

Para quaisquer questões sobre esta Política de Privacidade, ou para solicitar a eliminação da sua conta e dados, contacte o programador através do repositório oficial do projeto ou através da página de suporte da Chrome Web Store para a Extensão.

---

*O Lingogram é uma ferramenta independente e não está afiliado, autorizado ou apoiado pelo YouTube ou por qualquer uma das plataformas de vídeo que suporta.*
