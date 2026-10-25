Rtc.init("vid-sync");

/*
 
 // video item object format

{
    "id": "<unique id>",
    "index": <integer>,
    "url": "<url>",
    "time": <unix timestamp>,
    "thumb": "<url for thumbnail image>"
}

*/


const tabs = [...document.querySelectorAll('[role="tab"]')];
const stage = document.getElementById("stage");
const launch = Date.now();


// Video items for the current queue, keyed by video id
let queue = loadQueue();
// An array of video items for past videos
const history = JSON.parse(localStorage.getItem("vid-sync-history") || "[]") || [];
// The current video item being played
const videoState = JSON.parse(localStorage.getItem("vid-sync-state") || "null") || {
    playing: false,
    time: 0,
    video: null,
};




function createHtmlPlayer(mount, url) {
  const media = document.createElement("video");
  media.controls = true;
  media.playsInline = true;

  const empty = document.createElement("p");
  empty.className = "stage-empty";
  empty.textContent = "No video";

  function syncEmpty() {
    empty.hidden = Boolean(media.currentSrc || media.src);
  }

  let loaded = false;
  let onloaded = null;
  let onPlay = null;
  let onPause = null;
  let onSetTime = null;
  let scriptedPlay = 0;
  let scriptedPause = 0;
  let scriptedSeek = 0;

  function asCallback(callback) {
    return typeof callback === "function" ? callback : null;
  }

  function notifyLoaded() {
    loaded = true;
    onloaded?.();
  }

  media.addEventListener("loadstart", syncEmpty);
  media.addEventListener("emptied", syncEmpty);
  media.addEventListener("loadeddata", notifyLoaded);
  media.addEventListener("play", () => {
    if (scriptedPlay > 0) {
      scriptedPlay--;
      return;
    }
    onPlay?.();
  });
  media.addEventListener("pause", () => {
    if (scriptedPause > 0) {
      scriptedPause--;
      return;
    }
    if (media.ended) return;
    onPause?.();
  });
  media.addEventListener("seeked", () => {
    if (scriptedSeek > 0) {
      scriptedSeek--;
      return;
    }
    onSetTime?.(media.currentTime);
  });
  if (url) media.src = url;
  mount.replaceChildren(media, empty);
  syncEmpty();

  return {
    // Returns true if there is a video and it has ended
    get ended() {
      return media.src && media.ended;
    },
    get isPlaying() {
      return !media.paused;
    },
    get isPaused() {
      return media.paused;
    },
    get src() {
      return media.currentSrc || media.src;
    },
    // Called when the video has loaded enough to play
    set onloaded(callback) {
      onloaded = asCallback(callback);
      if (loaded && onloaded) queueMicrotask(() => onloaded?.());
    },
    // Called when the user starts playback
    set onPlay(callback) {
      onPlay = asCallback(callback);
    },
    // Called when the user pauses playback
    set onPause(callback) {
      onPause = asCallback(callback);
    },
    // Called with the new time when the user seeks
    set onSetTime(callback) {
      onSetTime = asCallback(callback);
    },
    play() {
      if (media.playing) return;
      scriptedPlay++;
      const pending = media.play();
      if (pending && typeof pending.catch === "function") {
        pending.catch(() => {
          scriptedPlay = Math.max(0, scriptedPlay - 1);
        });
      }
      return pending;
    },
    pause() {
      if (media.paused)  return;
      scriptedPause++;
      media.pause();
    },
    setTime(time) {
      let armed = false;
      if (media.currentTime !== time) {
        scriptedSeek++;
        armed = true;
      }
      try {
        media.currentTime = time;
      } catch (error) {
        if (armed) scriptedSeek = Math.max(0, scriptedSeek - 1);
        throw error;
      }
    },
    getTime() {
      return media.currentTime;
    },
    getLength() {
      return media.duration;
    },
  };
}

function asQueue(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return {};
}

