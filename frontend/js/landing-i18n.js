/* SwiftChat landing i18n — EN ⇄ pt-PT toggle.
   Translates text nodes + a small set of attributes; originals kept in a
   WeakMap so switching back restores the exact source copy. */
(function () {
  'use strict';

  var DICT = {
    // Nav + hero
    'Features': 'Funcionalidades',
    'How It Works': 'Como Funciona',
    'Why SwiftChat': 'Porquê a SwiftChat',
    'Pricing': 'Preços',
    'FAQ': 'Perguntas Frequentes',
    'Sign in': 'Iniciar sessão',
    'Get Started': 'Começar',
    'AI-Powered Live Chat & Support Agent': 'Chat ao Vivo e Agente de Suporte com IA',
    'Make AI your expert': 'Transforme a IA no seu especialista de',
    'customer support agent': 'apoio ao cliente',
    'Train a chatbot on your website content in minutes. Embed on any site with one script tag. Visitors get instant, cited answers — your team steps in when it counts.': 'Treine um chatbot com o conteúdo do seu site em minutos. Incorpore em qualquer site com uma única tag de script. Os visitantes recebem respostas imediatas e citadas — a sua equipa intervém quando faz falta.',
    'Start Trial': 'Iniciar Período de Avaliação',
    'Book Demo →': 'Marcar Demonstração →',
    'Instant setup · No credit card required · Cancel anytime': 'Configuração imediata · Sem cartão de crédito · Cancele quando quiser',
    '24/7 Availability': 'Disponibilidade 24/7',
    'Automated instant support around the clock': 'Apoio automático e instantâneo a qualquer hora',
    'Your Data Protected': 'Os Seus Dados Protegidos',
    'Enterprise-grade security, isolated knowledge base': 'Segurança de nível empresarial, base de conhecimento isolada',
    'Multi-LLM Intelligence': 'Inteligência Multi-LLM',
    'Powered by OpenAI, Anthropic, DeepSeek': 'Com OpenAI, Anthropic e DeepSeek',
    'Hi! Ask me anything about SwiftChat.': 'Olá! Pergunte-me qualquer coisa sobre a SwiftChat.',

    // Feature chips
    'Everything your support team needs, out of the box': 'Tudo o que a sua equipa de apoio precisa, pronto a usar',
    'Website crawling': 'Indexação de sites',
    'PDF & DOCX upload': 'Carregamento de PDF e DOCX',
    'Human handoff queue': 'Fila de transferência para humanos',
    'Lead capture': 'Captura de contactos',
    'Conversation analytics': 'Análise de conversas',
    'Scheduled re-crawls': 'Reindexações agendadas',
    'Source citations': 'Citação de fontes',

    // Pain section
    'The problem': 'O problema',
    'Support tickets are costing you more than you think': 'Os pedidos de suporte estão a custar-lhe mais do que pensa',
    'Your team spends hours answering the same questions — questions your website already answers.': 'A sua equipa passa horas a responder às mesmas perguntas — perguntas a que o seu site já responde.',
    'Without SwiftChat': 'Sem a SwiftChat',
    'Support team buried in repetitive, low-value tickets': 'Equipa de apoio afogada em pedidos repetitivos e de pouco valor',
    'Visitors leave without finding answers after business hours': 'Visitantes saem sem respostas fora do horário de expediente',
    'Escalating costs for oversized enterprise support tools': 'Custos crescentes de ferramentas empresariais sobredimensionadas',
    'Frustrated customers waiting hours for basic responses': 'Clientes frustrados à espera de horas por respostas básicas',
    'With SwiftChat': 'Com a SwiftChat',
    'AI automatically answers up to 80% of customer questions': 'A IA responde automaticamente a até 80% das perguntas dos clientes',
    'Instant, cited answers drawn directly from your documentation': 'Respostas instantâneas e citadas, retiradas directamente da sua documentação',
    'Predictable, low flat-rate pricing with zero per-agent surcharges': 'Preço fixo previsível e baixo, sem custos extra por agente',
    '24/7 instant response time with seamless live-agent handover': 'Resposta instantânea 24/7 com passagem suave para agentes reais',

    // Platform
    'Platform': 'Plataforma',
    'One platform. Every conversation.': 'Uma plataforma. Todas as conversas.',
    'From first crawl to human handoff — without duct-taping five SaaS tools together.': 'Da primeira indexação à transferência para humanos — sem remendar cinco ferramentas SaaS diferentes.',
    'Trained on Your Content': 'Treinada com o Seu Conteúdo',
    'Crawl your entire website automatically, upload PDFs, DOCX files, or paste raw text. Every response cites the exact source page so visitors trust the answers and you can verify accuracy.': 'Indexe todo o seu site automaticamente, carregue PDFs, ficheiros DOCX ou cole texto simples. Cada resposta cita a página de origem exacta para que os visitantes confiem nas respostas e possa verificar a exactidão.',
    'Website crawl': 'Indexação do site',
    'Q&A overrides': 'Correcções de P&R',
    'Auto re-crawl': 'Reindexação automática',
    'Embed in 60 Seconds': 'Incorporação em 60 Segundos',
    'Paste one lightweight script tag into any site or web app. Customize colors, placement, and welcome messages with a real-time live preview dashboard.': 'Cole uma única tag de script leve em qualquer site ou aplicação web. Personalize cores, posição e mensagens de boas-vindas com um painel de pré-visualização em tempo real.',
    'Human Handoff Queue': 'Fila de Transferência para Humanos',
    'When the AI reaches its confidence boundary, route the conversation to live agents. Team members can claim threads, review full chat history, and reply seamlessly.': 'Quando a IA atinge o seu limite de confiança, encaminhe a conversa para agentes reais. Os membros da equipa podem assumir conversas, rever o histórico completo e responder sem interrupções.',
    'Analytics & Lead Capture': 'Análise e Captura de Contactos',
    'Track chat volume, top inquiries, and customer satisfaction scores. Capture visitor emails directly inside the widget and export leads to CSV or webhooks.': 'Acompanhe o volume de conversas, as perguntas mais frequentes e a satisfação dos clientes. Capture emails de visitantes directamente no widget e exporte contactos para CSV ou webhooks.',
    'Multi-Engine AI Routing': 'Encaminhamento Multi-Motor de IA',
    'Powered by industry-leading LLMs. Switch between OpenAI, Anthropic, or custom specialized fine-tuned models with zero technical friction.': 'Com os LLMs líderes da indústria. Alterne entre OpenAI, Anthropic ou modelos especializados sem qualquer fricção técnica.',
    'Proactive Trigger Messages': 'Mensagens Proactivas',
    'Engage visitors dynamically based on current page URL, time spent on site, or scroll position to convert browsers into sales inquiries.': 'Interaja com os visitantes com base na página actual, tempo no site ou posição de deslocamento para converter visitas em pedidos comerciais.',
    'Chat Personalization': 'Personalização do Chat',
    'Make the widget unmistakably yours — six theme presets, per-section colors, agent avatar and name, launcher styles and position, fonts, radius, and even custom CSS and JS — all tuned in a live on-page preview.': 'Torne o widget inconfundivelmente seu — seis temas predefinidos, cores por secção, avatar e nome do agente, estilos e posição do botão, tipos de letra, raios e até CSS e JS personalizados — tudo ajustado numa pré-visualização ao vivo na página.',
    '6 themes': '6 temas',
    'Agent profile': 'Perfil do agente',
    'Launcher styles': 'Estilos do botão',
    'Custom CSS/JS': 'CSS/JS personalizado',
    'Advanced plan': 'Plano Advanced',
    'Help Center, Built In': 'Centro de Ajuda Integrado',
    'Publish a full knowledge base your visitors can browse inside the chat widget — or as a standalone public portal with two template options and your own custom domain.': 'Publique uma base de conhecimento completa que os visitantes podem consultar dentro do widget de chat — ou como portal público autónomo com dois modelos à escolha e o seu próprio domínio.',
    'Embeds in widget': 'Integrado no widget',
    'Public URL': 'URL público',
    '2 templates': '2 modelos',
    'Custom domain': 'Domínio próprio',

    // How it works
    'How it works': 'Como funciona',
    'Live in an afternoon. Really.': 'Online numa tarde. A sério.',
    'Three steps from zero to a smart support agent answering questions 24/7.': 'Três passos entre o zero e um agente de apoio inteligente a responder 24/7.',
    'Train on Your Content': 'Treine com o Seu Conteúdo',
    'Point SwiftChat at your domain to automatically crawl pages, or upload custom documentation. Scheduled re-crawls keep the knowledge base up to date automatically.': 'Aponte a SwiftChat ao seu domínio para indexar as páginas automaticamente, ou carregue documentação própria. Reindexações agendadas mantêm a base de conhecimento sempre actualizada.',
    'Crawls your entire site automatically': 'Indexa todo o seu site automaticamente',
    'Upload PDF, DOCX, or plain text': 'Carregue PDF, DOCX ou texto simples',
    'Scheduled re-index keeps content fresh': 'Reindexação agendada mantém o conteúdo actualizado',
    'Crawling yoursite.com…': 'A indexar oteusite.com…',
    'Indexed': 'Indexado',
    'Queued': 'Em fila',
    '38 pages indexed': '38 páginas indexadas',
    'In progress': 'Em curso',
    'Customize & Embed': 'Personalizar e Incorporar',
    'Match your widget design to your brand, configure system prompts, and copy a single script tag into your codebase.': 'Adapte o widget à sua marca, configure instruções do sistema e copie uma única tag de script para o seu código.',
    'Match your brand colors & copy': 'Cores e textos a condizer com a sua marca',
    'Choose Ollama, OpenAI, Anthropic, or Azure': 'Escolha Ollama, OpenAI, Anthropic ou Azure',
    'One script tag — no rebuild needed': 'Uma tag de script — sem necessidade de recompilar',
    'Widget live on yoursite.com': 'Widget activo em oteusite.com',
    'Monitor & Grow': 'Monitorizar e Crescer',
    'Review real conversations from your management dashboard, refine Q&A overrides with one click, and let live agents handle edge cases.': 'Reveja conversas reais no painel de gestão, corrija respostas com um clique e deixe os agentes tratarem dos casos mais difíceis.',
    'See every conversation with analytics': 'Veja todas as conversas com análise detalhada',
    'Add Q&A overrides to fix wrong answers': 'Adicione correcções de P&R para corrigir respostas',
    'Hand off to a live agent when needed': 'Transfira para um agente real quando necessário',
    'Conversation dashboard': 'Painel de conversas',
    'Do you offer a trial?': 'Têm período de avaliação?',
    'Answered': 'Respondida',
    'What LLMs are supported?': 'Que LLMs são suportados?',
    'Can I use my own GPT-4 key?': 'Posso usar a minha chave GPT-4?',
    'Needs fix': 'Precisa de correcção',
    'Fix answer': 'Corrigir resposta',
    'Assign to agent': 'Atribuir a agente',
    'How does billing work?': 'Como funciona a facturação?',
    'Advertisement': 'Publicidade',

    // Code section
    'One line of code': 'Uma linha de código',
    'Drop in. Ship today.': 'Incorpore. Lance hoje.',
    'Paste once on any website, SPA, or e-commerce store. Widget configuration is managed from the dashboard — no redeployment needed.': 'Cole uma vez em qualquer site, SPA ou loja online. A configuração do widget é gerida no painel — sem novas implementações.',
    'Get your embed code': 'Obtenha o seu código de incorporação',
    'Copy': 'Copiar',

    // Comparison
    'Enterprise support, without the enterprise bill': 'Apoio empresarial, sem a factura empresarial',
    'Flat-rate plans with white-labeling, citations and handoff included — no per-agent or per-ticket surcharges.': 'Planos de preço fixo com marca branca, citações e transferência incluídas — sem custos por agente ou por pedido.',
    'Feature': 'Funcionalidade',
    'Legacy SaaS': 'SaaS tradicional',
    'Managed': 'Gerido',
    '€100 – €500+/mo per agent': '100–500+ €/mês por agente',
    'Simple Flat Monthly / Billed Yearly': 'Mensal fixo simples / Facturado anualmente',
    'White-Labeling': 'Marca Branca',
    'Enterprise tier only': 'Apenas no nível Enterprise',
    'Included in Advanced Plan': 'Incluído no plano Advanced',
    'Source Citations': 'Citação de Fontes',
    'Rare / Unreliable': 'Raras / Pouco fiáveis',
    'Every answer cited with link': 'Todas as respostas citadas com ligação',
    'Human Handoff': 'Transferência para Humanos',
    'Expensive add-on': 'Extra dispendioso',
    'Included on all plans': 'Incluído em todos os planos',
    'Unlimited Usage': 'Utilização Ilimitada',
    'Pay per contact/ticket': 'Pague por contacto/pedido',
    'Unlimited chats on Advanced': 'Conversas ilimitadas no Advanced',
    'Setup Time': 'Tempo de Configuração',
    'Days or weeks': 'Dias ou semanas',
    'Under 15 minutes': 'Menos de 15 minutos',

    // Pricing
    'Pricing Plans': 'Planos de Preços',
    'Simple flat-rate pricing': 'Preço fixo simples',
    'One plan covers your whole team — no per-agent seats, no per-ticket fees.': 'Um plano cobre toda a sua equipa — sem lugares por agente nem taxas por pedido.',
    'Monthly': 'Mensal',
    'Yearly': 'Anual',
    'save ~17%': 'poupa ~17%',
    'Basic': 'Basic',
    'Everything you need to launch AI support.': 'Tudo o que precisa para lançar o apoio com IA.',
    '/ month': '/ mês',
    'Standard chat widget': 'Widget de chat standard',
    'Automatic website crawler': 'Indexador automático de sites',
    'Email lead capture': 'Captura de contactos por email',
    'Standard AI engine': 'Motor de IA standard',
    'Core analytics': 'Análise essencial',
    'Most Popular': 'Mais Popular',
    'Advanced': 'Advanced',
    'White-label power for growing teams.': 'Poder de marca branca para equipas em crescimento.',
    'No limits on chats or crawled pages.': 'Sem limites de conversas nem de páginas indexadas.',
    'Everything in Basic': 'Tudo o que está no Basic',
    'White-label — no SwiftChat branding': 'Marca branca — sem marca SwiftChat',
    'Help Center portal + custom domain': 'Portal de Centro de Ajuda + domínio próprio',
    'Human handoff to live agents': 'Transferência para agentes reais',
    'Priority support': 'Apoio prioritário',
    'Upgrade to Advanced': 'Mudar para Advanced',
    'VAT not included at the applicable legal rate.': 'IVA não incluído à taxa legal em vigor.',

    // FAQ
    'Common questions': 'Perguntas frequentes',
    'How does the trial work?': 'Como funciona o período de avaliação?',
    'You can test SwiftChat without commitment. Set up your knowledge base, test the AI response quality on your site, and select a plan when you are ready to launch live.': 'Pode testar a SwiftChat sem compromisso. Configure a sua base de conhecimento, teste a qualidade das respostas da IA no seu site e escolha um plano quando estiver pronto para lançar.',
    'Do I need developer skills to set this up?': 'Preciso de conhecimentos de programação?',
    'No technical expertise is required. If you can copy and paste a single HTML line into your web builder (WordPress, Webflow, Shopify, React, HTML), you can deploy SwiftChat in minutes.': 'Não são necessários conhecimentos técnicos. Se conseguir copiar e colar uma única linha de HTML no seu editor de sites (WordPress, Webflow, Shopify, React, HTML), consegue implementar a SwiftChat em minutos.',
    'How does SwiftChat keep information accurate?': 'Como é que a SwiftChat mantém a informação correcta?',
    'SwiftChat relies strictly on the content you provide via web crawling, PDF uploads, and direct Q&A overrides. Every response includes direct citations back to your source pages.': 'A SwiftChat baseia-se estritamente no conteúdo que fornece através da indexação do site, carregamento de PDFs e correcções directas de P&R. Cada resposta inclui citações directas para as suas páginas de origem.',
    'Can I remove the SwiftChat brand badge?': 'Posso remover o selo da marca SwiftChat?',
    'Yes. The Advanced Plan includes complete white-labeling, allowing you to hide all SwiftChat branding and present a fully customized experience to your users.': 'Sim. O plano Advanced inclui marca branca completa, permitindo ocultar toda a marca SwiftChat e apresentar uma experiência totalmente personalizada aos seus utilizadores.',
    'Can I manage multiple websites?': 'Posso gerir vários sites?',
    'Yes, you can create separate widgets, isolated knowledge bases, and dedicated analytics for multiple websites directly from your central account dashboard.': 'Sim, pode criar widgets separados, bases de conhecimento isoladas e análises dedicadas para vários sites directamente a partir do seu painel central.',

    // CTA + footer
    'Your site, answering questions 24/7.': 'O seu site, a responder a perguntas 24/7.',
    'Elevate your customer support experience today with instant AI answers and effortless agent handoff.': 'Eleve hoje o seu apoio ao cliente com respostas instantâneas de IA e transferência simples para agentes.',
    'Contact Sales': 'Contactar Vendas',
    'AI-powered live chat and support agent for your website. Instant, cited answers — your team steps in when it counts.': 'Chat ao vivo e agente de apoio com IA para o seu site. Respostas instantâneas e citadas — a sua equipa intervém quando faz falta.',
    'Product': 'Produto',
    'Live Demo': 'Demonstração',
    'Dashboard': 'Painel',
    'Resources': 'Recursos',
    'Documentation': 'Documentação',
    'API Reference': 'Referência da API',
    'Support Center': 'Centro de Apoio',
    'Legal': 'Informação Legal',
    'Privacy Policy': 'Política de Privacidade',
    'Terms of Service': 'Termos de Serviço',
    'Data Security': 'Segurança de Dados',
    '© 2026 SwiftChat · All rights reserved.': '© 2026 SwiftChat · Todos os direitos reservados.',
    'Powered by SwifPilot Ecosystem.': 'Com tecnologia do Ecossistema SwifPilot.'
  };

  var ATTRS = {
    'placeholder': {
      'Ask something…': 'Pergunte alguma coisa…'
    },
    'aria-label': {
      'Chat message': 'Mensagem de chat',
      'Send': 'Enviar',
      'Thinking': 'A pensar',
      'Copy code': 'Copiar código'
    },
    'title': {}
  };

  var TITLE = {
    en: 'SwiftChat — AI-Powered Live Chat & Support Agent',
    pt: 'SwiftChat — Chat ao Vivo e Agente de Apoio com IA'
  };

  var originals = new WeakMap();
  var attrOriginals = new WeakMap();

  function eachTextNode(cb) {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        var p = n.parentNode;
        if (p && p.closest && p.closest('script, style, .landing-code pre, code')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var node;
    while ((node = walker.nextNode())) cb(node);
  }

  function setLang(lang) {
    var pt = lang === 'pt';
    eachTextNode(function (n) {
      var orig = originals.get(n);
      if (orig === undefined) { originals.set(n, n.nodeValue); orig = n.nodeValue; }
      var key = orig.trim();
      if (!pt) { n.nodeValue = orig; return; }
      var t = DICT[key];
      if (t) {
        var lead = orig.match(/^\s*/)[0], tail = orig.match(/\s*$/)[0];
        n.nodeValue = lead + t + tail;
      }
    });
    Object.keys(ATTRS).forEach(function (attr) {
      document.querySelectorAll('[' + attr + ']').forEach(function (el) {
        var map = attrOriginals.get(el) || {};
        var orig = map[attr];
        if (orig === undefined) { orig = el.getAttribute(attr); map[attr] = orig; attrOriginals.set(el, map); }
        if (orig == null) return;
        if (!pt) { el.setAttribute(attr, orig); return; }
        var t = ATTRS[attr][orig];
        if (t) el.setAttribute(attr, t);
      });
    });
    document.title = pt ? TITLE.pt : TITLE.en;
    document.documentElement.lang = pt ? 'pt-PT' : 'en';
    localStorage.setItem('sc_lang', lang);
    document.querySelectorAll('.lang-toggle').forEach(function (b) {
      b.setAttribute('aria-pressed', String(pt));
      b.title = pt ? 'Switch to English' : 'Mudar para Português';
    });
  }

  function flagSvg(pt) {
    if (pt) {
      return '<svg viewBox="0 0 24 16" width="22" height="15" aria-hidden="true"><rect width="9.6" height="16" fill="#046a38"/><rect x="9.6" width="14.4" height="16" fill="#da291c"/><circle cx="9.6" cy="8" r="3.4" fill="#ffe900" stroke="#000" stroke-width="0.4"/><circle cx="9.6" cy="8" r="2.2" fill="#da291c"/></svg>';
    }
    return '<svg viewBox="0 0 24 16" width="22" height="15" aria-hidden="true"><rect width="24" height="16" fill="#012169"/><path d="M0,0 L24,16 M24,0 L0,16" stroke="#fff" stroke-width="3"/><path d="M0,0 L24,16 M24,0 L0,16" stroke="#C8102E" stroke-width="1.4"/><path d="M12,0 V16 M0,8 H24" stroke="#fff" stroke-width="5"/><path d="M12,0 V16 M0,8 H24" stroke="#C8102E" stroke-width="3"/></svg>';
  }

  function makeToggle() {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'lang-toggle';
    b.setAttribute('aria-label', 'Language / Idioma');
    b.innerHTML = '<span class="lt-flag lt-en">' + flagSvg(false) + '</span><span class="lt-flag lt-pt">' + flagSvg(true) + '</span>';
    b.addEventListener('click', function () {
      setLang((localStorage.getItem('sc_lang') || 'pt') === 'pt' ? 'en' : 'pt');
    });
    return b;
  }

  function mount() {
    // Desktop: inside the nav CTA group, before "Sign in"
    var cta = document.querySelector('.landing-nav-cta');
    if (cta) cta.insertBefore(makeToggle(), cta.firstChild);
    // Mobile: immediately before the hamburger toggle
    var toggle = document.getElementById('nav-toggle');
    if (toggle && toggle.parentNode) toggle.parentNode.insertBefore(makeToggle(), toggle);

    document.querySelectorAll('.landing-nav-cta .lang-toggle').forEach(function (b) { b.classList.add('lt-desktop'); });
    var mobile = document.querySelector('.landing-nav > .lang-toggle, .landing-nav-inner > .lang-toggle');
    if (toggle && toggle.previousElementSibling && toggle.previousElementSibling.classList.contains('lang-toggle')) {
      toggle.previousElementSibling.classList.add('lt-mobile');
    }

    var saved = localStorage.getItem('sc_lang');
    if (saved !== 'en') setLang('pt');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
  window.__scSetLang = setLang;
})();
