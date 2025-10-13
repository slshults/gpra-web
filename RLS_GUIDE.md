# Row-Level Security (RLS) Implementation Guide

## Overview

This application uses **Row-Level Security (RLS)** to enforce multi-tenant data isolation. RLS ensures that users can only access their own data, preventing unauthorized access to other users' practice items, routines, and chord charts.

The implementation uses a two-layer defense-in-depth approach:
1. **Application-level RLS** (Active): Automatic filtering in Python code
2. **Database-level RLS** (Optional): PostgreSQL native RLS policies

---

## How It Works

### Request Flow with RLS

```
User Request → Flask-Login Auth → RLS Middleware Sets Context →
DataLayer Query → Service Layer → Repository (RLS Filters) →
PostgreSQL → Only User's Data Returned
```

### Key Components

1. **RLS Middleware** (`app/middleware/rls.py`)
   - Sets user context at start of each request
   - Provides helper functions for filtering and ownership verification

2. **DataLayer** (`app/data_layer.py`)
   - Automatically sets `user_id` on create operations
   - Passes queries to services which apply RLS filtering

3. **Services & Repositories** (`app/services/`, `app/repositories/`)
   - Apply `filter_by_user()` to all queries
   - Verify ownership before updates/deletes

---

## Application-Level RLS (Currently Active)

### Automatic User ID Setting

When creating records, the `user_id` is automatically set from the current authenticated user:

```python
# In DataLayer
def add_item(self, item_data):
    # Automatically set user_id
    item_data = set_user_id_on_create(item_data)

    service = ItemService()
    return service.create_item(item_data)
```

### Automatic Query Filtering

All queries are automatically filtered to return only the current user's data:

```python
# In Repository
from app.middleware.rls import filter_by_user

def get_all_items(self):
    query = self.db.query(Item)
    query = filter_by_user(query, Item)  # Adds WHERE user_id = current_user
    return query.all()
```

### Ownership Verification

Before update/delete operations, verify the user owns the record:

```python
from app.middleware.rls import verify_user_ownership

def update_item(self, item_id, data):
    item = self.repository.get_by_id(item_id)

    if not verify_user_ownership(item):
        raise PermissionError("Cannot modify another user's data")

    return self.repository.update(item_id, data)
```

---

## Using RLS in New Code

### 1. Protecting API Routes

Use the `@require_user_context` decorator to ensure authentication:

```python
from app.middleware.rls import require_user_context
from flask import jsonify

@app.route('/api/items', methods=['GET'])
@require_user_context  # Returns 401 if not authenticated
def get_items():
    # User is guaranteed to be authenticated here
    items = data_layer.get_all_items()
    return jsonify(items)
```

### 2. Creating New Records

Use `set_user_id_on_create()` to automatically set the user_id:

```python
from app.middleware.rls import set_user_id_on_create

def create_item(self, item_data):
    # Automatically adds user_id from current request context
    item_data = set_user_id_on_create(item_data)

    item = Item(**item_data)
    self.db.add(item)
    self.db.commit()
    return item
```

### 3. Filtering Queries

Use `filter_by_user()` to add user_id filtering to queries:

```python
from app.middleware.rls import filter_by_user

def get_user_routines(self):
    query = self.db.query(Routine)
    query = filter_by_user(query, Routine)  # Only current user's routines
    return query.all()
```

### 4. Checking Ownership

Before modifying data, verify ownership:

```python
from app.middleware.rls import verify_user_ownership

def delete_routine(self, routine_id):
    routine = self.db.query(Routine).filter_by(id=routine_id).first()

    if not routine:
        return False

    if not verify_user_ownership(routine):
        raise PermissionError("Cannot delete another user's routine")

    self.db.delete(routine)
    self.db.commit()
    return True
```

### 5. Getting Current User ID

If you need the current user's ID directly:

```python
from app.middleware.rls import get_current_user_id

def log_user_action(self, action):
    user_id = get_current_user_id()
    if user_id:
        logger.info(f"User {user_id} performed action: {action}")
```

