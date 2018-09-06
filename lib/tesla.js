var http = require('http.min')
var EventEmitter = require('events')
var util = require('util')
var Osm = require('./openstreetmap.js')

const apiConsts = ['\x65\x34\x61\x39\x39\x34\x39\x66\x63\x66\x61\x30\x34\x30\x36\x38\x66\x35\x39\x61\x62\x62\x35\x61\x36\x35\x38\x66\x32\x62\x61\x63\x30\x61\x33\x34\x32\x38\x65\x34\x36\x35\x32\x33\x31\x35\x34\x39\x30\x62\x36\x35\x39\x64\x35\x61\x62\x33\x66\x33\x35\x61\x39\x65', '\x63\x37\x35\x66\x31\x34\x62\x62\x61\x64\x63\x38\x62\x65\x65\x33\x61\x37\x35\x39\x34\x34\x31\x32\x63\x33\x31\x34\x31\x36\x66\x38\x33\x30\x30\x32\x35\x36\x64\x37\x36\x36\x38\x65\x61\x37\x65\x36\x65\x37\x66\x30\x36\x37\x32\x37\x62\x66\x62\x39\x64\x32\x32\x30']
const apiEndpoint = 'https://owner-api.teslamotors.com/'
const streamingEndpoint = 'streaming.vn.teslamotors.com/stream/'

function Tesla (options) {
  var self = this
  EventEmitter.call(self)
  if (options == null) { options = {} }
  self.user = options.user
  self.password = options.password
  self.grant = options.grant || null
  self.cache = 1
  self.language = options.language || 'en'
}
util.inherits(Tesla, EventEmitter)

Tesla.prototype.login = function () {
  var self = this
  return login(self.user, self.password).then(function (grant) {
    self.grant = grant
    self.emit('grant', grant)
    return grant
  })
}

Tesla.prototype.logout = function () {
  return Promise.resolve()
}

// check if token exists and valid based on expiration
// check if token still works on api
// if one of above checks fails: aquire new grant via login
// if new grant cannot be aquired: reject
Tesla.prototype.validateGrant = function () {
  var self = this
  if (grantExpired(self.grant)) return self.login()
  return checkTokenWithRequest(self.grant.access_token).catch(() => self.login())
}

Tesla.prototype.controlAutoConditioning = function (vehicleId, state) {
  var self = this
  if (typeof state !== 'boolean') return Promise.reject('state_invalid')
  return checkActiveGrant(self).then(() =>
    postVehicleCommand(self.grant.access_token, vehicleId, `command/auto_conditioning_${state ? 'start' : 'stop'}`, null)
  )
}

Tesla.prototype.controlChargePort = function (vehicleId, portstate) {
  var self = this
  if (typeof portstate !== 'boolean') return Promise.reject('state_invalid')
  if (!portstate) return Promise.reject('chargeport_closing_not_supported')
  return checkActiveGrant(self).then(() =>
    postVehicleCommand(self.grant.access_token, vehicleId, 'command/charge_port_door_open', null)
  )
}

Tesla.prototype.controlCharging = function (vehicleId, state) {
  var self = this
  if (typeof state !== 'boolean') return Promise.reject('state_invalid')
  return checkActiveGrant(self).then(() =>
    postVehicleCommand(self.grant.access_token, vehicleId, `command/charge_${state ? 'start' : 'stop'}`, null)
  )
}

Tesla.prototype.controlDoorLock = function (vehicleId, state) {
  var self = this
  if (typeof state !== 'boolean') return Promise.reject('state_invalid')
  return checkActiveGrant(self).then(() =>
    postVehicleCommand(self.grant.access_token, vehicleId, `command/door_${state ? 'lock' : 'unlock'}`, null)
  )
}

Tesla.prototype.controlPanoRoof = function (vehicleId, roofstate) {
  var self = this
  var panoRoofStateValues = ['open', 'close', 'comfort', 'vent']
  if (panoRoofStateValues.indexOf(roofstate) < 0) return Promise.reject('roofstate_invalid')
  return checkActiveGrant(self).then(() =>
    postVehicleCommand(self.grant.access_token, vehicleId, 'command/sun_roof_control', {state: roofstate})
  )
}

