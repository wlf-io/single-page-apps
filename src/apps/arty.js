const VIEW_PAD = 10; // world units of padding around the triangle
const SCREEN_PAD = 48;

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const stats = document.getElementById("stats");
const hypStats = document.getElementById("hyp-stats");

/** @type {{ minX: number, maxX: number, minY: number, maxY: number, span: number }} */
let view = { minX: -200, maxX: 200, minY: -200, maxY: 200, span: 400 };

const inputs = {
    ax: document.getElementById("ax"),
    ay: document.getElementById("ay"),
    bx: document.getElementById("bx"),
    by: document.getElementById("by"),
};
const rangeMultInput = document.getElementById("range-mult");

function rangeMultiplier() {
    const n = +rangeMultInput.value;
    return Number.isFinite(n) ? n : 100;
}

function readPoints() {
    return {
        A: { x: +inputs.ax.value || 0, y: +inputs.ay.value || 0 },
        B: { x: +inputs.bx.value || 0, y: +inputs.by.value || 0 },
    };
}

function countDecimals(str) {
    const s = String(str).trim();
    const i = s.indexOf(".");
    if (i < 0) return 0;
    // ignore trailing exponent if present
    const frac = s.slice(i + 1).replace(/[eE].*$/, "");
    return frac.length;
}

function inputDecimals() {
    return Math.max(
        countDecimals(inputs.ax.value),
        countDecimals(inputs.ay.value),
        countDecimals(inputs.bx.value),
        countDecimals(inputs.by.value),
    );
}

/** Decimal places mirrored from A/B inputs; updated each render. */
let decimals = 0;

const STORAGE_KEY = "arty.triangle.points";

function savePoints() {
    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
            ax: inputs.ax.value,
            ay: inputs.ay.value,
            bx: inputs.bx.value,
            by: inputs.by.value,
            rangeMult: rangeMultInput.value,
        }),
    );
}

function restorePoints() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data.ax != null && data.ay != null && data.bx != null && data.by != null) {
            inputs.ax.value = data.ax;
            inputs.ay.value = data.ay;
            inputs.bx.value = data.bx;
            inputs.by.value = data.by;
            if (data.rangeMult != null) rangeMultInput.value = data.rangeMult;
        } else if (data?.A && data?.B) {
            // legacy shape { A: {x,y}, B: {x,y} }
            inputs.ax.value = data.A.x;
            inputs.ay.value = data.A.y;
            inputs.bx.value = data.B.x;
            inputs.by.value = data.B.y;
        }
    } catch {
        // ignore corrupt storage
    }
}

function setViewFromPoints(points) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
    }
    minX -= VIEW_PAD;
    maxX += VIEW_PAD;
    minY -= VIEW_PAD;
    maxY += VIEW_PAD;

    // Keep 1:1 scale on the square canvas by expanding the shorter axis
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const span = Math.max(spanX, spanY, 1);
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    view = {
        minX: midX - span / 2,
        maxX: midX + span / 2,
        minY: midY - span / 2,
        maxY: midY + span / 2,
        span,
    };
}

function toScreen(x, y) {
    const w = canvas.width - SCREEN_PAD * 2;
    const h = canvas.height - SCREEN_PAD * 2;
    return {
        x: SCREEN_PAD + ((x - view.minX) / view.span) * w,
        y: SCREEN_PAD + ((view.maxY - y) / view.span) * h,
    };
}

function dist(p, q) {
    return Math.hypot(q.x - p.x, q.y - p.y);
}

function fmt(n, digits = decimals) {
    return Number(n).toFixed(digits);
}

