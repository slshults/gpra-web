"""assign existing data to admin user

Revision ID: 002
Revises: 001
Create Date: 2025-10-13 00:10:00.000000

This data migration assigns all existing items, routines, and chord_charts
to the admin user. This should be run after migration 001.

IMPORTANT: This assumes you have an admin user created in Flask-AppBuilder.
If not, create one first through the /admin/ interface or using:
    flask fab create-admin
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '002'
down_revision = '001'
branch_labels = None
depends_on = None


def upgrade():
    """
    Assign all existing NULL user_id records to the admin user.
    """
    conn = op.get_bind()

    print("=" * 70)
    print("DATA MIGRATION: Assigning existing data to admin user")
    print("=" * 70)

    # Find admin user ID
    print("\n1. Finding admin user...")
    result = conn.execute(sa.text("""
        SELECT id, username, email
        FROM ab_user
        WHERE username = 'admin'
        LIMIT 1
    """))
    admin_user = result.fetchone()

    if not admin_user:
        print("   ❌ ERROR: No admin user found!")
        print("   Please create an admin user first:")
        print("   1. Connect to production server")
        print("   2. Run: flask fab create-admin")
        print("   3. Then run this migration again")
        raise Exception("Admin user not found. Create admin user before running this migration.")

    admin_user_id = admin_user[0]
    print(f"   ✓ Found admin user: {admin_user[1]} (ID: {admin_user_id}, email: {admin_user[2]})")

    # Count records to be updated
    print("\n2. Checking existing data...")
    result = conn.execute(sa.text("SELECT COUNT(*) FROM items WHERE user_id IS NULL"))
    items_count = result.scalar()
    print(f"   • Items without user_id: {items_count}")

    result = conn.execute(sa.text("SELECT COUNT(*) FROM routines WHERE user_id IS NULL"))
    routines_count = result.scalar()
    print(f"   • Routines without user_id: {routines_count}")

    result = conn.execute(sa.text("SELECT COUNT(*) FROM chord_charts WHERE user_id IS NULL"))
    charts_count = result.scalar()
    print(f"   • Chord charts without user_id: {charts_count}")

    if items_count == 0 and routines_count == 0 and charts_count == 0:
        print("\n   ✓ All data already has user_id assigned!")
        return

    # Update items
    if items_count > 0:
        print(f"\n3. Assigning {items_count} items to admin user...")
        result = conn.execute(sa.text("""
            UPDATE items
            SET user_id = :user_id
            WHERE user_id IS NULL
        """), {"user_id": admin_user_id})
        print(f"   ✓ Updated {result.rowcount} items")

    # Update routines
    if routines_count > 0:
        print(f"\n4. Assigning {routines_count} routines to admin user...")
        result = conn.execute(sa.text("""
            UPDATE routines
            SET user_id = :user_id
            WHERE user_id IS NULL
        """), {"user_id": admin_user_id})
        print(f"   ✓ Updated {result.rowcount} routines")

    # Update chord_charts
    if charts_count > 0:
        print(f"\n5. Assigning {charts_count} chord charts to admin user...")
        result = conn.execute(sa.text("""
            UPDATE chord_charts
            SET user_id = :user_id
            WHERE user_id IS NULL
        """), {"user_id": admin_user_id})
        print(f"   ✓ Updated {result.rowcount} chord charts")

    # Create free subscription for admin if doesn't exist
    print("\n6. Ensuring admin has a subscription...")
    result = conn.execute(sa.text("""
        SELECT COUNT(*)
        FROM subscriptions
        WHERE user_id = :user_id
    """), {"user_id": admin_user_id})
    subscription_count = result.scalar()

    if subscription_count == 0:
        print("   Creating free tier subscription for admin...")
        conn.execute(sa.text("""
            INSERT INTO subscriptions (user_id, tier, status, mrr)
            VALUES (:user_id, 'unlimited', 'active', 0.00)
        """), {"user_id": admin_user_id})
        print("   ✓ Created unlimited tier subscription")
    else:
        print(f"   ✓ Admin already has {subscription_count} subscription(s)")

    # Verify results
    print("\n7. Verifying migration...")
    result = conn.execute(sa.text("""
        SELECT
            (SELECT COUNT(*) FROM items WHERE user_id IS NULL) as null_items,
            (SELECT COUNT(*) FROM routines WHERE user_id IS NULL) as null_routines,
            (SELECT COUNT(*) FROM chord_charts WHERE user_id IS NULL) as null_charts,
            (SELECT COUNT(*) FROM items WHERE user_id = :user_id) as admin_items,
            (SELECT COUNT(*) FROM routines WHERE user_id = :user_id) as admin_routines,
            (SELECT COUNT(*) FROM chord_charts WHERE user_id = :user_id) as admin_charts
    """), {"user_id": admin_user_id})
    verification = result.fetchone()

    print(f"   • Items with NULL user_id: {verification[0]}")
    print(f"   • Routines with NULL user_id: {verification[1]}")
    print(f"   • Chord charts with NULL user_id: {verification[2]}")
    print(f"   • Items owned by admin: {verification[3]}")
    print(f"   • Routines owned by admin: {verification[4]}")
    print(f"   • Chord charts owned by admin: {verification[5]}")

    if verification[0] == 0 and verification[1] == 0 and verification[2] == 0:
        print("\n✓ Data migration completed successfully!")
        print(f"  All existing data is now assigned to admin user (ID: {admin_user_id})")
    else:
        print("\n⚠ WARNING: Some records still have NULL user_id!")
        print("  This may indicate an issue. Please investigate.")

    print("=" * 70)


def downgrade():
    """
    Remove user assignments from data (set back to NULL).

    WARNING: This will orphan all data and may cause issues.
    Only use this in development/testing.
    """
    conn = op.get_bind()

    print("=" * 70)
    print("DATA MIGRATION ROLLBACK: Removing user assignments")
    print("=" * 70)

    # Find admin user
    result = conn.execute(sa.text("""
        SELECT id FROM ab_user WHERE username = 'admin' LIMIT 1
    """))
    admin_user = result.fetchone()

    if not admin_user:
        print("No admin user found - nothing to rollback")
        return

    admin_user_id = admin_user[0]

    # Remove user assignments
    print(f"\nRemoving user_id assignments from admin (ID: {admin_user_id})...")

    result = conn.execute(sa.text("""
        UPDATE items SET user_id = NULL WHERE user_id = :user_id
    """), {"user_id": admin_user_id})
    print(f"✓ Reset {result.rowcount} items")

    result = conn.execute(sa.text("""
        UPDATE routines SET user_id = NULL WHERE user_id = :user_id
    """), {"user_id": admin_user_id})
    print(f"✓ Reset {result.rowcount} routines")

    result = conn.execute(sa.text("""
        UPDATE chord_charts SET user_id = NULL WHERE user_id = :user_id
    """), {"user_id": admin_user_id})
    print(f"✓ Reset {result.rowcount} chord charts")

    # Delete admin subscription
    result = conn.execute(sa.text("""
        DELETE FROM subscriptions WHERE user_id = :user_id
    """), {"user_id": admin_user_id})
    print(f"✓ Deleted {result.rowcount} subscription(s)")

    print("\n✓ Data migration rollback completed")
    print("=" * 70)
