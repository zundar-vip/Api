const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 5000;

let apiResponseData = {
    id: "@boladuas",
    phien: null,
    xuc_xac_1: null,
    xuc_xac_2: null,
    xuc_xac_3: null,
    tong: null,
    ket_qua: "",
    du_doan: "?",
    pattern: "",
    so_sanh: "Đang chờ kết quả...",
    do_tin_cay: "0%",
    thuat_toan: "",
    phan_tich_sau: ""
};

let currentSessionId = null;
let lastProcessedSessionId = null;
const patternHistory = [];
const fullHistory = [];
const sessionPredictions = new Map();

const WEBSOCKET_URL = "wss://websocket.azhkthg1.net/websocket?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsInVzZXJuYW1lIjoiU0NfYXBpc3Vud2luMTIzIn0.hgrRbSV6vnBwJMg9ZFtbx3rRu9mX_hZMZ_m5gMNhkw0";
const WS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Origin": "https://play.sun.win"
};
const RECONNECT_DELAY = 2500;
const PING_INTERVAL = 15000;
const MAX_PATTERN_HISTORY = 60;

const initialMessages = [
    [1, "MiniGame", "SC_anhlocbuwin", "WangLin", {
        "info": "{\"ipAddress\":\"14.172.129.70\",\"wsToken\":\"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJ0aWdlcl9idV93aW4iLCJib3QiOjAsImlzTWVyY2hhbnQiOmZhbHNlLCJ2ZXJpZmllZEJhbmtBY2NvdW50IjpmYWxzZSwicGxheUV2ZW50TG9iYnkiOmZhbHNlLCJjdXN0b21lcklkIjozMTg2NjY3MDEsImFmZklkIjoiZGVmYXVsdCIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoic3VuLndpbiIsInRpbWVzdGFtcCI6MTc3MTIzMTgwMzQ5OCwibG9ja0dhbWVzIjpbXSwiYW1vdW50IjowLCJsb2NrQ2hhdCI6ZmFsc2UsInBob25lVmVyaWZpZWQiOmZhbHNlLCJpcEFkZHJlc3MiOiIxNC4xNzIuMTI5LjcwIiwibXV0ZSI6ZmFsc2UsImF2YXRhciI6Imh0dHBzOi8vaW1hZ2VzLnN3aW5zaG9wLm5ldC9pbWFnZXMvYXZhdGFyL2F2YXRhcl8wNC5wbmciLCJwbGF0Zm9ybUlkIjoxLCJ1c2VySWQiOiJlZGE0NDAzYS03ZDllLTQ5NTUtYWVkMy0xMDU2YjVhMDUxM2YiLCJyZWdUaW1lIjoxNzU4ODAyMjMyNDM4LCJwaG9uZSI6IiIsImRlcG9zaXQiOnRydWUsInVzZXJuYW1lIjoiU0NfYW5obG9jYnV3aW4ifQ.4FT1xAunF09GJzm276zFrM9V2BYd_BPsO_4mcdcRh-w\",\"userId\":\"eda4403a-7d9e-4955-aed3-1056b5a0513f\",\"username\":\"SC_anhlocbuwin\",\"timestamp\":1771231803499}",
        "signature": "8D0448B9546D9F26855DE6B2A6C6B8F420137E610755CD8DCF78AE54528DA479757B5287127E936C84440A2DE1349CCA41A37B6A4A0254639BD4FF660AA6455B19666EABFE7C7B81A10A499199A9C23DFC2DF2AE188C483D21B17075DCFE472AE4C684915476B1F7C5E56F98306E18435CC5771774D859EAFD0B26E8D3A30EE"
    }],
    [6, "MiniGame", "taixiuPlugin", { cmd: 1005 }],
    [6, "MiniGame", "lobbyPlugin", { cmd: 10001 }]
];

function calculateMean(arr) {
    if (arr.length === 0) return 0;
    var sum = 0;
    for (var i = 0; i < arr.length; i++) sum += arr[i];
    return sum / arr.length;
}

function calculateStdDev(arr) {
    if (arr.length < 2) return 0;
    var mean = calculateMean(arr);
    var sumSq = 0;
    for (var i = 0; i < arr.length; i++) sumSq += Math.pow(arr[i] - mean, 2);
    return Math.sqrt(sumSq / arr.length);
}

