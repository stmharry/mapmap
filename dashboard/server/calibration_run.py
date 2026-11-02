"""Repeatable measured calibration with transactional project restoration."""
from calibrate import *

def fit_line(pts):
    vx,vy,x,y=cv2.fitLine(np.float32(pts),cv2.DIST_HUBER,0,.01,.01).ravel()
    return np.array([vy,-vx,vx*y-vy*x],float)

def measure_edges(cfg,blank):
    result=[]
    for e in cfg['edges']:
        im=cv2.GaussianBlur(blank[e['camera']].mean(2),(5,5),1)
        n=np.array(e['line'][:2]);ps=np.array(e['samples']);ps-=((ps@n)+e['line'][2])[:,None]*n
        pts=[]
        for p in ps:
            ts=np.linspace(-5,5,41);xy=p[None,:]+ts[:,None]*n
            row=cv2.remap(im,xy[:,0].astype('float32').reshape(1,-1),xy[:,1].astype('float32').reshape(1,-1),cv2.INTER_LINEAR)[0]
            strength=np.abs(np.gradient(row));j=int(strength.argmax())
            if j<2 or j>len(ts)-3 or strength[j]<.1:continue
            pts.append(xy[j])
        if len(pts)<max(10,len(ps)*.35):raise RuntimeError(f"Cannot see enough of the {e['name']} table edge. Keep cameras fixed and expose the table boundary.")
        line=fit_line(pts)
        if line[:2]@n<0:line=-line
        deviation=np.abs(ps@line[:2]+line[2])
        if np.percentile(deviation,95)>5:raise RuntimeError('Table/camera geometry changed beyond the saved edge search region. Remeasure table boundaries before recalibrating.')
        result.append({**e,'line':line.tolist(),'samples':np.array(pts).tolist()})
    return result

def capture_markers(directory,label):
    # Average a fixed set of fresh frames to reduce sensor noise and rolling-shutter
    # corner jitter. Validation uses a separate pattern and separate acquisition.
    accumulated={c['name']:[] for c in cameras()}
    for i in range(8):
        for c in cameras():
            raw=urllib.request.urlopen(CAM+f"/snapshot/{c['camera_id']}.png",timeout=5).read()
            accumulated[c['name']].append(cv2.imdecode(np.frombuffer(raw,np.uint8),1).astype('float32'))
        time.sleep(.06)
    for name,frames in accumulated.items():cv2.imwrite(str(directory/f'{label}-{name}.png'),np.mean(frames,0).astype('uint8'))

def fit_markers(directory,label,name,variant='markers'):
    src,dst,ids=points(directory/f'{label}-{name}.png',variant)
    if len(ids)<6:raise RuntimeError(f'Not enough readable tabletop markers in {name} view ({len(ids)}).')
    H,mask=cv2.findHomography(src,dst,cv2.RANSAC,2.0)
    if H is None or mask.sum()<20:raise RuntimeError(f'Unreliable {name} camera mapping.')
    return H,src,dst,ids

def edge_check(directory,blank,edges,label='grid'):
    result={}
    for e in edges:
        n=np.array(e['line'][:2]);ps=np.array(e['samples']);ps-=((ps@n)+e['line'][2])[:,None]*n
        im=cv2.imread(str(directory/f"{label}-{e['camera']}.png")).astype('float32').mean(2)-blank[e['camera']].mean(2)
        vals=[]
        for p in ps:
            ts=np.arange(-3,15,.25);xy=p[None,:]-ts[:,None]*n
            row=cv2.remap(im,xy[:,0].astype('float32').reshape(1,-1),xy[:,1].astype('float32').reshape(1,-1),cv2.INTER_LINEAR)[0]
            peak=row.max()
            if peak<40:continue
            idx=np.where(row>max(20,peak*.35))[0]
            vals.append(float(ts[idx[0]]))
        if len(vals)<max(10,len(ps)*.5):raise RuntimeError(f'Projected {e["name"]} border is not sufficiently visible.')
        result[e['name']]={'samples':len(vals),'min_inset_px':min(vals),'median_inset_px':float(np.median(vals)),'max_inset_px':max(vals)}
    return result

def solve(edges,Hs,vertices,w,h,inset):
    S=cv2.getPerspectiveTransform(np.float32([[0,0],[w,0],[0,h],[w,h]]),np.float32(vertices))
    lines={}
    for e in edges:
        H=Hs[e['camera']]@np.linalg.inv(S);line=np.array(e['line']);line[2]+=inset
        lines[e['name']]=H.T@line
    def cross(a,b):
        q=np.cross(lines[a],lines[b])
        if abs(q[2])<1e-8:raise RuntimeError('Table edges do not form a usable quadrilateral.')
        return q[:2]/q[2]
    v=np.array([cross('right','far'),cross('left','far'),cross('right','near'),cross('left','near')])
    if not np.isfinite(v).all() or (v<0).any() or (v[:,0]>w).any() or (v[:,1]>h).any():raise RuntimeError('Table extends beyond projector coverage. Adjust projector placement.')
    return v

