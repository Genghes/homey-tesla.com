'use strict'

const Homey = require('homey')
const Tesla = require('../../lib/tesla.js')

class VehicleDriver extends Homey.Driver {
  onInit () {
    // todo: move to triggers lib
    this._triggerVehicleGeofenceEntered = new Homey.FlowCardTriggerDevice('vehicleGeofenceEntered')
      .registerRunListener((args, state) => Promise.resolve(args.geofence.id === state.geofenceId))
      .register()
    this._triggerVehicleGeofenceEntered
      .getArgument('geofence')
      .registerAutocompleteListener(this.geofenceAutocomplete)
    this._triggerVehicleGeofenceLeft = new Homey.FlowCardTriggerDevice('vehicleGeofenceLeft')
      .registerRunListener((args, state) => Promise.resolve(args.geofence.id === state.geofenceId))
      .register()
    this._triggerVehicleGeofenceLeft
      .getArgument('geofence')
      .registerAutocompleteListener(this.geofenceAutocomplete)
    this._triggerVehicleMoved = new Homey.FlowCardTriggerDevice('vehicleMoved').register()
    this._triggerVehicleStartMoving = new Homey.FlowCardTriggerDevice('vehicleStartMoving').register()
    this._triggerVehicleStoptMoving = new Homey.FlowCardTriggerDevice('vehicleStoptMoving').register()
  }

  geofenceAutocomplete (value) {
    let geofences = Homey.ManagerSettings.get('geofences')
    return geofences.filter(x => x.name.toUpperCase().indexOf(value.toUpperCase() > 0))
  }

  async triggerVehicleGeofenceEntered (device, state) {
    device.log('triggerVehicleGeofenceEntered', state)
    try {
      await device.getDriver()._triggerVehicleGeofenceEntered.trigger(device, null, state)
    } catch (error) { return Promise.reject(error) }
  }

  async triggerVehicleGeofenceLeft (device, state) {
    device.log('triggerVehicleGeofenceLeft', state)
    try {
      await device.getDriver()._triggerVehicleGeofenceLeft.trigger(device, null, state)
    } catch (error) { return Promise.reject(error) }
  }

  async triggerVehicleMoved (device, tokens) {
    device.log('triggerVehicleMoved', tokens)
    try {
      await device.getDriver()._triggerVehicleMoved.trigger(device, tokens)
    } catch (error) { return Promise.reject(error) }
  }

  async triggerVehicleStartMoving (device, token) {
    device.log('triggerVehicleStartMoving')
    try {
      await device.getDriver()._triggerVehicleStartMoving.trigger(device, token)
    } catch (error) { return Promise.reject(error) }
  }

  async triggerVehicleStoptMoving (device, tokens) {
    device.log('triggerVehicleStoptMoving')
    try {
      await device.getDriver()._triggerVehicleStoptMoving.trigger(device, tokens)
    } catch (error) { return Promise.reject(error) }
  }

  onPair (socket) {
    let pairGrant
    let teslaSession
    let account
    socket.on('login', (data, callback) => {
      if (data.username === '' || data.password === '') return callback(null, false)
      account = data
      teslaSession = new Tesla({
        user: account.username,
        password: account.password
      })
      teslaSession.on('grant', newGrant => {
        this.log('Succesvol got grant in pairing')
        pairGrant = newGrant
      })
      teslaSession.login().then(function () {
        callback(null, true)
      }).catch(error => {
        console.log(error)
        callback(null, false)
      })
    })
    socket.on('list_devices', (data, callback) => {
      var devices = []
      teslaSession.getVehicles().then(vehicles => {
        if (!vehicles) return callback('errorNoVehiclesFound')
        vehicles.forEach(vehicle => {
          console.log('found a car:', vehicle)
          devices.push({
            data: {id: vehicle.vin},
            name: vehicle.display_name,
            icon: 'icon_' + vehicle.vin[3].toLowerCase() + '.svg',
            store: {
              s_id: vehicle.s_id,
              grant: pairGrant,
              username: account.username
            },
            settings: {
              password: ''
            }
          })
        })
        teslaSession.logout()
        return callback(null, devices)
      })
    })
    socket.on('add_device', (device, callback) => {
      this.log('pairing: vehicle added', device)
    })
  }
}

module.exports = VehicleDriver