function calculateLinearRegression(yArr) {
    var n = yArr.length;
    if (n < 2) return { slope: 0, intercept: yArr[0] || 0 };
    var xArr = [];
    for (var i = 0; i < n; i++) xArr.push(i);
    var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (var i = 0; i < n; i++) {
        sumX += xArr[i];
        sumY += yArr[i];
        sumXY += xArr[i] * yArr[i];
        sumX2 += xArr[i] * xArr[i];
    }
    var slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    var intercept = (sumY - slope * sumX) / n;
    return { slope: slope, intercept: intercept };
}

function calculateEMA(arr, period) {
    if (arr.length === 0) return 0;
    var multiplier = 2 / (period + 1);
    var ema = arr[0];
    for (var i = 1; i < arr.length; i++) {
        ema = arr[i] * multiplier + ema * (1 - multiplier);
    }
    return ema;
}

class UltraPredictionEngine {
    constructor() {
        this.patterns = {
            'don_gian': { patterns: [['t','x'], ['x','t'], ['t','t'], ['x','x']], weight: 0.5 },
            '1-2-1': { patterns: [['t','x','x','x','t'], ['x','t','t','t','x']], weight: 0.7 },
            '2-2': { patterns: [['t','t','x','x'], ['x','x','t','t']], weight: 0.8 },
            '3-3': { patterns: [['t','t','t','x','x','x'], ['x','x','x','t','t','t']], weight: 0.9 },
            '2-1-2': { patterns: [['t','t','x','t','t'], ['x','x','t','x','x']], weight: 0.7 },
            '1-3-1': { patterns: [['t','x','t','t','t','x'], ['x','t','x','x','x','t']], weight: 0.8 },
            'zigzag_kep': { patterns: [['t','x','t','x','t'], ['x','t','x','t','x']], weight: 0.6 },
            'song_2': { patterns: [['t','t','x','x'], ['x','x','t','t']], weight: 0.7 },
            'song_3': { patterns: [['t','t','t','x','x','x'], ['x','x','x','t','t','t']], weight: 0.9 },
            'dao_chieu_1': { patterns: [['t','t','x'], ['x','x','t']], weight: 0.6 },
            'dao_chieu_2': { patterns: [['t','t','x','x'], ['x','x','t','t']], weight: 0.7 },
            'xoan_oc': { patterns: [['t','x','x','x','t'], ['x','t','t','t','x']], weight: 0.6 },
            'cap_so_cong': { patterns: [['t','x'], ['t','x','x'], ['t','x','x','x']], weight: 0.5 },
            'chen_1': { patterns: [['t','x','t','x','t'], ['x','t','x','t','x']], weight: 0.5 },
            'chen_2': { patterns: [['t','t','x','x','t','t'], ['x','x','t','t','x','x']], weight: 0.6 }
        };
        this.weights = {
            statistical: 1.0,
            pattern: 1.0,
            streak: 1.0,
            balance: 1.0,
            trend: 1.0,
            rsi: 1.0,
            volatility: 1.0,
            fibonacci: 1.0,
            markov: 1.0,
            regression: 1.0,
            entropy: 1.0,
            wave: 1.0
        };
        this.performance = {};
        var self = this;
        Object.keys(this.weights).forEach(function(k) {
            self.performance[k] = { correct: 0, total: 0, streak: 0, accuracy: 50 };
        });
    }

    analyzeHistory() {
        if (fullHistory.length < 10) return null;
        var txArray = fullHistory.map(function(h) { return h.tx; });
        var totals = fullHistory.map(function(h) { return h.total; });
        
        var tCount = txArray.filter(function(t) { return t === 'T'; }).length;
        var xCount = txArray.filter(function(t) { return t === 'X'; }).length;
        var totalCount = tCount + xCount;
        var tRatio = totalCount > 0 ? tCount / totalCount : 0.5;
        var totalMean = calculateMean(totals);
        var totalStd = calculateStdDev(totals);
        var regression = calculateLinearRegression(totals.slice(-30));
        
        var markovMatrix = { 'T': { 'T': 0, 'X': 0 }, 'X': { 'T': 0, 'X': 0 } };
        for (var i = 1; i < txArray.length; i++) {
            markovMatrix[txArray[i-1]][txArray[i]]++;
        }
        
        return {
            tRatio: tRatio,
            totalMean: totalMean,
            totalStd: totalStd,
            regression: regression,
            markovMatrix: markovMatrix,
            totalCount: totalCount
        };
    }

