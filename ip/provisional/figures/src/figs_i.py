import os as _o
OUT = _o.path.dirname(_o.path.dirname(_o.path.abspath(__file__)))
import html, sys, os
import os as _o
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
_o.makedirs(OUT, exist_ok=True)
svg('fig32-function-chain-model','FIG. 32  Business function chain: registries, dependencies and gates',{
 'a':(190,95,'Business function registry\nfunction, persona, schema,\ndone check, gate class','3202',B),
 'b':(560,95,'Artifact registry\nrepo path, status, evidence,\nreviewer, function','3204',B),
 'c':(930,95,'Dependency graph\nneeds / gate edges\nbetween functions','3206',B),
 'd':(190,225,'Planner output: backlog rows\n(owner role, trigger, done\ncheck, milestone, label)','3208',B),
 'e':(560,225,'Ready test: needs done,\ngate label open, claim free','3210','diamond'),
 'f':(130,400,'Product development\n(work items)','3212',B),
 'g':(400,400,'Intellectual property\ndisclosure, prior art, draft,\nclaims, checklist, log','3214',B),
 'h':(690,400,'Gate: filed\nowner signs; card','3216',B),
 'i':(980,360,'Marketing, promotion,\nevents, public site','3218',B),
 'j':(980,480,'Funding kits (private);\nsubmissions are owner steps','3220',B),
 'k':(250,560,'Reviewer, other model family\nchecks each artifact','3222',B),
 'l':(620,560,'Consistency check across\nartifacts: mismatch list empty','3224',B),
 'm':(980,620,'Owner task queue\nidentity-bound cards','3226',B),
 'n':(440,700,'Done check and closing probe pass:\nstatus verified, trust updated','3228',B),
},[('a','d'),('b','e'),('c','e'),('d','e'),('e','f'),('e','g'),('g','h','package'),
   ('h','i','open',[(815,400),(815,360)]),('h','j','private',[(815,440),(815,480)]),('h','m','card',[(790,440),(790,610)]),
   ('g','k'),('k','l'),('l','n'),('l','g','mismatch: reopen',[(520,480)])],1130,760)
svg('fig33-idea-to-business','FIG. 33  Idea file to a running business function chain',{
 'a':(260,90,'Idea file: idea, users,\noutcomes, constraints','3302',B),
 'b':(260,190,'Read and detect: parse idea,\ncredential presence, tools','3304',B),
 'c':(260,290,'Select model tier from budget;\nreviewer of another family','3306',B),
 'd':(260,400,'Plan: org, KIT items, function\nbacklog, predictions, gate cards','3308',B),
 'e':(260,510,'Write: charter, registries,\nrole files, seed statements','3310',B),
 'f':(260,620,'Provision: database, worker,\nschedule (first run pending)','3312',B),
 'g':(260,730,'Start: schedule armed;\nheartbeat prediction scored','3314',B),
 'h':(760,190,'Tick: manager takes next ready\nitem (needs met, gate open)','3316',B),
 'i':(760,300,'Predict, then produce the\nartifact in the repository','3318',B),
 'j':(760,410,'Independent review and\nconsistency check','3320',B),
 'k':(760,530,'Identity-bound and\nirreversible step?','3322','diamond'),
 'l':(1010,640,'Owner card with prepared\npackage and closing probe','3324',B),
 'm':(760,740,'Close: evidence, trust ledger,\nregistry status, plus proposed','3326',B),
},[('a','b'),('b','c'),('c','d'),('d','e'),('e','f'),('f','g'),('g','h','ticks',[(500,730),(500,190)]),
   ('h','i'),('i','j'),('j','k'),('k','l','yes',[(1010,530)]),('k','m','no'),('l','m','probe sees step',[(1010,740)]),
   ('m','h','',[(580,740),(580,230)])],1180,880)
