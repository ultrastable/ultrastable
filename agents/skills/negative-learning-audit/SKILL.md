---
name: negative-learning-audit
description: Use weekly to detect action classes that look effective but degrade efficiency, and to check that failure memories are still retrieved.
metadata: {kernel: "9.1.0"}
---
1. For each action class compute effectiveness, efficiency (cost per unit) and consistency (efficiency slope over windows); seed/scripts/perezlopez.py holds the arithmetic.
2. Objective up while efficiency down for 2+ windows: flag `negative_learning`.
3. 5 consecutive falling windows: apply step `pause_action_class`.
4. Failure recall: query retrieval with 20 sampled past failures; recall below 0.9 means `flagged`.
5. Classify new failures incorrect-model or incomplete-model; incomplete ones become a proposed EV in a gate row, never an EV you add.
