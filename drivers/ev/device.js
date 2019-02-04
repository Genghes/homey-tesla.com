'use strict'

const Homey = require('homey')
const Tesla = require('../../lib/tesla.js')
const Geo = require('../../lib/geofences.js')

const mi2km = 1.609344
const retryTrackingTimeoutS = 5 * 60
const maxApiErrors = 5

var vehicles = {}
// var geofences = {}

class Vehicle extends Homey.Device {
  onDeleted () {
    // TODO: test
    const device = this
    const deviceId = device.getData().id
    device.log('deleting device', deviceId)
    if (vehicles[deviceId].batteryTrackerIntervalObject) clearInterval(vehicles[deviceId].batteryTrackerIntervalObject)
    if (vehicles[deviceId].locationTrackerIntervalObject) clearInterval(vehicles[deviceId].locationTrackerIntervalObject)
    if (vehicles[deviceId].retryTrackingTimeoutId) clearTimeout(vehicles[deviceId].retryTrackingTimeoutId)
    delete vehicles[deviceId]
  }

  onRenamed (name) {
    const device = this
    const deviceId = device.getData().id
    device.log('renaming device', deviceId)
    vehicles[deviceId].name = name
  }

  async onInit () {
    // TODO: load geofences, timeout for 5 minutes if tracking errors 3 times *not needed anymore*
    // geofences = Homey.manager('settings').get('geofences')
    const device = this
    const deviceId = device.getData().id
    await device.setSettings({password: ''})
    await device.setAvailable()
    device.log('##### TESLA onInit #####', {Homey: Homey.version, App: Homey.manifest.version, Device: deviceId})
    device.log('settings', device.getSettings())
    vehicles[deviceId] = {
      id: deviceId,
      name: device.getName(),
      teslaApi: null,
      batteryTrackerIntervalObject: null,
      locationTrackerIntervalObject: null,
      apiErrors: 0,
      retryTrackingTimeoutId: null,
      timeLastUpdate: null,
      timeLastTrigger: 0,
      moving: null,
      battery: null,
      route: null,
      location: {}
    }
    vehicles[deviceId].teslaApi = new Tesla({
      grant: device.getStoreValue('grant'),
      language: Homey.ManagerI18n.getLanguage()
    })
    vehicles[deviceId].teslaApi.on('invalid_user_password', async () => {
      device.log('Device unavailable due to invalid account / username / password')
      device.setUnavailable(Homey.__('device.errorAccountAccess'))
      let notification = new Homey.Notification({excerpt: Homey.__('device.errorAccountAccessNotification')})
      await notification.register()
      await trackController(device)
    })
    vehicles[deviceId].teslaApi.on('error', async reason => {
      vehicles[deviceId].apiErrors ++
      device.log(`error from Api, counting ${vehicles[deviceId].apiErrors} to max ${maxApiErrors}`)
      if (vehicles[deviceId].apiErrors > maxApiErrors) {
        device.error(`error counter broke treshold, timeout for ${retryTrackingTimeoutS} seconds`)
        await device.setUnavailable(`Counted ${vehicles[deviceId].apiErrors} errors on api calls to vehicle. Timeout for ${retryTrackingTimeoutS} seconds.`)
        await trackController(device)
        vehicles[deviceId].retryTrackingTimeoutId = setTimeout(async () => {
          device.log('restart tracking after api error timeout')
          await logAvailable(device)
          trackController(device)
        }, retryTrackingTimeoutS * 1000)
      }
    })
    const vehicleId = await vehicles[deviceId].teslaApi.getVehicleIdByVIN(deviceId).catch((reason) => {
      return device.getStoreValue('vehicleId')
    })
    await device.setStoreValue('vehicleId', vehicleId)
    trackController(device)
  }

