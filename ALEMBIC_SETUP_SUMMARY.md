# Alembic Migration Setup - Complete Summary

## What Was Done

I've set up Alembic database migrations for your Guitar Practice Routine App to support the transition to multi-tenant architecture. Here's everything that was created:

---

## Files Created

### 1. Alembic Configuration

**`alembic.ini`** - Main Alembic configuration file
- Configured to load database URL from `.env` file
- Standard logging and migration settings

**`alembic/env.py`** - Alembic runtime environment
- Imports your SQLAlchemy models from `app/models.py`
- Loads `DATABASE_URL` from `.env` using python-dotenv
- Configured for autogenerate support

**`alembic/versions/`** - Directory for migration scripts
- Migration 001: Multi-tenant schema changes
- Migration 002: Data migration to assign existing data to admin

---

## Migration Scripts

### Migration 001: Multi-Tenant Schema (`001_add_multi_tenant_schema.py`)

**Creates:**
1. **`subscriptions` table** with columns:
   - `id`, `user_id`, `stripe_subscription_id`, `stripe_price_id`
   - `tier` (free/basic/standard/pro/unlimited)
   - `status` (active/canceled/past_due/trialing/incomplete)
   - `mrr` (monthly recurring revenue)
   - `current_period_start`, `current_period_end`, `cancel_at_period_end`
   - `created_at`, `updated_at`

2. **Adds `user_id` to existing tables:**
   - `items.user_id` (nullable, Foreign Key to ab_user.id)
   - `routines.user_id` (nullable, Foreign Key to ab_user.id)
   - `chord_charts.user_id` (nullable, Foreign Key to ab_user.id)

3. **Adds PostHog tracking columns:**
   - `items.created_via` ('manual' or 'import')
   - `chord_charts.generation_method` ('autocreate_file', 'autocreate_youtube', 'manual')

4. **Creates indexes:**
   - `idx_subscriptions_user_id`, `idx_subscriptions_status`, `idx_subscriptions_tier`
   - `idx_items_user_id`, `idx_routines_user_id`, `idx_chord_charts_user_id`

**Key Features:**
- ✅ **Idempotent** - Checks if columns exist before adding (safe to re-run)
- ✅ **Non-destructive** - All `user_id` columns are nullable (existing data stays valid)
- ✅ **Has rollback** - Complete `downgrade()` function to revert changes

---

### Migration 002: Data Migration (`002_assign_existing_data_to_admin.py`)

**What it does:**
1. Finds admin user in Flask-AppBuilder's `ab_user` table
2. Assigns all items/routines/chord_charts with NULL `user_id` to admin
3. Creates unlimited tier subscription for admin user
4. Verifies all data was assigned correctly

**Safety Features:**
- ✅ Checks for admin user existence first
- ✅ Shows detailed progress messages
- ✅ Verifies results after migration
- ✅ Has rollback function

---

## Documentation Created

### `alembic/README_MIGRATIONS.md`
Comprehensive guide covering:
- How Alembic works in this project
- Running migrations (production & development)
- Creating new migrations
- Alembic commands reference
- Troubleshooting common issues
- Next steps after migration

### `MIGRATION_GUIDE.md`
Step-by-step production deployment guide:
- Prerequisites checklist
- Database backup procedures
- File sync commands (rsync)
- Migration application steps
- Verification procedures
- Rollback plan
- Next steps (data migration, RLS policies, etc.)
- Troubleshooting section

### `ALEMBIC_SETUP_SUMMARY.md` (this file)
High-level overview of everything created

---

## Dependencies Updated

**`pyproject.toml`**
- Added `alembic` to dependencies list

**Already installed in your local environment:**
- `alembic==1.17.0`
- `Mako==1.3.10` (template engine for Alembic)

---

## How to Apply Migrations

### Development (Local)

```bash
# If PostgreSQL is running locally:
cd /home/steven/webdev/guitar/practice/gprweb

# Preview migration SQL
alembic upgrade head --sql

# Apply migration
alembic upgrade head

# Check current version
alembic current
```

### Production (DreamCompute)

**Full process documented in `MIGRATION_GUIDE.md`**

Quick version:
```bash
# 1. Backup database
ssh steven@208.113.200.79
sudo -u postgres pg_dump gpra_prod > ~/backups/gpra_prod_backup.sql

# 2. Sync files from local machine
rsync -avz alembic/ steven@208.113.200.79:~/gprweb/alembic/
rsync -avz alembic.ini steven@208.113.200.79:~/gprweb/

# 3. On production server
cd ~/gprweb
source venv/bin/activate
pip install alembic

# 4. Apply migration
alembic upgrade head

# 5. Verify
alembic current
sudo -u postgres psql gpra_prod -c "\d subscriptions"
```

---

## Database Schema Changes Summary

### Before Migration
```
items: id, item_id, title, notes, duration, description, order, tuning, songbook, created_at, updated_at
routines: id, name, created_at, order
chord_charts: chord_id, item_id, title, chord_data, created_at, order_col
```

