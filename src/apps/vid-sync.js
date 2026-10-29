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
const stagePlay = document.getElementById("stage-play");
const stageTimeline = document.getElementById("stage-timeline");
const stageVolume = document.getElementById("stage-volume");
const stageCover = document.getElementById("stage-cover");
const stageLength = document.getElementById("stage-length");
const stageTime = document.getElementById("stage-time");
const queueList = document.getElementById("queue");
const historyList = document.getElementById("history");
const nowPlayingList = document.getElementById("now-playing");
const addButton = document.getElementById("queue-add");
const addDialog = document.getElementById("queue-add-dialog");
const addForm = document.getElementById("queue-add-form");
const urlInput = document.getElementById("queue-url");
const urlError = document.getElementById("queue-url-error");

const launch = Date.now();
// Launch times of connected peers, keyed by peer id
const peerLaunches = {};

// Video items for the current queue, keyed by video id
const queue = {};
// Video items for past videos, newest first
const vidHistory = [];
// Shared playback state. While playing, time is the unix time at which
// position 0 would have occurred. While paused, it is the position in the video.
const videoState = {
  playing: false,
  time: 0,
  video: null,
};

let player = null;
let currentUrl = null;
let playTimer = null;
let playSend = null;
let timelineSend = null;
let dragIndex = null;

function createHtmlPlayer(mount, url) {
  const media = document.createElement("video");
  media.controls = false;
  media.playsInline = true;
  media.autoplay = false;

  const empty = document.createElement("p");
  empty.className = "stage-empty";
  empty.textContent = "No video";

  function syncEmpty() {
    empty.hidden = Boolean(media.currentSrc || media.src);
  }

  let loaded = false;
  let onLoaded = null;
  let onPlay = null;
  let onPause = null;
  let onSeek = null;
  let onTimeUpdate = null;

  function asCallback(callback) {
    return typeof callback === "function" ? callback : null;
  }

  media.addEventListener("loadstart", syncEmpty);
  media.addEventListener("emptied", syncEmpty);
  media.addEventListener("loadeddata", () => {
    loaded = true;
    onLoaded?.();
  });
  media.addEventListener("play", () => {
    onPlay?.();
  });
  media.addEventListener("pause", () => {
    if (media.ended) return;
    onPause?.();
  });
  media.addEventListener("seeked", () => {
    onSeek?.(media.currentTime);
  });
  media.addEventListener("timeupdate", () => {
    onTimeUpdate?.(media.currentTime);
  });
  if (url) media.src = url;
  mount.replaceChildren(media, empty);
  syncEmpty();

  return {
    // True if there is a video and it has ended
    get ended() {
      return Boolean(media.src) && media.ended;
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
    set onLoaded(callback) {
      onLoaded = asCallback(callback);
      if (loaded && onLoaded) queueMicrotask(() => onLoaded?.());
    },
    // Called when playback starts
    set onPlay(callback) {
      onPlay = asCallback(callback);
    },
    // Called when playback pauses, but not when the video ends
    set onPause(callback) {
      onPause = asCallback(callback);
    },
    // Called with the new time after a seek
    set onSeek(callback) {
      onSeek = asCallback(callback);
    },
    // Called with the current time as playback advances
    set onTimeUpdate(callback) {
      onTimeUpdate = asCallback(callback);
    },
    setVolume(volume) {
      media.volume = volume;
    },
    play() {
      if (!media.paused) return;
      return media.play().catch((error) => console.warn("Playback failed:", error));
    },
    pause() {
      if (media.paused) return;
      media.pause();
    },
    setTime(time) {
      media.currentTime = time;
    },
    getTime() {
      return media.currentTime;
    },
    getLength() {
      return media.duration;
    },
  };
}

function unixtime() {
  return Date.now() / 1000;
}

function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const secs = String(total % 60).padStart(2, "0");
  return `${String(minutes).padStart(2, "0")}:${secs}`;
}

function storedVolume() {
  const volume = Number(localStorage.getItem("vid-sync-volume") ?? 1);
  return Number.isFinite(volume) ? Math.min(Math.max(volume, 0), 1) : 1;
}

// Queue

function asQueue(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return {};
}

// Queue entries in the order they should appear
function queuedIdVideos() {
  return Object.entries(queue).sort((a, b) => a[1].index - b[1].index);
}

function queuedVideos() {
  return queuedIdVideos().map(([, item]) => item);
}

function hasQueuedVideos() {
  return Object.keys(queue).length > 0;
}

function renumberQueue() {
  const items = queuedVideos();
  for (let i = 0; i < items.length; i++) items[i].index = i + 1;
}

function replaceQueue(newQueue) {
  for (const id of Object.keys(queue)) {
    if (!newQueue[id]) delete queue[id];
  }
  Object.assign(queue, newQueue);
}

function newID() {
  let id = crypto.randomUUID().slice(0, 8);
  while (queue[id]) id = crypto.randomUUID().slice(0, 8);
  return id;
}

