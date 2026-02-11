import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { RECONNECT_DELAY } from './constants.js';

export const DaemonClient = GObject.registerClass({
    Signals: {
        'message-received': { param_types: [GObject.TYPE_STRING] },
        'connected': {},
        'disconnected': {},
    },
}, class DaemonClient extends GObject.Object {

    _init(cancellable) {
        super._init();
        this._cancellable = cancellable;
        this._connection = null;
        this._inputStream = null;
        this._outputStream = null;
        this._reconnectTimeout = null;
    }

    start() {
        if (this._cancellable.is_cancelled())
            return;

        const socketPath = this._getSocketPath();
        const address = Gio.UnixSocketAddress.new(socketPath);
        const client = new Gio.SocketClient();

        client.connect_async(address, this._cancellable, (client, result) => {
            try {
                this._connection = client.connect_finish(result);
                this._connection.get_socket().set_blocking(false);
                this._inputStream = new Gio.DataInputStream({
                    base_stream: this._connection.get_input_stream(),
                });
                this._outputStream = this._connection.get_output_stream();

                this.emit('connected');
                this._readLoop();
            } catch (e) {
                if (!this._cancellable.is_cancelled())
                    this._scheduleReconnect();
            }
        });
    }

    send(msg) {
        if (!this._outputStream)
            return;

        try {
            const json = JSON.stringify(msg) + '\n';
            const bytes = new GLib.Bytes(new TextEncoder().encode(json));
            this._outputStream.write_bytes(bytes, null);
        } catch (e) {
            this._handleDisconnect();
        }
    }

    stop() {
        if (this._reconnectTimeout !== null) {
            GLib.source_remove(this._reconnectTimeout);
            this._reconnectTimeout = null;
        }

        if (this._connection) {
            this._connection.close(null);
            this._connection = null;
        }

        this._inputStream = null;
        this._outputStream = null;
    }

    _getSocketPath() {
        return GLib.get_user_runtime_dir() + '/agents-monitor/daemon.sock';
    }

    _scheduleReconnect() {
        if (this._reconnectTimeout !== null || this._cancellable.is_cancelled())
            return;

        this._reconnectTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RECONNECT_DELAY, () => {
            this._reconnectTimeout = null;
            this.start();
            return GLib.SOURCE_REMOVE;
        });
    }

    _readLoop() {
        if (!this._inputStream || this._cancellable.is_cancelled())
            return;

        this._inputStream.read_line_async(GLib.PRIORITY_DEFAULT, this._cancellable, (stream, result) => {
            try {
                const [line] = stream.read_line_finish_utf8(result);

                if (line === null) {
                    this._handleDisconnect();
                    return;
                }

                this.emit('message-received', line);
                this._readLoop();
            } catch (e) {
                if (!this._cancellable.is_cancelled())
                    this._handleDisconnect();
            }
        });
    }

    _handleDisconnect() {
        this._connection = null;
        this._inputStream = null;
        this._outputStream = null;
        this.emit('disconnected');
        this._scheduleReconnect();
    }
});
