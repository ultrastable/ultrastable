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
svg('fig18-fleet-topology','FIG. 18  Fleet topology and closed operating loop',{
 's1':(230,100,'Scheduler A: platform cron triggers\n(per-worker, native)','1802',B),
 's2':(730,100,'Scheduler B: dynamic dispatcher\n(per-minute, reads cron table)','1804',B),
 'mt':(480,215,'Manager ticks (steps written to tick evidence)\nportfolio / program / product','1806','wide'),
 'wl':(230,330,'Work ledger\n(items, doer lines, claims)','1808',B),
 'ex':(730,330,'Executors\n(task engine, agents, run ledger)','1810',B),
 'dp':(730,445,'Deploy engine\n(build, deploy, version poll)','1812',B),
 'pr':(730,560,'Probes\n(health, content, freshness)','1814',B),
 'ss':(480,675,'Signal store\n(runs, probe log, metrics, signals)','1816','wide'),
 'dm':(230,560,'Dead-man check\n(missing tick slot = failure)','1818',B),
},[('s1','mt'),('s2','mt'),('mt','wl'),('wl','ex'),('ex','dp'),('dp','pr'),('pr','ss'),('ex','ss','run records',[(900,330),(900,615),(640,615)]),
  ('ss','dm'),('dm','mt','alert',[(60,560),(60,215)]),('ss','mt','feedback',[(480,780),(960,780),(960,215)])],1040,820)
svg('fig19-wiring-dashboard-dataflow','FIG. 19  Wiring graph, dashboard data flow and report-card computation',{
 'a':(240,100,'Platform scripts API\n(enumerate workers, bindings)','1902',B),
 'b':(720,100,'Wiring sweep\n(trigger + binding layer)','1904',B),
 'c':(240,215,'Wiring graph store\n(workers, edges, resources)','1906',B),
 'r':(720,215,'Service registry\n(declared purpose, owner, status)','1908',B),
 'd':(480,335,'Graph analyzer: islands, sinks, sources,\nunresolved targets, density, orphan tables','1910','wide'),
 'e':(240,455,'Integration score\nstate table','1912',B),
 'f':(720,455,'Operational state API\n(probes, 24h requests, errors, drift)','1914',B),
 'g':(480,575,'Report-card computation: dimension scores,\nmean, objective-function terms','1916','wide'),
 'h':(240,695,'Dashboard pages\n(auto-refresh)','1918',B),
 'i':(720,695,'Owner digest\n(brief, weekly report)','1920',B),
 'j':(480,805,'Kaizen loop dispositions gap rows -> work ledger','1922','wide'),
},[('a','b'),('b','c'),('r','d'),('c','d'),('d','e'),('d','g'),('f','g'),('e','g'),('g','h'),('g','i'),('h','j'),('i','j'),
  ('j','b','re-sweep',[(960,805),(960,100)])],1040,870)
