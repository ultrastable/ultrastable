"""Doer modules for family-throughput closers.

Each doer is a pure function over item records; no network, no filesystem,
no human step. Registered under config.doers.<FAMILY> in
doctrine/qnfo-port.json as {"module": ..., "entry": ...}.
"""
