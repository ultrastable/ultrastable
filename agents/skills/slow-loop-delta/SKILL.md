---
name: slow-loop-delta
description: Use on the daily slow tick to change doctrine, prompts, skills or memory. Produces one delta edit with prediction and rollback, gated by replay.
metadata: {kernel: "9.1.0"}
---
1. Inputs: the last 24 h of flags, rollbacks, owner friction and action-class trends. Never the current turn's signal alone.
2. Write ONE delta (add, modify or remove a bullet). No full rewrites: iterative rewriting erodes detail (context collapse).
3. Record the prediction: metric, direction, magnitude, horizon.
4. Replay the owner-held task set with and without the delta.
5. Adopt only if the prediction holds and no EV regresses: open a PR with the replay report. Otherwise discard and log the miss.
6. Kernel §0, essential variables and gates are out of scope for this skill.
