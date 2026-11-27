// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The live adapter for the three board ports of core/ghcost/projects.js (US-24-R03) over the Projects (v2) GraphQL API:
// projectItems(project) -> [{ id, itemId, fields }], upsertProjectItem({ project, itemId, fields }), deleteProjectItem({ project, id }).
// `project` is the project number inside the organization. A ledger item is one draft issue whose title is the ledger item id,
// so the board holds no second copy of anything but the three mirrored fields; a board larger than `maxPages` pages is refused
// rather than read in part, and a field the board does not have (or a single-select option it lacks) is an error, never a
// silent skip. `graphql(query, variables)` is the port github.js supplies (it carries the token, the retry and the error check).
const PAGE = 100;

const META = `query($org:String!,$n:Int!){organization(login:$org){projectV2(number:$n){id fields(first:50){nodes{
  ... on ProjectV2Field{id name dataType}
  ... on ProjectV2SingleSelectField{id name dataType options{id name}}
  ... on ProjectV2IterationField{id name dataType}}}}}}`;
const ITEMS = `query($org:String!,$n:Int!,$after:String){organization(login:$org){projectV2(number:$n){items(first:${PAGE},after:$after){pageInfo{hasNextPage endCursor}nodes{id
  content{... on DraftIssue{title} ... on Issue{title} ... on PullRequest{title}}
  fieldValues(first:30){nodes{
    ... on ProjectV2ItemFieldTextValue{text field{... on ProjectV2FieldCommon{name}}}
    ... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2FieldCommon{name}}}}}}}}}}`;
const ADD = `mutation($project:ID!,$title:String!){addProjectV2DraftIssue(input:{projectId:$project,title:$title}){projectItem{id}}}`;
const SET_TEXT = `mutation($project:ID!,$item:ID!,$field:ID!,$text:String!){updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:{text:$text}}){projectV2Item{id}}}`;
const SET_OPTION = `mutation($project:ID!,$item:ID!,$field:ID!,$option:String!){updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:{singleSelectOptionId:$option}}){projectV2Item{id}}}`;
const DELETE = `mutation($project:ID!,$item:ID!){deleteProjectV2Item(input:{projectId:$project,itemId:$item}){deletedItemId}}`;

export function projectPort({ graphql, org, maxPages = 20 }) {
  if (typeof graphql !== 'function') throw new Error('ghcost: a graphql port is required');
  const num = project => { const n = Number(project); if (!Number.isInteger(n) || n < 1) throw new Error('ghcost: config.ghcost.projects.project must be the project number'); return n; };
  const metas = new Map();   // project number -> { id, fields: Map(name -> { id, options? }) }; read once per adapter
  const boards = new Map();  // project number -> Map(ledger item id -> board item id), from the last read

  async function meta(project) {
    const n = num(project);
    if (metas.has(n)) return metas.get(n);
    const p = (await graphql(META, { org, n }))?.organization?.projectV2;
    if (!p?.id) throw new Error(`ghcost: project ${n} was not found in ${org} (or the token has no project scope)`);
    const m = { id: p.id, fields: new Map((p.fields?.nodes || []).filter(f => f?.name).map(f => [f.name, { id: f.id, options: f.options ? new Map(f.options.map(o => [String(o.name).toLowerCase(), o.id])) : null }])) };
    metas.set(n, m);
    return m;
  }

  async function projectItems(project) {
    const n = num(project), out = [], index = new Map();
    let after = null;
    for (let page = 1; ; page++) {
      if (page > maxPages) throw new Error(`ghcost: project ${n} holds more than ${maxPages * PAGE} items; refusing a partial read`);
      const items = (await graphql(ITEMS, { org, n, after }))?.organization?.projectV2?.items;
      if (!items) throw new Error(`ghcost: project ${n} items could not be read`);
      for (const node of items.nodes || []) {
        const fields = {};
        for (const v of node.fieldValues?.nodes || []) { const name = v?.field?.name; if (name) fields[name] = v.text ?? v.name ?? ''; }
        const itemId = node.content?.title ?? null;
        out.push({ id: node.id, itemId, fields });
        if (itemId != null) index.set(itemId, node.id);
      }
      if (!items.pageInfo?.hasNextPage) break;
      after = items.pageInfo.endCursor;
    }
    boards.set(n, index);
    return out;
  }

  async function upsertProjectItem({ project, itemId, fields = {} }) {
    const n = num(project), m = await meta(project);
    if (!boards.has(n)) await projectItems(project);
    let id = boards.get(n).get(itemId);
    if (!id) {
      id = (await graphql(ADD, { project: m.id, title: String(itemId) }))?.addProjectV2DraftIssue?.projectItem?.id;
      if (!id) throw new Error(`ghcost: the board did not return an id for ${itemId}`);
      boards.get(n).set(itemId, id);
    }
    for (const [name, value] of Object.entries(fields)) {
      const f = m.fields.get(name);
      if (!f) throw new Error(`ghcost: project ${n} has no field named ${name}`);
      if (f.options) {
        const option = f.options.get(String(value).toLowerCase());
        if (!option) throw new Error(`ghcost: field ${name} of project ${n} has no option ${String(value).slice(0, 60)}`);
        await graphql(SET_OPTION, { project: m.id, item: id, field: f.id, option });
      } else await graphql(SET_TEXT, { project: m.id, item: id, field: f.id, text: String(value ?? '') });
    }
    return { id };
  }

  async function deleteProjectItem({ project, id }) {
    const n = num(project), m = await meta(project);
    await graphql(DELETE, { project: m.id, item: id });
    for (const [k, v] of boards.get(n) || []) if (v === id) boards.get(n).delete(k);
    return {};
  }

  return { projectItems, upsertProjectItem, deleteProjectItem };
}
