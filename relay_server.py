"""Serve Salto Postal and relay its rooms over WebSocket."""

import argparse
import json
import re
import secrets
from asyncio import wait_for
from dataclasses import dataclass, field
from pathlib import Path
from time import monotonic
from urllib.parse import urlsplit

from aiohttp import WSMsgType, web

ROOT = Path(__file__).resolve().parent
FILES = {
    "game.js", "main.js", "motion.js", "network.js", "props.js", "relay.js",
    "managed-room.js",
    "render.js", "style.css", "vendor/peerjs.min.js",
}
ASSET_PATH = re.compile(r"assets/[a-z0-9-]+\.(?:png|webp|ttf)")
ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
VERSION = 8
MAX_ROOMS = 100
MAX_CONNECTIONS = MAX_ROOMS * 5


@dataclass
class Room:
    host: web.WebSocketResponse
    guests: dict[str, web.WebSocketResponse] = field(default_factory=dict)


async def send(socket, op, **values):
    if socket.closed:
        return False
    try:
        message = json.dumps({"op": op, **values}, allow_nan=False)
        await wait_for(socket.send_str(message), timeout=2)
        return True
    except (ConnectionError, TimeoutError, RuntimeError, ValueError):
        return False


def create_app(allowed_origins=()):
    rooms = {}
    connections = 0
    allowed_origins = frozenset(allowed_origins)

    async def index(_request):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        html = html.replace('<html lang="es">', '<html lang="es" data-room-transport="relay">', 1)
        return web.Response(
            text=html, content_type="text/html", headers={"Cache-Control": "no-store"}
        )

    async def file(request):
        name = request.match_info["name"]
        if name not in FILES and not ASSET_PATH.fullmatch(name):
            raise web.HTTPNotFound()
        path = ROOT / name
        if path.resolve() != path or not path.is_file():
            raise web.HTTPNotFound()
        return web.FileResponse(path)

    async def room_socket(request):
        nonlocal connections
        origin = request.headers.get("Origin")
        if origin not in allowed_origins and origin not in {f"http://{request.host}", f"https://{request.host}"}:
            raise web.HTTPForbidden()
        if connections >= MAX_CONNECTIONS:
            raise web.HTTPServiceUnavailable()

        socket = web.WebSocketResponse(heartbeat=20, max_msg_size=65536, compress=False)
        room = room_code = member = None
        connections += 1

        async def reject(message):
            await send(socket, "error", message=message)

        async def register(packet):
            nonlocal room, room_code, member
            if packet.get("version") != VERSION:
                await reject("Actualiza el juego antes de entrar a una sala.")
                return False
            if packet.get("op") == "create":
                if len(rooms) >= MAX_ROOMS:
                    await reject("El servidor está lleno. Inténtalo de nuevo en un momento.")
                    return False
                while True:
                    room_code = "".join(secrets.choice(ALPHABET) for _ in range(6))
                    if room_code not in rooms:
                        break
                room = rooms[room_code] = Room(socket)
                return await send(socket, "room", code=room_code)
            if packet.get("op") != "join":
                return False
            room_code = packet.get("code")
            room = rooms.get(room_code) if isinstance(room_code, str) else None
            if room is None or room.host.closed:
                await reject("La sala no está disponible. Comprueba el código y el enlace del juego.")
                return False
            if len(room.guests) >= 3:
                await reject("La sala está completa.")
                return False
            member = secrets.token_hex(8)
            room.guests[member] = socket
            return await send(socket, "peer", peer="host") and await send(room.host, "peer", peer=member)

        try:
            await socket.prepare(request)
            try:
                first = await socket.receive(timeout=10)
                packet = json.loads(first.data) if first.type == WSMsgType.TEXT else None
            except (ValueError, TimeoutError, RecursionError):
                return socket
            if not isinstance(packet, dict) or not await register(packet):
                return socket

            allowance, last_frame = 450, monotonic()
            async for frame in socket:
                if frame.type != WSMsgType.TEXT:
                    break
                now = monotonic()
                allowance = min(450, allowance + 150 * (now - last_frame)) - 1
                last_frame = now
                if allowance < 0:
                    await reject("Se interrumpió la conexión por exceso de mensajes.")
                    break
                try:
                    packet = json.loads(frame.data)
                except (ValueError, RecursionError):
                    continue
                if not isinstance(packet, dict):
                    continue
                peer, op, data = packet.get("peer"), packet.get("op"), packet.get("data")
                if not isinstance(peer, str):
                    continue
                if member is None:
                    target = room.guests.get(peer)
                else:
                    target = room.host if peer == "host" and room.guests.get(member) is socket else None
                if target is None:
                    continue
                if op == "leave":
                    if member is not None:
                        break
                    room.guests.pop(peer, None)
                    await send(target, "left", peer="host")
                elif op == "data" and isinstance(data, dict) and isinstance(data.get("type"), str):
                    await send(target, "data", peer=member or "host", data=data)
        finally:
            connections -= 1
            if member is not None and room.guests.pop(member, None) is socket:
                await send(room.host, "left", peer=member)
            elif room is not None and room.host is socket:
                rooms.pop(room_code, None)
                for guest in list(room.guests.values()):
                    await send(guest, "left", peer="host")
        return socket

    app = web.Application()
    app.router.add_get("/", index)
    app.router.add_get("/index.html", index)
    app.router.add_get("/room-socket", room_socket, allow_head=False)
    app.router.add_get("/{name:.*}", file)
    return app


def https_origin(value):
    try:
        url = urlsplit(value)
        if (url.scheme == "https" and url.hostname and url.username is None
                and not url.path.strip("/") and not url.query and not url.fragment):
            port = f":{url.port}" if url.port not in {None, 443} else ""
            hostname = f"[{url.hostname}]" if ":" in url.hostname else url.hostname
            return f"https://{hostname}{port}"
    except ValueError:
        pass
    raise argparse.ArgumentTypeError("indica un origen HTTPS, por ejemplo https://usuario.github.io")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8767)
    parser.add_argument("--allow-origin", action="append", default=[], type=https_origin)
    args = parser.parse_args()
    web.run_app(create_app(args.allow_origin), host=args.bind, port=args.port, access_log=None)
