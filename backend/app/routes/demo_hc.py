"""SwiftChat's own Help Center at /hc — renders the real portal templates
with built-in content so it works on every deployment without DB seeding.
`?template=classic|modern` lets visitors preview both layouts."""
import re
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
import os

router = APIRouter(tags=["Help Center Demo"])

_templates_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "templates")
templates = Jinja2Templates(directory=_templates_dir)

CATEGORIES = [
    {
        "slug": "getting-started", "name": "Getting Started", "icon": "🚀",
        "article_count": 2,
        "description": "Create your account, add a site and go live with your first AI support agent.",
    },
    {
        "slug": "widget-customization", "name": "Widget Customization", "icon": "🎨",
        "article_count": 2,
        "description": "Themes, colours, agent profile, launcher styles and custom CSS/JS.",
    },
    {
        "slug": "help-center", "name": "Help Center", "icon": "📚",
        "article_count": 1,
        "description": "Publish a public knowledge base embedded in the widget or on its own portal.",
    },
    {
        "slug": "plans-billing", "name": "Plans & Billing", "icon": "💳",
        "article_count": 1,
        "description": "Trials, plan features, upgrades and invoices.",
    },
]

ARTICLES = [
    {
        "slug": "add-your-first-site",
        "title": "Add your first site",
        "category_slug": "getting-started",
        "excerpt": "Point SwiftChat at a URL, fetch the brand automatically and start the crawl.",
        "content_html": """
<h2>Create the site</h2>
<p>From <strong>Sites</strong>, click <strong>+ Add</strong> and choose <em>Crawl Website</em>. Paste your site's URL — SwiftChat starts indexing pages immediately.</p>
<h2>Fetch the brand</h2>
<p>Click <strong>Fetch brand info</strong> before creating — or use the <strong>Fetch Brand</strong> action on an existing site — to detect the logo, colours, language and suggested questions automatically. Applying writes the favicon, primary colour, widget avatar, Help Center locale and quick prompts.</p>
<h2>JavaScript-rendered sites</h2>
<p>Single-page apps render through a headless browser automatically when static HTML is too thin, so React/Vue/Vite sites index correctly too.</p>
""",
    },
    {
        "slug": "teach-the-bot-more",
        "title": "Teach the bot more than your website",
        "category_slug": "getting-started",
        "excerpt": "Upload documents, paste text blocks and add video transcripts to the knowledge base.",
        "content_html": """
<h2>Documents and text</h2>
<p>Open your site and choose <strong>Add Docs</strong> to upload PDF, DOCX, TXT, CSV and more. The <em>Knowledge</em> tab also accepts free-text blocks and reusable business information.</p>
<h2>Video knowledge (Advanced)</h2>
<p>Paste a YouTube or video page URL and SwiftChat pulls the transcript or description into the knowledge base — the bot can then answer questions covered in your videos.</p>
<h2>Q&amp;A overrides</h2>
<p>Correct a single answer without retraining: add a question/answer pair and it takes priority over generated responses.</p>
""",
    },
    {
        "slug": "theme-and-appearance",
        "title": "Match the widget to your brand",
        "category_slug": "widget-customization",
        "excerpt": "Six theme presets, per-section colours and a live on-page preview.",
        "content_html": """
<h2>Themes</h2>
<p>The <strong>Appearance</strong> tab offers six presets — Light, Light Accent, Light Soft, Pattern Light, Pattern Accent and Dark — plus independent controls for header, chat area, message field, footer and font.</p>
<h2>Live preview</h2>
<p>Every change renders instantly in the on-page preview, so what you see in the dashboard is what visitors get.</p>
<h2>Custom CSS &amp; JS</h2>
<p>Need full control? Inject your own CSS and JavaScript from the same tab for pixel-perfect integration.</p>
""",
    },
    {
        "slug": "launcher-and-visibility",
        "title": "Control when and where the widget appears",
        "category_slug": "widget-customization",
        "excerpt": "Launcher styles, positioning, schedules and page or device targeting.",
        "content_html": """
<h2>Launcher</h2>
<p>Pick icon, text or combined launcher styles, choose left or right positioning and fine-tune offsets and window size.</p>
<h2>Visibility rules</h2>
<p>Show the widget only on certain pages or devices, or on a schedule — business hours only, weekends, always on.</p>
""",
    },
    {
        "slug": "publish-a-help-center",
        "title": "Publish a Help Center like this one",
        "category_slug": "help-center",
        "excerpt": "Categories, articles, two templates, public URL and custom domain.",
        "content_html": """
<h2>Inside the widget or standalone</h2>
<p>The Help Center your visitors browse can live inside the chat widget or as a public portal on its own URL — exactly like the page you're reading now.</p>
<h2>Two templates</h2>
<p>Choose between the <strong>Classic</strong> hero layout and the <strong>Documentation</strong> sidebar layout — try both using the template switcher on this page.</p>
<h2>Your domain</h2>
<p>Point a subdomain like <code>help.yourcompany.com</code> at SwiftChat and the portal serves on your own domain with your logo as favicon.</p>
""",
    },
    {
        "slug": "plans-explained",
        "title": "Plans and what each includes",
        "category_slug": "plans-billing",
        "excerpt": "Basic vs Advanced — what changes when you upgrade.",
        "content_html": """
<h2>Basic</h2>
<p>Standard widget, automatic crawler, email lead capture, standard AI engine and core analytics — everything needed to launch.</p>
<h2>Advanced</h2>
<p>Adds white-label (no SwiftChat branding), the Help Center portal with custom domain, video knowledge, human handoff to live agents and priority support.</p>
<h2>Billing</h2>
<p>Monthly or yearly billing (yearly saves ~17%). VAT applies at the legal rate. Manage plans and users from <strong>Platform</strong>.</p>
""",
    },
]

