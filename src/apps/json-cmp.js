const leftEl = document.getElementById("left");
const rightEl = document.getElementById("right");
const hlLeft = document.getElementById("hl-left");
const hlRight = document.getElementById("hl-right");
const orderEl = document.getElementById("order");
const statusEl = document.getElementById("status");
const diffsEl = document.getElementById("diffs");
const diffBody = document.getElementById("diff-body");
const paneLeft = document.getElementById("pane-left");
const paneRight = document.getElementById("pane-right");

function typeOf(v) {
    if (v === null) return "null";
    if (Array.isArray(v)) return "array";
    return typeof v;
}

function identPath(key) {
    return /^[A-Za-z_$][\w$]*$/.test(key) ? "." + key : "[" + JSON.stringify(key) + "]";
}

function pathLength(path) {
    let i = path.startsWith("$") ? 1 : 0;
    let n = 0;
    while (i < path.length) {
        if (path[i] === ".") {
            i++;
            while (i < path.length && /[\w$]/.test(path[i])) i++;
            n++;
        } else if (path[i] === "[") {
            i++;
            if (path[i] === '"') {
                i++;
                while (i < path.length) {
                    if (path[i] === "\\") { i += 2; continue; }
                    if (path[i] === '"') { i++; break; }
                    i++;
                }
            } else {
                while (i < path.length && path[i] !== "]") i++;
            }
            if (path[i] === "]") i++;
            n++;
        } else {
            i++;
        }
    }
    return n;
}

function compareDiffs(a, b) {
    const byDepth = pathLength(a.path) - pathLength(b.path);
    if (byDepth) return byDepth;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

function parsePath(path) {
    const segs = [];
    let i = path.startsWith("$") ? 1 : 0;
    while (i < path.length) {
        if (path[i] === ".") {
            i++;
            const start = i;
            while (i < path.length && /[\w$]/.test(path[i])) i++;
            segs.push(path.slice(start, i));
        } else if (path[i] === "[") {
            i++;
            if (path[i] === '"') {
                const start = i;
                i++;
                while (i < path.length) {
                    if (path[i] === "\\") { i += 2; continue; }
                    if (path[i] === '"') { i++; break; }
                    i++;
                }
                segs.push(JSON.parse(path.slice(start, i)));
                if (path[i] === "]") i++;
            } else {
                const start = i;
                while (i < path.length && path[i] !== "]") i++;
                segs.push(Number(path.slice(start, i)));
                if (path[i] === "]") i++;
            }
        } else {
            i++;
        }
    }
    return segs;
}

function skipWs(s, i) {
    while (i < s.length && /\s/.test(s[i])) i++;
    return i;
}

function skipString(s, i) {
    i++;
    while (i < s.length) {
        if (s[i] === "\\") { i += 2; continue; }
        if (s[i] === '"') return i + 1;
        i++;
    }
    return i;
}

function skipValue(s, i) {
    i = skipWs(s, i);
    const c = s[i];
    if (c === '"') return skipString(s, i);
    if (c === "{" || c === "[") {
        const close = c === "{" ? "}" : "]";
        let depth = 1;
        i++;
        while (i < s.length && depth) {
            const ch = s[i];
            if (ch === '"') { i = skipString(s, i); continue; }
            if (ch === c) depth++;
            else if (ch === close) depth--;
            i++;
        }
        return i;
    }
    while (i < s.length && /[^\s,\]}]/.test(s[i])) i++;
    return i;
}

function locateValue(source, segs) {
    let i = skipWs(source, 0);
    for (const seg of segs) {
        i = skipWs(source, i);
        if (typeof seg === "number") {
            if (source[i] !== "[") return null;
            i++;
            i = skipWs(source, i);
            if (source[i] === "]") return null;
            for (let n = 0; n < seg; n++) {
                i = skipValue(source, i);
                i = skipWs(source, i);
                if (source[i] !== ",") return null;
                i++;
                i = skipWs(source, i);
            }
        } else {
            if (source[i] !== "{") return null;
            i++;
            let found = false;
            while (i < source.length) {
                i = skipWs(source, i);
                if (source[i] === "}" || source[i] !== '"') return null;
                const keyStart = i;
                const keyEnd = skipString(source, i);
                let key;
                try { key = JSON.parse(source.slice(keyStart, keyEnd)); }
                catch { return null; }
                i = skipWs(source, keyEnd);
                if (source[i] !== ":") return null;
                i++;
                i = skipWs(source, i);
                if (key === seg) {
                    found = true;
                    break;
                }
                i = skipValue(source, i);
                i = skipWs(source, i);
                if (source[i] !== ",") return null;
                i++;
            }
            if (!found) return null;
        }
    }
    const start = skipWs(source, i);
    const end = skipValue(source, start);
    return end > start ? { start, end } : null;
}

