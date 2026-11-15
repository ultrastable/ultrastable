-- MODEL-TRUTH-1 (2026-11-15): the tick copied roles.model, a configured tier label ('claude-haiku-5-5', 'small'), into every dispatch row,
-- and /ops showed it as the model that ran. No Claude model was ever called by the tick: the in-tick doer uses Workers AI or a rule.
-- This rewrites each labelled row with what the outcome record shows actually ran. Idempotent: only rows still carrying a tier label change.
UPDATE dispatches SET model = CASE
  WHEN status = 'released' THEN 'none (released without being worked)'
  WHEN EXISTS (SELECT 1 FROM outcomes o WHERE o.item_id = dispatches.item_id AND o.agent = 'doer-v1' AND o.evidence LIKE '%workers-ai-glm%') THEN '@cf/zai-org/glm-5.3-flash'
  WHEN EXISTS (SELECT 1 FROM outcomes o WHERE o.item_id = dispatches.item_id AND o.agent = 'doer-v1' AND o.evidence LIKE '%workers-ai-llama%') THEN '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
  WHEN EXISTS (SELECT 1 FROM outcomes o WHERE o.item_id = dispatches.item_id AND o.agent = 'doer-v1' AND o.evidence LIKE '%workers-ai-qwen%') THEN '@cf/qwen/qwen2.5-coder-32b-instruct'
  WHEN EXISTS (SELECT 1 FROM outcomes o WHERE o.item_id = dispatches.item_id AND o.agent = 'doer-v1') THEN 'rules (no model)'
  ELSE 'unrecorded (no Claude model is called by the tick)' END
WHERE model IN ('claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'small', 'medium', 'large');
