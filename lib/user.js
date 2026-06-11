/* jshint esversion: 6, strict: true, node: true */
'use strict';
/*
 *  proudly copied from nfarina's homebridge
 *  all mistakes are later added by me.
 */
//const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const path = require('node:path')



module.exports = {
    User: User
};


/**
 * Manages user settings and storage locations.
 */

// global cached config
var config;

// optional custom storage path
var customStoragePath;

function looksLikeYAML(filename) {
    console.debug("checking filename: " + filename)
    return (filename.endsWith(".yml") || filename.endsWith(".yaml"))
}

function getAllFiles(dir, allFilesList = []) {
    const files = fs.readdirSync(dir);
    files.map(file => {
        const name = dir + '/' + file;
        if (fs.statSync(name).isDirectory()) { // check if subdirectory is present
            getAllFiles(name, allFilesList);     // do recursive execution for subdirectory
        } else {
            allFilesList.push(name);           // push filename into the array
        }
    })

    return allFilesList;
}
function export_config(data, filepath) {
    console.debug("exporting: " + data)
    if (looksLikeYAML(filepath)) {
        fs.writeFileSync(filepath, yaml.dump(data))
    } else {
        // export as JSON
        fs.writeFileSync(filepath, JSON.stringify(data, null, 4));
    }
}

function asArray(value) {
    if (value == undefined) {
        return []
    }
    return Array.isArray(value) ? value : [value]
}

function shouldWriteFile(filepath, targetFiles) {
    if (targetFiles.length === 0) {
        return true
    }
    return targetFiles.indexOf(filepath) >= 0
}

function getGeneratedConfigFields(configEntry) {
    return configEntry && configEntry._knxGeneratedConfigFields ? configEntry._knxGeneratedConfigFields : []
}

function getLineIndent(line) {
    return line.search(/\S|$/)
}

function getYamlScalarValue(line, key) {
    let match = line.match(new RegExp('^\\s*(?:-\\s*)?' + key + '\\s*:\\s*(.*?)\\s*(?:#.*)?$'))
    if (!match) {
        return undefined
    }
    let value = match[1]
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.substring(1, value.length - 1)
    }
    return value
}

function yamlScalarValueMatches(line, key, expectedValue) {
    return getYamlScalarValue(line, key) === expectedValue
}

function findYamlListItemStart(lines, keyLineIndex) {
    let keyIndent = getLineIndent(lines[keyLineIndex])
    for (let index = keyLineIndex; index >= 0; index--) {
        let line = lines[index]
        let indent = getLineIndent(line)
        if (indent < keyIndent && line.trim().startsWith('-')) {
            return index
        }
    }
    return keyLineIndex
}

function findYamlBlockEnd(lines, blockStart, blockIndent) {
    for (let index = blockStart + 1; index < lines.length; index++) {
        let line = lines[index]
        if (line.trim() === '') {
            continue
        }
        let indent = getLineIndent(line)
        if (indent <= blockIndent && (line.trim().startsWith('-') || /^[^\s].*:\s*/.test(line))) {
            return index
        }
    }
    return lines.length
}

function yamlBlockHasField(lines, blockStart, blockEnd, blockIndent, keyIndent, key) {
    for (let index = blockStart + 1; index < blockEnd; index++) {
        let line = lines[index]
        if (line.trim() === '') {
            continue
        }
        let indent = getLineIndent(line)
        if (indent > blockIndent && indent <= keyIndent && line.trim().startsWith(key + ':')) {
            return true
        }
    }
    return false
}

function getYamlChildIndent(line) {
    let indent = line.substring(0, getLineIndent(line))
    if (line.trim().startsWith('-')) {
        return indent + '  '
    }
    return indent
}

function insertYamlFieldAfter(lines, anchorIndex, key, value) {
    lines.splice(anchorIndex + 1, 0, getYamlChildIndent(lines[anchorIndex]) + key + ': ' + value)
}

