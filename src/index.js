const apps = JSON.parse(document.getElementById("apps-data").textContent);

function hostedLocally() {
    const host = location.hostname;
    return location.protocol === "file:"
        || host === "localhost"
        || host === "127.0.0.1"
        || host === "[::1]"
        || host.endsWith(".localhost");
}

function isListed(app) {
    return Boolean(app) && (!app.debug || hostedLocally());
}

const listedApps = apps.filter(isListed);

function appItem(app) {
    const li = document.createElement("li");
    li.dataset.id = app.id;
    const a = document.createElement("a");
    a.href = app.href;
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = app.name;
    const blurb = document.createElement("span");
    blurb.className = "blurb";
    blurb.textContent = app.blurb;
    a.append(name, blurb);
    li.append(a);
    return li;
}

function fillList(el) {
    const groups = new Map();
    for (const app of listedApps) {
        const cat = app.category || "apps";
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat).push(app);
    }
    const cats = groups.keys();
    el.replaceChildren(...cats.map((cat) => {
        const section = document.createElement("section");
        section.className = "app-section";
        const heading = document.createElement("h2");
        heading.textContent = cat;
        const list = document.createElement("ul");
        list.className = "apps";
        list.append(...groups.get(cat).map(appItem));
        section.append(heading, list);
        return section;
    }));
}

fillList(document.getElementById("sidebar-apps"));
fillList(document.getElementById("home-apps"));

const burger = document.querySelector(".burger");
const scrim = document.querySelector(".scrim");
const sidebar = document.getElementById("sidebar");

function setMenu(open) {
    document.body.classList.toggle("menu-open", open);
    burger.setAttribute("aria-expanded", String(open));
    burger.setAttribute("aria-label", open ? "Close app menu" : "Open app menu");
    sidebar.setAttribute("aria-hidden", String(!open));
    scrim.hidden = !open;
}

burger.addEventListener("click", (e) => {
    e.stopPropagation();
    setMenu(!document.body.classList.contains("menu-open"));
});
sidebar.addEventListener("mouseleave", () => setMenu(false));
scrim.addEventListener("click", () => setMenu(false));
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setMenu(false);
});

const page = document.querySelector(".page");
const frame = document.querySelector(".app-frame");
const topbarApp = document.querySelector(".topbar-app");
const topbarAppName = document.querySelector(".topbar-app-name");
const topbarAppBlurb = document.querySelector(".topbar-app-blurb");
const topbarActions = document.querySelector(".topbar-actions");
const topbarOpen = document.querySelector(".topbar-open");
const topbarDownload = document.querySelector(".topbar-download");

function setTopbarApp(app) {
    if (!app) {
        topbarApp.hidden = true;
        topbarActions.hidden = true;
        topbarOpen.removeAttribute("href");
        topbarAppName.textContent = "";
        topbarAppBlurb.textContent = "";
        document.body.classList.remove("app-open");
        return;
    }
    topbarAppName.textContent = app.name;
    topbarAppBlurb.textContent = app.blurb;
    topbarOpen.href = app.href;
    topbarApp.hidden = false;
    topbarActions.hidden = false;
    document.body.classList.add("app-open");
}

function hashId() {
    return decodeURIComponent(location.hash.replace(/^#/, "")).split("&");
}

function setAppID(id) {
    const parts = hashId();
    parts[0] = id;
    location.hash = parts.join("&");
}

function appById(id) {
    return apps.find((app) => app.id === id);
}

function closeApp() {
    page.classList.remove("app-open");
    frame.hidden = true;
    frame.removeAttribute("src");
    delete frame.dataset.appId;
    setTopbarApp(null);
}

function openApp(app, { updateHash = true } = {}) {
    if (!isListed(app)) return;
    frame.hidden = false;
    if (frame.dataset.appId !== app.id) {
        const parts = hashId();
        parts.shift();
        frame.src = app.href + (parts.length ? `#${parts.join("&")}` : "");
        frame.dataset.appId = app.id;
    }
    page.classList.add("app-open");
    setTopbarApp(app);
    setMenu(false);
    if (updateHash && hashId() !== app.id) {
        setAppID(app.id);
    }
}

function restoreFromHash() {
    const app = appById(hashId()[0] || null);
    if (isListed(app)) openApp(app, { updateHash: false });
    else closeApp();
}

document.querySelectorAll("#sidebar-apps a[href], #home-apps a[href]").forEach((link) => {
    link.addEventListener("click", (e) => {
        e.preventDefault();
        openApp(appById(link.closest("li")?.dataset.id));
    });
});

document.querySelector(".sidebar-home").addEventListener("click", (e) => {
    e.preventDefault();
    setMenu(false);
    if (hashId()) location.hash = "";
    else closeApp();
});

window.addEventListener("hashchange", restoreFromHash);
restoreFromHash();

topbarDownload.addEventListener("click", async () => {
    const app = appById(hashId()) || appById(frame.dataset.appId);
    if (!app) return;
    const res = await fetch(app.href);
    if (!res.ok) return;
    const blob = new Blob([await res.text()], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = app.href.split("/").pop() || `${app.id}.html`;
    a.click();
    URL.revokeObjectURL(url);
});