from abc import ABC, abstractmethod
from typing import Any, Optional
from app.database import DatabaseTransaction

class BaseService(ABC):
    """Base service class with transaction management."""
    
    def __init__(self):
        self.db = None
    
    def _execute_with_transaction(self, func, *args, **kwargs):
        """Execute a function within a database transaction."""
        with DatabaseTransaction() as db:
            self.db = db
            try:
                result = func(*args, **kwargs)
                return result
            finally:
                self.db = None