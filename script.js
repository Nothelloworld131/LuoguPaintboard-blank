// script.js
const WS_URL = "wss://api.paintboard.ayakacraft.com:32767/api/paintboard/ws";
let ws;
let uidTokens = [];
let rectParams = [0, 0, 1000, 600]; // 默认整个画板
let drawInterval = 100; // 默认每次绘图的时间间隔
let paintId = 0;
let paintQueue = [];
let reconnectionAttempts = 0;
let maxReconnectionAttempts = 5;
let canvas = document.getElementById('canvas');
let ctx = canvas.getContext('2d');
let imageData = ctx.createImageData(1000, 600); // 创建图像数据对象
let isRunning = false;
let intervalIds = {}; // 定义 intervalIds 对象
let isPaused = false;
let queueStrategy = 'horizontalPush'; // 默认策略
let retryArray = []; // 重试队列
// 在全局变量中添加一个 canvas 和 context 用于热力图
let heatmapCanvas = document.getElementById('heatmapCanvas');
let heatmapCtx = heatmapCanvas.getContext('2d');
let heatmapImageData = heatmapCtx.createImageData(1000, 600);
// 在全局变量中添加一个数组来记录每个像素被更新的次数
let pixelUpdateCount = new Uint32Array(1000 * 600);
let linpixelUpdateCount = new Uint32Array(1000 * 600);
let heatmapInterval = 60000;
let cellSize = 20; // 默认值
let currentColorScheme = 'default'; // 默认配色方案
let saturationMultiplier = 0.9;
let maxCount = 0;
let lintotalUpdates = 0;

let isDrawing = false;
let startX, startY, endX, endY;

const colorSchemeSelect = document.getElementById('colorScheme');
const audio = new Audio('empty_loop_for_js_performance.ogg');
const worker = new Worker('worker.js');

worker.onmessage = function(event) {
    const { type, data } = event.data;

    switch (type) {
        case 'log':
            log(data);
            break;
        case 'updateImage':
            imageData = data;
            ctx.putImageData(imageData, 0, 0);
            break;
        case 'sendPaintData': {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(data);
            } else {
                log("WebSocket 连接未打开，无法发送绘制指令。");
            }
            break;
        }
        case 'updatepaintQueue':{
            paintQueue = data;
            //console.log(paintQueue);
            break;
        }
        case 'updateretryQueue':{
            retryArray = data;
            break;
        }
        default:
            log(`Unknown message type: ${type}`);
    }
};

function toggleStartPause() {
    if (isRunning) {
        pause();
    } else {
        start();
    }
}

function start() {
    uidTokens = document.getElementById('uidTokenList').value.split('\n').map(line => line.trim()).filter(line => line);
    rectParams = document.getElementById('rectParams').value.trim().split('\n').map(line => line.split(',').map(Number));
    
    // 确保每个矩形的 x1 < x2 和 y1 < y2
    rectParams = rectParams.filter(rect => rect[0] < rect[2] && rect[1] < rect[3]);
    
    // 添加日志验证 rectParams
    // console.log('Filtered rectParams:', rectParams);
    
    drawInterval = parseInt(document.getElementById('drawInterval').value, 10);
    heatmapInterval = parseInt(document.getElementById('heatmapInterval').value, 10);
    intervalIds.heatmapUpdate = setInterval(drawHeatmap, heatmapInterval); // 使用新的时间间隔

    // 保存到 localStorage
    localStorage.setItem('rectParams', JSON.stringify(rectParams));
    localStorage.setItem('drawInterval', drawInterval);

    isPaused = false;
    connectWebSocket();
    
    intervalIds.fetchBoard = setInterval(() => {
        worker.postMessage({ type: 'fetchBoard', data: { imageData: imageData.data.buffer, rectParams, paintQueue } });
    }, 30 * 1000); // 每隔30秒获取面板
    
    intervalIds.drawInterval = setInterval(() => {
        worker.postMessage({ type: 'handlePaintQueue', data: { 
            paintQueue, 
            queueStrategy, 
            drawInterval, 
            uidTokens, 
            rectParams, 
            imageData: imageData.data.buffer, 
            isRunning, 
            isPaused, 
            retryArray 
        } });
    }, drawInterval); // 启动定时器
    
    worker.postMessage({ type: 'fetchBoard', data: { imageData: imageData.data.buffer, rectParams, paintQueue } });

    isRunning = true;
    document.querySelector('.btn.btn-primary').textContent = '暂停';

    // 计算并显示 Token 个数和结果
    const tokenCount = uidTokens.length;
    const result = 30000 / tokenCount;

    // 计算每个矩形的面积并求和
    const totalRectArea = calculateUnionArea(rectParams);
    const areaPerToken = totalRectArea / tokenCount;

    document.getElementById('tokenCountDisplay').textContent = `Token 个数: ${tokenCount}`;
    document.getElementById('resultDisplay').textContent = `30000 / Token 个数: ${result.toFixed(2)}`;
    document.getElementById('centerDisplay').textContent = `总矩形面积 / Token 个数: ${areaPerToken.toFixed(2)}`;
    document.getElementById('unionAreaDisplay').textContent = `矩形面积并: ${totalRectArea}`;

    log("程序已启动。");
}