function patchDeviceGeneratedFields(lines, device) {
    let changed = false
    for (let index = 0; index < lines.length; index++) {
        if (!yamlScalarValueMatches(lines[index], 'DeviceName', device.DeviceName)) {
            continue
        }

        let deviceStart = findYamlListItemStart(lines, index)
        let deviceIndent = getLineIndent(lines[deviceStart])
        let deviceEnd = findYamlBlockEnd(lines, deviceStart, deviceIndent)
        let deviceNameIndent = getYamlChildIndent(lines[index]).length

        if (getGeneratedConfigFields(device).indexOf('UUID') >= 0 && !yamlBlockHasField(lines, deviceStart, deviceEnd, deviceIndent, deviceNameIndent, 'UUID')) {
            insertYamlFieldAfter(lines, index, 'UUID', device.UUID)
            changed = true
            deviceEnd++
        }

        if (device.Services) {
            device.Services.forEach(service => {
                if (getGeneratedConfigFields(service).indexOf('subtype') < 0) {
                    return
                }
                for (let serviceIndex = deviceStart + 1; serviceIndex < deviceEnd; serviceIndex++) {
                    if (!yamlScalarValueMatches(lines[serviceIndex], 'ServiceName', service.ServiceName)) {
                        continue
                    }
                    let serviceStart = findYamlListItemStart(lines, serviceIndex)
                    let serviceIndent = getLineIndent(lines[serviceStart])
                    let serviceEnd = findYamlBlockEnd(lines, serviceStart, serviceIndent)
                    let serviceNameIndent = getYamlChildIndent(lines[serviceIndex]).length
                    if (!yamlBlockHasField(lines, serviceStart, serviceEnd, serviceIndent, serviceNameIndent, 'subtype')) {
                        insertYamlFieldAfter(lines, serviceIndex, 'subtype', service.subtype)
                        changed = true
                        deviceEnd++
                    }
                    break
                }
            })
        }
        break
    }
    return changed
}

function storeGeneratedDirectoryConfig(config) {
    if (!config.Devices) {
        return
    }

    let devicesByFile = {}
    config.Devices.forEach(device => {
        if (!device.sourcefilename) {
            return
        }
        let hasGeneratedDeviceFields = getGeneratedConfigFields(device).length > 0
        let hasGeneratedServiceFields = device.Services && device.Services.some(service => getGeneratedConfigFields(service).length > 0)
        if (!hasGeneratedDeviceFields && !hasGeneratedServiceFields) {
            return
        }
        if (!devicesByFile[device.sourcefilename]) {
            devicesByFile[device.sourcefilename] = []
        }
        devicesByFile[device.sourcefilename].push(device)
    })

    Object.getOwnPropertyNames(devicesByFile).forEach(filename => {
        let originalContent = fs.readFileSync(filename, 'utf8')
        let newline = originalContent.indexOf('\r\n') >= 0 ? '\r\n' : '\n'
        let hasFinalNewline = originalContent.endsWith('\n')
        let lines = originalContent.split(/\r?\n/)
        if (hasFinalNewline) {
            lines.pop()
        }
        let changed = false
        devicesByFile[filename].forEach(device => {
            changed = patchDeviceGeneratedFields(lines, device) || changed
        })
        if (changed) {
            fs.writeFileSync(filename, lines.join(newline) + (hasFinalNewline ? newline : ''))
        }
    })
}
function User() {
}

User.config = function (platformconfig = undefined) {
    return config || (config = this.loadConfig(platformconfig));
};

User.storagePath = function (platformconfig = undefined) {
    if (customStoragePath) {
        return customStoragePath;
    }
    var home = process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE;
    return path.join(home, ".homebridge");
};

User.configPath = function (platformconfig = undefined) {
    //console.log("platformconfig=")
    //console.log(platformconfig)
    if (platformconfig && platformconfig.config_path) {
        console.log("platformconfig.config_path")
        console.log(platformconfig.config_path)
        if (fs.existsSync(platformconfig.config_path)) {
            return platformconfig.config_path
        }
    }
    return path.join(User.storagePath(), "knx_config.json");
};

User.persistPath = function () {
    return path.join(User.storagePath(), "knx_persist");
};

User.addinsPath = function () {
    return path.join(User.storagePath(), "knx_addins");
}

User.setStoragePath = function (path) {
    customStoragePath = path;
};

User.loadConfig = function (platformconfig = undefined) {

    // Look for the configuration file
    var configPath = User.configPath(platformconfig);
    //let config = {}
    // Complain and exit if it doesn't exist yet
    if (!fs.existsSync(configPath)) {
        console.log("Couldn't find file at '" + configPath + ".");
        process.exit(1);
    }

    // Load up the configuration file(s)

    let stats = fs.lstatSync(configPath)
    if (stats.isFile()) {
        // single file, return directly
        try {
            config = JSON.parse(fs.readFileSync(configPath));
        } catch (err) {
            console.log("There was a problem reading your " + configPath + " file.");
            console.log("Please try pasting your file here to validate it: http://jsonlint.com");
            console.log("");
            throw err;
        }
        return config
    } else if (stats.isDirectory()) {
        // load multiple files and merge them
        let fileslist = getAllFiles(configPath)

        let devices = []
        for (var int = 0; int < fileslist.length; int++) {
            // @type String
            let currfile = fileslist[int];
            console.debug("Reading from config: " + (int + 1) + " of " + fileslist.length + ", file " + currfile);
            if (currfile.endsWith(".json") || looksLikeYAML(currfile)) {
                //console.debug("extension fits");
                let readContent = yaml.load(fs.readFileSync(currfile))
                //console.debug(JSON.stringify(readContent, null, 4))
                if ("Devices" in readContent) {
                    for (let idev = 0; idev < readContent.Devices.length; idev++) {
                        // add the current path name to each of the devices
                        readContent.Devices[idev].sourcefilename = currfile
                        devices.push(readContent.Devices[idev])
                        console.debug("Pushing: " + devices[devices.length - 1].sourcefilename + " ?== " + currfile)
                    }
                    //console.debug("Devices " + readContent.Devices.length)
                    //devices.concat(readContent.Devices)
                    delete readContent.Devices
                    //console.log("Devices: " + devices.length)
                }
                if ("GroupAddresses" in readContent) {
                    delete readContent.GroupAddresses // legacy never used, delete it.
                }
                if (Object.getOwnPropertyNames(readContent).length > 0) {
                    // still properties there
                    //console.debug("settings are in " + currfile)
                    readContent.sourcefilename = currfile
                }
                if (config == undefined) {
                    config = readContent
                    //console.debug("config is undefined")
                }
                if (readContent != undefined) {
                    //console.log("file content is defined")
                    //console.log("Devices: " + devices.length)
                    Object.assign(config, readContent)
                }
            }
        }
        config.Devices = devices
    }


    console.log("---");

    return config;
};




