const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SRC_DIR = path.join(__dirname, 'src');
const BUILD_DIR = path.join(__dirname, 'build');
const SW_PATH = "sw.js";
const MANIFEST_PATH = "manifest.webmanifest";
// Copied to the build as real files: manifest and apple-touch icons can't rely on data URIs.
const STATIC_DIRS = ["assets/icons/"];
const ROOT_FILES = ["LICENSE"];

// Empty the build directory before continuing
if (fs.existsSync(BUILD_DIR)) {
    for (const file of fs.readdirSync(BUILD_DIR)) {
        const filePath = path.join(BUILD_DIR, file);
        if (fs.lstatSync(filePath).isDirectory()) {
            // Recursively remove directories
            fs.rmSync(filePath, { recursive: true, force: true });
        } else {
            fs.unlinkSync(filePath);
        }
    }
} else {
    fs.mkdirSync(BUILD_DIR, { recursive: true });
}


function loadDirRecursive(srcDir, loaded) {
    loaded = loaded || {};
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name);
        if (entry.isDirectory()) {
            loadDirRecursive(srcPath, loaded);
        } else if (entry.isFile()) {
            const data = fs.readFileSync(srcPath);
            // const textContent = data.toString('utf8');
            // Remove SRC_DIR from the start of srcPath to make it relative
            const relativePath = path.relative(SRC_DIR, srcPath);    
            loaded[relativePath] = data;
        }
    }
    return loaded;
}

const loaded = loadDirRecursive(SRC_DIR);

const assets = {
    "html": {},
    "css": {},
    "js": {},
    "svg": {},
    "opus": {},
    "png": {},
};

function getContentType(type) {
    switch (type) {
        case "css":
            return "text/css;charset=utf-8";
        case "js":
            return "application/javascript;charset=utf-8";
        case "svg":
            return "image/svg+xml;charset=utf-8";
        case "opus":
            return "audio/opus;charset=utf-8";
        case "png":
            return "image/png";
        default:
            throw new Error(`Unknown asset type: ${type}`);
    }
}

function base64Asset(asset,type) {
    const contentType = getContentType(type);
    return `data:${contentType};base64,${asset.toString('base64')}`;
}

let serviceWorker = null;
let manifest = null;
const staticFiles = {};

for (const filePath of Object.keys(loaded)) {
    const fileEnding = filePath.split('.').pop();
    const content = loaded[filePath];
    if (filePath === SW_PATH) {
        serviceWorker = content.toString('utf8');
        continue;
    }
    if (filePath === MANIFEST_PATH) {
        manifest = content.toString('utf8');
        continue;
    }
    if (STATIC_DIRS.some((dir) => filePath.startsWith(dir))) {
        staticFiles[filePath] = content;
        continue;
    }
    switch (fileEnding) {
        case "html":
        case "css":
            assets[fileEnding][filePath] = content.toString('utf8');
            break;
        default:
            assets[fileEnding][filePath] = base64Asset(content, fileEnding);
            break;
    }
}

if (serviceWorker === null) throw new Error(`Missing src/${SW_PATH}`);
if (manifest === null) throw new Error(`Missing src/${MANIFEST_PATH}`);

function replaceJS(html, js) {
    for (const jsPath of Object.keys(js)) {
        const jsContent = js[jsPath];
        html = html.replace(`/${jsPath}`, jsContent);
    }
    return html;
}

function replaceCSS(html, css) {
    for (const cssPath of Object.keys(css)) {
        const cssContent = css[cssPath];
        html = html.replace(`/${cssPath}`, cssContent);
    }
    return html;
}

function replaceSVG(html, svg) {
    for (const svgPath of Object.keys(svg)) {
        const svgContent = svg[svgPath];
        html = html.replace(`/${svgPath}`, svgContent);
    }
    return html;
}

function replaceOpus(html, opus) {
    for (const opusPath of Object.keys(opus)) {
        const opusContent = opus[opusPath];
        html = html.replace(`/${opusPath}`, opusContent);
    }
    return html;
}

