Rtc.init("vid-sync");

/*
 
 // video item object format

{
    "index": <integer>,
    "url": "<url>",
    "time": <unix timestamp>,
    "thumb": "<url for thumbnail image>"
}

*/


const tabs = [...document.querySelectorAll('[role="tab"]')];
const stage = document.getElementById("stage");
const launch = Date.now();
let playTimer = null;

Rtc.onSessionOpen(() => {
  playTimer = setInterval(tick, 5000);
  loadHistory();
});

Rtc.onSessionClose(() => {
  clearInterval(playTimer);
  playTimer = null;
});

// Video items for the current queue, keyed by video id
const queue = {};
// An array of video items for past videos
const vidHistory = JSON.parse(localStorage.getItem("vid-sync-history") || "[]") || [];
// The current video item being played
const videoState = {
    playing: false,
    time: 0,
    video: null,
};




function createHtmlPlayer(mount, url) {
  const media = document.createElement("video");
  media.controls = true;
  media.playsInline = true;
  media.autoplay = false;

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

// Queue entries in the order they should appear
function queuedIdVideos() {
  return Object.entries(queue).sort((a, b) => a[1].index - b[1].index);
}
function queuedVideos() {
  return queuedIdVideos().map(([id, item]) => item);
}

function dedupeQueue() {
  const seen = new Set();
  for (const [id, item] of Object.entries(queue)) {
    if (!item?.url) continue;
    if (seen.has(item.url)) delete queue[id];
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

function videoItem(id, item) {
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
  if (id) thumb.append(playButton(row, id));

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
  if (id) row.append(removeButton(row, id));
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

function removeButton(row, id) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "remove-url";
  button.draggable = false;
  button.setAttribute("aria-label", "Remove from queue");
  button.textContent = "×";
  keepClickOffDrag(row, button);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    removeFromQueue(id);
  });
  return button;
}

function playButton(row, id) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "thumb-play";
  button.draggable = false;
  button.setAttribute("aria-label", "Play video");
  keepClickOffDrag(row, button);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    playListedVideo(id);
  });
  return button;
}

function renumberQueue() {
  const items = queuedVideos();
  for (let i = 0; i < items.length; i++) items[i].index = i + 1;
}

function playListedVideo(id) {
  if(!id) return;
  if(!queue[id]) return;
  const video = queue[id];
  videoState.playing = true;
  videoState.time = unixtime() + 1;
  video.time = unixtime();
  setCurrentVideo(video);
  vidHistory.push(video);
  saveHistory();
  delete queue[id];
  renumberQueue();
  render();
  sendAll(null, "Playing new video");
}

function removeFromQueue(id) {
  if (!id) return;
  if(!queue[id]) return;
  delete queue[id];
  renumberQueue();
  render();
  sendQueue();
}


function saveHistory() {
  Rtc.getHash().then((hash) => {
    localStorage.setItem(`vid-sync-history-${hash}`, JSON.stringify(vidHistory));
  });
}

function loadHistory() {
  Rtc.getHash().then((hash) => {
    const history = localStorage.getItem(`vid-sync-history-${hash}`);
    if(history) mergeHistory(JSON.parse(history));
  });
}

async function hashHistory() {
  const json = JSON.stringify(vidHistory);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
  return bytesToHex(hash);
}

