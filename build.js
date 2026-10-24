const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'src');
const BUILD_DIR = path.join(__dirname, 'build');

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
        default:
            throw new Error(`Unknown asset type: ${type}`);
    }
}

function base64Asset(asset,type) {
    const contentType = getContentType(type);
    return `data:${contentType};base64,${asset.toString('base64')}`;
}

for (const path of Object.keys(loaded)) {
    const fileEnding = path.split('.').pop();
    const content = loaded[path];
    switch (fileEnding) {
        case "html":
        case "css":
            assets[fileEnding][path] = content.toString('utf8');
            break;
        default:
            assets[fileEnding][path] = base64Asset(content, fileEnding);
            break;
    }
}

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

function outputHTML(itemPath, html, assets) {
    html = replaceAssets(html, assets);
    const outputPath = path.join(BUILD_DIR, itemPath);
    // Ensure that output directories exist
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, html);
    console.log(`Outputted ${itemPath} to ${outputPath}`);
}

for (const path of Object.keys(assets["html"])) {
    outputHTML(path, assets["html"][path], assets);
}
