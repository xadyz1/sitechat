"""
Pydantic models for API request/response schemas.
"""
import uuid
from datetime import datetime
from typing import List, Literal, Optional, Dict, Any
from pydantic import BaseModel, Field


# ==================== Chat Models ====================

class ChatRequest(BaseModel):
    """Request model for chat endpoint."""
    message: str = Field(..., description="User's message", min_length=1, max_length=4000)
    session_id: str = Field(..., description="Unique session identifier")
    user_id: Optional[str] = Field(None, description="User ID for long-term memory")
    site_id: Optional[str] = Field(None, description="Site ID to filter responses")
    stream: bool = Field(False, description="Whether to stream the response")


class SourceDocument(BaseModel):
    """Source document information."""
    url: str = Field(..., description="Source URL")
    title: str = Field(..., description="Page title")
    content_preview: str = Field(..., description="Preview of matched content")
    relevance_score: float = Field(..., description="Relevance score 0-1")


class ChatResponse(BaseModel):
    """Response model for chat endpoint."""
    answer: str = Field(..., description="The chatbot's answer")
    sources: List[SourceDocument] = Field(default_factory=list, description="Source documents")
    confidence: float = Field(..., description="Confidence score 0-1")
    follow_up_questions: List[str] = Field(default_factory=list, description="Suggested follow-up questions")
    session_id: str = Field(..., description="Session ID")
    tokens_used: Optional[int] = Field(None, description="Number of tokens used")
    suggest_handoff: bool = Field(default=False, description="Whether to suggest human handoff")
    handoff_reason: Optional[str] = Field(None, description="Reason for suggesting handoff")
    products: List[Dict[str, Any]] = Field(default_factory=list, description="Shop products mentioned in the answer")
    cart_actions: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Agent-requested add-to-cart actions: {name, qty, cart_url, product_id, image, price, currency, url} — the widget executes them silently"
    )


# ==================== Crawl Models ====================

class CrawlRequest(BaseModel):
    """Request model for crawl endpoint."""
    url: str = Field(..., description="Target URL to crawl")
    max_pages: int = Field(100, description="Maximum pages to crawl", ge=1, le=1000)
    include_patterns: List[str] = Field(default_factory=list, description="URL patterns to include")
    exclude_patterns: List[str] = Field(default_factory=list, description="URL patterns to exclude")


class CrawlStatus(BaseModel):
    """Status of a crawl job."""
    job_id: str = Field(..., description="Crawl job ID")
    status: str = Field(..., description="Job status: running, completed, failed")
    pages_crawled: int = Field(0, description="Number of pages crawled")
    pages_indexed: int = Field(0, description="Number of pages indexed")
    errors: List[str] = Field(default_factory=list, description="Error messages")
    started_at: datetime = Field(..., description="Job start time")
    completed_at: Optional[datetime] = Field(None, description="Job completion time")


class CrawlResponse(BaseModel):
    """Response model for crawl endpoint."""
    job_id: str = Field(..., description="Crawl job ID")
    message: str = Field(..., description="Status message")
    status: str = Field(..., description="Job status")


# ==================== Page Models ====================

class PageInfo(BaseModel):
    """Information about an indexed page."""
    url: str = Field(..., description="Page URL")
    title: str = Field(..., description="Page title")
    chunk_count: int = Field(0, description="Number of chunks")
    last_crawled: datetime = Field(..., description="Last crawl time")
    status: str = Field(..., description="Page status")


# ==================== Conversation Models ====================

class Message(BaseModel):
    """A single message in a conversation."""
    role: str = Field(..., description="Message role: user or assistant")
    content: str = Field(..., description="Message content")
    sources: List[SourceDocument] = Field(default_factory=list, description="Source documents")
    timestamp: datetime = Field(default_factory=datetime.utcnow, description="Message timestamp")


class ConversationHistory(BaseModel):
    """Conversation history for a session."""
    session_id: str = Field(..., description="Session ID")
    messages: List[Message] = Field(default_factory=list, description="Messages in the conversation")
    created_at: datetime = Field(..., description="Conversation start time")
    updated_at: datetime = Field(..., description="Last update time")


# ==================== Stats Models ====================

class SystemStats(BaseModel):
    """System statistics."""
    total_pages: int = Field(0, description="Total indexed pages")
    total_chunks: int = Field(0, description="Total document chunks")
    total_conversations: int = Field(0, description="Total conversations")
    total_messages: int = Field(0, description="Total messages")
    last_crawl: Optional[datetime] = Field(None, description="Last crawl time")


# ==================== Health Models ====================

class HealthCheck(BaseModel):
    """Health check response."""
    status: str = Field(..., description="Service status")
    mongodb: str = Field(..., description="MongoDB connection status")
    vector_store: str = Field(..., description="Vector store status")
    ollama: str = Field(..., description="Ollama status")


# ==================== Site Configuration Models ====================

