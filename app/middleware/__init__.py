"""
Middleware package for Flask application.

Row-Level Security (RLS) middleware provides multi-tenant data isolation
by automatically filtering queries based on the current authenticated user.
"""
from .rls import (
    init_rls_middleware,
    get_current_user_id,
    require_user_context,
    filter_by_user,
    set_user_id_on_create,
    verify_user_ownership,
    setup_postgresql_rls_policies
)

__all__ = [
    'init_rls_middleware',
    'get_current_user_id',
    'require_user_context',
    'filter_by_user',
    'set_user_id_on_create',
    'verify_user_ownership',
    'setup_postgresql_rls_policies',
]
