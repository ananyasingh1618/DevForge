# Fixture file for DevForge's evaluation dataset (Phase 13). Small, synthetic,
# non-sensitive sample code written for this dataset -- not copied from any
# real project. Deliberately clean utility file.

import re

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def validate_email(email):
    """Returns True when the given string looks like a well-formed email
    address."""
    return bool(_EMAIL_RE.match(email))


def is_strong_password(password):
    """Returns True when the password is at least 12 characters and
    contains a digit and an uppercase letter."""
    if len(password) < 12:
        return False
    return any(c.isdigit() for c in password) and any(c.isupper() for c in password)