Tesla.prototype.controlPanoRoofPercentage = function (vehicleId, limit) {
  var self = this
  if (isNaN(limit) || limit > 100 || limit < 0 || limit.toFixed() !== limit.toString()) return Promise.reject('limit_invalid')
  return checkActiveGrant(self).then(() =>
    postVehicleCommand(self.grant.access_token, vehicleId, 'command/sun_roof_control', {state: 'move', percent: limit})
  )
}

Tesla.prototype.controlValetMode = function (vehicleId, state, pin) {
  var self = this
  var data = {on: state}
  if (typeof state !== 'boolean') return Promise.reject('state_invalid')
  if (pin) {
    if (!(/^\d{4}$/.test(pin))) return Promise.reject('pin_not_4_digits')
    data.password = pin
  }
  return checkActiveGrant(self).then(() =>
    postVehicleCommand(self.grant.access_token, vehicleId, 'command/set_valet_mode', data)
  )
}

Tesla.prototype.flashLights = function (vehicleId) {
  var self = this
  return checkActiveGrant(self).then(() =>
    postVehicleCommand(self.grant.access_token, vehicleId, 'command/flash_lights', null)
  )
}

Tesla.prototype.getChargeState = function (vehicleId) {
  var self = this
  return checkActiveGrant(self).then(() =>
    getVehicleCommand(self.grant.access_token, vehicleId, 'data_request/charge_state')
  )
}

Tesla.prototype.getClimateState = function (vehicleId) {
  var self = this
  return checkActiveGrant(self).then(() =>
    getVehicleCommand(self.grant.access_token, vehicleId, 'data_request/climate_state')
  )
}

Tesla.prototype.getDriveState = function (vehicleId) {
  var self = this
  return checkActiveGrant(self).then(() =>
    getVehicleCommand(self.grant.access_token, vehicleId, 'data_request/drive_state')
  )
}

Tesla.prototype.getGuiSettings = function (vehicleId) {
  var self = this
  return checkActiveGrant(self).then(() =>
    getVehicleCommand(self.grant.access_token, vehicleId, 'data_request/gui_settings')
  )
}

Tesla.prototype.getLocation = function (vehicleId) {
  var self = this
  var location = {}
  return self.getDriveState(vehicleId).then((state) => {
    location.lat = state.latitude
    location.lng = state.longitude
    return Osm.geocodeLatLng(state.latitude, state.longitude, self.language)
  }).then((address) => {
    location.place = address.place
    location.city = address.city
    return location
  })
}

Tesla.prototype.getMobileAccess = function (vehicleId) {
  var self = this
  return checkActiveGrant(self).then(() =>
    getVehicleCommand(self.grant.access_token, vehicleId, 'mobile_enabled')
  )
}

Tesla.prototype.getVehicle = function (vehicleId) {
  var self = this
  return checkActiveGrant(self).then(() =>
    getVehicle(self.grant.access_token, vehicleId)
  )
}

Tesla.prototype.getVehicles = function () {
  var self = this
  return checkActiveGrant(self).then(() =>
    getVehicles(self.grant.access_token)
  )
}

Tesla.prototype.getVehicleState = function (vehicleId) {
  var self = this
  return checkActiveGrant(self).then(() =>
    getVehicleCommand(self.grant.access_token, vehicleId, 'data_request/vehicle_state')
  )
}

Tesla.prototype.honkHorn = function (vehicleId) {
  var self = this
  return checkActiveGrant(self).then(() =>
    postVehicleCommand(self.grant.access_token, vehicleId, 'command/honk_horn', null)
  )
}

Tesla.prototype.remoteStart = function (vehicleId) {
  var self = this
  if (!self.password) return Promise.reject('no_password')
  return checkActiveGrant(self).then(() =>
    postVehicleCommand(self.grant.access_token, vehicleId, 'command/remote_start_drive', {password: self.password})
  )
}

