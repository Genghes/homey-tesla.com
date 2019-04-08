'use strict'

const Homey = require('homey')
const Tesla = require('../../lib/tesla.js')
const Geo = require('../../lib/geofences.js')

const mi2km = 1.609344
const retryTrackingTimeoutS = 5 * 60
const maxApiErrors = 5

let vehicles = {}
let geofences = {}

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
    geofences = Homey.ManagerSettings.get('geofences')
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
      location: null,
      geofences: []
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
      await device.trackController()
    })
    vehicles[deviceId].teslaApi.on('error', async reason => {
      vehicles[deviceId].apiErrors ++
      device.log(`error from Api, counting ${vehicles[deviceId].apiErrors} to max ${maxApiErrors}`)
      if (vehicles[deviceId].retryTrackingTimeoutId) return device.log('..allready in timeout')
      if (vehicles[deviceId].apiErrors > maxApiErrors) {
        device.error(`error counter broke treshold, timeout for ${retryTrackingTimeoutS} seconds`)
        await device.setUnavailable(`Counted ${vehicles[deviceId].apiErrors} errors on api calls to vehicle. Timeout for ${retryTrackingTimeoutS} seconds.`)
        await device.trackController()
        vehicles[deviceId].retryTrackingTimeoutId = setTimeout(async () => {
          device.log('restart tracking after api error timeout')
          await device.logAvailable()
          device.trackController()
        }, retryTrackingTimeoutS * 1000)
      }
    })
    const vehicleId = await vehicles[deviceId].teslaApi.getVehicleIdByVIN(deviceId).catch((reason) => {
      return device.getStoreValue('vehicleId')
    })
    await device.setStoreValue('vehicleId', vehicleId)
    vehicles[deviceId].vehicleId = vehicleId
    device.trackController()

    Homey.ManagerSettings.on('set', (setting) => {
      device.log('ManagerSettings > set > ', setting)
      if (setting === 'geofences') {
        geofences = Homey.ManagerSettings.get('geofences')
        device.checkGeofences()
      }
    })
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
        return device.logAvailable()
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
        case 'apiAccess':
          // not a reason for reInit in itself
          break
      }
    })

    if (reInit) {
      // restart polling 1 seconds after settings change
      setTimeout(
        device.trackController
      , 1000)
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
    vehicle.geofences = vehicles[deviceId].geofences
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

  async trackController () {
  // called after init, settings changed, changeddrivestate
    const device = this
    device.log('trackController')
    let deviceId = device.getData().id
    if (vehicles[deviceId].retryTrackingTimeoutId) clearTimeout(vehicles[deviceId].retryTrackingTimeoutId)
    vehicles[deviceId].retryTrackingTimeoutId = null
    if (vehicles[deviceId].locationTrackerIntervalObject) clearInterval(vehicles[deviceId].locationTrackerIntervalObject)
    if (vehicles[deviceId].batteryTrackerIntervalObject) clearInterval(vehicles[deviceId].batteryTrackerIntervalObject)
    if (!device.getAvailable()) return

    await device.trackBattery()
    await device.trackLocation(false)

    let settings = device.getSettings()
    let drivestate = device.getCapabilityValue('moving')
    let intervalLocation = settings.locationPolling ? (drivestate ? settings.locationIntervalDriving : settings.locationIntervalParked) : 0
    let intervalBattery = settings.batteryPolling ? settings.batteryInterval * 60 : 0

    device.log('trackController setting', {location: intervalLocation, battery: intervalBattery})
    if (intervalLocation > 0) vehicles[deviceId].locationTrackerIntervalObject = setInterval(() => device.trackLocation(), intervalLocation * 1000)
    if (intervalBattery > 0) vehicles[deviceId].batteryTrackerIntervalObject = setInterval(() => device.trackBattery(), intervalBattery * 1000)
  }

  async trackBattery () {
    const device = this
    const deviceId = device.getData().id
    const vehicleId = device.getStoreValue('vehicleId')
    let chargeState
    try {
      chargeState = await vehicles[deviceId].teslaApi.getChargeState(vehicleId)
    } catch (reason) { return device.log('trackBattery Api error') } // ignored becouse of emmitted error on teslaApi handled in onInit()
    device.log('battery', chargeState.battery_level)
    vehicles[deviceId].battery = chargeState.battery_level
    vehicles[deviceId].timeLastUpdate = new Date()
    await device.logAvailable()
    return device.setCapabilityValue('measure_battery', chargeState.battery_level)
  }

  async trackLocation (rescheduleOnChange = true) {
    // todo: make situations explicit:
    //       - first run with location and !isDriving
    //       - first run with location and isDriving
    const device = this
    const deviceId = device.getData().id
    const vehicleId = device.getStoreValue('vehicleId')
    const wasMoving = vehicles[deviceId].moving
    let previousLocation = vehicles[deviceId].location || null
    let isMoving = null
    let driveState
    let vehicleState = null
    try {
      driveState = await vehicles[deviceId].teslaApi.getDriveState(vehicleId)
      isMoving = (driveState.shift_state !== null && driveState.shift_state !== 'P')
      if (isMoving || wasMoving || wasMoving === null) vehicleState = await vehicles[deviceId].teslaApi.getVehicleState(vehicleId)
    } catch (reason) { return device.log('trackLocation Api error') } // ignored becouse of emmitted error on teslaApi handled in onInit()
    let newOdometer = (vehicleState ? vehicleState.odometer * mi2km * 1000 : ((vehicles[deviceId].location) ? vehicles[deviceId].location.odometer || 0 : 0))
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

    // !previousLocation on first try after onInit
    if (!previousLocation) previousLocation = newLocation
    if (!vehicles[deviceId].lastTriggerMovedOdometer) vehicles[deviceId].lastTriggerMovedOdometer = 0
    let distanceMoved = formatValue((newOdometer - previousLocation.odometer) || 0)
    let distanceMovedSinceTrigger = formatValue(newOdometer - vehicles[deviceId].lastTriggerMovedOdometer)
    let timeSinceTrigger = (new Date() - vehicles[deviceId].lastTriggerMovedTime) || 0
    let distanceHomeyRaw = Geo.calculateDistance(newLocation.latitude, newLocation.longitude, Homey.ManagerGeolocation.getLatitude(), Homey.ManagerGeolocation.getLongitude()) || 0
    let distanceHomeyTxt = formatDistance(distanceHomeyRaw < 1 ? 0 : distanceHomeyRaw)
    // if (!vehicles[deviceId].route.start) vehicles[deviceId].route = {id: vehicles[deviceId].routeCounter + 1, start: previousLocation}
    let distanceTraveled = (vehicles[deviceId].route.start && vehicles[deviceId].location.odometer) ? formatValue(vehicles[deviceId].location.odometer - vehicles[deviceId].route.start.odometer) : 0

    device.log('trackLocation', {isMoving, distanceMovedSinceTrigger, timeSinceTrigger, distanceTraveled})

    await device.logAvailable()
    await device.setCapabilityValue('location_human', driveState.place + ', ' + driveState.city)
    await device.setCapabilityValue('moving', isMoving)
    await device.setCapabilityValue('distance', distanceHomeyTxt)
    if (device.hasCapability('geofences')) device.checkGeofences(wasMoving === null)
    if (device.hasCapability('distance_nr')) await device.setCapabilityValue('distance_nr', formatValue(distanceHomeyRaw))
    // Homey.ManagerApi.realtime('updateLocation', JSON.stringify(vehicles[deviceId]))
    Homey.ManagerApi.realtime('updateLocation', this.getVehicle())

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
      if (wasMoving !== null && rescheduleOnChange) return device.trackController()
    }
  }

  async logAvailable () {
    const device = this
    const deviceId = device.getData().id
    if (!device.getAvailable()) await device.setAvailable()
    vehicles[deviceId].apiErrors = 0
  }

  checkGeofences (notrigger = false) {
    const device = this
    const deviceId = device.getData().id
    if (!geofences) return console.log('no geofences')
    if (!vehicles[deviceId].location || !vehicles[deviceId].location.latitude) return console.log('no valid location')

    var trackerGeofencesPrevious = vehicles[deviceId].geofences || []
    var trackerInGeofence = Geo.geofencesLocationMatch(vehicles[deviceId].location)
    vehicles[deviceId].geofences = trackerInGeofence
    device.setCapabilityValue('geofences', trackerInGeofence.length ? trackerInGeofence.map(x => geofences.find(g => g.id === x).name).sort().join(', ') : '-')
    if (notrigger) return

    trackerInGeofence.forEach(async active => {
      if (!trackerGeofencesPrevious.includes(active)) {
        await device.getDriver().triggerVehicleGeofenceEntered(device, {geofenceId: active})
      }
    })
    trackerGeofencesPrevious.forEach(async previous => {
      if (!trackerInGeofence.includes(previous)) {
        await device.getDriver().triggerVehicleGeofenceLeft(device, {geofenceId: previous})
      }
    })
  }
}

module.exports = Vehicle

function formatValue (t) {
  return Math.round(t.toFixed(1) * 10) / 10
}

function formatDistance (distance) {
  if (distance < 1000) return formatValue(distance) + ' m'
  return formatValue(distance / 1000) + ' km'
}
