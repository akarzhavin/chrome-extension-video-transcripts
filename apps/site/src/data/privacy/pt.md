# Política de Privacidade — Lingogram: Dual Subtitles & Transcript for YouTube

**Data de entrada em vigor:** 22 de junho de 2026
**Última atualização:** 10 de agosto de 2026

Esta Política de Privacidade explica que informação a extensão de navegador **Lingogram: Dual Subtitles & Transcript for YouTube** ("a Extensão") recolhe, como é utilizada, onde é armazenada e as opções que tem à sua disposição.

---

## Resumo

* **Sem uma conta, a Extensão não recolhe absolutamente nada sobre si.** A transcrição interativa, o exercício de compreensão auditiva, as legendas duplas e a gravação local de palavras funcionam inteiramente dentro do seu navegador, e nenhum dado pessoal nos é enviado.
* **Iniciar sessão é opcional.** Existe apenas para sincronizar o seu vocabulário guardado entre dispositivos. Se optar por iniciar sessão, recolhemos o seu **endereço de e-mail** e armazenamos as **palavras que guarda explicitamente** (com as linhas de legenda envolventes) na nossa base de dados na nuvem.
* **O diagnóstico é opcional (opt-in), com um único clique.** Se as legendas não carregarem, um botão de emergência **"Recarregar página"** (mostrado apenas após uma nova tentativa falhada) envia-nos, com um único clique, um relatório de diagnóstico — o endereço do vídeo mais detalhes técnicos — para que possamos resolver o problema. O aviso indica isto mesmo junto ao botão; nada é reportado automaticamente.
* **Contamos a utilização de forma anónima, e pode desativá-lo.** A Extensão envia-nos eventos de utilização anónimos (por exemplo: a Extensão foi instalada, as legendas carregaram, uma palavra foi guardada) identificados por um **identificador aleatório gerado no seu dispositivo** — não pelo seu e-mail, nem pela sua conta. Esse identificador nunca é associado à sua conta Lingogram. Abra a janela pop-up da barra de ferramentas → **Privacidade** → desmarque **"Partilhar estatísticas de utilização anónimas"**, e a recolha para de imediato.
* **Não** vendemos os seus dados, não apresentamos anúncios, não utilizamos rastreadores de publicidade, não construímos perfis publicitários, nem rastreamos o seu histórico de navegação.

---

## 1. Informação que recolhemos

### a. Se **não** iniciar sessão
Para além da análise de utilização anónima descrita na Secção 1c (que pode desativar com um só clique), a Extensão **não** recolhe, transmite ou armazena quaisquer dados pessoais nos nossos servidores. As suas preferências de idioma e disposição, bem como um contador local de "palavras guardadas", são mantidos apenas no seu navegador (ver Secção 3). Nenhuma conta, e-mail ou palavra guardada sai alguma vez do seu dispositivo.

### b. Se optar por iniciar sessão (conta opcional)
Iniciar sessão permite a sincronização entre dispositivos do seu vocabulário guardado. Quando inicia sessão, recolhemos e processamos:

* **Dados da conta** — o seu **endereço de e-mail** e um ID de utilizador gerado pelo Firebase. Estes identificam a sua conta e associam-lhe as palavras guardadas.
* **Vocabulário guardado** — apenas os itens que escolhe explicitamente guardar enquanto assiste. Para cada item guardado, armazenamos:
  * a **palavra ou expressão** que selecionou;
  * uma pequena quantidade de **contexto de legenda** — a linha de legenda guardada, mais a linha imediatamente anterior e posterior, apenas no idioma principal de legendagem do vídeo;
  * uma **etiqueta de origem** que indica qual Extensão a guardou;
  * uma **marca temporal** e um contador diário utilizado apenas para aplicar um limite diário de gravações.
* **Relatórios de diagnóstico** — apenas se as legendas não carregarem e o utilizador premir explicitamente o botão **"Recarregar página"** no aviso de erro (que indica que será enviado um relatório). Cada relatório contém: o nome de anfitrião do site, o endereço (URL) ou ID do vídeo em que ocorreu a falha, o par de idiomas de legendagem que selecionou (o idioma que está a aprender e o seu idioma nativo), a versão da Extensão, o idioma da interface do seu navegador, uma etiqueta de origem que identifica a Extensão e uma marca temporal do servidor. Os relatórios só são enviados enquanto tiver sessão iniciada, estão limitados a um por conta por dia, e são utilizados exclusivamente para investigar a falha.