    predict() {
        var self = this;
        if (fullHistory.length < 10) {
            return { 
                prediction: Math.random() < 0.5 ? 'Tài' : 'Xỉu', 
                confidence: 50, 
                algorithm: 'random', 
                analysis: 'Đang thu thập dữ liệu...' 
            };
        }

        var txArray = fullHistory.map(function(h) { return h.tx; });
        var totals = fullHistory.map(function(h) { return h.total; });
        var analysis = this.analyzeHistory();
        var votes = { 'Tài': 0, 'Xỉu': 0 };

        var statPred = this.statisticalAnalysis(txArray, analysis);
        votes[statPred.prediction] += this.weights.statistical * (statPred.confidence / 50);

        var patternPred = this.patternRecognition(txArray);
        votes[patternPred.prediction] += this.weights.pattern * (patternPred.confidence / 50);

        var streakPred = this.streakAnalysis(txArray);
        votes[streakPred.prediction] += this.weights.streak * (streakPred.confidence / 50);

        var balancePred = this.balanceAnalysis(totals, analysis);
        votes[balancePred.prediction] += this.weights.balance * (balancePred.confidence / 50);

        var trendPred = this.trendAnalysis(txArray, totals, analysis);
        votes[trendPred.prediction] += this.weights.trend * (trendPred.confidence / 50);

        var rsiPred = this.rsiAnalysis(txArray);
        votes[rsiPred.prediction] += this.weights.rsi * (rsiPred.confidence / 50);

        var volatilityPred = this.volatilityAnalysis(totals);
        votes[volatilityPred.prediction] += this.weights.volatility * (volatilityPred.confidence / 50);

        var fibPred = this.fibonacciAnalysis(txArray);
        votes[fibPred.prediction] += this.weights.fibonacci * (fibPred.confidence / 50);

        var markovPred = this.markovAnalysis(txArray, analysis);
        votes[markovPred.prediction] += this.weights.markov * (markovPred.confidence / 50);

        var regressionPred = this.regressionAnalysis(totals, analysis);
        votes[regressionPred.prediction] += this.weights.regression * (regressionPred.confidence / 50);

        var entropyPred = this.entropyAnalysis(txArray);
        votes[entropyPred.prediction] += this.weights.entropy * (entropyPred.confidence / 50);

        var wavePred = this.waveAnalysis(txArray);
        votes[wavePred.prediction] += this.weights.wave * (wavePred.confidence / 50);

        var totalVotes = votes['Tài'] + votes['Xỉu'];
        if (totalVotes === 0) totalVotes = 1;
        
        var finalPrediction = votes['Tài'] > votes['Xỉu'] ? 'Tài' : 'Xỉu';
        var confidence = Math.round((Math.max(votes['Tài'], votes['Xỉu']) / totalVotes) * 100);
        if (confidence > 98) confidence = 98;
        if (confidence < 51) confidence = 51;

        var algoScores = [
            { name: 'statistical', conf: statPred.confidence },
            { name: 'pattern', conf: patternPred.confidence },
            { name: 'streak', conf: streakPred.confidence },
            { name: 'balance', conf: balancePred.confidence },
            { name: 'trend', conf: trendPred.confidence },
            { name: 'rsi', conf: rsiPred.confidence },
            { name: 'volatility', conf: volatilityPred.confidence },
            { name: 'fibonacci', conf: fibPred.confidence },
            { name: 'markov', conf: markovPred.confidence },
            { name: 'regression', conf: regressionPred.confidence },
            { name: 'entropy', conf: entropyPred.confidence },
            { name: 'wave', conf: wavePred.confidence }
        ];
        algoScores.sort(function(a, b) { return b.conf - a.conf; });
        var bestAlgo = algoScores[0];

        var analysisText = '';
        var voteRatio = votes[finalPrediction] / totalVotes;
        if (voteRatio > 0.75) {
            analysisText = finalPrediction + ' rất mạnh - ' + algoScores.length + ' thuật toán, đồng thuận cao';
        } else if (voteRatio > 0.65) {
            analysisText = finalPrediction + ' khá - Đa số thuật toán ủng hộ ' + finalPrediction;
        } else if (voteRatio > 0.55) {
            analysisText = finalPrediction + ' nhẹ - Các thuật toán đang phân vân';
        } else {
            analysisText = 'Cân bằng - Khó dự đoán, ưu tiên ' + finalPrediction;
        }

        return {
            prediction: finalPrediction,
            confidence: confidence,
            algorithm: bestAlgo.name,
            analysis: analysisText,
            votes: votes
        };
    }