  async onSettings (oldSettingsObj, newSettingsObj, changedKeysArr) {
    const device = this
    let reInit = false

    if (changedKeysArr.find(key => key === 'password') && newSettingsObj.password !== '') {
      device.log('try new password')
      let teslaSession = new Tesla({
        user: device.getStoreValue('username'),
        password: newSettingsObj.password
      })
      teslaSession.on('grant', async newGrant => {
        device.log('Succesvol got grant with new settings', newGrant)
        await device.setStoreValue('grant', newGrant)
        await logAvailable(device)
        reInit = true
      })
      await teslaSession.login().then(() => {
        device.log('tesla login success')
        return logAvailable(device)
      }).catch(error => {
        device.log('tesla login error', error)
        throw new Error('Invalid password')
      })
    }

    changedKeysArr.forEach(async key => {
      switch (key) {
        case 'locationPolling':
        case 'locationIntervalDriving':
        case 'locationIntervalParked':
        case 'batteryPolling':
        case 'batteryInterval':
          reInit = true
          break
        default:
          break
      }
    })

    if (reInit) {
      // restart polling 1 seconds after settings change
      setTimeout(
        trackController
      , 1000, device)
    }
  }

  getApi () {
    const device = this
    let deviceId = device.getData().id
    if (!vehicles[deviceId].teslaApi) throw new Error('no_api')
    return vehicles[deviceId].teslaApi
  }

  getVehicle () {
    const device = this
    let deviceId = device.getData().id
    if (!vehicles[deviceId]) throw new Error('no_vehicle')
    let vehicle = {}
    vehicle.id = vehicles[deviceId].id
    vehicle.name = vehicles[deviceId].name
    vehicle.apiErrors = vehicles[deviceId].apiErrors
    vehicle.timeLastTrigger = vehicles[deviceId].timeLastTrigger
    vehicle.timeLastUpdate = vehicles[deviceId].timeLastUpdate
    vehicle.moving = vehicles[deviceId].moving
    vehicle.battery = vehicles[deviceId].battery
    vehicle.route = vehicles[deviceId].route
    vehicle.location = vehicles[deviceId].location
    return vehicle
  }

  testApi () {
    const device = this
    const deviceId = device.getData().id
    const vehicleId = device.getStoreValue('vehicleId')
    device.log('test Api call', deviceId, vehicleId)
    if (!vehicles[deviceId].teslaApi) throw new Error('no_api')
    vehicles[deviceId].teslaApi.validateGrant()
    .then(function () {
      device.log('validateGrant ok')
      return vehicles[deviceId].teslaApi.getVehicles()
    }).catch(function (error) {
      return device.error('validateGrant failed', error)
    }).then(function (apivehicles) {
      device.log('getVehicles ok', apivehicles)
      return vehicles[deviceId].teslaApi.getVehicleState(vehicleId)
    }).catch(function (error) {
      return device.error('getVehicles failed', error)
    }).then(function (state) {
      device.log('getVehicleState ok', state)
      return vehicles[deviceId].teslaApi.getDriveState(vehicleId)
    }).catch(function (error) {
      device.error('getVehicleState failed', error)
      return vehicles[deviceId].teslaApi.getDriveState(vehicleId)
    }).then(function (state) {
      device.log('getDriveState ok', state)
      return vehicles[deviceId].teslaApi.getClimateState(vehicleId)
    }).catch(function (error) {
      device.error('getDriveState failed', error)
      return vehicles[deviceId].teslaApi.getClimateState(vehicleId)
    }).then(function (state) {
      device.log('getClimateState ok', state)
      return vehicles[deviceId].teslaApi.getGuiSettings(vehicleId)
    }).catch(function (error) {
      device.error('getClimateState failed', error)
      return vehicles[deviceId].teslaApi.getGuiSettings(vehicleId)
    }).then(function (state) {
      device.log('getGuiSettings ok', state)
      return vehicles[deviceId].teslaApi.getChargeState(vehicleId)
    }).catch(function (error) {
      device.error('getGuiSettings failed', error)
      return vehicles[deviceId].teslaApi.getChargeState(vehicleId)
    }).then(function (state) {
      device.error('getChargeState ok', state)
      return vehicles[deviceId].teslaApi.getMobileAccess(vehicleId)
    }).catch(function (error) {
      device.error('getChargeState failed', error)
      return vehicles[deviceId].teslaApi.getMobileAccess(vehicleId)
    }).then(function (state) {
      device.log('getMobileAccess ok', state)
    }).catch(function (error) {
      device.error('getMobileAccess failed', error)
    })
  }
}