function loadQueue() {
  try {
    return asQueue(JSON.parse(localStorage.getItem("vid-sync-queue") || "null"));
  } catch {
    return {};
  }
}

// Queue entries in the order they should appear
function queuedVideos() {
  return Object.values(queue).sort((a, b) => a.index - b.index);
}

function dedupeQueue() {
  const seen = new Set();
  for (const item of Object.values(queue)) {
    if (!item?.url) continue;
    if (seen.has(item.url)) delete queue[item.id];
    else seen.add(item.url);
  }
}

dedupeQueue();

let player = null;
setCurrentVideo(stage, videoState.video);

const queueList = document.getElementById("queue");
const historyList = document.getElementById("history");
const nowPlayingList = document.getElementById("now-playing");

function unixtime() {
  return Date.now() / 1000;
}

function videoItem(item, removable = false, playable = false) {
  const row = document.createElement("li");
  row.className = "item";

  const thumb = document.createElement("span");
  thumb.className = "thumb";
  if (item.thumb) {
    const img = document.createElement("img");
    img.alt = "";
    img.draggable = false;
    img.src = item.thumb;
    thumb.append(img);
  }
  if (playable) thumb.append(playButton(row, item));

  const body = document.createElement("span");
  body.className = "item-body";

  const url = document.createElement("span");
  url.className = "item-url";
  url.textContent = item.url ?? "";
  url.title = item.url ?? "";

  const index = document.createElement("span");
  index.className = "item-index";
  index.textContent = Number.isInteger(item.index) ? String(item.index) : "";

  body.append(url);

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "copy-url";
  copy.draggable = false;
  copy.setAttribute("aria-label", "Copy URL");
  keepClickOffDrag(row, copy);
  copy.addEventListener("click", (event) => {
    event.stopPropagation();
    copyUrl(item.url ?? "");
  });

  row.append(thumb, body, copy);
  if (removable) row.append(removeButton(row, item));
  return row;
}

function keepClickOffDrag(row, button) {
  button.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    const draggable = row.draggable;
    row.draggable = false;
    const restore = () => {
      row.draggable = draggable;
      document.removeEventListener("pointerup", restore);
      document.removeEventListener("pointercancel", restore);
    };
    document.addEventListener("pointerup", restore);
    document.addEventListener("pointercancel", restore);
  });
}

function removeButton(row, item) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "remove-url";
  button.draggable = false;
  button.setAttribute("aria-label", "Remove from queue");
  button.textContent = "×";
  keepClickOffDrag(row, button);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    removeFromQueue(item);
  });
  return button;
}

function playButton(row, item) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "thumb-play";
  button.draggable = false;
  button.setAttribute("aria-label", "Play video");
  keepClickOffDrag(row, button);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    playListedVideo(item);
  });
  return button;
}

function saveQueue(force) {
  if(!force) return;
  localStorage.setItem("vid-sync-queue", JSON.stringify(queue));
}

function queuedItem(item) {
  if (item?.id && queue[item.id]) return queue[item.id];
  return Object.values(queue).find((entry) => entry.url === item?.url) || null;
}

function renumberQueue() {
  const items = queuedVideos();
  for (let i = 0; i < items.length; i++) items[i].index = i + 1;
}

function playListedVideo(item) {
  const queued = queuedItem(item);
  videoState.playing = true;
  setCurrentVideo(item);
  if (!queued) {
    render();
    return;
  }
  delete queue[queued.id];
  renumberQueue();
  saveQueue();
  render();
}

function removeFromQueue(item) {
  const queued = queuedItem(item);
  if (!queued) return;
  delete queue[queued.id];
  renumberQueue();
  saveQueue();
  render();
}

function copyUrl(url) {
  navigator.clipboard.writeText(url).catch(() => {
    const field = document.createElement("textarea");
    field.value = url;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    document.execCommand("copy");
    field.remove();
  });
}

function renderList(list, items, removable = false) {
  const rows = items.map((item) => {
    const row = videoItem(item, removable, true);
    if (removable) row.draggable = true;
    return row;
  });
  list.replaceChildren(...rows);
}