    statisticalAnalysis(txArray, analysis) {
        if (!analysis) return { prediction: 'Tài', confidence: 50 };
        
        var recent10 = txArray.slice(-10);
        var recent20 = txArray.slice(-20);
        var tCount10 = recent10.filter(function(t) { return t === 'T'; }).length;
        var xCount10 = recent10.filter(function(t) { return t === 'X'; }).length;
        var tCount20 = recent20.filter(function(t) { return t === 'T'; }).length;
        var xCount20 = recent20.filter(function(t) { return t === 'X'; }).length;
        
        var shortRatio = tCount10 / 10;
        var longRatio = tCount20 / 20;
        var prediction = 'Tài';
        var confidence = 50;
        
        if (shortRatio > 0.6 && longRatio > 0.55) {
            prediction = 'Xỉu';
            confidence = 55 + Math.round((shortRatio - 0.5) * 50);
        } else if (shortRatio < 0.4 && longRatio < 0.45) {
            prediction = 'Tài';
            confidence = 55 + Math.round((0.5 - shortRatio) * 50);
        } else if (shortRatio > longRatio + 0.15) {
            prediction = 'Tài';
            confidence = 52 + Math.round((shortRatio - longRatio) * 40);
        } else if (longRatio > shortRatio + 0.15) {
            prediction = 'Xỉu';
            confidence = 52 + Math.round((longRatio - shortRatio) * 40);
        } else {
            prediction = analysis.tRatio > 0.5 ? 'Xỉu' : 'Tài';
            confidence = 51;
        }
        
        if (confidence > 85) confidence = 85;
        return { prediction: prediction, confidence: confidence };
    }

    patternRecognition(txArray) {
        if (txArray.length < 5) return { prediction: 'Tài', confidence: 50 };
        
        var txString = txArray.join('').toLowerCase();
        var bestMatch = null;
        var bestScore = 0;
        var self = this;
        
        Object.keys(this.patterns).forEach(function(name) {
            var patternObj = self.patterns[name];
            patternObj.patterns.forEach(function(pattern) {
                var patternStr = pattern.join('');
                var patternLen = pattern.length;
                if (txArray.length < patternLen + 1) return;
                
                var matchCount = 0;
                for (var i = 0; i <= txString.length - patternLen - 1; i++) {
                    if (txString.substr(i, patternLen) === patternStr) {
                        matchCount++;
                        var nextChar = txString.charAt(i + patternLen);
                        if (nextChar === 't' || nextChar === 'x') {
                            var score = (matchCount * 3 + patternLen * 2) * patternObj.weight;
                            if (score > bestScore) {
                                bestScore = score;
                                bestMatch = nextChar === 't' ? 'Tài' : 'Xỉu';
                            }
                        }
                    }
                }
                
                var lastSegments = txString.slice(-patternLen);
                if (lastSegments === patternStr) {
                    var score = (5 + patternLen * 3) * patternObj.weight;
                    if (score > bestScore) {
                        bestScore = score;
                        var idx = txString.length - patternLen - 1;
                        if (idx >= 0) {
                            bestMatch = txString.charAt(idx) === 't' ? 'Tài' : 'Xỉu';
                        }
                    }
                }
            });
        });
        
        if (bestMatch) {
            var confidence = 50 + Math.round(Math.min(bestScore * 3, 35));
            return { prediction: bestMatch, confidence: confidence };
        }
        return { prediction: 'Tài', confidence: 50 };
    }

    streakAnalysis(txArray) {
        if (txArray.length < 5) return { prediction: 'Tài', confidence: 50 };
        
        var lastResult = txArray[txArray.length - 1];
        var streakCount = 1;
        for (var i = txArray.length - 2; i >= 0; i--) {
            if (txArray[i] === lastResult) streakCount++;
            else break;
        }
        
        if (streakCount >= 5) {
            return { prediction: lastResult === 'T' ? 'Xỉu' : 'Tài', confidence: 65 + Math.min(streakCount, 8) * 2 };
        } else if (streakCount >= 3) {
            return { prediction: lastResult === 'T' ? 'Tài' : 'Xỉu', confidence: 55 + streakCount * 2 };
        } else if (streakCount >= 2) {
            return { prediction: lastResult === 'T' ? 'Tài' : 'Xỉu', confidence: 53 + streakCount };
        }
        
        return { prediction: lastResult === 'T' ? 'Xỉu' : 'Tài', confidence: 52 };
    }