module.exports = Vehicle

async function trackController (device) {
  // called after init, settings changed, changeddrivestate
  console.log('trackController - clear timers')
  let deviceId = device.getData().id
  if (vehicles[deviceId].retryTrackingTimeoutId) clearTimeout(vehicles[deviceId].retryTrackingTimeoutId)
  if (vehicles[deviceId].locationTrackerIntervalObject) clearInterval(vehicles[deviceId].locationTrackerIntervalObject)
  if (vehicles[deviceId].batteryTrackerIntervalObject) clearInterval(vehicles[deviceId].batteryTrackerIntervalObject)
  if (!device.getAvailable()) return

  console.log('trackController - tracklocation')
  await trackLocation(device, 0)
  console.log('trackController - trackbattery')
  await trackBattery(device, 0)

  let settings = device.getSettings()
  let drivestate = device.getCapabilityValue('moving')
  let intervalLocation = settings.locationPolling ? (drivestate ? settings.locationIntervalDriving : settings.locationIntervalParked) : 0
  let intervalBattery = settings.batteryPolling ? settings.batteryInterval * 60 : 0

  device.log('trackController setting', {location: intervalLocation, battery: intervalBattery})
  if (intervalLocation > 0) vehicles[deviceId].locationTrackerIntervalObject = setInterval(trackLocation, intervalLocation * 1000, device)
  if (intervalBattery > 0) vehicles[deviceId].batteryTrackerIntervalObject = setInterval(trackBattery, intervalBattery * 1000, device)
}

async function trackBattery (device) {
  // todo: check if custom flowtriggers are needed on battery level change
  const deviceId = device.getData().id
  const vehicleId = device.getStoreValue('vehicleId')
  return vehicles[deviceId].teslaApi.getChargeState(vehicleId).then(async chargestate => {
    device.log('battery', chargestate.battery_level)
    vehicles[deviceId].battery = chargestate.battery_level
    vehicles[deviceId].timeLastUpdate = new Date()
    await logAvailable(device)
    return device.setCapabilityValue('measure_battery', chargestate.battery_level)
  }).catch(reason => {
    // device.log('IGNORE battery request returned error', reason) // TODO: ignore
  })
}

async function trackLocation (device) {
  const deviceId = device.getData().id
  const vehicleId = device.getStoreValue('vehicleId')
  const wasMoving = vehicles[deviceId].moving
  let isMoving = null
  const previousLocation = vehicles[deviceId].location || {}
  let newLocation = previousLocation

  return vehicles[deviceId].teslaApi.getDriveState(vehicleId).then(async driveState => {
    isMoving = (driveState.shift_state !== null && driveState.shift_state !== 'P')
    newLocation = {
      latitude: driveState.latitude,
      longitude: driveState.longitude,
      city: driveState.city,
      place: driveState.place
    }
    vehicles[deviceId].location = newLocation
    vehicles[deviceId].moving = isMoving
    vehicles[deviceId].timeLastUpdate = new Date()

    await device.setCapabilityValue('moving', isMoving)
    await device.setCapabilityValue('location_human', driveState.place + ', ' + driveState.city)
    let distance = Geo.calculateDistance(newLocation.latitude, newLocation.longitude, previousLocation.latitude || newLocation.latitude, previousLocation.longitude || newLocation.longitude) || 0
    if (distance < 1) distance = 0
    device.log('trackLocation', {distance: distance, moving: isMoving})
    await logAvailable(device)
    // todo: handle changemovingstate in separate function

    let tokens = {}
    let state = {}
    device._driver.triggerflow(device, tokens, state)

    if (isMoving !== wasMoving && wasMoving !== null) return trackController(device)
  }).catch(reason => {
    // device.log('IGNORE drivestate request returned error', reason) // TODO: ignore
  })
}

function movingChanged (device, isMoving) {
  device.log('moving changed', isMoving)
}

async function logAvailable (device) {
  const deviceId = device.getData().id
  if (!device.getAvailable()) await device.setAvailable()
  vehicles[deviceId].apiErrors = 0
}
// function checkGeofences (notrigger) {
//   if (!vehicles) return
//   Object.keys(vehicles).forEach((vehicleId) => {
//     checkGeofencesForVehicle(vehicleId, notrigger)
//   })
// }