LOCALE = [{"code": "en", "name": "English"}]


def _ctx(request: Request) -> dict:
    template = (request.query_params.get("template") or "modern").lower()
    layout = "classic" if template == "classic" else "documentation"
    return {
        "site_id": "swiftchat-demo",
        "site_url": "https://agent.swiftapps.cloud",
        "portal_name": "SwiftChat",
        "portal_title": "SwiftChat | Help Center",
        "header_text": "SwiftChat Help Center",
        "home_page_link": "https://agent.swiftapps.cloud",
        "brand_color": "#7B3DFB",
        "logo_url": "/icons/icon-192.png",
        "layout": layout,
        "social_links": [],
        "embed_widget": False,
        "categories_nav": CATEGORIES,
        "locales": LOCALE,
        "active_locale": "en",
        "locale_name": "English",
        "base_path": "/hc",
        "home_url": "/hc?template=" + template,
        "demo_template": template,
        "q": "",
    }


@router.get("/hc", response_class=HTMLResponse)
async def demo_hc_home(request: Request):
    ctx = _ctx(request)
    recommended = [{"slug": a["slug"], "title": a["title"], "category_slug": a["category_slug"]}
                   for a in ARTICLES[:6]]
    return templates.TemplateResponse(request, "helpcenter/index.html", {
        **ctx, "categories": CATEGORIES, "recommended": recommended,
    })


@router.get("/hc/search.json")
async def demo_hc_search_json(request: Request, q: str = ""):
    q = (q or "").strip().lower()
    results = [{"slug": a["slug"], "title": a["title"], "excerpt": a["excerpt"],
                "category_slug": a["category_slug"]}
               for a in ARTICLES
               if len(q) >= 2 and (q in a["title"].lower() or q in a["excerpt"].lower())]
    return {"results": results, "base_path": "/hc"}


@router.get("/hc/search", response_class=HTMLResponse)
async def demo_hc_search(request: Request, q: str = ""):
    ctx = _ctx(request)
    qq = (q or "").strip().lower()
    results = [{"slug": a["slug"], "title": a["title"], "excerpt": a["excerpt"]}
               for a in ARTICLES
               if qq and (qq in a["title"].lower() or qq in a["excerpt"].lower())]
    return templates.TemplateResponse(request, "helpcenter/search.html", {
        **ctx, "results": results, "q": q,
    })


@router.get("/hc/categories/{slug}", response_class=HTMLResponse)
async def demo_hc_category(request: Request, slug: str):
    ctx = _ctx(request)
    category = next((c for c in CATEGORIES if c["slug"] == slug), None)
    if not category:
        raise HTTPException(status_code=404, detail="Topic not found")
    articles = [{"slug": a["slug"], "title": a["title"], "excerpt": a["excerpt"],
                 "category_slug": a["category_slug"]}
                for a in ARTICLES if a["category_slug"] == slug]
    return templates.TemplateResponse(request, "helpcenter/category.html", {
        **ctx, "category": category, "articles": articles, "sibling_articles": articles,
    })


def _toc(html: str):
    """Same shape as portal._toc — inject ids and collect headings."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    toc = []
    for h in soup.find_all(["h2", "h3"]):
        slug = re.sub(r"[^a-z0-9]+", "-", h.get_text().strip().lower()).strip("-")
        h["id"] = slug
        toc.append({"level": h.name, "id": slug, "text": h.get_text().strip()})
    return str(soup), toc


@router.get("/hc/articles/{slug}", response_class=HTMLResponse)
async def demo_hc_article(request: Request, slug: str):
    ctx = _ctx(request)
    article = next((a for a in ARTICLES if a["slug"] == slug), None)
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    category = next((c for c in CATEGORIES if c["slug"] == article["category_slug"]), None)
    siblings = [{"slug": a["slug"], "title": a["title"]}
                for a in ARTICLES if a["category_slug"] == article["category_slug"]]
    content_html, toc = _toc(article["content_html"])
    return templates.TemplateResponse(request, "helpcenter/article.html", {
        **ctx,
        "article": {**article, "content_html": content_html},
        "category": category,
        "sibling_articles": siblings,
        "toc": toc,
        "updated_display": None,
    })
