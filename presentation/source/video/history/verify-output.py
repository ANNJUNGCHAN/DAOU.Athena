"""Independent final artifact checks, not a backend/app execution test."""
from pathlib import Path
import json,hashlib,subprocess
D=Path(__file__).parent
F=D.parents[2]/'.omc/tools/ffmpeg-portable-20261003/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe'
movie=D/'athena-v23-60s.mp4'
errors=[]
def read(path): return json.loads(Path(path).read_text(encoding='utf-8-sig'))
def check(condition,message):
    if not condition: errors.append(message)
manifest=read(D/'render/final-manifest.json')
check(manifest.get('sourceUnchanged') is True,'Source changed during production rendering')
for file,digest in manifest['sourceHashes'].items():
    check(hashlib.sha256((D/file).read_bytes()).hexdigest()==digest,'Final source differs from rendered input: '+file)
probe=json.loads(subprocess.check_output([str(F.with_name('ffprobe.exe')),'-v','error','-show_streams','-show_format','-of','json',str(movie)]))
video=next(x for x in probe['streams'] if x['codec_type']=='video')
audio=next((x for x in probe['streams'] if x['codec_type']=='audio'),{})
check(video['width']==1920 and video['height']==1080,'Expected 1920x1080')
check(video['avg_frame_rate']=='30/1' and int(video['nb_frames'])==1800,'Expected 1800 frames at 30 fps')
check(abs(float(probe['format']['duration'])-60)<.001,'Expected 60 seconds')
check(audio.get('sample_rate')=='48000' and abs(float(audio.get('duration',0))-60)<.04,'Expected 60 seconds of 48kHz audio')
check(manifest.get('decodeErrors')==0 and manifest.get('browserErrors')==[],'Production decoder/browser errors')
coverage=read(D/'stage-features.json'); spec=read(D/'interaction-spec.json')
ids=[x['id'] for x in coverage['features']]
check(len(ids)==len(set(ids))==23 and set(ids)==set(x['id'] for x in spec['features']),'Homepage 23 capability coverage mismatch')
for feature in coverage['features']:
    for evidence in feature['evidence']: check(Path(evidence['path']).is_file(),'Missing evidence: '+evidence['path'])
review_file=D/'verification/independent-homepage-review.json'
check(review_file.is_file(),'Missing independent V23 homepage review')
review=read(review_file) if review_file.is_file() else {}
check(str(review.get('status','')).lower() in ('pass','pass_for_render'),'Independent V23 homepage visual/semantic review has not passed')
review_hashes=review.get('reviewed_file_sha256',{})
for file in ('stage.js','stage.css','feature-detail.js'):
    digest=review_hashes.get(file)
    check(isinstance(digest,str) and len(digest)==64,'Independent review has no source hash: '+file)
    check(digest==hashlib.sha256((D/file).read_bytes()).hexdigest(),'Current source differs from independently reviewed input: '+file)
    check(digest==manifest['sourceHashes'].get(file),'Rendered input differs from independently reviewed input: '+file)
result={'status':'PASS' if not errors else 'FAIL','scope':'Current source identity, independent review status, capability coverage and final encoded file','errors':errors,'features':len(ids),'duration':probe['format']['duration'],'frames':video['nb_frames'],'resolution':[video['width'],video['height']],'fps':video['avg_frame_rate'],'audio':{'sampleRate':audio.get('sample_rate'),'duration':audio.get('duration')},'bytes':movie.stat().st_size,'sha256':hashlib.sha256(movie.read_bytes()).hexdigest(),'sourceInputsMatched':len(manifest['sourceHashes']),'independentReview':review.get('status'),'independentReviewFile':str(review_file)}
(D/'verification/delivery-contract.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False,indent=2))
raise SystemExit(bool(errors))
