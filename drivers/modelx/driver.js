/* global Homey */
'use strict'

var Tesla = require('../../lib/tesla.js')
var Util = require('../../lib/util.js')
var Geo = require('../../lib/geofences.js')

const retryTrackingTimeoutMs = 5 * 60 * 1000
const mi2km = 1.609344

var teslaApi = null
var retryTrackingTimeoutId = null
var trackerIntervalObjects = {}
var geofences = {}
var vehicles = {}

function checkGeofences (notrigger) {
  if (!vehicles) return
  Object.keys(vehicles).forEach((vehicleId) => {
    checkGeofencesForVehicle(vehicleId, notrigger)
  })
}

function checkGeofencesForVehicle (vehicleId, notrigger) {
  if (!geofences) return
  var trackerGeofencesPrevious = vehicles[vehicleId].geofences || []
  var trackerInGeofence = Geo.geofencesLocationMatch(vehicles[vehicleId].location)
  vehicles[vehicleId].geofences = trackerInGeofence
  if (notrigger) return

  trackerInGeofence.filter(active => trackerGeofencesPrevious.indexOf(active)).forEach(geofenceId => {
    Homey.manager('flow').triggerDevice('vehicleGeofenceEntered', null,
      {geofence: geofenceId},
      {id: vehicleId, homeyDriverName: 'modelx'},
      function (error, result) {
        Util.debugLog('flow trigger vehicle entered geofence', {id: vehicleId, geofenceId: geofenceId, error: error, result: result})
      }
    )
  })
  trackerGeofencesPrevious.filter(previous => trackerInGeofence.indexOf(previous)).forEach(geofenceId => {
    Homey.manager('flow').triggerDevice('vehicleGeofenceLeft', null,
      {geofence: geofenceId},
      {id: vehicleId, homeyDriverName: 'modelx'},
      function (error, result) {
        Util.debugLog('flow trigger vehicle left geofence', {id: vehicleId, geofenceId: geofenceId, error: error, result: result})
      }
    )
  })
}

function stopMoving (vehicleId) {
  Util.debugLog('stopMoving called', {vehicleId: vehicleId, moving: vehicles[vehicleId].moving})
  if (!vehicles[vehicleId].moving) return
  if (!vehicles[vehicleId].route) return

  // create route object for persistancy
  var route = vehicles[vehicleId].route
  route.end = vehicles[vehicleId].location
  route.end.time = vehicles[vehicleId].timeLastCheck
  route.vehicleId = vehicleId

  teslaApi.getVehicleState(vehicleId).then(vehicleState => {
    vehicles[vehicleId].route.end.odometer = vehicleState.odometer * mi2km

    // only save route if distance > 1000m
    if ((vehicles[vehicleId].route.distance || 0) > 1000) {
      // TODO: Read setting if route analysis is allowed
      var allRoutes = Homey.manager('settings').get('teslaRoutes') || []
      allRoutes.push(route)
      Homey.manager('settings').set('teslaRoutes', allRoutes)
    }
    // update tracker
    delete vehicles[vehicleId].route
    vehicles[vehicleId].moving = false
    module.exports.realtime({id: vehicleId, homeyDriverName: 'modelx'}, 'moving', false)
    Homey.manager('api').realtime('teslaLocation', vehicles[vehicleId])

    // handle flows
    var tokens = {
      start_location: Util.createAddressSpeech(route.start.place, route.start.city),
      stop_location: Util.createAddressSpeech(route.end.place, route.end.city),
      distance: Math.ceil(route.distance) || 0
    }

    Homey.manager('flow').triggerDevice(
      'vehicleStoptMoving',
      tokens,
      null,
      {id: vehicleId, homeyDriverName: 'modelx'},
      function (error, result) {
        Util.debugLog('flow trigger vehicle_stopt_moving ', {id: vehicleId, error: error, result: result})
      }
    )
  }).catch(reason => {
    Util.debugLog('fatal error on odometer request on stop moving', {id: vehicleId, error: reason})
  })
}

