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
    // TODO: load geofences:  geofences = Homey.manager('settings').get('geofences')
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
      lastTriggerMovedTime: null,
      lastTriggerMovedOdometer: null,
      moving: null,
      battery: null,
      route: {},
      routeCounter: device.getStoreValue('routeCounter') || 1,
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
      if (vehicles[deviceId].retryTrackingTimeoutId) return device.log('..allready in timeout')
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
    vehicles[deviceId].vehicleId = vehicleId
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
      })
      await teslaSession.login().then(() => {
        device.log('tesla login success')
        reInit = true
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
    vehicle.vehicleId = vehicles[deviceId].vehicleId
    vehicle.name = vehicles[deviceId].name
    vehicle.apiErrors = vehicles[deviceId].apiErrors
    vehicle.lastTriggerMovedTime = vehicles[deviceId].lastTriggerMovedTime
    vehicle.lastTriggerMovedOdometer = vehicles[deviceId].lastTriggerMovedOdometer
    vehicle.timeLastUpdate = vehicles[deviceId].timeLastUpdate
    vehicle.moving = vehicles[deviceId].moving
    vehicle.battery = vehicles[deviceId].battery
    vehicle.route = vehicles[deviceId].route
    vehicle.routeCounter = vehicles[deviceId].routeCounter
    vehicle.location = vehicles[deviceId].location
    vehicle.routes = device.getStoreValue('routes') || []
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
  device.log('trackController')
  let deviceId = device.getData().id
  if (vehicles[deviceId].retryTrackingTimeoutId) clearTimeout(vehicles[deviceId].retryTrackingTimeoutId)
  vehicles[deviceId].retryTrackingTimeoutId = null
  if (vehicles[deviceId].locationTrackerIntervalObject) clearInterval(vehicles[deviceId].locationTrackerIntervalObject)
  if (vehicles[deviceId].batteryTrackerIntervalObject) clearInterval(vehicles[deviceId].batteryTrackerIntervalObject)
  if (!device.getAvailable()) return

  await trackBattery(device)
  await trackLocation(device, false)

  let settings = device.getSettings()
  let drivestate = device.getCapabilityValue('moving')
  let intervalLocation = settings.locationPolling ? (drivestate ? settings.locationIntervalDriving : settings.locationIntervalParked) : 0
  let intervalBattery = settings.batteryPolling ? settings.batteryInterval * 60 : 0

  device.log('trackController setting', {location: intervalLocation, battery: intervalBattery})
  if (intervalLocation > 0) vehicles[deviceId].locationTrackerIntervalObject = setInterval(trackLocation, intervalLocation * 1000, device)
  if (intervalBattery > 0) vehicles[deviceId].batteryTrackerIntervalObject = setInterval(trackBattery, intervalBattery * 1000, device)
}

async function trackBattery (device) {
  const deviceId = device.getData().id
  const vehicleId = device.getStoreValue('vehicleId')
  let chargeState
  try {
    chargeState = await vehicles[deviceId].teslaApi.getChargeState(vehicleId)
  } catch (reason) { return device.log('trackBattery Api error') } // ignored becouse of emmitted error on teslaApi handled in onInit()
  device.log('battery', chargeState.battery_level)
  vehicles[deviceId].battery = chargeState.battery_level
  vehicles[deviceId].timeLastUpdate = new Date()
  await logAvailable(device)
  return device.setCapabilityValue('measure_battery', chargeState.battery_level)
}

async function trackLocation (device, rescheduleOnChange = true) {
  const deviceId = device.getData().id
  const vehicleId = device.getStoreValue('vehicleId')
  const wasMoving = vehicles[deviceId].moving
  let previousLocation = vehicles[deviceId].location || null
  let isMoving = null
  let driveState
  let vehicleState
  try {
    driveState = await vehicles[deviceId].teslaApi.getDriveState(vehicleId)
    isMoving = (driveState.shift_state !== null && driveState.shift_state !== 'P')
    if (isMoving || wasMoving || wasMoving === null) vehicleState = await vehicles[deviceId].teslaApi.getVehicleState(vehicleId)
  } catch (reason) { return device.log('trackLocation Api error') } // ignored becouse of emmitted error on teslaApi handled in onInit()
  let newOdometer = (vehicleState ? vehicleState.odometer * mi2km * 1000 : vehicles[deviceId].location.odometer || 0)
  let newLocation = {
    latitude: driveState.latitude,
    longitude: driveState.longitude,
    city: driveState.city,
    place: driveState.place,
    odometer: newOdometer
  }
  vehicles[deviceId].location = newLocation
  vehicles[deviceId].moving = isMoving
  vehicles[deviceId].timeLastUpdate = new Date()

  if (!previousLocation) previousLocation = newLocation
  let distanceMoved = formatValue((newOdometer - previousLocation.odometer) || 0)
  let distanceMovedSinceTrigger = formatValue(newOdometer - vehicles[deviceId].lastTriggerMovedOdometer) || distanceMoved
  let timeSinceTrigger = (new Date() - vehicles[deviceId].lastTriggerMovedTime) || 0
  let distanceHomey = Geo.calculateDistance(newLocation.latitude, newLocation.longitude, Homey.ManagerGeolocation.getLatitude(), Homey.ManagerGeolocation.getLongitude()) || 0
  distanceHomey = formatDistance(distanceHomey < 1 ? 0 : distanceHomey)
  if (!vehicles[deviceId].route.start) vehicles[deviceId].route = {id: vehicles[deviceId].routeCounter + 1, start: previousLocation}
  let distanceTraveled = formatValue(vehicles[deviceId].location.odometer - vehicles[deviceId].route.start.odometer) || 0

  device.log('trackLocation', {isMoving, distanceHomey, distanceMoved, distanceMovedSinceTrigger, distanceTraveled, timeSinceTrigger})

  await logAvailable(device)
  await device.setCapabilityValue('location_human', driveState.place + ', ' + driveState.city)
  await device.setCapabilityValue('moving', isMoving)
  await device.setCapabilityValue('distance', distanceHomey)

  if ((isMoving || wasMoving) &&
    distanceMovedSinceTrigger > device.getSettings().retriggerRestrictDistance &&
    timeSinceTrigger > (device.getSettings().retriggerRestrictTime * 1000)) {
    await device.getDriver().triggerVehicleMoved(device, {distanceMoved: distanceMovedSinceTrigger, distanceTraveled})
    vehicles[deviceId].lastTriggerMovedOdometer = newOdometer
    vehicles[deviceId].lastTriggerMovedTime = new Date()
  }

  if (isMoving !== wasMoving) {
    if (isMoving) {
      await device.getDriver().triggerVehicleStartMoving(device, {distanceMoved: distanceMoved})
      vehicles[deviceId].route = {id: vehicles[deviceId].routeCounter + 1, start: previousLocation, end: {}}
      vehicles[deviceId].route.start.time = new Date()
    } else if (wasMoving) {
      vehicles[deviceId].route.end = newLocation
      vehicles[deviceId].route.end.time = new Date()
      await device.getDriver().triggerVehicleStoptMoving(device, {
        distanceMoved,
        distanceTraveled,
        locationStart: vehicles[deviceId].route.start.place + ', ' + vehicles[deviceId].route.start.city,
        locationStop: vehicles[deviceId].route.end.place + ', ' + vehicles[deviceId].route.end.city
      })
      vehicles[deviceId].routeCounter ++
      device.setStoreValue('routeCounter', vehicles[deviceId].routeCounter)
      if (device.getSettings().tripTracking) {
        let routes = device.getStoreValue('routes') || []
        routes.push(vehicles[deviceId].route)
        device.setStoreValue('routes', routes.slice(-100))
        vehicles[deviceId].route.start = vehicles[deviceId].route.end
      }
      delete vehicles[deviceId].route.end
    }
    if (wasMoving !== null && rescheduleOnChange) return trackController(device)
  }
}

function formatValue (t) {
  return Math.round(t.toFixed(1) * 10) / 10
}

function formatDistance (distance) {
  if (distance < 1000) return formatValue(distance) + ' m'
  return formatValue(distance / 1000) + ' km'
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
