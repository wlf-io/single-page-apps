const COLS = 8;
const LIVES = 3;
const BRICK = Object.freeze({
    DEAD: 0,
    HIT_1: 1,
    HIT_2: 2,
    HIT_3: 3,
    HIT_4: 4,
    HIT_5: 5,
    HIT_6: 6,
});

const BRICK_NEXT = Object.freeze({
    [BRICK.DEAD]: BRICK.DEAD,
    [BRICK.HIT_1]: BRICK.DEAD,
    [BRICK.HIT_2]: BRICK.HIT_1,
    [BRICK.HIT_3]: BRICK.HIT_2,
    [BRICK.HIT_4]: BRICK.HIT_3,
    [BRICK.HIT_5]: BRICK.HIT_4,
    [BRICK.HIT_6]: BRICK.HIT_5,
});
const ROW_COLORS = [
    "#e26d5a",
    "#e2a15a",
    "#d6c45a",
    "#b6d45a",
    "#6dca6a",
    "#5ac8a8",
    "#5ac8e2",
    "#3d9cf0",
    "#6a78e2",
    "#a85ae2"
];
const ROWS = 5;
const ROW_POINTS = Array.from({ length: ROWS }, (_, row) => 50 - row * 5);

let userLevels = false;

const LEVELS = [
    [
        [BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1],
        [BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1],
        [BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1],
        [BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1],
        [BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1],
    ],
    [
        [BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1],
        [BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1],
        [BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1],
        [BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1],
        [BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1, BRICK.HIT_1],
        [BRICK.HIT_2, BRICK.HIT_2, BRICK.HIT_2, BRICK.HIT_2, BRICK.HIT_2, BRICK.HIT_2, BRICK.HIT_2, BRICK.HIT_2],
    ]
];

const canvas = document.getElementById("board");
const stage = canvas.parentElement;
const scoreEl = document.getElementById("score");
const levelEl = document.getElementById("level");
const livesEl = document.getElementById("lives");
const messageEl = document.getElementById("message");
const restartBtn = document.getElementById("restart");
const ctx = canvas.getContext("2d");

function levelLayout(levelNumber) {
    const source = LEVELS[levelNumber - 1];
    if (!source) {
        return Array.from({ length: ROWS }, () => Array(COLS).fill(BRICK.HIT_1));
    }
    return source.map((row) => row.slice());
}

let bricks = levelLayout(1);
const ball = { x: 0, y: 0, vx: 0, vy: 0, stuck: true };

let width = 0;
let height = 0;
let paddleCenter = 0;
const LEVEL_PAUSE = 800;
const LEVEL_SPEED = 0.1;

let score = 0;
let lives = LIVES;
let level = 1;
let phase = "ready";
let levelTimer = 0;
let activePointer = null;
let launchOnUp = false;
let restartOnUp = false;

function ballR() {
    return Math.max(5, Math.min(9, width * 0.015));
}

function ballSpeed() {
    return height * 0.5 * (1 + (level - 1) * LEVEL_SPEED);
}

function paddleW() {
    const ratio = width < 520 ? 0.28 : 0.18;
    return Math.max(68, Math.min(width * 0.46, width * ratio));
}

function paddleH() {
    return Math.max(11, Math.min(16, height * 0.02));
}

function paddleTop() {
    return height - paddleH() - Math.max(14, height * 0.035);
}

function paddleLeft() {
    return paddleCenter - paddleW() / 2;
}

function brickRect(col, row) {
    const marginX = Math.max(10, width * 0.04);
    const marginY = Math.max(10, height * 0.05);
    const gapWant = Math.max(3, Math.min(8, width * 0.012));
    const bhWant = Math.max(8, Math.min(22, height * 0.032));
    const limit = paddleTop() - Math.max(16, height * 0.05);
    const rows = Math.max(1, bricks.length);
    const spanWant = rows * bhWant + (rows - 1) * gapWant;
    const room = Math.max(rows * 6, limit - marginY);
    const scale = Math.min(1, room / spanWant);
    const gap = gapWant * scale;
    const bh = bhWant * scale;
    const bw = (width - marginX * 2 - gap * (COLS - 1)) / COLS;
    return {
        x: marginX + col * (bw + gap),
        y: marginY + row * (bh + gap),
        w: bw,
        h: bh
    };
}

function clampPaddle(center) {
    const half = paddleW() / 2;
    paddleCenter = Math.max(half, Math.min(width - half, center));
}

function stickBall() {
    ball.x = paddleCenter;
    ball.y = paddleTop() - ballR() - 2;
}

function setMessage(text) {
    if (messageEl) messageEl.textContent = text;
}

function updateHud() {
    scoreEl.textContent = String(score);
    const count = Math.max(0, lives);
    const balls = Array.from({ length: count }, () => {
        const dot = document.createElement("span");
        dot.className = "life";
        return dot;
    });
    livesEl.replaceChildren(...balls);
    livesEl.setAttribute("aria-label", count === 1 ? "1 life" : `${count} lives`);
    levelEl.textContent = String(level);
}

