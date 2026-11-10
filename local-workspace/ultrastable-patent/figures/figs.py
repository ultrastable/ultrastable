import html, sys, os
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
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
# FIG 1 system overview
svg('fig01-system-overview','FIG. 1  System overview',{
 'own':(450,80,'Principal (owner / board)\nsets objectives, receives digests','102',B),
 'gov':(450,180,'Governance layer: policy store, interrupt gate,\nlimits, self-amending policy','104','wide'),
 'staff':(450,280,'Virtual staff hierarchy\n(portfolio, program, project, product, specialist agents)','106','wide'),
 'led':(200,390,'Work ledger\n(issues, roadmap, claims)','108',B),
 'pred':(700,390,'Decision and prediction\nledger','110',B),
 'exe':(200,500,'Executor pool\n(AI agents, tools, people)','112',B),
 'ver':(700,500,'Verification engine\n(probes, canary, revert)','114',B),
 'org':(450,610,'Managed organization systems\n(software, services, operations, products)','116','wide'),
 'sig':(450,720,'Signal store: metrics, usage, failures,\nfriction, outcomes','118','wide'),
 'trust':(450,830,'Trust ledger\n(surface x action class)','120',B),
},[('own','gov'),('gov','staff'),('staff','led'),('staff','pred'),('led','exe'),('exe','org'),('exe','ver','deploy'),('ver','sig'),('org','sig'),('sig','trust'),('pred','ver','score'),
  ('sig','staff','feedback',[(80,720),(80,280)]),('trust','gov','scope',[(900,830),(900,180)])],960,890)
