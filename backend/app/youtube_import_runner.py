"""Minimal isolated yt-dlp entrypoint. It intentionally emits only safe JSON codes."""
import json
import sys
from pathlib import Path


class _SilentLogger:
    def debug(self, _message): pass
    def warning(self, _message): pass
    def error(self, _message): pass


def _result(ok: bool, code: str) -> None:
    print(json.dumps({"ok": ok, "code": code}), flush=True)


def main() -> int:
    if len(sys.argv) != 8:
        _result(False, "internal")
        return 2
    url, folder, proxy, raw_bytes, raw_duration, raw_height, _raw_metadata_timeout = sys.argv[1:]
    max_bytes, max_duration, max_height = int(raw_bytes), int(raw_duration), int(raw_height)
    from yt_dlp import YoutubeDL
    from yt_dlp.utils import DownloadError

    rejected_code = None

    def match_filter(info, *, incomplete=False):
        nonlocal rejected_code
        if info.get("is_live") or info.get("live_status") in {"is_live", "is_upcoming"}:
            rejected_code = "live"
            return "CA_LIVE"
        duration = info.get("duration")
        if duration and duration > max_duration:
            rejected_code = "too_long"
            return "CA_TOO_LONG"
        size = info.get("filesize") or info.get("filesize_approx")
        if size and size > max_bytes:
            rejected_code = "too_large"
            return "CA_TOO_LARGE"
        return None

    downloaded_by_file = {}

    def progress_hook(status):
        filename = status.get("filename") or status.get("tmpfilename") or "unknown"
        downloaded_by_file[filename] = max(downloaded_by_file.get(filename, 0), int(status.get("downloaded_bytes") or 0))
        if sum(downloaded_by_file.values()) > max_bytes:
            raise DownloadError("CA_TOO_LARGE")

    options = {
        "proxy": proxy,
        "quiet": True,
        "no_warnings": True,
        "logger": _SilentLogger(),
        "noplaylist": True,
        "cachedir": False,
        "socket_timeout": 30,
        "retries": 2,
        "fragment_retries": 2,
        "file_access_retries": 1,
        "max_filesize": max_bytes,
        "match_filter": match_filter,
        "progress_hooks": [progress_hook],
        "format": f"bv*[height<={max_height}][ext=mp4]+ba[ext=m4a]/b[height<={max_height}][ext=mp4]",
        "merge_output_format": "mp4",
        "outtmpl": str(Path(folder) / "source.%(ext)s"),
        "part": True,
        "continuedl": False,
        "overwrites": True,
        "remote_components": set(),
        "js_runtimes": {"deno": {}},
    }
    try:
        with YoutubeDL(options) as downloader:
            info = downloader.extract_info(url, download=False)
            if not info:
                _result(False, rejected_code or "restricted")
                return 1
            (Path(folder) / ".metadata-complete").touch()
            info = downloader.process_ie_result(info, download=True)
        if not info or info.get("_type") == "playlist":
            _result(False, rejected_code or "restricted")
            return 1
        _result(True, "ok")
        return 0
    except DownloadError as exc:
        message = str(exc).lower()
        if "ca_live" in message or "live event" in message:
            code = "live"
        elif "ca_too_long" in message:
            code = "too_long"
        elif "ca_too_large" in message or "max-filesize" in message:
            code = "too_large"
        elif any(token in message for token in ("private", "sign in", "login", "age-restricted", "members-only", "drm", "unavailable")):
            code = "restricted"
        elif any(token in message for token in ("timed out", "timeout", "429", "503", "502", "temporary", "network")):
            code = "transient"
        elif "requested format is not available" in message:
            code = "no_format"
        else:
            code = "unsupported"
        _result(False, code)
        return 1
    except Exception:
        _result(False, "internal")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
