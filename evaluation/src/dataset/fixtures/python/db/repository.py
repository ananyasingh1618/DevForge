# Fixture file for DevForge's evaluation dataset (Phase 13). Small, synthetic,
# non-sensitive sample code written for this dataset -- not copied from any
# real project. get_order_by_id is correctly parameterized;
# get_order_by_customer_email builds SQL via an f-string -- a SQL injection
# risk, mirroring db/userRepository.ts's TypeScript pattern in Python.


def get_order_by_id(cursor, order_id):
    """Looks up a single order by id using a parameterized query."""
    cursor.execute("SELECT * FROM orders WHERE id = %s", (order_id,))
    return cursor.fetchone()


def get_order_by_customer_email(cursor, email):
    """Looks up every order for a customer by email. Builds the SQL by
    interpolating the caller-supplied email directly into an f-string
    instead of passing it as a query parameter -- a SQL injection risk."""
    cursor.execute(f"SELECT * FROM orders WHERE customer_email = '{email}'")
    return cursor.fetchall()
