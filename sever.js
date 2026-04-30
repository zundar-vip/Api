const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
const PORT = process.env.PORT || 5000;

var apiResponseData = {
    id: "@boladuas",
    phien_truoc: null,
    xuc_xac_1: null,
    xuc_xac_2: null,
    xuc_xac_3: null,
    phien_hien_tai: null,
    du_doan: "?",
    do_tin_cay: "0%",
    ket_qua: "dang doi ket qua..."
};

var currentSessionId = null;
var lastProcessedSessionId = null;
var patternHistory = [];
var fullHistory = [];
var sessionPredictions = new Map();
var correctCount = 0;
var totalCount = 0;

var WS_URL = "wss://websocket.azhkthg1.net/websocket?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsInVzZXJuYW1lIjoiU0NfYXBpc3Vud2luMTIzIn0.hgrRbSV6vnBwJMg9ZFtbx3rRu9mX_hZMZ_m5gMNhkw0";
var WS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Origin": "https://play.sun.win"
};
var RECONNECT_DELAY = 2500;
var PING_INTERVAL = 15000;

var initMsgs = [
    [1, "MiniGame", "SC_anhlocbuwin", "WangLin", {
        info: '{"ipAddress":"14.172.129.70","wsToken":"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJ0aWdlcl9idV93aW4iLCJib3QiOjAsImlzTWVyY2hhbnQiOmZhbHNlLCJ2ZXJpZmllZEJhbmtBY2NvdW50IjpmYWxzZSwicGxheUV2ZW50TG9iYnkiOmZhbHNlLCJjdXN0b21lcklkIjozMTg2NjY3MDEsImFmZklkIjoiZGVmYXVsdCIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoic3VuLndpbiIsInRpbWVzdGFtcCI6MTc3MTIzMTgwMzQ5OCwibG9ja0dhbWVzIjpbXSwiYW1vdW50IjowLCJsb2NrQ2hhdCI6ZmFsc2UsInBob25lVmVyaWZpZWQiOmZhbHNlLCJpcEFkZHJlc3MiOiIxNC4xNzIuMTI5LjcwIiwibXV0ZSI6ZmFsc2UsImF2YXRhciI6Imh0dHBzOi8vaW1hZ2VzLnN3aW5zaG9wLm5ldC9pbWFnZXMvYXZhdGFyL2F2YXRhcl8wNC5wbmciLCJwbGF0Zm9ybUlkIjoxLCJ1c2VySWQiOiJlZGE0NDAzYS03ZDllLTQ5NTUtYWVkMy0xMDU2YjVhMDUxM2YiLCJyZWdUaW1lIjoxNzU4ODAyMjMyNDM4LCJwaG9uZSI6IiIsImRlcG9zaXQiOnRydWUsInVzZXJuYW1lIjoiU0NfYW5obG9jYnV3aW4ifQ.4FT1xAunF09GJzm276zFrM9V2BYd_BPsO_4mcdcRh-w","userId":"eda4403a-7d9e-4955-aed3-1056b5a0513f","username":"SC_anhlocbuwin","timestamp":1771231803499}',
        signature: "8D0448B9546D9F26855DE6B2A6C6B8F420137E610755CD8DCF78AE54528DA479757B5287127E936C84440A2DE1349CCA41A37B6A4A0254639BD4FF660AA6455B19666EABFE7C7B81A10A499199A9C23DFC2DF2AE188C483D21B17075DCFE472AE4C684915476B1F7C5E56F98306E18435CC5771774D859EAFD0B26E8D3A30EE"
    }],
    [6, "MiniGame", "taixiuPlugin", { cmd: 1005 }],
    [6, "MiniGame", "lobbyPlugin", { cmd: 10001 }]
];

function calcMean(arr) {
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return arr.length ? s / arr.length : 0;
}

function calcStd(arr) {
    if (arr.length < 2) return 0;
    var m = calcMean(arr);
    var ss = 0;
    for (var i = 0; i < arr.length; i++) ss += Math.pow(arr[i] - m, 2);
    return Math.sqrt(ss / arr.length);
}