/** Clockwise degrees from upward vertical (+y) for vector A→B, in [0, 360). */
function hypAngleFromVertical(A, B) {
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    let deg = (Math.atan2(dx, dy) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    return deg;
}

function updateHypStats(length, angleDeg) {
    hypStats.innerHTML = `
        <span class="hyp-len">Range <strong>${fmt(length)} m</strong></span>
        <span class="hyp-ang"><strong>${fmt(angleDeg)}°</strong> Angle</span>
      `;
}

function niceStep(span) {
    const raw = span / 8;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / pow;
    const mult = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10;
    return mult * pow;
}

function drawGrid() {
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const step = niceStep(view.span);
    const majorEvery = 5;
    const startX = Math.ceil(view.minX / step) * step;
    const startY = Math.ceil(view.minY / step) * step;

    for (let v = startX; v <= view.maxX + 1e-9; v += step) {
        const a = toScreen(v, view.minY);
        const b = toScreen(v, view.maxY);
        const major = Math.abs(Math.round(v / step) % majorEvery) < 1e-9;
        ctx.strokeStyle = major ? "#2a3848" : "#1c2632";
        ctx.lineWidth = major ? 1 : 0.5;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
    }
    for (let v = startY; v <= view.maxY + 1e-9; v += step) {
        const a = toScreen(view.minX, v);
        const b = toScreen(view.maxX, v);
        const major = Math.abs(Math.round(v / step) % majorEvery) < 1e-9;
        ctx.strokeStyle = major ? "#2a3848" : "#1c2632";
        ctx.lineWidth = major ? 1 : 0.5;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
    }

    // axes (if visible)
    const o = toScreen(0, 0);
    const xAxisVisible = view.minY <= 0 && view.maxY >= 0;
    const yAxisVisible = view.minX <= 0 && view.maxX >= 0;

    ctx.strokeStyle = "#5a6e82";
    ctx.lineWidth = 1.5;
    if (xAxisVisible) {
        const xmin = toScreen(view.minX, 0);
        const xmax = toScreen(view.maxX, 0);
        ctx.beginPath();
        ctx.moveTo(xmin.x, xmin.y);
        ctx.lineTo(xmax.x, xmax.y);
        ctx.stroke();
    }
    if (yAxisVisible) {
        const ymin = toScreen(0, view.minY);
        const ymax = toScreen(0, view.maxY);
        ctx.beginPath();
        ctx.moveTo(ymin.x, ymin.y);
        ctx.lineTo(ymax.x, ymax.y);
        ctx.stroke();
    }

    // tick labels on major lines
    const labelStep = step * majorEvery;
    const labelStartX = Math.ceil(view.minX / labelStep) * labelStep;
    const labelStartY = Math.ceil(view.minY / labelStep) * labelStep;
    ctx.fillStyle = "#7a8a9a";
    ctx.font = "11px Segoe UI, system-ui, sans-serif";

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const xLabelY = xAxisVisible ? o.y + 6 : toScreen(0, view.minY).y + 4;
    for (let v = labelStartX; v <= view.maxX + 1e-9; v += labelStep) {
        const p = toScreen(v, 0);
        ctx.fillText(fmt(v, 4), p.x, xLabelY);
    }

    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const yLabelX = yAxisVisible ? o.x - 6 : toScreen(view.minX, 0).x - 4;
    for (let v = labelStartY; v <= view.maxY + 1e-9; v += labelStep) {
        if (xAxisVisible && Math.abs(v) < 1e-9) continue;
        const p = toScreen(0, v);
        ctx.fillText(fmt(v, 4), yLabelX, p.y);
    }

    // axis titles
    ctx.fillStyle = "#8a9aab";
    ctx.font = "12px Segoe UI, system-ui, sans-serif";
    const corner = toScreen(view.maxX, view.minY);
    const topLeft = toScreen(view.minX, view.maxY);
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("x (m)", corner.x, (xAxisVisible ? o.y : corner.y) - 8);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("y (m)", (yAxisVisible ? o.x : topLeft.x) + 8, topLeft.y);
}

function drawAngleArc(vertex, from, to, radius, color, label) {
    const sv = toScreen(vertex.x, vertex.y);
    const sf = toScreen(from.x, from.y);
    const st = toScreen(to.x, to.y);

    const a1 = Math.atan2(sf.y - sv.y, sf.x - sv.x);
    let a2 = Math.atan2(st.y - sv.y, st.x - sv.x);

    // choose shorter arc
    let delta = a2 - a1;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.arc(sv.x, sv.y, radius, a1, a1 + delta, delta < 0);
    ctx.stroke();

    const mid = a1 + delta / 2;
    // Place label further along the bisector, inside the triangle past the arc
    const labelDist = radius + 26;
    const lx = sv.x + Math.cos(mid) * labelDist;
    const ly = sv.y + Math.sin(mid) * labelDist;

    ctx.fillStyle = color;
    ctx.font = "600 12px Segoe UI, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, lx, ly);
}

function midpointLabel(p, q, text, color, outwardFrom, offset = 14) {
    const sp = toScreen(p.x, p.y);
    const sq = toScreen(q.x, q.y);
    const mx = (sp.x + sq.x) / 2;
    const my = (sp.y + sq.y) / 2;
    let dx = sq.x - sp.x;
    let dy = sq.y - sp.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;

    // Perpendicular; pick the side away from the triangle interior
    let nx = -dy;
    let ny = dx;
    if (outwardFrom) {
        const c = toScreen(outwardFrom.x, outwardFrom.y);
        const toMidX = mx - c.x;
        const toMidY = my - c.y;
        if (nx * toMidX + ny * toMidY < 0) {
            nx = -nx;
            ny = -ny;
        }
    }

    let angle = Math.atan2(dy, dx);
    // Keep text readable (not upside-down)
    if (angle > Math.PI / 2 || angle < -Math.PI / 2) {
        angle += Math.PI;
    }

    ctx.save();
    ctx.translate(mx + nx * offset, my + ny * offset);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.font = "600 13px Segoe UI, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 0, 0);
    ctx.restore();
}

function drawPoint(p, label, color, outwardFrom) {
    const s = toScreen(p.x, p.y);
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
    ctx.fill();

    const text = `${label} (${fmt(p.x)}, ${fmt(p.y)})`;
    ctx.fillStyle = color;
    ctx.font = "600 13px Segoe UI, system-ui, sans-serif";

    let ox = 1;
    let oy = -1;
    if (outwardFrom) {
        const c = toScreen(outwardFrom.x, outwardFrom.y);
        const dx = s.x - c.x;
        const dy = s.y - c.y;
        const len = Math.hypot(dx, dy) || 1;
        ox = dx / len;
        oy = dy / len;
    }

    const offset = 18;
    const tx = s.x + ox * offset;
    const ty = s.y + oy * offset;
    ctx.textAlign = ox < -0.25 ? "right" : ox > 0.25 ? "left" : "center";
    ctx.textBaseline = oy < -0.25 ? "bottom" : oy > 0.25 ? "top" : "middle";
    ctx.fillText(text, tx, ty);
}

function render() {
    decimals = inputDecimals();
    const { A, B } = readPoints();

    // Right angle at C = (Ax, By) → legs axis-aligned
    const C = { x: A.x, y: B.y };
    setViewFromPoints([A, B, C]);
    drawGrid();

    const legAC = dist(A, C); // vertical |Ay - By|
    const legBC = dist(B, C); // horizontal |Bx - Ax|
    const hypAB = dist(A, B);
    const hypAngle = hypAngleFromVertical(A, B);
    const rangeOut = hypAB * rangeMultiplier();

    if (legAC < 1e-9 || legBC < 1e-9) {
        updateHypStats(rangeOut, hypAngle);
        stats.innerHTML = `<span class="err">Degenerate: Origin and Target must differ in both x and y so an axis-aligned right triangle can form.</span>`;
        drawPoint(A, "Origin", "#3d9cf0");
        drawPoint(B, "Target", "#3d9cf0");
        return;
    }

    const angA = (Math.atan(legBC / legAC) * 180) / Math.PI;
    const angB = (Math.atan(legAC / legBC) * 180) / Math.PI;
    const angC = 90;

    // fill triangle
    const sA = toScreen(A.x, A.y);
    const sB = toScreen(B.x, B.y);
    const sC = toScreen(C.x, C.y);

    ctx.beginPath();
    ctx.moveTo(sA.x, sA.y);
    ctx.lineTo(sB.x, sB.y);
    ctx.lineTo(sC.x, sC.y);
    ctx.closePath();
    ctx.fillStyle = "rgba(61, 156, 240, 0.12)";
    ctx.fill();

    // legs
    ctx.strokeStyle = "#4ecdc4";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(sA.x, sA.y);
    ctx.lineTo(sC.x, sC.y);
    ctx.lineTo(sB.x, sB.y);
    ctx.stroke();

    // hypotenuse
    ctx.strokeStyle = "#f0a030";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(sA.x, sA.y);
    ctx.lineTo(sB.x, sB.y);
    ctx.stroke();

    // right-angle square at C (AC vertical, BC horizontal)
    {
        const size = 14;
        const dirAy = Math.sign(sA.y - sC.y) || 1;
        const dirBx = Math.sign(sB.x - sC.x) || 1;
        ctx.strokeStyle = "#a0e060";
        ctx.lineWidth = 1.75;
        ctx.beginPath();
        ctx.moveTo(sC.x + dirBx * size, sC.y);
        ctx.lineTo(sC.x + dirBx * size, sC.y + dirAy * size);
        ctx.lineTo(sC.x, sC.y + dirAy * size);
        ctx.stroke();
    }

    // angle arcs at A and B
    drawAngleArc(A, C, B, 28, "#e878a0", `${fmt(angA)}°`);
    drawAngleArc(B, C, A, 28, "#e878a0", `${fmt(angB)}°`);

    // side labels
    const centroid = {
        x: (A.x + B.x + C.x) / 3,
        y: (A.y + B.y + C.y) / 3,
    };
    midpointLabel(A, C, `${fmt(legAC)} m`, "#4ecdc4", centroid);
    midpointLabel(B, C, `${fmt(legBC)} m`, "#4ecdc4", centroid);
    midpointLabel(A, B, `${fmt(hypAB)} m`, "#f0a030", centroid);

    drawPoint(A, "Origin", "#3d9cf0", centroid);
    drawPoint(B, "Target", "#3d9cf0", centroid);
    drawPoint(C, "C", "#a0e060", centroid);

    // 90° label near C, inset into the triangle
    {
        const s = toScreen(C.x, C.y);
        const ox = Math.sign(B.x - C.x) || 1;
        const oy = Math.sign(A.y - C.y) || 1;
        // screen: y flips, so screen offset for world +y is -y
        ctx.fillStyle = "#a0e060";
        ctx.font = "600 12px Segoe UI, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("90°", s.x + ox * 40, s.y + (oy > 0 ? -40 : 40));
    }

    updateHypStats(rangeOut, hypAngle);

    stats.innerHTML = `
        <div><strong>C</strong> (right angle) = (${fmt(C.x)}, ${fmt(C.y)}) m</div>
        <div>Leg AC = <strong>${fmt(legAC)} m</strong> · Leg BC = <strong>${fmt(legBC)} m</strong></div>
        <div>Range = <strong>${fmt(rangeOut)} m</strong></div>
        <div>∠Origin = <strong>${fmt(angA)}°</strong> · ∠Target = <strong>${fmt(angB)}°</strong> · ∠C = <strong>${fmt(angC)}°</strong></div>
      `;
}

function parseCoordPaste(text) {
    const cleaned = String(text).replace(/[^0-9.,+\-]/g, "");
    const parts = cleaned.split(",").map((p) => p.trim()).filter((p) => p !== "");
    console.log("Paste detected: ", parts);
    if (parts.length < 2) return null;
    return { x: parts[0], y: parts[1] };
}

function onCoordPaste(e, xInput, yInput) {
    const text = e.clipboardData?.getData("text") ?? "";
    const parsed = parseCoordPaste(text);
    if (!parsed) return; // allow normal single-value paste
    e.preventDefault();
    xInput.value = parsed.x;
    yInput.value = parsed.y;
    savePoints();
    render();
}

for (const el of Object.values(inputs)) {
    el.addEventListener("input", () => {
        savePoints();
        render();
    });
}

inputs.ax.addEventListener("paste", (e) => onCoordPaste(e, inputs.ax, inputs.ay));
inputs.ay.addEventListener("paste", (e) => onCoordPaste(e, inputs.ax, inputs.ay));
inputs.bx.addEventListener("paste", (e) => onCoordPaste(e, inputs.bx, inputs.by));
inputs.by.addEventListener("paste", (e) => onCoordPaste(e, inputs.bx, inputs.by));

rangeMultInput.addEventListener("input", () => {
    savePoints();
    render();
});

restorePoints();
render();