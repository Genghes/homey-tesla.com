// 'use strict'
//
// const Homey = require('homey')
// const Util = require('../util.js')
// const Geofences = require('../geofences.js')
//
// // todo: implement
//
// exports.init = function () {
//   // Homey.app.triggerHttpGetVariable2 = new Homey.FlowCardTrigger('http_get_variable_2')
//   //   .registerRunListener((args, state) => Promise.resolve(args.trigger.toLowerCase() === state.trigger.toLowerCase()))
//   //   .register()
//
//
//
//   Homey.manager('flow').on('trigger.vehicleGeofenceEntered', onTriggerVehicleGeofence)
//   Homey.manager('flow').on('trigger.vehicleGeofenceEntered.geofence.autocomplete', onTriggerVehicleGeofenceGeofenceAutocomplete)
//   Homey.manager('flow').on('trigger.vehicleGeofenceLeft', onTriggerVehicleGeofence)
//   Homey.manager('flow').on('trigger.vehicleGeofenceLeft.geofence.autocomplete', onTriggerVehicleGeofenceGeofenceAutocomplete)
// }
//
// function onTriggerVehicleGeofenceGeofenceAutocomplete (callback, args) {
//   callback(null, Geofences.geofencesFilteredList(args.query))
// }
//
// function onTriggerVehicleGeofence (callback, args, state) {
//   Util.debugLog('flow trigger vehicle geofence evaluation', {card: args.geofence.geofenceId.toString(), state: state.geofence.toString()})
//   callback(null, args.geofence.geofenceId.toString() === state.geofence.toString())
// }
