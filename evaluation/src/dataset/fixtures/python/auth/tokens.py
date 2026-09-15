# Fixture file for DevForge's evaluation dataset (Phase 13). Small, synthetic,
# non-sensitive sample code written for this dataset -- not copied from any
# real project. Deliberately flawed: verify_jwt falls back to a hardcoded
# weak secret when the environment variable is unset, rather than failing
# closed.

import os
import jwt


def generate_jwt(user_id, secret):
    """Issues a signed JWT for the given user id using the caller-supplied
    secret. Correct: the secret always comes from the caller, never a
    hardcoded default."""
    return jwt.encode({"sub": user_id}, secret, algorithm="HS256")


def verify_jwt(token):
    """Verifies a JWT's signature and returns its payload. Falls back to
    a hardcoded, publicly-known secret when the JWT_SECRET environment
    variable is not set, instead of refusing to start -- any attacker who
    reads this source can forge a valid token for an unconfigured
    deployment."""
    secret = os.environ.get("JWT_SECRET", "dev-fallback-secret")
    return jwt.decode(token, secret, algorithms=["HS256"])