def calibrate(args):
    cfg=json.loads((DATA/'table-targets.json').read_text()) if (DATA/'table-targets.json').exists() else None
    if not cfg:raise RuntimeError('Table boundaries have not been measured for this camera setup.')
    w,h=args['width'],args['height']
    if (w,h)!=(cfg['width'],cfg['height']) or args['selectedDisplay']!=cfg['display']:raise RuntimeError('Display mode changed; restore the calibrated display and resolution.')
    cams=cameras();patterns(args)
    directory=DATA/'captures'/time.strftime('%Y%m%dT%H%M%SZ',time.gmtime());directory.mkdir(parents=True,exist_ok=True)
    backup=directory/'before.mmp';rpc('save_project',{'path':str(backup)})
    layer=rpc('list_layers')['layers'][0];original_id=layer['id'];v=np.float32([[p['x'],p['y']] for p in layer['vertices']])
    if v.shape!=(4,2):raise RuntimeError('Calibration needs one four-corner tabletop layer.')
    capture(directory,'before')
    probe={'version':'1.0.0-alpha.1','sources':[{'className':'Image','id':1,'name':'Probe','uri':str(DATA/'media/grid.png'),'x':0,'y':0}],
      'layers':[{'className':'TextureLayer','id':1,'sourceId':1,'name':'Calibration probe','visible':True,
       'source':{'className':'Mesh','nColumns':2,'nRows':2,'vertices':[[0,0],[w,0],[0,h],[w,h]]},
       'destination':{'className':'Mesh','nColumns':2,'nRows':2,'vertices':v.tolist()}}]}
    probe_path=directory/'probe.mmp';probe_path.write_text(json.dumps(probe));success=False
    try:
        rpc('load_project',{'path':str(probe_path)})
        project_file(DATA/'media/blank.png',1)
        blank={c['name']:[] for c in cams}
        for i in range(12):
            for c in cameras():
                raw=urllib.request.urlopen(CAM+f"/snapshot/{c['camera_id']}.png",timeout=5).read()
                blank[c['name']].append(cv2.imdecode(np.frombuffer(raw,np.uint8),1).astype('float32'))
            time.sleep(.06)
        blank={n:np.mean(ims,0) for n,ims in blank.items()}
        for n,im in blank.items():np.save(directory/f'blank-{n}.npy',im);cv2.imwrite(str(directory/f'blank-{n}.png'),im.astype('uint8'))
        edges=measure_edges(cfg,blank)
        project_file(DATA/'media/markers.png',1);capture_markers(directory,'initial-markers')
        Hs={n:fit_markers(directory,'initial-markers',n)[0] for n in blank}
        v=solve(edges,Hs,v,w,h,cfg.get('inset_camera_px',4))
        # Bounded correction passes. Never leave a failed candidate loaded.
        for attempt in range(3):
            rpc('set_vertices',{'id':1,'vertices':[{'x':float(x),'y':float(y)} for x,y in v]})
            project_file(DATA/'media/grid.png',1);capture(directory,'grid')
            measured=edge_check(directory,blank,edges)
            if all(e['min_inset_px']>=1 for e in measured.values()):break
            project_file(DATA/'media/markers.png',1);capture_markers(directory,'correction-markers')
            Hs={n:fit_markers(directory,'correction-markers',n)[0] for n in blank}
            v=solve(edges,Hs,v,w,h,cfg.get('inset_camera_px',4)+attempt+1)
        else:raise RuntimeError('Could not eliminate measured edge spill. Previous mapping restored.')
        project_file(DATA/'media/markers.png',1);capture_markers(directory,'markers')
        Hs={n:fit_markers(directory,'markers',n)[0] for n in blank}
        project_file(DATA/'media/validation.png',1);capture_markers(directory,'validation')
        validation={}
        for n,H in Hs.items():
            src,dst,ids=points(directory/f'validation-{n}.png','validation')
            if len(ids)<6:raise RuntimeError(f'Insufficient independent validation points in {n} view.')
            err=np.linalg.norm(cv2.perspectiveTransform(src.reshape(1,-1,2),H)[0]-dst,axis=1)
            rms=float(np.sqrt(np.mean(err**2)));maximum=float(err.max())
            if rms>2 or maximum>4:raise RuntimeError(f'{n} validation failed: RMS {rms:.2f}px, max {maximum:.2f}px. Previous mapping restored.')
            validation[n]={'validation_points':len(err),'rms_px':rms,'max_px':maximum,'homography':H.tolist()}
        report={'status':'Verified visible area','message':'Visible table edges verified; occluded and off-camera areas are not verified.',
          'full_coverage':False,'coverage':cfg['coverage'],'cameras':validation,'edges':measured,'vertices':[{'x':float(x),'y':float(y)} for x,y in v],
          'display':args['selectedDisplay'],'resolution':[w,h],'verified_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'capture_directory':str(directory)}
        rpc('load_project',{'path':str(backup)})
        rpc('set_vertices',{'id':original_id,'vertices':report['vertices']})
        capture(directory,'restored-image')
        (directory/'verification.json').write_text(json.dumps(report,indent=2));success=True
        return report
    finally:
        if not success:rpc('load_project',{'path':str(backup)})
