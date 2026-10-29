const apps = JSON.parse(document.getElementById("apps-data").textContent);

function isIpAddress(host) {
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) {
        return host.split(".").every((part) => Number(part) <= 255);
    }
    const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
    if (!bare.includes(":")) return false;
    try {
        new URL(`http://[${bare}]/`);
        return true;
    } catch {
        return false;
    }
}

function hostedLocally() {
    const host = location.hostname;
    return location.protocol === "file:"
        || host === "localhost"
        || host.endsWith(".localhost")
        || isIpAddress(host);
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

function setTopbarApp(app) {
    if (!app) {
        topbarApp.hidden = true;
        topbarAppName.textContent = "";
        topbarAppBlurb.textContent = "";
        return;
    }
    topbarAppName.textContent = app.name;
    topbarAppBlurb.textContent = app.blurb;
    topbarApp.hidden = false;
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

if ("serviceWorker" in navigator) {
    if (hostedLocally()) {
        console.log("Unregistering service worker");
        navigator.serviceWorker.getRegistrations()
            .then((registrations) => registrations.forEach((registration) => registration.unregister()))
            .catch(() => {});
    } else {
        console.log("Registering service worker");
        navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
}