import ipaddress
import json
import os
import re
import selectors
import shutil
import socket
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from fastapi import HTTPException

from .config import get_settings
from .media import probe_media


VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"}
NETWORK_SUFFIXES = (".youtube.com", ".googlevideo.com", ".youtube-nocookie.com")
NETWORK_HOSTS = {"youtube.com", "youtu.be", "youtube-nocookie.com", "youtubei.googleapis.com"}
TUNNEL_BUFFER_HIGH_WATER = 262144
TUNNEL_BUFFER_LOW_WATER = 131072
TUNNEL_IDLE_TIMEOUT = 60


class PermanentYouTubeImportError(RuntimeError):
    pass


class TransientYouTubeImportError(RuntimeError):
    pass


class YouTubeImportCancelled(RuntimeError):
    pass


def canonicalize_youtube_url(value: str) -> str | None:
    """Return a canonical single-video URL, None for a non-YouTube host."""
    parsed = urlsplit(value)
    host = (parsed.hostname or "").lower().rstrip(".")
    if host not in YOUTUBE_HOSTS:
        if "youtube.com" in host or "youtu.be" in host:
            raise HTTPException(422, "Host do YouTube inválido")
        return None
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise HTTPException(422, "O link do YouTube deve usar HTTPS sem credenciais")
    pieces = [part for part in parsed.path.split("/") if part]
    video_id = None
    if host == "youtu.be" and len(pieces) == 1:
        video_id = pieces[0]
    elif host != "youtu.be" and parsed.path.rstrip("/") == "/watch":
        values = parse_qs(parsed.query).get("v", [])
        video_id = values[0] if len(values) == 1 else None
    elif host != "youtu.be" and len(pieces) == 2 and pieces[0] in {"shorts", "embed"}:
        video_id = pieces[1]
    if not video_id or not VIDEO_ID.fullmatch(video_id):
        raise HTTPException(422, "Informe o link de um único vídeo do YouTube")
    return f"https://www.youtube.com/watch?v={video_id}"


def is_youtube_url(value: str) -> bool:
    return canonicalize_youtube_url(value) is not None


def _allowed_network_host(host: str) -> bool:
    host = host.lower().rstrip(".")
    return host in NETWORK_HOSTS or any(host.endswith(suffix) for suffix in NETWORK_SUFFIXES)


def resolve_youtube_connection(host: str, port: int) -> list[str]:
    """Resolve immediately before connect and reject mixed public/private answers."""
    if port != 443 or not _allowed_network_host(host):
        raise OSError("destino de rede não permitido")
    try:
        answers = {item[4][0].split("%", 1)[0] for item in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)}
    except socket.gaierror as exc:
        raise OSError("destino não pôde ser resolvido") from exc
    if not answers:
        raise OSError("destino sem endereço")
    if any(not ipaddress.ip_address(address).is_global for address in answers):
        raise OSError("destino não público")
    return sorted(answers)


