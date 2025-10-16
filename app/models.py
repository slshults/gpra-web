from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, ForeignKey, Index, JSON, Numeric
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime
import json

# NOTE: We use our own Base instead of Flask-AppBuilder's Base because:
# 1. FAB's Base isn't available at import time (circular dependency)
# 2. We removed ForeignKey constraints to ab_user to avoid Base mismatch errors
# 3. Referential integrity is enforced at application level + PostgreSQL triggers
Base = declarative_base()

class Item(Base):
    __tablename__ = 'items'

    id = Column(Integer, primary_key=True, autoincrement=True)
    item_id = Column(String(50), index=True)  # Column B from sheets
    title = Column(String(255), nullable=False, index=True)  # Column C
    notes = Column(Text)  # Column D
    duration = Column(String(50))  # Column E
    description = Column(Text)  # Column F
    order = Column(Integer, default=0, index=True)  # Column G
    tuning = Column(String(50))  # Column H
    songbook = Column(String(255))  # Column I
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Multi-tenant fields
    # NOTE: user_id references ab_user.id but NO ForeignKey constraint due to Base mismatch issues
    # Referential integrity enforced at application level + PostgreSQL trigger
    user_id = Column(Integer, nullable=True, index=True)
    created_via = Column(String(50), default='manual', nullable=False)  # 'manual', 'import' (for PostHog tracking)

    # Note: No direct relationship with ChordChart since it uses string ItemID now
    routine_items = relationship("RoutineItem", back_populates="item", cascade="all, delete-orphan")

    __table_args__ = (
        Index('idx_item_title_order', 'title', 'order'),
        Index('idx_item_tuning', 'tuning'),
        Index('idx_items_user_id', 'user_id'),
    )

    def __repr__(self):
        return f"<Item {self.id}: {self.title}>"

class Routine(Base):
    __tablename__ = 'routines'

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    order = Column(Integer, default=0, index=True)

    # Multi-tenant field
    # NOTE: user_id references ab_user.id but NO ForeignKey constraint due to Base mismatch issues
    # Referential integrity enforced at application level + PostgreSQL trigger
    user_id = Column(Integer, nullable=True, index=True)

    # Relationships
    routine_items = relationship("RoutineItem", back_populates="routine", cascade="all, delete-orphan")

    __table_args__ = (
        Index('idx_routines_user_id', 'user_id'),
    )

    def __repr__(self):
        return f"<Routine {self.id}: {self.name}>"

class RoutineItem(Base):
    __tablename__ = 'routine_items'

    id = Column(Integer, primary_key=True, autoincrement=True)
    routine_id = Column(Integer, ForeignKey('routines.id'), nullable=False, index=True)
    item_id = Column(Integer, ForeignKey('items.id'), nullable=False, index=True)
    order = Column(Integer, default=0, index=True)
    completed = Column(Boolean, default=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    routine = relationship("Routine", back_populates="routine_items")
    item = relationship("Item", back_populates="routine_items")

    __table_args__ = (
        Index('idx_routine_item_order', 'routine_id', 'order'),
        Index('idx_routine_completion', 'routine_id', 'completed'),
    )

    def __repr__(self):
        return f"<RoutineItem routine_id={self.routine_id} item_id={self.item_id}>"

class ChordChart(Base):
    __tablename__ = 'chord_charts'

    chord_id = Column(Integer, primary_key=True, autoincrement=True)  # ChordID - matches Google Sheets Column A
    item_id = Column(String(255), nullable=False, index=True)  # ItemID as string - matches Google Sheets Column B
    title = Column(String(255), nullable=False, index=True)  # Chord name - matches Google Sheets Column C
    chord_data = Column(JSON, nullable=False)  # SVGuitar data + section metadata - matches Google Sheets Column D
    created_at = Column(DateTime(timezone=True), server_default=func.now())  # matches Google Sheets Column E
    order_col = Column(Integer, default=0, index=True)  # matches Google Sheets Column F

    # Multi-tenant fields
    # NOTE: user_id references ab_user.id but NO ForeignKey constraint due to Base mismatch issues
    # Referential integrity enforced at application level + PostgreSQL trigger
    user_id = Column(Integer, nullable=True, index=True)
    generation_method = Column(String(50), nullable=True)  # 'autocreate_file', 'autocreate_youtube', 'manual' (for PostHog tracking)

    # Note: No foreign key relationship since item_id is now a string matching Google Sheets format

    # Section metadata extraction helpers
    @property
    def section_id(self):
        return self.chord_data.get('sectionId') if self.chord_data else None

    @property
    def section_label(self):
        return self.chord_data.get('sectionLabel') if self.chord_data else None

    @property
    def section_repeat_count(self):
        return self.chord_data.get('sectionRepeatCount') if self.chord_data else None

    __table_args__ = (
        Index('idx_chord_chart_item_order', 'item_id', 'order_col'),
        Index('idx_chord_charts_user_id', 'user_id'),
        # Note: Can't index on JSON properties, but we can add functional indexes later if needed
    )

    def __repr__(self):
        return f"<ChordChart {self.chord_id}: {self.title} (item_id={self.item_id})>"

class CommonChord(Base):
    __tablename__ = 'common_chords'

    id = Column(Integer, primary_key=True)
    type = Column(Text)
    name = Column(Text)  # Chord name (e.g., 'G', 'C', 'Am') - matches database structure
    chord_data = Column(JSON)  # JSON with fingers, barres, tuning, etc.
    created_at = Column(DateTime)
    order_col = Column(Integer)
    unused1 = Column(Text)
    unused2 = Column(Text)

    def __repr__(self):
        return f"<CommonChord {self.id}: {self.name}>"

class ActiveRoutine(Base):
    __tablename__ = 'active_routine'

    id = Column(Integer, primary_key=True)  # Single row table
    routine_id = Column(Integer, ForeignKey('routines.id'), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    routine = relationship("Routine")

    def __repr__(self):
        return f"<ActiveRoutine routine_id={self.routine_id}>"

class Subscription(Base):
    __tablename__ = 'subscriptions'

    id = Column(Integer, primary_key=True, autoincrement=True)
    # NOTE: user_id references ab_user.id but NO ForeignKey constraint due to Base mismatch issues
    # Referential integrity enforced at application level + PostgreSQL trigger
    user_id = Column(Integer, nullable=False, index=True)
    stripe_subscription_id = Column(String(255), unique=True, nullable=True)
    stripe_price_id = Column(String(255), nullable=True)
    tier = Column(String(50), nullable=False, default='free')  # 'free', 'basic', 'standard', 'pro', 'unlimited'
    status = Column(String(50), nullable=False, default='active')  # 'active', 'canceled', 'past_due', 'trialing', 'incomplete'
    mrr = Column(Numeric(10, 2), default=0.00, nullable=False)  # Monthly recurring revenue
    current_period_start = Column(DateTime(timezone=True), nullable=True)
    current_period_end = Column(DateTime(timezone=True), nullable=True)
    cancel_at_period_end = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        Index('idx_subscriptions_user_id', 'user_id'),
        Index('idx_subscriptions_status', 'status'),
        Index('idx_subscriptions_tier', 'tier'),
    )

    def __repr__(self):
        return f"<Subscription user_id={self.user_id} tier={self.tier} status={self.status}>"