function initiateTracking () {
  if (retryTrackingTimeoutId) clearTimeout(retryTrackingTimeoutId)
  retryTrackingTimeoutId = null

  Util.debugLog('######### TESLA TRACKING ## initiateTracking #########################', {Homey: Homey.version, App: Homey.manifest.version})
  teslaApi = null
  geofences = Homey.manager('settings').get('geofences')
  var settings = Homey.manager('settings').get('teslaAccount')
  if (!settings) return Util.debugLog('  no settings!')

  teslaApi = new Tesla({
    user: settings.user,
    password: settings.password,
    grant: Homey.manager('settings').get('teslaGrant'),
    language: Homey.manager('i18n').getLanguage()
  })

  if (!Object.keys(vehicles).length) return Util.debugLog('  no devices to track!')
  teslaApi.on('error', error => { Util.debugLog('event: error', error) })
  teslaApi.on('grant', newgrant => { Homey.manager('settings').set('teslaGrant', newgrant) })

  Object.keys(vehicles).forEach(vehicleId => {
    teslaApi.getLocation(vehicleId).then(location => {
      module.exports.realtime({id: vehicleId, homeyDriverName: 'modelx'}, 'location', JSON.stringify(location))
      module.exports.realtime({id: vehicleId, homeyDriverName: 'modelx'}, 'location_human', location.place + ', ' + location.city)
      Util.debugLog('initial location for vehicle', {id: vehicleId, location: location})
      vehicles[vehicleId].location = location
      vehicles[vehicleId].timeLastTrigger = 0
      vehicles[vehicleId].pollErrors = 0

      // clear route tracking if tracker is not moving or never initiated before
      if (!vehicles[vehicleId].moving) delete vehicles[vehicleId].route
      if (trackerIntervalObjects[vehicleId]) {
        clearInterval(trackerIntervalObjects[vehicleId])
        trackerIntervalObjects[vehicleId] = null
      }

      if (!settings.polling) {
        Util.debugLog('  polling disabled in app settings')
      } else {
        checkGeofencesForVehicle(vehicleId, true)
        trackerIntervalObjects[vehicleId] = setInterval(
          checkNewLocation, vehicles[vehicleId].settings.pollInterval * 1000, vehicleId
        )
      }
    }).catch(reason => {
      Util.debugLog('error with loading initial location: tracking terminated, will retry in 5 minutes.', reason)
      if (!retryTrackingTimeoutId) {
        retryTrackingTimeoutId = setTimeout(initiateTracking, retryTrackingTimeoutMs)
      }
    })
  })
} // function initiateTracking

function checkNewLocation (vehicleId) {
  teslaApi.getDriveState(vehicleId).then(state => {
    if (vehicles[vehicleId].pollErrors > 0) {
      vehicles[vehicleId].pollErrors = 0
      Util.debugLog('poll restored in checkNewLocation')
    }
    vehicles[vehicleId].timeLastCheck = new Date()
    if (state.shift_state === null && vehicles[vehicleId].moving) {
      return stopMoving(vehicleId)
    }
    var distance = Geo.calculateDistance(state.latitude, state.longitude, vehicles[vehicleId].location.lat, vehicles[vehicleId].location.lng)
    if (distance > 1) {
      teslaApi.getLocation(vehicleId).then(location => {
        processNewLocation(vehicleId, distance, location)
      })
    }
  }).catch(reason => {
    vehicles[vehicleId].pollErrors ++
    if (vehicles[vehicleId].pollErrors === 4) {
      Util.debugLog('poll error in checkNewLocation (' + vehicles[vehicleId].pollErrors + '): tracking terminated, will retry in 5 minutes.', reason)
      clearInterval(trackerIntervalObjects[vehicleId])
      trackerIntervalObjects[vehicleId] = null
      if (!retryTrackingTimeoutId) {
        retryTrackingTimeoutId = setTimeout(initiateTracking, retryTrackingTimeoutMs)
      }
    } else {
      Util.debugLog('poll error in checkNewLocation (' + vehicles[vehicleId].pollErrors + ').', reason)
    }
  })
}