function setVelocity(angle) {
    const minSin = Math.sin(0.3);
    if (Math.abs(Math.sin(angle)) < minSin) {
        const ySign = Math.sin(angle) < 0 ? -1 : 1;
        const xSign = Math.cos(angle) < 0 ? -1 : 1;
        angle = Math.atan2(ySign * minSin, xSign * Math.cos(0.3));
    }
    const speed = ballSpeed();
    ball.vx = Math.cos(angle) * speed;
    ball.vy = Math.sin(angle) * speed;
}

function circleHitsRect(x, y, r, rect) {
    const cx = Math.max(rect.x, Math.min(x, rect.x + rect.w));
    const cy = Math.max(rect.y, Math.min(y, rect.y + rect.h));
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r;
}

function launch() {
    const spread = (Math.random() * 2 - 1) * (Math.PI / 5);
    ball.stuck = false;
    phase = "play";
    setVelocity(-Math.PI / 2 + spread);
    setMessage("");
}

function loseLife() {
    lives -= 1;
    updateHud();
    if (lives <= 0) {
        phase = "lost";
        ball.vx = 0;
        ball.vy = 0;
        setMessage("Game over. Click or tap to play again");
        return;
    }
    phase = "ready";
    ball.stuck = true;
    stickBall();
    setMessage("Click or tap to launch");
}

function win() {
    phase = "cleared";
    launchOnUp = false;
    restartOnUp = false;
    ball.vx = 0;
    ball.vy = 0;
    clearTimeout(levelTimer);
    levelTimer = setTimeout(nextLevel, LEVEL_PAUSE);
}

function nextLevel() {
    levelTimer = 0;
    if (phase !== "cleared") return;
    level += 1;
    bricks = levelLayout(level);
    phase = "ready";
    ball.stuck = true;
    ball.vx = 0;
    ball.vy = 0;
    stickBall();
    updateHud();
    draw();
}

function cleared() {
    return bricks.every((row) => row.every((cell) => cell === BRICK.DEAD));
}

function resolveBrick(rect) {
    const nearestX = Math.max(rect.x, Math.min(ball.x, rect.x + rect.w));
    const nearestY = Math.max(rect.y, Math.min(ball.y, rect.y + rect.h));
    let dx = ball.x - nearestX;
    let dy = ball.y - nearestY;
    if (dx === 0 && dy === 0) dy = ball.vy >= 0 ? 1 : -1;
    const r = ballR();
    if (Math.abs(dx) > Math.abs(dy)) {
        const sign = dx < 0 ? -1 : 1;
        ball.vx = Math.abs(ball.vx) * sign;
        ball.x = nearestX + sign * (r + 0.6);
    } else {
        const sign = dy < 0 ? -1 : 1;
        ball.vy = Math.abs(ball.vy) * sign;
        ball.y = nearestY + sign * (r + 0.6);
    }
    setVelocity(Math.atan2(ball.vy, ball.vx));
}

function collideBricks() {
    const r = ballR();
    for (let row = 0; row < bricks.length; row++) {
        for (let col = 0; col < bricks[row].length; col++) {
            const type = bricks[row][col];
            if (type === BRICK.DEAD) continue;
            const rect = brickRect(col, row);
            if (!circleHitsRect(ball.x, ball.y, r, rect)) continue;
            bricks[row][col] = BRICK_NEXT[type] ?? BRICK.DEAD;
            score += ROW_POINTS[row] ?? Math.max(5, 50 - row * 5);
            updateHud();
            resolveBrick(rect);
            if (cleared()) win();
            return;
        }
    }
}

function collidePaddle(dt) {
    if (ball.vy <= 0) return;
    const top = paddleTop();
    const r = ballR();
    const prevY = ball.y - ball.vy * dt;
    if (prevY + r > top || ball.y + r < top) return;
    const left = paddleLeft();
    const right = left + paddleW();
    if (ball.x < left - r * 0.25 || ball.x > right + r * 0.25) return;
    const offset = (ball.x - paddleCenter) / (paddleW() / 2);
    const angle = Math.max(-1, Math.min(1, offset)) * (Math.PI / 3);
    setVelocity(-Math.PI / 2 + angle);
    ball.y = top - r - 0.5;
}

function integrate(dt) {
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    const r = ballR();
    if (ball.x < r) {
        ball.x = r;
        ball.vx = Math.abs(ball.vx);
    } else if (ball.x > width - r) {
        ball.x = width - r;
        ball.vx = -Math.abs(ball.vx);
    }
    if (ball.y < r) {
        ball.y = r;
        ball.vy = Math.abs(ball.vy);
    }

    collidePaddle(dt);
    if (phase !== "play") return;
    collideBricks();
    if (phase === "play" && ball.y - r > height) loseLife();
}

