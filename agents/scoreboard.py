# -*- coding: utf-8 -*-
"""
Per-agent and per-harness quality scoreboard from intake attribution.

This module provides the core mechanisms to record, aggregate, and retrieve
quality metrics attributed to specific agents and harnesses during intake processing.
"""
from typing import Dict, Tuple, Optional

class QualityScoreboard:
    def __init__(self):
        # Internal storage: Key is (agent_id, harness_id), Value is {'total': float, 'count': int}
        self._registry: Dict[Tuple[str, str], Dict[str, float]] = {}

    def record_score(
        self, 
        agent_id: str, 
        harness_id: str, 
        quality_score: float
    ) -> None:
        """
        Registers a score for a specific agent-harness combination.

        Args:
            agent_id: The identifier of the agent.
            harness_id: The identifier of the harness.
            quality_score: The float quality value (e.g., 0.0 to 1.0).
        """
        key = (agent_id, harness_id)
        if key not in self._registry:
            self._registry[key] = {"total": 0.0, "count": 0}
        
        self._registry[key]["total"] += quality_score
        self._registry[key]["count"] += 1

    def get_average_score(
        self, 
        agent_id: str, 
        harness_id: str
    ) -> float:
        """
        Retrieves the average quality score for a specific agent-harness pair.

        Returns:
            float: Average score, or 0.0 if no data exists.
        """
        key = (agent_id, harness_id)
        if key in self._registry and self._registry[key]["count"] > 0:
            return self._registry[key]["total"] / self._registry[key]["count"]
        return 0.0

    def get_all_stats(self) -> Dict:
        """Returns a summary of all recorded stats."""
        return {
            k: {
                "avg": v["total"] / v["count"] if v["count"] > 0 else 0.0,
                "count": v["count"]
            }
            for k, v in self._registry.items()
        }

    def clear(self) -> None:
        """Resets the scoreboard."""
        self._registry.clear()

    @property
    def agents(self) -> list:
        """Returns list of unique agent IDs in the registry."""
        return list(set(k[0] for k in self._registry.keys()))

    @property
    def harnesses(self) -> list:
        """Returns list of unique harness IDs in the registry."""
        return list(set(k[1] for k in self._registry.keys()))
