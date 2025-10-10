from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, ForeignKey, Index, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime
import json

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
    
    # Note: No direct relationship with ChordChart since it uses string ItemID now
    routine_items = relationship("RoutineItem", back_populates="item", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index('idx_item_title_order', 'title', 'order'),
        Index('idx_item_tuning', 'tuning'),
    )

    def __repr__(self):
        return f"<Item {self.id}: {self.title}>"

class Routine(Base):
    __tablename__ = 'routines'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    order = Column(Integer, default=0, index=True)
    
    # Relationships
    routine_items = relationship("RoutineItem", back_populates="routine", cascade="all, delete-orphan")
    
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