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
svg('fig22-model-ladder','FIG. 22  Model ladder with escalation, step-down and cap logic',{
 'a':(300,80,'Task arrives with task class','2202',B),
 'b':(300,190,'Answer computable\nby rule or query?','2204','diamond'),
 'c':(680,190,'Run deterministic handler\n(no model call)','2206',B),
 'd':(300,310,'Cache hit and\nnot invalidated?','2208','diamond'),
 'e':(680,310,'Serve cached answer','2210',B),
 'f':(300,420,'Capability gate: keep rungs whose\ncanary passed for this class','2212',B),
 'g':(300,520,'Spend cap for class or\norganization breached?','2214','diamond'),
 'h':(680,520,'Step down to cheaper rung;\nfree fallback if one exists','2216',B),
 'i':(300,640,'Execute on cheapest passing rung','2218',B),
 'j':(300,750,'Output passes schema\nand deterministic gates?','2220','diamond'),
 'k':(680,750,'Escalate one rung;\nbounded retries','2222',B),
 'l':(300,860,'Record cost per verified outcome\nand escalation rate','2224',B),
},[('a','b'),('b','c','yes'),('b','d','no'),('d','e','yes'),('d','f','no'),('f','g'),('g','h','yes'),('g','i','no'),('h','i'),('i','j'),('j','k','no'),('k','f','retry',[(860,750),(860,420)]),('j','l','yes'),('c','l','',[(900,190),(900,860)]),('e','l','',[(1000,310),(1000,860)])],1080,920)
svg('fig23-model-admission','FIG. 23  Calibration and model-admission pipeline',{
 'a':(300,80,'Candidate model proposed\nfor a task class','2302',B),
 'b':(300,185,'Floor check: not in banned class;\ncontext and output limits met?','2304','diamond'),
 'c':(700,185,'Reject; record reason','2306',B),
 'd':(300,300,'Capability canary: tool-call validity,\nschema conformance, context size','2308',B),
 'e':(300,400,'Label agreement check:\nper-question vs organization labels','2310',B),
 'f':(300,510,'Agreement at or above\ngate for the class?','2312','diamond'),
 'g':(700,510,'Reject for that class;\nrecord measured agreement','2314',B),
 'h':(300,630,'Admit: write rung row in\nmodel task matrix','2316',B),
 'i':(300,730,'Monitor: scheduled probes, baselines,\nshadow agreement, cost per outcome','2318',B),
 'j':(300,840,'Drift or regression\nbeyond threshold?','2320','diamond'),
 'k':(700,840,'Demote or remove; revert\nrouting; audit row','2322',B),
},[('a','b'),('b','c','no'),('b','d','yes'),('d','e'),('e','f'),('f','g','no'),('f','h','yes'),('h','i'),('i','j'),('j','k','yes'),('j','i','no',[(60,840),(60,730)]),('k','a','re-test',[(900,840),(900,80)])],1000,900)
