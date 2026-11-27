"""对照测试：手动拖拽窗口移动时是否也有双猫残影。"""
import os, subprocess, time, ctypes
from PIL import ImageGrab
import win32gui, win32process

EXE = r"F:\AI_Workspace\kurocat\src-tauri\target\x86_64-pc-windows-gnu\release\KuroCat.exe"
OUT = r"F:\AI输出\2026-11-27-17-07-30"
SETTINGS = os.path.expandvars(r"%APPDATA%\kuro-cat-pet\settings.json")
import json, shutil
BACKUP = SETTINGS+".drag.bak"

def find_hwnd(pid):
    hits=[]
    def cb(h,_):
        _,p=win32process.GetWindowThreadProcessId(h)
        r=win32gui.GetWindowRect(h)
        if p==pid and win32gui.IsWindowVisible(h) and r[2]-r[0]>100 and 'Menu' not in win32gui.GetWindowText(h): hits.append(h)
    win32gui.EnumWindows(cb,None)
    return hits[0] if hits else None

def main():
    shutil.copy2(SETTINGS,BACKUP)
    cfg=json.load(open(SETTINGS,encoding='utf-8'))
    cfg['walkMode']='off'  # 走路关闭，纯拖拽测试
    json.dump(cfg,open(SETTINGS,'w',encoding='utf-8'),ensure_ascii=False,indent=2)
    proc=subprocess.Popen([EXE],cwd=os.path.dirname(EXE))
    time.sleep(3)
    hwnd=find_hwnd(proc.pid)
    r=win32gui.GetWindowRect(hwnd)
    print('before',r)
    # 模拟拖拽：mouse_event 按住 → 移动 → 松开
    user32=ctypes.windll.user32
    cx=(r[0]+r[2])//2; cy=(r[1]+r[3])//2
    user32.SetCursorPos(cx,cy)
    time.sleep(0.2)
    user32.mouse_event(0x0002,0,0,0,0)  # LEFTDOWN
    time.sleep(0.2)
    for i in range(1,11):
        user32.SetCursorPos(cx-i*8,cy)
        time.sleep(0.08)
        if i in (5,10):
            cur=win32gui.GetWindowRect(hwnd)
            box=(max(0,cur[0]-60),max(0,cur[1]-40),min(1920,cur[2]+60),min(1080,cur[3]+40))
            ImageGrab.grab(bbox=box).save(os.path.join(OUT,f'drag_{i}.png'))
            print(f'[drag {i}] rect={cur}')
    user32.mouse_event(0x0004,0,0,0,0)  # LEFTUP
    proc.terminate()
    try: proc.wait(timeout=5)
    except: pass
    shutil.copy2(BACKUP,SETTINGS); os.remove(BACKUP)

if __name__=='__main__': main()