# FIG 2 hierarchy
svg('fig02-virtual-staff','FIG. 2  Virtual staff hierarchy',{
 'p':(480,90,'Virtual portfolio manager\nallocates capacity across programs','202',B),
 'g1':(180,210,'Virtual program manager\n(program A: charter, metric)','204a',B),
 'g2':(480,210,'Virtual program manager\n(program B)','204b',B),
 'g3':(780,210,'Virtual program manager\n(program N)','204n',B),
 'j1':(180,330,'Virtual project manager\n(milestones, dependencies)','206',B),
 'd1':(480,330,'Virtual product manager\n(product register, plus loop)','208',B),
 'q':(780,330,'Quality / review agent\n(two-family review gate)','210',B),
 's1':(180,450,'Specialist staff agents\n(finance, comms, ops, research)','212',B),
 'x':(480,450,'Executor agents\n(code, content, analysis)','214',B),
 'a':(780,450,'Auditor / calibrator agent\n(scores predictions, trust)','216',B),
 'brief':(480,570,'Persona briefs and digest to principal','218','wide'),
},[('p','g1'),('p','g2'),('p','g3'),('g1','j1'),('g2','d1'),('g3','q'),('j1','s1'),('d1','x'),('q','a'),('s1','brief'),('x','brief'),('a','brief')],960,620)
# FIG 3 portfolio tick
svg('fig03-manager-tick','FIG. 3  Periodic manager tick',{
 'a':(330,80,'Start tick (schedule)','302',B),'b':(330,170,'Snapshot program risk and\nquality index once','304',B),
 'c':(330,260,'Compute allocation: share of focus\nslots, half even, half by risk','306',B),
 'd':(330,350,'Classify decision per program\n(constrain/escalate/accelerate/\nmaintain/idle)','308',B),
 'e':(330,440,'Program managers rank candidates\n(primary metric, guard, severity, age)','310',B),
 'f':(330,530,'Act: promote, close with evidence,\nsupersede, demote, assign doer','312',B),
 'g':(330,620,'Originate roadmap items and plusses','314',B),
 'h':(330,710,'Log actions with prior values and\npredictions; write briefs','316',B),
},[('a','b'),('b','c'),('c','d'),('d','e'),('e','f'),('f','g'),('g','h'),('h','a','next tick',[(560,710),(560,80)])],700,760)
# FIG 4 plus loop
svg('fig04-plus-loop','FIG. 4  Plus loop (evidence-driven improvement)',{
 'a':(330,80,'Pick product: oldest last-plus,\nweighted by usage and friction','402',B),
 'b':(330,170,'Gather evidence without principal\ninput (usage, errors, asks, peers)','404',B),
 'c':(330,260,'Write one additive, reversible plus\nwith stated prediction','406',B),
 'd':(330,350,'Ship via work ledger, executor,\ncanary and automatic revert','408',B),
 'e':(330,460,'Outcome improved and\nno guard regressed?','410','diamond'),
 'k':(150,580,'Keep; seed next plus\n("plus the plus")','412',B),
 'r':(510,580,'Revert; try new angle;\nrest after 3 misses','414',B),
 's':(330,690,'Every Nth cycle: simplify pass;\nweekly digest to principal','416',B),
},[('a','b'),('b','c'),('c','d'),('d','e'),('e','k','yes'),('e','r','no'),('k','s'),('r','s'),('s','a','next cycle',[(620,690),(620,80)])],720,740)
# FIG 5 predict-verify
svg('fig05-predict-verify','FIG. 5  Predict, act, verify, score',{
 'a':(330,80,'Decision with logged prediction\n(metric, operator, value, window)','502',B),
 'b':(330,170,'Execute through canonical path\n(claim, change, review gate)','504',B),
 'c':(330,270,'Declared probes pass\nafter deploy?','506','diamond'),
 'r':(600,270,'Automatic revert;\nrecord failure','508',B),
 'd':(330,370,'Verified live; close with evidence','510',B),
 'e':(330,460,'At window end: score prediction\nagainst observed metric','512',B),
 'f':(330,550,'Update calibration and trust\nfor (surface, action class)','514',B),
},[('a','b'),('b','c'),('c','r','no'),('c','d','yes'),('d','e'),('r','f'),('e','f'),('f','a','next decision',[(80,550),(80,80)])],800,600)
# FIG 6 trust & gate
svg('fig06-trust-gate','FIG. 6  Trust-gated autonomy and interrupt gate',{
 'a':(330,80,'Proposed action','602',B),
 'b':(330,180,'Irreversible AND identity-bound\nwith no reversible path?','604','diamond'),
 'o':(640,180,'Principal card with default,\nreason and closing probe','606',B),
 'c':(330,290,'Trust for (surface, class) at or\nabove rung threshold?','608','diamond'),
 'n':(640,290,'Narrow: assisted path or\nadded review','610',B),
 'd':(330,400,'Execute autonomously within\nrung scope','612',B),
 'e':(330,490,'Outcome adjusts trust;\nrung transition recorded','614',B),
},[('a','b'),('b','o','yes'),('b','c','no'),('c','n','no'),('c','d','yes'),('n','e'),('d','e')],820,540)
# FIG 7 self-amending policy
svg('fig07-self-amend','FIG. 7  Self-amending policy from friction and recurrence',{
 'a':(330,80,'Scan agent outputs and principal\nmessages for signatures','702',B),
 'b':(330,170,'Signature repeats past threshold\n(e.g. 3 in 7 days, one source)','704',B),
 'c':(330,260,'Generate policy amendment proposal','706',B),
 'd':(330,350,'Red-team; replay against\ntrailing ticks','708',B),
 'e':(330,450,'Preserves fixed limits and\nimproves replay?','710','diamond'),
 'f':(150,560,'Adopt by reviewed change;\nbump version; record lineage','712',B),
 'g':(510,560,'Reject; record reason','714',B),
},[('a','b'),('b','c'),('c','d'),('d','e'),('e','f','yes'),('e','g','no'),('f','a','',[(40,560),(40,80)])],720,610)
# FIG 8 root cause
svg('fig08-root-cause','FIG. 8  Recurrence and root-cause loop',{
 'a':(330,80,'Group issues into families;\ncount reopens and new items','802',B),
 'b':(330,180,'Family reopened >= K times\nand still active?','804','diamond'),
 'c':(330,290,'File one root-cause item at top\npriority in its program focus','806',B),
 'd':(330,380,'Diagnostic agent names producer,\nclosing probe, smallest fix','808',B),
 'e':(330,470,'Close when family quiet for T;\nreopen on recurrence','810',B),
},[('a','b'),('b','c','yes'),('c','d'),('d','e'),('e','a','',[(80,470),(80,80)])],700,520)
# FIG 9 generalization
svg('fig09-any-organization','FIG. 9  Role templates applied to any organization',{
 'core':(450,90,'Organization-independent core: ledgers, ticks,\nprediction scoring, trust, gate, plus loop','902','wide'),
 'cfg':(450,190,'Tenant configuration: programs, charters, metrics,\nproducts, executors, limits','904','wide'),
 'r1':(150,310,'Software company\n(services, releases)','906a',B),
 'r2':(450,310,'Marketing / media\n(campaigns, channels)','906b',B),
 'r3':(750,310,'Operations / finance\n(processes, budgets)','906c',B),
 'r4':(150,420,'Research lab\n(papers, experiments)','906d',B),
 'r5':(450,420,'Nonprofit / public body\n(programs, grants)','906e',B),
 'r6':(750,420,'Personal or family office\n(separated plane)','906f',B),
},[('core','cfg'),('cfg','r1'),('cfg','r2'),('cfg','r3'),('cfg','r4'),('cfg','r5'),('cfg','r6')],920,470)
# FIG 10 claims & fencing
svg('fig10-work-claims','FIG. 10  Work claims with expiry and fencing token',{
 'a':(330,80,'Agent requests claim on component\n(path, intent, holder)','1002',B),
 'b':(330,180,'Live unexpired claim held\nby another agent?','1004','diamond'),
 'r':(620,180,'Do not duplicate: review the\nclaimed change or take next item','1006',B),
 'c':(330,290,'Grant claim: token, expiry,\nfence = previous fence + 1','1008',B),
 'd':(330,380,'Write to component presenting\ntoken and fence; renew by heartbeat','1010',B),
 'e':(330,480,'Resource accepts write only for\nlive token and current fence?','1012','diamond'),
 'x':(620,480,'Reject stale write','1014',B),
 'f':(330,590,'Release with outcome; reaper\nreleases expired claims','1016',B),
},[('a','b'),('b','r','yes'),('b','c','no'),('c','d'),('d','e'),('e','x','no'),('e','f','yes')],840,640)
# FIG 11 reconciliation & principal queue
svg('fig11-reconcile-queue','FIG. 11  Reconciliation and principal queue',{
 'a':(330,80,'Each tick: diff active work set\nagainst previous tick','1102',B),
 'b':(330,185,'Item left active set without\na disposition?','1104','diamond'),
 'c':(660,185,'Record silent-drop incident;\nreopen item','1106',B),
 'd':(330,300,'Step routed to principal?','1108','diamond'),
 'n':(660,300,'Virtual staff execute step','1118',B),
 'e':(330,415,'Card has identity-bound line?','1110','diamond'),
 'f':(660,415,'Reroute card to virtual staff','1112',B),
 'g':(330,525,'Hold card: default in effect,\nreason, closing probe','1114',B),
 'h':(330,625,'Closing probe observes step done:\nclose card automatically','1116',B),
},[('a','b'),('b','c','yes'),('b','d','no'),('d','n','no'),('d','e','yes'),('e','f','no'),('e','g','yes'),('g','h')],880,680)
# FIG 12 deploy & review path
svg('fig12-change-path','FIG. 12  Canonical change path',{
 'a':(330,80,'Executor produces change\nunder a work claim','1202',B),
 'b':(330,180,'Change touches a risk class\n(auth, routes, data, workflow)?','1204','diamond'),
 'c':(620,180,'Review by models of two\ndisjoint families; hold on\nverified high finding','1206',B),
 'd':(330,290,'Checks green: merge;\ndeploy under deploy lock','1208',B),
 'e':(330,380,'Run declared probes\n(routes, content, data statements)','1210',B),
 'f':(330,480,'Probe passed before and\nfails after?','1212','diamond'),
 'g':(620,480,'Revert to prior version;\nfile failure item','1214',B),
 'h':(330,590,'Record deploy ledger row;\ncapture outcome baseline','1216',B),
},[('a','b'),('b','c','yes'),('b','d','no'),('c','d'),('d','e'),('e','f'),('f','g','yes'),('f','h','no')],860,640)
# FIG 13 model ladder
svg('fig13-model-ladder','FIG. 13  Cost-aware model ladder',{
 'a':(330,80,'Task with task class','1302',B),
 'b':(330,170,'Read ladder for class:\nmodels ordered by cost, capability','1304',B),
 'c':(330,270,'Spending cap for class\nor fleet breached?','1306','diamond'),
 'd':(620,270,'Step down to cheaper rung;\ndo not stop work','1308',B),
 'e':(330,370,'Call model; validate output\nagainst schema and gates','1310',B),
 'f':(330,470,'Output invalid?','1312','diamond'),
 'g':(620,470,'Escalate one rung\n(bounded retries)','1314',B),
 'h':(330,570,'Record cost per verified outcome','1316',B),
},[('a','b'),('b','c'),('c','d','yes'),('c','e','no'),('d','e'),('e','f'),('f','g','yes'),('f','h','no'),('g','e','',[(760,470),(760,370)])],860,620)
# FIG 14 deployment embodiments
svg('fig14-deployment','FIG. 14  Deployment embodiments',{
 'core':(450,80,'Organization-independent core\n(persona, tick, ledger, gate, plus, trust modules)','1402','wide'),
 'e1':(200,200,'Edge embodiment: scheduled\nserverless workers','1404',B),
 'e2':(700,200,'Portable embodiment: containers\nwith scheduled jobs','1406',B),
 's1':(200,300,'Relational store (SQLite-class),\nobject store, key-value store','1408',B),
 's2':(700,300,'Relational database, object\nstore, message queue','1410',B),
 'x':(450,410,'Executor adapters: open models, hosted\ncoding agents, interactive sessions, people','1412','wide'),
 'm':(450,510,'Managed systems as surfaces with probes\n(repositories, services, channels, processes)','1414','wide'),
},[('core','e1'),('core','e2'),('e1','s1'),('e2','s2'),('s1','x'),('s2','x'),('x','m')],920,560)
# FIG 15 bootstrapper
svg('fig15-bootstrap','FIG. 15  Idea-to-organization bootstrapper',{
 'a':(330,80,'Idea file: idea, users, first outcomes,\nconstraints (sole human input)','1502',B),
 'b':(330,170,'Read and detect: credentials and tools\npresent (presence only), environment','1504',B),
 'c':(330,260,'Select: model tier from stated budget;\nreviewer model of another family','1506',B),
 'd':(330,350,'Plan: roles per outcome, shared staff,\nbacklog, items, predictions, gate cards','1508',B),
 'e':(330,440,'Write: charter, roles, instruction files,\nautonomy policy, idempotent seed SQL','1510',B),
 'f':(330,530,'Provision: database, server worker,\nscheduled heartbeat','1512',B),
 'g':(330,620,'Start: first tick; boot success stored\nas a scored prediction','1514',B),
 'x':(660,350,'Stage fails: record as work item\n(owner, blocker, closing probe);\ncontinue degraded','1516',B),
},[('a','b'),('b','c'),('c','d'),('d','e'),('e','f'),('f','g'),('d','x','on failure',[(520,350)])],900,680)