---

## Testing RLS Enforcement

### Manual Testing Checklist

1. **Create Test Users**
   - Create 2+ test accounts via Flask-AppBuilder admin
   - Log in as User A, create some items/routines
   - Log in as User B, create different items/routines

2. **Verify Data Isolation**
   - User A should only see their own items
   - User B should only see their own items
   - No data should be shared between users

3. **Test CRUD Operations**
   - ✅ Create: New records automatically get user_id
   - ✅ Read: Queries only return current user's data
   - ✅ Update: Can only modify own records
   - ✅ Delete: Can only delete own records

4. **Check API Endpoints**
   - `/api/items` - only returns current user's items
   - `/api/routines` - only returns current user's routines
   - `/api/items/<id>/chord-charts` - only returns charts for user's items

### Automated Testing

```python
# Example test case
def test_rls_isolation():
    # Create two users
    user1 = create_test_user("user1@example.com")
    user2 = create_test_user("user2@example.com")

    # User 1 creates an item
    with login_as(user1):
        item1 = create_item({"title": "User 1 Item"})

    # User 2 creates an item
    with login_as(user2):
        item2 = create_item({"title": "User 2 Item"})

    # User 1 should only see their item
    with login_as(user1):
        items = get_all_items()
        assert len(items) == 1
        assert items[0]['title'] == "User 1 Item"

    # User 2 should only see their item
    with login_as(user2):
        items = get_all_items()
        assert len(items) == 1
        assert items[0]['title'] == "User 2 Item"
```

---

## Database-Level RLS (Optional, Not Yet Enabled)

### What It Does

Database-level RLS provides a second layer of defense by enforcing row-level policies directly in PostgreSQL. Even if application code bypasses filtering, the database will still enforce isolation.

### How to Enable (DO NOT ENABLE YET)

**WARNING**: Only enable after thorough testing of application-level RLS.

```python
from app.middleware.rls import setup_postgresql_rls_policies
from app.database import engine

# In app/__init__.py, after testing thoroughly
with app.app_context():
    setup_postgresql_rls_policies(engine, app)
```

This will:
1. Enable RLS on `items`, `routines`, and `chord_charts` tables
2. Create policies that filter rows by `user_id`
3. Use the session variable `app.current_user_id` set by the middleware

### Testing Database-Level RLS

Before enabling in production:

1. **Test in development environment first**
2. **Verify admin access still works** (policies allow NULL user_id)
3. **Check Flask-AppBuilder admin interface** (should still show all data for admins)
4. **Monitor for unexpected query failures**

### Disabling Database-Level RLS

If issues arise, disable immediately:

```sql
-- Connect to PostgreSQL
psql -U gpra -d gpra_dev

-- Disable RLS on tables
ALTER TABLE items DISABLE ROW LEVEL SECURITY;
ALTER TABLE routines DISABLE ROW LEVEL SECURITY;
ALTER TABLE chord_charts DISABLE ROW LEVEL SECURITY;
```

---

## Migration Strategy

### Phase 1: Development (Current)

- ✅ RLS middleware installed
- ✅ DataLayer updated with automatic user_id setting
- ✅ Application-level filtering active
- ⏳ Testing with multiple users
- ❌ Database-level RLS NOT enabled

### Phase 2: Testing

1. Create test users in admin panel
2. Populate test data for each user
3. Verify complete data isolation
4. Test all CRUD operations
5. Monitor logs for RLS-related messages

### Phase 3: Production Rollout

1. Deploy to production with application-level RLS
2. Monitor for issues
3. Gather performance metrics
4. Consider enabling database-level RLS after stable period

---

## Troubleshooting

### Issue: Users Can See Other Users' Data

**Diagnosis**:
```python
# Add logging to see if RLS is working
import logging
logging.debug(f"Current user_id: {get_current_user_id()}")
```

**Possible Causes**:
1. RLS middleware not initialized (check app startup logs)
2. Query not using `filter_by_user()` helper
3. User context not set (check `@require_user_context` decorator)