User.storeConfig = function (platformconfig = undefined, options = {}) {
    // Look for the configuration file
    var configPath = User.configPath(platformconfig);

    // Complain and exit if it doesn't exist yet
    if (!fs.existsSync(configPath)) {
        console.log("Couldn't find file at '" + configPath + ".");
        process.exit(1);
    }

    // write the configuration file
    let stats = fs.lstatSync(configPath)
    if (stats.isFile()) {
        try {
            export_config(config, configPath);
        } catch (err) {
            console.log("ERROR: There was a problem writing your " + configPath + " file.");
            console.log("");
            throw err;
        }
        return
    } else if (stats.isDirectory()) {
        // Directory based YAML/JSON configs are assembled from their source files during
        // loadConfig(). js-yaml does not preserve comments, so rewriting all source files
        // after a normal Homebridge startup would silently strip users' YAML comments.
        // Keep directory writes opt-in and, where possible, targeted to specific files.
        if (!options.writeDirectoryConfig) {
            storeGeneratedDirectoryConfig(config)
            console.debug("Skipped full directory config rewrite. Only generated UUID/subtype values were patched if needed.")
            return
        }

        let targetFiles = asArray(options.targetFile || options.targetFiles)
        let globalsourcefilename = path.join(configPath, "knx-settings.yaml");
        if ("sourcefilename" in config) {
            globalsourcefilename = config.sourcefilename
        }

        // export all but the devices here
        if (shouldWriteFile(globalsourcefilename, targetFiles)) {
            let config_setting = {}
            Object.assign(config_setting, config)
            delete config_setting.Devices
            export_config(config_setting, globalsourcefilename)
        }

        // export the devices

        //collect the file names from devices
        let filenames_in_config = {};
        //console.debug(config.Devices.length);
        if (config.Devices) {
            config.Devices.forEach(element => {
                console.debug("element ", element.DeviceName)
                if (element.sourcefilename) {
                    if (filenames_in_config[element.sourcefilename]) {
                        // exists, append
                        filenames_in_config[element.sourcefilename].push(element)
                        //console.debug("add " + element.sourcefilename + ": " + element.DeviceName)
                    } else {
                        // new
                        //console.debug("Create: " + element.sourcefilename + ": " + element.DeviceName)
                        filenames_in_config[element.sourcefilename] = [element]
                    }
                }
            });
            // export for each filename
            //console.debug("Filenames: " + Object.getOwnPropertyNames(filenames_in_config))
            Object.getOwnPropertyNames(filenames_in_config).forEach(filename => {
                if (shouldWriteFile(filename, targetFiles)) {
                    let export_object = { "Devices": filenames_in_config[filename] }
                    export_config(export_object, filename)
                }
            })
        }

    }
    console.log("---");
};

User.LogHomebridgeKNXSTarts = function () {
    var startLogPath = path.join(this.storagePath(), "homebridge-knx.startlog");
    var startLog = {};
    if (fs.existsSync(startLogPath)) {
        try {
            // load that file as JSON
            startLog = JSON.parse(fs.readFileSync(startLogPath));
            if (startLog.starts !== undefined) {
                startLog.starts.push(new Date().toJSON());
            }
        } catch (e) {
            console.error("Cannot load startlog at " + startLogPath + " or format error: " + e);
        }
    } else {
        startLog.starts = [];
        startLog.starts.push(new Date().toJSON());
    }
    try {
        fs.writeFileSync(startLogPath, JSON.stringify(startLog, null, 4));
    } catch (e) {
        console.error("Cannot write startlog at " + startLogPath + ". Error: " + e);
    }
};
