import os as _o
OUT = _o.path.dirname(_o.path.dirname(_o.path.abspath(__file__)))
import html, sys, os
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
os.makedirs(OUT, exist_ok=True)
svg('fig30-self-description-generation','FIG. 30  Self-description generation, diff, consistency check and amendment',{
 'a':(300,95,'Trigger: schedule, merge to default\nbranch, or ledger change event','3002',B),
 'b':(300,195,'Read live ledgers: capability, belief,\nvocabulary, objective, SPOF, policy','3004',B),
 'c':(300,295,'Run each claim probe;\nrecord observed result and time','3006',B),
 'd':(300,395,'Assemble records; render canonical\ntext, presence-only access map','3008',B),
 'e':(300,495,'Diff against committed copy\nin the repository','3010',B),
 'f':(300,610,'Every claim has\nevidence?','3012','diamond'),
 'g':(740,610,'Fail check: move claim to honest-gap\nlist or open item with closing probe','3014',B),
 'h':(300,730,'Diff empty?','3016','diamond'),
 'i':(740,730,'Open reviewed change with diff and\nprobe evidence; other agent reviews','3018',B),
 'j':(740,850,'Merge; write doctrine lineage row;\nrepository text now equals system','3020',B),
 'k':(300,850,'Record clean generation\nin tick report; stop','3022',B),
},[('a','b'),('b','c'),('c','d'),('d','e'),('e','f'),('f','g','no',[(520,610)]),('f','h','yes'),('g','h','',[(740,680),(430,730)]),('h','i','no'),('h','k','yes'),('i','j')],960,920)
svg('fig31-self-description-use-bootstrap','FIG. 31  Use of the self-description by sessions, the tick and the bootstrapper',{
 'a':(300,95,'Fresh session, wiped machine or\nnew account with seed and repository','3102',B),
 'b':(300,195,'Read protocol, role file, policy,\nthen self-description','3104',B),
 'c':(300,295,'Derive ceilings, rungs, gates, limits;\nwhat exists; what is broken','3106',B),
 'd':(300,395,'Detect access map: which surfaces\nand credentials exist (presence only)','3108',B),
 'e':(300,510,'Required surface\nmissing?','3110','diamond'),
 'f':(740,510,'Gate card with default in effect\nand closing probe; degrade','3112',B),
 'g':(300,630,'Manager tick consults description:\nitem within ceiling and rung?','3114','diamond'),
 'h':(740,630,'Refuse, record, take next item;\nno workaround of the check','3116',B),
 'i':(300,750,'Claim, act, verify, record\nprovenance and prediction','3118',B),
 'j':(300,860,'Bootstrapper stages 1508 to 1514:\nemit tenant description from policy','3120',B),
 'k':(740,860,'Sync job: repository to tenant database\nand back; platform backlog is tenant one','3122',B),
},[('a','b'),('b','c'),('c','d'),('d','e'),('e','f','yes',[(520,510)]),('e','g','no'),('f','g','',[(740,570),(430,630)]),('g','h','no'),('g','i','yes'),('i','j'),('j','k')],960,930)
