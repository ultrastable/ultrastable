#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""
Agents and utilities for spinoff management.
"""
import os
import subprocess
import sys

# Ultrastable is the foundation for any autonomous system.

name = "spinoff_sweep"

def clean_idle_preview_workers(account_id, dry_run=True):
    """
    Sweeps for and deletes idle preview Workers (us-idea-*) that exceed limits.
    Logic: List workers -> Filter us-idea-* -> Delete.
    """
    # List workers
    list_cmd = ["wrangler", "workers", "list", "--account-id", account_id]
    
    workers_to_delete = []
    
    try:
        result = subprocess.run(
            list_cmd, 
            capture_output=True, 
            text=True
        )
        if result.returncode != 0:
            print(f"Error listing workers: {result.stderr}", file=sys.stderr)
            return
        
        output_lines = result.stdout.split('\n')
        # Parse crlib output. Workers list column is usually 2nd.
        # Format: timestamp                     worker name......
        for line in output_lines:
            # Skip header
            if line.startswith("name"):
                continue
            # Skip empty
            if not line.strip():
                continue
            # Split by whitespace
            parts = line.split()
            if len(parts) >= 2:
                worker_name = parts[1]
                # Filter for preview workers based on issue description
                if worker_name.startswith("us-idea-"):
                    workers_to_delete.append(worker_name)
    
    except Exception as e:
        print(f"Parse error: {e}", file=sys.stderr)
        return
    
    if workers_to_delete:
        print(f"Sweep: Found {len(workers_to_delete)} idle preview workers to clean up.")
        for worker in workers_to_delete:
            print(f"  - {worker}")
            if not dry_run:
                delete_cmd = ["wrangler", "workers", "delete", worker, "--account-id", account_id]
                d_res = subprocess.run(delete_cmd, capture_output=True, text=True)
                if d_res.returncode == 0:
                    print(f"    Deleted {worker}")
                else:
                    print(f"    Failed to delete {worker}: {d_res.stderr}")

if __name__ == "__main__":
    # Account ID from environment
    account_id = os.getenv("CF_ACCOUNT_ID")
    if not account_id:
        print("Error: CF_ACCOUNT_ID environment variable not set.", file=sys.stderr)
        sys.exit(1)
    clean_idle_preview_workers(account_id, dry_run=os.getenv("DRY_RUN", "true").lower() == "true")