function pause() {
    clearInterval(intervalIds.fetchBoard);
    clearInterval(intervalIds.drawInterval);
    ws.close();
    clearInterval(intervalIds.heatmapUpdate);

    paintQueue = [];
    retryArray = [];

    isPaused = true;
    isRunning = false;
    document.querySelector('.btn.btn-primary').textContent = '开始';
    log("程序已暂停。");
}

function connectWebSocket() {
    ws = new WebSocket(WS_URL);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
        log("WebSocket 连接已打开。");
        reconnectionAttempts = 0;
    };

    ws.onmessage = (event) => {
        const buffer = event.data;
        const dataView = new DataView(buffer);
        let offset = 0;
        while (offset < buffer.byteLength) {
            const type = dataView.getUint8(offset);
            offset += 1;
            switch (type) {
                case 0xfa: {
                    const x = dataView.getUint16(offset, true);
                    const y = dataView.getUint16(offset + 2, true);
                    const colorR = dataView.getUint8(offset + 4);
                    const colorG = dataView.getUint8(offset + 5);
                    const colorB = dataView.getUint8(offset + 6);
                    offset += 7;
                    setPixel(x, y, colorR, colorG, colorB);
                    if (isInRect(x, y) && !isPixelWhite(x, y)) {
                        paintQueue.push({ x, y, r: 255, g: 255, b: 255 });
                    }
                    break;
                }
                case 0xff: {
                    const id = dataView.getUint32(offset, true);
                    const code = dataView.getUint8(offset + 4);
                    offset += 5;
                    handlePaintResult(id, code);
                    break;
                }
                case 0xfc: {
                    sendHeartbeat();
                    break;
                }
                default:
                    log(`未知的消息类型：${type}`);
            }
        }
        ctx.putImageData(imageData, 0, 0);
    };

    ws.onerror = (err) => {
        log(`WebSocket 出错：${err.message}。`);
    };

    ws.onclose = (err) => {
        const reason = err.reason ? err.reason : "Unknown";
        log(`WebSocket 已经关闭 (${err.code}: ${reason})。`);
        if (!isPaused && reconnectionAttempts < maxReconnectionAttempts) {
            setTimeout(connectWebSocket, 60000); // 1分钟后重连
            reconnectionAttempts++;
        } else {
            log("重连次数达到上限，结束程序。");
            pause();
        }
    };
}

function sendHeartbeat() {
    ws.send(new Uint8Array([0xfb]));
}