    balanceAnalysis(totals, analysis) {
        if (!analysis || totals.length < 10) return { prediction: 'Tài', confidence: 50 };
        
        var recentAvg = calculateMean(totals.slice(-10));
        var longAvg = analysis.totalMean;
        var stdDev = analysis.totalStd;
        
        if (recentAvg > longAvg + stdDev) {
            return { prediction: 'Xỉu', confidence: 55 + Math.round(Math.min((recentAvg - longAvg) / stdDev * 10, 20)) };
        } else if (recentAvg < longAvg - stdDev) {
            return { prediction: 'Tài', confidence: 55 + Math.round(Math.min((longAvg - recentAvg) / stdDev * 10, 20)) };
        }
        
        if (analysis.tRatio > 0.58) return { prediction: 'Xỉu', confidence: 56 };
        if (analysis.tRatio < 0.42) return { prediction: 'Tài', confidence: 56 };
        
        return { prediction: analysis.tRatio > 0.5 ? 'Tài' : 'Xỉu', confidence: 51 };
    }

    trendAnalysis(txArray, totals, analysis) {
        if (!analysis || txArray.length < 15) return { prediction: 'Tài', confidence: 50 };
        
        var regression = analysis.regression;
        var trendScore = 0;
        var segments = [5, 10, 15, 20];
        
        segments.forEach(function(seg) {
            if (txArray.length >= seg) {
                var segment = txArray.slice(-seg);
                var tCount = segment.filter(function(t) { return t === 'T'; }).length;
                var xCount = segment.filter(function(t) { return t === 'X'; }).length;
                if (tCount > xCount * 1.2) trendScore += 1;
                else if (xCount > tCount * 1.2) trendScore -= 1;
            }
        });
        
        if (regression.slope > 0.05) trendScore += 2;
        else if (regression.slope < -0.05) trendScore -= 2;
        
        if (trendScore > 3) return { prediction: 'Xỉu', confidence: 55 + Math.min(trendScore * 3, 20) };
        else if (trendScore < -3) return { prediction: 'Tài', confidence: 55 + Math.min(Math.abs(trendScore) * 3, 20) };
        else if (trendScore > 0) return { prediction: 'Tài', confidence: 53 };
        else if (trendScore < 0) return { prediction: 'Xỉu', confidence: 53 };
        
        return { prediction: 'Tài', confidence: 50 };
    }

    rsiAnalysis(txArray) {
        if (txArray.length < 14) return { prediction: 'Tài', confidence: 50 };
        
        var gains = 0, losses = 0;
        var period = Math.min(14, txArray.length);
        for (var i = txArray.length - period + 1; i < txArray.length; i++) {
            if (txArray[i] === 'T' && txArray[i-1] === 'X') gains++;
            else if (txArray[i] === 'X' && txArray[i-1] === 'T') losses++;
        }
        
        if (losses === 0) return { prediction: 'Xỉu', confidence: 65 };
        if (gains === 0) return { prediction: 'Tài', confidence: 65 };
        
        var rs = gains / losses;
        var rsi = 100 - (100 / (1 + rs));
        
        if (rsi > 75) return { prediction: 'Xỉu', confidence: 60 + Math.round((rsi - 70) / 2) };
        if (rsi < 25) return { prediction: 'Tài', confidence: 60 + Math.round((30 - rsi) / 2) };
        if (rsi > 60) return { prediction: 'Tài', confidence: 54 };
        if (rsi < 40) return { prediction: 'Xỉu', confidence: 54 };
        
        return { prediction: rsi > 50 ? 'Tài' : 'Xỉu', confidence: 52 };
    }

    volatilityAnalysis(totals) {
        if (totals.length < 10) return { prediction: 'Tài', confidence: 50 };
        
        var recent10 = totals.slice(-10);
        var recent20 = totals.slice(-Math.min(20, totals.length));
        var vol10 = calculateStdDev(recent10);
        var vol20 = calculateStdDev(recent20);
        
        if (vol10 > vol20 * 1.5) {
            var recentAvg = calculateMean(recent10);
            if (recentAvg > 11) return { prediction: 'Xỉu', confidence: 58 };
            if (recentAvg < 10) return { prediction: 'Tài', confidence: 58 };
        } else if (vol10 < vol20 * 0.6) {
            var trend = recent10[recent10.length - 1] - recent10[0];
            if (trend > 1) return { prediction: 'Tài', confidence: 56 };
            if (trend < -1) return { prediction: 'Xỉu', confidence: 56 };
        }
        
        var mean = calculateMean(recent10);
        if (mean > 10.8) return { prediction: 'Xỉu', confidence: 54 };
        if (mean < 10.2) return { prediction: 'Tài', confidence: 54 };
        
        return { prediction: 'Tài', confidence: 50 };
    }

