var http = require('http.min')

const osmEndpoint = 'https://nominatim.openstreetmap.org/'
const osmUserAgent = 'Homey Tesla App - https://github.com/irritanterik/homey-tesla.com'
const defaultLanguage = 'en'
const debuglog = true

exports.geocodeLatLng = function (lat, lon, language) {
  if (debuglog) console.log('geocode osm', lat, lon)
  if (!language) language = defaultLanguage
  var options = {
    protocol: 'http:',
    uri: `${osmEndpoint}reverse`,
    query: {format: 'json', lat: lat, lon: lon},
    headers: {
      'User-Agent': osmUserAgent, 'Accept-Language': language.toLowerCase()
    }
  }
  return http.json(options).then(function (result) {
    if (result.error || !result.address) return ({place: 'Unknown', city: 'Unknown'})
    return {
      place: result.address.cycleway || result.address.road || result.address.retail || result.address.footway || result.address.address29 || result.address.path || result.address.pedestrian || result.address[Object.keys(result.address)[0]],
      city: result.address.city || result.address.town || result.address.village || result.address[Object.keys(result.address)[1]]
    }
  })
}
