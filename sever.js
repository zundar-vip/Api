const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const http = require('http');

const app = express();
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.options('*', cors());

const PORT = process.env.PORT || 10000;

let currentSessionId = 0;
let sessionHistory = [];
let wsConnectedTime = null;

const WEBSOCKET_URL = "wss://websocket.azhkthg1.net/websocket?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsInVzZXJuYW1lIjoiU0NfYXBpc3Vud2luMTIzIn0.hgrRbSV6vnBwJMg9ZFtbx3rRu9mX_hZMZ_m5gMNhkw0";

const WS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Origin": "https://play.sun.win"
};

const RECONNECT_DELAY = 3000;
const PING_INTERVAL = 15000;
const SELF_PING_INTERVAL = 300000;

const initialMessages = [
    [
        1,
        "MiniGame",
        "GM_apivopnha",
        "WangLin",
        {
            "info": "{\"ipAddress\":\"14.249.227.107\",\"wsToken\":\"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiI5ODE5YW5zc3MiLCJib3QiOjAsImlzTWVyY2hhbnQiOmZhbHNlLCJ2ZXJpZmllZEJhbmtBY2NvdW50IjpmYWxzZSwicGxheUV2ZW50TG9iYnkiOmZhbHNlLCJjdXN0b21lcklkIjozMjMyODExNTEsImFmZklkIjoic3VuLndpbiIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoiZ2VtIiwidGltZXN0YW1wIjoxNzYzMDMyOTI4NzcwLCJsb2NrR2FtZXMiOltdLCJhbW91bnQiOjAsImxvY2tDaGF0IjpmYWxzZSwicGhvbmVWZXJpZmllZCI6ZmFsc2UsImlwQWRkcmVzcyI6IjE0LjI0OS4yMjcuMTA3IiwibXV0ZSI6ZmFsc2UsImF2YXRhciI6Imh0dHBzOi8vaW1hZ2VzLnN3aW5zaG9wLm5ldC9pbWFnZXMvYXZhdGFyL2F2YXRhcl8wNS5wbmciLCJwbGF0Zm9ybUlkIjo0LCJ1c2VySWQiOiI4ODM4NTMzZS1kZTQzLTRiOGQtOTUwMy02MjFmNDA1MDUzNGUiLCJyZWdUaW1lIjoxNzYxNjMyMzAwNTc2LCJwaG9uZSI6IiIsImRlcG9zaXQiOmZhbHNlLCJ1c2VybmFtZSI6IkdNX2FwaXZvcG5oYSJ9.guH6ztJSPXUL1cU8QdMz8O1Sdy_SbxjSM-CDzWPTr-0\",\"locale\":\"vi\",\"userId\":\"8838533e-de43-4b8d-9503-621f4050534e\",\"username\":\"GM_apivopnha\",\"timestamp\":1763032928770,\"refreshToken\":\"e576b43a64e84f789548bfc7c4c8d1e5.7d4244a361e345908af95ee2e8ab2895\"}",
            "signature": "45EF4B318C883862C36E1B189A1DF5465EBB60CB602BA05FAD8FCBFCD6E0DA8CB3CE65333EDD79A2BB4ABFCE326ED5525C7D971D9DEDB5A17A72764287FFE6F62CBC2DF8A04CD8EFF8D0D5AE27046947ADE45E62E644111EFDE96A74FEC635A97861A425FF2B5732D74F41176703CA10CFEED67D0745FF15EAC1065E1C8BCBFA"
        }
    ],
    [6, "MiniGame", "taixiuPlugin", { cmd: 1005 }],
    [6, "MiniGame", "lobbyPlugin", { cmd: 10001 }]
];

let ws = null;
let pingInterval = null;
let reconnectTimeout = null;
let selfPingInterval = null;
let isConnected = false;

function selfPing() {
    const url = "http://localhost:" + PORT + "/api/tx";
    http.get(url, (res) => {
        console.log("[💓] Self-ping OK: " + res.statusCode);
    }).on("error", (e) => {
        console.log("[💓] Self-ping err: " + e.message);
    });
}

function connectWebSocket() {
    if (ws) {
        try { ws.removeAllListeners(); } catch(e) {}
        try { ws.terminate(); } catch(e) {}
        ws = null;
    }

    try {
        ws = new WebSocket(WEBSOCKET_URL, {
            headers: WS_HEADERS,
            handshakeTimeout: 10000,
            timeout: 60000,
            maxPayload: 104857600
        });
    } catch(e) {
        console.log("[❌] WS Create Err:", e.message);
        reconnectTimeout = setTimeout(connectWebSocket, RECONNECT_DELAY);
        return;
    }

    ws.on("open", () => {
        console.log("[✅] WS Connected!");
        isConnected = true;
        wsConnectedTime = new Date().toISOString();

        initialMessages.forEach((msg, i) => {
            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    try {
                        ws.send(JSON.stringify(msg));
                        console.log("[📤] Init " + (i + 1) + "/" + initialMessages.length);
                    } catch(e) {}
                }
            }, i * 1000);
        });

        clearInterval(pingInterval);
        pingInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                try { ws.ping(); } catch(e) {}
            }
        }, PING_INTERVAL);
    });

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);
            if (!Array.isArray(data) || typeof data[1] !== "object") return;

            const { cmd, sid, d1, d2, d3, gBB } = data[1];

            if (cmd === 1008 && sid) {
                currentSessionId = sid;
            }

            if (cmd === 1003 && gBB) {
                if (typeof d1 === "undefined" || typeof d2 === "undefined" || typeof d3 === "undefined") return;

                const total = d1 + d2 + d3;
                const result = (total > 10) ? "Tài" : "Xỉu";
                const phien = sid || currentSessionId;

                sessionHistory.unshift({
                    "Phien": phien,
                    "Xuc_xac_1": d1,
                    "Xuc_xac_2": d2,
                    "Xuc_xac_3": d3,
                    "Tong": total,
                    "Ket_qua": result
                });

                console.log("[🎲] " + phien + ": " + d1 + "-" + d2 + "-" + d3 + " = " + total + " (" + result + ")");
            }
        } catch (e) {}
    });

    ws.on("close", (code) => {
        console.log("[🔌] WS Closed: " + code);
        isConnected = false;
        clearInterval(pingInterval);
        clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(connectWebSocket, RECONNECT_DELAY);
    });

    ws.on("error", (err) => {
        console.log("[❌] WS Error: " + err.message);
        isConnected = false;
        clearInterval(pingInterval);
        try { ws.terminate(); } catch(e) {}
        clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(connectWebSocket, RECONNECT_DELAY);
    });
}

app.get("/api/tx", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    res.json({
        "status": "ok",
        "ws_connected": isConnected,
        "ws_since": wsConnectedTime,
        "current_phien": currentSessionId,
        "history": sessionHistory,
        "total": sessionHistory.length,
        "id": "@NguyenTung1920"
    });
});

app.get("/", (req, res) => {
    res.redirect("/api/tx");
});

app.get("/health", (req, res) => {
    res.status(200).send("OK");
});

const server = app.listen(PORT, "0.0.0.0", () => {
    console.log("[🌐] Server: PORT " + PORT);
    console.log("[📊] API: /api/txsun");
    
    selfPingInterval = setInterval(selfPing, SELF_PING_INTERVAL);
    selfPing();
    connectWebSocket();
});

server.keepAliveTimeout = 300000;
server.headersTimeout = 310000;

process.on("uncaughtException", (err) => {
    console.log("[💥]", err.message);
});

process.on("unhandledRejection", (reason) => {
    console.log("[💥]", reason);
});