class SiteAppearanceConfig(BaseModel):
    """Appearance configuration for the chatbot widget."""
    primary_color: str = Field(default="#7B3DFB", description="Primary color (hex)")
    chat_title: str = Field(default="Chat with us", description="Chat widget title")
    welcome_message: str = Field(default="Hi! How can I help you today?", description="Welcome message")
    welcome_title: str = Field(default="Hi there! 👋", description="Welcome screen heading")
    welcome_icon: str = Field(
        default="default",
        description="Welcome screen icon: default | avatar (agent profile picture) | none (hidden) | image URL"
    )
    welcome_enabled: bool = Field(default=True, description="Show the welcome greeting (icon + title + message); quick prompts still show when off")
    welcome_title_color: Optional[str] = Field(default=None, description="Welcome heading text color (hex), defaults to theme")
    welcome_text_color: Optional[str] = Field(default=None, description="Welcome message text color (hex), defaults to theme")
    bot_avatar_url: Optional[str] = Field(default=None, description="Custom bot avatar URL")
    position: str = Field(default="bottom-right", description="Widget position: bottom-left, bottom-center or bottom-right")
    # White-label options
    hide_branding: bool = Field(default=False, description="Hide 'Powered by SwiftChat' branding")
    custom_branding_text: Optional[str] = Field(default=None, description="Custom branding text (replaces 'Powered by SwiftChat')")
    custom_branding_url: Optional[str] = Field(default=None, description="URL for custom branding link")

    # Agent profile
    agent_caption: str = Field(default="Powered by AI", description="Subtitle/caption under the agent name (e.g. 'Online', 'Disponível')")
    show_online_indicator: bool = Field(default=True, description="Show green online dot on the agent avatar")
    online_indicator_color: str = Field(default="#22C55E", description="Online indicator dot color (hex)")

    # Theme preset — provides palette defaults; explicit colors below override it.
    # light | light_accent | light_soft | pattern_light | pattern_accent | dark
    theme: str = Field(default="light_accent", description="Widget theme preset")

    # Theme colors — None/empty falls back to theme/primary-derived defaults
    header_background: Optional[str] = Field(default=None, description="Header background color (hex), defaults to theme")
    header_text_color: Optional[str] = Field(default=None, description="Header text color (hex), defaults to theme")
    chat_background: Optional[str] = Field(default=None, description="Messages area background (hex), defaults to theme")
    bot_message_background: Optional[str] = Field(default=None, description="Bot bubble background (hex), defaults to theme")
    bot_message_color: Optional[str] = Field(default=None, description="Bot bubble text color (hex), defaults to theme")
    user_message_background: Optional[str] = Field(default=None, description="User bubble background (hex), defaults to primary")
    user_message_color: Optional[str] = Field(default=None, description="User bubble text color (hex), defaults to theme")
    input_background: Optional[str] = Field(default=None, description="Message field background (hex), defaults to theme")
    input_text_color: Optional[str] = Field(default=None, description="Message field text color (hex), defaults to theme")
    input_placeholder: str = Field(default="Type your message...", description="Message field placeholder text")
    send_button_color: Optional[str] = Field(default=None, description="Send button color (hex), defaults to primary")
    launcher_background: Optional[str] = Field(default=None, description="Launcher button background (hex), defaults to primary")
    launcher_icon_color: str = Field(default="#FFFFFF", description="Launcher button icon/text color (hex)")
    border_radius: int = Field(default=16, ge=0, le=28, description="Corner radius (px) for window, bubbles, input and launcher")
    footer_text: Optional[str] = Field(default=None, description="Disclaimer text shown above the branding footer")
    footer_text_color: Optional[str] = Field(default=None, description="Disclaimer/footer text color (hex), defaults to theme muted")
    font_family: Optional[str] = Field(default=None, description="Widget font family (e.g. Inter, Roboto, Poppins)")

    # Layout
    window_width: int = Field(default=400, ge=280, le=640, description="Chat window width in px")
    window_height: int = Field(default=560, ge=320, le=860, description="Chat window height in px")
    launcher_style: str = Field(
        default="button",
        description="Launcher style: button, text_button, agent_profile, quick_input, float_button (float button that opens the chat as a side panel)"
    )
    launcher_text: Optional[str] = Field(default=None, description="Text for text_button/quick_input launchers")
    launcher_icon: Optional[str] = Field(
        default=None,
        description="Launcher icon: built-in name (chat, headset, help, bell, star, bolt, robot, smile) or image URL/data URL"
    )
    launcher_badge: bool = Field(default=False, description="Show a red unread-message count badge on the closed launcher")
    product_price_color: Optional[str] = Field(default=None, description="Product card price/CTA text color (hex), defaults to primary")
    product_button_color: Optional[str] = Field(default=None, description="Product card button color (hex); primary bg and secondary text/border, defaults to primary")
    product_button_text_color: Optional[str] = Field(default=None, description="Product card primary button text color (hex), defaults to white")

    # Placement & offsets (position also accepts: bottom-left, bottom-center, bottom-right)
    offset_x: int = Field(default=24, ge=0, le=200, description="Horizontal offset of the launcher/window in px")
    offset_y: int = Field(default=24, ge=0, le=200, description="Vertical offset of the launcher from the bottom in px")
    movable_window: bool = Field(default=False, description="Let visitors drag and resize the chat window (desktop only)")

    # Start mode & display timing
    start_mode: Literal["button_only", "greeting", "auto_open"] = Field(
        default="button_only",
        description="button_only | greeting = greeting bubble + suggested questions above launcher | auto_open = open chat automatically on desktop"
    )
    greeting_message: Optional[str] = Field(default=None, description="Greeting bubble text shown in greeting start mode")
    start_delay_seconds: int = Field(default=0, ge=0, le=60, description="Delay before the start-mode action runs (0 = on page load)")

    # Sounds — named presets: none, bell, bell2, bright, bright2, bubble, bubble2,
    # click, click2, digital, fantasy, glass, liquid, notes, plucky, soft, soft2
    sound_agent_message: str = Field(default="none", description="Sound played when an agent/bot message arrives")
    sound_visitor_message: str = Field(default="none", description="Sound played when the visitor sends a message")

    # Footer
    footer_enabled: bool = Field(default=True, description="Show the disclaimer footer text in the widget")

    # Custom code injected into the embedded widget (admin-provided)
    custom_css: Optional[str] = Field(default=None, description="Custom CSS applied inside the widget")
    custom_js: Optional[str] = Field(default=None, description="Custom JavaScript executed when the widget loads")


class SiteVisibilitySchedule(BaseModel):
    """Time-based widget visibility window."""
    enabled: bool = Field(default=False, description="Restrict widget visibility to a schedule")
    days: List[int] = Field(
        default_factory=lambda: [1, 2, 3, 4, 5],
        description="Active days, JS getDay() convention: 0=Sunday … 6=Saturday"
    )
    start_time: str = Field(default="09:00", description="Start time HH:MM (24h)")
    end_time: str = Field(default="18:00", description="End time HH:MM (24h); may cross midnight")
    timezone: Optional[str] = Field(default=None, description="IANA timezone (e.g. Europe/Lisbon); empty = visitor local time")


class SiteVisibilityConfig(BaseModel):
    """Where/when the embedded widget is shown."""
    display_pages: Literal["all", "include", "exclude"] = Field(
        default="all",
        description="all = every page; include = only listed patterns; exclude = everywhere except listed"
    )
    page_urls: List[str] = Field(
        default_factory=list,
        description="URL/path patterns, one per entry; '*' matches any characters (e.g. /pricing*, https://example.com/checkout*)"
    )
    devices: Literal["all", "desktop", "mobile"] = Field(default="all", description="Limit widget to a device type")
    schedule: SiteVisibilitySchedule = Field(default_factory=SiteVisibilitySchedule)