    fibonacciAnalysis(txArray) {
        if (txArray.length < 8) return { prediction: 'Tài', confidence: 50 };
        
        var fib = [1, 1, 2, 3, 5, 8, 13, 21, 34];
        var matches = { 'Tài': 0, 'Xỉu': 0 };
        
        fib.forEach(function(f) {
            if (txArray.length > f) {
                var pos = txArray.length - f;
                if (pos < txArray.length) {
                    if (txArray[pos] === 'T') matches['Tài']++;
                    else matches['Xỉu']++;
                }
            }
        });
        
        var total = matches['Tài'] + matches['Xỉu'];
        if (total > 0) {
            var ratio = Math.max(matches['Tài'], matches['Xỉu']) / total;
            if (ratio > 0.7) {
                return { 
                    prediction: matches['Tài'] > matches['Xỉu'] ? 'Tài' : 'Xỉu', 
                    confidence: 55 + Math.round(ratio * 20) 
                };
            }
        }
        
        return { prediction: 'Tài', confidence: 50 };
    }

    markovAnalysis(txArray, analysis) {
        if (!analysis || txArray.length < 10) return { prediction: 'Tài', confidence: 50 };
        
        var lastState = txArray[txArray.length - 1];
        var matrix = analysis.markovMatrix;
        var tTrans = matrix[lastState]['T'];
        var xTrans = matrix[lastState]['X'];
        var totalTrans = tTrans + xTrans;
        
        if (totalTrans === 0) return { prediction: 'Tài', confidence: 50 };
        
        var tProb = tTrans / totalTrans;
        var xProb = xTrans / totalTrans;
        
        if (tProb > 0.65) return { prediction: 'Tài', confidence: 55 + Math.round((tProb - 0.5) * 60) };
        if (xProb > 0.65) return { prediction: 'Xỉu', confidence: 55 + Math.round((xProb - 0.5) * 60) };
        
        return { prediction: tProb > xProb ? 'Tài' : 'Xỉu', confidence: 52 };
    }

    regressionAnalysis(totals, analysis) {
        if (!analysis || totals.length < 20) return { prediction: 'Tài', confidence: 50 };
        
        var slope = analysis.regression.slope;
        var recentEMA = calculateEMA(totals.slice(-12), 5);
        var longEMA = calculateEMA(totals.slice(-26), 12);
        var macd = recentEMA - longEMA;
        
        var score = 0;
        if (slope > 0.08) score -= 2;
        else if (slope < -0.08) score += 2;
        if (macd > 0.3) score += 1;
        else if (macd < -0.3) score -= 1;
        
        if (score > 2) return { prediction: 'Xỉu', confidence: 55 + Math.min(score * 4, 20) };
        if (score < -2) return { prediction: 'Tài', confidence: 55 + Math.min(Math.abs(score) * 4, 20) };
        
        return { prediction: score > 0 ? 'Xỉu' : 'Tài', confidence: 51 };
    }

    entropyAnalysis(txArray) {
        if (txArray.length < 10) return { prediction: 'Tài', confidence: 50 };
        
        var recent10 = txArray.slice(-10);
        var changes = 0;
        for (var i = 1; i < recent10.length; i++) {
            if (recent10[i] !== recent10[i-1]) changes++;
        }
        
        var entropy = changes / 9;
        
        if (entropy > 0.7) {
            var lastChange = recent10[recent10.length - 1] !== recent10[recent10.length - 2];
            if (lastChange) {
                return { prediction: recent10[recent10.length - 1] === 'T' ? 'Xỉu' : 'Tài', confidence: 58 };
            } else {
                return { prediction: recent10[recent10.length - 1] === 'T' ? 'Tài' : 'Xỉu', confidence: 55 };
            }
        } else if (entropy < 0.3) {
            return { prediction: recent10[recent10.length - 1] === 'T' ? 'Xỉu' : 'Tài', confidence: 56 };
        }
        
        return { prediction: 'Tài', confidence: 50 };
    }

