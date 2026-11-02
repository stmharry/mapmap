"""Exercise the compiled control API; always restore the original projection."""
import sys,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from calibrate import *
with tempfile.TemporaryDirectory(prefix='mapmap-api-') as td:
    td=Path(td);backup=td/'before.mmp';rpc('save_project',{'path':str(backup)})
    before=rpc('list_layers')['layers'];layer=before[0];lid=layer['id'];original=layer['vertices'];input_before=layer['inputVertices']
    try:
        displays=rpc('list_displays');assert any(d['name']=='HDMI-1-0' for d in displays['displays'])
        try:rpc('set_output_display',{'name':'not-a-connected-display'});raise AssertionError('missing display accepted')
        except RuntimeError:pass
        assert rpc('list_displays')['selected']==displays['selected']
        imported=[]
        for ext,size,color in [('png',(320,240),'red'),('jpg',(640,360),'blue')]:
            file=td/f'test.{ext}';Image.new('RGB',size,color).save(file)
            src=rpc('create_media_source',{'uri':str(file),'is_image':True});imported.append(src['id']);rpc('set_layer_source',{'id':lid,'source_id':src['id']})
            assert rpc('list_layers')['layers'][0]['vertices']==original
        inputs=rpc('list_layers')['layers'][0]['inputVertices'];rpc('rotate_source_180',{'id':lid});assert rpc('list_layers')['layers'][0]['vertices']==original
        rpc('rotate_source_180',{'id':lid});assert np.allclose([[p['x'],p['y']] for p in rpc('list_layers')['layers'][0]['inputVertices']],[[p['x'],p['y']] for p in inputs],atol=1e-7)
        rpc('rotate_source_180',{'id':lid});rotated=rpc('list_layers')['layers'][0]['inputVertices']
        for source_id in imported:rpc('set_layer_source',{'id':lid,'source_id':source_id})
        assert np.allclose([[p['x'],p['y']] for p in rpc('list_layers')['layers'][0]['inputVertices']],[[p['x'],p['y']] for p in rotated],atol=1e-7)
        assert rpc('list_layers')['layers'][0]['vertices']==original
        print('PASS: rotated crop survives a PNG/JPEG size-change round trip')
        for bad in [[original[0],original[1],original[3],original[2]],[{'x':'oops','y':0}]*4]:
            try:rpc('set_vertices',{'id':lid,'vertices':bad});raise AssertionError('invalid geometry accepted')
            except RuntimeError:pass
            assert rpc('list_layers')['layers'][0]['vertices']==original
        rpc('set_layer_visible',{'id':lid,'value':False});assert not rpc('list_layers')['layers'][0]['visible']
        rpc('set_layer_visible',{'id':lid,'value':True});assert rpc('list_layers')['layers'][0]['visible']
        print('PASS: display selection, missing display, PNG/JPEG source switch, rotation, invalid geometry, blackout')
    finally:rpc('load_project',{'path':str(backup)})
    after=rpc('list_layers')['layers'];assert after==before
    print('PASS: complete project restored, including source crop and calibrated vertices')
