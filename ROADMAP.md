# Ultrastable roadmap

> Ultrastable is the foundation for any autonomous system.

The roadmap is the work queue itself. Every item is a file in [`docs/issues/`](docs/issues) with an owner, a trigger and a closing probe; the executor, queue and dispose loops work and close those files. `foundation/ghmirror.py` (GH-MIRROR-1) mirrors every item one way onto GitHub on each `fleet` and daily `issues` run, so the same queue can be read here:

- **Open work:** [issues labelled `queue`](https://github.com/ultrastable/ultrastable/issues?q=is%3Aissue+is%3Aopen+label%3Aqueue), one issue per item, titled with its id.
- **Horizons:** [milestones](https://github.com/ultrastable/ultrastable/milestones) Now, Next and Later, with progress bars from closed items.
- **Board:** the org project [Ultrastable roadmap](https://github.com/orgs/ultrastable/projects/1). GitHub's built-in auto-add workflow adds every `label:queue` issue; closing moves it to Done.
- **Finished work:** [closed `queue` issues](https://github.com/ultrastable/ultrastable/issues?q=is%3Aissue+is%3Aclosed+label%3Aqueue), each closed when its probe passed.
- **Live site:** [ultrastable.io/roadmap](https://ultrastable.io/roadmap) lists the items behind every claim on the site.

The file is the record: an edit made on a GitHub issue is put back on the next mirror run. To change an item, change its file.