function calcLinReg(arr) {
    var n = arr.length;
    if (n < 2) return { slope: 0, intercept: arr[0] || 0 };
    var sx = 0, sy = 0, sxy = 0, sx2 = 0;
    for (var i = 0; i < n; i++) { sx += i; sy += arr[i]; sxy += i * arr[i]; sx2 += i * i; }
    var slope = (n * sxy - sx * sy) / (n * sx2 - sx * sx);
    return { slope: slope, intercept: (sy - slope * sx) / n };
}

function calcEMA(arr, p) {
    if (!arr.length) return 0;
    var mul = 2 / (p + 1), ema = arr[0];
    for (var i = 1; i < arr.length; i++) ema = arr[i] * mul + ema * (1 - mul);
    return ema;
}

function predict() {
    if (fullHistory.length < 10) {
        return { prediction: 'Tai', confidence: 50 };
    }

    var txArr = [], totals = [];
    for (var i = 0; i < fullHistory.length; i++) { txArr.push(fullHistory[i].tx); totals.push(fullHistory[i].total); }

    var r10 = txArr.slice(-10), r20 = txArr.slice(-20), r30 = txArr.slice(-30);
    var t10 = 0, x10 = 0, t20 = 0, x20 = 0, t30 = 0, x30 = 0;
    for (var i = 0; i < r10.length; i++) { if (r10[i] === 'T') t10++; else x10++; }
    for (var i = 0; i < r20.length; i++) { if (r20[i] === 'T') t20++; else x20++; }
    for (var i = 0; i < r30.length; i++) { if (r30[i] === 'T') t30++; else x30++; }

    var totalAvg = calcMean(totals);
    var totalStd = calcStd(totals);
    var recentAvg = calcMean(totals.slice(-8));
    var regression = calcLinReg(totals.slice(-30));
    var ema12 = calcEMA(totals.slice(-12), 12);
    var ema26 = calcEMA(totals.slice(-26), 26);
    var macd = ema12 - ema26;

    var votes = { 'Tai': 0, 'Xiu': 0 };
    var sRatio = t10 / 10, lRatio = t20 / 20, xlRatio = t30 / 30;

    if (sRatio > 0.7 && lRatio > 0.65) votes['Xiu'] += 3.5;
    else if (sRatio < 0.3 && lRatio < 0.35) votes['Tai'] += 3.5;
    else if (sRatio > lRatio + 0.2) votes['Tai'] += 2.5;
    else if (lRatio > sRatio + 0.2) votes['Xiu'] += 2.5;
    else if (sRatio > 0.55) votes['Tai'] += 1;
    else if (sRatio < 0.45) votes['Xiu'] += 1;

    if (recentAvg > totalAvg + totalStd * 0.8) votes['Xiu'] += 2.5;
    else if (recentAvg < totalAvg - totalStd * 0.8) votes['Tai'] += 2.5;
    else if (recentAvg > 11.2) votes['Xiu'] += 1.5;
    else if (recentAvg < 9.8) votes['Tai'] += 1.5;

    if (macd > 0.5) votes['Xiu'] += 2;
    else if (macd < -0.5) votes['Tai'] += 2;
    else if (macd > 0.2) votes['Xiu'] += 1;
    else if (macd < -0.2) votes['Tai'] += 1;

    if (regression.slope > 0.05) votes['Xiu'] += 2;
    else if (regression.slope < -0.05) votes['Tai'] += 2;

    var lastTx = txArr[txArr.length - 1];
    var streak = 1;
    for (var i = txArr.length - 2; i >= 0; i--) { if (txArr[i] === lastTx) streak++; else break; }
    if (streak >= 5) { if (lastTx === 'T') votes['Xiu'] += 3; else votes['Tai'] += 3; }
    else if (streak >= 3) { if (lastTx === 'T') votes['Tai'] += 2; else votes['Xiu'] += 2; }
    else if (streak >= 2) { if (lastTx === 'T') votes['Tai'] += 1; else votes['Xiu'] += 1; }

    var txStr = txArr.join('').toLowerCase();
    var patterns = { 'ttxx': [0.7, 'x'], 'xxtt': [0.7, 't'], 'tttxxx': [0.9, 'x'], 'xxxttt': [0.9, 't'], 'txxxt': [0.6, 't'], 'xtttx': [0.6, 'x'], 'txtx': [0.4, 't'], 'xtxt': [0.4, 'x'], 'ttxxtt': [0.8, 'x'], 'xxttxx': [0.8, 't'], 'ttttxxxx': [0.95, 'x'], 'xxxxtttt': [0.95, 't'], 'txxttt': [0.65, 'x'], 'xttxxx': [0.65, 't'] };
    var pk = Object.keys(patterns);
    for (var k = 0; k < pk.length; k++) {
        var ps = pk[k], plen = ps.length;
        if (txArr.length < plen) continue;
        if (txStr.slice(-plen) === ps) {
            if (patterns[ps][1] === 't') votes['Tai'] += patterns[ps][0] * 3;
            else votes['Xiu'] += patterns[ps][0] * 3;
        }
    }

    var mm = { 'T': { 'T': 0, 'X': 0 }, 'X': { 'T': 0, 'X': 0 } };
    for (var i = 1; i < txArr.length; i++) mm[txArr[i-1]][txArr[i]]++;
    var lastState = txArr[txArr.length - 1];
    var trans = mm[lastState];
    var transTotal = trans['T'] + trans['X'];
    if (transTotal > 0) {
        var tProb = trans['T'] / transTotal;
        if (tProb > 0.65) votes['Tai'] += 2;
        else if (tProb < 0.35) votes['Xiu'] += 2;
        else if (tProb > 0.55) votes['Tai'] += 1;
        else if (tProb < 0.45) votes['Xiu'] += 1;
    }

    var recent10Totals = totals.slice(-10);
    var vol10 = calcStd(recent10Totals);
    var recentAvg10 = calcMean(recent10Totals);
    if (vol10 > 3.5) { if (recentAvg10 > 11) votes['Xiu'] += 1.5; else votes['Tai'] += 1.5; }
    else if (vol10 < 1.5) { var trend = recent10Totals[recent10Totals.length-1] - recent10Totals[0]; if (trend > 1) votes['Tai'] += 1; else if (trend < -1) votes['Xiu'] += 1; }

    var fib = [1, 1, 2, 3, 5, 8, 13, 21, 34];
    for (var f = 0; f < fib.length; f++) {
        var ff = fib[f];
        if (txArr.length > ff) {
            var pos = txArr.length - ff;
            if (pos < txArr.length) {
                if (txArr[pos] === 'T') votes['Tai'] += 0.3;
                else votes['Xiu'] += 0.3;
            }
        }
    }

    var totalVotes = votes['Tai'] + votes['Xiu'];
    if (totalVotes === 0) totalVotes = 1;

    var finalPrediction = votes['Tai'] > votes['Xiu'] ? 'Tai' : 'Xiu';
    var confidence = Math.round((Math.max(votes['Tai'], votes['Xiu']) / totalVotes) * 100);
    if (confidence > 98) confidence = 98;
    if (confidence < 51) confidence = 51;

    return { prediction: finalPrediction, confidence: confidence };
}

