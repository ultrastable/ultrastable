// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// HOLD-COMMENT-1 (US-33-R103): mergeNow, runLane, the sweeper and mergeForLane all ask this one reader whether a `HOLD:` comment stops a pull
// request, so the four merge routes read the same comments, however long the thread, and treat an unreadable list the same way (HOLD-LABEL-1 is
// the label form, read by each route from the pull request it already holds).
//
// `read(method, path)` is the route's own GitHub call (it carries the route's token and call budget) and answers { ok, json }. The first page is the
// tick lane's one page of 30 (oldest first); only a full first page is read on, from the start, 100 at a time, up to MAX_PAGES of 100. Returns null
// when nothing holds, 'HOLD' for a hold comment, and 'HOLD unread' when the pull request has more comments than MAX_PAGES pages hold, since a
// comment the route did not read cannot be said not to hold it. An unreadable first page holds nothing: it is the label, not a comment, that a
// route always reads, and the tick lane has never held on an unreadable comment list. A later page that cannot be read after a full first page
// is 'HOLD unread' as well: the full page shows more comments exist, so the unread ones cannot be said not to hold the pull request.
export const FIRST_PAGE = 30, PER_PAGE = 100, MAX_PAGES = 5;
const holds = list => (Array.isArray(list) ? list : []).some(c => /^HOLD:/.test((c && c.body) || ''));

export async function heldByComment(read, repo, number) {
  const base = `/repos/${repo}/issues/${number}/comments`;
  const first = await read('GET', `${base}?per_page=${FIRST_PAGE}`);
  if (!first || !first.ok) return null;
  if (holds(first.json)) return 'HOLD';
  if (!Array.isArray(first.json) || first.json.length < FIRST_PAGE) return null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await read('GET', `${base}?per_page=${PER_PAGE}&page=${page}`);
    if (!r || !r.ok) return 'HOLD unread';
    if (holds(r.json)) return 'HOLD';
    if (!Array.isArray(r.json) || r.json.length < PER_PAGE) return null;
  }
  return 'HOLD unread';
}