function isInRect(x, y) {
    return rectParams.some(rect => rect[0] <= x && x <= rect[2] && rect[1] <= y && y <= rect[3]);
}
function handlePaintResult(id, code) {
    switch (code) {
        case 0xef:
            break;
        case 0xee:
            log(`正在冷却，ID: ${id}`);
            paintQueue.push({ x: retryArray[id].x, y: retryArray[id].y, r: 255, g: 255, b: 255 });
            break;
        case 0xed:
            log(`Token 无效，ID: ${id}`);
            const uidTokenListElement = document.getElementById('uidTokenList');
            const uidPasteListElement = document.getElementById('uidPasteList');
            const uidTokenList = uidTokenListElement.value.split('\n').map(line => line.trim()).filter(line => line);
            const uidPasteList = uidPasteListElement.value.split('\n').map(line => line.trim()).filter(line => line);

            const uidTokenMap = {};
            uidTokenList.forEach(entry => {
                const [entryUid, entryToken] = entry.split(':');
                uidTokenMap[entryUid] = entryToken;
            });

            const uidPasteMap = {};
            uidPasteList.forEach(entry => {
                const [entryUid, entryPaste] = entry.split(':');
                uidPasteMap[entryUid] = entryPaste;
            });

            const uid = parseInt(getUidTokenAtIndex(id).uid);
            if (uid && uidPasteMap[uid]) {
                const paste = uidPasteMap[uid];
                log(`尝试重新获取 Token，UID: ${uid}, Paste: ${paste}`);
                fetch('https://api.paintboard.ayakacraft.com:32767/api/auth/gettoken', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ uid: parseInt(uid), paste: paste })
                })
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP error! Status: ${response.status}`);
                    }
                    return response.json();
                })
                .then(data => {
                    if (data.errorType) {
                        log(`重新获取 Token 失败：${data.errorType}`);
                    } else if (data.data.token) {
                        updateUidTokenList(uid, data.data.token);
                        log(`成功重新获取 Token: ${data.data.token}`);
                    } else {
                        log("重新获取 Token 失败：未找到 Token");
                    }
                })
                .catch(error => {
                    log(`重新获取 Token 请求失败: ${error}`);
                });
            } else {
                log("Token无效且无paste");
            }
            break;
        default:
            log(`状态码：${code}`);
    }
}
let currentTokenIndex = 0; // 初始化索引

function logAttack(message) {
    const attackLogDiv = document.getElementById('attackLog');
    attackLogDiv.innerHTML += `<p>${new Date().toLocaleTimeString()}: ${message}</p>`;
    attackLogDiv.scrollTop = attackLogDiv.scrollHeight; // 自动滚动到底部
}

function setPixel(x, y, r, g, b) {
    const index = (y * 1000 + x);
    pixelUpdateCount[index]++;
    const dataIndex = index * 4;
    imageData.data[dataIndex] = r;
    imageData.data[dataIndex + 1] = g;
    imageData.data[dataIndex + 2] = b;
    imageData.data[dataIndex + 3] = 255; // Alpha (fully opaque)
    if (isInRect(x, y) && !isPixelWhite(x, y)) {
        logAttack(`被攻击: (${x}, ${y}) -> (${r}, ${g}, ${b})`);
    }
}
function isPixelWhite(x, y) {
    const index = (y * 1000 + x) * 4;
    const r = imageData.data[index];
    const g = imageData.data[index + 1];
    const b = imageData.data[index + 2];
    return r === 255 && g === 255 && b === 255;
}

function addToPaintQueue(x1, y1, x2, y2, r, g, b) {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);

    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            if (!isPixelWhite(x, y)) {
                paintQueue.push({ x, y, r, g, b });
            }
        }
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function drawWhiteRectangle(x1, y1, x2, y2) {
    addToPaintQueue(x1, y1, x2, y2, 255, 255, 255);
}

function log(message) {
    const logDiv = document.getElementById('log');
    logDiv.innerHTML += `<p>${new Date().toLocaleTimeString()}: ${message}</p>`;
    logDiv.scrollTop = logDiv.scrollHeight; // 自动滚动到底部
}

function updateUidTokenList(uid, token) {
    const uidTokenListElement = document.getElementById('uidTokenList');
    const currentTokens = uidTokenListElement.value.split('\n').map(line => line.trim()).filter(line => line);

    // 创建一个对象来存储 uid 和 token 的映射关系
    const uidTokenMap = {};
    currentTokens.forEach(entry => {
        const [entryUid, entryToken] = entry.split(':');
        uidTokenMap[entryUid] = entryToken;
    });

    // 更新或添加新的 uid 和 token
    uidTokenMap[uid] = token;

    // 将对象转换回数组，并按 uid 排序
    const sortedTokens = Object.entries(uidTokenMap)
        .map(([entryUid, entryToken]) => `${entryUid}:${entryToken}`)
        .sort((a, b) => {
            const uidA = parseInt(a.split(':')[0], 10);
            const uidB = parseInt(b.split(':')[0], 10);
            return uidA - uidB;
        });

    // 更新文本区域的内容
    uidTokenListElement.value = sortedTokens.join('\n');

    // 更新 uidTokens 列表
    uidTokens = sortedTokens;
}

document.addEventListener('DOMContentLoaded', () => {
    const savedUidTokenList = localStorage.getItem('uidTokenList');
    if (savedUidTokenList) {
        document.getElementById('uidTokenList').value = savedUidTokenList;
    }

    const savedRectParams = localStorage.getItem('rectParams');
    if (savedRectParams) {
        try {
            const rectParamsArray = JSON.parse(savedRectParams);
            if (Array.isArray(rectParamsArray) && rectParamsArray.every(rect => Array.isArray(rect) && rect.length === 4 && rect.every(Number.isInteger))) {
                rectParams = rectParamsArray;
                document.getElementById('rectParams').value = rectParamsArray.map(rect => rect.join(',')).join('\n');
            } else {
                log("无效的矩形参数格式，使用默认值。");
                rectParams = [[0, 0, 1000, 600]];
                document.getElementById('rectParams').value = rectParams.map(rect => rect.join(',')).join('\n');
            }
        } catch (error) {
            log(`解析矩形参数失败: ${error.message}，使用默认值。`);
            rectParams = [[0, 0, 1000, 600]];
            document.getElementById('rectParams').value = rectParams.map(rect => rect.join(',')).join('\n');
        }
    }

    const savedDrawInterval = localStorage.getItem('drawInterval');
    if (savedDrawInterval) {
        drawInterval = parseInt(savedDrawInterval, 10);
        document.getElementById('drawInterval').value = drawInterval;
    }

    const savedQueueStrategy = localStorage.getItem('queueStrategy');
    if (savedQueueStrategy) {
        queueStrategy = savedQueueStrategy;
        document.getElementById('queueStrategy').value = queueStrategy;
    }

    const savedUidPasteList = localStorage.getItem('uidPasteList');
    if (savedUidPasteList) {
        document.getElementById('uidPasteList').value = savedUidPasteList;
    }

    const savedHeatmapInterval = localStorage.getItem('heatmapInterval');
    if (savedHeatmapInterval) {
        heatmapInterval = parseInt(savedHeatmapInterval, 10);
        document.getElementById('heatmapInterval').value = heatmapInterval;
    }

    const savedCellSize = localStorage.getItem('cellSize');
    if (savedCellSize) {
        cellSize = parseInt(savedCellSize, 10);
        document.getElementById('cellSize').value = cellSize;
    }

    const savedColorScheme = localStorage.getItem('colorScheme');
    if (savedColorScheme) {
        currentColorScheme = savedColorScheme;
        document.getElementById('colorScheme').value = currentColorScheme;
    }

    const savedSaturationMultiplier = localStorage.getItem('saturationMultiplier');
    if (savedSaturationMultiplier) {
        saturationMultiplier = parseFloat(savedSaturationMultiplier);
        document.getElementById('saturationMultiplier').value = saturationMultiplier;
    }
});

window.addEventListener('beforeunload', () => {
    const uidTokenListElement = document.getElementById('uidTokenList');
    const uidTokenList = uidTokenListElement.value;
    localStorage.setItem('uidTokenList', uidTokenList);

    const rectParamsString = JSON.stringify(rectParams);
    localStorage.setItem('rectParams', rectParamsString);

    const drawIntervalString = document.getElementById('drawInterval').value;
    localStorage.setItem('drawInterval', drawIntervalString);

    const uidPasteListElement = document.getElementById('uidPasteList');
    const uidPasteList = uidPasteListElement.value;
    localStorage.setItem('uidPasteList', uidPasteList);

    const heatmapIntervalString = document.getElementById('heatmapInterval').value;
    localStorage.setItem('heatmapInterval', heatmapIntervalString);

    const cellSizeString = document.getElementById('cellSize').value;
    localStorage.setItem('cellSize', cellSizeString);

    const colorSchemeString = document.getElementById('colorScheme').value;
    localStorage.setItem('colorScheme', colorSchemeString);

    const saturationMultiplierString = document.getElementById('saturationMultiplier').value;
    localStorage.setItem('saturationMultiplier', saturationMultiplierString);
});

const strategySelect = document.getElementById('queueStrategy');
strategySelect.addEventListener('change', (event) => {
    queueStrategy = event.target.value;
    log(`队列策略已更改为: ${queueStrategy}`);
    localStorage.setItem('queueStrategy', queueStrategy);
});

// 添加 getToken 函数
function getToken() {
    const uid = document.getElementById('uid').value;
    const paste = document.getElementById('paste').value;

    log(`尝试获取 Token，UID: ${uid}, Paste: ${paste}`);

    if (!uid || !paste) {
        alert('请输入 UID 和 Paste 地址');
        log("获取 Token 失败：缺少必要字段。");
        return;
    }
    // console.log(JSON.stringify({ uid: parseInt(uid), paste: paste }));
    fetch('https://api.paintboard.ayakacraft.com:32767/api/auth/gettoken', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ uid: parseInt(uid), paste: paste })
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        log('API Response:', data); // 打印 API 响应数据
        if (data.errorType) {
            document.getElementById('tokenResult').innerHTML = `<p class="text-danger">错误: ${data.errorType}</p>`;
            log(`获取 Token 失败：${data.errorType}`);
        } else if (data.data.token) {
            document.getElementById('tokenResult').innerHTML = `<p class="text-success">Token: ${data.data.token}</p>`;
            updateUidTokenList(uid, data.data.token);
            log(`成功获取 Token: ${data.data.token}`);
        } else {
            document.getElementById('tokenResult').innerHTML = `<p class="text-danger">错误: 未找到 Token</p>`;
            log("获取 Token 失败：未找到 Token");
        }
    })
    .catch(error => {
        document.getElementById('tokenResult').innerHTML = `<p class="text-danger">请求失败: ${error}</p>`;
        console.error('Fetch Error:', error); // 打印错误信息
        log(`获取 Token 请求失败: ${error}`);
    });
}

function getUidTokenAtIndex(i) {
    // 将索引从 1 基调整为 0 基
    const adjustedIndex = i - 1;

    // 确保调整后的索引在有效范围内
    if (adjustedIndex < 0 || adjustedIndex >= uidTokens.length) {
        log(`索引超出范围: ${i}`);
        return null;
    }

    // 获取第 adjustedIndex 个元素
    const tokenInfo = uidTokens[adjustedIndex];

    // 检查 tokenInfo 是否为有效的 uid:token 格式
    if (!tokenInfo || !tokenInfo.includes(':')) {
        log(`无效的 uid:token 格式: ${tokenInfo}`);
        return null;
    }

    // 解析 uid 和 token
    const [uid, token] = tokenInfo.split(':').map(part => part.trim());

    // 返回解析后的结果
    return { uid, token };
}

function drawHeatmap() {
    maxCount = 0;
    maxCount = getMaxCount(pixelUpdateCount);
    if (maxCount === 0) {
        log("所有像素更新次数为 0，跳过热力图绘制。");
        return;
    }
    lintotalUpdates = 0;
    for (let y = 0; y < 600; y += cellSize) {
        for (let x = 0; x < 1000; x += cellSize) {
            let totalUpdates = 0;
            
            for (let cy = 0; cy < cellSize && y + cy < 600; cy++) {
                for (let cx = 0; cx < cellSize && x + cx < 1000; cx++) {
                    const index = ((y + cy) * 1000 + (x + cx));
                    totalUpdates += pixelUpdateCount[index];
                    lintotalUpdates += pixelUpdateCount[index];
                }
            }
            const averageIntensity = totalUpdates / maxCount;
            const color = interpolateColor(averageIntensity);

            for (let cy = 0; cy < cellSize && y + cy < 600; cy++) {
                for (let cx = 0; cx < cellSize && x + cx < 1000; cx++) {
                    const index = ((y + cy) * 1000 + (x + cx));
                    const dataIndex = index * 4;
                    heatmapImageData.data[dataIndex] = color.r;
                    heatmapImageData.data[dataIndex + 1] = color.g;
                    heatmapImageData.data[dataIndex + 2] = color.b;
                    heatmapImageData.data[dataIndex + 3] = 255; // Alpha (fully opaque)
                }
            }
        }
    }
    heatmapCtx.putImageData(heatmapImageData, 0, 0);
    linpixelUpdateCount = pixelUpdateCount;
    pixelUpdateCount = new Uint32Array(1000 * 600);

    // 调用绘制选框函数
    drawSelectionBox();
}
function getMaxCount(pixelUpdateCount) {
    for (let y = 0; y < 600; y += cellSize) {
        for (let x = 0; x < 1000; x += cellSize) {
            let totalUpdates = 0;

            // 计算20x20像素单元格内的总更新次数
            for (let cy = 0; cy < cellSize && y + cy < 600; cy++) {
                for (let cx = 0; cx < cellSize && x + cx < 1000; cx++) {
                    const index = ((y + cy) * 1000 + (x + cx));
                    totalUpdates += pixelUpdateCount[index];
                }
            }

            if (totalUpdates > maxCount) {
                maxCount = totalUpdates;
            }
        }
    }

    return maxCount;
}

function interpolateColor(intensity) {
    let r, g, b;

    switch (currentColorScheme) {
        case 'cool':
            if (intensity <= 0.2) {
                r = 0;
                g = 0;
                b = Math.floor(255 * (intensity / 0.2)); // 深蓝到浅蓝
            } else if (intensity <= 0.4) {
                r = 0;
                g = Math.floor(255 * ((intensity - 0.2) / 0.2)); // 蓝到青
                b = 255;
            } else if (intensity <= 0.6) {
                r = Math.floor(255 * ((intensity - 0.4) / 0.2)); // 青到紫
                g = 255;
                b = 255 - Math.floor(255 * ((intensity - 0.4) / 0.2));
            } else if (intensity <= 0.8) {
                r = 128 + Math.floor(127 * ((intensity - 0.6) / 0.2)); // 紫到深紫
                g = 128 - Math.floor(128 * ((intensity - 0.6) / 0.2));
                b = 128;
            } else {
                r = Math.floor(128 * (1 - (intensity - 0.8) / 0.2)); // 深紫到黑
                g = 0;
                b = 128;
            }
            break;
        case 'warm':
            if (intensity <= 0.2) {
                r = Math.floor(128 * (intensity / 0.2));
                g = 0;
                b = 0;
            } else if (intensity <= 0.4) {
                r = 128;
                g = Math.floor(128 * ((intensity - 0.2) / 0.2));
                b = 0;
            } else if (intensity <= 0.6) {
                r = 128 - Math.floor(128 * ((intensity - 0.4) / 0.2));
                g = 128;
                b = 0;
            } else if (intensity <= 0.8) {
                r = 0;
                g = 128 - Math.floor(128 * ((intensity - 0.6) / 0.2));
                b = Math.floor(128 * ((intensity - 0.6) / 0.2));
            } else {
                r = 0;
                g = 0;
                b = 128 + Math.floor(127 * ((intensity - 0.8) / 0.2));
            }
            break;
        default:
            if (intensity <= 0.2) {
                r = 0;
                g = 0;
                b = Math.floor(128 * (intensity / 0.2));
            } else if (intensity <= 0.4) {
                r = 0;
                g = Math.floor(128 * ((intensity - 0.2) / 0.2));
                b = 128;
            } else if (intensity <= 0.6) {
                r = Math.floor(128 * ((intensity - 0.4) / 0.2));
                g = 128;
                b = 128 - Math.floor(128 * ((intensity - 0.4) / 0.2));
            } else if (intensity <= 0.8) {
                r = 128 + Math.floor(127 * ((intensity - 0.6) / 0.2));
                g = 128 - Math.floor(128 * ((intensity - 0.6) / 0.2));
                b = 0;
            } else {
                r = 255;
                g = Math.floor(128 * (1 - (intensity - 0.8) / 0.2));
                b = 0;
            }
            break;
    }

    // Convert RGB to HSL
    let [h, s, l] = rgbToHsl(r, g, b);

    // Reduce saturation
    s *= saturationMultiplier; // 使用饱和度乘数

    // Convert HSL back to RGB
    [r, g, b] = hslToRgb(h, s, l);

    return { r, g, b };
}

function rgbToHsl(r, g, b) {
    r /= 255, g /= 255, b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max == min) {
        h = s = 0; // achromatic
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }

    return [h, s, l];
}

function hslToRgb(h, s, l) {
    let r, g, b;

    if (s == 0) {
        r = g = b = l; // achromatic
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };

        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }

    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        // 页面可见时暂停音频
        audio.pause();
    } else {
        // 页面不可见时播放音频
        audio.loop = true;
        audio.play().catch(error => {
            console.error('音频播放失败:', error);
        });
    }
});

colorSchemeSelect.addEventListener('change', (event) => {
    currentColorScheme = event.target.value;
    log(`热力图配色方案已更改为: ${currentColorScheme}`);
    localStorage.setItem('colorScheme', currentColorScheme);
    drawHeatmap(); // 重新绘制热力图以应用新的配色方案
});

const saturationMultiplierInput = document.getElementById('saturationMultiplier');
saturationMultiplierInput.addEventListener('change', (event) => {
    saturationMultiplier = parseFloat(event.target.value);
    localStorage.setItem('saturationMultiplier', saturationMultiplier);
    log(`饱和度乘数已更改为: ${saturationMultiplier}`);
});

async function copyHeatmapToClipboard() {
    const heatmapCanvas = document.getElementById('heatmapCanvas');
    
    // 使用 html2canvas 截取 heatmapCanvas 的内容
    const canvas = await html2canvas(heatmapCanvas, {
        scale: 1, // 设置缩放比例，1 表示不缩放
        allowTaint: true, // 允许跨域内容
        useCORS: true // 使用 CORS
    });

    // 将 canvas 内容转换为 Blob 对象
    canvas.toBlob(async (blob) => {
        try {
            // 创建 ClipboardItem 对象
            const clipboardItem = new ClipboardItem({
                'image/png': blob
            });

            // 将 ClipboardItem 写入剪贴板
            await navigator.clipboard.write([clipboardItem]);
            log("热力图已成功复制到剪贴板。");
        } catch (error) {
            log(`复制热力图到剪贴板时出错：${error.message}`);
        }
    }, 'image/png');
}

function calculateUnionArea(rectangles) {
    if (rectangles.length === 0) return 0;

    let totalArea = 0;

    rectangles.forEach(rect => {
        // 确保 x1 < x2 和 y1 < y2
        if (rect[0] <= rect[2] && rect[1] <= rect[3]) {
            const width = rect[2] - rect[0] + 1;
            const height = rect[3] - rect[1] + 1;
            totalArea += width * height;
        } else {
            console.warn(`Invalid rectangle: ${rect}`);
        }
    });

    return totalArea;
}

heatmapCanvas.addEventListener('mousemove', (event) => {
    const rect = heatmapCanvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // 计算比例坐标
    const ratioX = mouseX / rect.width;
    const ratioY = mouseY / rect.height;

    // 转换为实际像素坐标
    const x = Math.floor(ratioX * heatmapCanvas.width);
    const y = Math.floor(ratioY * heatmapCanvas.height);

    // 确保坐标在画布范围内
    const maxX = heatmapCanvas.width - 1;
    const maxY = heatmapCanvas.height - 1;
    let clampedX = Math.min(Math.max(x, 0), maxX);
    let clampedY = Math.min(Math.max(y, 0), maxY);
    clampedX = Math.floor(clampedX / cellSize) * cellSize;
    clampedY = Math.floor(clampedY / cellSize) * cellSize;
    let totalUpdates = 0;
    for (let cy = 0; cy < cellSize && clampedY + cy < 600; cy++) {
        for (let cx = 0; cx < cellSize && clampedX + cx < 1000; cx++) {
            const index = (clampedY + cy) * 1000 + (clampedX + cx);
            totalUpdates += linpixelUpdateCount[index];
        }
    }
    const averageIntensity = totalUpdates;
    const percentage = lintotalUpdates === 0 ? 0 : (averageIntensity / lintotalUpdates * 100).toFixed(2);

    // 更新固定位置的文本元素
    const coordinatesDiv = document.getElementById('heatmapCoordinatesDisplay');
    if (!isDrawing) {
        coordinatesDiv.textContent = `X: ${clampedX}, Y: ${clampedY}, 更改次数: ${totalUpdates}, 占比: ${percentage}%`;
    }
});
function drawCoordinates(event) {
    const canvas = document.getElementById('canvas');
    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // 计算比例坐标
    const ratioX = mouseX / rect.width;
    const ratioY = mouseY / rect.height;

    // 转换为实际像素坐标
    const x = Math.floor(ratioX * canvas.width);
    const y = Math.floor(ratioY * canvas.height);

    // 确保坐标在画布范围内
    const maxX = canvas.width - 1;
    const maxY = canvas.height - 1;
    const clampedX = Math.min(Math.max(x, 0), maxX);
    const clampedY = Math.min(Math.max(y, 0), maxY);

    // 更新固定位置的文本元素
    const coordinatesDiv = document.getElementById('canvasCoordinatesDisplay');
    coordinatesDiv.textContent = `X: ${clampedX}, Y: ${clampedY}`;
}

// 添加鼠标移动事件监听器
document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('canvas');
    canvas.addEventListener('mousemove', drawCoordinates);
});

function drawSelectionBox() {
    if (!isDrawing) return;

    heatmapCtx.clearRect(0, 0, heatmapCanvas.width, heatmapCanvas.height);
    heatmapCtx.putImageData(heatmapImageData, 0, 0);

    heatmapCtx.strokeStyle = '#ff0000';
    heatmapCtx.lineWidth = 2;
    heatmapCtx.strokeRect(startX, startY, endX - startX, endY - startY);
}

heatmapCanvas.addEventListener('mousedown', (event) => {
    isDrawing = true;
    const rect = heatmapCanvas.getBoundingClientRect();
    startX = Math.floor((event.clientX - rect.left) / cellSize) * cellSize;
    startY = Math.floor((event.clientY - rect.top) / cellSize) * cellSize;
});

heatmapCanvas.addEventListener('mousemove', (event) => {
    if (!isDrawing) return;

    const rect = heatmapCanvas.getBoundingClientRect();
    endX = Math.floor((event.clientX - rect.left) / cellSize) * cellSize;
    endY = Math.floor((event.clientY - rect.top) / cellSize) * cellSize;
    drawSelectionBox();
});

heatmapCanvas.addEventListener('mouseup', (event) => {
    if (!isDrawing) return;
    isDrawing = false;

    const rect = heatmapCanvas.getBoundingClientRect();
    endX = Math.floor((event.clientX - rect.left) / cellSize) * cellSize;
    endY = Math.floor((event.clientY - rect.top) / cellSize) * cellSize;

    const minX = Math.min(startX, endX);
    const minY = Math.min(startY, endY);
    const maxX = Math.max(startX, endX);
    const maxY = Math.max(startY, endY);

    let totalUpdates = 0;
    for (let y = Math.floor(minY); y <= Math.floor(maxY); y += cellSize) {
        for (let x = Math.floor(minX); x <= Math.floor(maxX); x += cellSize) {
            for (let cy = 0; cy < cellSize && y + cy < 600; cy++) {
                for (let cx = 0; cx < cellSize && x + cx < 1000; cx++) {
                    const index = ((y + cy) * 1000 + (x + cx));
                    totalUpdates += linpixelUpdateCount[index];
                }
            }
        }
    }

    const percentage = lintotalUpdates === 0 ? 0 : (totalUpdates / lintotalUpdates * 100).toFixed(2);

    // 更新固定位置的文本元素
    const selectionBoxInfoDiv = document.getElementById('selectionBoxInfo');
    selectionBoxInfoDiv.textContent = `左上角: (${Math.floor(minX)}, ${Math.floor(minY)}), 右下角: (${Math.floor(maxX)}, ${Math.floor(maxY)}), 更改次数: ${totalUpdates}, 占比: ${percentage}%`;

    // 确保鼠标移动时的坐标信息不被覆盖
    const coordinatesDiv = document.getElementById('heatmapCoordinatesDisplay');
    coordinatesDiv.textContent = '';
});