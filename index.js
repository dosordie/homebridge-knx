/*
 * Platform shim for use with nfarina's homebridge plugin system
 * This is the version for plugin support
 * ********************************************************************************************
 *
ALL NEW VERSION WITH OWN PERSISTENCE LAYER (file based, anyhow)
ECMA-Script 2015 (6.0) Language required
 */
/* jshint esversion: 6, strict: true, node: true */

'use strict';

var KNXDevice = require('./lib/knxdevice.js');
var userOpts = require('./lib/user').User;
var Service, Characteristic; // passed default objects from hap-nodejs
var globs = {}; // the storage for cross module data pooling;
//var iterate = require('./lib/iterate');
var knxmonitor = require('./lib/knxmonitor');
var KNXAccess = require("./lib/knxaccess");

// Define a custom require that treats requires in the remote addins as local
global.knxRequire = name => require(`${name}`);

/**
 * KNXPlatform
 *
 * @constructor
 * @param {function} log - logging function for console etc. out
 * @param {object} config - configuration object from global config.json
 */
function KNXPlatform(log, config, newAPI) {
    var that = this;
    this.log = log;
    this.platformconfig = config
    //this.Old_config = config;

    // new API for creating accessory and such.
    globs.newAPI = newAPI;
    /**
     * Talkative Info spitting thingy.
     *
     * @param {string} comment
     *
     */
    globs.info = function (comment) {
        that.log.info(comment);
    };
    globs.debug = function (comment) {
        that.log.debug(comment);
    };
    globs.errorlog = function (comment) {
        that.log.error(comment);
    };

    /* our own config file */

    globs.debug("Trying to load user settings");
    userOpts.setStoragePath(newAPI.user.storagePath()); // get path from homebridge!
    globs.debug(userOpts.configPath(this.platformconfig));
    this.config = userOpts.loadConfig(this.platformconfig);
    globs.config = this.config;
    globs.restoredAccessories = [];

    /* we should have now:
     * - knxd_ip
     * - knxd_port
     * - GroupAddresses object
     * - Devices Object
     */
    globs.knxconnection = this.platformconfig.knxconnection; // moved to platform config in homebridge UI
    globs.knxd_ip = this.platformconfig.knxd_ip;
    globs.knxd_port = this.platformconfig.knxd_port || 6720;
    globs.readRequestDelayMs = this.platformconfig.readRequestDelayMs || 80;
    globs.readRequestStartupDelayMs = this.platformconfig.readRequestStartupDelayMs || 3000;
    globs.knx_phy_addr = this.platformconfig.knx_phy_addr || "15.15.15";
    globs.info("Using KNX physical address: " + globs.knx_phy_addr);
    globs.log = log;
    globs.knxmonitor = knxmonitor;
    /**
     * To store all unique read requests
     *
     * @type {string[]}
     */
    globs.readRequests = {};

    KNXAccess.setGlobs(globs); // init link for module;
    knxmonitor.setGlobs(globs);
    knxmonitor.startMonitor({
        host: globs.knxd_ip,
        port: globs.knxd_port
    });

    // Homebridge dynamic platform accessory restore flow: wait until restore is complete.
    newAPI.on('didFinishLaunching', function () {
        globs.info('homebridge event didFinishLaunching');
        this.configure();
    }.bind(this));

}

/**
 * Registers the plugin with homebridge. Will be called by homebridge if found in directory structure and package.json
 * is right This function needs to be exported.
 *
 * @param {homebridge/lib/api.js~API} homebridgeAPI - The API Object made available by homebridge. Contains the HAP type library e.g.
 *
 */
function registry(homebridgeAPI) {
    console.log("homebridge API version: " + homebridgeAPI.version);

    /*
     * Experimental: Look for a user file called knx-ignore.txt in the user config path.
     * If it is there, exit here and DO NOT REGISTER the platform
     */
    let fs = require('fs');
    let path = require('path');
    let checkfilepath = path.join(homebridgeAPI.user.storagePath(), 'knx-ignore.txt');
    if (fs.existsSync(checkfilepath)) {
        console.log('[WARNING] Found blocking file, exiting now. To load homebridge-knx, remove ' + checkfilepath);
        return;
    }
    // END OF INSERTION FOR BRANCH ignore-option

    Service = homebridgeAPI.hap.Service;
    Characteristic = homebridgeAPI.hap.Characteristic;
    globs.Service = Service;
    globs.Characteristic = Characteristic;
    globs.API = homebridgeAPI;

    /* load our custom types
     *
     */
    require('./lib/customtypes/knxthermostat.js')(homebridgeAPI);

    // third parameter dynamic = true
    homebridgeAPI.registerPlatform("homebridge-knx", "KNX", KNXPlatform, true);
}

module.exports = registry;

//Function invoked when homebridge tries to restore cached accessory
//Developer can configure accessory at here (like setup event handler)
//Update current value

