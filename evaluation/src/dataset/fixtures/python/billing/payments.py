# Fixture file for DevForge's evaluation dataset (Phase 13). Small, synthetic,
# non-sensitive sample code written for this dataset -- not copied from any
# real project. Deliberately flawed: charge_card has no error handling
# around the external call, so a failed charge looks identical to a
# successful one to the caller.

import requests


def charge_card(card_token, amount_cents):
    """Charges a card via the payment gateway. Does not catch any
    exception from the network call, and does not check the response
    status code -- a failed charge is indistinguishable from a successful
    one unless the caller happens to inspect the raw response itself."""
    response = requests.post(
        "https://payments.example.com/charge",
        json={"token": card_token, "amount": amount_cents},
    )
    return response.json()


def refund_payment(charge_id, amount_cents):
    """Refunds a previous charge. Correctly checks the response status
    and raises a clear error on failure, unlike charge_card above."""
    try:
        response = requests.post(
            "https://payments.example.com/refund",
            json={"charge_id": charge_id, "amount": amount_cents},
        )
        response.raise_for_status()
        return response.json()
    except requests.RequestException as exc:
        raise RuntimeError(f"Refund failed for charge {charge_id}") from exc
