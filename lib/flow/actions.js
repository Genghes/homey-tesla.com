const Homey = require('homey')
const Util = require('../util.js')

const flowlist = {
  autoconditioningControl: onAutoconditioningControl,
  autoconditioningTemperature: onAutonditioningTemperature,
  chargeControl: onChargeControl,
  doorLockControl: onDoorLockControl,
  flashLights: onFlashLights,
  honk: onHonk,
  openChargePort: onOpenChargePort,
  panoroofControl: onPanoroofControl,
  remoteStartDrive: onRemoteStartDrive,
  resetValetPin: onResetValetPin,
  sayLocation: onSayLocation,
  setChargeLimit: onSetChargeLimit,
  setChargeMode: onSetChargeMode,
  setValetMode: onSetValetMode,
  setValetPin: onSetValetModeWithPin,
  wakeUp: onWakeUp
}

exports.init = function () {
  Object.keys(flowlist).forEach(flow => {
    Homey.app['action_' + flow] = new Homey.FlowCardAction(flow)
    .register()
    .registerRunListener(flowlist[flow])
  })
}

function onAutoconditioningControl (args) {
  Util.debugLog('Flow action autoconditioning control', args.device.getData().id, args.autoconditioningstate)
  return args.device.getApi().controlAutoConditioning(args.device.getStoreValue('vehicleId'), args.autoconditioningstate === 'ON')
  .then(response => Promise.resolve(true))
  .catch(reason => Promise.reject(reason))
}

function onAutonditioningTemperature (args) {
  Util.debugLog('Flow action autoconditioning temperature', args.device.getData().id, args.temp, args.temp)
  return args.device.getApi().setAutoConditioningTemperatures(args.device.getStoreValue('vehicleId'), args.temp, args.temp)
  .then(response => Promise.resolve(true))
  .catch(reason => Promise.reject(reason))
}

function onChargeControl (args) {
  Util.debugLog('Flow action charge control', args.device.getData().id, args.chargestate)
  return args.device.getApi().controlCharging(args.device.getStoreValue('vehicleId'), args.chargestate === 'ON')
  .then(response => Promise.resolve(true))
  .catch(reason => Promise.reject(reason))
}

function onDoorLockControl (args) {
  Util.debugLog('Flow action door lock control', args.device.getData().id, args.lock)
  return args.device.getApi().controlDoorLock(args.device.getStoreValue('vehicleId'), args.lock === 'LOCK')
  .then(response => Promise.resolve(true))
  .catch(reason => Promise.reject(reason))
}

function onFlashLights (args) {
  Util.debugLog('Flow action flash lights', args.device.getData().id)
  return args.device.getApi().flashLights(args.device.getStoreValue('vehicleId'))
  .then(response => Promise.resolve(true))
  .catch(reason => Promise.reject(reason))
}

function onHonk (args) {
  Util.debugLog('Flow action honk', args.device.getData().id)
  return args.device.getApi().honkHorn(args.device.getStoreValue('vehicleId'))
  .then(response => Promise.resolve(true))
  .catch(reason => Promise.reject(reason))
}

function onOpenChargePort (args) {
  Util.debugLog('Flow action open charge port', args.device.getData().id)
  return args.device.getApi().controlChargePort(args.device.getStoreValue('vehicleId'), true)
  .then(response => Promise.resolve(true))
  .catch(reason => Promise.reject(reason))
}

function onPanoroofControl (args) {
  Util.debugLog('Flow action panoroof control', args.device.getData().id, args.panoroofstate)
  return args.device.getApi().controlPanoRoof(args.device.getStoreValue('vehicleId'), args.panoroofstate)
  .then(response => Promise.resolve(true))
  .catch(reason => Promise.reject(reason))
}

function onRemoteStartDrive (args) {
  Util.debugLog('Flow action remote start drive', args.device.getData().id)
  return args.device.getApi().remoteStart(args.device.getStoreValue('vehicleId'))
  .then(response => Promise.resolve(true))
  .catch(reason => Promise.reject(reason))
}

function onResetValetPin (args) {
  Util.debugLog('Flow action reset valet pin', args.device.getData().id)
  return args.device.getApi().resetValetPin(args.device.getStoreValue('vehicleId'))
  .then(response => Promise.resolve(true))
  .catch(reason => Promise.reject(reason))
}

async function onSayLocation (args, state) {
  Util.debugLog('Flow action say location', args.device.getData().id)
  let location = await args.device.getApi().getDriveState(args.device.getStoreValue('vehicleId')) || {}
  await Homey.ManagerSpeechOutput.say(Util.createAddressSpeech(location.place, location.city, args.device.getName()))
  return Promise.resolve(true)
}

function onSetChargeLimit (args) {
  Util.debugLog('Flow action set charge limit', args.device.getData().id, args.limit)
  return args.device.getApi().setChargeLimit(args.device.getStoreValue('vehicleId'), args.limit, null)
  .then(response => Promise.resolve(true))
  .catch(reason => Promise.reject(reason))
}

function onSetChargeMode (args) {
  Util.debugLog('Flow action set charge mode', args.device.getData().id, args.chargemode)
  return args.device.getApi().setChargeMode(args.device.getStoreValue('vehicleId'), args.chargemode, null)
  .then(response => Promise.resolve(true))
  .catch(reason => Promise.reject(reason))
}

function onSetValetMode (args) {
  Util.debugLog('Flow action set valet mode', args.device.getData().id, args.valetstate)
  return args.device.getApi().controlValetMode(args.device.getStoreValue('vehicleId'), args.valetstate === 'ON', null)
  .then(response => Promise.resolve(true))
  .catch(reason => Promise.reject(reason))
}

function onSetValetModeWithPin (args) {
  Util.debugLog('Flow action set valet mode with pin', args.device.getData().id, args.pin)
  return args.device.getApi().controlValetMode(args.device.getStoreValue('vehicleId'), true, args.pin)
  .then(response => Promise.resolve(true))
  .catch(reason => Promise.reject(reason))
}

function onWakeUp (args) {
  Util.debugLog('Flow action wake up', args.device.getData().id)
  return args.device.getApi().wakeUp(args.device.getStoreValue('vehicleId'))
  .then(response => Promise.resolve(true))
  .catch(reason => Promise.reject(reason))
}