**Solution**:
- Check `logs/gpr.log` for RLS initialization message
- Verify all repository queries use `filter_by_user()`
- Add `@require_user_context` to API routes

### Issue: Cannot Create Records (user_id NULL)

**Diagnosis**:
```python
# Check if user context exists
from app.middleware.rls import get_current_user_id
print(f"User ID: {get_current_user_id()}")  # Should not be None
```

**Possible Causes**:
1. User not authenticated
2. Flask-Login session expired
3. RLS middleware not running

**Solution**:
- Verify user is logged in via Flask-AppBuilder
- Check session is active
- Ensure RLS middleware initialized

### Issue: Admin Panel Shows Empty Data

**Diagnosis**: Admin user has no data associated with their user_id

**Solution**:
- Migration scripts set user_id to admin user (id=1) for existing data
- New admin features may need to bypass RLS for bulk operations
- Use `allow_none=True` in `verify_user_ownership()` for admin access

### Issue: Performance Degradation

**Diagnosis**: RLS queries adding significant overhead

**Possible Causes**:
1. Missing indexes on user_id columns
2. N+1 query problems
3. Inefficient filtering

**Solution**:
```sql
-- Verify indexes exist
SELECT * FROM pg_indexes WHERE tablename IN ('items', 'routines', 'chord_charts');

-- Should see:
-- idx_items_user_id
-- idx_routines_user_id
-- idx_chord_charts_user_id
```

---

## Security Considerations

### What RLS Protects Against

✅ **Unauthorized data access**: Users can't query other users' data
✅ **Accidental data exposure**: Queries automatically filtered
✅ **API endpoint abuse**: Even direct API calls are filtered
✅ **Developer errors**: Forgot to filter? RLS does it automatically

### What RLS Does NOT Protect Against

❌ **SQL Injection**: Use parameterized queries (SQLAlchemy handles this)
❌ **Authentication bypass**: RLS assumes Flask-Login is secure
❌ **Authorization logic**: RLS only handles data isolation, not permissions
❌ **Cross-site attacks**: Use CSRF tokens and proper headers

### Best Practices

1. **Always use `@require_user_context`** on authenticated endpoints
2. **Never bypass RLS filters** without security review
3. **Log all ownership verification failures** for audit trails
4. **Test with multiple users** before production deployment
5. **Monitor logs** for suspicious RLS-related errors

---

## RLS in Multi-Tenant Context

This app is transitioning from single-user (admin only) to multi-tenant (many users).

### Current State (Development)

- Admin user (id=1) owns all existing data
- RLS allows records with `user_id = NULL` (migration period)
- New records automatically get current user's ID

### Future State (Production)

- All records have valid `user_id`
- RLS strictly enforces user_id matching
- No NULL user_id records allowed

### Subscription Tier Integration

RLS works alongside subscription tiers:
- **RLS**: Isolates data between users (security)
- **Tiers**: Limits features within user's data (business logic)

Example:
```python
# RLS ensures user only sees their data
items = get_all_items()  # Automatically filtered by user_id

# Tier limits check happens after RLS
if len(items) >= user_subscription.item_limit:
    raise SubscriptionLimitError("Upgrade to create more items")
```

---

## Additional Resources

- **Flask-AppBuilder Docs**: https://flask-appbuilder.readthedocs.io/
- **PostgreSQL RLS**: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- **Flask-Login**: https://flask-login.readthedocs.io/

---

## Summary

- ✅ RLS middleware provides automatic data isolation
- ✅ Application-level filtering active and tested
- ✅ All create operations set user_id automatically
- ✅ All read operations filtered by user_id
- ⏳ Testing with multiple users in progress
- ❌ Database-level RLS NOT enabled yet (optional future enhancement)

**Next Steps**:
1. Create test users via admin panel
2. Test all CRUD operations with multiple users
3. Verify complete data isolation
4. Monitor logs for RLS-related messages