// function checkGeofencesForVehicle (vehicleId, notrigger) {
//   if (!geofences) return
//   var trackerGeofencesPrevious = vehicles[vehicleId].geofences || []
//   var trackerInGeofence = Geo.geofencesLocationMatch(vehicles[vehicleId].location)
//   vehicles[vehicleId].geofences = trackerInGeofence
//   if (notrigger) return
//
//   trackerInGeofence.filter(active => trackerGeofencesPrevious.indexOf(active)).forEach(geofenceId => {
//     Homey.manager('flow').triggerDevice('vehicleGeofenceEntered', null,
//       {geofence: geofenceId},
//       {id: vehicleId, homeyDriverName: 'models'},
//       function (error, result) {
//         Util.debugLog('flow trigger vehicle entered geofence', {id: vehicleId, geofenceId: geofenceId, error: error, result: result})
//       }
//     )
//   })
//   trackerGeofencesPrevious.filter(previous => trackerInGeofence.indexOf(previous)).forEach(geofenceId => {
//     Homey.manager('flow').triggerDevice('vehicleGeofenceLeft', null,
//       {geofence: geofenceId},
//       {id: vehicleId, homeyDriverName: 'models'},
//       function (error, result) {
//         Util.debugLog('flow trigger vehicle left geofence', {id: vehicleId, geofenceId: geofenceId, error: error, result: result})
//       }
//     )
//   })
// }

// function stopMoving (vehicleId) {
//   Util.debugLog('stopMoving called', {vehicleId: vehicleId, moving: vehicles[vehicleId].moving})
//   if (!vehicles[vehicleId].moving) return
//   if (!vehicles[vehicleId].route) return
//
//   // create route object for persistancy
//   var route = vehicles[vehicleId].route
//   route.end = vehicles[vehicleId].location
//   route.end.time = vehicles[vehicleId].timeLastCheck
//   route.vehicleId = vehicleId
//
//   teslaApi.getVehicleState(vehicleId).then(vehicleState => {
//     vehicles[vehicleId].route.end.odometer = vehicleState.odometer * mi2km
//
//     // only save route if distance > 1000m
//     if ((vehicles[vehicleId].route.distance || 0) > 1000) {
//       // TODO: Read setting if route analysis is allowed
//       var allRoutes = Homey.manager('settings').get('teslaRoutes') || []
//       allRoutes.push(route)
//       Homey.manager('settings').set('teslaRoutes', allRoutes)
//     }
//     // update tracker
//     delete vehicles[vehicleId].route
//     vehicles[vehicleId].moving = false
//     module.exports.realtime({id: vehicleId, homeyDriverName: 'models'}, 'moving', false)
//     Homey.manager('api').realtime('teslaLocation', vehicles[vehicleId])
//
//     // handle flows
//     var tokens = {
//       start_location: Util.createAddressSpeech(route.start.place, route.start.city),
//       stop_location: Util.createAddressSpeech(route.end.place, route.end.city),
//       distance: Math.ceil(route.distance) || 0
//     }
//
//     Homey.manager('flow').triggerDevice(
//       'vehicleStoptMoving',
//       tokens,
//       null,
//       {id: vehicleId, homeyDriverName: 'models'},
//       function (error, result) {
//         Util.debugLog('flow trigger vehicle_stopt_moving ', {id: vehicleId, error: error, result: result})
//       }
//     )
//   }).catch(reason => {
//     Util.debugLog('fatal error on odometer request on stop moving', {id: vehicleId, error: reason})
//   })
// }

