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
D='diamond'
svg('fig24-audit-verify-correct','FIG. 24  Audit, verify and correct cycle with realization gate',{
 'a':(300,90,'Read live state with a measured\nclock (probes, queries)','2402',B),
 'b':(300,185,'Record numbered finding:\nevidence, falsifier, state','2404',B),
 'c':(300,280,'Verification document: re-test\nfinding by an independent path','2406',B),
 'd':(300,390,'Reproduces?','2408',D),
 'e':(700,390,'Correction / retraction document\nsupersedes finding, keeps history','2410',B),
 'f':(300,500,'Act: patch, tombstone, dispatch,\nflag or register change','2412',B),
 'g':(300,610,'Realization gate:\nobserved live?','2414',D),
 'h':(700,610,'Code-only: mark pending; set\ndeciding query, next check','2416',B),
 'i':(300,720,'Capstone: structural cause across\nfindings, three-way roster check','2418',B),
 'j':(300,815,'Feed failure mode register and\nsilent-drop reconciliation (FIG. 25)','2420',B),
},[('a','b'),('b','c'),('c','d'),('d','e','no',None),('d','f','yes'),('f','g'),('g','h','no'),('g','i','yes'),('e','i','',[(930,390),(930,720)]),('i','j'),
 ('h','c','re-test',[(860,610),(860,280)]),
 ('j','a','next audit',[(60,815),(60,90)])],960,880)
svg('fig25-failure-mode-register','FIG. 25  Failure mode register, remediation contract, loop breaker, reconciliation',{
 'a':(300,90,'Failure mode register: id, detector\nquery, threshold, severity','2502',B),
 'b':(300,185,'Hourly detector run, one evidence\nrow per detector','2504',B),
 'c':(300,285,'Detector fires?','2506',D),
 'd':(300,390,'Open item with remediation contract:\nowner, doer, trigger, closing probe','2508',B),
 'e':(300,490,'Remediation consumer runs step\nand books outcome bucket','2510',B),
 'f':(300,590,'Closing probe passes?','2512',D),
 'g':(300,695,'Close with evidence; score\nprediction; update register','2514',B),
 'h':(700,390,'Loop breaker: same signature 3x\nin 24 h, file root-cause item','2516',B),
 'i':(700,490,'Silent-drop reconciliation:\nscanned = sum of buckets?','2518',B),
 'j':(700,590,'Unaccounted items: incident,\nreopen, block parent close','2520',B),
 'k':(700,695,'Roster reconciliation: registry,\nscan set, probe set, live list','2522',B),
},[('a','b'),('b','c'),('c','d','yes'),('d','e'),('e','f'),('f','g','yes'),
 ('f','e','retry',[(100,590),(100,490)]),
 ('d','h','repeat'),('e','i'),('i','j','no'),('j','k'),
 ('c','b','no, next run',[(90,285),(90,185)]),
 ('k','a','new detectors',[(900,695),(900,90)])],1000,760)
