# Fixture file for DevForge's evaluation dataset (Phase 13). Small, synthetic,
# non-sensitive sample code written for this dataset -- not copied from any
# real project. Adversarial: get_order_by_id here is an unrelated,
# in-memory-dict legacy implementation with the exact same name as
# db/repository.py's real, parameterized-SQL get_order_by_id -- tests that
# retrieval disambiguates by the query's own wording, not the identifier
# alone.

_LEGACY_ORDERS = {}


def get_order_by_id(order_id):
    """Looks up an order in the old in-memory legacy store used before the
    real database-backed repository existed. Has no SQL and no
    injection surface at all -- a completely different implementation
    from db/repository.py's same-named function."""
    return _LEGACY_ORDERS.get(order_id)
