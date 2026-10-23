from pathlib import Path
from types import SimpleNamespace
from app.media import build_ass,build_srt,srt_timestamp

def test_srt_escaping_preserves_text_not_markup():
    cues=[SimpleNamespace(start_seconds=0,end_seconds=1.25,original_text="Olá <b>& mundo\x00",translated_text="Hello")]
    value=build_srt(cues,"both")
    assert "00:00:01,250" in value and "\x00" not in value and "Olá <b>& mundo\nHello" in value
def test_timestamp_rounding(): assert srt_timestamp(3661.009)=="01:01:01,009"

def test_ass_escapes_override_markup_and_uses_background():
    cues=[SimpleNamespace(start_seconds=0,end_seconds=1,original_text=r"texto {\\an8}",translated_text=None)]
    value=build_ass(cues,"original",{"font_size":48,"color":"#FFFFFF","outline_color":"#000000","background_color":"#11223380","position":"bottom"})
    assert r"\{\\\\an8\}" in value
    assert "&H7F332211" in value and "PlayResX: 1080" in value