**Não** recolhemos: o seu histórico de navegação, os vídeos que assiste (para além do texto de legenda que guarda explicitamente e do endereço único do vídeo incluído num relatório de diagnóstico que aciona explicitamente; a análise descrita na Secção 1c regista apenas uma etiqueta genérica de plataforma, como `youtube`, nunca um vídeo ou um URL), rastreio de localização com base em IP, identificadores publicitários, ou cookies de rastreio.

> A sua conta Lingogram funciona nas nossas outras extensões Lingogram; se iniciar sessão com a mesma conta, o seu vocabulário guardado é sincronizado em conjunto.

### c. Análise de utilização anónima (ativa por predefinição, desativável com um clique)

A Extensão envia eventos de utilização anónimos para o **Google Analytics 4** para que possamos ver quantas pessoas a instalam, onde a Extensão falha e em que passos as pessoas desistem. Isto está **ativo por predefinição**. Para desativar, abra a janela pop-up da barra de ferramentas, vá à secção **Privacidade** e desmarque **"Partilhar estatísticas de utilização anónimas"**. A recolha para de imediato.

**O identificador.** Cada evento transporta um **identificador aleatório gerado no seu dispositivo** na primeira vez que a Extensão é executada, armazenado no armazenamento local de extensões do seu navegador. Não é o seu endereço de e-mail, não é o seu ID de utilizador do Firebase e não deriva de nenhum dos dois. **Nunca enviamos a identidade da sua conta para o Google Analytics**, pelo que não existe qualquer chave que permita ligar os seus eventos de análise à sua conta — a separação é estrutural, não apenas uma promessa. Limpar o armazenamento da Extensão ou reinstalá-la produz um identificador novo e sem relação com o anterior.

**Os eventos que enviamos** (17 no total):

* `extension_installed`, `extension_updated` — a Extensão foi instalada ou atualizada;
* `onboarding_shown`, `languages_configured` — viu o ecrã de primeira execução, escolheu os seus idiomas;
* `subtitles_loaded`, `dual_subs_shown`, `no_subtitles`, `subs_partial`, `subs_rate_limited`, `subs_recovered` — as legendas carregaram, foram apresentados ambos os idiomas, não foi encontrada nenhuma, só carregou uma parte, a plataforma limitou a frequência dos nossos pedidos, ou uma nova tentativa teve êxito;
* `word_save_attempt`, `word_saved` — tentou guardar uma palavra, e ela ficou guardada;
* `signin_started` — iniciou o processo de início de sessão;
* `analytics_opt_out` — desativou esta análise (enviado uma única vez, para sabermos quantas pessoas a desativam);
* `retained_d2`, `retained_d7`, `retained_d14` — a Extensão continuava a ser utilizada 2, 7 e 14 dias após a instalação.

**Os campos associados a esses eventos**, e nada mais:

* uma **etiqueta genérica de plataforma** — uma de `youtube`, `netflix`, `rezka` ou `web`; não um nome de anfitrião, não um URL;
* o **par de idiomas de legendagem** que escolheu (por exemplo, `"en"` e `"pt"`);
* **quantas faixas de legendas** carregaram;
* **se tinha sessão iniciada** — um indicador verdadeiro/falso, sem qualquer identificador de conta;
* uma **contagem acumulada de palavras guardadas neste dispositivo**;
* a **versão e a edição da Extensão**;
* os **dias decorridos desde a instalação**;
* um **código técnico de falha** quando as legendas falham;
* um **ID de sessão** que agrupa os eventos de uma mesma sessão de navegação.

**O que nunca é enviado:** o vídeo que está a ver (sem título, sem URL, sem ID), as palavras que guarda, o texto das legendas, o conteúdo da página, o seu endereço de e-mail, o seu ID de utilizador do Firebase e o seu histórico de navegação.

**O papel da Google.** O Google Analytics processa estes eventos por nossa conta, enquanto nosso prestador de serviços; consulte a Política de Privacidade da Google em https://policies.google.com/privacy. Na nossa propriedade do Analytics, os **Google Signals estão desligados**, pelo que a Google não associa a estes eventos uma idade, um género, uma categoria de interesses ou um público publicitário, nem os liga entre os seus dispositivos. **A recolha granular de localização está desativada**: os eventos são resolvidos **apenas ao nível do país**, nunca ao nível de uma cidade ou região. Cada envio inclui `non_personalized_ads: true`. O Google Analytics não é utilizado para construir um perfil sobre si nem para direcionar publicidade.

## 2. Como utilizamos a sua informação

Utilizamos a informação acima **apenas** para:

