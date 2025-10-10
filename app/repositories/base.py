from typing import List, Optional, Dict, Any, Type
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_
from app.database import SessionLocal

class BaseRepository:
    def __init__(self, model_class: Type, db_session: Optional[Session] = None):
        self.model_class = model_class
        self.db = db_session or SessionLocal()
        self._should_close = db_session is None
        
    def __enter__(self):
        return self
        
    def __exit__(self, exc_type, exc_val, exc_tb):
        if self._should_close:
            self.db.close()
    
    def get_by_id(self, id: int) -> Optional[Any]:
        return self.db.query(self.model_class).filter(self.model_class.id == id).first()
        
    def get_all(self, order_by=None, limit: Optional[int] = None) -> List[Any]:
        query = self.db.query(self.model_class)
        if order_by:
            query = query.order_by(order_by)
        if limit:
            query = query.limit(limit)
        return query.all()
        
    def create(self, **kwargs) -> Any:
        instance = self.model_class(**kwargs)
        self.db.add(instance)
        self.db.commit()
        self.db.refresh(instance)
        return instance
        
    def update(self, id: int, **kwargs) -> Optional[Any]:
        instance = self.get_by_id(id)
        if instance:
            for key, value in kwargs.items():
                setattr(instance, key, value)
            self.db.commit()
            self.db.refresh(instance)
        return instance
        
    def delete(self, id: int) -> bool:
        instance = self.get_by_id(id)
        if instance:
            self.db.delete(instance)
            self.db.commit()
            return True
        return False
        
    def count(self) -> int:
        return self.db.query(self.model_class).count()
        
    def exists(self, id: int) -> bool:
        return self.db.query(self.model_class).filter(self.model_class.id == id).first() is not None