function renderNowPlaying() {
  nowPlayingList.replaceChildren(...(videoState.video ? [videoItem(videoState.video)] : []));
}

function render() {
  renderNowPlaying();
  renderList(queueList, queuedVideos(), true);
  renderList(historyList, history);
}

function setCurrentVideo(video) {
  videoState.video = video;
  player = createHtmlPlayer(stage, videoState.video?.url);
  player.onloaded = () => {
    videoState.time = videoState.playing ?  unixtime() : 0;
    player.setTime(0);
    player.pause();
    setTimeout(() => {
        player.setTime(0);
        if(videoState.playing) {
            videoState.time =  unixtime();
            player.play();
        } else {
            player.pause();
        }
    },1000);
    console.log("video loaded");
  };
  player.onPause = () => {
    videoState.time = player.getTime();
    videoState.playing = false;
    sendState();
  };
  player.onPlay = () => {
    videoState.time =  unixtime() - player.getTime();
    videoState.playing = true;
    sendState();
  };
  player.onSetTime = (time) => {
    if(videoState.playing) {
        videoState.time =  unixtime() - time;
    } else {
        videoState.time = time;
    }
    sendState();
  };
  localStorage.setItem("vid-sync-state", JSON.stringify(videoState));
}

function sendState(peer) {
    if(perr) Rtc.send(peer.id, "", "state", videoState);
    else Rtc.sendAll("","state", videoState);
    debug();
}

function sendQueue(peer) {
    if(peer) Rtc.send(peer.id, "", "queue", queue);
    else Rtc.sendAll("","queue", queue);
}

function sendHistory(peer) {
    if(peer) Rtc.send(peer.id, "", "history", history);
    else Rtc.sendAll("","history", history);
}

