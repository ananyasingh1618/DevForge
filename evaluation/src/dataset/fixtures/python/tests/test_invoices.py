# Fixture file for DevForge's evaluation dataset (Phase 13). Small, synthetic,
# non-sensitive sample code written for this dataset -- not copied from any
# real project. Exercises the "tests" category and the adversarial "a test
# mentions a symbol but does not implement it" case: this file only imports
# and calls calculate_total/apply_discount, it does not define them.

from billing.invoices import calculate_total, apply_discount


def test_calculate_total_sums_line_items():
    items = [{"quantity": 2, "unit_price_cents": 500}, {"quantity": 1, "unit_price_cents": 300}]
    assert calculate_total(items) == 1300


def test_apply_discount_reduces_total():
    assert apply_discount(1000, 10) == 900
