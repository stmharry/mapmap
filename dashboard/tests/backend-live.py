"""HTTP integration against isolated dashboard storage; restores real projection."""
import sys,tempfile,subprocess,re,urllib.error,io
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from calibrate import *
with tempfile.TemporaryDirectory(prefix='mapmap-web-test-') as td:
    td=Path(td);before=rpc('list_layers')['layers'];backup=td/'original.mmp';rpc('save_project',{'path':str(backup)})
    env={**os.environ,'MAPMAP_DATA':str(td),'MAPMAP_TOKEN_FILE':str(DATA/'mcp.token'),'PORT':'0'}
    process=subprocess.Popen(['node',str(ROOT/'server/index.mjs')],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    try:
        line=process.stdout.readline();url=re.search(r'http://[^ ]+',line).group(0).strip()
        def request(endpoint,value=None,raw=None,ctype='application/json'):
            data=raw if raw is not None else json.dumps(value).encode() if value is not None else None
            req=urllib.request.Request(url+endpoint,data,{'Content-Type':ctype})
            return json.load(urllib.request.urlopen(req,timeout=15))
        state=request('/api/state');assert state['connected'] and len(state['cameras'])==2
        original=state['layer']['vertices'];ids=[]
        for fmt,ctype in [('PNG','image/png'),('JPEG','image/jpeg')]:
            im=Image.new('RGB',(640,360),'#123547');buf=io.BytesIO();im.save(buf,format=fmt)
            image=request('/api/upload?name=integration.'+fmt.lower(),raw=buf.getvalue(),ctype=ctype);ids.append(image['id'])
            request('/api/project',{'id':image['id']});assert request('/api/state')['layer']['vertices']==original
        input_before=request('/api/state')['layer']['inputVertices'];request('/api/rotate',{});request('/api/rotate',{})
        assert request('/api/state')['layer']['vertices']==original
        assert np.allclose([[p['x'],p['y']] for p in request('/api/state')['layer']['inputVertices']],[[p['x'],p['y']] for p in input_before])
        request('/api/blackout',{'enabled':True});assert request('/api/state')['blackout']
        request('/api/blackout',{'enabled':False});assert request('/api/state')['layer']['visible']
        request('/api/save',{});moved=[{**p,'x':p['x']+.25} for p in original];request('/api/vertices',{'vertices':moved});assert request('/api/state')['layer']['vertices']==moved
        request('/api/restore',{});assert request('/api/state')['layer']['vertices']==original
        for endpoint,data in [('/api/vertices',{'vertices':[original[0]]*4}),('/api/display',{'name':'missing'})]:
            try:request(endpoint,data);raise AssertionError('invalid operation succeeded')
            except urllib.error.HTTPError as e:assert e.code==400
        assert request('/api/state')['layer']['vertices']==original
        print('PASS HTTP: PNG/JPEG upload and gallery, rotation, blackout, fractional nudge, profile save/restore, rejected invalid geometry and display')
    finally:
        rpc('load_project',{'path':str(backup)})
        process.terminate();process.wait(timeout=10)
        assert rpc('list_layers')['layers']==before
        print('PASS: original projection restored; production dashboard storage untouched')
