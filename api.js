'use strict'

const Homey = require('homey')

module.exports = [{
  description: 'Get location of Homey',
  method: 'GET',
  path: '/geofence/self',
  public: true, // todo: not public
  role: 'owner',
  fn: function (args, callback) {
    callback(null, {latitude: Homey.ManagerGeolocation.getLatitude(), longitude: Homey.ManagerGeolocation.getLongitude()})
  }
}, {
  description: 'Get all vehicles',
  method: 'GET',
  path: '/vehicles',
  public: true, // todo: not public
  role: 'owner',
  fn: function (args, callback) {
    let vehicles = []
    Object.keys(Homey.ManagerDrivers.getDrivers()).forEach(driver => {
      Homey.ManagerDrivers.getDriver(driver).getDevices().forEach(vehicle => {
        Homey.app.log('API/vehicles > ', driver, ' > ', vehicle.getData().id)
        vehicles.push(vehicle.getVehicle())
      })
    })
    callback(null, vehicles)
  }
}, {
  description: 'Test Tesla API',
  method: 'GET',
  path: '/testApi',
  public: true, // todo: not public
  role: 'owner',
  fn: function (args, callback) {
    Object.keys(Homey.ManagerDrivers.getDrivers()).forEach(driver => {
      Homey.ManagerDrivers.getDriver(driver).getDevices().forEach(vehicle => {
        Homey.app.log('API/testApi > ', driver, ' > ', vehicle.getData().id)
        vehicle.testApi()
      })
    })
    callback(null, {testApi: 'Test started.'})
  }
}]
