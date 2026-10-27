from app.services.products import match_products, _norm


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