* autenticá-lo(a) e manter a sua sessão iniciada entre sessões de navegação;
* armazenar o seu vocabulário guardado e sincronizá-lo entre os seus dispositivos, para que possa consultá-lo mais tarde;
* aplicar um limite diário razoável de palavras guardadas, para evitar abusos;
* investigar as falhas de carregamento de legendas que reporta explicitamente através do botão **"Recarregar página"**, para que possamos corrigi-las;
* contar a utilização de forma anónima e agregada — quantas instalações há, com que frequência as legendas falham, em que ponto as pessoas desistem antes de concluir a configuração — para podermos corrigir o que está avariado e melhorar o que é confuso. Nunca a utilizamos para o(a) identificar nem para construir um perfil sobre si.

Não utilizamos a sua informação para publicidade, definição de perfis, ou qualquer finalidade além de fornecer as funcionalidades de sincronização e diagnóstico aqui descritas e a contagem agregada de utilização também aqui descrita.

## 3. Armazenamento local (no seu dispositivo)

A Extensão utiliza o armazenamento de extensões do seu navegador (`chrome.storage`) para manter, apenas no seu dispositivo:

* as suas preferências de idioma e disposição das legendas;
* uma contagem local de quantas palavras guardou;
* a sua **definição de ativação/desativação da análise**, o **identificador aleatório de análise** descrito na Secção 1c e a **data em que instalou** a Extensão, além de um **ID de sessão** de análise no armazenamento de sessão;
* se tiver sessão iniciada: os seus tokens de autenticação, o seu endereço de e-mail e o seu ID de utilizador (para que permaneça com a sessão iniciada), e um nonce de início de sessão de curta duração no armazenamento de sessão.

Estes dados locais nunca saem do seu navegador, exceto conforme descrito na Secção 4 (palavras guardadas sincronizadas com a nuvem). Terminar a sessão remove os tokens de autenticação, o e-mail e o ID de utilizador do seu dispositivo.

## 4. Armazenamento na nuvem e serviços de terceiros

Quando tem sessão iniciada, a sua conta e o vocabulário guardado são armazenados através do **Google Firebase** (Firebase Authentication, Cloud Firestore e Secure Token Service), operado pelo programador na infraestrutura da Google Cloud. A Google processa estes dados como nosso prestador de serviços; consulte a Política de Privacidade da Google em https://policies.google.com/privacy. O acesso é restrito por regras de segurança do Firestore, pelo que só pode ler e escrever os seus próprios dados.

Os eventos de utilização anónimos descritos na Secção 1c são enviados para o **Google Analytics 4** (através do Measurement Protocol), exceto se desativar a análise. A Google processa esses eventos por nossa conta, enquanto nosso prestador de serviços, ao abrigo da mesma Política de Privacidade da Google. O Firebase e o Google Analytics são utilizados como dois serviços separados, e não enviamos para o Google Analytics nada que permita ligar os dois entre si.

Para apresentar legendas, a Extensão lê as faixas de legendas que o leitor do YouTube já fornece para o vídeo que está a assistir, **diretamente dentro do seu navegador**. Este processamento de legendas:

* ocorre inteiramente no seu navegador, sem qualquer proxy intermediário nosso;
* não envia quaisquer dados de conta ou palavras guardadas para o YouTube;
* está sujeito à própria política de privacidade e aos termos do YouTube.

## 5. Partilha e venda de dados

**Não** vendemos, arrendamos ou negociamos os seus dados pessoais. Não os partilhamos com terceiros, exceto o Google Firebase e o Google Analytics, enquanto fornecedores de infraestrutura e de análise descritos na Secção 4, ou sempre que exigido por lei. Não utilizamos os seus dados para publicidade.

## 6. Retenção e eliminação de dados

* O **vocabulário guardado** é retido na nuvem até que o elimine ou solicite a eliminação da conta.
* Os **relatórios de diagnóstico** são conservados apenas para efeitos de resolução de problemas e são abrangidos por pedidos de eliminação de conta (estão associados ao seu ID de utilizador).
* Os **eventos de utilização anónimos** são retidos pelo Google Analytics durante **2 meses** e depois eliminados. Uma vez que estes eventos não transportam qualquer identificador de conta, **não conseguimos consultar nem eliminar os eventos pertencentes a uma pessoa específica — e o utilizador também não.** Não temos forma de saber que eventos vieram de si. Desativar a análise na janela pop-up da barra de ferramentas trava qualquer recolha futura, mas não consegue remover retroativamente os eventos já enviados; esses expiram no prazo de 2 meses.
* Os **dados locais** podem ser apagados a qualquer momento, terminando a sessão (remove os seus tokens, e-mail e ID de utilizador) ou removendo a Extensão do seu navegador (o que também remove o identificador aleatório de análise).
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
