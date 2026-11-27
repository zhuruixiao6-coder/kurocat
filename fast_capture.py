"""决定性测试：走动中连续抓帧，判断双猫是渲染bug还是窗口移动的抓图残影。"""
import json, os, shutil, subprocess, time
from PIL import ImageGrab
import win32gui, win32process

SETTINGS = os.path.expandvars(r"%APPDATA%\kuro-cat-pet\settings.json")
BACKUP = SETTINGS + ".fast.bak"
EXE = r"F:\AI_Workspace\kurocat\src-tauri\target\x86_64-pc-windows-gnu\release\KuroCat.exe"
OUTDIR = r"F:\AI输出\2026-11-27-17-07-30"

def find_hwnd(pid):
    hits=[]
    def cb(h,_):
        _,p=win32process.GetWindowThreadProcessId(h)
        if p==pid and win32gui.IsWindowVisible(h):
            r=win32gui.GetWindowRect(h)
            if r[2]-r[0]>100 and 'Menu' not in win32gui.GetWindowText(h): hits.append(h)
    win32gui.EnumWindows(cb,None)
    return hits[0] if hits else None

def main():
    shutil.copy2(SETTINGS,BACKUP)
    cfg=json.load(open(SETTINGS,encoding='utf-8'))
    cfg['walkMode']='roam'; cfg['walkSpeed']=None  # ignore
    json.dump(cfg,open(SETTINGS,'w',encoding='utf-8'),ensure_ascii=False,indent=2)
    proc=subprocess.Popen([EXE],cwd=os.path.dirname(EXE))
    print(f'[launch] pid={proc.pid}')
    try:
        time.sleep(3)
        hwnd=find_hwnd(proc.pid)
        print(f'[hwnd] {hwnd}')
        # 固定抓一个大区域（覆盖猫可能走到的范围），连续抓10帧
        for i in range(10):
            r=win32gui.GetWindowRect(hwnd) if hwnd else (1600,350,1830,590)
            box=(max(0,r[0]-60),max(0,r[1]-40),min(1920,r[2]+60),min(1080,r[3]+40))
            img=ImageGrab.grab(bbox=box)
            img.save(os.path.join(OUTDIR,f'fast_{i:02d}.png'))
            print(f'[frame {i}] window_rect={r}')
            time.sleep(0.35)
    finally:
        proc.terminate()
        try: proc.wait(timeout=5)
        except: pass
        shutil.copy2(BACKUP,SETTINGS); os.remove(BACKUP)
        print('[cleanup] done')

if __name__=='__main__': main()
