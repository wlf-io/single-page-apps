Rtc.init("sync");
const launch = Date.now();

const area = document.querySelector("#main-text");
area.value = localStorage.getItem("sync:text") || "";
let last = area.value;
let applying = false;

function pointAt(value, offset) {
    const lines = value.slice(0, offset).split("\n");
    return { line: lines.length - 1, column: lines[lines.length - 1].length };
}

function offsetAt(lines, point) {
    const line = Math.max(0, Math.min(point.line, Math.max(lines.length - 1, 0)));
    let offset = 0;
    for (let i = 0; i < line; i++) offset += lines[i].length + 1;
    return offset + Math.min(Math.max(point.column, 0), lines[line].length);
}

function applyLine(line, text, insert) {
    const value = area.value;
    const start = pointAt(value, area.selectionStart);
    const end = pointAt(value, area.selectionEnd);
    const lines = value.split("\n");
    if (text === null) {
        if (line >= lines.length) return;
        lines.splice(line, 1);
        if (lines.length === 0) lines.push("");
        if (start.line > line) start.line--;
        else if (start.line === line) start.column = 0;
        if (end.line > line) end.line--;
        else if (end.line === line) end.column = 0;
    } else if (insert) {
        const at = Math.min(line, lines.length);
        lines.splice(at, 0, text);
        if (start.line >= at) start.line++;
        if (end.line >= at) end.line++;
    } else {
        while (lines.length <= line) lines.push("");
        lines[line] = text;
        if (start.line === line) start.column = Math.min(start.column, text.length);
        if (end.line === line) end.column = Math.min(end.column, text.length);
    }
    const next = lines.join("\n");
    if (next === value) return;
    const scroll = area.scrollTop;
    applying = true;
    area.value = next;
    applying = false;
    const max = next.length;
    area.selectionStart = Math.min(offsetAt(lines, start), max);
    area.selectionEnd = Math.min(offsetAt(lines, end), max);
    area.scrollTop = scroll;
    last = next;
    localStorage.setItem("sync:text", next);
}

function sendLine(line, text, insert) {
    const blob = { line, text };
    if (insert) blob.insert = true;
    Rtc.sendAll(crypto.randomUUID(), "line-edit", blob);
}

function publish(prev, next) {
    const oldLines = prev.split("\n");
    const newLines = next.split("\n");
    let start = 0;
    while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++;
    let oldEnd = oldLines.length;
    let newEnd = newLines.length;
    while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
        oldEnd--;
        newEnd--;
    }
    if (start === oldEnd && start === newEnd) return;
    const keep = Math.min(oldEnd - start, newEnd - start);
    try {
        for (let i = 0; i < keep; i++) {
            const line = start + i;
            if (oldLines[line] !== newLines[line]) sendLine(line, newLines[line]);
        }
        // for (let i = keep; i < newEnd - start; i++) sendLine(start + i, newLines[start + i], true);
        // for (let line = oldEnd - 1; line >= start + keep; line--) sendLine(line, null);
    } catch (err) {
        if (err.message !== "Not connected") throw err;
    }
    localStorage.setItem("sync:text", next);
}

area.addEventListener("input", () => {
    if (applying) return;
    const next = area.value;
    const prev = last;
    last = next;
    publish(prev, next);
});


function handleLineEdit(message) {
    if (message.name !== "line-edit" || !message.blob) return;
    const line = message.blob.line;
    const text = message.blob.text;
    if (!Number.isInteger(line) || line < 0) return;
    if (text !== null && typeof text !== "string") return;
    if (typeof text === "string" && text.includes("\n")) return;
    applyLine(line, text, message.blob.insert === true);
}

Rtc.onMessage((message) => {
    switch (message.name) {
        case "line-edit":
            handleLineEdit(message);
            break;
        case "log":
            console.log(message);
            break;
        case "connect":
            const peerLaunch = message.blob.launch || Number.MAX_VALUE;
            console.log("Peer launch:", peerLaunch, "launch:", launch, message);
            if (peerLaunch > launch) {
                console.log("Peer is newer, sending text");
                Rtc.send(message.peer.id, "", "text", { text: area.value });
            }
            break;
        case "text":
            area.value = message.blob.text;
            last = area.value;
            break;
    }

});

Rtc.onPeerConnect((peer) => {
    console.log("Peer connected:", peer);
    Rtc.send(peer.id, "", "connect", { launch });
});

Rtc.onPeerDisconnect((peer) => {
    console.log("Peer disconnected:", peer);
});