function paintHighlight(hl, text, range) {
    if (!range) {
        hl.textContent = text;
        return;
    }
    const mark = document.createElement("mark");
    mark.textContent = text.slice(range.start, range.end);
    hl.replaceChildren(
        document.createTextNode(text.slice(0, range.start)),
        mark,
        document.createTextNode(text.slice(range.end)),
    );
}

function revealRange(ta, start) {
    const cs = getComputedStyle(ta);
    let lineHeight = parseFloat(cs.lineHeight);
    if (!Number.isFinite(lineHeight)) lineHeight = parseFloat(cs.fontSize) * 1.45;
    const padTop = parseFloat(cs.paddingTop) || 0;
    const padLeft = parseFloat(cs.paddingLeft) || 0;
    const pre = ta.value.slice(0, start);
    const line = pre.split("\n").length - 1;
    const col = start - (pre.lastIndexOf("\n") + 1);
    const y = padTop + line * lineHeight;
    const view = ta.clientHeight;
    if (y < ta.scrollTop + lineHeight || y > ta.scrollTop + view - lineHeight * 2) {
        ta.scrollTop = Math.max(0, y - view / 3);
    }
    const ch = parseFloat(cs.fontSize) * 0.62;
    const x = padLeft + col * ch;
    if (x < ta.scrollLeft + 24 || x > ta.scrollLeft + ta.clientWidth - 48) {
        ta.scrollLeft = Math.max(0, x - 40);
    }
}

function syncHighlightScroll(ta, hl) {
    hl.scrollTop = ta.scrollTop;
    hl.scrollLeft = ta.scrollLeft;
}

function highlightDiff(path, kind) {
    const segs = parsePath(path);
    const leftRange = kind === "added" ? null : locateValue(leftEl.value, segs);
    const rightRange = kind === "removed" ? null : locateValue(rightEl.value, segs);
    paintHighlight(hlLeft, leftEl.value, leftRange);
    paintHighlight(hlRight, rightEl.value, rightRange);
    if (leftRange) revealRange(leftEl, leftRange.start);
    if (rightRange) revealRange(rightEl, rightRange.start);
    syncHighlightScroll(leftEl, hlLeft);
    syncHighlightScroll(rightEl, hlRight);
}

function deepEqual(a, b, orderMatters) {
    const ta = typeOf(a);
    const tb = typeOf(b);
    if (ta !== tb) return false;
    if (ta === "array") {
        if (a.length !== b.length) return false;
        if (orderMatters) {
            return a.every((item, i) => deepEqual(item, b[i], orderMatters));
        }
        const used = new Array(b.length).fill(false);
        for (const item of a) {
            let found = false;
            for (let i = 0; i < b.length; i++) {
                if (used[i]) continue;
                if (deepEqual(item, b[i], orderMatters)) {
                    used[i] = true;
                    found = true;
                    break;
                }
            }
            if (!found) return false;
        }
        return true;
    }
    if (ta === "object") {
        const keys = Object.keys(a);
        if (keys.length !== Object.keys(b).length) return false;
        return keys.every((key) =>
            Object.prototype.hasOwnProperty.call(b, key) &&
            deepEqual(a[key], b[key], orderMatters)
        );
    }
    return Object.is(a, b);
}

function collectDiffs(a, b, path, orderMatters, out) {
    const ta = typeOf(a);
    const tb = typeOf(b);
    if (ta !== tb) {
        out.push({ kind: "changed", path, left: a, right: b });
        return;
    }
    if (ta === "array") {
        if (orderMatters) {
            const n = Math.max(a.length, b.length);
            for (let i = 0; i < n; i++) {
                const p = path + "[" + i + "]";
                if (i >= a.length) out.push({ kind: "added", path: p, right: b[i] });
                else if (i >= b.length) out.push({ kind: "removed", path: p, left: a[i] });
                else collectDiffs(a[i], b[i], p, orderMatters, out);
            }
            return;
        }
        const used = new Array(b.length).fill(false);
        a.forEach((item, i) => {
            let found = -1;
            for (let j = 0; j < b.length; j++) {
                if (used[j]) continue;
                if (deepEqual(item, b[j], orderMatters)) {
                    found = j;
                    break;
                }
            }
            if (found >= 0) used[found] = true;
            else out.push({ kind: "removed", path: path + "[" + i + "]", left: item });
        });
        b.forEach((item, j) => {
            if (!used[j]) out.push({ kind: "added", path: path + "[" + j + "]", right: item });
        });
        return;
    }
    if (ta === "object") {
        const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
        for (const key of keys) {
            const p = path + identPath(key);
            const hasA = Object.prototype.hasOwnProperty.call(a, key);
            const hasB = Object.prototype.hasOwnProperty.call(b, key);
            if (!hasA) out.push({ kind: "added", path: p, right: b[key] });
            else if (!hasB) out.push({ kind: "removed", path: p, left: a[key] });
            else collectDiffs(a[key], b[key], p, orderMatters, out);
        }
        return;
    }
    if (!Object.is(a, b)) out.push({ kind: "changed", path, left: a, right: b });
}