function replacePNG(html, png) {
    for (const pngPath of Object.keys(png)) {
        const pngContent = png[pngPath];
        html = html.replace(`/${pngPath}`, pngContent);
    }
    return html;
}

function replaceAssets(html, assets) {
    for (const asset of Object.keys(assets)) {
        switch (asset) {
            case "html":
                break;
            case "js":
                html = replaceJS(html, assets[asset]);
                break;
            case "css":
                html = replaceCSS(html, assets[asset]);
                break;
            case "svg":
                html = replaceSVG(html, assets[asset]);
                break;
            case "opus":
                html = replaceOpus(html, assets[asset]);
                break;
            case "png":
                html = replacePNG(html, assets[asset]);
                break;
            default:
                throw new Error(`Unknown asset type: ${asset}\n ${JSON.stringify(Object.keys(assets[asset]))}`);
        }
    }
    return html;
}

for (const cssPath of Object.keys(assets["css"])) {
    let cssContent = replaceAssets(assets["css"][cssPath], assets);
    const buf = Buffer.from(cssContent, "utf8");
    assets["css"][cssPath] = base64Asset(buf, "css");
}

const outputFiles = {};

function writeOutput(itemPath, content) {
    const outputPath = path.join(BUILD_DIR, itemPath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, content);
    outputFiles[itemPath] = content;
    console.log(`Outputted ${itemPath} to ${outputPath}`);
}

function prepareHtml(html, assets) {
    html = replaceAssets(html, assets);
    html = html.replace('<!--link rel="manifest" href="/manifest.webmanifest" /-->', '<link rel="manifest" href="/manifest.webmanifest" />');
    return html;
}

for (const htmlPath of Object.keys(assets["html"])) {
    writeOutput(htmlPath, prepareHtml(assets["html"][htmlPath], assets));
}

writeOutput(MANIFEST_PATH, replaceAssets(manifest, assets));

for (const staticPath of Object.keys(staticFiles)) {
    writeOutput(staticPath, staticFiles[staticPath]);
}

for (const rootFile of ROOT_FILES) {
    writeOutput(rootFile, fs.readFileSync(path.join(__dirname, rootFile)));
}

function debugAppPaths(indexHtml) {
    const match = indexHtml.match(/<script type="application\/json" id="apps-data">([\s\S]*?)<\/script>/);
    if (!match) throw new Error("apps-data script not found in src/index.html");
    return new Set(JSON.parse(match[1]).filter((app) => app.debug).map((app) => app.href));
}

const debugPaths = debugAppPaths(assets["html"]["index.html"]);
const cachePaths = Object.keys(outputFiles)
    .filter((itemPath) => !debugPaths.has(itemPath))
    .map((itemPath) => `/${itemPath}`)
    .sort();

const hash = crypto.createHash('sha256');
for (const itemPath of Object.keys(outputFiles).sort()) {
    hash.update(itemPath);
    hash.update("\0");
    hash.update(outputFiles[itemPath]);
    hash.update("\0");
}
const version = hash.digest('hex').slice(0, 12);

function replaceInServiceWorker(source, pattern, replacement, label) {
    if (!pattern.test(source)) throw new Error(`${label} not found in src/${SW_PATH}`);
    return source.replace(pattern, () => replacement);
}

serviceWorker = replaceInServiceWorker(serviceWorker, /^const CACHE = .*;$/m, `const CACHE = "spas-${version}";`, "CACHE declaration");
serviceWorker = replaceInServiceWorker(serviceWorker, /\/\/ CACHE_START[\s\S]*?\/\/ CACHE_END/, `const PRECACHE = ${JSON.stringify(cachePaths, null, 2)};`, "CACHE_START/CACHE_END markers");

fs.writeFileSync(path.join(BUILD_DIR, SW_PATH), serviceWorker);
console.log(`Outputted ${SW_PATH} (cache spas-${version}, ${cachePaths.length} precached)`);