class SiteSessionConfig(BaseModel):
    """Chat session persistence for visitors."""
    persist_session: bool = Field(
        default=True,
        description="Keep the conversation across page loads (localStorage). Off = new conversation each visit (sessionStorage)"
    )
    persist_visitor: bool = Field(
        default=True,
        description="Remember visitor stats (page views, triggers) across visits"
    )
    session_timeout_minutes: int = Field(
        default=0,
        ge=0,
        le=10080,
        description="Start a fresh conversation after N minutes of inactivity; 0 = never expire"
    )


class SiteBehaviorConfig(BaseModel):
    """Behavior configuration for the chatbot."""
    system_prompt: str = Field(
        default="You are a helpful assistant. Answer questions based on the provided context.",
        description="System prompt for the AI"
    )
    temperature: float = Field(default=0.7, ge=0.0, le=2.0, description="AI temperature (0-2)")
    max_tokens: int = Field(default=500, ge=50, le=4000, description="Maximum tokens in response")
    show_sources: bool = Field(default=True, description="Show source citations")
    product_cards: bool = Field(default=True, description="Render product cards for shop items mentioned in replies")
    shop_platform: Literal["auto", "woocommerce", "shopify", "custom", "none"] = Field(
        default="auto",
        description="Shop platform for add-to-cart buttons: auto-detected, woocommerce, shopify, custom template or none"
    )
    cart_url_template: Optional[str] = Field(
        default=None,
        description="Custom add-to-cart URL template with {id} {qty} {url} {eurl} {base} {name} placeholders (used when shop_platform=custom, or as fallback); {url}=raw product URL, {eurl}=URL-encoded"
    )
    cart_button_label: str = Field(default="Add to cart", description="Label for the add-to-cart button on product cards")
    order_lookup_enabled: bool = Field(default=False, description="Fetch live order status when the visitor mentions an order reference")
    order_lookup_url: Optional[str] = Field(
        default=None,
        description="Order-status endpoint URL template with {ref} placeholder, e.g. https://shop.example/api/track?ref={ref}"
    )
    order_ref_pattern: Optional[str] = Field(
        default=None,
        description="Regex to extract order references from messages (default matches e.g. SP-75115C)"
    )


class SiteLeadCaptureConfig(BaseModel):
    """Lead capture configuration."""
    collect_email: bool = Field(default=False, description="Collect visitor email")
    email_required: bool = Field(default=False, description="Make email required")
    email_prompt: str = Field(default="Enter your email to continue", description="Email prompt text")
    collect_name: bool = Field(default=False, description="Collect visitor name")
    name_required: bool = Field(default=False, description="Make name required")
    capture_timing: str = Field(
        default="before_chat",
        description="When to capture: before_chat, after_messages, on_handoff"
    )
    messages_before_capture: int = Field(
        default=3,
        ge=1,
        le=20,
        description="Number of messages before showing capture form (for after_messages timing)"
    )


class SiteSecurityConfig(BaseModel):
    """Security configuration for the widget."""
    allowed_domains: List[str] = Field(
        default_factory=list,
        description="List of allowed domains (empty = allow all). Supports wildcards like *.example.com"
    )
    enforce_domain_validation: bool = Field(
        default=False,
        description="Whether to enforce domain validation (reject requests from non-whitelisted domains)"
    )
    require_referrer: bool = Field(
        default=False,
        description="Require a valid Referer header for widget API calls"
    )
    rate_limit_per_session: int = Field(
        default=60,
        ge=1,
        le=1000,
        description="Maximum requests per session per minute"
    )


class QuickPromptButton(BaseModel):
    """A button inside a card prompt."""
    label: str = Field(..., description="Button text", max_length=60)
    action: Literal["send_message", "open_url", "open_url_modal", "talk_to_agent"] = Field(
        default="send_message",
        description="Button action: send_message | open_url | open_url_modal | talk_to_agent"
    )
    value: Optional[str] = Field(
        default=None,
        description="Message to send (send_message), URL (open_url), URL or iframe embed code (open_url_modal); optional for talk_to_agent"
    )