function getOrCreatePrediction(sessionId) {
    if (sessionPredictions.has(sessionId)) return sessionPredictions.get(sessionId);
    var result = predict();
    sessionPredictions.set(sessionId, result);
    if (sessionPredictions.size > 100) { var firstKey = sessionPredictions.keys().next().value; sessionPredictions.delete(firstKey); }
    return result;
}

function handleNewSession(sessionId) {
    if (!sessionId || sessionId === lastProcessedSessionId) return null;
    lastProcessedSessionId = sessionId;
    var predictionResult = getOrCreatePrediction(sessionId);
    apiResponseData.phien_hien_tai = sessionId;
    apiResponseData.du_doan = predictionResult.prediction;
    apiResponseData.do_tin_cay = predictionResult.confidence + '%';
    apiResponseData.ket_qua = "dang doi ket qua...";
    return predictionResult;
}

var ws = null;
var pingInterval = null;
var reconnectTimeout = null;

function connectWebSocket() {
    if (ws) { try { ws.removeAllListeners(); ws.close(); } catch(e) {} }
    try { ws = new WebSocket(WS_URL, { headers: WS_HEADERS }); } catch(err) { reconnectTimeout = setTimeout(connectWebSocket, RECONNECT_DELAY); return; }

    ws.on('open', function() {
        initMsgs.forEach(function(msg, i) {
            setTimeout(function() { if (ws && ws.readyState === WebSocket.OPEN) try { ws.send(JSON.stringify(msg)); } catch(e) {} }, i * 600);
        });
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(function() { if (ws && ws.readyState === WebSocket.OPEN) try { ws.ping(); } catch(e) {} }, PING_INTERVAL);
    });

    ws.on('message', function(message) {
        try {
            var data = JSON.parse(message);
            if (!Array.isArray(data) || typeof data[1] !== 'object') return;
            var cmd = data[1].cmd, sid = data[1].sid, d1 = data[1].d1, d2 = data[1].d2, d3 = data[1].d3, gBB = data[1].gBB;

            if (cmd === 1008 && sid) { currentSessionId = sid; handleNewSession(sid); }

            if (cmd === 1003 && gBB && d1 && d2 && d3) {
                var total = d1 + d2 + d3;
                var result = total > 10 ? "T" : "X";
                var resultText = result === "T" ? "Tai" : "Xiu";

                patternHistory.push(result);
                if (patternHistory.length > 60) patternHistory.shift();
                fullHistory.push({ tx: result, total: total, session: currentSessionId });
                if (fullHistory.length > 300) fullHistory.shift();

                var sessionPrediction = getOrCreatePrediction(currentSessionId);
                var isCorrect = sessionPrediction.prediction === resultText;
                if (isCorrect) correctCount++;
                totalCount++;

                apiResponseData.phien_truoc = currentSessionId;
                apiResponseData.xuc_xac_1 = d1;
                apiResponseData.xuc_xac_2 = d2;
                apiResponseData.xuc_xac_3 = d3;
                apiResponseData.ket_qua = isCorrect ? 'DUNG' : 'SAI';
            }
        } catch(e) {}
    });

    ws.on('close', function() { if (pingInterval) clearInterval(pingInterval); if (reconnectTimeout) clearTimeout(reconnectTimeout); reconnectTimeout = setTimeout(connectWebSocket, RECONNECT_DELAY); });
    ws.on('error', function() { try { ws.close(); } catch(e) {} });
}

