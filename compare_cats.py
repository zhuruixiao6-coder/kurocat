"""对比验证：走动 off vs roam 模式，看双猫现象是否由本次改动引入。"""
import json, os, shutil, subprocess, time
from PIL import ImageGrab
import win32gui, win32process

SETTINGS = os.path.expandvars(r"%APPDATA%\kuro-cat-pet\settings.json")
BACKUP = SETTINGS + ".cmp.bak"
EXE = r"F:\AI_Workspace\kurocat\src-tauri\target\x86_64-pc-windows-gnu\release\KuroCat.exe"
OUTDIR = r"F:\AI输出\2026-11-27-17-07-30"

def find_hwnd(pid):
    hits=[]
    def cb(h,_):
        _,p=win32process.GetWindowThreadProcessId(h)
        if p==pid and win32gui.IsWindowVisible(h) and win32gui.GetWindowRect(h)[2]-win32gui.GetWindowRect(h)[0]>100:
            hits.append(h)
    win32gui.EnumWindows(cb,None)
    return hits[0] if hits else None

def shot(pid, name):
    hwnd=find_hwnd(pid)
    if not hwnd:
        print(f"[shot {name}] no window"); return
    r=win32gui.GetWindowRect(hwnd)
    pad=30
    box=(max(0,r[0]-pad),max(0,r[1]-pad),r[2]+pad,r[3]+pad)
    img=ImageGrab.grab(bbox=box)
    p=os.path.join(OUTDIR,name)
    img.save(p)
    print(f"[shot {name}] {p}")

def main():
    shutil.copy2(SETTINGS,BACKUP)
    cfg=json.load(open(SETTINGS,encoding='utf-8'))
    proc=subprocess.Popen([EXE],cwd=os.path.dirname(EXE))
    print(f"[launch] pid={proc.pid}")
    try:
        # 场景1：走动 off
        cfg['walkMode']='off'
        json.dump(cfg,open(SETTINGS,'w',encoding='utf-8'),ensure_ascii=False,indent=2)
        time.sleep(3)
        shot(proc.pid,'cat_off.png')
        # 场景2：roam
        cfg['walkMode']='roam'
        json.dump(cfg,open(SETTINGS,'w',encoding='utf-8'),ensure_ascii=False,indent=2)
        time.sleep(6)
        shot(proc.pid,'cat_roam.png')
    finally:
        proc.terminate()
        try: proc.wait(timeout=5)
        except: pass
        shutil.copy2(BACKUP,SETTINGS); os.remove(BACKUP)
        print('[cleanup] done')

if __name__=='__main__': main()
