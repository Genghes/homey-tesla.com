'use strict'

const Homey = require('homey')
const Tesla = require('../../lib/tesla.js')

class VehicleDriver extends Homey.Driver {
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