Rtc.onMessage((message) => {
    switch (message.name) {
        case "log":
            console.log(message);
            break;
        case "connect":
            const peerLaunch = message.blob.launch || Number.MAX_VALUE;
            if (peerLaunch > launch) {
                console.log("Peer is newer, sending state");
                sendQueue(message.peer);
                sendState(message.peer);
                sendHistory(message.peer);
            }
            break;
        case "state":
            videoState.playing = message.blob.playing;
            videoState.time = message.blob.time;
            if(videoState.video?.url !== message.blob.video?.url) {
                setCurrentVideo(message.blob.video);
            } else {
                liveVideoUpdate();
            }
            break;
        case "queue":
            queue = asQueue(message.blob);
            render();
            break;
        case "history":
            history = message.blob;
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

function liveVideoUpdate() {
    if(videoState.playing) {
        if(!player.isPlaying) {
            player.play();
        } else {
            const time =  unixtime() - videoState.time;
            if(Math.abs(time - player.getTime()) > 5) {
                player.setTime(time + 1);
            }
        }
    } else {
        if(!player.isPaused) {
            player.pause();
        } else if(Math.abs(player.getTime() - videoState.time) > 1) {
            player.setTime(videoState.time);
        }
    }
}

function takeNextQueuedVideo() {
  if(!player.ended) return false;
  const next = queuedVideos()[0];
  if(!next) return true;
  delete queue[next.id];
  saveQueue();
  setCurrentVideo(next);
  render();
  return true;
}

function tick() {
  if(takeNextQueuedVideo()) return;
  liveVideoUpdate();
}

setInterval(tick, 5000);

let dragIndex = null;

function queueInsertIndex(clientY) {
  const rows = [...queueList.children];
  for (let i = 0; i < rows.length; i++) {
    const rect = rows[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return i;
  }
  return rows.length;
}

function markQueueDrop(insertAt) {
  const rows = [...queueList.children];
  for (const row of rows) row.classList.remove("drop-before", "drop-after");
  if (!rows.length) return;
  if (insertAt >= rows.length) rows[rows.length - 1].classList.add("drop-after");
  else rows[insertAt].classList.add("drop-before");
}

function reorderQueue(from, to) {
  if (to > from) to -= 1;
  if (from === to) return;
  const items = queuedVideos();
  const [item] = items.splice(from, 1);
  items.splice(to, 0, item);
  for (let i = 0; i < items.length; i++) items[i].index = i + 1;
  saveQueue();
  render();
}

queueList.addEventListener("dragstart", (event) => {
  if (event.target.closest(".copy-url, .remove-url, .thumb-play")) {
    event.preventDefault();
    return;
  }
  const row = event.target.closest(".item");
  if (!row || !queueList.contains(row)) return;
  dragIndex = [...queueList.children].indexOf(row);
  row.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", String(dragIndex));
});

queueList.addEventListener("dragover", (event) => {
  if (dragIndex === null) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  markQueueDrop(queueInsertIndex(event.clientY));
});

queueList.addEventListener("drop", (event) => {
  if (dragIndex === null) return;
  event.preventDefault();
  const from = dragIndex;
  dragIndex = null;
  reorderQueue(from, queueInsertIndex(event.clientY));
});

queueList.addEventListener("dragend", () => {
  dragIndex = null;
  for (const row of queueList.children) {
    row.classList.remove("dragging", "drop-before", "drop-after");
  }
});


function selectTab(tab) {
  for (const item of tabs) {
    const selected = item === tab;
    item.setAttribute("aria-selected", String(selected));
    item.tabIndex = selected ? 0 : -1;
    document.getElementById(item.getAttribute("aria-controls")).hidden = !selected;
  }
}

for (const tab of tabs) {
  tab.addEventListener("click", () => selectTab(tab));
  tab.addEventListener("keydown", (event) => {
    const index = tabs.indexOf(tab);
    let next = null;
    if (event.key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
    if (event.key === "ArrowLeft") next = tabs[(index - 1 + tabs.length) % tabs.length];
    if (event.key === "Home") next = tabs[0];
    if (event.key === "End") next = tabs[tabs.length - 1];
    if (!next || next === tab) return;
    event.preventDefault();
    selectTab(next);
    next.focus();
  });
}

function debug() {
    console.log("Debug:", videoState);
}

render();

const addButton = document.getElementById("queue-add");
const addDialog = document.getElementById("queue-add-dialog");
const addForm = document.getElementById("queue-add-form");
const urlInput = document.getElementById("queue-url");
const urlError = document.getElementById("queue-url-error");

function isUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function showUrlError(message) {
  urlError.hidden = false;
  urlError.textContent = message;
  urlInput.setAttribute("aria-invalid", "true");
}

function clearUrlError() {
  urlError.hidden = true;
  urlInput.removeAttribute("aria-invalid");
}

addButton.addEventListener("click", () => {
  addForm.reset();
  clearUrlError();
  addDialog.showModal();
  urlInput.focus();
});

urlInput.addEventListener("input", clearUrlError);

function newID() {
  let id = crypto.randomUUID().slice(0, 8);
  while(queue[id] || history.some((item) => item.id === id)) {
    id = crypto.randomUUID().slice(0, 8);
  }
  return id;
}

function addVideoToQueue(url) {
  const items = queuedVideos();
  const last = items[items.length - 1];
  const index = last ? last.index + 1 : 1;
  const id = newID();
  queue[id] = { id, index, url, thumb: "", time: unixtime() };
  saveQueue(true);
}

addForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const url = urlInput.value.trim();
  if (!isUrl(url)) {
    showUrlError("Invalid URL");
    urlInput.focus();
    return;
  }
  if (Object.values(queue).some((item) => item.url === url)) {
    showUrlError("URL already in queue");
    urlInput.focus();
    return;
  }
  clearUrlError();
  addVideoToQueue(url);
  render();
  addForm.reset();
  addDialog.close();
  queueList.lastElementChild?.scrollIntoView({ block: "nearest" });
});

addDialog.querySelector(".dialog-cancel").addEventListener("click", () => {
  addDialog.close();
});
