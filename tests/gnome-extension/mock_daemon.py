import asyncio
import json
import os


class MockDaemon:

    def __init__(self, socket_path):
        self.socket_path = socket_path
        self.messages = []
        self._server = None
        self._reader = None
        self._writer = None
        self._connected = asyncio.Event()

    async def start(self):
        os.makedirs(os.path.dirname(self.socket_path), exist_ok=True)
        self._server = await asyncio.start_unix_server(
            self._handle_client, path=self.socket_path
        )

    async def _handle_client(self, reader, writer):
        self._reader = reader
        self._writer = writer
        self._connected.set()

    async def wait_for_connection(self, timeout=10):
        await asyncio.wait_for(self._connected.wait(), timeout=timeout)

    async def recv(self, timeout=5):
        assert self._reader is not None, "no client connected"
        raw = await asyncio.wait_for(self._reader.readline(), timeout=timeout)
        if not raw:
            raise ConnectionError("client disconnected")
        msg = json.loads(raw.decode())
        self.messages.append(msg)
        return msg

    async def recv_until(self, msg_type, timeout=5):
        deadline = asyncio.get_event_loop().time() + timeout
        while True:
            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                raise TimeoutError(
                    f"timeout waiting for '{msg_type}', "
                    f"got: {[m.get('type') for m in self.messages]}"
                )
            msg = await self.recv(timeout=remaining)
            if msg.get("type") == msg_type:
                return msg

    async def send(self, msg):
        assert self._writer is not None, "no client connected"
        data = json.dumps(msg) + "\n"
        self._writer.write(data.encode())
        await self._writer.drain()

    async def stop(self):
        if self._writer:
            self._writer.close()
        if self._server:
            self._server.close()
            await self._server.wait_closed()
        if os.path.exists(self.socket_path):
            os.unlink(self.socket_path)
