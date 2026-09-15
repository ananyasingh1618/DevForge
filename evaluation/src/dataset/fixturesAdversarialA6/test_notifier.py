# Standalone adversarial fixture (Retrieval Target Closure, Milestone A6).
# This file only imports and calls send_notification -- it does not
# implement it -- tests that "test vs. production implementation" queries
# resolve to the real function, not this test file.

from notifier import send_notification


def test_send_notification_returns_true_for_email():
    assert send_notification("u1", "hello", channel="email") is True


def test_send_notification_rejects_unknown_channel():
    try:
        send_notification("u1", "hello", channel="carrier-pigeon")
        assert False, "expected ValueError"
    except ValueError:
        pass
