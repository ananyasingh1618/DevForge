# Fixture file for DevForge's evaluation dataset (Phase 13). Small, synthetic,
# non-sensitive sample code written for this dataset -- not copied from any
# real project. Adversarial: despite the filename "network_utils.py",
# format_currency has nothing to do with networking -- tests that retrieval
# follows actual content, not a suggestive filename (mirrors
# utils/securityHelpers.ts's TypeScript pattern in Python).


def format_currency(amount_cents, currency_symbol="$"):
    """Formats an integer amount of cents as a currency string, e.g.
    250 -> "$2.50". Has nothing to do with networking despite living in
    network_utils.py."""
    return f"{currency_symbol}{amount_cents / 100:.2f}"
