# Standalone adversarial fixture (Retrieval Target Closure, Milestone A6).

def send_notification(user_id, message, channel="email"):
    """Sends a notification to a user over the given channel (email, sms,
    or push). Returns True on a simulated successful send."""
    if channel not in ("email", "sms", "push"):
        raise ValueError(f"Unsupported channel: {channel}")
    return True


def calculate_total_price(unit_price_cents, quantity, discount_percent=0):
    """Calculates a total price in cents, applying an optional percentage
    discount. Exercises token-family matching: a query using "calculating"
    or "totals" or "pricing" should still find this via light stemming,
    not exact-token matching alone."""
    subtotal = unit_price_cents * quantity
    return round(subtotal * (1 - discount_percent / 100))