class QuickPrompt(BaseModel):
    """A single quick prompt — either a suggestion chip or an action card."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8], description="Unique prompt ID")
    type: Literal["suggestion", "card"] = Field(default="suggestion", description="Display type: suggestion | card")
    text: str = Field(..., description="The prompt text displayed to user (card title for cards)", max_length=100)
    icon: Optional[str] = Field(default=None, description="Optional emoji or icon")
    enabled: bool = Field(default=True, description="Whether this prompt is active")
    # Card fields (type == "card")
    description: Optional[str] = Field(default=None, description="Card description text", max_length=300)
    image_url: Optional[str] = Field(default=None, description="Optional card image/icon URL")
    buttons: List[QuickPromptButton] = Field(default_factory=list, description="Card action buttons")


class SiteQuickPromptsConfig(BaseModel):
    """Quick prompts/FAQ starters configuration."""
    enabled: bool = Field(default=True, description="Show quick prompts in widget")
    prompts: List[QuickPrompt] = Field(
        default_factory=lambda: [
            QuickPrompt(text="What can you help me with?", icon="💡"),
            QuickPrompt(text="How do I get started?", icon="🚀"),
            QuickPrompt(text="Tell me about pricing", icon="💰")
        ],
        description="List of quick prompts"
    )
    show_after_response: bool = Field(default=False, description="Also show prompts after bot responses")
    max_display: int = Field(default=4, ge=1, le=10, description="Maximum prompts to display")


class HelpCenterSocialLink(BaseModel):
    """A social link shown in the portal footer."""
    network: str = Field(..., description="Network name, e.g. linkedin, twitter, github", max_length=30)
    handle: str = Field(..., description="Handle or full URL", max_length=200)


class SiteHelpCenterConfig(BaseModel):
    """Help center configuration — syncs articles into the widget and public portal."""
    enabled: bool = Field(default=False, description="Show the Help tab in the widget")
    portal_url: Optional[str] = Field(
        default=None,
        description="Public help center portal URL to sync articles from (e.g. https://chat.swiftapps.cloud/hc/concha-ai/en)"
    )
    tab_label: str = Field(default="Help", description="Widget tab label")
    # Portal (public /hc/{slug-or-site-id} page)
    portal_title: Optional[str] = Field(default=None, description="Browser page title, e.g. 'Concha AI | Help Center'")
    portal_name: Optional[str] = Field(default=None, description="Portal brand name shown in the header")
    header_text: Optional[str] = Field(default=None, description="Portal heading, e.g. 'Support Portal'")
    home_page_link: Optional[str] = Field(default=None, description="'Website' link shown in the portal nav")
    slug: Optional[str] = Field(default=None, description="Custom public slug — /hc/{slug} (defaults to site_id)")
    brand_color: Optional[str] = Field(default=None, description="Portal accent color, e.g. #007D45")
    logo_url: Optional[str] = Field(default=None, description="Portal logo image URL")
    layout: Literal["classic", "documentation"] = Field(default="documentation", description="Portal layout")
    social_links: List[HelpCenterSocialLink] = Field(default_factory=list, description="Footer social links")
    embed_widget: bool = Field(default=True, description="Embed the site chat widget on portal pages")
    locales: List[str] = Field(default_factory=lambda: ["pt"], description="Portal languages, e.g. ['en','pt']")
    default_locale: str = Field(default="pt", description="Default portal language")
    custom_domain: Optional[str] = Field(
        default=None,
        description="Custom domain serving this help center (e.g. help.example.com) via DNS CNAME"
    )


class SiteNotificationsConfig(BaseModel):
    """Push notification configuration (OneSignal) for a site/channel."""
    enabled: bool = Field(default=False, description="Send push notifications for this site")
    onesignal_app_id: Optional[str] = Field(default=None, description="OneSignal App ID for this channel")
    onesignal_rest_api_key: Optional[str] = Field(default=None, description="OneSignal REST API key (server-side only)")
    notify_new_message: bool = Field(default=True, description="Notify on new visitor message/conversation")
    notify_new_lead: bool = Field(default=True, description="Notify when a lead is captured")
    notify_handoff: bool = Field(default=True, description="Notify when a visitor requests a human agent")


class SiteHandoffPublicConfig(BaseModel):
    """Public handoff availability exposed to the widget."""
    enabled: bool = Field(default=True, description="Human handoff toggle")
    has_agents: bool = Field(default=False, description="Whether any human agents are assigned to the site")


class SiteContentConfig(BaseModel):
    """AI content pipeline — scheduled drafts, manual approval, API publish."""
    enabled: bool = Field(default=False, description="Enable scheduled content generation")
    publish_url: Optional[str] = Field(
        default=None,
        description="Endpoint that receives approved posts (POST JSON, Bearer auth)"
    )
    publish_secret: Optional[str] = Field(
        default=None,
        description="Bearer token sent to publish_url — never exposed publicly"
    )
    author_name: str = Field(default="AI Writer", description="Byline sent with published posts")
    voice_instructions: Optional[str] = Field(
        default=None,
        description="Standing brief: brand voice, language, audience, rules for every post"
    )


class ContentPostCreate(BaseModel):
    """Queue a post for scheduled drafting."""
    brief: str = Field(..., min_length=3, max_length=4000, description="Topic/brief for the post")
    instructions: Optional[str] = Field(None, max_length=2000, description="Extra instructions for this post only")
    scheduled_at: Optional[datetime] = Field(None, description="When to draft it (UTC); null/blank = draft immediately")


class ContentPostUpdate(BaseModel):
    """Edit a queued post or its draft."""
    brief: Optional[str] = Field(None, min_length=3, max_length=4000)
    instructions: Optional[str] = Field(None, max_length=2000)
    scheduled_at: Optional[datetime] = None
    title: Optional[str] = Field(None, max_length=300)
    draft_html: Optional[str] = Field(None, max_length=200000)
    image_url: Optional[str] = Field(None, max_length=2000)


class ContentPost(BaseModel):
    """A scheduled/generated post for a site."""
    post_id: str
    site_id: str
    brief: str
    instructions: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    status: str = "scheduled"  # scheduled|drafting|pending_review|publishing|published|rejected|failed
    title: Optional[str] = None
    summary: Optional[str] = None
    draft_html: Optional[str] = None
    meta_description: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    image_url: Optional[str] = None
    error: Optional[str] = None
    published_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class SiteConfig(BaseModel):
    """Complete site configuration."""
    appearance: SiteAppearanceConfig = Field(default_factory=SiteAppearanceConfig)
    handoff: SiteHandoffPublicConfig = Field(default_factory=SiteHandoffPublicConfig)
    behavior: SiteBehaviorConfig = Field(default_factory=SiteBehaviorConfig)
    lead_capture: SiteLeadCaptureConfig = Field(default_factory=SiteLeadCaptureConfig)
    security: SiteSecurityConfig = Field(default_factory=SiteSecurityConfig)
    quick_prompts: SiteQuickPromptsConfig = Field(default_factory=SiteQuickPromptsConfig)
    help_center: SiteHelpCenterConfig = Field(default_factory=SiteHelpCenterConfig)
    visibility: SiteVisibilityConfig = Field(default_factory=SiteVisibilityConfig)
    session: SiteSessionConfig = Field(default_factory=SiteSessionConfig)


class SiteConfigUpdate(BaseModel):
    """Update model for site configuration (all fields optional)."""
    appearance: Optional[SiteAppearanceConfig] = None
    behavior: Optional[SiteBehaviorConfig] = None
    lead_capture: Optional[SiteLeadCaptureConfig] = None
    security: Optional[SiteSecurityConfig] = None
    quick_prompts: Optional[SiteQuickPromptsConfig] = None
    help_center: Optional[SiteHelpCenterConfig] = None
    visibility: Optional[SiteVisibilityConfig] = None
    session: Optional[SiteSessionConfig] = None


# ==================== Lead Models ====================

class Lead(BaseModel):
    """A captured lead from the chat widget."""
    id: Optional[str] = Field(None, description="Unique lead ID")
    site_id: str = Field(..., description="Site ID")
    session_id: str = Field(..., description="Chat session ID")
    email: Optional[str] = Field(None, description="Visitor email")
    name: Optional[str] = Field(None, description="Visitor name")
    captured_at: datetime = Field(default_factory=datetime.utcnow, description="Capture timestamp")
    source: str = Field(default="chat", description="Capture source: chat, handoff, proactive")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata")


class LeadCreate(BaseModel):
    """Request model for capturing a lead."""
    site_id: str = Field(..., description="Site ID")
    session_id: str = Field(..., description="Chat session ID")
    email: Optional[str] = Field(None, description="Visitor email")
    name: Optional[str] = Field(None, description="Visitor name")
    source: str = Field(default="chat", description="Capture source")
    # Honeypot — must be empty; bots tend to fill every field
    website: Optional[str] = Field(None, description="Leave blank")


class LeadListItem(BaseModel):
    """Lead item for list view."""
    id: str = Field(..., description="Lead ID")
    site_id: str = Field(..., description="Site ID")
    session_id: str = Field(..., description="Session ID")
    email: Optional[str] = Field(None)
    name: Optional[str] = Field(None)
    captured_at: datetime = Field(...)
    source: str = Field(...)


class LeadListResponse(BaseModel):
    """Paginated response for leads list."""
    leads: List[LeadListItem] = Field(default_factory=list)
    total: int = Field(0, description="Total count")
    page: int = Field(1, description="Current page")
    limit: int = Field(20, description="Items per page")
    total_pages: int = Field(0, description="Total pages")


# ==================== Conversation Management Models ====================

class ConversationListItem(BaseModel):
    """Summary item for conversation list view."""
    session_id: str = Field(..., description="Session ID")
    site_id: Optional[str] = Field(None, description="Site ID")
    created_at: datetime = Field(..., description="Conversation start time")
    updated_at: datetime = Field(..., description="Last update time")
    message_count: int = Field(0, description="Total messages in conversation")
    first_message: str = Field("", description="Preview of first message")
    status: str = Field("open", description="Status: open, resolved, closed")
    priority: str = Field("medium", description="Priority: high, medium, low")
    tags: List[str] = Field(default_factory=list)
    unread: bool = Field(True)
    visitor_name: Optional[str] = Field(None)
    visitor_email: Optional[str] = Field(None)
    satisfaction_rating: Optional[int] = Field(None)
    sentiment: Optional[float] = Field(None)


class ConversationSearchItem(ConversationListItem):
    """Search result item with matching snippet."""
    matching_snippet: str = Field("", description="Matching text snippet")


class ConversationStats(BaseModel):
    """Statistics for a conversation."""
    message_count: int = Field(0, description="Total messages")
    user_messages: int = Field(0, description="User messages count")
    assistant_messages: int = Field(0, description="Assistant messages count")
    positive_feedback: int = Field(0, description="Positive feedback count")
    negative_feedback: int = Field(0, description="Negative feedback count")
    avg_response_time_ms: float = Field(0, description="Average response time in ms")
    first_response_time_ms: Optional[int] = Field(None)
    resolution_time_ms: Optional[int] = Field(None)


class MessageDetail(BaseModel):
    """Detailed message for transcript view."""
    role: str = Field(..., description="Message role: user or assistant")
    content: str = Field(..., description="Message content")
    sources: List[Dict[str, Any]] = Field(default_factory=list, description="Source documents")
    timestamp: datetime = Field(..., description="Message timestamp")
    feedback: Optional[str] = Field(None, description="User feedback if any")
    feedback_at: Optional[datetime] = Field(None, description="Feedback timestamp")
    response_time_ms: Optional[int] = Field(None, description="Response time in ms")


class ConversationNote(BaseModel):
    """An internal note on a conversation."""
    note_id: str
    content: str
    created_at: datetime
    updated_at: datetime


class ConversationDetail(BaseModel):
    """Full conversation detail with all messages."""
    session_id: str = Field(..., description="Session ID")
    site_id: Optional[str] = Field(None, description="Site ID")
    created_at: datetime = Field(..., description="Conversation start time")
    updated_at: datetime = Field(..., description="Last update time")
    messages: List[MessageDetail] = Field(default_factory=list, description="All messages")
    stats: ConversationStats = Field(default_factory=ConversationStats, description="Conversation stats")
    status: str = Field("open")
    priority: str = Field("medium")
    tags: List[str] = Field(default_factory=list)
    unread: bool = Field(True)
    visitor_name: Optional[str] = Field(None)
    visitor_email: Optional[str] = Field(None)
    page_url: Optional[str] = Field(None)
    notes: List[ConversationNote] = Field(default_factory=list)
    first_response_at: Optional[datetime] = Field(None)
    resolved_at: Optional[datetime] = Field(None)
    satisfaction_rating: Optional[int] = Field(None)
    sentiment: Optional[float] = Field(None)


class ConversationListResponse(BaseModel):
    """Paginated response for conversation list."""
    conversations: List[ConversationListItem] = Field(default_factory=list)
    total: int = Field(0, description="Total count")
    page: int = Field(1, description="Current page")
    limit: int = Field(20, description="Items per page")
    total_pages: int = Field(0, description="Total pages")


class ConversationSearchResponse(BaseModel):
    """Search results response."""
    conversations: List[ConversationSearchItem] = Field(default_factory=list)
    total: int = Field(0, description="Total matches")
    page: int = Field(1, description="Current page")
    limit: int = Field(20, description="Items per page")
    total_pages: int = Field(0, description="Total pages")
    query: str = Field("", description="Search query")


class BulkDeleteRequest(BaseModel):
    """Request model for bulk delete."""
    session_ids: List[str] = Field(..., description="Session IDs to delete", min_length=1)


class BulkDeleteResponse(BaseModel):
    """Response model for bulk delete."""
    deleted_count: int = Field(0, description="Number of conversations deleted")
    message: str = Field("", description="Status message")


class ExportRequest(BaseModel):
    """Request model for conversation export."""
    session_ids: Optional[List[str]] = Field(None, description="Specific session IDs to export")
    site_id: Optional[str] = Field(None, description="Export all from site")
    format: str = Field("json", description="Export format: json or csv")


class UpdateStatusRequest(BaseModel):
    status: str = Field(..., description="open, resolved, closed")


class UpdatePriorityRequest(BaseModel):
    priority: str = Field(..., description="high, medium, low")


class UpdateTagsRequest(BaseModel):
    tags: List[str] = Field(default_factory=list)


class AddNoteRequest(BaseModel):
    content: str = Field(..., min_length=1)


class UpdateNoteRequest(BaseModel):
    content: str = Field(..., min_length=1)


class UpdateVisitorRequest(BaseModel):
    visitor_name: Optional[str] = None
    visitor_email: Optional[str] = None


class SetRatingRequest(BaseModel):
    rating: int = Field(..., ge=1, le=5)


class AutoCloseRequest(BaseModel):
    days_inactive: int = Field(7, ge=1, description="Close conversations inactive for this many days")


class AutoCloseResponse(BaseModel):
    closed_count: int
    message: str


# ==================== Proactive Chat Trigger Models ====================

class TriggerCondition(BaseModel):
    """A single condition for a proactive chat trigger."""
    type: str = Field(..., description="Condition type: time, scroll, exit_intent, url, visit_count")
    value: Any = Field(..., description="Condition value (seconds, percentage, URL pattern, count)")
    operator: str = Field(default="gte", description="Comparison operator: eq, gte, lte, contains, matches")


class ChatTrigger(BaseModel):
    """A proactive chat trigger configuration."""
    id: str = Field(..., description="Unique trigger ID")
    name: str = Field(..., description="Trigger name for display")
    enabled: bool = Field(default=True, description="Whether trigger is active")
    priority: int = Field(default=0, description="Priority order (higher = check first)")
    conditions: List[TriggerCondition] = Field(default_factory=list, description="Conditions that must all match")
    message: str = Field(..., description="Proactive message to display")
    delay_after_trigger_ms: int = Field(default=0, description="Delay before showing message")
    show_once_per_session: bool = Field(default=True, description="Only show once per session")
    show_once_per_visitor: bool = Field(default=False, description="Only show once per visitor (cookie-based)")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Creation timestamp")
    updated_at: datetime = Field(default_factory=datetime.utcnow, description="Last update timestamp")


class ChatTriggerCreate(BaseModel):
    """Request model for creating a trigger."""
    name: str = Field(..., description="Trigger name", min_length=1, max_length=100)
    enabled: bool = Field(default=True, description="Whether trigger is active")
    priority: int = Field(default=0, description="Priority order")
    conditions: List[TriggerCondition] = Field(..., description="Trigger conditions", min_length=1)
    message: str = Field(..., description="Message to display", min_length=1, max_length=500)
    delay_after_trigger_ms: int = Field(default=0, ge=0, le=60000, description="Delay in ms")
    show_once_per_session: bool = Field(default=True)
    show_once_per_visitor: bool = Field(default=False)


class ChatTriggerUpdate(BaseModel):
    """Request model for updating a trigger (all fields optional)."""
    name: Optional[str] = Field(None, max_length=100)
    enabled: Optional[bool] = None
    priority: Optional[int] = None
    conditions: Optional[List[TriggerCondition]] = None
    message: Optional[str] = Field(None, max_length=500)
    delay_after_trigger_ms: Optional[int] = Field(None, ge=0, le=60000)
    show_once_per_session: Optional[bool] = None
    show_once_per_visitor: Optional[bool] = None


class SiteTriggers(BaseModel):
    """Container for all triggers of a site."""
    triggers: List[ChatTrigger] = Field(default_factory=list, description="List of triggers")
    global_cooldown_ms: int = Field(default=30000, description="Min time between any triggers")


class TriggerReorderRequest(BaseModel):
    """Request model for reordering triggers."""
    trigger_ids: List[str] = Field(..., description="Trigger IDs in desired order")


class TriggerEvent(BaseModel):
    """A trigger event for analytics."""
    site_id: str = Field(..., description="Site ID")
    trigger_id: str = Field(..., description="Trigger ID")
    session_id: str = Field(..., description="Session ID")
    event_type: str = Field(..., description="Event type: shown, clicked, dismissed, converted")
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional event data")


class TriggerAnalytics(BaseModel):
    """Analytics summary for a trigger."""
    trigger_id: str = Field(..., description="Trigger ID")
    trigger_name: str = Field(..., description="Trigger name")
    shown_count: int = Field(0, description="Times shown")
    clicked_count: int = Field(0, description="Times clicked to open chat")
    dismissed_count: int = Field(0, description="Times dismissed")
    converted_count: int = Field(0, description="Times led to conversation")
    click_rate: float = Field(0, description="Click rate percentage")
    conversion_rate: float = Field(0, description="Conversion rate percentage")


class TriggerAnalyticsResponse(BaseModel):
    """Response for trigger analytics endpoint."""
    site_id: str = Field(..., description="Site ID")
    period_days: int = Field(7, description="Analytics period in days")
    triggers: List[TriggerAnalytics] = Field(default_factory=list)
    total_shown: int = Field(0)
    total_clicked: int = Field(0)
    total_converted: int = Field(0)


# ==================== Human Handoff Models ====================

class DaySchedule(BaseModel):
    """Business hours for a single day."""
    enabled: bool = Field(default=True, description="Whether this day is a working day")
    start: str = Field(default="09:00", description="Start time (HH:MM)")
    end: str = Field(default="17:00", description="End time (HH:MM)")


class BusinessHoursConfig(BaseModel):
    """Business hours configuration for human handoff."""
    enabled: bool = Field(default=False, description="Whether business hours are enforced")
    timezone: str = Field(default="UTC", description="Timezone for business hours")
    schedule: Dict[str, DaySchedule] = Field(
        default_factory=lambda: {
            "mon": DaySchedule(),
            "tue": DaySchedule(),
            "wed": DaySchedule(),
            "thu": DaySchedule(),
            "fri": DaySchedule(),
            "sat": DaySchedule(enabled=False),
            "sun": DaySchedule(enabled=False),
        },
        description="Weekly schedule"
    )
    offline_message: str = Field(
        default="We're currently offline. Leave your email and we'll get back to you.",
        description="Message shown when outside business hours"
    )


class HandoffConfig(BaseModel):
    """Handoff configuration for a site."""
    enabled: bool = Field(default=True, description="Whether handoff is enabled")
    confidence_threshold: float = Field(
        default=0.3, ge=0.0, le=1.0,
        description="Suggest handoff when AI confidence is below this"
    )
    business_hours: BusinessHoursConfig = Field(default_factory=BusinessHoursConfig)
    auto_suggest_phrases: List[str] = Field(
        default_factory=lambda: [
            "I'm not sure",
            "I don't have information",
            "I cannot help with",
            "please contact support"
        ],
        description="Phrases that trigger handoff suggestion"
    )


class HandoffMessage(BaseModel):
    """A single message in a handoff conversation."""
    id: str = Field(..., description="Unique message ID")
    role: str = Field(..., description="Message role: visitor or agent")
    content: str = Field(..., description="Message content")
    sender_name: Optional[str] = Field(None, description="Sender's display name")
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class HandoffSession(BaseModel):
    """Full handoff session data."""
    handoff_id: str = Field(..., description="Unique handoff ID")
    session_id: str = Field(..., description="Original chat session ID")
    site_id: str = Field(..., description="Associated site ID")
    status: str = Field(default="pending", description="Status: pending, active, resolved, abandoned")
    visitor_email: Optional[str] = Field(None, description="Visitor's email if provided")
    visitor_name: Optional[str] = Field(None, description="Visitor's name if provided")
    reason: str = Field(default="user_request", description="Handoff reason: user_request, low_confidence, ai_suggested")
    ai_summary: Optional[str] = Field(None, description="AI-generated conversation summary")
    ai_conversation: List[Dict[str, Any]] = Field(default_factory=list, description="Previous AI conversation")
    messages: List[HandoffMessage] = Field(default_factory=list, description="Human agent conversation")
    assigned_agent_id: Optional[str] = Field(None, description="Assigned agent's user ID")
    assigned_agent_name: Optional[str] = Field(None, description="Assigned agent's display name")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    resolved_at: Optional[datetime] = Field(None, description="When the handoff was resolved")


class HandoffRequest(BaseModel):
    """Request model for creating a handoff."""
    session_id: str = Field(..., description="Chat session ID")
    site_id: str = Field(..., description="Site ID")
    reason: str = Field(default="user_request", description="Handoff reason")
    visitor_email: Optional[str] = Field(None, description="Visitor's email")
    visitor_name: Optional[str] = Field(None, description="Visitor's name")
    ai_conversation: List[Dict[str, Any]] = Field(default_factory=list, description="Previous AI conversation")
    # Honeypot — must be empty; bots tend to fill every field
    website: Optional[str] = Field(None, description="Leave blank")


class HandoffMessageRequest(BaseModel):
    """Request model for sending a handoff message."""
    content: str = Field(..., description="Message content", min_length=1, max_length=4000)
    sender_name: Optional[str] = Field(None, description="Sender's display name")


class HandoffAbandonRequest(BaseModel):
    """Visitor abandons handoff (widget); session_id must match the handoff."""
    session_id: str = Field(..., min_length=1, description="Widget session ID that created the handoff")


class HandoffStatusUpdate(BaseModel):
    """Request model for updating handoff status."""
    status: str = Field(..., description="New status: active, resolved, abandoned")
    resolution_note: Optional[str] = Field(None, description="Note about resolution")


class HandoffAssignRequest(BaseModel):
    """Admin assigns a support agent to a handoff (pending or active)."""
    agent_id: str = Field(..., min_length=1, description="User ID of the support agent")


class HandoffListItem(BaseModel):
    """Summary item for handoff queue."""
    handoff_id: str = Field(..., description="Handoff ID")
    session_id: str = Field(..., description="Original session ID")
    site_id: str = Field(..., description="Site ID")
    status: str = Field(..., description="Current status")
    visitor_email: Optional[str] = Field(None)
    visitor_name: Optional[str] = Field(None)
    reason: str = Field(...)
    message_count: int = Field(0, description="Number of messages")
    last_message_preview: str = Field("", description="Preview of last message")
    assigned_agent_id: Optional[str] = Field(
        None,
        description="Admin routing hint while pending; queue still visible to all agents on the site until claimed",
    )
    assigned_agent_name: Optional[str] = Field(None)
    created_at: datetime = Field(...)
    updated_at: datetime = Field(...)
    wait_time_seconds: int = Field(0, description="Time waiting for agent")
    visitor_queue_signals: int = Field(
        0,
        description="Increments when visitor taps connect-again while still pending (dashboard highlight)",
    )


class HandoffQueueResponse(BaseModel):
    """Response for handoff queue endpoint."""
    handoffs: List[HandoffListItem] = Field(default_factory=list)
    total: int = Field(0)
    pending_count: int = Field(0, description="Number of pending handoffs")
    active_count: int = Field(0, description="Number of active handoffs")


class HandoffAvailabilityResponse(BaseModel):
    """Response for availability check."""
    available: bool = Field(..., description="Whether agents are available")
    is_within_hours: bool = Field(..., description="Whether within business hours")
    offline_message: Optional[str] = Field(None, description="Message to show if offline")
    next_available: Optional[str] = Field(None, description="When agents will be available next")


# ==================== Crawl Schedule Models ====================

class CrawlScheduleConfig(BaseModel):
    """Configuration for scheduled re-crawling of a site."""
    enabled: bool = Field(default=False, description="Whether scheduled crawling is enabled")
    frequency: str = Field(
        default="weekly",
        description="Crawl frequency: daily, weekly, monthly, custom"
    )
    custom_cron: Optional[str] = Field(
        default=None,
        description="Custom cron expression (e.g., '0 2 * * 0' for Sundays at 2 AM)"
    )
    max_pages: int = Field(default=50, ge=1, le=1000, description="Maximum pages to crawl")
    include_patterns: List[str] = Field(default_factory=list, description="URL patterns to include")
    exclude_patterns: List[str] = Field(default_factory=list, description="URL patterns to exclude")
    notify_on_completion: bool = Field(default=True, description="Send notification when crawl completes")
    last_crawl_at: Optional[datetime] = Field(default=None, description="Last crawl timestamp")
    next_crawl_at: Optional[datetime] = Field(default=None, description="Next scheduled crawl")


class CrawlScheduleUpdate(BaseModel):
    """Update model for crawl schedule (all fields optional)."""
    enabled: Optional[bool] = None
    frequency: Optional[str] = None
    custom_cron: Optional[str] = None
    max_pages: Optional[int] = Field(default=None, ge=1, le=1000)
    include_patterns: Optional[List[str]] = None
    exclude_patterns: Optional[List[str]] = None
    notify_on_completion: Optional[bool] = None


class CrawlHistoryItem(BaseModel):
    """A single crawl history entry."""
    job_id: str = Field(..., description="Crawl job ID")
    status: str = Field(..., description="Job status: running, completed, failed")
    pages_crawled: int = Field(default=0, description="Number of pages crawled")
    pages_indexed: int = Field(default=0, description="Number of pages indexed")
    errors: List[str] = Field(default_factory=list, description="Error messages")
    trigger: str = Field(default="manual", description="Trigger type: manual, scheduled")
    started_at: datetime = Field(..., description="Job start time")
    completed_at: Optional[datetime] = Field(default=None, description="Job completion time")
    duration_seconds: Optional[int] = Field(default=None, description="Job duration in seconds")


class CrawlHistoryResponse(BaseModel):
    """Response for crawl history endpoint."""
    site_id: str = Field(..., description="Site ID")
    history: List[CrawlHistoryItem] = Field(default_factory=list)
    total: int = Field(default=0, description="Total crawl jobs")


class CrawlScheduleResponse(BaseModel):
    """Response for crawl schedule endpoint."""
    site_id: str = Field(..., description="Site ID")
    schedule: CrawlScheduleConfig = Field(default_factory=CrawlScheduleConfig)
    is_crawling: bool = Field(default=False, description="Whether a crawl is currently running")
    last_crawl_status: Optional[str] = Field(default=None, description="Last crawl job status")


# ==================== White-label / Platform Settings Models ====================

class PlatformWhiteLabelConfig(BaseModel):
    """Platform-level white-label configuration for dashboard."""
    app_name: str = Field(default="SwiftChat", description="Application name")
    logo_url: Optional[str] = Field(default=None, description="Custom logo URL")
    favicon_url: Optional[str] = Field(default=None, description="Custom favicon URL")
    primary_color: str = Field(default="#7B3DFB", description="Primary brand color")
    secondary_color: str = Field(default="#EC1DC9", description="Secondary brand color")
    login_title: str = Field(default="SwiftChat", description="Login page title")
    login_subtitle: str = Field(default="AI-Powered Customer Support", description="Login page subtitle")
    footer_text: Optional[str] = Field(default=None, description="Custom footer text")
    support_email: Optional[str] = Field(default=None, description="Support email address")
    hide_sitechat_branding: bool = Field(default=False, description="Hide all SwiftChat branding")


class PlatformWhiteLabelUpdate(BaseModel):
    """Update model for platform white-label settings."""
    app_name: Optional[str] = None
    logo_url: Optional[str] = None
    favicon_url: Optional[str] = None
    primary_color: Optional[str] = None
    secondary_color: Optional[str] = None
    login_title: Optional[str] = None
    login_subtitle: Optional[str] = None
    footer_text: Optional[str] = None
    support_email: Optional[str] = None
    hide_sitechat_branding: Optional[bool] = None


# ==================== Q&A Training Models ====================

class QAPair(BaseModel):
    """A Q&A pair for training and improving responses."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="Unique Q&A pair ID")
    site_id: str = Field(..., description="Associated site")
    question: str = Field(..., description="The question", min_length=1, max_length=1000)
    answer: str = Field(..., description="The approved answer", min_length=1, max_length=4000)
    source_session_id: Optional[str] = Field(None, description="Session this was created from")
    source_message_index: Optional[int] = Field(None, description="Original message index")
    created_by: str = Field(..., description="User who created this")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    enabled: bool = Field(default=True, description="Whether this Q&A is active")
    use_count: int = Field(default=0, description="Times this Q&A was used in responses")