function processNewLocation (vehicleId, distance, location) {
  var previousLocation = vehicles[vehicleId].location
  var wasMoving = vehicles[vehicleId].moving

  vehicles[vehicleId].location = location
  vehicles[vehicleId].timeLastUpdate = new Date().getTime()
  Homey.manager('api').realtime('teslaLocation', vehicles[vehicleId])
  module.exports.realtime({id: vehicleId, homeyDriverName: 'modelx'}, 'location', JSON.stringify(location))
  module.exports.realtime({id: vehicleId, homeyDriverName: 'modelx'}, 'location_human', location.place + ', ' + location.city)

  var timeConstraint = (vehicles[vehicleId].timeLastUpdate - vehicles[vehicleId].timeLastTrigger) < (vehicles[vehicleId].settings.retriggerRestrictTime * 1000)
  var distanceConstraint = distance < vehicles[vehicleId].settings.retriggerRestrictDistance

  // handle flows
  Util.debugLog('event: location', {id: vehicleId, place: location.place, city: location.city, distance: distance, wasMoving: wasMoving, timeConstraint: timeConstraint, distanceConstraint: distanceConstraint})
  checkGeofencesForVehicle(vehicleId)
  if (wasMoving) {
    // next if part is temp fix. Should be removed when bug final fixed
    if (!vehicles[vehicleId].route) {
      Util.debugLog('vehicle was moving, but without route object', {id: vehicleId, tracker: vehicles[vehicleId]})
      vehicles[vehicleId].route = {
        distance: distance,
        start: previousLocation
      }
    } else {
      vehicles[vehicleId].route.distance += distance
    }
  }

  if (!wasMoving && !distanceConstraint) {
    vehicles[vehicleId].moving = true
    vehicles[vehicleId].route = {
      distance: distance,
      start: previousLocation
    }
    vehicles[vehicleId].route.start.time = new Date().getTime()
    module.exports.realtime({id: vehicleId, homeyDriverName: 'modelx'}, 'moving', true)
    Homey.manager('flow').triggerDevice('vehicleStartMoving', {
      address: Util.createAddressSpeech(previousLocation.place, previousLocation.city),
      distance: Math.ceil(distance) || 0
    }, null, {id: vehicleId, homeyDriverName: 'modelx'}, (error, result) => {
      Util.debugLog('flow trigger vehicle_start_moving ', {id: vehicleId, error: error, result: result})
    })
  }

  if (!timeConstraint && !distanceConstraint) {
    vehicles[vehicleId].timeLastTrigger = new Date().getTime()
    Homey.manager('flow').triggerDevice('vehicleMoved', {
      address: Util.createAddressSpeech(location.place, location.city),
      distance: Math.ceil(distance) || 0
    }, null, {id: vehicleId, homeyDriverName: 'modelx'}, (err, result) => {
      Util.debugLog('flow trigger vehicle_moved ', {id: vehicleId, error: err, result: result})
    })
  }

  if (!vehicles[vehicleId].route.start.odometer) {
    teslaApi.getVehicleState(vehicleId).then(vehicleState => {
      vehicles[vehicleId].route.start.odometer = vehicleState.odometer * mi2km
    })
  }
} // function processNewLocation