Tesla.prototype.resetValetPin = function (vehicleId) {
  var self = this
  return checkActiveGrant(self).then(() =>
    postVehicleCommand(self.grant.access_token, vehicleId, 'command/reset_valet_pin', null)
  )
}

Tesla.prototype.setAutoConditioningTemperatures = function (vehicleId, driver, passenger) {
  var self = this
  var values = {}
  if (driver) values.driver_temp = driver
  if (passenger) values.passenger_temp = passenger
  return checkActiveGrant(self).then(() =>
    postVehicleCommand(self.grant.access_token, vehicleId, 'command/set_temps', values)
  )
}

Tesla.prototype.setChargeLimit = function (vehicleId, limit) {
  var self = this
  if (isNaN(limit) || limit > 100 || limit < 1 || limit.toFixed() !== limit.toString()) return Promise.reject('limit_invalid')
  return checkActiveGrant(self).then(() =>
    postVehicleCommand(self.grant.access_token, vehicleId, 'command/set_charge_limit', {percent: limit})
  )
}

Tesla.prototype.setChargeMode = function (vehicleId, chargeModeType) {
  var self = this
  var chargeModeTypeList = ['standard', 'max_range']
  if (chargeModeTypeList.indexOf(chargeModeType.toLowerCase()) < 0) return Promise.reject('mode_invalid')
  return checkActiveGrant(self).then(() =>
    postVehicleCommand(self.grant.access_token, vehicleId, 'command/charge_' + chargeModeType.toLowerCase(), null)
  )
}

// START OF STREAMING EXPERIMENTAL CODE
Tesla.prototype.streamStart = function (vehicleId, token) {
  var self = this
  var streamingColumns = ['elevation', 'est_heading', 'est_lat', 'est_lng', 'est_range', 'heading', 'odometer', 'power', 'range', 'shift_state', 'speed', 'soc']

  function again (user, vehicle, streamingColumns) {
    console.log(new Date(), 'start again...')
    streamRequest(user, vehicle, streamingColumns, function (error, result) {
      console.log(new Date(), '...resultaat', error, result)
      setTimeout(again(user, vehicle, streamingColumns), 1000)
    })
  }

  return new Promise(function (resolve, reject) {
    self
    .getVehicle(vehicleId)
    .then(function (vehicle) {
      again(self.user, vehicle, streamingColumns)
      resolve(vehicle) // >>> TODO fix
    })
  })
}

function streamRequest (user, vehicle, columns, callback) {
  var options = {
    uri: 'https://' + user + ':' + vehicle.tokens[0] + '@' + streamingEndpoint + vehicle.vehicle_id + '/?values=' + columns.join(',')
  }
  http.get(options).then(function (result) {
    if (result.response.statusCode !== 200) return callback(result.response.statusCode)
    callback(null, result.data)
  }).catch(function (error) {
    callback(error)
  })
}
// END OF STREAMING EXPERIMENTAL CODE

Tesla.prototype.wakeUp = function (vehicleId) {
  var self = this
  return checkActiveGrant(self).then(() =>
    postVehicleCommand(self.grant.access_token, vehicleId, 'wake_up', null)
  )
}

// Validates token if token seems invalid
function checkActiveGrant (self) {
  return (grantExpired(self.grant)) ? self.login() : Promise.resolve()
}

// Returns false if token is valid, true on invalid
function grantExpired (grant) {
  if (!grant) return true
  if (!grant.access_token) return true
  if (((grant.created_at + grant.expires_in) * 1000) < new Date().getTime()) return true
  return false
}

