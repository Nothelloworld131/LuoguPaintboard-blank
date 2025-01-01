// worker.js
let paintId = 0; // 定义并初始化 paintId
let currentTokenIndex = 0; // 定义并初始化 currentTokenIndex
let ws; // WebSocket 实例

self.onmessage = function(event) {
    const { type, data } = event.data;

    switch (type) {
        case 'handlePaintQueue':
            handlePaintQueue(data);
            break;
        case 'fetchBoard':
            fetchBoard(data);
            break;
        default:
            console.log(`Unknown message type: ${type}`);
    }
};

function handlePaintQueue(data) {
    const { paintQueue, queueStrategy, drawInterval, uidTokens, rectParams, imageData, isRunning, isPaused, retryArray } = data;

    //console.log(paintQueue);
    if (paintQueue.length > 0) {
        let pixelData;
        switch (queueStrategy) {
            case 'horizontalPush':
                pixelData = paintQueue.shift(); // 从第一个开始取
                break;
            case 'randomSpray':
                const randomIndex = Math.floor(Math.random() * paintQueue.length);
                pixelData = paintQueue.splice(randomIndex, 1)[0]; // 随机取
                break;
            case 'maintenancePriority':
                pixelData = paintQueue.pop(); // 从最后一个取
                break;
            default:
                postMessage({ type: 'log', data: `未知的队列策略: ${queueStrategy}` });
                return;
        }

        const { x, y, r, g, b } = pixelData;
        setTimeout(() => {
            sendPaint(r, g, b, x, y, uidTokens, rectParams, imageData, isRunning, isPaused, retryArray);
        }, drawInterval);
        postMessage({ type: 'updatepaintQueue', data: paintQueue });
    }
}

function sendPaint(r, g, b, x, y, uidTokens, rectParams, imageData, isRunning, isPaused, retryArray) {
    const tokenCount = uidTokens.length;
    if (tokenCount === 0) {
        postMessage({ type: 'log', data: "没有可用的 Token。" });
        return;
    }
    paintId = (paintId % tokenCount) + 1; // 更新 paintId
    const id = paintId;
    const tokenInfo = uidTokens[currentTokenIndex];
    if (tokenInfo) {
        const [uid, token] = tokenInfo.split(':');
        const tokenBytes = new Uint8Array(16);
        token.replace(/-/g, '').match(/.{2}/g).map((byte, i) =>
            tokenBytes[i] = parseInt(byte, 16));
        retryArray[id] = { x, y };
        const paintData = new Uint8Array([
            0xfe,
            ...uintToUint8Array(x, 2),
            ...uintToUint8Array(y, 2),
            r, g, b,
            ...uintToUint8Array(parseInt(uid), 3),
            ...tokenBytes,
            ...uintToUint8Array(id, 4)
        ]);

        // 将绘制指令发送回主线程处理
        postMessage({ type: 'sendPaintData', data: paintData });

        // 更新索引
        currentTokenIndex = (currentTokenIndex + 1) % uidTokens.length;

        postMessage({ type: 'log', data: `发送绘制指令，ID: ${id}, 坐标: (${x}, ${y})` });
        postMessage({ type: 'updateretryQueue', data: retryArray });
    }
}

function fetchBoard(data) {
    fetch('https://api.paintboard.ayakacraft.com:32767/api/paintboard/getboard')
        .then(response => response.arrayBuffer())
        .then(buffer => {
            const byteArray = new Uint8Array(buffer);
            const imageDataBuffer = new ImageData(new Uint8ClampedArray(data.imageData), 1000, 600);
            const dataBuffer = imageDataBuffer.data;
            data.paintQueue = [];

            // 解析多个矩形参数
            const rectParamsArray = data.rectParams;

            for (let y = 0; y < 600; y++) {
                for (let x = 0; x < 1000; x++) {
                    const index = (y * 1000 + x) * 4;
                    const colorIndex = (y * 1000 + x) * 3;

                    dataBuffer[index] = byteArray[colorIndex];       // Red
                    dataBuffer[index + 1] = byteArray[colorIndex + 1]; // Green
                    dataBuffer[index + 2] = byteArray[colorIndex + 2]; // Blue
                    dataBuffer[index + 3] = 255;                     // Alpha (fully opaque)

                    // 检查像素是否在任意一个矩形内
                    if (rectParamsArray.some(rect => isInRect(x, y, rect)) && !isPixelWhite(x, y, imageDataBuffer)) {
                        data.paintQueue.push({ x, y, r: 255, g: 255, b: 255 });
                    }
                }
            }

            postMessage({ type: 'updateImage', data: imageDataBuffer });
            postMessage({ type: 'updatepaintQueue', data: data.paintQueue });
        })
        .catch(error => postMessage({ type: 'log', data: `获取面板失败：${error}` }));
}

function isInRect(x, y, rect) {
    return rect[0] <= x && x <= rect[2] && rect[1] <= y && y <= rect[3];
}

function isPixelWhite(x, y, imageData) {
    const index = (y * 1000 + x) * 4;
    const r = imageData.data[index];
    const g = imageData.data[index + 1];
    const b = imageData.data[index + 2];
    // 判断 RGB 是否都为 255，即白色
    return r === 255 && g === 255 && b === 255;
}

function uintToUint8Array(uint, bytes) {
    const array = new Uint8Array(bytes);
    for (let i = 0; i < bytes; i++) {
        array[i] = uint & 0xff;
        uint = uint >> 8;
    }
    return array;
}