    waveAnalysis(txArray) {
        if (txArray.length < 12) return { prediction: 'Tài', confidence: 50 };
        
        var txString = txArray.join('').toLowerCase();
        var wavePatterns = [
            { pattern: 'txxt', name: 'wave1' },
            { pattern: 'xttx', name: 'wave2' },
            { pattern: 'txxxt', name: 'wave3' },
            { pattern: 'xtttx', name: 'wave4' },
            { pattern: 'ttxxtt', name: 'wave5' },
            { pattern: 'xxttxx', name: 'wave6' }
        ];
        
        var bestMatch = null;
        var bestCount = 0;
        
        wavePatterns.forEach(function(wp) {
            var patternLen = wp.pattern.length;
            var count = 0;
            for (var i = 0; i <= txString.length - patternLen; i++) {
                if (txString.substr(i, patternLen) === wp.pattern) count++;
            }
            if (count > bestCount) {
                bestCount = count;
                bestMatch = wp;
            }
        });
        
        if (bestMatch && bestCount >= 2) {
            var lastPattern = txString.slice(-bestMatch.pattern.length);
            if (lastPattern === bestMatch.pattern) {
                var nextIdx = txString.length - bestMatch.pattern.length - 1;
                if (nextIdx >= 0) {
                    var predicted = txString.charAt(nextIdx) === 't' ? 'Tài' : 'Xỉu';
                    return { prediction: predicted, confidence: 55 + bestCount * 3 };
                }
            }
        }
        
        return { prediction: 'Tài', confidence: 50 };
    }

    updateWeights(actualResult, predictedResult) {
        var self = this;
        var actualTX = actualResult === 'Tài' ? 'T' : 'X';
        var predTX = predictedResult === 'Tài' ? 'T' : 'X';
        var isCorrect = actualTX === predTX;
        
        Object.keys(this.performance).forEach(function(key) {
            if (isCorrect) {
                self.performance[key].correct++;
                self.performance[key].streak++;
            } else {
                self.performance[key].streak = 0;
            }
            self.performance[key].total++;
            
            if (self.performance[key].total >= 10) {
                var accuracy = self.performance[key].correct / self.performance[key].total;
                var streakBonus = Math.min(self.performance[key].streak, 5) * 0.02;
                self.weights[key] = Math.max(0.3, Math.min(2.5, accuracy * 2 + streakBonus));
                self.performance[key].accuracy = Math.round(accuracy * 100);
            }
        });
    }
}

var predictionEngine = new UltraPredictionEngine();

function getOrCreatePrediction(sessionId) {
    if (sessionPredictions.has(sessionId)) {
        return sessionPredictions.get(sessionId);
    }
    
    var result = predictionEngine.predict();
    sessionPredictions.set(sessionId, result);
    
    if (sessionPredictions.size > 100) {
        var firstKey = sessionPredictions.keys().next().value;
        sessionPredictions.delete(firstKey);
    }
    
    return result;
}

function isNewSession(sessionId) {
    return sessionId && sessionId !== lastProcessedSessionId;
}

function handleNewSession(sessionId) {
    if (!isNewSession(sessionId)) return null;
    
    lastProcessedSessionId = sessionId;
    var predictionResult = getOrCreatePrediction(sessionId);
    
    apiResponseData.phien = sessionId;
    apiResponseData.du_doan = predictionResult.prediction;
    apiResponseData.do_tin_cay = predictionResult.confidence + '%';
    apiResponseData.thuat_toan = predictionResult.algorithm;
    apiResponseData.phan_tich_sau = predictionResult.analysis;
    apiResponseData.so_sanh = "Đang chờ kết quả mới...";
    
    return predictionResult;
}

var ws = null;
var pingInterval = null;
var reconnectTimeout = null;