function addVideoToQueue(url) {
  const items = queuedVideos();
  const last = items[items.length - 1];
  const index = last ? last.index + 1 : 1;
  queue[newID()] = { index, url, thumb: "", time: unixtime() };
}

function addVideosToQueue(urls) {
  for (const url of urls) addVideoToQueue(url);
  if (!videoState.video) {
    playListedVideo(queuedIdVideos()[0][0]);
  } else {
    render();
    sendQueue(null, "Videos added");
  }
  addForm.reset();
  addDialog.close();
  queueList.lastElementChild?.scrollIntoView({ block: "nearest" });
}

function playListedVideo(id) {
  const video = queue[id];
  if (!video) return;
  delete queue[id];
  renumberQueue();
  video.time = unixtime();
  videoState.playing = true;
  videoState.time = unixtime();
  vidHistory.unshift({ ...video });
  saveHistory();
  setCurrentVideo(video);
  render();
  sendAll(null, "Playing new video");
}

function removeFromQueue(id) {
  if (!queue[id]) return;
  delete queue[id];
  renumberQueue();
  render();
  sendQueue(null, "Video removed");
}

function reorderQueue(from, to) {
  if (to > from) to -= 1;
  if (from === to) return;
  const items = queuedVideos();
  const [item] = items.splice(from, 1);
  items.splice(to, 0, item);
  for (let i = 0; i < items.length; i++) items[i].index = i + 1;
  render();
  sendQueue(null, "Queue reordered");
}

// History

function historyKey(item) {
  return `${item.url}|${item.time}`;
}

// Adds unseen items to the history, returns true if anything was added
function mergeHistory(items) {
  const seen = new Set(vidHistory.map(historyKey));
  let added = false;
  for (const item of items) {
    if (!item?.url) continue;
    const key = historyKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    vidHistory.push(item);
    added = true;
  }
  if (added) vidHistory.sort((a, b) => b.time - a.time);
  return added;
}

function saveHistory() {
  Rtc.getHash()
    .then((hash) => localStorage.setItem(`vid-sync-history-${hash}`, JSON.stringify(vidHistory)))
    .catch((error) => console.warn("Could not save history:", error));
}

function loadHistory() {
  Rtc.getHash()
    .then((hash) => {
      const stored = JSON.parse(localStorage.getItem(`vid-sync-history-${hash}`) || "[]");
      if (Array.isArray(stored) && mergeHistory(stored)) {
        render();
        sendHistory(null, "History loaded");
      }
      saveHistory();
    })
    .catch((error) => console.warn("Could not load history:", error));
}

// Playback

function setCurrentVideo(video) {
  videoState.video = video;
  renderNowPlaying();
  const url = video?.url ?? null;
  if (player && url === currentUrl) {
    liveVideoUpdate();
    return;
  }
  currentUrl = url;
  const current = createHtmlPlayer(stage, url);
  player = current;
  current.setVolume(storedVolume());
  stageTimeline.value = 0;
  stageLength.textContent = "00:00";
  current.onLoaded = () => {
    if (player !== current) return;
    stageLength.textContent = formatClock(current.getLength());
    liveVideoUpdate();
  };
  current.onTimeUpdate = (time) => {
    if (player !== current) return;
    const length = current.getLength();
    if (!Number.isFinite(length) || length <= 0) return;
    stageLength.textContent = formatClock(length);
    stageTime.textContent = formatClock(time);
    stageTimeline.value = (time / length) * 100;
  };
}

function liveVideoUpdate() {
  if (!player?.src) return;
  if (videoState.playing) {
    const target = unixtime() - videoState.time;
    const length = player.getLength();
    if (Number.isFinite(length) && target >= length) return;
    if (Math.abs(target - player.getTime()) > 5) player.setTime(Math.max(0, target));
    player.play();
  } else {
    player.pause();
    if (Math.abs(videoState.time - player.getTime()) > 0.25) player.setTime(videoState.time);
  }
}

function togglePlay() {
  if (!player?.src) return;
  if (player.ended) {
    videoState.playing = true;
    videoState.time = unixtime();
  } else if (videoState.playing) {
    videoState.playing = false;
    videoState.time = player.getTime();
  } else {
    videoState.playing = true;
    videoState.time = unixtime() - videoState.time;
  }
  liveVideoUpdate();
  clearTimeout(playSend);
  playSend = setTimeout(() => sendState(null, videoState.playing ? "Video played" : "Video paused"), 250);
}

function isOldestPeer() {
  return Object.values(peerLaunches).every((peerLaunch) => peerLaunch >= launch);
}

// Only the oldest client advances the queue, unless it has clearly failed to
function takeNextQueuedVideo() {
  if (!player?.ended || !hasQueuedVideos()) return false;
  const overdue = videoState.playing && unixtime() - videoState.time > player.getLength() + 15;
  if (!isOldestPeer() && !overdue) return false;
  playListedVideo(queuedIdVideos()[0][0]);
  return true;
}

function tick() {
  if (takeNextQueuedVideo()) return;
  liveVideoUpdate();
}

stagePlay.addEventListener("click", togglePlay);
stageCover.addEventListener("click", togglePlay);

