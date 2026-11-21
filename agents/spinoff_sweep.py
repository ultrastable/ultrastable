"""Autonomous spinoff sweep: clean up idle idea preview Workers.

When an idea is launched or declined, the associated preview Worker
(us-idea-*) is redundant. This module identifies these idle Workers and
performs automated deletion to satisfy 'no-idle-preview-workers' guard.
"""
import json
from typing import Dict, List


class SpinoffSweep:
    """Responsible for identifying and removing stale idea preview Workers."""

    def run(self, account_id: str) -> None:
        """Execute the sweep for the given account."""
        # Load the current state of all active ideas
        active_ideas = self._get_active_ideas()

        # List all existing Workers
        workers = self._list_workers(account_id)

        # Identify preview Workers that should be deleted (launched or declined)
        to_delete = self._filter_workers_to_delete(workers, active_ideas)

        # Execute deletions
        self._delete_workers(to_delete)

    def _get_active_ideas(self) -> Dict[str, str]:
        """Fetches the status of active ideas.

        Returns a dictionary mapping idea ID to status (e.g., 'launched', 'declined').
        In production, this connects to the D1 database or an idea registry.
        """
        # Placeholder logic; actual implementation reads the organization's data store
        return {}

    def _list_workers(self, account_id: str) -> List[str]:
        """List all Workers currently deployed for the account."""
        # Placeholder logic; actual implementation calls the Workers API or local registry
        return []

    def _filter_workers_to_delete(
        self, workers: List[str], active_ideas: Dict[str, str]
    ) -> List[str]:
        """Filters preview Workers to delete based on idea status."""
        to_delete = []
        for worker in workers:
            if worker.startswith("us-idea-"):
                # Extract the last part of the name as the short ID
                idea_id = worker.split("-", 1)[1]
                if idea_id in active_ideas:
                    status = active_ideas[idea_id]
                    if status in {"launched", "declined"}:
                        to_delete.append(worker)
        return to_delete

    def _delete_workers(self, workers: List[str]) -> None:
        """Deletes a list of Worker names."""
        for worker in workers:
            # Actual implementation triggers the delete API or purge command
            pass