app.get('/sunlon', function(req, res) {
    res.json({
        id: apiResponseData.id,
        phien_truoc: apiResponseData.phien_truoc,
        xuc_xac_1: apiResponseData.xuc_xac_1,
        xuc_xac_2: apiResponseData.xuc_xac_2,
        xuc_xac_3: apiResponseData.xuc_xac_3,
        phien_hien_tai: apiResponseData.phien_hien_tai,
        du_doan: apiResponseData.du_doan,
        do_tin_cay: apiResponseData.do_tin_cay,
        ket_qua: apiResponseData.ket_qua,
        pattern: patternHistory.join(''),
        ty_le_dung: totalCount > 0 ? (correctCount / totalCount * 100).toFixed(1) + '%' : '0%'
    });
});

app.get('/', function(req, res) {
    var html = '<h2>Sunwin Tai Xiu Ultra AI</h2>';
    html += '<p><a href="/sunlon">JSON API /sunlon</a></p>';
    html += '<p>Phien truoc: ' + (apiResponseData.phien_truoc || '...') + '</p>';
    html += '<p>Xuc xac: ' + (apiResponseData.xuc_xac_1 || '-') + '-' + (apiResponseData.xuc_xac_2 || '-') + '-' + (apiResponseData.xuc_xac_3 || '-') + '</p>';
    html += '<p>Phien hien tai: ' + (apiResponseData.phien_hien_tai || '...') + '</p>';
    html += '<p>Du doan: <b>' + apiResponseData.du_doan + '</b> (' + apiResponseData.do_tin_cay + ')</p>';
    html += '<p>Ket qua: ' + apiResponseData.ket_qua + '</p>';
    html += '<p>Pattern: ' + patternHistory.join('') + '</p>';
    html += '<p>Ty le dung: ' + (totalCount > 0 ? (correctCount / totalCount * 100).toFixed(1) + '%' : '0%') + ' (' + correctCount + '/' + totalCount + ')</p>';
    res.send(html);
});

var server = app.listen(PORT, function() { console.log('Server port ' + PORT); connectWebSocket(); });
server.on('error', function(err) { console.error('Server error:', err.message); });
process.on('uncaughtException', function(err) { console.error('Error:', err.message); });
process.on('unhandledRejection', function(err) { console.error('Reject:', err.message); });