function step(dt) {
    if (!width || phase === "cleared" || phase === "lost") return;
    if (ball.stuck) {
        stickBall();
        return;
    }
    const distance = Math.hypot(ball.vx, ball.vy) * dt;
    const slices = Math.max(1, Math.ceil(distance / Math.max(4, ballR())));
    const slice = dt / slices;
    for (let i = 0; i < slices; i++) {
        if (phase !== "play" || ball.stuck) return;
        integrate(slice);
    }
}

function drawBrick(type, rect, row) {
    switch (type) {
        case BRICK.DEAD:
            return;
        case BRICK.HIT_1:
        case BRICK.HIT_2:
        case BRICK.HIT_3:
        case BRICK.HIT_4:
        case BRICK.HIT_5:
            ctx.fillStyle = ROW_COLORS[row % ROW_COLORS.length];
            ctx.beginPath();
            ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 4);
            ctx.fill();
            return;
    }
}

function draw() {
    if (!width) return;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#1a222c";
    ctx.fillRect(0, 0, width, height);

    for (let row = 0; row < bricks.length; row++) {
        for (let col = 0; col < bricks[row].length; col++) {
            drawBrick(bricks[row][col], brickRect(col, row), row);
        }
    }

    ctx.fillStyle = "#3d9cf0";
    ctx.beginPath();
    ctx.roundRect(paddleLeft(), paddleTop(), paddleW(), paddleH(), paddleH() / 2);
    ctx.fill();

    if (phase !== "lost") {
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ballR(), 0, Math.PI * 2);
        ctx.fillStyle = "#e8eef4";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#0f1419";
        ctx.stroke();
    }
}

function restart() {
    clearTimeout(levelTimer);
    levelTimer = 0;
    score = 0;
    lives = LIVES;
    level = 1;
    bricks = levelLayout(level);
    phase = "ready";
    ball.stuck = true;
    ball.vx = 0;
    ball.vy = 0;
    if (width) clampPaddle(width / 2);
    stickBall();
    updateHud();
    setMessage("Move to aim, then click or tap to launch");
    draw();
}

function resize() {
    const rect = canvas.getBoundingClientRect();
    const nextW = rect.width;
    const nextH = rect.height;
    if (nextW < 2 || nextH < 2) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(nextW * dpr);
    canvas.height = Math.round(nextH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const prevW = width;
    const prevH = height;
    width = nextW;
    height = nextH;

    if (prevW && phase === "cleared") {
        ball.x *= nextW / prevW;
        ball.y *= nextH / prevH;
        clampPaddle(paddleCenter * (nextW / prevW));
    } else if (prevW && phase === "play" && !ball.stuck) {
        ball.x *= nextW / prevW;
        ball.y *= nextH / prevH;
        clampPaddle(paddleCenter * (nextW / prevW));
        setVelocity(Math.atan2(ball.vy, ball.vx));
    } else {
        clampPaddle(prevW ? paddleCenter * (nextW / prevW) : nextW / 2);
        stickBall();
    }
    draw();
}

function pointerX(event) {
    const rect = canvas.getBoundingClientRect();
    return event.clientX - rect.left;
}

function moveFromPointer(event) {
    if (!width) return;
    clampPaddle(pointerX(event));
    if (ball.stuck) stickBall();
}

// Touch aims while the finger is down and launches on release.
// A mouse follows the paddle on hover and launches on click.
canvas.addEventListener("pointerdown", (event) => {
    if (activePointer !== null) return;
    activePointer = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    if (event.cancelable) event.preventDefault();
    moveFromPointer(event);
    restartOnUp = phase === "lost";
    launchOnUp = phase !== "cleared" && !restartOnUp && ball.stuck;
});

canvas.addEventListener("pointermove", (event) => {
    if (activePointer !== null && event.pointerId !== activePointer) return;
    if (event.pointerType === "touch" && activePointer === null) return;
    moveFromPointer(event);
});

function endPointer(event, commit) {
    if (event.pointerId !== activePointer) return;
    activePointer = null;
    if (phase === "cleared") {
        launchOnUp = false;
        restartOnUp = false;
        return;
    }
    if (!commit) {
        launchOnUp = false;
        restartOnUp = false;
        return;
    }
    if (restartOnUp) restart();
    else if (launchOnUp) launch();
    launchOnUp = false;
    restartOnUp = false;
}

canvas.addEventListener("pointerup", (event) => endPointer(event, true));
canvas.addEventListener("pointercancel", (event) => endPointer(event, false));
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

restartBtn.addEventListener("click", () => {
    launchOnUp = false;
    restartOnUp = false;
    restart();
});

new ResizeObserver(resize).observe(stage);
window.addEventListener("resize", resize);

let last = 0;
function frame(now) {
    requestAnimationFrame(frame);
    const dt = last ? Math.min(0.032, (now - last) / 1000) : 0;
    last = now;
    if (dt > 0) step(dt);
    draw();
}
requestAnimationFrame(frame);
updateHud();
