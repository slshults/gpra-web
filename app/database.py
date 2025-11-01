from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, scoped_session
from sqlalchemy.pool import StaticPool
import os
import logging
from dotenv import load_dotenv

# Load environment variables from .env file (override existing)
load_dotenv(override=True)

from app.models import Base

# Database URL from environment
DATABASE_URL = os.getenv(
    'DATABASE_URL',
    'postgresql://gpra:%5E66%2AB%5Emzg6Y6e%23@localhost:5432/gpra_dev'
)

# Create engine with connection pooling
engine = create_engine(
    DATABASE_URL,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,  # Validate connections before use
    echo=os.getenv('SQL_DEBUG', 'False').lower() == 'true'  # SQL logging
)

# Session factory
SessionLocal = scoped_session(sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
))

def create_tables():
    """Create all tables."""
    Base.metadata.create_all(bind=engine)
    logging.info("Database tables created successfully")

def get_db():
    """Dependency for getting database sessions."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Context manager for database transactions
class DatabaseTransaction:
    def __init__(self):
        self.db = None
        
    def __enter__(self):
        self.db = SessionLocal()
        return self.db
        
    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type is not None:
            self.db.rollback()
        else:
            self.db.commit()
        self.db.close()

def test_connection():
    """Test database connectivity."""
    try:
        with DatabaseTransaction() as db:
            result = db.execute(text("SELECT 1 as test")).fetchone()
            logging.info(f"Database connection test successful: {result}")
            return True
    except Exception as e:
        logging.error(f"Database connection test failed: {str(e)}")
        return False