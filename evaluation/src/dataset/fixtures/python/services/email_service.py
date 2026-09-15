# Fixture file for DevForge's evaluation dataset (Phase 13). Small, synthetic,
# non-sensitive sample code written for this dataset -- not copied from any
# real project. Deliberately flawed: send_email_async schedules a task and
# never awaits or checks it, mirroring services/notificationService.ts's
# TypeScript fire-and-forget pattern in Python.

import asyncio


async def _deliver(to_address, subject, body):
    reader, writer = await asyncio.open_connection("mail.example.com", 587)
    writer.write(f"SUBJECT: {subject}\nTO: {to_address}\n\n{body}".encode())
    await writer.drain()
    writer.close()


def send_email_async(to_address, subject, body):
    """Schedules an email delivery without awaiting it or attaching an
    exception handler -- if _deliver raises, the failure is silently
    swallowed by the event loop instead of being surfaced to the caller."""
    asyncio.create_task(_deliver(to_address, subject, body))