class QAPairCreate(BaseModel):
    """Request model for creating a Q&A pair."""
    question: str = Field(..., min_length=1, max_length=1000)
    answer: str = Field(..., min_length=1, max_length=4000)
    source_session_id: Optional[str] = None
    source_message_index: Optional[int] = None


class QAPairUpdate(BaseModel):
    """Request model for updating a Q&A pair."""
    question: Optional[str] = Field(None, max_length=1000)
    answer: Optional[str] = Field(None, max_length=4000)
    enabled: Optional[bool] = None


class QAPairFromConversation(BaseModel):
    """Request model for creating a Q&A pair from a conversation message."""
    session_id: str = Field(..., description="The conversation session ID")
    message_index: int = Field(..., description="The index of the assistant message")
    edited_answer: Optional[str] = Field(None, max_length=4000, description="Optional edited answer")


class QAPairListItem(BaseModel):
    """Q&A pair item for list view."""
    id: str = Field(..., description="Q&A pair ID")
    site_id: str = Field(..., description="Site ID")
    question: str = Field(..., description="Question preview")
    answer: str = Field(..., description="Answer preview")
    enabled: bool = Field(default=True)
    use_count: int = Field(default=0)
    created_at: datetime = Field(...)
    updated_at: datetime = Field(...)


class QAPairListResponse(BaseModel):
    """Paginated response for Q&A pairs list."""
    qa_pairs: List[QAPairListItem] = Field(default_factory=list)
    total: int = Field(0, description="Total count")
    page: int = Field(1, description="Current page")
    limit: int = Field(20, description="Items per page")
    total_pages: int = Field(0, description="Total pages")


class QAStats(BaseModel):
    """Statistics for Q&A pairs."""
    total_pairs: int = Field(0, description="Total Q&A pairs")
    enabled_pairs: int = Field(0, description="Enabled Q&A pairs")
    total_uses: int = Field(0, description="Total times Q&A pairs were used")
    most_used: List[Dict[str, Any]] = Field(default_factory=list, description="Most used Q&A pairs")
