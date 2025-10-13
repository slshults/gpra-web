# Database Migrations Guide

This directory contains Alembic database migrations for the Guitar Practice Routine App.

## Overview

We use Alembic to manage database schema changes as we transform from a single-user local app to a multi-tenant SaaS application.

## Initial Setup (Already Done)

Alembic has been initialized and configured to:
- Load database URL from `.env` file (`DATABASE_URL`)
- Auto-import models from `app/models.py`
- Generate migrations based on SQLAlchemy model changes

## Migration 001: Multi-Tenant Schema

**File**: `versions/001_add_multi_tenant_schema.py`

**What it does**:
1. Creates `subscriptions` table for Stripe integration (5 tiers: free/basic/standard/pro/unlimited)
2. Adds `user_id` columns to `items`, `routines`, and `chord_charts` tables
3. Adds tracking columns:
   - `items.created_via` - tracks manual vs import (PostHog analytics)
   - `chord_charts.generation_method` - tracks autocreate vs manual (PostHog analytics)
4. Creates all necessary foreign keys and indexes

**Important Notes**:
- All `user_id` columns are **nullable** to allow existing data to remain valid
- After running this migration, you'll need a data migration to assign existing data to users
- This migration is **idempotent** - safe to run multiple times (checks if columns exist)

## Running Migrations

### Production (DreamCompute)

**Step 1: Connect to production server**
```bash
ssh steven@208.113.200.79
cd /home/steven/gprweb
```

**Step 2: Activate virtual environment**
```bash
source venv/bin/activate
```

**Step 3: Preview migration SQL (without applying)**
```bash
alembic upgrade head --sql > migration_preview.sql
cat migration_preview.sql
```

**Step 4: Apply migration**
```bash
alembic upgrade head
```

**Step 5: Verify database schema**
```bash
sudo -u postgres psql gpra_prod -c "\d subscriptions"
sudo -u postgres psql gpra_prod -c "\d items"
```

### Development (Local)

**Prerequisites**:
- PostgreSQL running locally
- `.env` file with correct `DATABASE_URL`

**Commands**:
```bash
# Preview migration
alembic upgrade head --sql

# Apply migration
alembic upgrade head

# Check current migration version
alembic current

# Downgrade (rollback) if needed
alembic downgrade -1
```

## Creating New Migrations

### Auto-generate from model changes:
```bash
alembic revision --autogenerate -m "description of changes"
```

### Manual migration:
```bash
alembic revision -m "description of changes"
# Then edit the generated file in versions/
```

## Migration Workflow

1. **Make model changes** in `app/models.py`
2. **Generate migration**: `alembic revision --autogenerate -m "change description"`
3. **Review migration file** in `alembic/versions/` - check upgrade() and downgrade()
4. **Test locally**: Apply migration to dev database
5. **Test rollback**: `alembic downgrade -1` then `alembic upgrade head`
6. **Deploy to production**: Follow production steps above

## Alembic Commands Reference

```bash
# Show current migration version
alembic current

# Show migration history
alembic history --verbose

# Upgrade to latest
alembic upgrade head

# Upgrade to specific revision
alembic upgrade <revision_id>

# Downgrade one migration
alembic downgrade -1

# Downgrade to specific revision
alembic downgrade <revision_id>

# Show SQL for upgrade (without applying)
alembic upgrade head --sql

# Stamp database at specific revision (without running migrations)
alembic stamp <revision_id>
```

## Troubleshooting

### "Table already exists" error
If you get errors about tables already existing, you may need to stamp the database:
```bash
alembic stamp head
```

### Migration fails midway
Check which version is current:
```bash
alembic current
```
Then manually fix the database and either:
- Complete the migration manually and stamp: `alembic stamp head`
- Rollback: `alembic downgrade -1`

### Database connection refused
Check that:
1. PostgreSQL is running
2. `.env` has correct `DATABASE_URL`
3. Database exists and credentials are correct

## Next Steps After Migration 001

1. **Data Migration Script**: Assign existing items/routines/chord_charts to users
2. **Row-Level Security (RLS)**: Enable PostgreSQL RLS policies for multi-tenant isolation
3. **Authentication Middleware**: Add user_id injection in Flask routes
4. **Subscription Management**: Integrate Stripe webhooks and tier enforcement

## Files

- `alembic.ini` - Alembic configuration (database URL loaded from .env)
- `env.py` - Alembic runtime environment (imports our models)
- `versions/` - Migration scripts
- `script.py.mako` - Template for new migrations

## Resources

- [Alembic Documentation](https://alembic.sqlalchemy.org/)
- [SQLAlchemy Documentation](https://docs.sqlalchemy.org/)
- [Multi-Tenant Architecture Guide](../CLAUDE.md)