// login function returns sessionId
function login (user, password) {
  if (!user) return Promise.reject('no_username')
  if (!password) return Promise.reject('no_password')

  var options = {
    uri: `${apiEndpoint}oauth/token`,
    json: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 9.0.0; VS985 4G Build/LRX21Y; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/58.0.3029.83 Mobile Safari/537.36',
      'X-Tesla-User-Agent': 'custom/Athom/Homey'
    },
    form: {
      grant_type: 'password',
      client_id: apiConsts[0],
      client_secret: apiConsts[1],
      email: user,
      password: password
    }
  }
  return http.post(options).then(function (result) {
    if (result.data.response) return Promise.reject(result.data.response)
    if (!result.data.access_token) return Promise.reject('no_token')
    return result.data
  })
} // end function login

function checkTokenWithRequest (token) {
  if (!token) return Promise.reject('no_token')
  var options = {
    uri: `${apiEndpoint}api/1/vehicles`,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 9.0.0; VS985 4G Build/LRX21Y; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/58.0.3029.83 Mobile Safari/537.36',
      'X-Tesla-User-Agent': 'custom/Athom/Homey',
      Authorization: `Bearer ${token}`
    },
    timeout: 30000
  }
  return http.get(options).then(function (result) {
    if (!result.response) return Promise.reject()
    if (result.response.statusCode !== 200) return Promise.reject()
    return
  })
} // end function checkTokenWithRequest

function getVehicle (token, vehicleId) {
  if (!token) return Promise.reject('no_token')
  if (!vehicleId) return Promise.reject('no_vehicleId')
  var options = {
    uri: `${apiEndpoint}api/1/vehicles/${vehicleId}`,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 9.0.0; VS985 4G Build/LRX21Y; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/58.0.3029.83 Mobile Safari/537.36',
      'X-Tesla-User-Agent': 'custom/Athom/Homey',
      Authorization: `Bearer ${token}`
    },
    timeout: 30000
  }
  return http.json(options).then(function (result) {
    if (!result.response) return Promise.reject(result.error || 'api_error')
    return result.response
  })
} // end function getVehicle

function getVehicles (token) {
  if (!token) return Promise.reject('no_token')
  var options = {
    uri: `${apiEndpoint}api/1/vehicles`,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 9.0.0; VS985 4G Build/LRX21Y; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/58.0.3029.83 Mobile Safari/537.36',
      'X-Tesla-User-Agent': 'custom/Athom/Homey',
      Authorization: `Bearer ${token}`
    },
    timeout: 30000
  }
  return http.json(options).then(function (result) {
    if (!result.response) return Promise.reject(result.error || 'api_error')
    return result.response
  })
} // end function getVehicles

function getVehicleCommand (token, vehicleId, command) {
  if (!token) return Promise.reject('no_token')
  if (!vehicleId) return Promise.reject('no_vehicleId')
  if (!command) return Promise.reject('no_command')
  var options = {
    uri: `${apiEndpoint}api/1/vehicles/${vehicleId}/${command}`,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 9.0.0; VS985 4G Build/LRX21Y; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/58.0.3029.83 Mobile Safari/537.36',
      'X-Tesla-User-Agent': 'custom/Athom/Homey',
      Authorization: `Bearer ${token}`
    },
    timeout: 30000
  }
  return http.json(options).then(function (result) {
    if (!result.response) return Promise.reject(result.error || 'api_error')
    return result.response
  })
} // end function getVehicleCommand

function postVehicleCommand (token, vehicleId, command, body) {
  if (!token) return Promise.reject('no_token')
  if (!vehicleId) return Promise.reject('no_vehicleId')
  if (!command) return Promise.reject('no_command')
  var options = {
    uri: `${apiEndpoint}api/1/vehicles/${vehicleId}/${command}`,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 9.0.0; VS985 4G Build/LRX21Y; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/58.0.3029.83 Mobile Safari/537.36',
      'X-Tesla-User-Agent': 'custom/Athom/Homey',
      Authorization: `Bearer ${token}`
    },
    form: body || null,
    json: true
  }
  return http.post(options).then(function (result) {
    if (!result.response) return Promise.reject(result.error || 'api_error')
    if (result.response.statusCode !== 200) return Promise.reject(result.response)
    return result.data.response
  })
} // end function postVehicleCommand

exports = module.exports = Tesla
