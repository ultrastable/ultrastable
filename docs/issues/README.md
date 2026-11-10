# Issue export

One JSON file per roadmap item in `docs/roadmap.md` (generated; the roadmap is the source of truth). Each has title, body (owner, trigger, done check, status), labels (`role:*`, `owner:rowan`, `ws:*`, `gate:filed`) and a milestone (Now, Next, After filing, Later). `_labels.json` lists the labels to create. `create-issues.sh` in `ultrastable-git` creates labels, milestones, issues and the projects described in `../projects.md`.
