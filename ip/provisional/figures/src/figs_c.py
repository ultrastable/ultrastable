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
svg('fig20-goal-lifecycle','FIG. 20  Goal authoring and objective-space lifecycle',{
 'a':(300,76,'Gather signals: proposals,\nquestions, score gaps, heal\nactions, inferred direction','2002',B),
 'b':(300,170,'Synthesize falsifiable candidate goals\nwith definition of done (model)','2004',B),
 'c':(300,270,'Would change the\nobjective itself?','2006','diamond'),
 'd':(700,270,'Ratification queue: status proposed,\nowner principal; never adopted','2008',B),
 'e':(300,380,'Score at or above threshold\nand not a near-duplicate?','2010','diamond'),
 'f':(700,380,'Reject: reason and\nscore recorded','2012',B),
 'g':(300,490,'Anchored to a\nratified objective?','2014','diamond'),
 'h':(700,490,'Probation: novel goal, flagged\noverdue without evidence','2016',B),
 'i':(300,590,'Adopt derived goal: parent\nobjective, alignment, ledger row','2018',B),
 'j':(300,680,'Dispatch and drain: research queue,\ntask ledger, managers','2020',B),
 'k':(300,780,'DoD met, stale past limit,\nor superseded?','2022','diamond'),
 'l':(700,590,'Principal ratifies\nnovel goal?','2024','diamond'),
 'm':(700,700,'Objective space: ratified goal\nbecomes standing, parent for new goals','2026',B),
 'n':(300,890,'Retire with disposition:\nretired_at, reason, ledger cancelled','2028',B),
},[('a','b'),('b','c'),('c','d','yes'),('c','e','no'),('e','f','no'),('e','g','yes'),('g','i','yes'),('g','h','no'),
   ('i','j'),('j','k'),('k','n','yes'),('k','j','no',[(500,780),(500,680)]),
   ('h','l'),('l','m','yes'),('l','n','no or overdue',[(580,590),(580,890)]),
   ('d','l','ratified',[(900,270),(900,590)])],980,950)
svg('fig21-wbs-state','FIG. 21  Work breakdown item state machine with hand-offs and dependency triggers',{
 'a':(300,100,'Backlog: ID, owner role, trigger IDs,\ndone check, milestone','2102',B),
 'b':(300,210,'All trigger IDs\ndone?','2104','diamond'),
 'c':(300,320,'Ready: visible to the owner\nrole in the queue','2106',B),
 'd':(300,430,'In progress: claimed by a doer,\nclaim expires if idle','2108',B),
 'e':(300,540,'Review: hand-off to reviewer\nrole with evidence','2110',B),
 'f':(300,660,'Closing probe\npasses?','2112','diamond'),
 'g':(300,770,'Done: evidence stored,\nplus proposed','2114',B),
 'h':(700,210,'Blocked: names the trigger ID\nor gate it waits on','2116',B),
 'i':(700,100,'Superseded or cancelled:\nreason recorded','2118',B),
 'j':(700,430,'Principal queue: identity-bound\nstep with default and probe','2120',B),
 'k':(700,770,'Release dependents: items naming\nthis ID as trigger re-evaluated','2122',B),
},[('a','b'),('b','c','yes'),('b','h','no'),('h','c','trigger done',[(700,320)]),('h','i','replaced'),
   ('c','d','claim'),('d','e','done claimed'),('d','j','owner-only'),('j','f','principal acts',[(700,660)]),
   ('e','f'),('f','g','yes'),('f','d','no: rework',[(60,660),(60,545),(60,430)]),
   ('g','k'),('k','h','dependents',[(900,770),(900,210)])],980,830)
