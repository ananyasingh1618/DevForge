# Fixture file for DevForge's evaluation dataset (Phase 13). Small, synthetic,
# non-sensitive sample code written for this dataset -- not copied from any
# real project. Deliberately flawed: load_api_key returns None silently
# instead of failing loudly, mirroring config/config.ts's TypeScript
# webhook-secret pattern in Python. MAX_UPLOAD_SIZE_MB is an exact-variable
# retrieval target.

import os

MAX_UPLOAD_SIZE_MB = 25


def load_api_key():
    """Reads THIRD_PARTY_API_KEY from the environment. Returns None
    silently when the variable is unset instead of raising, so a
    misconfigured deployment fails later with a confusing downstream
    error instead of a clear startup failure."""
    return os.environ.get("THIRD_PARTY_API_KEY")
