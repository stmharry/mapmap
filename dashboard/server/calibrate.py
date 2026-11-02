"""Camera/projector calibration. All image coordinates are full capture pixels.
Tabletop destination Mesh order is [far-left, far-right, near-left, near-right].
"""
import os,sys,json,time,urllib.request,uuid
from pathlib import Path
import cv2
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
DATA=Path(os.environ.get('MAPMAP_DATA',ROOT/'data'))
CAM=os.environ.get('CAMERA_URL','http://127.0.0.1:6060')
SERIALS=['261222075881','310222077068']
def rpc(name,args=None):
    token=Path(os.environ.get('MAPMAP_TOKEN_FILE',DATA/'mcp.token')).read_text().strip()
    data=json.dumps({'jsonrpc':'2.0','id':str(uuid.uuid4()),'method':'tools/call','params':{'name':name,'arguments':args or {}}}).encode()
    req=urllib.request.Request(os.environ.get('MAPMAP_RPC','http://127.0.0.1:49452/mcp'),data,{'Content-Type':'application/json','Authorization':'Bearer '+token})
    r=json.load(urllib.request.urlopen(req,timeout=10));result=r.get('result',{})
    if 'error' in r or result.get('isError'):raise RuntimeError(r.get('error',{}).get('message') or result['content'][0]['text'])
    return result.get('structuredContent',result)
def cameras():
    status=json.load(urllib.request.urlopen(CAM+'/status',timeout=5))
    result=[]
    for serial in SERIALS:
        c=next((c for c in status['cameras'] if c['serial_number']==serial),None)
        if c is None or c['state']!='live' or c['age_ms'] is None or c['age_ms']>500:raise RuntimeError('Both tabletop cameras must have fresh frames.')
        result.append(c)
    return result
def capture(directory,label):
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=True)
    paths=[]
    for c in cameras():
        raw=urllib.request.urlopen(CAM+f"/snapshot/{c['camera_id']}.png",timeout=5).read()
        p=directory/f"{label}-{c['name']}.png";p.write_bytes(raw);paths.append(str(p))
    return paths
def patterns(args):
    w,h=int(args.get('width',1920)),int(args.get('height',1080));media=DATA/'media';media.mkdir(parents=True,exist_ok=True)
    grid=np.zeros((h,w,3),np.uint8)
    for x in np.linspace(0,w-1,13).astype(int):cv2.line(grid,(x,0),(x,h-1),(65,110,140),2)
    for y in np.linspace(0,h-1,9).astype(int):cv2.line(grid,(0,y),(w-1,y),(65,110,140),2)
    cv2.rectangle(grid,(3,3),(w-4,h-4),(255,255,255),4)
    for text,pt in [('FAR EDGE',(w//3,80)),('ROBOT-SIDE EDGE',(w//3,h-50))]:cv2.putText(grid,text,pt,cv2.FONT_HERSHEY_SIMPLEX,1.6,(255,255,255),3)
    for i,(x,y) in enumerate([(80,150),(w-220,150),(80,h-140),(w-220,h-140)]):cv2.putText(grid,str(i+1),(x,y),cv2.FONT_HERSHEY_SIMPLEX,2,(0,255,255),5)
    cv2.imwrite(str(media/'grid.png'),grid)
    cv2.imwrite(str(media/'blank.png'),np.zeros_like(grid))
    cv2.imwrite(str(media/'white.png'),np.full_like(grid,190))
    dic=cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_100)
    for variant in ['markers','validation']:
        im=np.zeros((h,w),np.uint8);coords={};size=int(min(w/10,h/7))
        xs=np.linspace(90,w-size-90,7) if variant=='markers' else np.linspace(140,w-size-140,6)
        ys=np.linspace(60,h-size-60,5) if variant=='markers' else np.linspace(120,h-size-120,4)
        for i,(y,x) in enumerate((y,x) for y in ys for x in xs):
            x,y=int(x),int(y);idx=i if variant=='markers' else i+50
            im[y-12:y+size+12,x-12:x+size+12]=255
            im[y:y+size,x:x+size]=cv2.aruco.generateImageMarker(dic,idx,size)
            coords[str(idx)]=[[x,y],[x+size-1,y],[x+size-1,y+size-1],[x,y+size-1]]
        cv2.imwrite(str(media/(variant+'.png')),im)
        (media/(variant+'.json')).write_text(json.dumps(coords))
    return {'width':w,'height':h,'message':'Patterns generated'}
def project_file(file,layer_id):
    file=str(Path(file).resolve());sources=rpc('list_sources')['sources'];source=next((s for s in sources if s.get('uri')==file),None)
    if source is None:source=rpc('create_media_source',{'uri':file,'is_image':True})
    rpc('set_layer_source',{'id':layer_id,'source_id':source['id']});rpc('set_layer_visible',{'id':layer_id,'value':True})
    time.sleep(.7)
def points(image,variant='markers'):
    im=cv2.imread(str(image),cv2.IMREAD_GRAYSCALE)
    # Markers are decoded at camera capture resolution; no invented upscaled accuracy.
    params=cv2.aruco.DetectorParameters();params.cornerRefinementMethod=cv2.aruco.CORNER_REFINE_SUBPIX;params.cornerRefinementWinSize=3
    detector=cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_100),params)
    cs,ids,_=detector.detectMarkers(im)
    refs=json.loads((DATA/'media'/f'{variant}.json').read_text());src=[];dst=[];markerids=[]
    cfg=json.loads((DATA/'table-targets.json').read_text()) if (DATA/'table-targets.json').exists() else {}
    camera='observer' if 'observer' in str(image) else 'top'
    exclusions=cfg.get('exclusion_polygons',{}).get(camera,[])
    if ids is not None:
        for c,idx in zip(cs,ids.ravel()):
            if str(idx) not in refs:continue
            if any(cv2.intersectConvexConvex(c.reshape(-1,2),np.float32(poly))[0]>0 for poly in exclusions):continue
            src.extend(refs[str(idx)]);dst.extend(c.reshape(-1,2));markerids.append(int(idx))
    return np.float32(src),np.float32(dst),markerids
if __name__=='__main__':
    try:
        args=json.load(sys.stdin);cmd=sys.argv[1]
        if cmd=='patterns':result=patterns(args)
        elif cmd=='capture':result={'paths':capture(args.get('directory',DATA/'captures'),args.get('label','frame'))}
        elif cmd=='validate_image':
            with Image.open(args['file']) as im:
                if im.width*im.height>40000000:raise ValueError('Image exceeds 40 megapixels')
                im.verify()
            result={'valid':True}
        elif cmd=='calibrate':
            from calibration_run import calibrate
            result=calibrate(args)
        else:raise ValueError('Unknown worker command')
        print(json.dumps(result))
    except Exception as e:print(str(e),file=sys.stderr);sys.exit(1)
