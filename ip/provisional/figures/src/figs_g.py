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
svg('fig28-owner-auth-command','FIG. 28  Emailed-code login, session, step-up and command execution',{
 'a':(240,100,'Owner types login or taps\n"Email me a code"','2802',B),
 'b':(240,215,'Rate check; 6-digit code; hash stored;\nemailed only to preset address','2804',B),
 'c':(240,330,'Owner submits code; hash compared,\nlimited tries, 10 minute lifetime','2806',B),
 'd':(240,445,'Random token stored as hash;\ncookie set, 12 hour session','2808',B),
 'e':(720,100,'Command typed or button tapped\n(same registry, same path)','2810',B),
 'f':(720,230,'Owner session\npresent?','2812','diamond'),
 'g':(720,370,'Destructive and last code\nolder than 15 minutes?','2814','diamond'),
 'h':(720,500,'Registry verb runs;\nno arbitrary shell','2816',B),
 'i':(720,610,'Log row with credential;\nundo recorded where possible','2818',B),
 'r':(240,680,'Refuse: need code or\nloop token cannot act','2820',B),
 'k':(240,560,'Prompt for fresh code\nin place; repeat tap','2822',B),
},[('a','b'),('b','c'),('c','d'),('d','e','session',[(480,445),(480,100)]),('e','f'),('f','g','yes'),('g','h','no'),('h','i'),
  ('f','r','no',[(520,230),(520,680)]),('g','k','yes',[(430,370),(430,560)]),('k','c','verify',[(60,560),(60,330)])],960,740)
svg('fig29-owner-card-lifecycle','FIG. 29  Owner task card lifecycle',{
 'a':(300,95,'Step or question arises\n(detector, manager, session)','2902',B),
 'b':(300,200,'Reversible form constructible\nand in scope?','2904','diamond'),
 'c':(700,200,'Fleet executes it;\ndisposition recorded','2906',B),
 'd':(300,315,'Identity-bound line\npresent?','2908','diamond'),
 'e':(700,315,'List as "fleet is handling";\nnot an owner item','2910',B),
 'f':(300,425,'Open card: title, why, default in\neffect, action, severity,\nclosing probe','2912',B),
 'g':(300,530,'Console shows Why, If you wait,\nTo do, with one-tap buttons','2914',B),
 'h':(300,640,'Owner tap?','2916','diamond'),
 'i':(130,755,'Approve, Decline, Done run at\nthe tap (fresh code if stale)','2918',B),
 'j':(400,755,'Fleet: you do it / I did it:\nclaim card, file work item','2920',B),
 'k':(670,755,'Snooze 7 days or Not needed:\ncard hidden, default stays','2922',B),
 'l':(400,865,'Closing probe or fleet\nverification observes done?','2924','diamond'),
 'm':(400,975,'Close card with resolution,\nevidence and credential','2926',B),
},[('a','b'),('b','c','yes'),('b','d','no'),('d','e','no'),('d','f','yes'),('f','g'),('g','h'),('h','i','decide'),('h','j','hand over'),('h','k','defer'),
  ('i','l'),('j','l'),('k','l'),('l','m','yes'),('l','g','no: keep open',[(880,865),(880,530)])],960,1030)