function connectWebSocket() {
    if (ws) {
        ws.removeAllListeners();
        ws.close();
    }

    try {
        ws = new WebSocket(WEBSOCKET_URL, { headers: WS_HEADERS });
    } catch (err) {
        console.error('WebSocket create error:', err.message);
        reconnectTimeout = setTimeout(connectWebSocket, RECONNECT_DELAY);
        return;
    }

    ws.on('open', function() {
        console.log('WebSocket connected');
        initialMessages.forEach(function(msg, i) {
            setTimeout(function() {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    try {
                        ws.send(JSON.stringify(msg));
                    } catch (err) {}
                }
            }, i * 600);
        });

        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(function() {
            if (ws && ws.readyState === WebSocket.OPEN) {
                try { ws.ping(); } catch (err) {}
            }
        }, PING_INTERVAL);
    });

    ws.on('message', function(message) {
        try {
            var data = JSON.parse(message);
            if (!Array.isArray(data) || typeof data[1] !== 'object') return;

            var cmd = data[1].cmd;
            var sid = data[1].sid;
            var d1 = data[1].d1;
            var d2 = data[1].d2;
            var d3 = data[1].d3;
            var gBB = data[1].gBB;

            if (cmd === 1008 && sid) {
                currentSessionId = sid;
                handleNewSession(sid);
            }

            if (cmd === 1003 && gBB) {
                if (!d1 || !d2 || !d3) return;

                var total = d1 + d2 + d3;
                var result = total > 10 ? "T" : "X";
                var resultText = result === "T" ? "Tài" : "Xỉu";

                patternHistory.push(result);
                if (patternHistory.length > MAX_PATTERN_HISTORY) patternHistory.shift();
                fullHistory.push({ tx: result, total: total, session: currentSessionId });
                if (fullHistory.length > 300) fullHistory.shift();

                var sessionPrediction = getOrCreatePrediction(currentSessionId);
                var isCorrect = sessionPrediction.prediction === resultText;
                
                predictionEngine.updateWeights(resultText, sessionPrediction.prediction);

                apiResponseData.xuc_xac_1 = d1;
                apiResponseData.xuc_xac_2 = d2;
                apiResponseData.xuc_xac_3 = d3;
                apiResponseData.tong = total;
                apiResponseData.ket_qua = resultText;
                apiResponseData.du_doan = sessionPrediction.prediction;
                apiResponseData.do_tin_cay = sessionPrediction.confidence + '%';
                apiResponseData.thuat_toan = sessionPrediction.algorithm;
                apiResponseData.phan_tich_sau = sessionPrediction.analysis;
                apiResponseData.so_sanh = 'Dự đoán: ' + sessionPrediction.prediction + ' | Kết quả: ' + (isCorrect ? 'ĐÚNG' : 'SAI');
                apiResponseData.pattern = patternHistory.join('');
            }
        } catch (e) {}
    });

    ws.on('close', function() {
        if (pingInterval) clearInterval(pingInterval);
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(connectWebSocket, RECONNECT_DELAY);
    });

    ws.on('error', function() {
        try { ws.close(); } catch (e) {}
    });
}

app.get('/sunlon', function(req, res) {
    res.json(apiResponseData);
});

app.get('/stats', function(req, res) {
    var stats = {};
    Object.keys(predictionEngine.performance).forEach(function(key) {
        var perf = predictionEngine.performance[key];
        stats[key] = {
            accuracy: perf.total > 0 ? (perf.correct / perf.total * 100).toFixed(1) + '%' : '0%',
            weight: predictionEngine.weights[key].toFixed(2),
            total: perf.total,
            correct: perf.correct,
            streak: perf.streak
        };
    });
    res.json({ algorithm_stats: stats, pattern_history: patternHistory });
});

app.get('/', function(req, res) {
    var html = '<h2>Sunwin Ultra AI - 12 Algorithms</h2>';
    html += '<p><a href="/sunlon">JSON API</a> | <a href="/stats">Stats</a></p>';
    html += '<p>Phiên: ' + (apiResponseData.phien || 'Chờ...') + '</p>';
    html += '<p>Dự đoán: <b>' + apiResponseData.du_doan + '</b> (' + apiResponseData.do_tin_cay + ')</p>';
    html += '<p>Thuật toán: ' + (apiResponseData.thuat_toan || 'N/A') + '</p>';
    html += '<p>Phân tích: ' + (apiResponseData.phan_tich_sau || 'N/A') + '</p>';
    if (apiResponseData.tong) {
        html += '<p>Xúc xắc: ' + apiResponseData.xuc_xac_1 + '-' + apiResponseData.xuc_xac_2 + '-' + apiResponseData.xuc_xac_3 + '</p>';
        html += '<p>Tổng: ' + apiResponseData.tong + ' (' + apiResponseData.ket_qua + ')</p>';
        html += '<p>' + apiResponseData.so_sanh + '</p>';
        html += '<p>Pattern: ' + apiResponseData.pattern + '</p>';
    }
    res.send(html);
});

var server = app.listen(PORT, function() {
    console.log('Server running on port ' + PORT);
    connectWebSocket();
});

server.on('error', function(err) {
    console.error('Server error:', err.message);
});

process.on('uncaughtException', function(err) {
    console.error('Uncaught:', err.message);
});

process.on('unhandledRejection', function(err) {
    console.error('Rejection:', err.message);
});