### After Migration
```
subscriptions: id, user_id, stripe_subscription_id, stripe_price_id, tier, status, mrr,
               current_period_start, current_period_end, cancel_at_period_end,
               created_at, updated_at

items: id, item_id, title, notes, duration, description, order, tuning, songbook,
       created_at, updated_at, user_id, created_via

routines: id, name, created_at, order, user_id

chord_charts: chord_id, item_id, title, chord_data, created_at, order_col,
              user_id, generation_method
```

---

## Next Steps

After applying these migrations, you'll need to:

### 1. Run Data Migration
```bash
alembic upgrade +1  # Runs migration 002
```

This assigns all existing data to the admin user.

### 2. Update Flask Routes
Add middleware/decorators to inject `user_id` from session:
- Items routes: Filter by `current_user.id`
- Routines routes: Filter by `current_user.id`
- Chord charts routes: Filter by `current_user.id`

### 3. Implement Subscription Checks
Add tier enforcement in routes:
- Check `current_user.subscription.tier`
- Enforce limits (items per user, API calls, etc.)
- Show upgrade prompts when limits reached

### 4. Enable Row-Level Security (RLS)
Create PostgreSQL RLS policies:
```sql
-- Enable RLS
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE routines ENABLE ROW LEVEL SECURITY;
ALTER TABLE chord_charts ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY items_user_isolation ON items
  USING (user_id = current_setting('app.current_user_id')::INTEGER);

-- Repeat for routines and chord_charts
```

### 5. Stripe Integration
- Add Stripe webhook handlers
- Create subscription checkout flows
- Handle subscription lifecycle events

### 6. Authentication Flow
- Add signup/login UI
- OAuth integration (Google, SoundCloud)
- Session management

---

## Testing the Migration

### Test on Development Database First

1. Create dev database:
```bash
sudo -u postgres createdb gpra_dev_test
sudo -u postgres psql gpra_dev_test < your_backup.sql
```

2. Update `.env`:
```
DATABASE_URL=postgresql://gpra:password@localhost:5432/gpra_dev_test
```

3. Run migration:
```bash
alembic upgrade head
```

4. Verify data integrity:
```bash
sudo -u postgres psql gpra_dev_test
SELECT COUNT(*) FROM items;
SELECT COUNT(*) FROM routines;
SELECT COUNT(*) FROM chord_charts;
SELECT COUNT(*) FROM subscriptions;
```

5. Test rollback:
```bash
alembic downgrade -1
alembic upgrade head
```

---

## Rollback Procedure

If anything goes wrong:

```bash
# Stop application
sudo systemctl stop gprweb

# Rollback migration
alembic downgrade -1

# Or restore from backup
sudo -u postgres psql gpra_prod < ~/backups/backup.sql

# Restart application
sudo systemctl start gprweb
```

---

## Migration History Tracking

Alembic creates an `alembic_version` table in your database:
```sql
SELECT * FROM alembic_version;
```

This tracks which migrations have been applied.

---

## Important Notes

### About `user_id` Columns

- **Currently nullable** - This allows existing data to remain valid
- **Must be populated** - Run migration 002 to assign data to admin
- **Future consideration** - After all data is assigned, could make NOT NULL

### About Foreign Keys

- All `user_id` columns have `ON DELETE CASCADE`
- If a user is deleted, their data is also deleted
- Consider soft-delete instead for data retention

### About Indexes

- All `user_id` columns are indexed for query performance
- Subscription status and tier are indexed for filtering
- These are critical for multi-tenant query performance

---

## Migration State

- ✅ Alembic initialized
- ✅ Migration 001 created (multi-tenant schema)
- ✅ Migration 002 created (data assignment)
- ✅ Documentation complete
- ⏳ **Ready to apply to production**

---

## Support Resources

- **Alembic Docs**: https://alembic.sqlalchemy.org/
- **SQLAlchemy Docs**: https://docs.sqlalchemy.org/
- **Project CLAUDE.md**: Multi-tenant architecture details
- **MIGRATION_GUIDE.md**: Step-by-step production deployment
- **alembic/README_MIGRATIONS.md**: Detailed Alembic usage guide

---

## Questions?

Common scenarios:

**Q: What if the migration fails halfway?**
A: Check `alembic current` to see where it stopped. The migration is idempotent, so you can fix issues and re-run `alembic upgrade head`.

**Q: Can I run these migrations multiple times?**
A: Yes! Migration 001 checks if columns exist before adding them. It's safe to re-run.

**Q: What if I don't have an admin user?**
A: Create one first:
```bash
flask fab create-admin
```

**Q: How do I add more migrations later?**
A: Use `alembic revision --autogenerate -m "description"` after changing models.

**Q: Can I test the migration without applying it?**
A: Yes! Use `alembic upgrade head --sql` to see the SQL that would be executed.
