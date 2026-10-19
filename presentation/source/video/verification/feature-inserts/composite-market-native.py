from pathlib import Path
import os,sys,json,hashlib,subprocess
import numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[2]
# Optional composition requires numpy, Pillow, and opencv-python in the selected Python environment.
import cv2
MEDIA=ROOT/'assets/feature-inserts'
PROOF=ROOT/'verification/feature-inserts'
FF=Path(os.environ.get('FFMPEG_PATH',str(ROOT.parents[1]/'tools/ffmpeg/ffmpeg.exe')))
SOURCE=MEDIA/'market-rise.mp4'
CHART=ROOT/'assets/chart-plot.mp4'
OUTPUT=MEDIA/'market-rise-native.mp4'

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def order(points):
    pts=np.asarray(points,dtype=np.float32).reshape(-1,2)
    sums=pts.sum(1); dif=np.diff(pts,axis=1).flatten()
    return np.array([pts[sums.argmin()],pts[dif.argmin()],pts[sums.argmax()],pts[dif.argmax()]],np.float32)
def detect(frame):
    hsv=cv2.cvtColor(frame,cv2.COLOR_BGR2HSV)
    mask=cv2.inRange(hsv,np.array([85,45,28],np.uint8),np.array([125,255,220],np.uint8))
    mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,np.ones((17,17),np.uint8))
    contours,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    if not contours: return None
    cnt=max(contours,key=cv2.contourArea)
    if cv2.contourArea(cnt)<100000: return None
    hull=cv2.convexHull(cnt)
    poly=cv2.approxPolyDP(hull,.015*cv2.arcLength(hull,True),True)
    if len(poly)!=4: return None
    q=order(poly)
    if q[:,0].min()<12 or q[:,0].max()>1907 or q[:,1].min()<12 or q[:,1].max()>1067: return None
    return q