class _TunnelHandler(socketserver.StreamRequestHandler):
    timeout = 30

    def handle(self):
        request = self.rfile.readline(8193).decode("ascii", "replace").strip()
        if len(request) > 8192:
            return
        headers_size = 0
        while True:
            line = self.rfile.readline(8193)
            headers_size += len(line)
            if not line or line in (b"\r\n", b"\n") or headers_size > 16384:
                break
        parts = request.split()
        if len(parts) != 3 or parts[0] != "CONNECT":
            self.wfile.write(b"HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n")
            return
        authority = parts[1]
        try:
            if authority.startswith("["):
                host, raw_port = authority[1:].split("]:", 1)
            else:
                host, raw_port = authority.rsplit(":", 1)
            port = int(raw_port)
            addresses = resolve_youtube_connection(host, port)
        except (ValueError, OSError):
            self.wfile.write(b"HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
            return
        upstream = None
        for address in addresses:
            try:
                upstream = socket.create_connection((address, port), timeout=30)
                break
            except OSError:
                continue
        if upstream is None:
            self.wfile.write(b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
            return
        try:
            self.wfile.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            self.wfile.flush()
            self.connection.setblocking(False)
            upstream.setblocking(False)
            peers = {self.connection: upstream, upstream: self.connection}
            pending = {self.connection: bytearray(), upstream: bytearray()}
            read_open = {self.connection: True, upstream: True}
            read_paused = {self.connection: False, upstream: False}
            write_open = {self.connection: True, upstream: True}
            with selectors.DefaultSelector() as selector:
                registered = set()

                def refresh(sock):
                    mask = 0
                    if read_open[sock] and not read_paused[sock]:
                        mask |= selectors.EVENT_READ
                    if write_open[sock] and pending[sock]:
                        mask |= selectors.EVENT_WRITE
                    if mask and sock in registered:
                        selector.modify(sock, mask)
                    elif mask:
                        selector.register(sock, mask)
                        registered.add(sock)
                    elif sock in registered:
                        selector.unregister(sock)
                        registered.remove(sock)

                refresh(self.connection)
                refresh(upstream)
                last_progress = time.monotonic()
                while True:
                    if not any(read_open.values()) and not any(pending.values()):
                        break
                    remaining = TUNNEL_IDLE_TIMEOUT - (time.monotonic() - last_progress)
                    if remaining <= 0:
                        break
                    events = selector.select(timeout=remaining)
                    if not events:
                        break
                    for key, mask in events:
                        sock = key.fileobj
                        if mask & selectors.EVENT_READ:
                            try:
                                capacity = TUNNEL_BUFFER_HIGH_WATER - len(pending[peers[sock]])
                                data = sock.recv(min(65536, capacity))
                            except BlockingIOError:
                                continue
                            except OSError:
                                return
                            if not data:
                                read_open[sock] = False
                            else:
                                pending[peers[sock]].extend(data)
                                self.server.record_pending(len(pending[peers[sock]]))
                                if len(pending[peers[sock]]) >= TUNNEL_BUFFER_HIGH_WATER:
                                    read_paused[sock] = True
                                last_progress = time.monotonic()
                        if mask & selectors.EVENT_WRITE and pending[sock]:
                            try:
                                sent = sock.send(pending[sock])
                            except BlockingIOError:
                                continue
                            except OSError:
                                return
                            del pending[sock][:sent]
                            if sent:
                                last_progress = time.monotonic()
                            if len(pending[sock]) <= TUNNEL_BUFFER_LOW_WATER:
                                read_paused[peers[sock]] = False
                        if not pending[sock] and not read_open[peers[sock]] and write_open[sock]:
                            try:
                                sock.shutdown(socket.SHUT_WR)
                            except OSError:
                                pass
                            write_open[sock] = False
                        refresh(sock)
                        refresh(peers[sock])
        finally:
            upstream.close()


class _TunnelServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = False
    daemon_threads = True

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.max_pending_bytes = 0
        self._pending_lock = threading.Lock()

    def record_pending(self, size):
        with self._pending_lock:
            self.max_pending_bytes = max(self.max_pending_bytes, size)


class YouTubeNetworkProxy:
    def __enter__(self):
        self.server = _TunnelServer(("127.0.0.1", 0), _TunnelHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        port = self.server.server_address[1]
        self.url = f"http://127.0.0.1:{port}"
        return self

    def __exit__(self, *_):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)


def _subprocess_limits():
    if os.name == "nt":
        return
    import resource
    settings = get_settings()
    resource.setrlimit(resource.RLIMIT_CPU, (settings.media_cpu_seconds, settings.media_cpu_seconds))
    resource.setrlimit(resource.RLIMIT_FSIZE, (settings.max_upload_bytes, settings.max_upload_bytes))


def _stop_process(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    try:
        if os.name != "nt":
            try:
                os.killpg(process.pid, 15)
            except Exception:
                process.terminate()
        else:
            process.terminate()
        process.wait(timeout=5)
    except Exception:
        try:
            if os.name != "nt":
                try:
                    os.killpg(process.pid, 9)
                except Exception:
                    process.kill()
            else:
                process.kill()
        except Exception:
            pass


def _safe_environment() -> dict[str, str]:
    allowed = ("PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "SSL_CERT_FILE", "SSL_CERT_DIR")
    environment = {key: os.environ[key] for key in allowed if key in os.environ}
    environment.update(HOME=tempfile.gettempdir(), NO_PROXY="", no_proxy="")
    return environment


def import_youtube_video(url: str, target: Path, cancel_check=None) -> None:
    canonical = canonicalize_youtube_url(url)
    if canonical is None:
        raise ValueError("URL não pertence ao YouTube")
    settings = get_settings()
    target.parent.mkdir(parents=True, exist_ok=True)
    working = Path(tempfile.mkdtemp(prefix=".youtube-", dir=target.parent))
    process = None
    try:
        with YouTubeNetworkProxy() as proxy:
            runner = Path(__file__).with_name("youtube_import_runner.py")
            args = [
                sys.executable, "-I", str(runner), canonical, str(working), proxy.url,
                str(settings.max_upload_bytes), str(settings.max_source_duration_seconds),
                str(settings.youtube_max_height), str(settings.youtube_metadata_timeout_seconds),
            ]
            creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
            process = subprocess.Popen(
                args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                text=True, env=_safe_environment(), shell=False, start_new_session=os.name != "nt",
                creationflags=creationflags, preexec_fn=_subprocess_limits if os.name != "nt" else None,
            )
            deadline = time.monotonic() + settings.youtube_import_timeout_seconds
            metadata_deadline = time.monotonic() + settings.youtube_metadata_timeout_seconds
            metadata_complete = working / ".metadata-complete"
            while process.poll() is None:
                if cancel_check and cancel_check():
                    _stop_process(process)
                    raise YouTubeImportCancelled("Importação cancelada")
                if time.monotonic() >= deadline:
                    _stop_process(process)
                    raise TransientYouTubeImportError("A importação do YouTube excedeu o tempo limite; tente novamente")
                if not metadata_complete.exists() and time.monotonic() >= metadata_deadline:
                    _stop_process(process)
                    raise TransientYouTubeImportError("A leitura de metadados do YouTube excedeu o tempo limite; tente novamente")
                time.sleep(0.1)
            stdout, _ = process.communicate(timeout=5)
        try:
            result = json.loads(stdout)
        except (TypeError, json.JSONDecodeError) as exc:
            raise TransientYouTubeImportError("O importador do YouTube terminou de forma inesperada; tente novamente") from exc
        if process.returncode != 0 or not result.get("ok"):
            code = result.get("code")
            messages = {
                "restricted": "O vídeo não está publicamente acessível; envie o arquivo original",
                "live": "Lives não podem ser importadas; envie o arquivo original após o término",
                "too_long": "O vídeo excede a duração máxima configurada",
                "too_large": "O vídeo excede o limite de tamanho configurado",
                "no_format": "O vídeo não oferece um formato MP4 compatível; envie o arquivo original",
            }
            if code in messages:
                raise PermanentYouTubeImportError(messages[code])
            if code == "transient":
                raise TransientYouTubeImportError("O YouTube está temporariamente indisponível; tente novamente")
            raise PermanentYouTubeImportError("Não foi possível importar este vídeo do YouTube; envie o arquivo original")
        if cancel_check and cancel_check():
            raise YouTubeImportCancelled("Importação cancelada")
        downloaded = working / "source.mp4"
        if not downloaded.is_file() or downloaded.stat().st_size == 0:
            raise TransientYouTubeImportError("O importador não produziu um arquivo completo; tente novamente")
        if downloaded.stat().st_size > settings.max_upload_bytes:
            raise PermanentYouTubeImportError("O vídeo excede o limite de tamanho configurado")
        media = probe_media(downloaded)
        if cancel_check and cancel_check():
            raise YouTubeImportCancelled("Importação cancelada")
        if media["duration"] > settings.max_source_duration_seconds:
            raise PermanentYouTubeImportError("O vídeo excede a duração máxima configurada")
        if media["height"] > settings.youtube_max_height:
            raise PermanentYouTubeImportError("O vídeo excede a resolução máxima configurada")
        if cancel_check and cancel_check():
            raise YouTubeImportCancelled("Importação cancelada")
        target.unlink(missing_ok=True)
        downloaded.replace(target)
    finally:
        if process is not None:
            _stop_process(process)
        shutil.rmtree(working, ignore_errors=True)