stageTimeline.addEventListener("input", () => {
  if (!player?.src) return;
  const length = player.getLength();
  if (!Number.isFinite(length)) return;
  const position = (stageTimeline.value / 100) * length;
  videoState.time = videoState.playing ? unixtime() - position : position;
  player.setTime(position);
  liveVideoUpdate();
  let send = false;
  if(!timelineSend) {
    sendState(null, "Video time set");
  } else {
    send = true;
  }
  clearTimeout(timelineSend);
  timelineSend = setTimeout(() => {
    if(send) sendState(null, "Video time set");
    timelineSend = null;
  }, 1000);
});

stageVolume.addEventListener("input", () => {
  localStorage.setItem("vid-sync-volume", stageVolume.value);
  player?.setVolume(storedVolume());
});

// Rendering

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
  body.append(url);

  if (id && Number.isInteger(item.index)) {
    const index = document.createElement("span");
    index.className = "item-index";
    index.textContent = String(item.index);
    body.append(index);
  }

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

function renderList(list, entries, draggable = false) {
  const rows = entries.map(([id, item]) => {
    const row = videoItem(id, item);
    if (draggable) row.draggable = true;
    return row;
  });
  list.replaceChildren(...rows);
}

function renderNowPlaying() {
  nowPlayingList.replaceChildren(...(videoState.video ? [videoItem(null, videoState.video)] : []));
}

function render() {
  renderNowPlaying();
  renderList(queueList, queuedIdVideos(), true);
  renderList(historyList, vidHistory.map((item) => [null, item]));
}

// Messaging

function send(peer, name, blob, reason) {
  if (!Rtc.getSession()) return;
  if (reason) console.log(`Sending ${name}:`, reason);
  try {
    if (peer) Rtc.send(peer.id, "", name, blob);
    else Rtc.sendAll("", name, blob);
  } catch (error) {
    console.warn(`Could not send ${name}:`, error);
  }
}

function sendState(peer, reason) {
  send(peer, "state", videoState, reason);
}

function sendQueue(peer, reason) {
  send(peer, "queue", queue, reason);
}

function sendHistory(peer, reason) {
  send(peer, "history", vidHistory, reason);
}

function sendAll(peer, reason) {
  sendState(peer, reason);
  sendQueue(peer, reason);
  sendHistory(peer, reason);
}

function receiveConnect(peer, blob) {
  const peerLaunch = Number(blob?.launch) || Number.MAX_VALUE;
  peerLaunches[peer.id] = peerLaunch;
  if (peerLaunch > launch) sendAll(peer, "Peer is newer");
}

function receiveState(state) {
  if (!state || typeof state !== "object") return;
  videoState.playing = Boolean(state.playing);
  videoState.time = Number(state.time) || 0;
  setCurrentVideo(state.video ?? null);
}

function receiveQueue(blob) {
  replaceQueue(asQueue(blob));
  render();
}

function receiveHistory(peer, items) {
  if (!Array.isArray(items)) return;
  if (mergeHistory(items)) {
    saveHistory();
    render();
  }
  if (vidHistory.length > items.length) sendHistory(peer, "Peer is missing history");
}

Rtc.onMessage((message) => {
  switch (message.name) {
    case "connect":
      receiveConnect(message.peer, message.blob);
      break;
    case "state":
      receiveState(message.blob);
      break;
    case "queue":
      receiveQueue(message.blob);
      break;
    case "history":
      receiveHistory(message.peer, message.blob);
      break;
  }
});

Rtc.onPeerConnect((peer) => {
  send(peer, "connect", { launch });
});

Rtc.onPeerDisconnect((peer) => {
  delete peerLaunches[peer.id];
});

Rtc.onSessionOpen(() => {
  clearInterval(playTimer);
  playTimer = setInterval(tick, 5000);
  vidHistory.length = 0;
  render();
  loadHistory();
});

Rtc.onSessionClose(() => {
  clearInterval(playTimer);
  playTimer = null;
  for (const id of Object.keys(peerLaunches)) delete peerLaunches[id];
});

// Queue drag and drop

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

// Tabs

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

// Add dialog

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
  urlInput.focus();
}

function clearUrlError() {
  urlError.hidden = true;
  urlInput.removeAttribute("aria-invalid");
}

addButton.addEventListener("click", () => {
  if (!Rtc.getSession()) return;
  addForm.reset();
  clearUrlError();
  addDialog.showModal();
  urlInput.focus();
});

urlInput.addEventListener("input", clearUrlError);

addForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const urls = urlInput.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!urls.length) return showUrlError("Invalid URL");
  const seen = new Set(Object.values(queue).map((item) => item.url));
  for (const url of urls) {
    if (!isUrl(url)) return showUrlError("Invalid URL");
    if (seen.has(url)) return showUrlError("URL already in queue");
    seen.add(url);
  }
  clearUrlError();
  addVideosToQueue(urls);
});

addDialog.querySelector(".dialog-cancel").addEventListener("click", () => {
  addDialog.close();
});

stageVolume.value = storedVolume();
setCurrentVideo(videoState.video);
render();
