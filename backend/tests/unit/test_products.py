from bs4 import BeautifulSoup

from app.services.products import (
    build_cart_url,
    cart_actions_enabled,
    match_products,
    parse_cart_actions,
    resolve_cart_actions,
    _norm,
    _product_id,
)


PRODUCTS = [
    {"name": "Brand Oversized faded t-shirt", "url": "https://shop.example/p/1", "price": "41.00", "currency": "EUR"},
    {"name": "Oversized faded t-shirt", "url": "https://shop.example/p/2", "price": "32.00", "currency": "EUR"},
    {"name": "Cuffed Beanie", "url": "https://shop.example/p/3", "price": "19.00", "currency": "EUR"},
]


def test_match_exact_name():
    answer = "Recomendo a Cuffed Beanie para o inverno."
    assert [p["name"] for p in match_products(answer, PRODUCTS)] == ["Cuffed Beanie"]


def test_match_unicode_hyphens():
    # The LLM often emits non-breaking/dash variants (U+2011, U+2013) which must
    # still match catalog names written with ASCII hyphens.
    answer = "Aqui está a Brand Oversized faded t\u2011shirt — 41,00 EUR."
    assert [p["name"] for p in match_products(answer, PRODUCTS)] == ["Brand Oversized faded t-shirt"]


def test_match_multiple_products():
    answer = "Brand Oversized faded t\u2011shirt — 41 EUR\nOversized faded t\u2011shirt — 32 EUR"
    names = [p["name"] for p in match_products(answer, PRODUCTS)]
    assert names == ["Brand Oversized faded t-shirt", "Oversized faded t-shirt"]


def test_nbsp_does_not_merge_words():
    answer = "a Cuffed\u00a0Beanie fica-te bem"
    assert [p["name"] for p in match_products(answer, PRODUCTS)] == ["Cuffed Beanie"]


def test_no_match_returns_empty():
    assert match_products("nada relacionado com produtos", PRODUCTS) == []
    assert match_products("Cuffed Beanie", []) == []


def test_parse_cart_actions_strips_marker():
    answer = 'Feito! [[cart:{"items":[{"name":"Cuffed Beanie","qty":2}]}]]'
    clean, specs = parse_cart_actions(answer)
    assert clean == "Feito!"
    assert specs == [{"name": "Cuffed Beanie", "qty": 2}]


def test_parse_cart_actions_malformed_marker_removed():
    clean, specs = parse_cart_actions("texto [[cart:{oops}] mais")
    assert "[[cart" not in clean
    assert specs == []


def test_parse_cart_actions_qty_clamped_and_default():
    _, specs = parse_cart_actions('[[cart:{"items":[{"name":"A"},{"name":"B","qty":999}]}]]')
    assert specs == [{"name": "A", "qty": 1}, {"name": "B", "qty": 10}]


def test_resolve_cart_actions_matches_catalog():
    specs = [{"name": "Cuffed Beanie", "qty": 3}, {"name": "inexistente", "qty": 1}]
    resolved = resolve_cart_actions(specs, PRODUCTS)
    assert len(resolved) == 1
    assert resolved[0]["product"]["name"] == "Cuffed Beanie"
    assert resolved[0]["qty"] == 3


def test_build_cart_url_qty_placeholder_and_patch():
    behavior = {"shop_platform": "custom", "cart_url_template": "{base}/cart/add?variant={id}&qty={qty}"}
    p = {"name": "Cuffed Beanie", "url": "https://shop.example/p/3", "product_id": "42"}
    assert build_cart_url(behavior, p, "https://shop.example", qty=4) == "https://shop.example/cart/add?variant=42&qty=4"
    # Hardcoded qty=1 in the template is patched when another qty is requested.
    behavior["cart_url_template"] = "{base}/cart/add?variant={id}&qty=1"
    assert build_cart_url(behavior, p, "https://shop.example", qty=4) == "https://shop.example/cart/add?variant=42&qty=4"
    assert build_cart_url(behavior, p, "https://shop.example") == "https://shop.example/cart/add?variant=42&qty=1"


def test_cart_actions_enabled():
    assert cart_actions_enabled({"shop_platform": "custom", "cart_url_template": "{base}/cart?p={id}"})
    assert cart_actions_enabled({"shop_platform": "woocommerce"})
    assert not cart_actions_enabled({"shop_platform": "none"})
    assert not cart_actions_enabled({"shop_platform": "auto"})


def _pid(html, url="https://shop.example/produto/x"):
    return _product_id(BeautifulSoup(html, "html.parser"), url)


def test_product_id_pdp_variant_global():
    # Custom shops expose the default variant as a JS global on the PDP.
    html = "<html><body><script>var PDP_VARIANT = 9;</script></body></html>"
    assert _pid(html) == "9"


def test_product_id_variant_radios():
    html = ('<div id="pdp-variants">'
            '<input type="radio" value="11"><input type="radio" value="12" checked>'
            '</div>')
    assert _pid(html) == "12"


def test_product_id_variant_input_names():
    assert _pid('<input name="variant_id" value="77">') == "77"
    assert _pid('<input name="vid" value="88">') == "88"


def test_product_id_data_variant_attrs():
    assert _pid('<button data-variant-id="55">buy</button>') == "55"
    assert _pid('<div data-vid="66"></div>') == "66"


def test_product_id_none_on_plain_page():
    assert _pid("<html><body><h1>Hello</h1></body></html>") is None
