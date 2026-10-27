/**
 * SwiftChat embeddable widget — source for build.js.
 * Edit here, then run: npm run build
 */
(function () {
  "use strict";

  /* Dashboard SPA blocks embedded widgets; allow only explicit preview mode
     (data-preview="1" or window.__sitechatPreview) for the live Appearance preview. */
  try {
    if (document.body && document.body.hasAttribute("data-sitechat-dashboard")) {
      const s =
        document.currentScript ||
        (function () {
          const scripts = document.getElementsByTagName("script");
          for (let i = scripts.length - 1; i >= 0; i--) {
            const src = scripts[i].src || "";
            if (/\/chatbot(\.min)?\.js(\?|$)/i.test(src)) return scripts[i];
          }
          return null;
        })();
      const isPreview =
        (s && s.dataset && s.dataset.preview === "1") ||
        window.__sitechatPreview === true;
      if (!isPreview) return;
    }
  } catch (e) {}

  const embedFallback =
    typeof window !== "undefined" &&
    window.__sitechatEmbed &&
    typeof window.__sitechatEmbed === "object"
      ? window.__sitechatEmbed
      : null;

  const scriptEl =
    document.currentScript ||
    (function findThisScript() {
      const scripts = document.getElementsByTagName("script");
      for (let i = scripts.length - 1; i >= 0; i--) {
        const src = scripts[i].src || "";
        if (/\/chatbot(\.min)?\.js(\?|$)/i.test(src)) return scripts[i];
      }
      return null;
    })();

  function defaultEmbedApiUrl() {
    try {
      if (typeof window !== "undefined" && window.location) {
        if (window.location.origin && window.location.protocol !== "file:") {
          return window.location.origin;
        }
      }
    } catch (e) {}
    return "http://localhost:8000";
  }

  const datasetApi = scriptEl?.dataset?.apiUrl != null ? String(scriptEl.dataset.apiUrl).trim() : "";
  const embedApi =
    embedFallback && embedFallback.apiUrl != null ? String(embedFallback.apiUrl).trim() : "";

  const config = {
    siteId: scriptEl?.dataset?.siteId || embedFallback?.siteId || "default",
    apiUrl: datasetApi || embedApi || defaultEmbedApiUrl(),
    position: scriptEl?.dataset?.position || "bottom-right",
    primaryColor: scriptEl?.dataset?.primaryColor || "#7B3DFB",
    title: scriptEl?.dataset?.title || "Ask AI",
    welcomeMessage: "Hi! How can I help you today?",
    showSources: true,
    hideBranding: false,
    customBrandingText: null,
    customBrandingUrl: null,
    // Agent profile
    agentCaption: "Powered by AI",
    botAvatarUrl: null,
    showOnlineIndicator: true,
    onlineIndicatorColor: "#22C55E",
    // Theme colors (null = derive from theme palette / primaryColor)
    theme: "light_accent",
    headerBackground: null,
    headerTextColor: null,
    chatBackground: null,
    botMessageBackground: null,
    botMessageColor: null,
    userMessageBackground: null,
    userMessageColor: null,
    inputBackground: null,
    inputTextColor: null,
    inputPlaceholder: "Type your message...",
    sendButtonColor: null,
    launcherBackground: null,
    launcherIconColor: "#FFFFFF",
    borderRadius: 16,
    footerText: null,
    footerTextColor: null,
    footerEnabled: true,
    fontFamily: null,
    customCss: null,
    customJs: null,
    // Layout
    windowWidth: 400,
    windowHeight: 560,
    launcherStyle: "button",
    launcherText: "Ask us anything",
    launcherIcon: scriptEl?.dataset?.launcherIcon || null,
    offsetX: 24,
    offsetY: 24,
    movableWindow: false,
    startMode: "button_only",
    greetingMessage: null,
    startDelaySeconds: 0,
    soundAgentMessage: "none",
    soundVisitorMessage: "none",
    // Quick prompts + help center
    quickPrompts: { enabled: true, prompts: [], showAfterResponse: false, maxDisplay: 4 },
    helpCenter: { enabled: false, portalUrl: null, tabLabel: "Help" },
    // Visibility + session rules (remote config)
    visibility: {
      displayPages: "all",
      pageUrls: [],
      devices: "all",
      schedule: { enabled: false, days: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "18:00", timezone: null },
    },
    session: { persistSession: true, persistVisitor: true, sessionTimeoutMinutes: 0 },
    // Human handoff: enabled && at least one agent assigned (remote config)
    handoffEnabled: true,
    // Dashboard live-preview mode: skip visibility rules + visitor tracking
    previewMode: scriptEl?.dataset?.preview === "1" || window.__sitechatPreview === true,
  };

  const SESSION_KEY = "sitechat_session_" + config.siteId;

  function newSessionId() {
    return "widget-" + Math.random().toString(36).substring(2, 15);
  }

  function sessionStore() {
    return config.session.persistSession === false ? sessionStorage : localStorage;
  }

  function visitorStore() {
    return config.session.persistVisitor === false ? sessionStorage : localStorage;
  }

  function resolveSessionId() {
    const timeoutMs = (config.session.sessionTimeoutMinutes || 0) * 60000;
    const now = Date.now();
    let stored = null;
    try {
      stored = JSON.parse(sessionStore().getItem(SESSION_KEY) || "null");
    } catch (e) {}
    // Migrate an id left in the other store so an in-flight conversation survives a setting change
    if (!stored || !stored.id) {
      try {
        stored = JSON.parse(
          (config.session.persistSession === false ? localStorage : sessionStorage).getItem(SESSION_KEY) || "null"
        );
      } catch (e) {}
    }
    if (stored && stored.id && (!timeoutMs || now - (stored.ts || 0) < timeoutMs)) {
      try {
        sessionStore().setItem(SESSION_KEY, JSON.stringify({ id: stored.id, ts: stored.ts || now }));
        (config.session.persistSession === false ? localStorage : sessionStorage).removeItem(SESSION_KEY);
      } catch (e) {}
      return stored.id;
    }
    const id = newSessionId();
    try {
      sessionStore().setItem(SESSION_KEY, JSON.stringify({ id, ts: now }));
      (config.session.persistSession === false ? localStorage : sessionStorage).removeItem(SESSION_KEY);
    } catch (e) {}
    return id;
  }

  function touchSession() {
    try {
      sessionStore().setItem(SESSION_KEY, JSON.stringify({ id: sessionId, ts: Date.now() }));
    } catch (e) {}
  }

  let sessionId = resolveSessionId();
  let conversationStarted = false;

  const handoffState = {
    mode: "ai",
    handoffId: null,
    agentName: null,
    pollInterval: null,
    lastMessageTime: null,
    isAvailable: true,
    offlineMessage: null,
  };

  function adjustHexColor(hex, delta) {
    const raw = hex.replace("#", "");
    const n = parseInt(raw, 16);
    const r = Math.min(255, Math.max(0, (n >> 16) + delta));
    const g = Math.min(255, Math.max(0, ((n >> 8) & 255) + delta));
    const b = Math.min(255, Math.max(0, (n & 255) + delta));
    return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
  }

  // --- Remote site config + theme overrides (accent color from API) ---
  async function fetchSiteConfig() {
    try {
      const res = await fetch(config.apiUrl + "/api/sites/" + config.siteId + "/config");
      if (res["ok"]) {
        const data = await res["json"]();
        applyAppearanceConfig(data["appearance"] || {});
        if (data["behavior"]) config.showSources = data["behavior"]["show_sources"] !== false;
        if (data["quick_prompts"]) {
          const qp = data["quick_prompts"];
          config.quickPrompts.enabled = qp["enabled"] !== false;
          config.quickPrompts.prompts = Array.isArray(qp["prompts"]) ? qp["prompts"] : [];
          config.quickPrompts.showAfterResponse = qp["show_after_response"] === true;
          config.quickPrompts.maxDisplay = qp["max_display"] || 4;
        }
        if (data["help_center"]) {
          const hc = data["help_center"];
          config.helpCenter.enabled = hc["enabled"] === true;
          config.helpCenter.portalUrl = hc["portal_url"] || null;
          config.helpCenter.tabLabel = hc["tab_label"] || "Help";
        }
        if (data["visibility"]) {
          const v = data["visibility"];
          config.visibility.displayPages = v["display_pages"] || "all";
          config.visibility.pageUrls = Array.isArray(v["page_urls"]) ? v["page_urls"] : [];
          config.visibility.devices = v["devices"] || "all";
          const s = v["schedule"] || {};
          config.visibility.schedule = {
            enabled: s["enabled"] === true,
            days: Array.isArray(s["days"]) && s["days"].length ? s["days"] : [1, 2, 3, 4, 5],
            startTime: s["start_time"] || "09:00",
            endTime: s["end_time"] || "18:00",
            timezone: s["timezone"] || null,
          };
        }
        if (data["session"]) {
          const ss = data["session"];
          config.session.persistSession = ss["persist_session"] !== false;
          config.session.persistVisitor = ss["persist_visitor"] !== false;
          config.session.sessionTimeoutMinutes = ss["session_timeout_minutes"] || 0;
          if (!conversationStarted) sessionId = resolveSessionId();
        }
        if (data["handoff"]) {
          const h = data["handoff"];
          config.handoffEnabled = h["enabled"] !== false && h["has_agents"] === true;
        }
        refreshWidgetUI();
        applyVisibility();
        scheduleStartMode();
      }
    } catch (I) {
      console["warn"]("Could not fetch site config, using defaults:", I);
    }
  }

  // --- Appearance config (snake_case API shape) -> widget config ---
  // Shared by fetchSiteConfig and the dashboard live-preview API.
  function applyAppearanceConfig(a) {
    config.primaryColor = a["primary_color"] || config.primaryColor;
    config.title = a["chat_title"] || config.title;
    config.welcomeMessage = a["welcome_message"] || config.welcomeMessage;
    config.position = a["position"] || config.position;
    config.hideBranding = a["hide_branding"] === true;
    config.customBrandingText = a["custom_branding_text"] || null;
    config.customBrandingUrl = a["custom_branding_url"] || null;
    config.agentCaption = a["agent_caption"] || config.agentCaption;
    config.botAvatarUrl = a["bot_avatar_url"] || null;
    config.showOnlineIndicator = a["show_online_indicator"] !== false;
    config.onlineIndicatorColor = a["online_indicator_color"] || config.onlineIndicatorColor;
    config.theme = a["theme"] || "light_accent";
    config.headerBackground = a["header_background"] || null;
    config.headerTextColor = a["header_text_color"] || null;
    config.chatBackground = a["chat_background"] || null;
    config.botMessageBackground = a["bot_message_background"] || null;
    config.botMessageColor = a["bot_message_color"] || null;
    config.userMessageBackground = a["user_message_background"] || null;
    config.userMessageColor = a["user_message_color"] || null;
    config.inputBackground = a["input_background"] || null;
    config.inputTextColor = a["input_text_color"] || null;
    config.inputPlaceholder = a["input_placeholder"] || config.inputPlaceholder;
    config.sendButtonColor = a["send_button_color"] || null;
    config.launcherBackground = a["launcher_background"] || null;
    config.launcherIconColor = a["launcher_icon_color"] || config.launcherIconColor;
    config.borderRadius = typeof a["border_radius"] === "number" ? a["border_radius"] : 16;
    config.footerText = a["footer_text"] || null;
    config.footerTextColor = a["footer_text_color"] || null;
    config.footerEnabled = a["footer_enabled"] !== false;
    config.customCss = a["custom_css"] || null;
    config.customJs = a["custom_js"] || null;
    config.fontFamily = a["font_family"] || null;
    config.windowWidth = a["window_width"] || config.windowWidth;
    config.windowHeight = a["window_height"] || config.windowHeight;
    config.launcherStyle = a["launcher_style"] || config.launcherStyle;
    config.launcherText = a["launcher_text"] || config.launcherText;
    config.launcherIcon = a["launcher_icon"] || config.launcherIcon;
    config.offsetX = typeof a["offset_x"] === "number" ? a["offset_x"] : 24;
    config.offsetY = typeof a["offset_y"] === "number" ? a["offset_y"] : 24;
    config.movableWindow = a["movable_window"] === true;
    config.startMode = a["start_mode"] || "button_only";
    config.greetingMessage = a["greeting_message"] || null;
    config.startDelaySeconds = a["start_delay_seconds"] || 0;
    config.soundAgentMessage = a["sound_agent_message"] || "none";
    config.soundVisitorMessage = a["sound_visitor_message"] || "none";
  }

  // Re-apply all visual/widget state after config changes.
  function refreshWidgetUI() {
    injectDynamicThemeStyles();
    injectCustomCode();
    applyAgentProfile();
    applyLauncherVariant();
    applyMovableWindow();
    applyHandoffAvailability();
    syncHeaderAndWelcomeText();
    updateBrandingFooter();
    renderWelcomeContent();
    updateWindowTabs();
  }
  // --- Theme presets: palette defaults; explicit config colors always win ---
  const CHAT_PATTERN_SVG =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'%3E" +
    "%3Cg fill='none' stroke='%2394a3b8' stroke-opacity='0.14' stroke-width='1.5'%3E" +
    "%3Cpath d='M20 25a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4h-8l-6 5v-5h-2a4 4 0 0 1-4-4z'/%3E" +
    "%3Cpath d='M80 60a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4h-8l-6 5v-5h-2a4 4 0 0 1-4-4z'/%3E" +
    "%3Ccircle cx='30' cy='85' r='6'/%3E%3Cpath d='M27 85h6M30 82v6'/%3E" +
    "%3Cpath d='M70 20l3 6 6 3-6 3-3 6-3-6-6-3 6-3z'/%3E" +
    "%3Cpath d='M15 60h8M19 56v8'/%3E%3Ccircle cx='95' cy='100' r='5'/%3E" +
    "%3Cpath d='M50 95q5-8 10 0t10 0'/%3E" +
    "%3C/g%3E%3C/svg%3E";

  function themePalette() {
    const p = config.primaryColor;
    const light = {
      headerBg: "#FFFFFF", headerText: "#1E293B",
      chatBg: "#F1F5F9",
      botBg: "#FFFFFF", botColor: "#1E293B",
      userColor: "#FFFFFF",
      inputBg: "#FFFFFF", inputText: "#374151", inputBorder: "#E2E8F0",
      muted: "#64748B", pattern: false
    };
    const palettes = {
      light: light,
      light_accent: Object.assign({}, light, { headerBg: p, headerText: "#FFFFFF" }),
      light_soft: Object.assign({}, light, { chatBg: "#FFFFFF", botBg: "#F1F5F9" }),
      pattern_light: Object.assign({}, light, { pattern: true }),
      pattern_accent: Object.assign({}, light, { headerBg: p, headerText: "#FFFFFF", pattern: true }),
      dark: {
        headerBg: "#111827", headerText: "#F9FAFB",
        chatBg: "#0B1220",
        botBg: "#1F2937", botColor: "#E5E7EB",
        userColor: "#FFFFFF",
        inputBg: "#1F2937", inputText: "#E5E7EB", inputBorder: "#374151",
        muted: "#9CA3AF", pattern: false
      }
    };
    return palettes[config.theme] || light;
  }

  function injectDynamicThemeStyles() {
    const existing = document.getElementById("sitechat-dynamic-styles");
    existing && existing.remove();

    const primary = config.primaryColor;
    const pal = themePalette();
    const headerBg = config.headerBackground || pal.headerBg;
    const headerText = config.headerTextColor || pal.headerText;
    const chatBg = config.chatBackground || pal.chatBg;
    const botBg = config.botMessageBackground || pal.botBg;
    const botColor = config.botMessageColor || pal.botColor;
    const userBg = config.userMessageBackground || primary;
    const userColor = config.userMessageColor || pal.userColor;
    const inputBg = config.inputBackground || pal.inputBg;
    const inputColor = config.inputTextColor || pal.inputText;
    const inputBorder = pal.inputBorder;
    const muted = config.footerTextColor || pal.muted;
    const sendBg = config.sendButtonColor || primary;
    const launcherBg = config.launcherBackground || primary;
    const br = config.borderRadius;
    const patternCss = pal.pattern
      ? `background-color: ${chatBg} !important; background-image: url("${CHAT_PATTERN_SVG}") !important; background-size: 120px 120px !important;`
      : `background: ${chatBg} !important;`;
    const left = config.position === "bottom-left";
    const center = config.position === "bottom-center";
    const ox = config.offsetX != null ? config.offsetX : 24;
    const oy = config.offsetY != null ? config.offsetY : 24;
    // Positioning rules: center uses the standalone `translate` property so it
    // doesn't fight the open/close `transform` animation.
    const posRules = center
      ? `left: 50vw !important; right: auto !important; translate: -50% 0;`
      : (left ? `left: ${ox}px !important; right: auto !important;` : `right: ${ox}px !important;`);
    const togglePos = posRules + ` bottom: ${oy}px !important;`;
    const windowPos = posRules + ` bottom: ${oy + 76}px !important;`;

    const css = `
      .sitechat-widget * { font-family: ${config.fontFamily ? "'" + config.fontFamily + "', " : ""}'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      .sitechat-toggle {
        background: linear-gradient(135deg, ${launcherBg}, ${adjustHexColor(launcherBg, -20)}) !important;
        color: ${config.launcherIconColor} !important;
        ${togglePos}
      }
      .sitechat-toggle svg { color: ${config.launcherIconColor} !important; }
      .sitechat-window {
        width: ${config.windowWidth}px !important;
        height: ${config.windowHeight}px !important;
        border-radius: ${br}px !important;
        ${windowPos}
      }
      .sitechat-header {
        background: linear-gradient(135deg, ${headerBg}, ${adjustHexColor(headerBg, -20)}) !important;
        color: ${headerText} !important;
        border-bottom: 1px solid ${pal.pattern || config.theme === "dark" ? "transparent" : "#00000010"} !important;
      }
      .sitechat-header-text h3, .sitechat-header-text p { color: ${headerText} !important; }
      .sitechat-header-close, .sitechat-handoff-btn { color: ${headerText} !important; }
      .sitechat-header-close svg, .sitechat-handoff-btn svg { color: ${headerText} !important; }
      .sitechat-header-close { background: ${headerText}20 !important; }
      .sitechat-header-close:hover { background: ${headerText}33 !important; }
      .sitechat-messages { ${patternCss} }
      .sitechat-message.bot {
        background: ${botBg} !important;
        color: ${botColor} !important;
        border-radius: ${Math.max(4, br - 2)}px ${Math.max(4, br - 2)}px ${Math.max(4, br - 2)}px 4px !important;
      }
      .sitechat-message.bot *:not(svg) { color: ${botColor} !important; }
      .sitechat-message.bot code { color: ${primary} !important; }
      .sitechat-message.user {
        background: linear-gradient(135deg, ${userBg}, ${adjustHexColor(userBg, -25)}) !important;
        color: ${userColor} !important;
        box-shadow: 0 2px 12px ${userBg}30 !important;
        border-radius: ${Math.max(4, br - 2)}px ${Math.max(4, br - 2)}px 4px ${Math.max(4, br - 2)}px !important;
      }
      .sitechat-input-wrapper { border-radius: 0 0 ${br}px ${br}px !important; }
      .sitechat-input-form {
        background: ${inputBg} !important;
        border: 1px solid ${inputBorder} !important;
        border-radius: ${Math.max(6, br - 4)}px !important;
      }
      .sitechat-input { color: ${inputColor} !important; }
      .sitechat-input::placeholder { color: ${inputColor}80 !important; }
      .sitechat-input-form:focus-within { border-color: ${primary} !important; }
      .sitechat-attach-btn { color: ${primary} !important; }
      .sitechat-footer-text, .sitechat-disclaimer { color: ${muted} !important; }
      .sitechat-branding, .sitechat-branding a { color: ${muted} !important; }
      .sitechat-send {
        background: linear-gradient(135deg, ${sendBg}, ${adjustHexColor(sendBg, -20)}) !important;
      }
      .sitechat-avatar.bot {
        background: linear-gradient(135deg, ${primary}, ${adjustHexColor(primary, -30)}) !important;
        box-shadow: 0 2px 8px ${primary}40 !important;
      }
      .sitechat-typing span {
        background: linear-gradient(135deg, ${primary}, ${adjustHexColor(primary, -20)}) !important;
      }
      .sitechat-welcome-icon {
        background: linear-gradient(135deg, ${primary}15, ${primary}25) !important;
      }
      .sitechat-welcome-icon::before {
        background: linear-gradient(135deg, ${primary}40, transparent) !important;
      }
      .sitechat-welcome-icon svg { color: ${primary} !important; }
      .sitechat-suggestion:hover {
        background: ${primary}08 !important;
        border-color: ${primary}30 !important;
        color: ${primary} !important;
      }
      .sitechat-source-link {
        color: ${primary} !important;
        background: linear-gradient(135deg, ${primary}08, ${primary}12) !important;
        border: 1px solid ${primary}20 !important;
      }
      .sitechat-source-link:hover {
        background: linear-gradient(135deg, ${primary}15, ${primary}20) !important;
        border-color: ${primary}40 !important;
        box-shadow: 0 2px 8px ${primary}20 !important;
      }
      .sitechat-feedback-btn.active { border-color: ${primary}40 !important; }
      .sitechat-online-dot { background: ${config.onlineIndicatorColor} !important; }
      .sitechat-launcher-icon-img { width: 28px !important; height: 28px !important; border-radius: 50%; object-fit: cover; }
      .sitechat-nudge, .sitechat-greeting { ${posRules} bottom: ${oy + 82}px !important; }
      .sitechat-card-btn.primary { background: ${primary} !important; border-color: ${primary} !important; }
      .sitechat-help-portal-link { color: ${primary} !important; }
      .sitechat-help-category:hover { border-color: ${primary}50 !important; }
      .sitechat-help-article-link:hover { border-color: ${primary}50 !important; color: ${primary} !important; }
      .sitechat-help-back { color: ${primary} !important; }
      .sitechat-help-article-body a { color: ${primary} !important; }
      .sitechat-nav-btn.active, .sitechat-nav-btn:hover { color: ${primary} !important; }
      .sitechat-nudge::before {
        background: linear-gradient(135deg, ${primary}, ${adjustHexColor(primary, -20)}) !important;
      }
      ${config.botAvatarUrl ? `
      .sitechat-header-icon, .sitechat-avatar.bot:not(.agent) {
        background-image: url("${config.botAvatarUrl}") !important;
        background-size: cover !important;
        background-position: center !important;
        border-radius: 50% !important;
      }
      .sitechat-header-icon svg, .sitechat-avatar.bot:not(.agent) svg { display: none !important; }
      .sitechat-has-avatar .sitechat-avatar.bot { color: transparent !important; }` : ""}
    `;

    const el = document.createElement("style");
    el.id = "sitechat-dynamic-styles";
    el.textContent = css;
    document.head.appendChild(el);
  }
  function injectResponsiveStyles() {
    const G = document["getElementById"]("sitechat-responsive-styles");
    G && G["remove"]();
    const H = document["createElement"]("style");
    H["id"] = "sitechat-responsive-styles";
    H["textContent"] = `
      .sitechat-toggle.sitechat-faded {
        opacity: 0.55 !important;
      }
      .sitechat-toggle.sitechat-faded:hover,
      .sitechat-toggle.sitechat-faded.open {
        opacity: 1 !important;
      }
      @media (max-width: 900px) {
        .sitechat-window {
          width: min(420px, calc(100vw - 24px)) !important;
          height: min(70vh, 560px) !important;
          right: 12px !important;
          left: 12px !important;
          margin: 0 auto !important;
          bottom: calc(82px + env(safe-area-inset-bottom, 0px)) !important;
        }
        .sitechat-toggle {
          right: 12px !important;
          bottom: calc(12px + env(safe-area-inset-bottom, 0px)) !important;
          width: 56px !important;
          height: 56px !important;
        }
        .sitechat-toggle svg {
          width: 24px !important;
          height: 24px !important;
        }
        .sitechat-nudge {
          right: 12px !important;
          left: 12px !important;
          max-width: none !important;
          bottom: calc(82px + env(safe-area-inset-bottom, 0px)) !important;
        }
        .sitechat-greeting {
          right: 12px !important;
          left: 12px !important;
          max-width: none !important;
          bottom: calc(82px + env(safe-area-inset-bottom, 0px)) !important;
        }
      }

      /* Greeting bubble (start mode) */
      .sitechat-greeting {
        position: fixed;
        bottom: 100px;
        right: 24px;
        max-width: 300px;
        background: #ffffff;
        border-radius: 16px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15), 0 4px 12px rgba(0, 0, 0, 0.1);
        z-index: 99997;
        padding: 14px 14px 10px;
        opacity: 0;
        transform: translateY(20px) scale(0.9);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .sitechat-greeting.sitechat-nudge-in { opacity: 1; transform: translateY(0) scale(1); }
      .sitechat-greeting-close {
        position: absolute;
        top: 4px;
        right: 8px;
        border: none;
        background: none;
        font-size: 18px;
        color: #94a3b8;
        cursor: pointer;
        line-height: 1;
        padding: 4px;
      }
      .sitechat-greeting-row { display: flex; gap: 10px; align-items: flex-start; }
      .sitechat-greeting-avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        object-fit: cover;
        flex-shrink: 0;
      }
      .sitechat-greeting-avatar-fallback {
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, ${config.primaryColor}, ${adjustHexColor(config.primaryColor, -20)});
        color: #fff;
      }
      .sitechat-greeting-avatar-fallback svg { width: 16px; height: 16px; }
      .sitechat-greeting-bubble {
        background: #f1f5f9;
        border-radius: 4px 14px 14px 14px;
        padding: 9px 12px;
        font-size: 13.5px;
        line-height: 1.45;
        color: #1e293b;
      }
      .sitechat-greeting-chips {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 10px;
      }
      .sitechat-greeting-chip {
        border: 1px solid #e2e8f0;
        background: #fff;
        border-radius: 10px;
        padding: 8px 12px;
        font-size: 12.5px;
        text-align: left;
        color: #334155;
        cursor: pointer;
        transition: all 0.15s ease;
        font-family: inherit;
      }
      .sitechat-greeting-chip:hover { border-color: ${config.primaryColor}; color: ${config.primaryColor}; }

      /* Move & resize */
      .sitechat-resize-grip {
        position: absolute;
        bottom: 4px;
        right: 4px;
        width: 20px;
        height: 20px;
        cursor: nwse-resize;
        color: #cbd5e1;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 5;
      }
      .sitechat-resize-grip svg { width: 14px; height: 14px; }

      @media (max-width: 640px) {
        .sitechat-window {
          width: auto !important;
          left: 8px !important;
          right: 8px !important;
          bottom: calc(76px + env(safe-area-inset-bottom, 0px)) !important;
          height: calc(100vh - 108px - env(safe-area-inset-bottom, 0px)) !important;
          max-height: none !important;
          border-radius: 14px !important;
        }
        .sitechat-header {
          padding: 14px 16px !important;
        }
        .sitechat-header-icon {
          width: 36px !important;
          height: 36px !important;
        }
        .sitechat-header-icon svg {
          width: 18px !important;
          height: 18px !important;
        }
        .sitechat-messages {
          padding: 14px !important;
          gap: 12px !important;
        }
        .sitechat-input-wrapper {
          padding: 10px !important;
        }
        .sitechat-message {
          font-size: 13px !important;
          padding: 12px 14px !important;
        }
        .sitechat-branding {
          padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px)) !important;
        }
        .sitechat-nudge {
          left: 8px !important;
          right: 8px !important;
          bottom: calc(76px + env(safe-area-inset-bottom, 0px)) !important;
          border-radius: 12px !important;
        }
      }

      @media (max-width: 380px) {
        .sitechat-window {
          height: calc(100vh - 96px - env(safe-area-inset-bottom, 0px)) !important;
        }
        .sitechat-header-text h3 {
          font-size: 15px !important;
        }
        .sitechat-header-text p {
          font-size: 12px !important;
        }
        .sitechat-live-agent-label {
          display: none !important;
        }
        .sitechat-handoff-btn {
          padding-left: 8px !important;
          padding-right: 8px !important;
        }
      }
    `;
    document["head"]["appendChild"](H);
  }
  function syncHeaderAndWelcomeText() {
    const G = document["querySelector"](".sitechat-header-text h3");
    if (G) G["textContent"] = config.title;
    const cap = document["querySelector"](".sitechat-header-text p");
    if (cap && !document["querySelector"](".sitechat-header.handoff-mode")) cap["textContent"] = config.agentCaption;
    const H = document["querySelector"](".sitechat-welcome h4"), I = document["querySelector"](".sitechat-welcome p");
    if (I) I["textContent"] = config.welcomeMessage;
    const inp = document["querySelector"](".sitechat-input");
    if (inp) inp["placeholder"] = config.inputPlaceholder;
  }

  function applyAgentProfile() {
    const root = document["querySelector"](".sitechat-widget");
    if (!root) return;
    root["classList"]["toggle"]("sitechat-has-avatar", !!config.botAvatarUrl);
    // Online indicator on the header avatar
    const icon = root["querySelector"](".sitechat-header-icon");
    if (icon) {
      icon["style"]["position"] = "relative";
      let dot = icon["querySelector"](".sitechat-online-dot");
      if (config.showOnlineIndicator && !dot) {
        dot = document["createElement"]("span");
        dot["className"] = "sitechat-online-dot";
        icon["appendChild"](dot);
      } else if (!config.showOnlineIndicator && dot) {
        dot["remove"]();
      }
      if (dot) dot["style"]["background"] = config.onlineIndicatorColor;
    }
    // Footer disclaimer text above branding
    let footer = root["querySelector"](".sitechat-footer-text");
    if (config.footerText && config.footerEnabled !== false) {
      if (!footer) {
        footer = document["createElement"]("div");
        footer["className"] = "sitechat-footer-text";
        const branding = root["querySelector"](".sitechat-branding");
        const windowEl = root["querySelector"](".sitechat-window");
        windowEl && windowEl["insertBefore"](footer, branding || null);
      }
      footer["textContent"] = config.footerText;
    } else if (footer) {
      footer["remove"]();
    }
  }

  const LAUNCHER_ICONS = {
    chat: '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z"/>',
    chat_bubble: '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z"/>',
    chat_bubble_dots: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/><circle cx="8.5" cy="11.5" r="1" fill="currentColor"/><circle cx="12" cy="11.5" r="1" fill="currentColor"/><circle cx="15.5" cy="11.5" r="1" fill="currentColor"/>',
    headset: '<path d="M3 18v-6a9 9 0 0118 0v6"/><path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z"/>',
    question: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    lightning: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    bolt: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    envelope: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/>',
    bell: '<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
    smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
    gem: '<polygon points="6 3 18 3 22 9 12 22 2 9"/><path d="M2 9h20M9 3l3 6 3-6M12 9l0 13"/>',
    robot: '<rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="12" cy="14" r="2"/><path d="M12 2v4M8 4l1 4M16 4l-1 4"/>'
  };

  function launcherIconSvg() {
    const ic = config.launcherIcon;
    if (ic && (ic.indexOf("http") === 0 || ic.indexOf("data:") === 0 || ic.indexOf("/") === 0)) {
      return '<img class="sitechat-icon-chat sitechat-launcher-icon-img" src="' + escapeHtml(ic) + '" alt="">';
    }
    const path = LAUNCHER_ICONS[ic] || LAUNCHER_ICONS.chat;
    return '<svg class="sitechat-icon-chat" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + path + '</svg>';
  }

  function applyLauncherVariant() {
    const btn = document["querySelector"](".sitechat-toggle");
    if (!btn) return;
    const iconSvg = launcherIconSvg();
    const closeSvg = '<svg class="sitechat-icon-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    const label = escapeHtml(config.launcherText || "Ask us anything");
    btn["classList"]["remove"]("launcher-text", "launcher-agent", "launcher-quick-input");
    if (config.launcherStyle === "text_button") {
      btn["classList"]["add"]("launcher-text");
      btn["innerHTML"] = '<span class="sitechat-launcher-label">' + iconSvg + '<span>' + label + '</span></span>' + closeSvg;
    } else if (config.launcherStyle === "agent_profile") {
      btn["classList"]["add"]("launcher-agent");
      const av = config.botAvatarUrl
        ? '<img class="sitechat-launcher-avatar" src="' + config.botAvatarUrl + '" alt="">'
        : iconSvg;
      btn["innerHTML"] = '<span class="sitechat-launcher-label">' + av + '</span>' + closeSvg;
    } else if (config.launcherStyle === "quick_input") {
      btn["classList"]["add"]("launcher-quick-input");
      btn["innerHTML"] = '<span class="sitechat-launcher-label sitechat-quick-label"><span class="sitechat-quick-text">' + label + '</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></span>' + closeSvg;
    } else {
      btn["innerHTML"] = iconSvg + closeSvg;
    }
  }
  function updateBrandingFooter() {
    const G = document["querySelector"](".sitechat-branding");
    if (!G) return;
    const H = G["querySelector"]("a");
    if (config.hideBranding) {
      config.customBrandingText ? (G["style"]["display"] = "block", H && (H["innerHTML"] = config.customBrandingText, config.customBrandingUrl ? (H["href"] = config.customBrandingUrl, 
      H["style"]["cursor"] = "pointer") : (H["removeAttribute"]("href"), H["style"]["cursor"] = "default"))) : G["style"]["display"] = "none";
      return;
    }
    G["style"]["display"] = "block", H && (H["innerHTML"] = "Powered by <strong>SwiftChat</strong>", H["href"] = config.apiUrl,
    H["style"]["cursor"] = "pointer");
  }

  // --- Visibility rules (pages / devices / schedule) ---
  function matchPagePattern(pattern, url) {
    try {
      const rx = new RegExp("^" + pattern.split("*").map(function (part) {
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }).join(".*") + "$", "i");
      return rx.test(url);
    } catch (e) {
      return false;
    }
  }

  function matchesAnyPagePattern(url) {
    return config.visibility.pageUrls.some(function (p) {
      p = (p || "").trim();
      if (!p) return false;
      // Match against full URL or path-only patterns
      return matchPagePattern(p, url) || matchPagePattern(p, url.replace(/^https?:\/\/[^/]+/i, ""));
    });
  }

  function isMobileDevice() {
    try {
      return window.matchMedia("(pointer: coarse)").matches || window.innerWidth <= 768;
    } catch (e) {
      return window.innerWidth <= 768;
    }
  }

  function scheduleNow() {
    const tz = config.visibility.schedule.timezone;
    if (!tz) return new Date();
    try {
      // Represent "now" in the configured timezone
      return new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
    } catch (e) {
      return new Date();
    }
  }

  function isWithinSchedule() {
    const s = config.visibility.schedule;
    if (!s.enabled) return true;
    const now = scheduleNow();
    const day = now.getDay();
    if (!s.days.includes(day)) return false;
    const mins = now.getHours() * 60 + now.getMinutes();
    const parse = function (t) {
      const parts = (t || "00:00").split(":");
      return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
    };
    const start = parse(s.startTime), end = parse(s.endTime);
    // Overnight windows (e.g. 18:00-09:00) wrap past midnight
    return start <= end ? (mins >= start && mins < end) : (mins >= start || mins < end);
  }

  function isWidgetVisible() {
    const v = config.visibility;
    if (v.devices === "mobile" && !isMobileDevice()) return false;
    if (v.devices === "desktop" && isMobileDevice()) return false;
    const url = window.location.href;
    if (v.displayPages === "include" && !matchesAnyPagePattern(url)) return false;
    if (v.displayPages === "exclude" && matchesAnyPagePattern(url)) return false;
    return isWithinSchedule();
  }

  function applyVisibility() {
    if (config.previewMode) return;
    const root = document.querySelector(".sitechat-widget");
    if (!root) return;
    root.style.display = isWidgetVisible() ? "" : "none";
  }

  // --- Custom CSS/JS provided in site config ---
  let customJsRan = false;
  function injectCustomCode() {
    const existingCss = document.getElementById("sitechat-custom-css");
    if (config.customCss) {
      const el = existingCss || document.createElement("style");
      el.id = "sitechat-custom-css";
      if (!existingCss) document.head.appendChild(el);
      el.textContent = config.customCss;
    } else if (existingCss) {
      existingCss.remove();
    }
    if (config.customJs && !customJsRan) {
      customJsRan = true;
      try {
        new Function("sitechat", "config", config.customJs)({
          siteId: config.siteId,
          apiUrl: config.apiUrl,
          open: function () { if (!chatOpen && toggleBtn) toggleBtn.click(); },
          close: function () { if (chatOpen && toggleBtn) toggleBtn.click(); },
          version: "1.0",
        }, config);
      } catch (e) {
        console.warn("SwiftChat custom JS error:", e);
      }
    }
  }

  // --- Start mode: greeting bubble / auto open (after optional delay) ---
  let startModeScheduled = false;
  function scheduleStartMode() {
    if (startModeScheduled || config.startMode === "button_only") return;
    startModeScheduled = true;
    setTimeout(function () {
      if (!isWidgetVisible() || chatOpen) return;
      if (config.startMode === "auto_open") {
        if (!isMobileDevice() && toggleBtn) toggleBtn.click();
      } else if (config.startMode === "greeting") {
        showGreetingBubble();
      }
    }, (config.startDelaySeconds || 0) * 1000);
  }

  let greetingEl = null;
  function showGreetingBubble() {
    if (greetingEl || chatOpen) return;
    greetingEl = document.createElement("div");
    greetingEl.className = "sitechat-greeting";
    const avatar = config.botAvatarUrl
      ? '<img class="sitechat-greeting-avatar" src="' + escapeHtml(config.botAvatarUrl) + '" alt="">'
      : '<span class="sitechat-greeting-avatar sitechat-greeting-avatar-fallback"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg></span>';
    const text = config.greetingMessage || "👋 Hi there! How can we help?";
    const chips = enabledPrompts()
      .filter(function (p) { return (p.type || "suggestion") === "suggestion"; })
      .slice(0, 3)
      .map(function (p) {
        return '<button type="button" class="sitechat-greeting-chip" data-q="' + escapeHtml(p.text || "") + '">' +
          (p.icon ? escapeHtml(p.icon) + " " : "") + escapeHtml(p.text || "") + "</button>";
      }).join("");
    greetingEl.innerHTML =
      '<button type="button" class="sitechat-greeting-close" aria-label="Dismiss">×</button>' +
      '<div class="sitechat-greeting-row">' + avatar +
        '<div class="sitechat-greeting-bubble">' + escapeHtml(text) + "</div>" +
      "</div>" +
      (chips ? '<div class="sitechat-greeting-chips">' + chips + "</div>" : "");
    greetingEl.querySelector(".sitechat-greeting-close").addEventListener("click", function (e) {
      e.stopPropagation();
      dismissGreeting();
    });
    greetingEl.querySelectorAll(".sitechat-greeting-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        dismissGreeting();
        if (!chatOpen && toggleBtn) toggleBtn.click();
        const q = chip.dataset.q || "";
        if (q) {
          inputEl.value = q;
          sendBtn.disabled = false;
          inputForm.requestSubmit ? inputForm.requestSubmit() : inputForm.dispatchEvent(new Event("submit", { cancelable: true }));
        }
      });
    });
    document.body.appendChild(greetingEl);
    requestAnimationFrame(function () { greetingEl && greetingEl.classList.add("sitechat-nudge-in"); });
  }

  function dismissGreeting() {
    if (greetingEl) { greetingEl.remove(); greetingEl = null; }
  }

  // --- Notification sounds (WebAudio presets, no audio assets needed) ---
  const SOUND_PRESETS = {
    bell:    [{ f: 880, t: 0, d: 0.35, w: "sine" }, { f: 660, t: 0.12, d: 0.4, w: "sine" }],
    bell2:   [{ f: 1046, t: 0, d: 0.3, w: "sine" }, { f: 784, t: 0.15, d: 0.35, w: "sine" }],
    bright:  [{ f: 523, t: 0, d: 0.15, w: "triangle" }, { f: 659, t: 0.08, d: 0.15, w: "triangle" }, { f: 784, t: 0.16, d: 0.3, w: "triangle" }],
    bright2: [{ f: 659, t: 0, d: 0.12, w: "triangle" }, { f: 880, t: 0.07, d: 0.12, w: "triangle" }, { f: 1174, t: 0.14, d: 0.28, w: "triangle" }],
    bubble:  [{ f: 600, t: 0, d: 0.08, w: "sine", sweep: 900 }, { f: 900, t: 0.09, d: 0.12, w: "sine", sweep: 500 }],
    bubble2: [{ f: 500, t: 0, d: 0.07, w: "sine", sweep: 800 }, { f: 700, t: 0.08, d: 0.07, w: "sine", sweep: 1000 }, { f: 900, t: 0.16, d: 0.1, w: "sine", sweep: 600 }],
    click:   [{ f: 1200, t: 0, d: 0.05, w: "square", vol: 0.12 }],
    click2:  [{ f: 1000, t: 0, d: 0.04, w: "square", vol: 0.12 }, { f: 1400, t: 0.07, d: 0.05, w: "square", vol: 0.12 }],
    digital: [{ f: 440, t: 0, d: 0.07, w: "square", vol: 0.1 }, { f: 554, t: 0.08, d: 0.07, w: "square", vol: 0.1 }, { f: 659, t: 0.16, d: 0.1, w: "square", vol: 0.1 }],
    fantasy: [{ f: 523, t: 0, d: 0.4, w: "sine" }, { f: 659, t: 0.05, d: 0.4, w: "sine" }, { f: 784, t: 0.1, d: 0.4, w: "sine" }, { f: 1046, t: 0.15, d: 0.45, w: "sine" }],
    glass:   [{ f: 1568, t: 0, d: 0.5, w: "sine", vol: 0.15 }, { f: 2093, t: 0.02, d: 0.4, w: "sine", vol: 0.08 }],
    liquid:  [{ f: 300, t: 0, d: 0.15, w: "sine", sweep: 220 }, { f: 400, t: 0.1, d: 0.2, w: "sine", sweep: 320 }],
    notes:   [{ f: 587, t: 0, d: 0.25, w: "sine" }, { f: 880, t: 0.15, d: 0.3, w: "sine" }],
    plucky:  [{ f: 660, t: 0, d: 0.09, w: "triangle", vol: 0.3 }, { f: 990, t: 0.06, d: 0.1, w: "triangle", vol: 0.2 }],
    soft:    [{ f: 440, t: 0, d: 0.35, w: "sine", vol: 0.12, attack: 0.08 }],
    soft2:   [{ f: 392, t: 0, d: 0.3, w: "sine", vol: 0.1, attack: 0.08 }, { f: 523, t: 0.12, d: 0.35, w: "sine", vol: 0.1, attack: 0.08 }]
  };
  let audioCtx = null;
  function playSound(name) {
    const notes = SOUND_PRESETS[name];
    if (!notes) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const t0 = audioCtx.currentTime;
      notes.forEach(function (n) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = n.w || "sine";
        osc.frequency.setValueAtTime(n.f, t0 + n.t);
        if (n.sweep) osc.frequency.exponentialRampToValueAtTime(n.sweep, t0 + n.t + n.d);
        const vol = n.vol != null ? n.vol : 0.2;
        const attack = n.attack || 0.01;
        gain.gain.setValueAtTime(0, t0 + n.t);
        gain.gain.linearRampToValueAtTime(vol, t0 + n.t + attack);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.t + n.d);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t0 + n.t);
        osc.stop(t0 + n.t + n.d + 0.05);
      });
    } catch (e) {}
  }

  // --- Move & resize chat window (desktop only, when enabled) ---
  let movableApplied = false;
  function applyMovableWindow() {
    if (movableApplied || !config.movableWindow || isMobileDevice()) return;
    movableApplied = true;
    windowEl.style.touchAction = "none";

    // Drag by header
    const header = windowEl.querySelector(".sitechat-header");
    if (header) {
      header.style.cursor = "grab";
      header.addEventListener("pointerdown", function (e) {
        if (e.target.closest("button, a, input")) return;
        const rect = windowEl.getBoundingClientRect();
        const startX = e.clientX - rect.left;
        const startY = e.clientY - rect.top;
        header.style.cursor = "grabbing";
        function onMove(ev) {
          const w = windowEl.offsetWidth, h = windowEl.offsetHeight;
          const nx = Math.min(Math.max(ev.clientX - startX, 0), window.innerWidth - w);
          const ny = Math.min(Math.max(ev.clientY - startY, 0), window.innerHeight - h);
          windowEl.style.left = nx + "px";
          windowEl.style.top = ny + "px";
          windowEl.style.right = "auto";
          windowEl.style.bottom = "auto";
          windowEl.style.translate = "none";
        }
        function onUp() {
          header.style.cursor = "grab";
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onUp);
        }
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
        e.preventDefault();
      });
    }

    // Resize grip (bottom corner nearest the free edge)
    const grip = document.createElement("div");
    grip.className = "sitechat-resize-grip";
    grip.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15l-6 6M21 8l-13 13"/></svg>';
    windowEl.appendChild(grip);
    grip.addEventListener("pointerdown", function (e) {
      const startX = e.clientX, startY = e.clientY;
      const startW = windowEl.offsetWidth, startH = windowEl.offsetHeight;
      const anchorLeft = windowEl.getBoundingClientRect().left;
      const growLeft = config.position === "bottom-left";
      function onMove(ev) {
        const dw = growLeft ? (startX - ev.clientX) : (ev.clientX - startX);
        const dh = ev.clientY - startY;
        const nw = Math.min(Math.max(startW + dw, 280), 640);
        const nh = Math.min(Math.max(startH + dh, 320), Math.min(860, window.innerHeight - 40));
        windowEl.style.width = nw + "px";
        windowEl.style.height = nh + "px";
        if (growLeft) windowEl.style.left = Math.max(0, anchorLeft + (startW - nw)) + "px";
      }
      function onUp() {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      }
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      e.preventDefault();
      e.stopPropagation();
    });
  }

  // --- Quick prompts: suggestion chips + action cards ---
  function enabledPrompts() {
    return (config.quickPrompts.prompts || []).filter(function (p) {
      return p && p.enabled !== false;
    });
  }

  function renderWelcomeContent() {
    const welcome = document["querySelector"](".sitechat-welcome");
    if (!welcome) return;
    const wrap = welcome["querySelector"](".sitechat-welcome-suggestions");
    if (!wrap) return;
    wrap["innerHTML"] = "";
    if (!config.quickPrompts.enabled) return;

    const suggestions = enabledPrompts().filter(function (p) {
      return (p["type"] || "suggestion") === "suggestion";
    }).slice(0, config.quickPrompts.maxDisplay || 4);
    const cards = enabledPrompts().filter(function (p) {
      return p["type"] === "card";
    });

    suggestions.forEach(function (p) {
      const btn = document["createElement"]("button");
      btn["className"] = "sitechat-suggestion";
      btn["dataset"]["query"] = p["text"] || "";
      btn["innerHTML"] = (p["icon"] ? escapeHtml(p["icon"]) + " " : "") + escapeHtml(p["text"] || "");
      wrap["appendChild"](btn);
    });

    cards.forEach(function (p) {
      wrap["appendChild"](buildPromptCard(p));
    });
  }

  function buildPromptCard(p) {
    const card = document["createElement"]("div");
    card["className"] = "sitechat-card";
    const iconHtml = p["image_url"]
      ? '<img class="sitechat-card-icon-img" src="' + escapeHtml(p["image_url"]) + '" alt="">'
      : (p["icon"] ? '<span class="sitechat-card-icon">' + escapeHtml(p["icon"]) + "</span>" : "");
    let html = iconHtml + '<div class="sitechat-card-title">' + escapeHtml(p["text"] || "") + "</div>";
    if (p["description"]) {
      html += '<div class="sitechat-card-desc">' + escapeHtml(p["description"]) + "</div>";
    }
    const buttons = Array.isArray(p["buttons"]) ? p["buttons"] : [];
    if (buttons.length) {
      html += '<div class="sitechat-card-buttons">';
      buttons.forEach(function (b, i) {
        if (!b || !b["label"]) return;
        html += '<button type="button" class="sitechat-card-btn' + (i === 0 ? " primary" : "") +
          '" data-action="' + escapeHtml(b["action"] || "send_message") +
          '" data-value="' + escapeHtml(b["value"] || "") + '">' +
          escapeHtml(b["label"]) + "</button>";
      });
      html += "</div>";
    }
    card["innerHTML"] = html;
    return card;
  }

  // --- Help center tab ---
  let helpLoaded = false, helpCategories = [], helpArticles = [], helpView = "categories", helpBusy = false;

  function updateWindowTabs() {
    const nav = document["querySelector"](".sitechat-window-nav");
    if (!nav) return;
    nav["hidden"] = !config.helpCenter.enabled;
    const lbl = nav["querySelector"](".sitechat-nav-help-label");
    if (lbl) lbl["textContent"] = config.helpCenter.tabLabel || "Help";
    const portalLink = document["querySelector"](".sitechat-help-portal-link");
    if (portalLink) {
      portalLink["href"] = config.apiUrl + "/hc/" + config.siteId;
      portalLink["innerHTML"] = "Open " + escapeHtml(config.helpCenter.tabLabel || "Help") +
        " Center <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" width=\"12\" height=\"12\"><path d=\"M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6\"/><polyline points=\"15 3 21 3 21 9\"/><line x1=\"10\" y1=\"14\" x2=\"21\" y2=\"3\"/></svg>";
    }
    if (!config.helpCenter.enabled) switchWindowView("chat");
  }

  function switchWindowView(view) {
    const root = document["querySelector"](".sitechat-widget");
    if (!root) return;
    root["classList"]["toggle"]("sitechat-view-help", view === "help");
    root["querySelectorAll"](".sitechat-nav-btn")["forEach"](function (b) {
      b["classList"]["toggle"]("active", b["dataset"]["nav"] === view);
    });
    if (view === "help") loadHelpOverview();
  }

  async function loadHelpOverview() {
    if (helpLoaded || helpBusy) { renderHelpView(); return; }
    helpBusy = true;
    renderHelpView();
    try {
      const res = await fetch(config.apiUrl + "/api/sites/" + config.siteId + "/help");
      if (res["ok"]) {
        const data = await res["json"]();
        helpCategories = data["categories"] || [];
        helpArticles = data["articles"] || [];
        helpLoaded = true;
      }
    } catch (e) {
      console["warn"]("Help center load failed:", e);
    }
    helpBusy = false;
    renderHelpView();
  }

  function renderHelpView() {
    const panel = document["querySelector"](".sitechat-help-panel");
    if (!panel) return;
    const content = panel["querySelector"](".sitechat-help-content");
    if (!content) return;
    const q = (panel["querySelector"](".sitechat-help-search-input") || {})["value"] || "";
    const query = q["trim"]()["toLowerCase"]();

    if (helpView === "article") {
      // handled by openHelpArticle (keeps rendered article)
      return;
    }

    if (helpView === "articles" && currentHelpCategory) {
      const items = helpArticles["filter"](function (a) {
        return a["category_slug"] === currentHelpCategory;
      });
      content["innerHTML"] =
        '<button type="button" class="sitechat-help-back">‹ ' + "All topics" + "</button>" +
        '<div class="sitechat-help-list">' +
        items["map"](function (a) {
          return '<button type="button" class="sitechat-help-article-link" data-slug="' +
            escapeHtml(a["slug"]) + '">' + escapeHtml(a["title"]) + "</button>";
        })["join"]("") +
        "</div>";
      return;
    }

    // categories / search view
    if (query) {
      const hits = helpArticles["filter"](function (a) {
        return (a["title"] || "")["toLowerCase"]()["indexOf"](query) >= 0 ||
          (a["excerpt"] || "")["toLowerCase"]()["indexOf"](query) >= 0;
      });
      content["innerHTML"] =
        '<div class="sitechat-help-list">' +
        (hits.length
          ? hits["map"](function (a) {
              return '<button type="button" class="sitechat-help-article-link" data-slug="' +
                escapeHtml(a["slug"]) + '"><strong>' + escapeHtml(a["title"]) + "</strong>" +
                (a["excerpt"] ? '<span class="sitechat-help-excerpt">' + escapeHtml(a["excerpt"]) + "</span>" : "") +
                "</button>";
            })["join"]("")
          : '<div class="sitechat-help-empty">No articles found</div>') +
        "</div>";
      return;
    }

    if (helpBusy) {
      content["innerHTML"] = '<div class="sitechat-help-empty">Loading help articles…</div>';
      return;
    }
    if (!helpCategories.length) {
      content["innerHTML"] = '<div class="sitechat-help-empty">No help content available yet.</div>';
      return;
    }
    content["innerHTML"] =
      '<div class="sitechat-help-heading">' + escapeHtml(config.helpCenter.tabLabel || "Help") + " center</div>" +
      '<div class="sitechat-help-list">' +
      helpCategories["map"](function (c) {
        const icon = c["icon_url"]
          ? '<img class="sitechat-help-cat-icon" src="' + escapeHtml(c["icon_url"]) + '" alt="">'
          : (c["icon"] ? '<span class="sitechat-help-cat-emoji">' + escapeHtml(c["icon"]) + '</span>' : "");
        return '<button type="button" class="sitechat-help-category" data-slug="' +
          escapeHtml(c["slug"]) + '">' + icon + '<span class="sitechat-help-cat-name">' +
          escapeHtml(c["name"]) + "</span>" +
          '<span class="sitechat-help-cat-count">' + (c["article_count"] || "") + " ›</span></button>";
      })["join"]("") +
      "</div>";
  }

  let currentHelpCategory = null;

  async function openHelpArticle(slug) {
    const panel = document["querySelector"](".sitechat-help-panel");
    if (!panel) return;
    const content = panel["querySelector"](".sitechat-help-content");
    helpView = "article";
    content["innerHTML"] = '<div class="sitechat-help-empty">Loading…</div>';
    try {
      const res = await fetch(config.apiUrl + "/api/sites/" + config.siteId + "/help/articles/" + encodeURIComponent(slug));
      if (!res["ok"]) throw new Error("not found");
      const a = await res["json"]();
      content["innerHTML"] =
        '<button type="button" class="sitechat-help-back">‹ Back</button>' +
        '<div class="sitechat-help-article">' +
        '<div class="sitechat-help-article-title">' + escapeHtml(a["title"] || "") + "</div>" +
        '<div class="sitechat-help-article-body">' + (a["content_html"] || "") + "</div>" +
        "</div>";
      panel["scrollTop"] = 0;
    } catch (e) {
      helpView = "categories";
      renderHelpView();
    }
  }

  fetchSiteConfig();

  // --- Public API (dashboard live preview + integrators) ---
  window.sitechat = {
    version: "1.0",
    siteId: config.siteId,
    apiUrl: config.apiUrl,
    config: config,
    open: function () { if (!chatOpen && toggleBtn) toggleBtn.click(); },
    close: function () { if (chatOpen && toggleBtn) toggleBtn.click(); },
    // Dashboard live preview: push unsaved appearance values (snake_case
    // API shape, same as the /config endpoint returns) and re-render.
    applyAppearance: function (a) {
      applyAppearanceConfig(a || {});
      refreshWidgetUI();
    },
    // Re-evaluate the start mode (greeting bubble / auto open) — used by the
    // dashboard preview when the start_mode setting changes.
    previewStartMode: function () {
      startModeScheduled = false;
      if (greetingEl) { greetingEl.remove(); greetingEl = null; }
      scheduleStartMode();
    },
    destroy: function () {
      try {
        handoff.stopPolling();
        clearInterval(visibilityCheckInterval);
        visitorBehavior.timerInterval && clearInterval(visitorBehavior.timerInterval);
        window.removeEventListener("resize", applyVisibility);
        window.removeEventListener("scroll", scrollFadeHandler);
        window.removeEventListener("pagehide", pagehideHandler);
        [widgetRoot, baseStyleEl, fontLinkEl, greetingEl].forEach(function (el) {
          el && el.remove();
        });
        document.querySelectorAll(".sitechat-nudge, .sitechat-greeting").forEach(function (el) {
          el.remove();
        });
        ["sitechat-dynamic-styles", "sitechat-responsive-styles", "sitechat-custom-css"].forEach(function (id) {
          const el = document.getElementById(id);
          el && el.remove();
        });
        delete window.sitechat;
      } catch (e) {
        console.warn("SwiftChat destroy error:", e);
      }
    },
  };

  // --- Proactive triggers (time on page, scroll, exit intent, etc.) ---
  const visitorBehavior = {
    timeOnPage: 0,
    maxScrollDepth: 0,
    currentUrl: window["location"]["pathname"],
    exitIntentDetected: false,
    pageViews: 1,
    timerInterval: null,
    init() {
      this["loadVisitorData"](), this["startTimeTracking"](), this["trackScroll"](), this["trackExitIntent"](), this["incrementPageViews"]();
    },
    loadVisitorData() {
      try {
        const G = visitorStore()["getItem"]("sitechat_visitor_" + config.siteId);
        if (G) {
          const H = JSON["parse"](G);
          this["pageViews"] = (H["pageViews"] || 0) + 1;
        }
      } catch (I) {}
    },
    saveVisitorData() {
      try {
        visitorStore()["setItem"]("sitechat_visitor_" + config.siteId, JSON["stringify"]({
          pageViews: this["pageViews"],
          lastVisit: Date["now"]()
        }));
      } catch (G) {}
    },
    incrementPageViews() {
      this["saveVisitorData"]();
    },
    startTimeTracking() {
      this["timerInterval"] = setInterval(() => {
        this["timeOnPage"]++, triggerEngine.checkTriggers();
      }, 1e3);
    },
    trackScroll() {
      const G = () => {
        const I = window["pageYOffset"] || document["documentElement"]["scrollTop"], J = document["documentElement"]["scrollHeight"] - document["documentElement"]["clientHeight"], K = J > 0 ? Math["round"](I / J * 100) : 0;
        K > this["maxScrollDepth"] && (this["maxScrollDepth"] = K, triggerEngine.checkTriggers());
      };
      let H;
      window["addEventListener"]("scroll", () => {
        clearTimeout(H), H = setTimeout(G, 100);
      }, {
        passive: true
      });
    },
    trackExitIntent() {
      document["addEventListener"]("mouseleave", G => {
        G["clientY"] <= 0 && !this["exitIntentDetected"] && (this["exitIntentDetected"] = true, triggerEngine.checkTriggers());
      });
    },
    getBehavior() {
      return {
        timeOnPage: this["timeOnPage"],
        maxScrollDepth: this["maxScrollDepth"],
        currentUrl: this["currentUrl"],
        exitIntentDetected: this["exitIntentDetected"],
        pageViews: this["pageViews"]
      };
    }
  }, triggerEngine = {
    triggers: [],
    globalCooldownMs: 3e4,
    lastTriggerTime: 0,
    shownTriggerIds: new Set(),
    visitorShownTriggerIds: new Set(),
    isInitialized: false,
    async init() {
      await this["fetchTriggers"](), this["loadShownTriggers"](), this["isInitialized"] = true;
    },
    async fetchTriggers() {
      try {
        const G = await fetch(config.apiUrl + "/api/widget/" + config.siteId + "/triggers");
        if (G["ok"]) {
          const H = await G["json"]();
          this["triggers"] = H["triggers"] || [], this["globalCooldownMs"] = H["global_cooldown_ms"] || 3e4;
        }
      } catch (I) {
        console["warn"]("Could not fetch triggers:", I);
      }
    },
    loadShownTriggers() {
      try {
        const G = sessionStorage["getItem"]("sitechat_triggers_" + config.siteId);
        if (G) {
          const I = JSON["parse"](G);
          this["shownTriggerIds"] = new Set(I);
        }
        const H = visitorStore()["getItem"]("sitechat_visitor_triggers_" + config.siteId);
        if (H) {
          const J = JSON["parse"](H);
          this["visitorShownTriggerIds"] = new Set(J);
        }
      } catch (K) {}
    },
    saveShownTrigger(G, H) {
      this["shownTriggerIds"]["add"](G);
      try {
        sessionStorage["setItem"]("sitechat_triggers_" + config.siteId, JSON["stringify"]([ ...this["shownTriggerIds"] ])), H && (this["visitorShownTriggerIds"]["add"](G), 
        visitorStore()["setItem"]("sitechat_visitor_triggers_" + config.siteId, JSON["stringify"]([ ...this["visitorShownTriggerIds"] ])));
      } catch (I) {}
    },
    checkTriggers() {
      if (!this["isInitialized"] || this["triggers"]["length"] === 0) return;
      if (chatOpen) return;
      const G = Date["now"]();
      if (G - this["lastTriggerTime"] < this["globalCooldownMs"]) return;
      const H = visitorBehavior.getBehavior();
      for (const I of this["triggers"]) {
        if (!I["enabled"]) continue;
        if (I["show_once_per_session"] && this["shownTriggerIds"]["has"](I["id"])) continue;
        if (I["show_once_per_visitor"] && this["visitorShownTriggerIds"]["has"](I["id"])) continue;
        if (this["evaluateTrigger"](I, H)) {
          this["fireTrigger"](I);
          break;
        }
      }
    },
    evaluateTrigger(G, H) {
      if (!G["conditions"] || G["conditions"]["length"] === 0) return false;
      return G["conditions"]["every"](I => this["checkCondition"](I, H));
    },
    checkCondition(G, H) {
      const {type: I, value: J, operator: K} = G;
      switch (I) {
       case "time":
        return this["compare"](H["timeOnPage"], J, K);

       case "scroll":
        return this["compare"](H["maxScrollDepth"], J, K);

       case "exit_intent":
        return H["exitIntentDetected"] === true;

       case "url":
        return this["matchUrl"](H["currentUrl"], J, K);

       case "visit_count":
        return this["compare"](H["pageViews"], J, K);

       default:
        return false;
      }
    },
    compare(G, H, I) {
      switch (I) {
       case "eq":
        return G === H;

       case "gte":
        return G >= H;

       case "lte":
        return G <= H;

       case "gt":
        return G > H;

       case "lt":
        return G < H;

       default:
        return G >= H;
      }
    },
    matchUrl(G, H, I) {
      if (I === "eq") return G === H;
      if (I === "contains") return G["includes"](H);
      if (I === "matches") try {
        const J = new RegExp(H["replace"](/\*/g, ".*"));
        return J["test"](G);
      } catch (K) {
        return G["includes"](H);
      }
      return G["includes"](H);
    },
    fireTrigger(G) {
      this["lastTriggerTime"] = Date["now"](), this["saveShownTrigger"](G["id"], G["show_once_per_visitor"]);
      const H = G["delay_after_trigger_ms"] || 0;
      setTimeout(() => {
        showNudge(G), this["logEvent"](G["id"], "shown");
      }, H);
    },
    async logEvent(G, H) {
      try {
        const I = new URLSearchParams({
          trigger_id: G,
          session_id: sessionId,
          event_type: H
        });
        await fetch(config.apiUrl + "/api/widget/" + config.siteId + "/triggers/event?" + I, {
          method: "POST"
        });
      } catch (J) {}
    }
  };
  // --- Nudge bubble (proactive triggers) ---
  let activeNudgeEl = null;
  function showNudge(G) {
    activeNudgeEl && activeNudgeEl["remove"]();
    const H = document["createElement"]("div");
    H["className"] = "sitechat-nudge", H["innerHTML"] = '\n      <div class="sitechat-nudge-message">' + escapeHtml(G["message"]) + '</div>\n      <button class="sitechat-nudge-close" aria-label="Dismiss">×</button>\n    ', 
    H["querySelector"](".sitechat-nudge-close")["addEventListener"]("click", I => {
      I["stopPropagation"](), H["classList"]["add"]("sitechat-nudge-out"), triggerEngine.logEvent(G["id"], "dismissed"), setTimeout(() => H["remove"](), 300), 
      activeNudgeEl = null;
    }), H["addEventListener"]("click", () => {
      H["remove"](), activeNudgeEl = null, triggerEngine.logEvent(G["id"], "clicked"), chatOpen = true, toggleBtn["classList"]["add"]("open"), windowEl["classList"]["add"]("open"), 
      inputEl["focus"](), triggerEngine.logEvent(G["id"], "converted");
    }), document["body"]["appendChild"](H), activeNudgeEl = H, scheduleMobileViewportOffsets(), requestAnimationFrame(() => {
      H["classList"]["add"]("sitechat-nudge-in");
    });
  }
  function escapeHtml(G) {
    const H = document["createElement"]("div");
    return H["textContent"] = G, H["innerHTML"];
  }

  // --- Human handoff + agent polling ---
  const handoff = {
    async checkAvailability() {
      try {
        const G = await fetch(config.apiUrl + "/api/sites/" + config.siteId + "/handoff/availability");
        if (G["ok"]) {
          const H = await G["json"]();
          return handoffState.isAvailable = H["available"], handoffState.offlineMessage = H["offline_message"], H;
        }
      } catch (I) {
        console["warn"]("Could not check handoff availability:", I);
      }
      return {
        available: true,
        is_within_hours: true
      };
    },
    async requestHandoff(G = "user_request") {
      const H = await this["checkAvailability"]();
      if (!H["available"]) {
        this["showOfflineForm"]();
        return;
      }
      const I = this["getAIConversation"]();
      try {
        const J = await fetch(config.apiUrl + "/api/handoff", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON["stringify"]({
            session_id: sessionId,
            site_id: config.siteId,
            reason: G,
            ai_conversation: I
          })
        });
        if (J["ok"]) {
          const K = await J["json"]();
          handoffState.handoffId = K["handoff_id"], handoffState.mode = "pending", this["updateUIForHandoff"](), this["addSystemMessage"]("Connecting you to a human agent. Please wait..."), 
          this["startPolling"]();
        }
      } catch (L) {
        console["error"]("Failed to request handoff:", L), this["addSystemMessage"]("Sorry, we could not connect you to an agent. Please try again later.");
      }
    },
    getAIConversation() {
      const G = messagesEl["querySelectorAll"](".sitechat-message-wrapper"), H = [];
      return G["forEach"](I => {
        const J = I["classList"]["contains"]("user"), K = I["querySelector"](".sitechat-message");
        K && H["push"]({
          role: J ? "user" : "assistant",
          content: K["textContent"] || ""
        });
      }), H;
    },
    showOfflineForm() {
      const G = '\n        <div class="sitechat-offline-form">\n          <div class="sitechat-offline-icon">\n            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\n              <circle cx="12" cy="12" r="10"/>\n              <path d="M12 6v6l4 2"/>\n            </svg>\n          </div>\n          <h4>We\'re currently offline</h4>\n          <p>' + escapeHtml(handoffState.offlineMessage || "Leave your email and we'll get back to you.") + '</p>\n          <form class="sitechat-offline-email-form">\n            <input type="email" placeholder="Your email address" required class="sitechat-offline-email">\n            <button type="submit" class="sitechat-offline-submit">Send</button>\n          </form>\n        </div>\n      ', H = document["createElement"]("div");
      H["className"] = "sitechat-message-wrapper bot", H["innerHTML"] = '\n        <div class="sitechat-avatar bot">\n          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\n            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>\n            <circle cx="12" cy="7" r="4"/>\n          </svg>\n        </div>\n        <div class="sitechat-message-content">\n          <div class="sitechat-message bot">' + G + "</div>\n        </div>\n      ", 
      messagesEl["appendChild"](H), messagesEl["scrollTop"] = messagesEl["scrollHeight"];
      const I = H["querySelector"](".sitechat-offline-email-form");
      I["addEventListener"]("submit", async J => {
        J["preventDefault"]();
        const K = H["querySelector"](".sitechat-offline-email")["value"];
        try {
          await fetch(config.apiUrl + "/api/handoff", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON["stringify"]({
              session_id: sessionId,
              site_id: config.siteId,
              reason: "user_request",
              visitor_email: K,
              ai_conversation: this["getAIConversation"]()
            })
          }), H["querySelector"](".sitechat-message")["innerHTML"] = '\n            <div class="sitechat-offline-success">\n              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\n                <polyline points="20 6 9 17 4 12"/>\n              </svg>\n              <p>Thanks! We\'ll get back to you at <strong>' + escapeHtml(K) + "</strong> as soon as possible.</p>\n            </div>\n          ";
        } catch (L) {
          console["error"]("Failed to submit offline request:", L);
        }
      });
    },
    updateUIForHandoff() {
      const G = document["querySelector"](".sitechat-header");
      if (G) {
        G["classList"]["add"]("handoff-mode");
        const I = G["querySelector"](".sitechat-header-text p");
        I && (I["textContent"] = handoffState.mode === "active" ? "Chatting with " + (handoffState.agentName || "Agent") : "Waiting for agent...");
      }
      const H = document["querySelector"](".sitechat-handoff-btn");
      H && (H["style"]["display"] = "none");
    },
    addSystemMessage(G) {
      const H = document["createElement"]("div");
      H["className"] = "sitechat-system-message", H["innerHTML"] = "<span>" + escapeHtml(G) + "</span>", messagesEl["appendChild"](H), messagesEl["scrollTop"] = messagesEl["scrollHeight"];
    },
    addAgentMessage(G, H) {
      const I = document["createElement"]("div");
      I["className"] = "sitechat-message-wrapper bot agent", I["innerHTML"] = '\n        <div class="sitechat-avatar bot agent">\n          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\n            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>\n            <circle cx="12" cy="7" r="4"/>\n          </svg>\n        </div>\n        <div class="sitechat-message-content">\n          <div class="sitechat-message bot">' + escapeHtml(G) + '</div>\n          <div class="sitechat-message-time">' + (H || "Agent") + " · " + (new Date)["toLocaleTimeString"]([], {
        hour: "2-digit",
        minute: "2-digit"
      }) + "</div>\n        </div>\n      ", messagesEl["appendChild"](I), messagesEl["scrollTop"] = messagesEl["scrollHeight"];
    },
    startPolling() {
      handoffState.pollInterval && clearInterval(handoffState.pollInterval), handoffState.pollInterval = setInterval(() => this["pollMessages"](), 2e3);
    },
    stopPolling() {
      handoffState.pollInterval && (clearInterval(handoffState.pollInterval), handoffState.pollInterval = null);
    },
    async pollMessages() {
      if (!handoffState.handoffId) return;
      try {
        let G = config.apiUrl + "/api/handoff/" + handoffState.handoffId + "/messages";
        handoffState.lastMessageTime && (G += "?since=" + handoffState.lastMessageTime);
        const H = await fetch(G);
        if (H["ok"]) {
          const I = await H["json"]();
          I["status"] === "active" && handoffState.mode !== "active" && (handoffState.mode = "active", handoffState.agentName = I["agent_name"], this["updateUIForHandoff"](), 
          this["addSystemMessage"]((I["agent_name"] || "An agent") + " has joined the conversation."));
          if (I["status"] === "resolved") {
            handoffState.mode = "resolved", this["stopPolling"](), this["addSystemMessage"]("This conversation has been resolved. Thank you!"), 
            this["resetToAIMode"]();
            return;
          }
          if (I["status"] === "abandoned") {
            this["stopPolling"](), this["addSystemMessage"]("You are back on the AI assistant."), this["clearHandoffLocal"]();
            return;
          }
          I["messages"] && I["messages"]["length"] > 0 && I["messages"]["forEach"](J => {
            J["role"] === "agent" && (this["addAgentMessage"](J["content"], J["sender_name"]), handoffState.lastMessageTime = J["timestamp"]);
          });
        }
      } catch (J) {
        console["warn"]("Failed to poll messages:", J);
      }
    },
    async sendMessage(G) {
      if (!handoffState.handoffId) return false;
      try {
        const H = await fetch(config.apiUrl + "/api/handoff/" + handoffState.handoffId + "/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON["stringify"]({
            content: G
          })
        });
        return H["ok"];
      } catch (I) {
        return console["error"]("Failed to send handoff message:", I), false;
      }
    },
    clearHandoffLocal() {
      handoffState.mode = "ai", handoffState.handoffId = null, handoffState.agentName = null, handoffState.lastMessageTime = null;
      const G = document["querySelector"](".sitechat-header");
      if (G) {
        G["classList"]["remove"]("handoff-mode");
        const I = G["querySelector"](".sitechat-header-text p");
        if (I) I["textContent"] = config.agentCaption;
      }
      const H = document["querySelector"](".sitechat-handoff-btn");
      if (H) H["style"]["display"] = "";
    },
    resetToAIMode() {
      setTimeout(() => this["clearHandoffLocal"](), 3e3);
    }
  };
  if (!config.previewMode) {
    visitorBehavior.init(), triggerEngine.init();
  }
  // Re-check schedule/device visibility every minute and on resize
  const visibilityCheckInterval = setInterval(applyVisibility, 6e4);
  window.addEventListener("resize", applyVisibility, { passive: true });
  // Fade the launcher while the visitor scrolls so it doesn't obstruct content
  const scrollFadeHandler = () => {
    if (toggleBtn) toggleBtn["classList"]["toggle"]("sitechat-faded", window["scrollY"] > 60);
  };
  window.addEventListener("scroll", scrollFadeHandler, { passive: true });
  const pagehideHandler = () => {
    if (handoffState.handoffId && (handoffState.mode === "pending" || handoffState.mode === "active")) {
      const Hid = handoffState.handoffId;
      const abandonUrl = config.apiUrl + "/api/handoff/" + encodeURIComponent(Hid) + "/abandon";
      const abandonBody = JSON.stringify({ session_id: sessionId });
      if (
        !(
          navigator.sendBeacon &&
          navigator.sendBeacon(abandonUrl, new Blob([abandonBody], { type: "application/json" }))
        )
      ) {
        fetch(abandonUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: abandonBody,
          keepalive: true,
        }).catch(() => {});
      }
    }
  };
  window["addEventListener"]("pagehide", pagehideHandler);
  // --- Base layout CSS + widget DOM (self-contained widget bubble) ---
  const baseWidgetCss = "\n    .sitechat-widget * {\n      margin: 0;\n      padding: 0;\n      box-sizing: border-box;\n      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;\n    }\n    \n    .sitechat-toggle {\n      position: fixed;\n      bottom: 24px;\n      right: 24px;\n      width: 60px;\n      height: 60px;\n      border-radius: 50%;\n      background: linear-gradient(135deg, " + config.primaryColor + ", " + adjustHexColor(config.primaryColor, -20) + ");\n      border: none;\n      cursor: pointer;\n      display: flex;\n      align-items: center;\n      justify-content: center;\n      box-shadow: 0 4px 20px rgba(123, 61, 251, 0.4);\n      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);\n      z-index: 99998;\n    }\n    \n    .sitechat-toggle:hover {\n      transform: scale(1.05);\n      box-shadow: 0 6px 25px rgba(123, 61, 251, 0.5);\n    }\n    \n    .sitechat-toggle svg {\n      width: 28px;\n      height: 28px;\n      color: white;\n      transition: all 0.3s ease;\n    }\n    \n    .sitechat-toggle.open .sitechat-icon-chat { display: none; }\n    .sitechat-toggle:not(.open) .sitechat-icon-close { display: none; }\n    \n    .sitechat-window {\n      position: fixed;\n      bottom: 100px;\n      right: 24px;\n      width: 400px;\n      height: 560px;\n      background: #ffffff;\n      border-radius: 16px;\n      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);\n      display: flex;\n      flex-direction: column;\n      overflow: hidden;\n      z-index: 99999;\n      opacity: 0;\n      visibility: hidden;\n      transform: translateY(20px) scale(0.95);\n      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);\n    }\n    \n    .sitechat-window.open {\n      opacity: 1;\n      visibility: visible;\n      transform: translateY(0) scale(1);\n    }\n    \n    .sitechat-header {\n      background: linear-gradient(135deg, " + config.primaryColor + ", " + adjustHexColor(config.primaryColor, -20) + ");\n      color: white;\n      padding: 20px 24px;\n      display: flex;\n      align-items: center;\n      gap: 10px;\n      min-width: 0;\n    }\n    \n    .sitechat-header-icon {\n      width: 40px;\n      height: 40px;\n      background: rgba(255, 255, 255, 0.2);\n      border-radius: 10px;\n      display: flex;\n      align-items: center;\n      justify-content: center;\n    }\n    \n    .sitechat-header-icon svg {\n      width: 22px;\n      height: 22px;\n    }\n    \n    .sitechat-header-text {\n      flex: 1;\n      min-width: 0;\n    }\n    \n    .sitechat-header-text h3 {\n      font-size: 16px;\n      font-weight: 600;\n      margin-bottom: 2px;\n      overflow: hidden;\n      text-overflow: ellipsis;\n      white-space: nowrap;\n    }\n    \n    .sitechat-header-text p {\n      font-size: 13px;\n      opacity: 0.9;\n      overflow: hidden;\n      text-overflow: ellipsis;\n      white-space: nowrap;\n    }\n    \n    .sitechat-header-actions {\n      display: flex;\n      align-items: center;\n      gap: 8px;\n      flex-shrink: 0;\n    }\n    \n    .sitechat-handoff-btn {\n      display: inline-flex;\n      align-items: center;\n      gap: 5px;\n      height: 32px;\n      padding: 0 4px 0 10px;\n      border: 1px solid rgba(255, 255, 255, 0.45);\n      border-radius: 999px;\n      background: transparent;\n      color: white;\n      font-size: 13px;\n      font-weight: 500;\n      cursor: pointer;\n      transition: background 0.2s ease;\n      font-family: inherit;\n    }\n    \n    .sitechat-handoff-btn:hover {\n      background: rgba(255, 255, 255, 0.15);\n    }\n    \n    .sitechat-handoff-btn svg {\n      width: 14px;\n      height: 14px;\n      color: white;\n      flex-shrink: 0;\n    }\n    \n    .sitechat-live-agent-label {\n      white-space: nowrap;\n      padding-right: 6px;\n    }\n    \n    .sitechat-header-close {\n      width: 36px;\n      height: 36px;\n      border: none;\n      background: rgba(255, 255, 255, 0.2);\n      border-radius: 8px;\n      cursor: pointer;\n      display: flex;\n      align-items: center;\n      justify-content: center;\n      flex-shrink: 0;\n      transition: all 0.2s ease;\n      color: white;\n    }\n    \n    .sitechat-header-close:hover {\n      background: rgba(255, 255, 255, 0.3);\n    }\n    \n    .sitechat-header-close svg {\n      width: 18px;\n      height: 18px;\n      color: white;\n    }\n    \n    .sitechat-messages {\n      flex: 1;\n      overflow-y: auto;\n      padding: 20px;\n      display: flex;\n      flex-direction: column;\n      gap: 16px;\n      background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);\n    }\n    \n    .sitechat-messages::-webkit-scrollbar {\n      width: 6px;\n    }\n    \n    .sitechat-messages::-webkit-scrollbar-track {\n      background: transparent;\n    }\n    \n    .sitechat-messages::-webkit-scrollbar-thumb {\n      background: #cbd5e1;\n      border-radius: 3px;\n    }\n    \n    .sitechat-message-wrapper {\n      display: flex;\n      gap: 10px;\n      animation: messageIn 0.4s cubic-bezier(0.4, 0, 0.2, 1);\n    }\n    \n    .sitechat-message-wrapper.user {\n      flex-direction: row-reverse;\n    }\n    \n    .sitechat-avatar {\n      width: 32px;\n      height: 32px;\n      border-radius: 50%;\n      display: flex;\n      align-items: center;\n      justify-content: center;\n      flex-shrink: 0;\n      font-size: 14px;\n      font-weight: 600;\n    }\n    \n    .sitechat-avatar.bot {\n      background: linear-gradient(135deg, " + config.primaryColor + ", " + adjustHexColor(config.primaryColor, -30) + ");\n      color: white;\n      box-shadow: 0 2px 8px " + config.primaryColor + "40;\n    }\n    \n    .sitechat-avatar.bot svg {\n      width: 18px;\n      height: 18px;\n    }\n    \n    .sitechat-avatar.user {\n      background: linear-gradient(135deg, #64748b, #475569);\n      color: white;\n    }\n    \n    .sitechat-message-content {\n      max-width: calc(100% - 50px);\n      display: flex;\n      flex-direction: column;\n      gap: 4px;\n    }\n    \n    .sitechat-message {\n      padding: 14px 18px;\n      border-radius: 18px;\n      font-size: 14px;\n      line-height: 1.6;\n      word-wrap: break-word;\n    }\n    \n    @keyframes messageIn {\n      from {\n        opacity: 0;\n        transform: translateY(12px);\n      }\n      to {\n        opacity: 1;\n        transform: translateY(0);\n      }\n    }\n    \n    .sitechat-message.user {\n      background: linear-gradient(135deg, " + config.primaryColor + ", " + adjustHexColor(config.primaryColor, -25) + ");\n      color: white;\n      border-bottom-right-radius: 6px;\n      box-shadow: 0 2px 12px " + config.primaryColor + "30;\n    }\n    \n    .sitechat-message.bot {\n      background: white;\n      color: #1e293b;\n      border-bottom-left-radius: 6px;\n      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04);\n      border: 1px solid rgba(0, 0, 0, 0.04);\n    }\n    \n    .sitechat-message.bot p {\n      margin: 0 0 10px 0;\n    }\n    \n    .sitechat-message.bot p:last-child {\n      margin-bottom: 0;\n    }\n    \n    .sitechat-message.bot ul,\n    .sitechat-message.bot ol {\n      margin: 8px 0;\n      padding-left: 20px;\n    }\n    \n    .sitechat-message.bot li {\n      margin: 4px 0;\n    }\n    \n    .sitechat-message.bot strong {\n      font-weight: 600;\n      color: #0f172a;\n    }\n    \n    .sitechat-message.bot code {\n      background: #f1f5f9;\n      padding: 2px 6px;\n      border-radius: 4px;\n      font-family: 'SF Mono', Monaco, monospace;\n      font-size: 13px;\n      color: " + config.primaryColor + ";\n    }\n    \n    .sitechat-message-time {\n      font-size: 11px;\n      color: #94a3b8;\n      padding: 0 4px;\n    }\n    \n    .sitechat-message-wrapper.user .sitechat-message-time {\n      text-align: right;\n    }\n    \n    .sitechat-feedback {\n      display: flex;\n      gap: 8px;\n      margin-top: 8px;\n      padding: 0 4px;\n    }\n    \n    .sitechat-feedback-btn {\n      display: flex;\n      align-items: center;\n      justify-content: center;\n      width: 28px;\n      height: 28px;\n      background: transparent;\n      border: 1px solid #e2e8f0;\n      border-radius: 6px;\n      cursor: pointer;\n      transition: all 0.2s ease;\n      color: #94a3b8;\n    }\n    \n    .sitechat-feedback-btn:hover {\n      background: #f8fafc;\n      color: #64748b;\n    }\n    \n    .sitechat-feedback-btn.active {\n      border-color: " + config.primaryColor + "40;\n    }\n    \n    .sitechat-feedback-btn.active.positive {\n      background: #dcfce7;\n      color: #16a34a;\n      border-color: #16a34a40;\n    }\n    \n    .sitechat-feedback-btn.active.negative {\n      background: #fee2e2;\n      color: #dc2626;\n      border-color: #dc262640;\n    }\n    \n    .sitechat-feedback-btn svg {\n      width: 14px;\n      height: 14px;\n    }\n    \n    .sitechat-feedback-thanks {\n      font-size: 11px;\n      color: #10b981;\n      display: flex;\n      align-items: center;\n      gap: 4px;\n    }\n    \n    .sitechat-feedback-thanks svg {\n      width: 12px;\n      height: 12px;\n    }\n    \n    .sitechat-welcome {\n      display: flex;\n      flex-direction: column;\n      align-items: center;\n      justify-content: center;\n      text-align: center;\n      padding: 50px 30px;\n      color: #64748b;\n      animation: welcomeFade 0.5s ease;\n    }\n    \n    @keyframes welcomeFade {\n      from { opacity: 0; transform: scale(0.95); }\n      to { opacity: 1; transform: scale(1); }\n    }\n    \n    .sitechat-welcome-icon {\n      width: 72px;\n      height: 72px;\n      background: linear-gradient(135deg, " + config.primaryColor + "15, " + config.primaryColor + "25);\n      border-radius: 20px;\n      display: flex;\n      align-items: center;\n      justify-content: center;\n      margin-bottom: 20px;\n      position: relative;\n    }\n    \n    .sitechat-welcome-icon::before {\n      content: '';\n      position: absolute;\n      inset: -3px;\n      background: linear-gradient(135deg, " + config.primaryColor + "40, transparent);\n      border-radius: 22px;\n      z-index: -1;\n    }\n    \n    .sitechat-welcome-icon svg {\n      width: 36px;\n      height: 36px;\n      color: " + config.primaryColor + ";\n    }\n    \n    .sitechat-welcome h4 {\n      font-size: 18px;\n      font-weight: 600;\n      color: #1e293b;\n      margin-bottom: 8px;\n    }\n    \n    .sitechat-welcome p {\n      font-size: 14px;\n      line-height: 1.5;\n      max-width: 240px;\n    }\n    \n    .sitechat-welcome-suggestions {\n      display: flex;\n      flex-direction: column;\n      gap: 8px;\n      margin-top: 20px;\n      width: 100%;\n    }\n    \n    .sitechat-suggestion {\n      padding: 10px 16px;\n      background: white;\n      border: 1px solid #e2e8f0;\n      border-radius: 10px;\n      font-size: 13px;\n      color: #475569;\n      cursor: pointer;\n      transition: all 0.2s ease;\n      text-align: left;\n    }\n    \n    .sitechat-suggestion:hover {\n      background: " + config.primaryColor + "08;\n      border-color: " + config.primaryColor + "30;\n      color: " + config.primaryColor + ";\n      transform: translateX(4px);\n    }\n    \n    .sitechat-post-prompts {\n      display: flex;\n      flex-direction: column;\n      gap: 8px;\n      margin: 4px 0 12px 44px;\n      width: calc(100% - 56px);\n    }\n    \n    .sitechat-card {\n      background: white;\n      border: 1px solid #e2e8f0;\n      border-radius: 12px;\n      padding: 14px;\n      display: flex;\n      flex-direction: column;\n      gap: 6px;\n      box-shadow: 0 1px 3px rgba(0,0,0,0.05);\n    }\n    \n    .sitechat-card-icon {\n      font-size: 22px;\n      line-height: 1;\n    }\n    \n    .sitechat-card-icon-img {\n      width: 32px;\n      height: 32px;\n      border-radius: 8px;\n      object-fit: cover;\n    }\n    \n    .sitechat-card-title {\n      font-size: 14px;\n      font-weight: 600;\n      color: #0f172a;\n    }\n    \n    .sitechat-card-desc {\n      font-size: 12.5px;\n      color: #64748b;\n      line-height: 1.45;\n    }\n    \n    .sitechat-card-buttons {\n      display: flex;\n      flex-wrap: wrap;\n      gap: 8px;\n      margin-top: 6px;\n    }\n    \n    .sitechat-card-btn {\n      flex: 1 1 auto;\n      padding: 8px 14px;\n      border-radius: 8px;\n      font-size: 12.5px;\n      font-weight: 600;\n      cursor: pointer;\n      transition: all 0.2s ease;\n      border: 1px solid #e2e8f0;\n      background: white;\n      color: #475569;\n    }\n    \n    .sitechat-card-btn.primary {\n      background: " + config.primaryColor + ";\n      border-color: " + config.primaryColor + ";\n      color: white;\n    }\n    \n    .sitechat-card-btn:hover {\n      transform: translateY(-1px);\n      box-shadow: 0 2px 6px rgba(0,0,0,0.1);\n    }\n    \n    .sitechat-card-btn.primary:hover {\n      opacity: 0.9;\n    }\n    \n    .sitechat-help-panel {\n      flex: 1;\n      overflow-y: auto;\n      display: flex;\n      flex-direction: column;\n      background: #f8fafc;\n    }\n    \n    .sitechat-help-panel[hidden] {\n      display: none;\n    }\n    \n    .sitechat-help-top {\n      display: flex;\n      justify-content: flex-end;\n      padding: 8px 16px 0;\n      background: white;\n    }\n    \n    .sitechat-help-portal-link {\n      display: inline-flex;\n      align-items: center;\n      gap: 4px;\n      font-size: 11.5px;\n      font-weight: 600;\n      color: " + config.primaryColor + ";\n      text-decoration: none;\n    }\n    \n    .sitechat-help-portal-link:hover {\n      text-decoration: underline;\n    }\n    \n    .sitechat-view-help .sitechat-messages,\n    .sitechat-view-help .sitechat-input-wrapper {\n      display: none;\n    }\n    \n    .sitechat-view-help .sitechat-help-panel {\n      display: flex;\n    }\n    \n    .sitechat-help-search {\n      display: flex;\n      align-items: center;\n      gap: 8px;\n      padding: 12px 16px;\n      background: white;\n      border-bottom: 1px solid #e2e8f0;\n      position: sticky;\n      top: 0;\n      z-index: 2;\n    }\n    \n    .sitechat-help-search svg {\n      width: 16px;\n      height: 16px;\n      color: #94a3b8;\n      flex-shrink: 0;\n    }\n    \n    .sitechat-help-search-input {\n      flex: 1;\n      border: none;\n      outline: none;\n      font-size: 13.5px;\n      background: transparent;\n      color: #0f172a;\n    }\n    \n    .sitechat-help-content {\n      flex: 1;\n      padding: 16px;\n      overflow-y: auto;\n    }\n    \n    .sitechat-help-heading {\n      font-size: 15px;\n      font-weight: 700;\n      color: #0f172a;\n      margin-bottom: 12px;\n    }\n    \n    .sitechat-help-list {\n      display: flex;\n      flex-direction: column;\n      gap: 8px;\n    }\n    \n    .sitechat-help-category {\n      display: flex;\n      align-items: center;\n      justify-content: space-between;\n      gap: 10px;\n      background: white;\n      border: 1px solid #e2e8f0;\n      border-radius: 10px;\n      padding: 14px;\n      cursor: pointer;\n      transition: all 0.2s ease;\n      text-align: left;\n    }\n    \n    .sitechat-help-category:hover {\n      border-color: " + config.primaryColor + "50;\n      box-shadow: 0 2px 8px rgba(0,0,0,0.06);\n    }\n    \n    .sitechat-help-cat-icon {\n      width: 20px; height: 20px; object-fit: contain; border-radius: 4px; flex-shrink: 0;\n    }\n    \n    .sitechat-help-cat-emoji {\n      font-size: 16px; line-height: 1; width: 20px; text-align: center; flex-shrink: 0;\n    }\n    \n    .sitechat-help-cat-name {\n      flex: 1;\n      font-size: 13.5px;\n      font-weight: 600;\n      color: #0f172a;\n    }\n    \n    .sitechat-help-cat-count {\n      font-size: 12px;\n      color: #94a3b8;\n    }\n    \n    .sitechat-help-article-link {\n      display: flex;\n      flex-direction: column;\n      gap: 4px;\n      background: white;\n      border: 1px solid #e2e8f0;\n      border-radius: 10px;\n      padding: 12px 14px;\n      cursor: pointer;\n      font-size: 13px;\n      color: #334155;\n      text-align: left;\n      transition: all 0.2s ease;\n    }\n    \n    .sitechat-help-article-link:hover {\n      border-color: " + config.primaryColor + "50;\n      color: " + config.primaryColor + ";\n    }\n    \n    .sitechat-help-excerpt {\n      font-size: 12px;\n      color: #94a3b8;\n    }\n    \n    .sitechat-help-back {\n      background: none;\n      border: none;\n      color: " + config.primaryColor + ";\n      font-size: 13px;\n      font-weight: 600;\n      cursor: pointer;\n      padding: 0 0 12px;\n    }\n    \n    .sitechat-help-article {\n      background: white;\n      border: 1px solid #e2e8f0;\n      border-radius: 10px;\n      padding: 16px;\n    }\n    \n    .sitechat-help-article-title {\n      font-size: 16px;\n      font-weight: 700;\n      color: #0f172a;\n      margin-bottom: 10px;\n    }\n    \n    .sitechat-help-article-body {\n      font-size: 13.5px;\n      color: #334155;\n      line-height: 1.6;\n    }\n    \n    .sitechat-help-article-body img {\n      max-width: 100%;\n      border-radius: 8px;\n    }\n    \n    .sitechat-help-article-body a {\n      color: " + config.primaryColor + ";\n    }\n    \n    .sitechat-help-article-body p {\n      margin-bottom: 8px;\n    }\n    \n    .sitechat-help-empty {\n      text-align: center;\n      color: #94a3b8;\n      font-size: 13px;\n      padding: 32px 16px;\n    }\n    \n    .sitechat-window-nav {\n      display: flex;\n      border-top: 1px solid #e2e8f0;\n      background: white;\n    }\n    \n    .sitechat-window-nav[hidden] {\n      display: none;\n    }\n    \n    .sitechat-nav-btn {\n      flex: 1;\n      display: flex;\n      flex-direction: column;\n      align-items: center;\n      gap: 3px;\n      padding: 8px 4px 6px;\n      background: none;\n      border: none;\n      cursor: pointer;\n      color: #94a3b8;\n      font-size: 10.5px;\n      font-weight: 600;\n      transition: color 0.2s ease;\n    }\n    \n    .sitechat-nav-btn svg {\n      width: 18px;\n      height: 18px;\n    }\n    \n    .sitechat-nav-btn.active {\n      color: " + config.primaryColor + ";\n    }\n    \n    .sitechat-nav-btn:hover {\n      color: " + config.primaryColor + ";\n    }\n    \n    .sitechat-sources {\n      margin-top: 12px;\n      padding-top: 12px;\n      border-top: 1px solid #e2e8f0;\n    }\n    \n    .sitechat-sources-label {\n      display: flex;\n      align-items: center;\n      gap: 6px;\n      font-size: 11px;\n      font-weight: 600;\n      color: #64748b;\n      text-transform: uppercase;\n      letter-spacing: 0.05em;\n      margin-bottom: 8px;\n    }\n    \n    .sitechat-sources-label svg {\n      width: 12px;\n      height: 12px;\n    }\n    \n    .sitechat-sources-list {\n      display: flex;\n      flex-wrap: wrap;\n      gap: 6px;\n    }\n    \n    .sitechat-source-link {\n      display: inline-flex;\n      align-items: center;\n      gap: 5px;\n      font-size: 12px;\n      color: " + config.primaryColor + ";\n      text-decoration: none;\n      padding: 6px 10px;\n      background: linear-gradient(135deg, " + config.primaryColor + "08, " + config.primaryColor + "12);\n      border: 1px solid " + config.primaryColor + "20;\n      border-radius: 8px;\n      transition: all 0.2s ease;\n      max-width: 200px;\n      overflow: hidden;\n      text-overflow: ellipsis;\n      white-space: nowrap;\n    }\n    \n    .sitechat-source-link svg {\n      width: 12px;\n      height: 12px;\n      flex-shrink: 0;\n      opacity: 0.7;\n    }\n    \n    .sitechat-source-link:hover {\n      background: linear-gradient(135deg, " + config.primaryColor + "15, " + config.primaryColor + "20);\n      border-color: " + config.primaryColor + "40;\n      transform: translateY(-1px);\n      box-shadow: 0 2px 8px " + config.primaryColor + "20;\n    }\n    \n    .sitechat-typing-wrapper {\n      display: flex;\n      gap: 10px;\n      align-items: flex-start;\n      animation: messageIn 0.3s ease;\n    }\n    \n    .sitechat-typing {\n      display: flex;\n      gap: 5px;\n      padding: 14px 18px;\n      background: white;\n      border-radius: 18px;\n      border-bottom-left-radius: 6px;\n      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);\n      border: 1px solid rgba(0, 0, 0, 0.04);\n    }\n    \n    .sitechat-typing span {\n      width: 8px;\n      height: 8px;\n      background: linear-gradient(135deg, " + config.primaryColor + ", " + adjustHexColor(config.primaryColor, -20) + ");\n      border-radius: 50%;\n      animation: typingBounce 1.4s infinite ease-in-out;\n    }\n    \n    .sitechat-typing span:nth-child(1) { animation-delay: 0s; }\n    .sitechat-typing span:nth-child(2) { animation-delay: 0.15s; }\n    .sitechat-typing span:nth-child(3) { animation-delay: 0.3s; }\n    \n    @keyframes typingBounce {\n      0%, 60%, 100% { \n        transform: translateY(0);\n        opacity: 0.4;\n      }\n      30% { \n        transform: translateY(-6px);\n        opacity: 1;\n      }\n    }\n    \n    .sitechat-input-wrapper {\n      padding: 16px;\n      background: white;\n      border-top: 1px solid #e5e7eb;\n    }\n    \n    .sitechat-input-form {\n      display: flex;\n      gap: 10px;\n      background: #f3f4f6;\n      border-radius: 12px;\n      padding: 6px;\n    }\n    \n    .sitechat-input {\n      flex: 1;\n      border: none;\n      background: transparent;\n      padding: 10px 12px;\n      font-size: 14px;\n      color: #374151;\n      outline: none;\n    }\n    \n    .sitechat-input::placeholder {\n      color: #9ca3af;\n    }\n    \n    .sitechat-send {\n      width: 44px;\n      height: 44px;\n      border-radius: 10px;\n      background: linear-gradient(135deg, " + config.primaryColor + ", " + adjustHexColor(config.primaryColor, -20) + ");\n      border: none;\n      cursor: pointer;\n      display: flex;\n      align-items: center;\n      justify-content: center;\n      transition: all 0.2s;\n    }\n    \n    .sitechat-send:hover:not(:disabled) {\n      transform: scale(1.05);\n    }\n    \n    .sitechat-send:disabled {\n      background: #d1d5db;\n      cursor: not-allowed;\n    }\n    \n    .sitechat-send svg {\n      width: 20px;\n      height: 20px;\n      color: white;\n    }\n    \n    @media (max-width: 480px) {\n      .sitechat-window {\n        width: calc(100% - 32px);\n        right: 16px;\n        bottom: 90px;\n        height: calc(100vh - 120px);\n        max-height: 560px;\n      }\n      \n      .sitechat-toggle {\n        right: 16px;\n        bottom: 16px;\n      }\n    }\n    \n    /* Nudge Bubble Styles */\n    .sitechat-nudge {\n      position: fixed;\n      bottom: 100px;\n      right: 24px;\n      max-width: 280px;\n      background: white;\n      border-radius: 16px;\n      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15), 0 4px 12px rgba(0, 0, 0, 0.1);\n      z-index: 99997;\n      cursor: pointer;\n      opacity: 0;\n      transform: translateY(20px) scale(0.9);\n      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);\n      overflow: hidden;\n    }\n    \n    .sitechat-nudge::before {\n      content: '';\n      position: absolute;\n      top: 0;\n      left: 0;\n      right: 0;\n      height: 4px;\n      background: linear-gradient(135deg, " + config.primaryColor + ", " + adjustHexColor(config.primaryColor, -20) + ");\n    }\n    \n    .sitechat-nudge-in {\n      opacity: 1;\n      transform: translateY(0) scale(1);\n    }\n    \n    .sitechat-nudge-out {\n      opacity: 0;\n      transform: translateY(10px) scale(0.95);\n    }\n    \n    .sitechat-nudge-message {\n      padding: 16px 40px 16px 16px;\n      font-size: 14px;\n      line-height: 1.5;\n      color: #1e293b;\n    }\n    \n    .sitechat-nudge-close {\n      position: absolute;\n      top: 8px;\n      right: 8px;\n      width: 24px;\n      height: 24px;\n      border: none;\n      background: #f1f5f9;\n      border-radius: 50%;\n      cursor: pointer;\n      display: flex;\n      align-items: center;\n      justify-content: center;\n      font-size: 16px;\n      color: #64748b;\n      transition: all 0.2s ease;\n    }\n    \n    .sitechat-nudge-close:hover {\n      background: #e2e8f0;\n      color: #475569;\n    }\n    \n    .sitechat-nudge:hover {\n      box-shadow: 0 12px 48px rgba(0, 0, 0, 0.18), 0 6px 16px rgba(0, 0, 0, 0.12);\n    }\n    \n    @media (max-width: 480px) {\n      .sitechat-nudge {\n        right: 16px;\n        bottom: 90px;\n        max-width: calc(100% - 32px);\n      }\n    }\n    \n    /* Human Handoff Styles */\n    .sitechat-header.handoff-mode {\n      background: linear-gradient(135deg, #059669, #047857) !important;\n    }\n    \n    .sitechat-avatar.agent {\n      background: linear-gradient(135deg, #059669, #047857) !important;\n    }\n    \n    .sitechat-system-message {\n      display: flex;\n      justify-content: center;\n      padding: 8px 16px;\n      animation: messageIn 0.3s ease;\n    }\n    \n    .sitechat-system-message span {\n      background: #f1f5f9;\n      color: #64748b;\n      font-size: 12px;\n      padding: 6px 12px;\n      border-radius: 12px;\n    }\n    \n    .sitechat-handoff-suggestion {\n      background: linear-gradient(135deg, #f0fdf4, #dcfce7);\n      border: 1px solid #bbf7d0;\n      border-radius: 12px;\n      padding: 16px;\n      margin: 8px 0;\n      animation: messageIn 0.3s ease;\n    }\n    \n    .sitechat-handoff-suggestion p {\n      font-size: 14px;\n      color: #166534;\n      margin-bottom: 12px;\n    }\n    \n    .sitechat-handoff-suggestion-buttons {\n      display: flex;\n      gap: 8px;\n    }\n    \n    .sitechat-handoff-yes {\n      flex: 1;\n      padding: 10px 16px;\n      background: #059669;\n      color: white;\n      border: none;\n      border-radius: 8px;\n      font-size: 13px;\n      font-weight: 500;\n      cursor: pointer;\n      transition: all 0.2s ease;\n    }\n    \n    .sitechat-handoff-yes:hover {\n      background: #047857;\n    }\n    \n    .sitechat-handoff-no {\n      flex: 1;\n      padding: 10px 16px;\n      background: white;\n      color: #475569;\n      border: 1px solid #e2e8f0;\n      border-radius: 8px;\n      font-size: 13px;\n      font-weight: 500;\n      cursor: pointer;\n      transition: all 0.2s ease;\n    }\n    \n    .sitechat-handoff-no:hover {\n      background: #f8fafc;\n      border-color: #cbd5e1;\n    }\n    \n    .sitechat-offline-form {\n      text-align: center;\n      padding: 8px;\n    }\n    \n    .sitechat-offline-icon {\n      width: 48px;\n      height: 48px;\n      background: #fef3c7;\n      border-radius: 50%;\n      display: flex;\n      align-items: center;\n      justify-content: center;\n      margin: 0 auto 12px;\n    }\n    \n    .sitechat-offline-icon svg {\n      width: 24px;\n      height: 24px;\n      color: #d97706;\n    }\n    \n    .sitechat-offline-form h4 {\n      font-size: 15px;\n      font-weight: 600;\n      color: #1e293b;\n      margin-bottom: 6px;\n    }\n    \n    .sitechat-offline-form p {\n      font-size: 13px;\n      color: #64748b;\n      margin-bottom: 16px;\n    }\n    \n    .sitechat-offline-email-form {\n      display: flex;\n      gap: 8px;\n    }\n    \n    .sitechat-offline-email {\n      flex: 1;\n      padding: 10px 12px;\n      border: 1px solid #e2e8f0;\n      border-radius: 8px;\n      font-size: 14px;\n      outline: none;\n    }\n    \n    .sitechat-offline-email:focus {\n      border-color: #059669;\n    }\n    \n    .sitechat-offline-submit {\n      padding: 10px 16px;\n      background: #059669;\n      color: white;\n      border: none;\n      border-radius: 8px;\n      font-size: 14px;\n      font-weight: 500;\n      cursor: pointer;\n      transition: all 0.2s ease;\n    }\n    \n    .sitechat-offline-submit:hover {\n      background: #047857;\n    }\n    \n    .sitechat-offline-success {\n      display: flex;\n      flex-direction: column;\n      align-items: center;\n      gap: 12px;\n      padding: 16px;\n    }\n    \n    .sitechat-offline-success svg {\n      width: 32px;\n      height: 32px;\n      color: #059669;\n    }\n    \n    .sitechat-offline-success p {\n      font-size: 14px;\n      color: #374151;\n      text-align: center;\n    }\n    \n    /* Branding Footer */\n    .sitechat-branding {\n      padding: 8px 16px;\n      text-align: center;\n      border-top: 1px solid #f3f4f6;\n      background: #fafafa;\n      border-radius: 0 0 16px 16px;\n    }\n    \n    .sitechat-branding a {\n      font-size: 11px;\n      color: #9ca3af;\n      text-decoration: none;\n      transition: color 0.2s ease;\n    }\n    \n    .sitechat-branding a:hover {\n      color: #6b7280;\n    }\n    \n    .sitechat-branding strong {\n      font-weight: 600;\n    }\n    \n    .sitechat-header-icon {\n      position: relative;\n      overflow: visible;\n    }\n    \n    .sitechat-online-dot {\n      position: absolute;\n      bottom: -1px;\n      right: -1px;\n      width: 11px;\n      height: 11px;\n      border-radius: 50%;\n      background: #22C55E;\n      border: 2px solid rgba(255,255,255,0.9);\n      box-sizing: border-box;\n    }\n    \n    .sitechat-footer-text {\n      padding: 6px 18px 8px;\n      font-size: 11px;\n      line-height: 1.5;\n      color: #9ca3af;\n      text-align: center;\n      background: white;\n    }\n    \n    .sitechat-toggle.launcher-text {\n      width: auto;\n      height: 52px;\n      padding: 0 20px;\n      border-radius: 26px;\n      gap: 8px;\n    }\n    \n    .sitechat-toggle.launcher-agent {\n      padding: 0;\n      overflow: hidden;\n    }\n    \n    .sitechat-toggle.launcher-agent .sitechat-launcher-avatar {\n      width: 100%;\n      height: 100%;\n      object-fit: cover;\n      border-radius: 50%;\n    }\n    \n    .sitechat-toggle.launcher-quick-input {\n      width: auto;\n      min-width: 200px;\n      height: 52px;\n      padding: 0 8px 0 18px;\n      border-radius: 26px;\n      background: #ffffff !important;\n      border: 1px solid #e5e7eb;\n      box-shadow: 0 4px 20px rgba(0,0,0,0.12);\n    }\n    \n    .sitechat-launcher-label {\n      display: inline-flex;\n      align-items: center;\n      gap: 8px;\n      font-size: 14px;\n      font-weight: 500;\n    }\n    \n    .sitechat-quick-label {\n      width: 100%;\n      justify-content: space-between;\n      color: #9ca3af;\n    }\n    \n    .sitechat-quick-label svg {\n      width: 32px;\n      height: 32px;\n      padding: 8px;\n      border-radius: 50%;\n      color: white !important;\n      background: " + (config.launcherBackground || config.primaryColor) + ";\n    }\n    \n    .sitechat-toggle.open .sitechat-launcher-label {\n      display: none;\n    }\n    \n    .sitechat-toggle.open.launcher-text,\n    .sitechat-toggle.open.launcher-quick-input {\n      width: 60px;\n      min-width: 60px;\n      padding: 0;\n      border-radius: 50%;\n    }\n  ";
  const fontLinkEl = document["createElement"]("link");
  fontLinkEl["rel"] = "stylesheet";
  fontLinkEl["href"] = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap";
  document["head"]["appendChild"](fontLinkEl);
  const baseStyleEl = document["createElement"]("style");
  baseStyleEl["textContent"] = baseWidgetCss, document["head"]["appendChild"](baseStyleEl);
  const widgetRoot = document["createElement"]("div");
  widgetRoot["className"] = "sitechat-widget", widgetRoot["innerHTML"] = '\n    <button class="sitechat-toggle" aria-label="Toggle chat">\n      <svg class="sitechat-icon-chat" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\n        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z"/>\n      </svg>\n      <svg class="sitechat-icon-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\n        <line x1="18" y1="6" x2="6" y2="18"/>\n        <line x1="6" y1="6" x2="18" y2="18"/>\n      </svg>\n    </button>\n    \n    <div class="sitechat-window">\n      <div class="sitechat-header">\n        <div class="sitechat-header-icon">\n          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\n            <path d="M12 2L2 7l10 5 10-5-10-5z"/>\n            <path d="M2 17l10 5 10-5"/>\n            <path d="M2 12l10 5 10-5"/>\n          </svg>\n        </div>\n        <div class="sitechat-header-text">\n          <h3>' + config.title + '</h3>\n          <p>' + escapeHtml(config.agentCaption) + '</p>\n        </div>\n        <div class="sitechat-header-actions" style="display:flex;align-items:center;gap:8px;flex-shrink:0;">\n          <button type="button" class="sitechat-handoff-btn" title="Talk to a live agent" data-state="idle">\n            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">\n              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>\n              <circle cx="9" cy="7" r="4"/>\n              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>\n              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>\n            </svg>\n            <span class="sitechat-live-agent-label">Live agent</span>\n          </button>\n          <button type="button" class="sitechat-header-close sitechat-close-btn" aria-label="Close chat">\n            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\n              <line x1="18" y1="6" x2="6" y2="18"/>\n              <line x1="6" y1="6" x2="18" y2="18"/>\n            </svg>\n          </button>\n        </div>\n      </div>\n      \n      <div class="sitechat-messages">\n        <div class="sitechat-welcome">\n          <div class="sitechat-welcome-icon">\n            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">\n              <path d="M12 2L2 7l10 5 10-5-10-5z"/>\n              <path d="M2 17l10 5 10-5"/>\n              <path d="M2 12l10 5 10-5"/>\n            </svg>\n          </div>\n          <h4>Hi there! 👋</h4>\n          <p>I\'m your AI assistant. Ask me anything about this website.</p>\n          <div class="sitechat-welcome-suggestions"></div>\n        </div>\n      </div>\n      \n      <div class="sitechat-help-panel" hidden>\n        <div class="sitechat-help-top">\n          <a class="sitechat-help-portal-link" href="#" target="_blank" rel="noopener noreferrer">Open Help Center <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>\n        </div>\n        <div class="sitechat-help-search">\n          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>\n          <input type="text" class="sitechat-help-search-input" placeholder="Search for help...">\n        </div>\n        <div class="sitechat-help-content"></div>\n      </div>\n      \n      <div class="sitechat-input-wrapper">\n        <form class="sitechat-input-form">\n          <input type="text" class="sitechat-input" placeholder="Type your message..." autocomplete="off">\n          <button type="submit" class="sitechat-send" disabled>\n            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\n              <line x1="22" y1="2" x2="11" y2="13"/>\n              <polygon points="22 2 15 22 11 13 2 9 22 2"/>\n            </svg>\n          </button>\n        </form>\n      </div>\n      \n      <div class="sitechat-window-nav" hidden>\n        <button type="button" class="sitechat-nav-btn active" data-nav="chat">\n          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z"/></svg>\n          <span>Conversation</span>\n        </button>\n        <button type="button" class="sitechat-nav-btn" data-nav="help">\n          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>\n          <span class="sitechat-nav-help-label">Help</span>\n        </button>\n      </div>\n      \n      <div class="sitechat-branding">\n        <a href="'+ config.apiUrl +'" target="_blank" rel="noopener noreferrer">\n          Powered by <strong>SwiftChat</strong>\n        </a>\n      </div>\n    </div>\n  ', 
  document["body"]["appendChild"](widgetRoot), injectResponsiveStyles(), injectDynamicThemeStyles(), applyLauncherVariant(), applyAgentProfile(), syncHeaderAndWelcomeText(), updateBrandingFooter();
  const toggleBtn = widgetRoot["querySelector"](".sitechat-toggle"),
    windowEl = widgetRoot["querySelector"](".sitechat-window"),
    messagesEl = widgetRoot["querySelector"](".sitechat-messages"),
    inputForm = widgetRoot["querySelector"](".sitechat-input-form"),
    inputEl = widgetRoot["querySelector"](".sitechat-input"),
    sendBtn = widgetRoot["querySelector"](".sitechat-send"),
    handoffBtn = widgetRoot["querySelector"](".sitechat-handoff-btn"),
    headerCloseBtn = widgetRoot["querySelector"](".sitechat-header-close");
  function isMobileViewport() {
    try {
      return window.matchMedia("(max-width: 900px)").matches;
    } catch (G) {
      return window.innerWidth <= 900;
    }
  }
  function applyMobileViewportOffsets() {
    if (!isMobileViewport()) {
      toggleBtn.style.removeProperty("bottom");
      windowEl.style.removeProperty("bottom");
      if (activeNudgeEl) activeNudgeEl.style.removeProperty("bottom");
      return;
    }
    const G = window.visualViewport;
    const H = G ? Math.max(0, window.innerHeight - (G.height + G.offsetTop)) : 0;
    const I = Math.max(12, 12 + H);
    const J = Math.max(76, 76 + H);
    toggleBtn.style.bottom = "calc(" + I + "px + env(safe-area-inset-bottom, 0px))";
    windowEl.style.bottom = "calc(" + J + "px + env(safe-area-inset-bottom, 0px))";
    if (activeNudgeEl) activeNudgeEl.style.bottom = "calc(" + J + "px + env(safe-area-inset-bottom, 0px))";
  }
  let viewportOffsetRaf = null;
  function scheduleMobileViewportOffsets() {
    if (viewportOffsetRaf) cancelAnimationFrame(viewportOffsetRaf);
    viewportOffsetRaf = requestAnimationFrame(() => {
      viewportOffsetRaf = null, applyMobileViewportOffsets();
    });
  }
  window.addEventListener("resize", scheduleMobileViewportOffsets, {
    passive: true
  }), window.addEventListener("orientationchange", scheduleMobileViewportOffsets, {
    passive: true
  }), window.visualViewport && (window.visualViewport.addEventListener("resize", scheduleMobileViewportOffsets, {
    passive: true
  }), window.visualViewport.addEventListener("scroll", scheduleMobileViewportOffsets, {
    passive: true
  })), scheduleMobileViewportOffsets();
  let chatOpen = false, welcomeRemoved = false, lastMessageIndex = -1;
  toggleBtn["addEventListener"]("click", () => {
    const wasOpen = chatOpen;
    chatOpen = !chatOpen;
    chatOpen && dismissGreeting();
    toggleBtn["classList"]["toggle"]("open", chatOpen);
    windowEl["classList"]["toggle"]("open", chatOpen);
    if (wasOpen && !chatOpen && handoffState.handoffId && (handoffState.mode === "pending" || handoffState.mode === "active")) {
      const Hid = handoffState.handoffId;
      fetch(config.apiUrl + "/api/handoff/" + encodeURIComponent(Hid) + "/abandon", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON["stringify"]({
          session_id: sessionId
        })
      })["catch"](() => {});
      handoff["stopPolling"]();
      handoff["clearHandoffLocal"]();
    }
    if (chatOpen) inputEl["focus"]();
  }), headerCloseBtn && headerCloseBtn["addEventListener"]("click", G => {
    G["stopPropagation"](), chatOpen && toggleBtn["click"]();
  }), handoffBtn["addEventListener"]("click", () => {
    config.handoffEnabled && handoff["requestHandoff"]("user_request");
  }), inputEl["addEventListener"]("input", () => {
    sendBtn["disabled"] = !inputEl["value"]["trim"]();
  }), widgetRoot["addEventListener"]("click", G => {
    const navBtn = G["target"]["closest"](".sitechat-nav-btn");
    if (navBtn) {
      switchWindowView(navBtn["dataset"]["nav"]);
      return;
    }
    const backBtn = G["target"]["closest"](".sitechat-help-back");
    if (backBtn) {
      helpView = currentHelpCategory ? "articles" : "categories";
      if (!currentHelpCategory) helpView = "categories";
      renderHelpView();
      return;
    }
    const catBtn = G["target"]["closest"](".sitechat-help-category");
    if (catBtn) {
      currentHelpCategory = catBtn["dataset"]["slug"];
      helpView = "articles";
      renderHelpView();
      return;
    }
    const artLink = G["target"]["closest"](".sitechat-help-article-link");
    if (artLink) {
      openHelpArticle(artLink["dataset"]["slug"]);
      return;
    }
    const cardBtn = G["target"]["closest"](".sitechat-card-btn");
    if (cardBtn) {
      const action = cardBtn["dataset"]["action"] || "send_message";
      const value = cardBtn["dataset"]["value"] || "";
      if (action === "open_url" && value) {
        window["open"](value, "_blank", "noopener,noreferrer");
      } else if (action === "talk_to_agent") {
        handoff["requestHandoff"](value || "user_request");
      } else if (action === "send_message") {
        const msg = value || cardBtn["textContent"]["trim"]();
        if (msg) {
          inputEl["value"] = msg;
          sendBtn["disabled"] = false;
          inputForm["dispatchEvent"](new Event("submit"));
        }
      }
      return;
    }
    if (G["target"]["classList"]["contains"]("sitechat-suggestion")) {
      const H = G["target"]["dataset"]["query"];
      H && (inputEl["value"] = H, sendBtn["disabled"] = false, inputForm["dispatchEvent"](new Event("submit")));
    }
  }), widgetRoot["addEventListener"]("input", G => {
    if (G["target"]["classList"]["contains"]("sitechat-help-search-input")) {
      if (helpView !== "categories") {
        helpView = "categories";
        currentHelpCategory = null;
      }
      renderHelpView();
    }
  }), widgetRoot["addEventListener"]("click", async G => {
    const H = G["target"]["closest"](".sitechat-feedback-btn");
    if (!H) return;
    const I = H["closest"](".sitechat-feedback"), J = parseInt(I["dataset"]["msgIndex"]), K = H["dataset"]["feedback"];
    I["querySelectorAll"](".sitechat-feedback-btn")["forEach"](L => {
      L["classList"]["remove"]("active", "positive", "negative");
    }), H["classList"]["add"]("active", K);
    try {
      await fetch(config.apiUrl + "/api/chat/feedback?session_id=" + sessionId + "&message_index=" + J + "&feedback=" + K, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        }
      }), setTimeout(() => {
        I["innerHTML"] = '\n          <div class="sitechat-feedback-thanks">\n            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\n              <polyline points="20 6 9 17 4 12"/>\n            </svg>\n            Thanks for your feedback!\n          </div>\n        ';
      }, 300);
    } catch (L) {
      console["error"]("Failed to submit feedback:", L);
    }
  }), inputForm["addEventListener"]("submit", async G => {
    G["preventDefault"]();
    const H = inputEl["value"]["trim"]();
    if (!H) return;
    inputEl["value"] = "", sendBtn["disabled"] = true;
    if (!welcomeRemoved) {
      const J = messagesEl["querySelector"](".sitechat-welcome");
      if (J) J["remove"]();
      welcomeRemoved = true;
    }
    appendMessage(H, "user");
    conversationStarted = true, touchSession(), playSound(config.soundVisitorMessage);
    if (handoffState.mode === "pending" || handoffState.mode === "active") {
      const K = await handoff["sendMessage"](H);
      !K && handoff["addSystemMessage"]("Failed to send message. Please try again.");
      return;
    }
    const typingRow = showTypingIndicator();
    try {
      const L = await fetch(config.apiUrl + "/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON["stringify"]({
          message: H,
          session_id: sessionId,
          site_id: config.siteId
        })
      }), M = await L["json"]();
      typingRow["remove"](), appendMessage(M["answer"] || M["response"] || "No response", "bot", M["sources"]), M["suggest_handoff"] && showHandoffSuggestion(M["handoff_reason"]), appendPostReplyPrompts();
    } catch (N) {
      typingRow["remove"](), appendMessage("Sorry, something went wrong. Please try again.", "bot");
    }
  });
  function appendPostReplyPrompts() {
    if (!config.quickPrompts.enabled || !config.quickPrompts.showAfterResponse) return;
    const suggestions = enabledPrompts().filter(function (p) {
      return (p["type"] || "suggestion") === "suggestion";
    }).slice(0, config.quickPrompts.maxDisplay || 4);
    const cards = enabledPrompts().filter(function (p) {
      return p["type"] === "card";
    });
    if (!suggestions.length && !cards.length) return;

    const wrap = document["createElement"]("div");
    wrap["className"] = "sitechat-post-prompts";
    suggestions.forEach(function (p) {
      const btn = document["createElement"]("button");
      btn["className"] = "sitechat-suggestion";
      btn["dataset"]["query"] = p["text"] || "";
      btn["innerHTML"] = (p["icon"] ? escapeHtml(p["icon"]) + " " : "") + escapeHtml(p["text"] || "");
      wrap["appendChild"](btn);
    });
    cards.forEach(function (p) {
      wrap["appendChild"](buildPromptCard(p));
    });
    messagesEl["appendChild"](wrap);
    messagesEl["scrollTop"] = messagesEl["scrollHeight"];
  }
  function applyHandoffAvailability() {
    if (!config.handoffEnabled && handoffState.mode !== "active" && handoffState.mode !== "pending") {
      const btn = document["querySelector"](".sitechat-handoff-btn");
      btn && (btn["style"]["display"] = "none");
    }
  }
  function showHandoffSuggestion(G) {
    if (!config.handoffEnabled) return;
    const H = document["createElement"]("div");
    H["className"] = "sitechat-handoff-suggestion", H["innerHTML"] = '\n      <p>Would you like to speak with a human agent?</p>\n      <div class="sitechat-handoff-suggestion-buttons">\n        <button class="sitechat-handoff-yes">Yes, connect me</button>\n        <button class="sitechat-handoff-no">No, thanks</button>\n      </div>\n    ', 
    H["querySelector"](".sitechat-handoff-yes")["addEventListener"]("click", () => {
      H["remove"](), handoff["requestHandoff"](G || "ai_suggested");
    }), H["querySelector"](".sitechat-handoff-no")["addEventListener"]("click", () => {
      H["remove"]();
    }), messagesEl["appendChild"](H), messagesEl["scrollTop"] = messagesEl["scrollHeight"];
  }
  function appendMessage(G, H, I = []) {
    lastMessageIndex++;
    H === "bot" && playSound(config.soundAgentMessage);
    const msgIndex = lastMessageIndex, K = document["createElement"]("div");
    K["className"] = "sitechat-message-wrapper " + H;
    const L = document["createElement"]("div");
    L["className"] = "sitechat-avatar " + H;
    H === "bot" ? L["innerHTML"] = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\n        <path d="M12 2L2 7l10 5 10-5-10-5z"/>\n        <path d="M2 17l10 5 10-5"/>\n        <path d="M2 12l10 5 10-5"/>\n      </svg>' : L["textContent"] = "U";
    const M = document["createElement"]("div");
    M["className"] = "sitechat-message-content";
    const N = document["createElement"]("div");
    N["className"] = "sitechat-message " + H;
    let O = G;
    H === "bot" && (O = markdownToHtml(G));
    let P = O;
    config.showSources && I && I["length"] > 0 && (P += '\n        <div class="sitechat-sources">\n          <div class="sitechat-sources-label">\n            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\n              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>\n              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>\n            </svg>\n            Sources\n          </div>\n          <div class="sitechat-sources-list">\n            ' + I["map"](R => '\n              <a href="' + R["url"] + '" target="_blank" class="sitechat-source-link" title="' + R["url"] + '">\n                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\n                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>\n                  <polyline points="15 3 21 3 21 9"/>\n                  <line x1="10" y1="14" x2="21" y2="3"/>\n                </svg>\n                ' + (R["title"] || "Source") + "\n              </a>\n            ")["join"]("") + "\n          </div>\n        </div>\n      ");
    N["innerHTML"] = P, M["appendChild"](N);
    const Q = document["createElement"]("div");
    Q["className"] = "sitechat-message-time", Q["textContent"] = (new Date)["toLocaleTimeString"]([], {
      hour: "2-digit",
      minute: "2-digit"
    }), M["appendChild"](Q);
    if (H === "bot") {
      const R = document["createElement"]("div");
      R["className"] = "sitechat-feedback", R["dataset"]["msgIndex"] = msgIndex, R["innerHTML"] = '\n        <button class="sitechat-feedback-btn" data-feedback="positive" title="Helpful">\n          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\n            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>\n          </svg>\n        </button>\n        <button class="sitechat-feedback-btn" data-feedback="negative" title="Not helpful">\n          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\n            <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>\n          </svg>\n        </button>\n      ', 
      M["appendChild"](R);
    }
    K["appendChild"](L), K["appendChild"](M), messagesEl["appendChild"](K), messagesEl["scrollTop"] = messagesEl["scrollHeight"];
  }
  function markdownToHtml(G) {
    let H = G["replace"](/\*\*(.*?)\*\*/g, "<strong>$1</strong>")["replace"](/`([^`]+)`/g, "<code>$1</code>")["split"]("\n\n")["map"](I => I["trim"]())["filter"](I => I)["map"](I => {
      if (I["match"](/^[\*\-]\s/m)) {
        const J = I["split"]("\n")["map"](K => K["replace"](/^[\*\-]\s/, "")["trim"]())["filter"](K => K);
        return "<ul>" + J["map"](K => "<li>" + K + "</li>")["join"]("") + "</ul>";
      }
      if (I["match"](/^\d+\.\s/m)) {
        const K = I["split"]("\n")["map"](L => L["replace"](/^\d+\.\s/, "")["trim"]())["filter"](L => L);
        return "<ol>" + K["map"](L => "<li>" + L + "</li>")["join"]("") + "</ol>";
      }
      return "<p>" + I["replace"](/\n/g, "<br>") + "</p>";
    })["join"]("");
    return H;
  }
  function showTypingIndicator() {
    const G = document["createElement"]("div");
    G["className"] = "sitechat-typing-wrapper";
    const H = document["createElement"]("div");
    H["className"] = "sitechat-avatar bot", H["innerHTML"] = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\n      <path d="M12 2L2 7l10 5 10-5-10-5z"/>\n      <path d="M2 17l10 5 10-5"/>\n      <path d="M2 12l10 5 10-5"/>\n    </svg>';
    const I = document["createElement"]("div");
    return I["className"] = "sitechat-typing", I["innerHTML"] = "<span></span><span></span><span></span>", G["appendChild"](H), 
    G["appendChild"](I), messagesEl["appendChild"](G), messagesEl["scrollTop"] = messagesEl["scrollHeight"], G;
  }
})();
