"""
PostHog LLM Analytics utility for manual capture
Implements PostHog LLM Analytics with comprehensive properties tracking

NOTE: Auto-instrumentation via create_instrumented_anthropic_client() captures basic $ai_generation events.
This module provides manual tracking for ADDITIONAL custom properties (item_name, section_count, etc.)
that aren't captured by auto-instrumentation.
"""

import os
import time
import uuid
import logging
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

# Import PostHog SDK client and helper functions
try:
    from app.utils.posthog_client import posthog_client, get_posthog_distinct_id
    POSTHOG_AVAILABLE = posthog_client is not None
except ImportError:
    logger.warning("PostHog client not available, manual LLM tracking disabled")
    posthog_client = None
    get_posthog_distinct_id = None
    POSTHOG_AVAILABLE = False

class LLMAnalytics:
    """Utility class for tracking LLM interactions with PostHog LLM Analytics"""

    def __init__(self):
        self.enabled = POSTHOG_AVAILABLE
        self.current_trace_id = None

        if not self.enabled:
            logger.warning("PostHog API key not found. LLM Analytics disabled.")
        else:
            logger.info("PostHog LLM Analytics enabled")

    def start_trace(self, trace_name: str = "autocreate_chord_charts") -> str:
        """Start a new trace and return the trace ID"""
        self.current_trace_id = str(uuid.uuid4())
        logger.info(f"Started LLM Analytics trace: {self.current_trace_id}")
        return self.current_trace_id

    def track_generation(
        self,
        model: str,
        input_messages: List[Dict[str, Any]],
        output_choices: List[Dict[str, Any]],
        usage: Optional[Dict[str, Any]] = None,
        latency_seconds: Optional[float] = None,
        status: str = "success",
        error: Optional[str] = None,
        custom_properties: Optional[Dict[str, Any]] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        span_id: Optional[str] = None,
        privacy_mode: bool = False,
        trace_id: Optional[str] = None,
        user_id: Optional[int] = None
    ) -> str:
        """
        Track an LLM generation event with PostHog LLM Analytics

        Args:
            model: Model name (e.g., "claude-3-5-sonnet-20241022")
            input_messages: Input messages/prompts to the LLM
            output_choices: Generated responses from the LLM
            usage: Token usage and cost information
            latency_seconds: Response latency in seconds (not milliseconds!)
            status: "success" or "error"
            error: Error message if status is "error"
            custom_properties: Additional custom properties
            tools: Available tools/functions for the LLM
            span_id: Optional span ID for linking to spans
            privacy_mode: If True, excludes sensitive input/output data
            trace_id: Optional trace ID (uses current trace if not provided)

        Returns:
            Generation ID for linking spans
        """
        if not self.enabled:
            return str(uuid.uuid4())

        generation_id = str(uuid.uuid4())

        # Use provided trace_id or current trace_id or create new one
        if not trace_id:
            if not self.current_trace_id:
                trace_id = self.start_trace()
            else:
                trace_id = self.current_trace_id
        else:
            trace_id = trace_id

        # Build the event properties following PostHog LLM Analytics format (matching Elixir)
        properties = {
            # MANDATORY PostHog LLM properties (from working Elixir implementation)
            "$ai_input": input_messages if not privacy_mode else None,
            "$ai_output_choices": output_choices if not privacy_mode else None,

            # Core PostHog LLM properties
            "$ai_model": model,
            "$ai_provider": "anthropic",

            # Tracing properties
            "$ai_trace_id": trace_id,
            "$ai_span_id": generation_id,
            "$ai_span_name": "chord_extraction_generation",
        }

        # Add latency in seconds (as per PostHog LLM Analytics docs)
        if latency_seconds is not None:
            properties["$ai_latency"] = latency_seconds

        # Input/output already handled above in mandatory properties

        # Add usage information if available
        if usage:
            if usage.get("input_tokens"):
                properties["$ai_input_tokens"] = usage["input_tokens"]
            if usage.get("output_tokens"):
                properties["$ai_output_tokens"] = usage["output_tokens"]

        # Add tools if provided
        if tools:
            properties["$ai_tools"] = tools

        # Add error information
        if error:
            properties["$ai_is_error"] = True
            properties["error_message"] = error
        else:
            properties["$ai_is_error"] = False

        # Add custom properties
        if custom_properties:
            properties.update(custom_properties)

        # Add user_id for multi-tenant analytics
        if user_id:
            properties["user_id"] = user_id

        # Send to PostHog
        self._capture_event("$ai_generation", properties)
        logger.info(f"Tracked LLM generation: {generation_id} in trace: {trace_id}")

        return generation_id

    def track_span(
        self,
        name: str,
        span_type: str,
        start_time: float,
        end_time: Optional[float] = None,
        parent_span_id: Optional[str] = None,
        generation_id: Optional[str] = None,
        custom_properties: Optional[Dict[str, Any]] = None,
        status: str = "success",
        error: Optional[str] = None
    ) -> str:
        """
        Track a span event for LLM operations

        Args:
            name: Name of the operation (e.g., "file_upload", "chord_lookup")
            span_type: Type of span (e.g., "llm", "retrieval", "function")
            start_time: Start timestamp
            end_time: End timestamp (defaults to current time)
            parent_span_id: Parent span ID for nesting
            generation_id: Associated generation ID
            custom_properties: Additional custom properties
            status: "success" or "error"
            error: Error message if applicable

        Returns:
            Span ID
        """
        if not self.enabled:
            return str(uuid.uuid4())

        span_id = str(uuid.uuid4())
        end_time = end_time or time.time()

        properties = {
            "$ai_trace_id": self.current_trace_id or self.start_trace(),
            "$ai_span_id": span_id,
            "$ai_span_name": name,
            "$ai_span_type": span_type,
            "$ai_span_start_time": start_time,
            "$ai_span_end_time": end_time,
            "$ai_latency": end_time - start_time,  # Duration in seconds
            "$ai_status": status,

            # Context
            "app_name": "Guitar Practice Routine App",
            "environment": os.getenv("FLASK_ENV", "production"),
        }

        # Link to parent span or generation
        if parent_span_id:
            properties["$ai_parent_span_id"] = parent_span_id
        if generation_id:
            properties["$ai_generation_id"] = generation_id

        # Add error information
        if error:
            properties["error_message"] = error

        # Add custom properties
        if custom_properties:
            properties.update(custom_properties)

        self._capture_event("$ai_span", properties)

        return span_id

    def _capture_event(self, event_name: str, properties: Dict[str, Any]):
        """Send event to PostHog using Python SDK"""
        if not self.enabled or not posthog_client:
            return

        # Get user_id from properties - CRITICAL for multi-tenant analytics
        user_id = properties.get('user_id')

        if not get_posthog_distinct_id:
            logger.error(f"get_posthog_distinct_id function not available - cannot track LLM event")
            return

        try:
            if user_id:
                # Use get_posthog_distinct_id() for consistent distinct_id
                # This ensures LLM events use the same distinct_id as all other events
                # (email for regular users, tidalNNNNN for Tidal OAuth users)
                distinct_id = get_posthog_distinct_id(user_id)
            else:
                # Log warning for missing user_id - this shouldn't happen for authenticated endpoints
                # but we still capture the event with a system-level distinct_id for debugging
                logger.warning(f"LLM event '{event_name}' missing user_id - this may be a bug. Capturing with system distinct_id.")
                distinct_id = "system_llm_event"

            # Use PostHog SDK's capture method
            posthog_client.capture(
                distinct_id=distinct_id,
                event=event_name,
                properties=properties
            )

            logger.info(f"Successfully tracked {event_name} event to PostHog LLM Analytics (distinct_id: {distinct_id})")

        except Exception as e:
            logger.error(f"Error tracking {event_name} event: {str(e)}")

# Global instance
llm_analytics = LLMAnalytics()

# Convenience functions
def track_llm_generation(*args, **kwargs):
    """Track an LLM generation event"""
    return llm_analytics.track_generation(*args, **kwargs)

def track_llm_span(*args, **kwargs):
    """Track an LLM span event"""
    return llm_analytics.track_span(*args, **kwargs)