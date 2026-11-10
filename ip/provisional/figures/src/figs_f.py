import html, sys, os
import os as _o
OUT = _o.path.dirname(_o.path.dirname(_o.path.abspath(__file__)))
W_BOX, H_BOX = 230, 58
def svg(name, title, nodes, edges, w, h):
    # nodes: id -> (x, y, label, ref, shape)  x,y center
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" font-family="Arial, Helvetica, sans-serif">',
         '<rect width="100%" height="100%" fill="white"/>',
         '<defs><marker id="a" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 z" fill="black"/></marker></defs>',
         f'<text x="{w/2}" y="28" text-anchor="middle" font-size="18" font-weight="bold">{html.escape(title)}</text>']
    for nid,(x,y,label,ref,shape) in nodes.items():
        bw = W_BOX if shape!='wide' else 520
        if shape=='diamond':
            s.append(f'<polygon points="{x},{y-46} {x+145},{y} {x},{y+46} {x-145},{y}" fill="white" stroke="black" stroke-width="1.6"/>')
        else:
            s.append(f'<rect x="{x-bw/2}" y="{y-H_BOX/2}" width="{bw}" height="{H_BOX}" rx="4" fill="white" stroke="black" stroke-width="1.6"/>')
        lines = label.split('\n')
        for i,l in enumerate(lines):
            yy = y + (i-(len(lines)-1)/2)*15 + 4
            s.append(f'<text x="{x}" y="{yy}" text-anchor="middle" font-size="12.5">{html.escape(l)}</text>')
        if ref:
            off = (bw/2 if shape!='diamond' else 145)
            s.append(f'<text x="{x+off+4}" y="{y-H_BOX/2+12 if shape!="diamond" else y-30}" font-size="12" font-weight="bold">{ref}</text>')
    for e in edges:
        a,b = e[0],e[1]; lab = e[2] if len(e)>2 else ''; route = e[3] if len(e)>3 else None
        ax,ay = nodes[a][0],nodes[a][1]; bx,by = nodes[b][0],nodes[b][1]
        def edge_pt(n, tx, ty):
            x,y,_,_,shape = nodes[n]; bw = (W_BOX if shape!='wide' else 520)/2; bh = H_BOX/2
            if shape=='diamond': bw,bh=145,46
            dx,dy = tx-x, ty-y
            if abs(dx)*bh > abs(dy)*bw: return (x+bw*(1 if dx>0 else -1), y+dy*bw/abs(dx) if dx else y)
            return (x+dx*bh/abs(dy) if dy else x, y+bh*(1 if dy>0 else -1))
        if route:  # list of waypoints
            pts = route
            p0 = edge_pt(a, *pts[0]); p1 = edge_pt(b, *pts[-1])
            allp = [p0]+pts+[p1]
            d = 'M'+' L'.join(f'{px:.0f},{py:.0f}' for px,py in allp)
            s.append(f'<path d="{d}" fill="none" stroke="black" stroke-width="1.4" stroke-dasharray="6,4" marker-end="url(#a)"/>')
            mx,my = pts[len(pts)//2]
        else:
            p0 = edge_pt(a,bx,by); p1 = edge_pt(b,ax,ay)
            s.append(f'<line x1="{p0[0]:.0f}" y1="{p0[1]:.0f}" x2="{p1[0]:.0f}" y2="{p1[1]:.0f}" stroke="black" stroke-width="1.4" marker-end="url(#a)"/>')
            mx,my = (p0[0]+p1[0])/2,(p0[1]+p1[1])/2
        if lab: s.append(f'<text x="{mx+6}" y="{my-4}" font-size="11.5" font-style="italic">{html.escape(lab)}</text>')
    s.append('</svg>')
    open(os.path.join(OUT, name+'.svg'),'w').write('\n'.join(s))
B='box'
svg('fig26-seed-install','FIG. 26  Seed install and tenant configuration',{
 'idea':(360,90,'IDEA.md (idea, users,\nfirst outcomes, constraints)','2602',B),
 'cfg':(650,90,'ultrastable.json (roles, model\nladder, connectors, capacity)','2604',B),
 'pol':(940,90,'autonomy/policy.json (surfaces,\nactions, ladder, limits)','2606',B),
 'core':(135,230,'Portable core, not modified:\nprotocol, role files, schema,\ntick steps, policy validator','2608',B),
 'con':(1205,230,'Connectors: credential\npresence by name only','2610',B),
 'boot':(650,230,'Bootstrapper stages: read, detect, select,\nplan, write, provision, start (each guarded)','2612','wide'),
 'org':(360,370,'org/ record: charter, roles,\nbacklog, boot log, report','2614',B),
 'gate':(650,370,'Gate cards: owner-only steps,\neach with a closing probe','2616',B),
 'sql':(940,370,'Seed SQL and worker config\n(idempotent INSERT OR IGNORE)','2618',B),
 'own':(650,490,'Owner sets a secret or\nanswers a card (identity-bound)','2620',B),
 'run':(940,490,'Runtime: relational database,\nworker, 10-minute schedule','2622',B),
 'tick':(940,610,'Heartbeat: seven-step tick,\nfour-line report, /health','2624',B),
 'pred':(650,610,'Prediction P-KIT-3 scored:\nsix complete ticks in an hour','2626',B),
 'claims':(940,730,'Boundary check and claim\nprobes (product proof)','2628',B),
},[('idea','boot'),('cfg','boot'),('pol','boot'),('core','boot','read'),('con','boot','detect'),
   ('boot','org','write'),('boot','gate','detect'),('boot','sql','write'),('gate','own'),('own','run'),('sql','run','provision'),
   ('run','tick','start'),('tick','pred'),('tick','claims')],1360,800)

svg('fig27-adapter-mapping','FIG. 27  Platform-agnostic adapter mapping',{
 'core':(560,85,'Portable core: schema, tick steps, ledgers, policy data,\nprotocol, probes (no platform calls)','2702','wide'),
 'iface':(560,185,'Adapter interface: six ports (schedule, store, secrets,\nmodel, deploy, health) implemented once per platform','2704','wide'),
 'hE':(400,285,'Edge embodiment\n(built, QNFO fleet)','2706',B),
 'hG':(680,285,'GCP embodiment\n(prophetic)','2708',B),
 'hC':(960,285,'Container embodiment\n(prophetic)','2710',B),
 'r1':(130,375,'Schedule port','2712',B),
 'e1':(400,375,'Cron trigger runs a\nscheduled worker','',B),
 'g1':(680,375,'Cloud Scheduler calls a\nCloud Run service or job','',B),
 'c1':(960,375,'Cron or CronJob calls\nthe container','',B),
 'r2':(130,455,'Store port','2714',B),
 'e2':(400,455,'Edge SQLite-class database\n(D1), object store, KV','',B),
 'g2':(680,455,'Firestore or Cloud SQL,\nCloud Storage','',B),
 'c2':(960,455,'Relational database, object\nstore, message queue','',B),
 'r3':(130,535,'Secrets port','2716',B),
 'e3':(400,535,'Platform secret bindings\n(presence only to tick)','',B),
 'g3':(680,535,'Secret Manager mounted\nas env, presence only','',B),
 'c3':(960,535,'Orchestrator secrets as\nenvironment variables','',B),
 'r4':(130,615,'Model port','2718',B),
 'e4':(400,615,'Edge inference plus\nhosted model API','',B),
 'g4':(680,615,'Vertex AI endpoint plus\nhosted model API','',B),
 'c4':(960,615,'Any inference endpoint,\nlocal or remote','',B),
 'r5':(130,695,'Deploy port','2720',B),
 'e5':(400,695,'Versioned deploy, canary,\nrevert on probe failure','',B),
 'g5':(680,695,'Cloud Run revision, traffic\nsplit, rollback on failure','',B),
 'c5':(960,695,'Image tag rollout and\nrollback by the orchestrator','',B),
 'r6':(130,775,'Health port','2722',B),
 'e6':(400,775,'/health route on worker','',B),
 'g6':(680,775,'/health on Cloud Run plus\nuptime check','',B),
 'c6':(960,775,'/health on container,\nliveness probe','',B),
},[('core','iface'),('iface','hE'),('iface','hG'),('iface','hC')],1120,840)