def run():
    cap=cv2.VideoCapture(str(SOURCE)); fps=cap.get(cv2.CAP_PROP_FPS)
    native=cv2.VideoCapture(str(CHART)); nativefps=native.get(cv2.CAP_PROP_FPS)
    nativeframes=[]
    while True:
        ok,f=native.read()
        if not ok: break
        nativeframes.append(f)
    native.release()
    sourcehash,chartsha=sha(SOURCE),sha(CHART)
    W,H=1920,1080
    proc=subprocess.Popen([str(FF),'-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s',f'{W}x{H}','-r',str(fps),'-i','-','-an','-c:v','libx264','-crf','17','-preset','fast','-pix_fmt','yuv420p','-movflags','+faststart',str(OUTPUT)],stdin=subprocess.PIPE)
    q=None; prevgray=None; prevpoints=None; records=[]; captures=[]
    times=[0,.4,1.2,2.0,2.8,3.6,4.5,5.0]
    captureframes={round(t*fps):t for t in times}
    n=0
    while True:
        ok,frame=cap.read()
        if not ok: break
        gray=cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY)
        detected=detect(frame)
        inliers=0
        if q is None:
            if detected is None: raise RuntimeError('Cannot find initial screen')
            q=detected
            method='screen-boundary'
        else:
            nextpts,status,error=cv2.calcOpticalFlowPyrLK(prevgray,gray,prevpoints,None,winSize=(31,31),maxLevel=4,criteria=(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,30,.01))
            good=status.flatten()>0
            old=prevpoints[good]; new=nextpts[good]
            transform,inside=cv2.findHomography(old,new,cv2.RANSAC,3.0)
            if transform is None: raise RuntimeError(('Track lost',n))
            inliers=int(inside.sum())
            propagated=cv2.perspectiveTransform(q.reshape(1,4,2),transform)[0]
            if detected is not None:
                # Edge detection anchors drift while the entire screen is visible.
                q=detected*.7+propagated*.3
                method='boundary+flow'
            else:
                q=propagated
                method='flow-homography'
        # Sample all sharp features inside the display; no face/desk features enter tracking.
        trackmask=np.zeros((H,W),np.uint8)
        cv2.fillConvexPoly(trackmask,q.astype(np.int32),255)
        trackmask=cv2.erode(trackmask,np.ones((15,15),np.uint8))
        points=cv2.goodFeaturesToTrack(gray,350,.012,15,mask=trackmask,blockSize=5)
        if points is None or len(points)<20: raise RuntimeError(('Insufficient screen features',n))
        prevpoints=points;prevgray=gray
        # Contain the complete native recording without distorting candles or inventing data.
        surface=np.full((900,1600,3),255,np.uint8)
        cf=nativeframes[min(len(nativeframes)-1,round(n/fps*nativefps))]
        scale=min(1600/cf.shape[1],900/cf.shape[0]); cw,ch=round(cf.shape[1]*scale),round(cf.shape[0]*scale)
        chart=cv2.resize(cf,(cw,ch),interpolation=cv2.INTER_CUBIC)
        x=(1600-cw)//2;y=(900-ch)//2
        surface[y:y+ch,x:x+cw]=chart
        # A constant monitor exposure adjustment preserves source values and colors.
        surface=np.clip(surface.astype(np.float32)*.94,0,255).astype(np.uint8)
        center=q.mean(0); quad=center+(q-center)*1.006
        matrix=cv2.getPerspectiveTransform(np.float32([[0,0],[1599,0],[1599,899],[0,899]]),quad.astype(np.float32))
        warped=cv2.warpPerspective(surface,matrix,(W,H),flags=cv2.INTER_LINEAR)
        alpha=cv2.warpPerspective(np.ones((900,1600),np.uint8)*255,matrix,(W,H),flags=cv2.INTER_LINEAR)
        af=alpha.astype(np.float32)[:,:,None]/255
        out=(warped.astype(np.float32)*af+frame.astype(np.float32)*(1-af)).astype(np.uint8)
        proc.stdin.write(out.tobytes())
        records.append({'frame':n,'time':n/fps,'quad':q.round(3).tolist(),'method':method,'trackingInliers':inliers,'nativeFrame':min(len(nativeframes)-1,round(n/fps*nativefps))})
        if n in captureframes:
            t=captureframes[n]
            dest=PROOF/f'market-rise-native-{t:.1f}.jpg'
            dest.write_bytes(cv2.imencode('.jpg',out,[cv2.IMWRITE_JPEG_QUALITY,94])[1].tobytes())
            captures.append((t,Image.fromarray(cv2.cvtColor(out,cv2.COLOR_BGR2RGB))))
        n+=1
    cap.release();proc.stdin.close()
    if proc.wait(): raise RuntimeError('Encoder failed')
    sheet=Image.new('RGB',(1600,484*((len(captures)+1)//2)),(16,18,22));d=ImageDraw.Draw(sheet)
    for i,(t,im) in enumerate(captures):
        px=(i%2)*800;py=(i//2)*484
        sheet.paste(im.resize((800,450)),(px,py));d.text((px+12,py+458),f'Native chart composite / {t:.1f} sec',fill='white')
    sheet.save(PROOF/'market-rise-native-contact.jpg',quality=94)
    manifest={'output':str(OUTPUT),'source':str(SOURCE),'chartSource':str(CHART),'sourceSha256':sourcehash,'chartSourceSha256':chartsha,'outputSha256':sha(OUTPUT),'originalsPreserved':sha(SOURCE)==sourcehash and sha(CHART)==chartsha,'fps':fps,'frames':n,'duration':n/fps,'size':[W,H],'method':'Blue display boundary anchors then LK features/RANSAC homography tracking; corner pin of full original chart recording with aspect-preserving side margins','exposureMultiplier':.94,'audio':'none','tracking':records,'sampleTimes':times,'limitations':'Display homography is estimated from generated footage; no fresh financial data, labels or numbers were created. Independent visual approval pending.'}
    (PROOF/'market-rise-native-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:manifest[k] for k in ['frames','duration','outputSha256','originalsPreserved']}),flush=True)
if __name__=='__main__':run()
