# Production Migration Guide: Multi-Tenant Schema

## Quick Reference for Applying Migration 001

This guide walks through applying the multi-tenant schema migration to production.

---

## Prerequisites Checklist

- [ ] Production database backup completed
- [ ] SSH access to DreamCompute server (208.113.200.79)
- [ ] Alembic installed in production venv
- [ ] Migration files synced to production server

---

## Step 1: Backup Production Database

**On production server:**
```bash
ssh steven@208.113.200.79

# Create backup
sudo -u postgres pg_dump gpra_prod > ~/backups/gpra_prod_pre_migration_$(date +%Y%m%d_%H%M%S).sql

# Verify backup
ls -lh ~/backups/
```

---

## Step 2: Sync Migration Files to Production

**From local machine:**
```bash
# Sync entire alembic directory
rsync -avz --progress /home/steven/webdev/guitar/practice/gprweb/alembic/ steven@208.113.200.79:~/gprweb/alembic/

# Sync alembic.ini
rsync -avz --progress /home/steven/webdev/guitar/practice/gprweb/alembic.ini steven@208.113.200.79:~/gprweb/

# Verify sync
ssh steven@208.113.200.79 "ls -la ~/gprweb/alembic/versions/"
```

---

## Step 3: Install Alembic on Production

**On production server:**
```bash
cd /home/steven/gprweb
source venv/bin/activate
pip install alembic
```

---

## Step 4: Verify Database Connection

**Test Alembic can connect:**
```bash
cd /home/steven/gprweb
source venv/bin/activate

# Check current migration state (should show "Base" or no revision)
alembic current
```

**Expected output**: Either "Base" or error about alembic_version table not existing (both are fine)

---

## Step 5: Preview Migration SQL

**Generate SQL without applying:**
```bash
alembic upgrade head --sql > /tmp/migration_preview.sql

# Review the SQL
less /tmp/migration_preview.sql
```

**What to verify:**
- Creates `subscriptions` table
- Adds `user_id` to `items`, `routines`, `chord_charts`
- Adds `created_via` to `items`
- Adds `generation_method` to `chord_charts`
- Creates indexes and foreign keys

---

## Step 6: Apply Migration

**Run the migration:**
```bash
alembic upgrade head
```

**Expected output:**
```
INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
INFO  [alembic.runtime.migration] Will assume transactional DDL.
INFO  [alembic.runtime.migration] Running upgrade  -> 001, add multi-tenant schema
Creating subscriptions table...
Creating subscriptions indexes...
Adding user_id to items table...
Adding created_via to items table...
Adding user_id to routines table...
Adding user_id to chord_charts table...
Adding generation_method to chord_charts table...
✓ Multi-tenant schema migration completed successfully!
```

---

## Step 7: Verify Migration

**Check database schema:**
```bash
# Verify subscriptions table exists
sudo -u postgres psql gpra_prod -c "\d subscriptions"

# Verify user_id columns added
sudo -u postgres psql gpra_prod -c "\d items"
sudo -u postgres psql gpra_prod -c "\d routines"
sudo -u postgres psql gpra_prod -c "\d chord_charts"

# Check migration version
alembic current
```

**Expected output**: Should show "001 (head)"

---

## Step 8: Verify Existing Data

**Ensure existing data is intact:**
```bash
sudo -u postgres psql gpra_prod << EOF
-- Count existing items
SELECT COUNT(*) FROM items;

-- Count existing routines
SELECT COUNT(*) FROM routines;

-- Count existing chord charts
SELECT COUNT(*) FROM chord_charts;

-- Verify user_id is nullable and NULL for existing data
SELECT COUNT(*) FROM items WHERE user_id IS NULL;
SELECT COUNT(*) FROM routines WHERE user_id IS NULL;
SELECT COUNT(*) FROM chord_charts WHERE user_id IS NULL;
EOF
```

**Expected**: All existing records should have `user_id = NULL`

---

## Step 9: Restart Application

**Restart Gunicorn service:**
```bash
sudo systemctl restart gprweb
sudo systemctl status gprweb
```

**Check logs:**
```bash
sudo journalctl -u gprweb -f
```

**Test endpoints:**
```bash
# From local machine
curl -I https://guitarpr.com
```

---

## Rollback Plan (If Needed)

**If something goes wrong:**

```bash
# Stop application
sudo systemctl stop gprweb

# Rollback migration
alembic downgrade -1

# Restore from backup (if needed)
sudo -u postgres psql gpra_prod < ~/backups/gpra_prod_pre_migration_YYYYMMDD_HHMMSS.sql

# Restart application
sudo systemctl start gprweb
```

---

## Next Steps After Migration

1. **Data Migration**: Assign existing data to admin user
   ```sql
   -- Get admin user ID
   SELECT id FROM ab_user WHERE username = 'admin';

   -- Assign existing data (replace 1 with actual admin user_id)
   UPDATE items SET user_id = 1 WHERE user_id IS NULL;
   UPDATE routines SET user_id = 1 WHERE user_id IS NULL;
   UPDATE chord_charts SET user_id = 1 WHERE user_id IS NULL;
   ```

2. **Create Free Subscription**: Add subscription record for admin
   ```sql
   INSERT INTO subscriptions (user_id, tier, status, mrr)
   VALUES (1, 'free', 'active', 0.00);
   ```

3. **Test Multi-Tenant Features**:
   - Create test user in Flask-AppBuilder admin
   - Verify RLS middleware works
   - Test subscription tier limits

4. **Enable Row-Level Security** (Future):
   - Create RLS policies in PostgreSQL
   - Test data isolation between users

---

## Troubleshooting

### "alembic_version table doesn't exist"
```bash
# Initialize Alembic version tracking
alembic stamp head
```

### "relation already exists"
The migration is idempotent - it checks for existing columns. If you see this error, the migration may have partially completed. Check `alembic current` and verify which changes were applied.

### "cannot connect to database"
- Verify `.env` has correct `DATABASE_URL`
- Check PostgreSQL is running: `sudo systemctl status postgresql`
- Verify database exists: `sudo -u postgres psql -l | grep gpra_prod`

### Migration hangs
- Check for locks: `SELECT * FROM pg_locks WHERE NOT granted;`
- Consider stopping app during migration: `sudo systemctl stop gprweb`

---

## Files Created

- `/home/steven/webdev/guitar/practice/gprweb/alembic/` - Alembic directory
- `/home/steven/webdev/guitar/practice/gprweb/alembic.ini` - Alembic config
- `/home/steven/webdev/guitar/practice/gprweb/alembic/versions/001_add_multi_tenant_schema.py` - Migration script
- `/home/steven/webdev/guitar/practice/gprweb/alembic/README_MIGRATIONS.md` - Alembic documentation
- `/home/steven/webdev/guitar/practice/gprweb/MIGRATION_GUIDE.md` - This guide

---

## Support

If issues arise during migration:
1. Check logs: `sudo journalctl -u gprweb -f`
2. Review migration SQL: `alembic upgrade head --sql`
3. Verify database state: Use psql commands above
4. Rollback if needed: Follow rollback plan above