var self = {
  init: function (devices, callback) {
    devices.forEach(device => {
      Homey.manager('drivers').getDriver(device.homeyDriverName).getName(device, (error, name) => {
        Util.debugLog('Initiate device', {name: name, data: device})
        if (error) return
        vehicles[device.id] = {
          vehicleId: device.id,
          name: name,
          location: {},
          moving: false,
          geofences: []
        }
        trackerIntervalObjects[device.id] = null
        module.exports.getSettings(device, (error, settings) => {
          if (error) Util.debugLog('Error on loading device settings', {device: device, error: error})
          var vehiclesettings = {
            retriggerRestrictTime: settings.retriggerRestrictTime || 10,
            retriggerRestrictDistance: settings.retriggerRestrictDistance || 1,
            pollInterval: settings.pollInterval || 20
          }
          vehicles[device.id].settings = vehiclesettings
        })
      })
    })

    Homey.manager('settings').on('set', (setting) => {
      switch (setting) {
        case 'teslaAccount':
          initiateTracking()
          break
        case 'teslaGrant':
          Util.debugLog('new grant registered', Homey.manager('settings').get(setting))
          break
        case 'geofences':
          geofences = Homey.manager('settings').get(setting)
          checkGeofences()
          break
      }
    })

    // delay initiation because getting settings per device take time
    setTimeout(initiateTracking, 2000)
    setTimeout(callback, 6000)
  },
  renamed: function (device, name, callback) {
    Util.debugLog('rename vehicle', [device, name])
    vehicles[device.id].name = name
    callback()
  },
  deleted: function (device) {
    Util.debugLog('delete vehicle', device)
    if (trackerIntervalObjects[device.id]) {
      clearInterval(trackerIntervalObjects[device.id])
      trackerIntervalObjects[device.id] = null
    }
    delete vehicles[device.id]
    initiateTracking()
  },
  pair: function (socket) {
    socket.on('start', (data, callback) => {
      var settings = Homey.manager('settings').get('teslaAccount')
      if (!settings) return callback('errorNoSettings')
      teslaApi.validateGrant()
      .then(callback(null))
      .catch(reason => { callback('errorInvalidSettings') })
    })
    socket.on('list_devices', (data, callback) => {
      var devices = []
      teslaApi.getVehicles().then(vehicles => {
        if (!vehicles) return callback('errorNoVehiclesFound')
        vehicles.forEach(vehicle => {
          devices.push({
            name: vehicle.display_name,
            data: {id: vehicle.id_s, homeyDriverName: 'modelx'},
            icon: 'icon.svg'
          })
        })
        callback(null, devices)
      })
    })
    socket.on('add_device', (device, callback) => {
      Util.debugLog('pairing: vehicle added', device)
      vehicles[device.data.id] = {
        vehicleId: device.data.id,
        name: device.name,
        location: {},
        moving: false,
        geofences: [],
        settings: {
          retriggerRestrictTime: 10,
          retriggerRestrictDistance: 1,
          pollInterval: 20
        }
      }
      trackerIntervalObjects[device.data.id] = null
      initiateTracking()
      callback(null)
    })
  },
  settings: function (device, newSettingsObj, oldSettingsObj, changedKeysArr, callback) {
    Util.debugLog('settings changed', {device: device, newSettingsObj: newSettingsObj, changedKeysArr: changedKeysArr})
    try {
      changedKeysArr.forEach(key => { vehicles[device.id].settings[key] = newSettingsObj[key] })
      if (newSettingsObj.pollInterval) { initiateTracking() }
      callback(null, true)
    } catch (error) {
      callback(error)
    }
  },
  capabilities: {
    location: {
      get: function (device, callback) {
        Util.debugLog('capabilities > location > get', device)
        if (!teslaApi) return callback('not_initiated')
        teslaApi.getLocation(device.id).then(location => {
          callback(null, JSON.stringify(location))
        }).catch(callback)
      }
    },
    location_human: {
      get: function (device, callback) {
        Util.debugLog('capabilities > location_human > get', device)
        if (!teslaApi) return callback('not_initiated')
        teslaApi.getLocation(device.id).then(location => {
          callback(null, location.place + ', ' + location.city)
        }).catch(callback)
      }
    },
    moving: {
      get: function (device, callback) {
        Util.debugLog('capabilities > moving > get', device)
        if (!teslaApi) return callback('not_initiated')
        teslaApi.getDriveState(device.id)
        .then(state => { callback(null, state.speed != null) })
        .catch(callback)
      }
    }
  },
  getVehicles: () => { return vehicles },
  getApi: () => {
    return new Promise((resolve, reject) => {
      if (!teslaApi) return reject('no_settings')
      resolve(teslaApi)
    })
  },
  testApi: () => {
    var testVehicleId = null
    var drivername = 'modelx'
    if (!teslaApi) return Util.debugLog('api not ready, are settings saved?')
    teslaApi.validateGrant()
    .then(function () {
      Util.debugLog(drivername + ' validateGrant ok')
      return teslaApi.getVehicles()
    }).catch(function (error) {
      return Util.debugLog(drivername + ' validateGrant failed', error)
    }).then(function (vehicles) {
      Util.debugLog(drivername + ' getVehicles ok', vehicles)
      testVehicleId = vehicles[0].id_s
      return teslaApi.getVehicleState(testVehicleId)
    }).catch(function (error) {
      return Util.debugLog(drivername + ' getVehicles failed', error)
    }).then(function (state) {
      Util.debugLog(drivername + ' getVehicleState ok', state)
      return teslaApi.getDriveState(testVehicleId)
    }).catch(function (error) {
      Util.debugLog(drivername + ' getVehicleState failed', error)
      return teslaApi.getDriveState(testVehicleId)
    }).then(function (state) {
      Util.debugLog(drivername + ' getDriveState ok', state)
      return teslaApi.getClimateState(testVehicleId)
    }).catch(function (error) {
      Util.debugLog(drivername + ' getDriveState failed', error)
      return teslaApi.getClimateState(testVehicleId)
    }).then(function (state) {
      Util.debugLog(drivername + ' getClimateState ok', state)
      return teslaApi.getGuiSettings(testVehicleId)
    }).catch(function (error) {
      Util.debugLog(drivername + ' getClimateState failed', error)
      return teslaApi.getGuiSettings(testVehicleId)
    }).then(function (state) {
      Util.debugLog(drivername + ' getGuiSettings ok', state)
      return teslaApi.getChargeState(testVehicleId)
    }).catch(function (error) {
      Util.debugLog(drivername + ' getGuiSettings failed', error)
      return teslaApi.getChargeState(testVehicleId)
    }).then(function (state) {
      Util.debugLog(drivername + ' getChargeState ok', state)
      return teslaApi.getMobileAccess(testVehicleId)
    }).catch(function (error) {
      Util.debugLog(drivername + ' getChargeState failed', error)
      return teslaApi.getMobileAccess(testVehicleId)
    }).then(function (state) {
      Util.debugLog(drivername + ' getMobileAccess ok', state)
    }).catch(function (error) {
      Util.debugLog(drivername + ' getMobileAccess failed', error)
    })
  }
}

module.exports = self
