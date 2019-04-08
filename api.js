'use strict'

const Homey = require('homey')

const noApiAccess = false

function checkApiAccess (response) {
  let apiAccess = false
  Object.keys(Homey.ManagerDrivers.getDrivers()).forEach(driver => {
    Homey.ManagerDrivers.getDriver(driver).getDevices().forEach(vehicle => {
      apiAccess = vehicle.getSettings().apiAccess || apiAccess
    })
  })
  return apiAccess ? response : noApiAccess
}

function getApiKey () {
  return Homey.env.MAPSAPIKEY
}

function getGeofenceSelf () {
  return {latitude: Homey.ManagerGeolocation.getLatitude(), longitude: Homey.ManagerGeolocation.getLongitude()}
}

function getVehicles () {
  let vehicles = []
  Object.keys(Homey.ManagerDrivers.getDrivers()).forEach(driver => {
    Homey.ManagerDrivers.getDriver(driver).getDevices().forEach(vehicle => {
      Homey.app.log('API/vehicles > ', driver, ' > ', vehicle.getData().id)
      vehicles.push(vehicle.getVehicle())
    })
  })
  return vehicles
}

function testVehiclesApi () {
  Object.keys(Homey.ManagerDrivers.getDrivers()).forEach(driver => {
    Homey.ManagerDrivers.getDriver(driver).getDevices().forEach(vehicle => {
      Homey.app.log('API/testApi > ', driver, ' > ', vehicle.getData().id)
      vehicle.testApi()
    })
  })
  return {status: 'ok'}
}

async function url () {
  let homeyId = await Homey.ManagerCloud.getHomeyId()
  let homeyIp = await Homey.ManagerCloud.getLocalAddress()
  return [`https://${homeyId}.connect.athom.com/app/com.tesla/settings/`, `http://${homeyIp}/app/com.tesla/settings/`]
}

module.exports = [{
  description: 'Get api access status',
  method: 'GET',
  path: '/apiAccess',
  public: true,
  role: 'owner',
  fn: function (args, callback) {
    callback(null, checkApiAccess(true))
  }
}, {
  description: 'Get maps api keys',
  method: 'GET',
  path: '/apiKey',
  public: false,
  role: 'owner',
  fn: function (args, callback) {
    callback(null, checkApiAccess(getApiKey()))
  }
}, {
  description: 'Get maps api keys',
  method: 'GET',
  path: '/public/apiKey',
  public: true,
  role: 'owner',
  fn: function (args, callback) {
    callback(null, checkApiAccess(getApiKey()))
  }
}, {
  description: 'Save all geofences',
  method: 'PUT',
  path: '/geofences',
  public: false,
  role: 'owner',
  fn: function (args, callback) {
    if (!args.body.data) return callback('invalid request data')
    let newGeofences
    try {
      newGeofences = JSON.parse(args.body.data)
    } catch (reason) {
      return callback('invalid geofence input')
    }
    Homey.ManagerSettings.set('geofences', newGeofences)
    callback(null, true)
  }
}, {
  description: 'Save all geofences',
  method: 'PUT',
  path: '/public/geofences',
  public: true,
  role: 'owner',
  fn: function (args, callback) {
    if (!args.body.data) return callback('invalid request data')
    let newGeofences
    try {
      newGeofences = JSON.parse(args.body.data)
    } catch (reason) {
      return callback('invalid geofence input')
    }
    if (!checkApiAccess(true)) return callback(null, false)
    Homey.ManagerSettings.set('geofences', newGeofences)
    callback(null, true)
  }
}, {
  description: 'Get all geofences',
  method: 'GET',
  path: '/geofences',
  public: false,
  role: 'owner',
  fn: function (args, callback) {
    callback(null, Homey.ManagerSettings.get('geofences'))
  }
}, {
  description: 'Get all geofences (public)',
  method: 'GET',
  path: '/public/geofences',
  public: true,
  role: 'owner',
  fn: function (args, callback) {
    callback(null, checkApiAccess(Homey.ManagerSettings.get('geofences')))
  }
}, {
  description: 'Get location of Homey',
  method: 'GET',
  path: '/geofence/self',
  public: false,
  role: 'owner',
  fn: function (args, callback) {
    callback(null, getGeofenceSelf())
  }
}, {
  description: 'Get location of Homey',
  method: 'GET',
  path: '/public/geofence/self',
  public: true,
  role: 'owner',
  fn: function (args, callback) {
    callback(null, checkApiAccess(getGeofenceSelf()))
  }
}, {
  description: 'Get all vehicles',
  method: 'GET',
  path: '/vehicles',
  public: false,
  role: 'owner',
  fn: function (args, callback) {
    callback(null, getVehicles())
  }
}, {
  description: 'Get all vehicles',
  method: 'GET',
  path: '/public/vehicles',
  public: true,
  role: 'owner',
  fn: function (args, callback) {
    callback(null, checkApiAccess(getVehicles()))
  }
}, {
  description: 'Test Tesla API',
  method: 'GET',
  path: '/testApi',
  public: false,
  role: 'owner',
  fn: function (args, callback) {
    callback(null, testVehiclesApi())
  }
}, {
  description: 'Test Tesla API',
  method: 'GET',
  path: '/public/testApi',
  public: true,
  role: 'owner',
  fn: function (args, callback) {
    callback(null, checkApiAccess(testVehiclesApi()))
  }
}, {
  description: 'Get settings url',
  method: 'GET',
  path: '/url',
  public: false,
  role: 'owner',
  fn: async function (args, callback) {
    callback(null, await url())
  }
}]
