/* global Homey */
var Tesla = require('./lib/tesla.js')

module.exports = [{
  // validate account for use with settings page
  description: 'Validate Tesla account settings',
  method: 'GET',
  path:	'/validate/account',
  requires_authorization: true,
  role: 'owner',
  fn: function (callback, args) {
    var tesla = new Tesla({
      user: args.query.user,
      password: args.query.password
    })
    tesla.on('grant', (newGrant) => {
      Homey.manager('settings').set('teslaGrant', newGrant)
    })
    tesla.login().then(function () {
      callback(null, true)
      tesla.logout()
    }).catch(callback)
  }
}, {
  description: 'Get location of Homey',
  method: 'GET',
  path: '/geofence/self',
  requires_authorization: true,
  role: 'owner',
  fn: function (callback, args) {
    Homey.manager('geolocation').getLocation(callback)
  }
}, {
  description: 'Get latest api grant',
  method: 'GET',
  path: '/grant',
  requires_authorization: true,
  role: 'owner',
  fn: function (callback, args) {
    callback(null, Homey.manager('settings').get('teslaGrant'))
  }
}, {
  description: 'Get all vehicles',
  method: 'GET',
  path: '/vehicles',
  requires_authorization: true,
  role: 'owner',
  fn: function (callback, args) {
    callback(null, Homey.manager('drivers').getDriver('models').getVehicles())
  }
}]
