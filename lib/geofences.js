const Homey = require('homey')
const Inside = require('point-in-polygon')

const geofenceVersion = 2
const geofenceRadiusDefault = 50

exports.calculateDistance = function (lat1, lon1, lat2, lon2, unit) {
  // based on https://www.geodatasource.com/developers/javascript
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0
  unit = (unit || 'M').toUpperCase()
  var radlat1 = Math.PI * lat1 / 180
  var radlat2 = Math.PI * lat2 / 180
  var theta = lon1 - lon2
  var radtheta = Math.PI * theta / 180
  var dist = Math.sin(radlat1) * Math.sin(radlat2) + Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta)
  dist = Math.acos(dist)
  dist = dist * 180 / Math.PI
  dist = dist * 60 * 1.1515 // result in Miles per default
  if (unit === 'K') { dist = dist * 1.609344 }
  if (unit === 'M') { dist = dist * 1.609344 * 1000 }
  if (unit === 'N') { dist = dist * 0.8684 }
  return dist
}

exports.geofencesFilteredList = function (value) {
  let list = []
  let geofences = Homey.ManagerSettings.get('geofences')
  if (!geofences) return list
  Object.keys(geofences).forEach(geofenceId => {
    list.push({id: geofenceId, name: geofences[geofenceId].name, geofenceId: geofenceId})
  })
  return list.filter((item) => item.name.toLowerCase().includes(value.toLowerCase())).sort((a, b) => (a.name > b.name ? 1 : -1))
}

exports.geofencesInitiationOnAppStart = function () {
  let geofences = Homey.ManagerSettings.get('geofences')
  if (geofences && !geofences.length) {
    // convert v1 geofences structure to v2 {} to v2 []
    let v2Geofences = []
    Object.keys(geofences).forEach(id => {
      var item = geofences[id]
      item.id = id.toString()
      v2Geofences.push(item)
    })
    return Homey.ManagerSettings.set('geofences', v2Geofences)
  }
  if (geofences) return
  geofences = []
  geofences.push(getHomeyGeofenceDefault())
  Homey.ManagerSettings.set('geofences', geofences)
}

exports.geofencesLocationMatch = function (location) {
  let result = []
  let geofences = Homey.ManagerSettings.get('geofences')
  if (!geofences) return result
  geofences.forEach(geofence => {
    var locationMatch = false
    switch (geofence.type) {
      case 'CIRCLE':
        let distance = this.calculateDistance(
          location.latitude, location.longitude,
          geofence.circle.center.lat, geofence.circle.center.lng,
          'M'
        )
        locationMatch = !!(distance < geofence.circle.radius)
        break
      case 'POLYGON':
        locationMatch = Inside([location.latitude, location.longitude], geofence.polygon.path.map(point => [point.lat, point.lng]))
        break
      case 'RECTANGLE':
        locationMatch = Inside([location.latitude, location.longitude], geofence.rectangle.path.map(point => [point.lat, point.lng]))
    }
    if (locationMatch) result.push(geofence.id)
  })
  return result
}

function getHomeyGeofenceDefault () {
  return {
    id: new Date().getTime().toString(),
    version: geofenceVersion,
    name: Homey.__('defaultGeofenceName'),
    source: 'DEFAULT',
    type: 'CIRCLE',
    circle: {
      radius: geofenceRadiusDefault,
      center: {
        lat: Homey.ManagerGeolocation.getLatitude() || 52,
        lng: Homey.ManagerGeolocation.getLongitude() || 5
      }
    },
    active: true,
    isHome: true
  }
} // end of getGeofenceDefault function
