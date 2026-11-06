/**
 * Test for a custom service type
 */
/* jshint esversion: 6, strict: true, node: true */
'use strict';

var log = require('debug')('KNXThermostat custom service/characteristic');

/** 
 *  @param {homebridge/lib/api~API} API
 */
module.exports = function(API) {
	var Characteristic = API.hap.Characteristic;
	var { Formats, Perms } = API.hap;

	class KNXThermAtHome extends Characteristic {
		constructor() {
			super('At Home', '00001025-0000-1000-8000-0026BB765292');
			this.setProps({
				format: Formats.BOOL,
				perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE, Perms.NOTIFY]
			});
			this.value = this.getDefaultValue();
		}
	}

	Characteristic.KNXThermAtHome = KNXThermAtHome;
	Characteristic.KNXThermAtHome.UUID = '00001025-0000-1000-8000-0026BB765292';

	log('Done');
};