function parsePane(text) {
    const trimmed = text.trim();
    if (!trimmed) return { empty: true };
    try {
        return { value: JSON.parse(trimmed) };
    } catch (err) {
        return { error: err.message };
    }
}

function preview(value) {
    if (value === undefined) return "";
    const text = JSON.stringify(value);
    return text.length > 96 ? text.slice(0, 93) + "…" : text;
}

function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status" + (kind ? " " + kind : "");
}

function render() {
    const left = parsePane(leftEl.value);
    const right = parsePane(rightEl.value);
    const orderMatters = orderEl.checked;
    paneLeft.classList.toggle("error", Boolean(left.error));
    paneRight.classList.toggle("error", Boolean(right.error));
    paintHighlight(hlLeft, leftEl.value, null);
    paintHighlight(hlRight, rightEl.value, null);
    diffBody.replaceChildren();
    diffsEl.hidden = true;

    if (left.empty && right.empty) {
        setStatus("Paste JSON on both sides to compare.");
        return;
    }
    if (left.empty || right.empty) {
        setStatus("Waiting for the other side.");
        return;
    }

    const errors = [];
    if (left.error) errors.push("Left: " + left.error);
    if (right.error) errors.push("Right: " + right.error);
    if (errors.length) {
        setStatus(errors.join("  ·  "), "error");
        return;
    }

    const diffs = [];
    collectDiffs(left.value, right.value, "$", orderMatters, diffs);
    diffs.sort(compareDiffs);
    if (!diffs.length) {
        setStatus("JSON matches.", "match");
        return;
    }

    setStatus(
        "JSON differs (" + diffs.length + " difference" + (diffs.length === 1 ? "" : "s") + ").",
        "diff"
    );
    diffsEl.hidden = false;
    for (const diff of diffs) {
        const tr = document.createElement("tr");
        const kind = document.createElement("td");
        kind.className = "kind " + diff.kind;
        kind.textContent = diff.kind;
        const path = document.createElement("td");
        path.textContent = diff.path;
        const leftCell = document.createElement("td");
        leftCell.className = diff.left === undefined ? "empty" : "val";
        leftCell.textContent = diff.left === undefined ? "—" : preview(diff.left);
        const rightCell = document.createElement("td");
        rightCell.className = diff.right === undefined ? "empty" : "val";
        rightCell.textContent = diff.right === undefined ? "—" : preview(diff.right);
        tr.dataset.path = diff.path;
        tr.dataset.kind = diff.kind;
        tr.tabIndex = 0;
        tr.append(kind, path, leftCell, rightCell);
        diffBody.append(tr);
    }
}

const STORAGE_PREFIX = "json-comp-";

function saveState() {
    try {
        localStorage.setItem(STORAGE_PREFIX + "left", leftEl.value);
        localStorage.setItem(STORAGE_PREFIX + "right", rightEl.value);
        localStorage.setItem(STORAGE_PREFIX + "order", orderEl.checked ? "1" : "0");
    } catch {
        // ignore quota / private-mode failures
    }
}

function restoreState() {
    try {
        const left = localStorage.getItem(STORAGE_PREFIX + "left");
        const right = localStorage.getItem(STORAGE_PREFIX + "right");
        const order = localStorage.getItem(STORAGE_PREFIX + "order");
        if (left != null) leftEl.value = left;
        if (right != null) rightEl.value = right;
        if (order != null) orderEl.checked = order === "1";
    } catch {
        // ignore unreadable storage
    }
}

function onPaneChange() {
    saveState();
    render();
}

function formatPane(el) {
    const parsed = parsePane(el.value);
    if (parsed.empty || parsed.error) {
        onPaneChange();
        return;
    }
    el.value = JSON.stringify(parsed.value, null, 2);
    onPaneChange();
}

leftEl.addEventListener("input", onPaneChange);
rightEl.addEventListener("input", onPaneChange);
leftEl.addEventListener("scroll", () => syncHighlightScroll(leftEl, hlLeft));
rightEl.addEventListener("scroll", () => syncHighlightScroll(rightEl, hlRight));
orderEl.addEventListener("change", onPaneChange);
document.getElementById("format-left").addEventListener("click", () => formatPane(leftEl));
document.getElementById("format-right").addEventListener("click", () => formatPane(rightEl));
diffBody.addEventListener("click", (e) => {
    const tr = e.target.closest("tr");
    if (!tr?.dataset.path) return;
    for (const row of diffBody.querySelectorAll("tr.active")) row.classList.remove("active");
    tr.classList.add("active");
    highlightDiff(tr.dataset.path, tr.dataset.kind);
});

restoreState();
render();