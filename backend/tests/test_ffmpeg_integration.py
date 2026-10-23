import json,subprocess
from pathlib import Path
from types import SimpleNamespace
from app.config import get_settings
from app.media import build_ass,probe,render

def test_real_ffmpeg_vertical_render(tmp_path):
    source=tmp_path/"source.mp4"
    subprocess.run([get_settings().ffmpeg_binary,"-y","-f","lavfi","-i","testsrc=size=320x240:rate=30","-f","lavfi","-i","sine=frequency=1000","-t","2","-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac",str(source)],check=True,capture_output=True)
    style={"font_size":32,"color":"#FFFFFF","outline_color":"#000000","background_color":"#00000080","position":"bottom"}
    srt=tmp_path/"legenda [teste].ass"; srt.write_text(build_ass([SimpleNamespace(start_seconds=0,end_seconds=1.5,original_text="Olá: mundo",translated_text=None)],"original",style),encoding="utf-8")
    target=tmp_path/"result.mp4"
    render(source,target,srt,0,2,{"mode":"crop","offset_x":0.5},style)
    result=subprocess.run([get_settings().ffprobe_binary,"-v","error","-select_streams","v:0","-show_entries","stream=width,height,pix_fmt,r_frame_rate","-of","json",str(target)],check=True,capture_output=True,text=True)
    stream=json.loads(result.stdout)["streams"][0]
    assert (stream["width"],stream["height"],stream["pix_fmt"],stream["r_frame_rate"])==(1080,1920,"yuv420p","30/1")
    assert 1.9 <= probe(target) <= 2.1