// function processNewLocation (vehicleId, distance, location) {
//   var previousLocation = vehicles[vehicleId].location
//   var wasMoving = vehicles[vehicleId].moving
//
//   vehicles[vehicleId].location = location
//   vehicles[vehicleId].timeLastUpdate = new Date().getTime()
//   Homey.manager('api').realtime('teslaLocation', vehicles[vehicleId])
//   module.exports.realtime({id: vehicleId, homeyDriverName: 'models'}, 'location', JSON.stringify(location))
//   module.exports.realtime({id: vehicleId, homeyDriverName: 'models'}, 'location_human', location.place + ', ' + location.city)
//
//   var timeConstraint = (vehicles[vehicleId].timeLastUpdate - vehicles[vehicleId].timeLastTrigger) < (vehicles[vehicleId].settings.retriggerRestrictTime * 1000)
//   var distanceConstraint = distance < vehicles[vehicleId].settings.retriggerRestrictDistance
//
//   // handle flows
//   Util.debugLog('event: location', {id: vehicleId, place: location.place, city: location.city, distance: distance, wasMoving: wasMoving, timeConstraint: timeConstraint, distanceConstraint: distanceConstraint})
//   checkGeofencesForVehicle(vehicleId)
//   if (wasMoving) {
//     // next if part is temp fix. Should be removed when bug final fixed
//     if (!vehicles[vehicleId].route) {
//       Util.debugLog('vehicle was moving, but without route object', {id: vehicleId, tracker: vehicles[vehicleId]})
//       vehicles[vehicleId].route = {
//         distance: distance,
//         start: previousLocation
//       }
//     } else {
//       vehicles[vehicleId].route.distance += distance
//     }
//   }
//
//   if (!wasMoving && !distanceConstraint) {
//     vehicles[vehicleId].moving = true
//     vehicles[vehicleId].route = {
//       distance: distance,
//       start: previousLocation
//     }
//     vehicles[vehicleId].route.start.time = new Date().getTime()
//     module.exports.realtime({id: vehicleId, homeyDriverName: 'models'}, 'moving', true)
//     Homey.manager('flow').triggerDevice('vehicleStartMoving', {
//       address: Util.createAddressSpeech(previousLocation.place, previousLocation.city),
//       distance: Math.ceil(distance) || 0
//     }, null, {id: vehicleId, homeyDriverName: 'models'}, (error, result) => {
//       Util.debugLog('flow trigger vehicle_start_moving ', {id: vehicleId, error: error, result: result})
//     })
//   }
//
//   if (!timeConstraint && !distanceConstraint) {
//     vehicles[vehicleId].timeLastTrigger = new Date().getTime()
//     Homey.manager('flow').triggerDevice('vehicleMoved', {
//       address: Util.createAddressSpeech(location.place, location.city),
//       distance: Math.ceil(distance) || 0
//     }, null, {id: vehicleId, homeyDriverName: 'models'}, (err, result) => {
//       Util.debugLog('flow trigger vehicle_moved ', {id: vehicleId, error: err, result: result})
//     })
//   }
//
//   if (!vehicles[vehicleId].route.start.odometer) {
//     teslaApi.getVehicleState(vehicleId).then(vehicleState => {
//       vehicles[vehicleId].route.start.odometer = vehicleState.odometer * mi2km
//     })
//   }
// } // function processNewLocation

// var self = {
//
//     Homey.manager('settings').on('set', (setting) => {
//         case 'geofences':
//           geofences = Homey.manager('settings').get(setting)
//           checkGeofences()
//           break
//     })
//
//   },
//   capabilities: {
//     location: {
//       get: function (device, callback) {
//         Util.debugLog('capabilities > location > get', device)
//         if (!teslaApi) return callback('not_initiated')
//         teslaApi.getLocation(device.id).then(location => {
//           callback(null, JSON.stringify(location))
//         }).catch(callback)
//       }
//     },
//     location_human: {
//       get: function (device, callback) {
//         Util.debugLog('capabilities > location_human > get', device)
//         if (!teslaApi) return callback('not_initiated')
//         teslaApi.getLocation(device.id).then(location => {
//           callback(null, location.place + ', ' + location.city)
//         }).catch(callback)
//       }
//     },
//     moving: {
//       get: function (device, callback) {
//         Util.debugLog('capabilities > moving > get', device)
//         if (!teslaApi) return callback('not_initiated')
//         teslaApi.getDriveState(device.id)
//         .then(state => { callback(null, state.speed != null) })
//         .catch(callback)
//       }
//     }
//   },
//   getVehicles: () => { return vehicles },
// }
//