async function mergeHistory(newHistory) {

  const startHash = await hashHistory();

  // Append newHistory to vidHistory
  vidHistory.push(...newHistory);

  // Sort all items by time, descending (most recent first)
  vidHistory.sort((a, b) => b.time - a.time);

  // Dedupe by video.url and video.time (modifies vidHistory in-place)
  const seen = new Set();
  let write = 0;
  for (let read = 0; read < vidHistory.length; read++) {
    const item = vidHistory[read];
    const key = `${item.url}|${item.time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    vidHistory[write++] = item;
  }
  if (write < vidHistory.length) vidHistory.length = write;
  saveHistory();

  const endHash = await hashHistory();

  if(startHash !== endHash) {
    sendHistory();
  }
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
    const row = videoItem(item[0],item[1], removable, true);
    if (removable) row.draggable = true;
    return row;
  });
  list.replaceChildren(...rows);
}

function renderNowPlaying() {
  nowPlayingList.replaceChildren(...(videoState.video ? [videoItem(null,videoState.video)] : []));
}

function render() {
  renderNowPlaying();
  renderList(queueList, queuedIdVideos(), true);
  renderList(historyList, vidHistory.map((item) => [null,item.url]));
}

function setCurrentVideo(video) {
  videoState.video = video;
  if(!player || player.src !== videoState.video?.url) {
    player = createHtmlPlayer(stage, videoState.video?.url);
    player.onloaded = () => {
      player.setTime(0);
      player.pause();
      setTimeout(() => {
          if(videoState.playing) {
            player.setTime(unixtime() - videoState.time);
            player.play();
          } else {
            player.pause();
            player.setTime(videoState.time);
          }
      },1000);
      console.log("video loaded");
    };
    player.onPause = () => {
      videoState.time = player.getTime();
      videoState.playing = false;
      sendState(null,"Video Paused");
    };
    player.onPlay = () => {
      videoState.time =  unixtime() - player.getTime();
      videoState.playing = true;
      sendState(null,"Video Played");
    };
    player.onSetTime = (time) => {
      if(videoState.playing) {
          videoState.time =  unixtime() - time;
      } else {
          videoState.time = time;
      }
      sendState(null,"Video Time Set");
    };
  } else {

  }
}

function sendAll(peer = null, reason) {
    sendState(peer, reason);
    sendQueue(peer, reason);
    sendHistory(peer, reason);
}

function sendState(peer, reason) {
    if(reason) console.log("Sending state", reason);
    if(peer) Rtc.send(peer.id, "", "state", videoState);
    else Rtc.sendAll("","state", videoState);
    debug();
}

function sendQueue(peer) {
    if(reason) console.log("Sending queue", reason);
    if(peer) Rtc.send(peer.id, "", "queue", queue);
    else Rtc.sendAll("","queue", queue);
}

function sendHistory(peer) {
    if(reason) console.log("Sending history", reason);
    if(peer) Rtc.send(peer.id, "", "history", vidHistory);
    else Rtc.sendAll("","history", vidHistory);
}

Rtc.onMessage((message) => {
  console.log("Message:", message);
    switch (message.name) {
        case "log":
            console.log(message);
            break;
        case "connect":
            const peerLaunch = message.blob.launch || Number.MAX_VALUE;
            if (peerLaunch > launch) {
                console.log("Peer is newer, sending state");
                sendAll(message.peer);
            }
            break;
        case "state":
            console.log("GOT STATE:", message.blob);
            videoState.playing = message.blob.playing;
            videoState.time = message.blob.time;
            if(videoState.video?.url !== message.blob.video?.url) {
                setCurrentVideo(message.blob.video);
            } else {
                liveVideoUpdate();
            }
            break;
        case "queue":
            const newQueue = asQueue(message.blob);
            for (const [id, item] of Object.entries(newQueue)) {
                queue[id] = item;
            }
            for (const key of Object.keys(queue)) {
                if(!newQueue[key]) {
                    delete queue[key];
                }
            }
            render();
            break;
        case "history":
            if(!Array.isArray(message.blob)) return;
            const newHistory = message.blob;
            
            //vidHistory = message.blob;
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

Rtc.onSessionOpen(() => {
  loadHistory();
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
        }
        player.setTime(videoState.time);
    }
}

function takeNextQueuedVideo() {
  if(!player.ended) return false;
  const [id, next] = queuedIdVideos()[0];
  if(!next) return true;
  playListedVideo(id);
  return true;
}

function tick() {
  if(takeNextQueuedVideo()) return;
  liveVideoUpdate();
}

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
  render();
  sendQueue();
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
  if(!Rtc.getSession()) return;
  addForm.reset();
  clearUrlError();
  addDialog.showModal();
  urlInput.focus();
});

urlInput.addEventListener("input", clearUrlError);

function newID() {
  let id = crypto.randomUUID().slice(0, 8);
  while(queue[id]) {
    id = crypto.randomUUID().slice(0, 8);
  }
  return id;
}

function addVideoToQueue(url) {
  const items = queuedVideos();
  const last = items[items.length - 1];
  const index = last ? last.index + 1 : 1;
  const id = newID();
  queue[id] = { index, url, thumb: "", time: unixtime() };
}

function addVideosToQueue(urls) {
  for (const url of urls) {
    addVideoToQueue(url);
  }
  if(!videoState.video) {
    playListedVideo(queuedIdVideos()[0][0]);
  }
  render();
  addForm.reset();
  addDialog.close();
  queueList.lastElementChild?.scrollIntoView({ block: "nearest" });
}

addForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const urls = urlInput.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!urls.length) {
    showUrlError("Invalid URL");
    urlInput.focus();
    return;
  }
  const seen = new Set(Object.values(queue).map((item) => item.url));
  for (const url of urls) {
    if (!isUrl(url)) {
      showUrlError("Invalid URL");
      urlInput.focus();
      return;
    }
    if (seen.has(url)) {
      showUrlError("URL already in queue");
      urlInput.focus();
      return;
    }
    seen.add(url);
  }
  clearUrlError();
  addVideosToQueue(urls);
});

addDialog.querySelector(".dialog-cancel").addEventListener("click", () => {
  addDialog.close();
});