/**
 * configureAccessory() is invoked for each accessory homebridge restores from its persistence layer. The restored
 * accessory has all the homekit properties, but none of the implementation at this point of time. This happens before
 * the didFinishLaunching event.
 *
 * @param {platformAccessory} accessory
 */
KNXPlatform.prototype.configureAccessory = function (accessory) {
    console.log("Plugin - Configure Accessory: " + accessory.displayName + " --> Added to restoredAccessories[]");

    // collect the accessories
    globs.restoredAccessories.push(accessory);
};

/**
 * Accessories are restored by Homebridge from persistence first, then reconnected here.
 *
 * This is the event handler for the "didFinishLaunching" event of the Homebridge API.
 */

KNXPlatform.prototype.configure = function () {
    globs.info('Configuration starts');
    userOpts.LogHomebridgeKNXSTarts();
    // homebridge has now finished restoring the accessories from its persistence layer.
    // Now we need to get their implementation back to them

    globs.debug('We think homebridge has restored ' + globs.restoredAccessories.length + ' accessories.');

    /* *************** read the config the first time
     *
    //  */
    // if (!this.config.GroupAddresses) {
    //     this.config.GroupAddresses = [];
    // }

    // iterate through all devices the platform my offer
    // for each device, create an accessory

    // read accessories from file !!!!!
    var foundAccessories = this.config.Devices || [];

    //create array of accessories
    /** @type {lib/knxdevice.js~knxDevice[]} */
    globs.devices = [];

    for (var int = 0; int < foundAccessories.length; int++) {
        var currAcc = foundAccessories[int];
        globs.info("Reading from config: Device/Accessory " + (int + 1) + " of " + foundAccessories.length);

        globs.debug("Match device [" + currAcc.DeviceName + "]");

        //match them to the restored accessories:
        /** @type {homebridge/lib/platformAccessory.js/PlatformAccessory} */
        var matchAcc = getAccessoryByUUID(globs.restoredAccessories, currAcc.UUID);
        if (matchAcc) {
            // we found one
            globs.debug('Matched an accessory: ' + currAcc.DeviceName + ' === ' + matchAcc.displayName);
            // Instantiate and pass the existing platformAccessory
            matchAcc.active = true;
            globs.devices.push(new KNXDevice(globs, foundAccessories[int], matchAcc));
        } else {
            // this one is new
            globs.debug('New accessory found: ' + currAcc.DeviceName);
            globs.devices.push(new KNXDevice(globs, foundAccessories[int]));
        }
        // do not construct here: var acc = new accConstructor(globs,foundAccessories[int]);

        globs.info("Done with [" + currAcc.DeviceName + "] accessory");
    }
    // now the globs.devices contains an array of working accessories, that are not yet passed to homebridge
    globs.info('We have read ' + globs.devices.length + ' devices from file.');

    //now we need to store our updated config file to disk, or else all that is in vain next startup!
    globs.info('Saving config file!');
    userOpts.storeConfig(this.platformconfig);


    // here needs the hook for global "finished" event to go into

    for (var i = 0; i < globs.devices.length; i++) {
        let matchAcc2 = globs.devices[i];
        for (var i_serv = 0; i_serv < matchAcc2.services.length; i_serv++) {
            var myKNXService = matchAcc2.services[i_serv];
            if (myKNXService.customServiceAPI && myKNXService.customServiceAPI.handler) {
                if (typeof myKNXService.customServiceAPI.handler.onHomeKitReady === 'function') {
                    globs.debug(matchAcc2.name + "/" + myKNXService.name + ": Custom Handler onHomeKitReady()");
                    myKNXService.customServiceAPI.handler.onHomeKitReady();
                }
            }
        }

    }


    // we're done, now issue the startup read requests to the bus
    KNXAccess.knxreadhash(globs.readRequests);

};

/**
 * returns an accessory from an array of accessories if the context property is matched, or undefined.
 *
 * @param {homebridge/lib/platformAccessory.js~PlatformAccessory[]} accessories The array of accessories.
 * @param {String} uuid The context object (presumably a string) to be matched.
 * @return {homebridge/lib/platformAccessory.js~PlatformAccessory} or undefined
 *
 */
function getAccessoryByUUID(accessories, uuid) {
    globs.debug('--compare----------------');
    for (var ina = 0; ina < accessories.length; ina++) {
        var thisAcc = accessories[ina];
        globs.debug('Comparing ' + thisAcc.UUID + ' === ' + uuid + ' ==>' + (thisAcc.UUID === uuid));
        //console.log(thisAcc); // spit it out
        if (thisAcc.UUID === uuid) {
            globs.debug('---------------done---');
            return thisAcc;
        }
    }
    // nothing found:
    globs.debug('-----none----------return-undefined--');
    return undefined;
}

/**
 * Search the globs object's devices[] array for an knxDevice with name 'name'
 */
globs.getDeviceByName = function (name) {
    for (var idevice = 0; idevice < globs.devices.length; idevice++) {
        var oDevice = globs.devices[idevice];
        if (oDevice.name === name) {
            return oDevice;
        }
    }
    return undefined;
};
