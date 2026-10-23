import json
import os
import subprocess
from pathlib import Path

from .config import get_settings
from .integrations import VideoEditingService


def _limits():
    if os.name == "nt":
        return
    import resource
    settings = get_settings()
    resource.setrlimit(resource.RLIMIT_CPU, (settings.media_cpu_seconds, settings.media_cpu_seconds))
    memory = settings.media_memory_bytes
    resource.setrlimit(resource.RLIMIT_AS, (memory, memory))


def run(argv: list[str], timeout: int | None = None) -> subprocess.CompletedProcess:
    settings = get_settings()
    try:
        return subprocess.run(
            argv, stdin=subprocess.DEVNULL, capture_output=True, text=True,
            check=True, timeout=timeout or settings.media_timeout_seconds,
            shell=False, preexec_fn=_limits if os.name != "nt" else None,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("Processamento de mídia excedeu o tempo limite") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or "").strip().splitlines()[-1:] or ["erro desconhecido"]
        raise RuntimeError("Processamento de mídia falhou: " + detail[0][:500]) from exc


def probe_media(path: Path) -> dict:
    if not path.is_file() or path.stat().st_size == 0:
        raise RuntimeError("Arquivo de mídia ausente ou vazio")
    result = run([
        get_settings().ffprobe_binary, "-v", "error", "-show_streams",
        "-show_entries", "format=duration,format_name", "-of", "json", str(path),
    ], 60)
    try:
        data = json.loads(result.stdout)
        duration = float(data["format"]["duration"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError("Arquivo não é uma mídia MP4 válida") from exc
    streams = data.get("streams", [])
    videos = [x for x in streams if x.get("codec_type") == "video"]
    audios = [x for x in streams if x.get("codec_type") == "audio"]
    if not videos or not audios:
        raise RuntimeError("O MP4 precisa conter fluxos de vídeo e áudio")
    width, height = int(videos[0].get("width", 0)), int(videos[0].get("height", 0))
    if width < 16 or height < 16:
        raise RuntimeError("Dimensões de vídeo inválidas")
    format_name = str(data.get("format", {}).get("format_name", ""))
    if "mp4" not in format_name and "mov" not in format_name:
        raise RuntimeError("O arquivo enviado não é um contêiner MP4")
    return {"duration": duration, "width": width, "height": height, "has_audio": True, "has_video": True}


def probe(path: Path) -> float:
    return probe_media(path)["duration"]


def srt_timestamp(seconds: float) -> str:
    ms = max(0, round(seconds * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


def _cue_text(cue, mode: str) -> str:
    original = cue.original_text.strip()
    translated = (cue.translated_text or "").strip()
    if mode == "original":
        return original
    if mode == "translated":
        if not translated:
            raise RuntimeError("Tradução pt-BR indisponível para uma ou mais legendas")
        return translated
    if not translated:
        raise RuntimeError("Tradução pt-BR indisponível para uma ou mais legendas")
    return original + "\n" + translated


def build_srt(cues, mode: str) -> str:
    blocks = []
    for i, cue in enumerate(cues, 1):
        text = _cue_text(cue, mode).replace("\r", " ").replace("\x00", "")
        blocks.append(f"{i}\n{srt_timestamp(cue.start_seconds)} --> {srt_timestamp(cue.end_seconds)}\n{text}\n")
    return "\n".join(blocks)


def _ass_timestamp(seconds: float) -> str:
    centis = max(0, round(seconds * 100))
    hours, centis = divmod(centis, 360000)
    minutes, centis = divmod(centis, 6000)
    secs, centis = divmod(centis, 100)
    return f"{hours}:{minutes:02}:{secs:02}.{centis:02}"


def _ass_color(value: str, with_alpha: bool = False) -> str:
    raw = value.lstrip("#")
    rgb = raw[:6]
    alpha = int(raw[6:8], 16) if with_alpha and len(raw) == 8 else 255
    ass_alpha = 255 - alpha
    return f"&H{ass_alpha:02X}{rgb[4:6]}{rgb[2:4]}{rgb[0:2]}"


def _ass_escape(value: str) -> str:
    return value.replace("\x00", "").replace("\\", r"\\").replace("{", r"\{").replace("}", r"\}").replace("\r", "").replace("\n", r"\N")


def build_ass(cues, mode: str, style: dict) -> str:
    alignment = {"bottom": 2, "center": 5, "top": 8}[style["position"]]
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{get_settings().subtitle_font},{style['font_size']},{_ass_color(style['color'])},&H000000FF,{_ass_color(style['outline_color'])},{_ass_color(style['background_color'], True)},0,0,0,0,100,100,0,0,3,2,0,{alignment},70,70,120,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events = []
    for cue in cues:
        text = _ass_escape(_cue_text(cue, mode))
        events.append(f"Dialogue: 0,{_ass_timestamp(cue.start_seconds)},{_ass_timestamp(cue.end_seconds)},Default,,0,0,0,,{text}")
    return header + "\n".join(events) + "\n"


def _subtitle_filter(path: Path) -> str:
    escaped = str(path.resolve()).replace("\\", "/").replace(":", "\\:").replace("'", "\\'").replace("[", "\\[").replace("]", "\\]")
    return f"ass='{escaped}'" if path.suffix.lower() == ".ass" else f"subtitles='{escaped}'"


def render(source: Path, target: Path, subtitles: Path, start: float, duration: float, framing: dict, style: dict) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if framing["mode"] == "crop":
        x = f"(iw-1080)*{framing['offset_x']}"
        video = f"scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:{x}:0"
    else:
        video = "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black"
    vf = video + "," + _subtitle_filter(subtitles)
    run([
        get_settings().ffmpeg_binary, "-y", "-ss", str(start), "-i", str(source),
        "-t", str(duration), "-vf", vf, "-r", "30", "-c:v", "libx264",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", str(target),
    ])


class FFmpegVideoEditingService(VideoEditingService):
    def render(self, *args, **kwargs) -> None:
        render(*args, **kwargs)


def transcribe(source: Path):
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RuntimeError("faster-whisper não está instalado") from exc
    model = WhisperModel(get_settings().whisper_model, device="cpu", compute_type="int8")
    segments, info = model.transcribe(str(source), vad_filter=True)
    values = [{"start": x.start, "end": x.end, "text": x.text.strip()} for x in segments if x.text.strip()]
    if not values:
        raise RuntimeError("Nenhuma fala foi detectada no vídeo")
    return info.language, values
