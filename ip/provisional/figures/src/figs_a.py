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
svg('fig16-recognition-redirect','FIG. 16  Recognition-and-redirect pipeline',{
 'a':(300,80,'Draft output forms\n(report, reply, log line)','1602',B),
 'b':(300,170,'Match signatures against\nregister and phrases','1604',B),
 'c':(300,270,'Signature hit?','1606','diamond'),
 'd':(300,380,'Classify the stop: refusal or limit\nstated with reason, or interrupt-eligible?','1608',B),
 'e':(300,480,'Redirect: rewrite by signature class\n(adopt, decide, choose, first person)','1610',B),
 'f':(300,580,'Re-execute abandoned path\nin the same output; verify','1612',B),
 'g':(300,680,'Emit output as done\n(four-line report)','1614',B),
 'h':(740,380,'Report as disposition: card with\nIDENTITY-BOUND line, claim or issue,\nclosing probe','1616',B),
 'i':(740,580,'Record hit: false_stop_hits,\ntrust deduction, metric','1618',B),
 'j':(740,680,'3 hits in 7 days from one source:\nfile doctrine proposal (FIG. 7)','1620',B),
},[('a','b'),('b','c'),('c','d','hit'),('d','e','false stop'),('d','h','excluded',[(520,380)]),('e','f'),('f','g'),('f','i','record',[(520,580)]),('h','i'),('i','j'),
  ('c','g','no hit',[(60,270),(60,680)])],960,740)
svg('fig17-tick-trust-wheel','FIG. 17  Tick with evidence and trust-scope wheel',{
 't1':(250,90,'Reconcile; recognize and redirect\n(steps 1-2)','1702',B),
 't2':(250,180,'Infer direction; pull from driver\n(steps 3-4)','1704',B),
 't3':(250,270,'Dispatch or execute; verify\n(steps 5-6)','1706',B),
 't4':(250,360,'Compare prediction; log provenance;\nadoption gate; report (steps 7-10)','1708',B),
 't5':(250,450,'Accrue trust; probe failure modes;\nscan gaps; coin; author; refresh;\nadvance horizon; audit (steps 11-18)','1710',B),
 't6':(250,540,'Evolve doctrine; emit tick evidence\n(steps 19-20)','1712',B),
 'ev':(250,640,'tick_runs: tick_id, step,\nok, evidence, ts','1714',B),
 'w1':(730,150,'Autonomous action','1716',B),
 'w2':(730,300,'Verified outcome','1718',B),
 'w3':(730,450,'Trust deposit\n(surface, action class)','1720',B),
 'w4':(730,600,'Wider scope\n(ladder position)','1722',B),
},[('t1','t2'),('t2','t3'),('t3','t4'),('t4','t5'),('t5','t6'),('t6','ev'),
  ('w1','w2'),('w2','w3'),('w3','w4'),('w4','w1','more action',[(900,600),(900,150)]),
  ('t3','w1','',[(490,270),(490,150)]),('t5','w3','',[(490,450)])],980,700)
