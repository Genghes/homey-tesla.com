const Homey = require('homey')

exports.createAddressSpeech = function (place, city, name) {
  var result = ''
  if (name) result += Homey.__('speech.theLocationOf') + name + Homey.__('speech.is')

  if (place && city) {
    return result + place + Homey.__('speech.placeCityConjunction') + city
  } else if (city) {
    return result + city
  } else if (place) {
    return result + place
  }
  return result + Homey.__('speech.positionUnknown')
}

exports.debugLog = function (message, data) {
  var logLine = {datetime: new Date(), message: message}
  if (data) logLine.data = data

  Homey.ManagerApi.realtime('Tesla Log', logLine)
  Homey.app.log(this.epochToTimeFormatter(), message, data || '')
}

exports.epochToTimeFormatter = function (epoch) {
  if (epoch == null) epoch = new Date().getTime()
  return (new Date(epoch)).toTimeString().replace(/.*(\d{2}:\d{2}:\d{2}).*/, '$1')
}
