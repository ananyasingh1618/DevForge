# Fixture file for DevForge's evaluation dataset (Phase 13). Small, synthetic,
# non-sensitive sample code written for this dataset -- not copied from any
# real project. Exercises Python retrieval; deliberately clean.


def calculate_total(line_items):
    """Sums quantity * unit_price_cents across every line item."""
    return sum(item["quantity"] * item["unit_price_cents"] for item in line_items)


def apply_discount(total_cents, percent_off):
    """Applies a percentage discount (0-100) to a total in cents."""
    if not 0 <= percent_off <= 100:
        raise ValueError("percent_off must be between 0 and 100")
    return round(total_cents * (1 - percent_off / 100))
