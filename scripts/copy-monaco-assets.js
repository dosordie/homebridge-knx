'use strict';

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const source = path.join(projectRoot, 'node_modules', 'monaco-editor', 'min', 'vs');
const destination = path.join(projectRoot, 'ui', 'public', 'vendor', 'monaco', 'vs');

function removeDirectory(target) {
    if (!fs.existsSync(target)) {
        return;
    }

    if (typeof fs.rmSync === 'function') {
        fs.rmSync(target, { recursive: true, force: true });
        return;
    }

    fs.rmdirSync(target, { recursive: true });
}

function copyDirectory(sourceDirectory, destinationDirectory) {
    fs.mkdirSync(destinationDirectory, { recursive: true });

    for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
        const sourcePath = path.join(sourceDirectory, entry.name);
        const destinationPath = path.join(destinationDirectory, entry.name);

        if (entry.isDirectory()) {
            copyDirectory(sourcePath, destinationPath);
        } else if (entry.isFile()) {
            fs.copyFileSync(sourcePath, destinationPath);
        }
    }
}

function copyMonacoAssets() {
    if (!fs.existsSync(source)) {
        throw new Error(`Monaco assets were not found at ${source}. Run npm install so node_modules/monaco-editor/min/vs exists.`);
    }

    removeDirectory(destination);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    copyDirectory(source, destination);

    const loaderPath = path.join(destination, 'loader.js');
    if (!fs.existsSync(loaderPath)) {
        throw new Error(`Monaco loader was not copied to ${loaderPath}.`);
    }

    console.log(`[homebridge-knx] Copied Monaco AMD assets from ${path.relative(projectRoot, source)} to ${path.relative(projectRoot, destination)}.`);
}

try {
    copyMonacoAssets();
} catch (error) {
    console.error(`[homebridge-knx] Failed to copy Monaco assets: ${error.message}`);
    process.exitCode = 1;
}
