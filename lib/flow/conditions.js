'use strict'

const Homey = require('homey')
const Util = require('../util.js')
// const Geofences = require('../geofences.js')

const flowlist = {
  autoConditioningState: onConditionAutoConditioningState,
  driverTempSettingValue: onConditionDriverTempSettingValue,
  panoroofState: onConditionPanoroofState,
  vehicleMoving: onConditionVehicleMoving
}

exports.init = async function () {
  Object.keys(flowlist).forEach(flow => {
    Homey.app['condition_' + flow] = new Homey.FlowCardCondition(flow)
    .register()
    .registerRunListener(flowlist[flow])
  })

  Homey.app.condition_magicApiConditions = await new Homey.FlowCardCondition('magicApiConditions')
  .register().registerRunListener(onConditionMagicApiConditions)
  Homey.app.condition_magicApiConditions.getArgument('apiValue')
  .registerAutocompleteListener(onConditionMagicApiConditionsApiValueAutocomplete)
  Homey.app.condition_magicApiConditions.getArgument('conditionType')
  .registerAutocompleteListener(onConditionMagicApiConditionsConditionTypeAutocomplete)

  // todo: reimplement geofence
  Homey.app.condition_vehicleGeofence = new Homey.FlowCardCondition('vehicleGeofence')
  .register().registerRunListener(onConditionVehicleGeofence)
  Homey.app.condition_vehicleGeofence.getArgument('geofence')
  .registerAutocompleteListener(geofenceAutocomplete)
}

function onConditionAutoConditioningState (args) {
  Util.debugLog('Flow condition auto conditioning state', args.device.getData().id)
  return args.device.getApi().getClimateState(args.device.getStoreValue('vehicleId'))
  .then(state => Promise.resolve(state.is_auto_conditioning_on || false))
  .catch(reason => Promise.reject(reason))
}

function onConditionDriverTempSettingValue (args) {
  Util.debugLog('Flow condition driver temp setting value', args.device.getData().id, args.temperature)
  return args.device.getApi().getClimateState(args.device.getStoreValue('vehicleId'))
  .then(state => Promise.resolve(state.driver_temp_setting > args.temperature))
  .catch(reason => Promise.reject(reason))
}

function onConditionMagicApiConditions (args) {
  Homey.app.log('Flow condition magic api conditions', args.device.getData().id, args.apiValue, args.conditionType, args.conditionValue)
  Homey.app.log('---------------------------------------------------------')
  if (!args.apiValue) return Promise.reject('missing_apiValue')
  if (!args.conditionType) return Promise.reject('missing_conditionType')
  if (!args.conditionValue) return Promise.reject('missing_conditionValue')

  let apiMethod = args.apiValue.id.split('.')[0]
  let apiValue = args.apiValue.id.split('.')[1]
  let conditionValue = args.conditionValue.toLowerCase()

  if (ApiOptionsDefinitions[args.apiValue.id].type !== args.conditionType.id.split('.')[0]) {
    return Promise.reject('inconsistent_value_condition')
  }
  switch (args.conditionType.id) {
    case 'boolean.equals':
      Homey.app.log('check type boolean', typeof conditionValue, conditionValue === 'false' || conditionValue === 'true')
      if (conditionValue !== 'false' && conditionValue !== 'true') return Promise.reject('condition_value_not_true_or_false')
      break
    case 'number.equals':
    case 'number.above':
    case 'number.below':
      Homey.app.log('check type number', typeof conditionValue, !isNaN(conditionValue))
      if (isNaN(conditionValue)) return Promise.reject('condition_value_invalid_number')
      break
  }

  return args.device.getApi()[apiMethod](args.device.getStoreValue('vehicleId'))
  .then((response) => {
    Homey.app.log('Magic api condition returned value:', apiValue, response, response[apiValue])
    var isNull = response[apiValue] === null || response[apiValue] === undefined
    switch (args.conditionType.id) {
      case 'boolean.equals':
        return Promise.resolve((!isNull && response[apiValue].toString() === conditionValue))
      case 'boolean.known':
      case 'string.known':
      case 'number.known':
        return Promise.resolve(!isNull)
      case 'string.equals':
        return Promise.resolve((!isNull && response[apiValue].toLowerCase() === conditionValue))
      case 'string.contains':
        return Promise.resolve((!isNull && response[apiValue].toLowerCase().includes(conditionValue)))
      case 'string.above':
        return Promise.resolve((!isNull && response[apiValue].toLowerCase() > conditionValue))
      case 'string.below':
        return Promise.resolve((!isNull && response[apiValue].toLowerCase() < conditionValue))
      case 'number.equals':
        return Promise.resolve((!isNull && response[apiValue] == conditionValue))   // eslint-disable-line
      case 'number.above':
        return Promise.resolve((!isNull && response[apiValue] > conditionValue))
      case 'number.below':
        return Promise.resolve((!isNull && response[apiValue] < conditionValue))
    }
    return Promise.reject('unknown_conditionType')
  })
  .catch(Promise.reject)
}

function onConditionMagicApiConditionsApiValueAutocomplete (value) {
  var list = []
  Object.keys(ApiOptionsDefinitions).forEach(function (id) {
    if (ApiOptionsDefinitions[id].ignore) return
    var itemName = id.split('.')[1].replace(/_{1,}/g, ' ').replace(/(\s{1,}|\b)(\w)/g, (m, space, letter) => space + letter.toUpperCase())
    list.push({id: id, name: itemName})
  })
  return Promise.resolve(
    list
    .filter((item) => item.name.toLowerCase().includes(value.toLowerCase()))
    .sort((a, b) => (a.name > b.name ? 1 : -1))
  )
}

function onConditionMagicApiConditionsConditionTypeAutocomplete (value, args) {
  if (args.apiValue === '') return Promise.reject('no_field_selected')
  return Promise.resolve(
    ApiConditionList
    .filter((item) => item.id.includes(ApiOptionsDefinitions[args.apiValue.id].type + '.'))
    .sort((a, b) => (a.name > b.name ? 1 : -1))
  )
}

async function onConditionPanoroofState (args) {
  Util.debugLog('Flow condition panoroof state', args.device.getData().id)
  return args.device.getApi().getVehicleState(args.device.getStoreValue('vehicleId')).then(state => {
    if (state.sun_roof_installed === 0) return Promise.reject(new Error('no panaroof installed'))
    return Promise.resolve(state.sun_roof_percent_open > 0)
  })
  .catch(reason => Promise.reject(reason))
}

function onConditionVehicleGeofence (args) {
  Util.debugLog('Flow condition vehicle geofence', args.device.getData().id)
  console.log('geofences active', args.device.getVehicle().geofences)
  return Promise.resolve(args.device.getVehicle().geofences.includes(args.geofence.id))
   // Homey.manager('drivers').getDriver(args.device.homeyDriverName).getVehicles()[args.device.id].geofences.indexOf(args.geofence.geofenceId) !== -1)
}

function geofenceAutocomplete (value) {
  let geofences = Homey.ManagerSettings.get('geofences')
  return geofences.filter(x => x.name.toUpperCase().indexOf(value.toUpperCase() > 0))
}

function onConditionVehicleMoving (args) {
  Util.debugLog('Flow condition vehicle moving', args.device.getData().id)
  return Promise.resolve(args.device.getVehicle().moving)
}

const ApiConditionList = [
  {id: 'boolean.equals', name: 'Equals (boolean)'},
  {id: 'boolean.known', name: 'Is known'},
  {id: 'string.equals', name: 'Equals (string)'},
  {id: 'string.contains', name: 'Contains'},
  {id: 'string.above', name: 'Above (alphabetic)'},
  {id: 'string.below', name: 'Below (alphabetic)'},
  {id: 'string.known', name: 'Is known'},
  {id: 'number.equals', name: 'Equals (number)'},
  {id: 'number.above', name: 'Above (number)'},
  {id: 'number.below', name: 'Below (number)'},
  {id: 'number.known', name: 'Is known'}
]

const ApiOptionsDefinitions = {
  'getVehicle.id': {ignore: true, type: 'number', units: null},
  'getVehicle.vehicle_id': {ignore: true, type: 'number', units: null},
  'getVehicle.vin': {ignore: false, type: 'string', units: null},
  'getVehicle.display_name': {ignore: false, type: 'string', units: null},
  'getVehicle.option_codes': {ignore: false, type: 'string', units: null},
  'getVehicle.color': {ignore: false, type: 'string', units: null},
  'getVehicle.tokens': {ignore: true, type: 'object', units: null},
  'getVehicle.state': {ignore: false, type: 'string', units: null},
  'getVehicle.in_service': {ignore: false, type: 'boolean', units: null},
  'getVehicle.id_s': {ignore: true, type: 'string', units: null},
  'getVehicle.remote_start_enabled': {ignore: false, type: 'boolean', units: null},
  'getVehicle.calendar_enabled': {ignore: false, type: 'boolean', units: null},
  'getVehicle.notifications_enabled': {ignore: false, type: 'boolean', units: null},
  'getVehicle.backseat_token': {ignore: true, type: 'object', units: null},
  'getVehicle.backseat_token_updated_at': {ignore: true, type: 'object', units: null},
  'getGuiSettings.gui_distance_units': {ignore: false, type: 'string', units: null},
  'getGuiSettings.gui_temperature_units': {ignore: false, type: 'string', units: null},
  'getGuiSettings.gui_charge_rate_units': {ignore: false, type: 'string', units: null},
  'getGuiSettings.gui_24_hour_time': {ignore: false, type: 'boolean', units: null},
  'getGuiSettings.gui_range_display': {ignore: false, type: 'string', units: null},
  'getClimateState.inside_temp': {ignore: false, type: 'number', units: 'celcius'},
  'getClimateState.outside_temp': {ignore: false, type: 'number', units: 'celcius'},
  'getClimateState.driver_temp_setting': {ignore: false, type: 'number', units: 'celcius'},
  'getClimateState.passenger_temp_setting': {ignore: false, type: 'number', units: 'celcius'},
  'getClimateState.left_temp_direction': {ignore: false, type: 'number', units: null},
  'getClimateState.right_temp_direction': {ignore: false, type: 'number', units: null},
  'getClimateState.is_auto_conditioning_on': {ignore: false, type: 'boolean', units: null},
  'getClimateState.is_front_defroster_on': {ignore: false, type: 'boolean', units: null},
  'getClimateState.is_rear_defroster_on': {ignore: false, type: 'boolean', units: null},
  'getClimateState.fan_status': {ignore: false, type: 'number', units: null},
  'getClimateState.is_climate_on': {ignore: false, type: 'boolean', units: null},
  'getClimateState.min_avail_temp': {ignore: false, type: 'number', units: 'celcius'},
  'getClimateState.max_avail_temp': {ignore: false, type: 'number', units: 'celcius'},
  'getClimateState.seat_heater_left': {ignore: false, type: 'number', units: null},
  'getClimateState.seat_heater_right': {ignore: false, type: 'number', units: null},
  'getClimateState.seat_heater_rear_left': {ignore: false, type: 'number', units: null},
  'getClimateState.seat_heater_rear_right': {ignore: false, type: 'number', units: null},
  'getClimateState.seat_heater_rear_center': {ignore: false, type: 'number', units: null},
  'getClimateState.seat_heater_rear_right_back': {ignore: false, type: 'number', units: null},
  'getClimateState.seat_heater_rear_left_back': {ignore: false, type: 'number', units: null},
  'getClimateState.smart_preconditioning': {ignore: false, type: 'boolean', units: null},
  'getChargeState.charging_state': {ignore: false, type: 'string', units: null},
  'getChargeState.battery_current': {ignore: false, type: 'number', units: 'amp'},
  'getChargeState.battery_level': {ignore: false, type: 'number', units: 'percentage'},
  'getChargeState.battery_range': {ignore: false, type: 'number', units: 'miles'},
  'getChargeState.charge_current_request': {ignore: false, type: 'number', units: 'amp'},
  'getChargeState.charge_to_max_range': {ignore: false, type: 'boolean', units: null},
  'getChargeState.battery_heater_on': {ignore: false, type: 'boolean', units: null},
  'getChargeState.not_enough_power_to_heat': {ignore: false, type: 'boolean', units: null},
  'getChargeState.charge_current_request_max': {ignore: false, type: 'number', units: 'amp'},
  'getChargeState.fast_charger_present': {ignore: false, type: 'boolean', units: null},
  'getChargeState.fast_charger_type': {ignore: false, type: 'string', units: null},
  'getChargeState.charge_energy_added': {ignore: false, type: 'number', units: 'kw'},
  'getChargeState.charge_limit_soc': {ignore: false, type: 'number', units: 'percentage'},
  'getChargeState.charge_limit_soc_max': {ignore: false, type: 'number', units: 'percentage'},
  'getChargeState.charge_limit_soc_min': {ignore: false, type: 'number', units: 'percentage'},
  'getChargeState.charge_limit_soc_std': {ignore: false, type: 'number', units: 'percentage'},
  'getChargeState.charge_miles_added_ideal': {ignore: false, type: 'number', units: 'miles'},
  'getChargeState.charge_miles_added_rated': {ignore: false, type: 'number', units: 'miles'},
  'getChargeState.charge_rate': {ignore: false, type: 'number', units: null},
  'getChargeState.charger_actual_current': {ignore: false, type: 'number', units: null},
  'getChargeState.charger_phases': {ignore: false, type: 'number', units: null},
  'getChargeState.charger_pilot_current': {ignore: false, type: 'number', units: null},
  'getChargeState.charger_power': {ignore: false, type: 'number', units: 'amp'},
  'getChargeState.charger_voltage': {ignore: false, type: 'number', units: 'volt'},
  'getChargeState.est_battery_range': {ignore: false, type: 'number', units: 'miles'},
  'getChargeState.trip_charging': {ignore: false, type: 'boolean', units: null},
  'getChargeState.ideal_battery_range': {ignore: false, type: 'number', units: 'miles'},
  'getChargeState.charge_port_door_open': {ignore: false, type: 'boolean', units: null},
  'getChargeState.motorized_charge_port': {ignore: false, type: 'boolean', units: null},
  'getChargeState.managed_charging_start_time': {ignore: false, type: 'number', units: null},
  'getChargeState.scheduled_charging_pending': {ignore: false, type: 'boolean', units: null},
  'getChargeState.user_charge_enable_request': {ignore: false, type: 'string', units: null},
  'getChargeState.charge_enable_request': {ignore: false, type: 'boolean', units: null},
  'getChargeState.eu_vehicle': {ignore: false, type: 'boolean', units: null},
  'getChargeState.max_range_charge_counter': {ignore: false, type: 'number', units: null},
  'getChargeState.charge_port_latch': {ignore: false, type: 'string', units: null},
  'getChargeState.scheduled_charging_start_time': {ignore: false, type: 'number', units: null},
  'getChargeState.time_to_full_charge': {ignore: false, type: 'number', units: null},
  'getChargeState.managed_charging_active': {ignore: false, type: 'boolean', units: null},
  'getChargeState.managed_charging_user_canceled': {ignore: false, type: 'boolean', units: null},
  'getChargeState.usable_battery_level': {ignore: false, type: 'number', units: 'percentage'},
  'getDriveState.shift_state': {ignore: false, type: 'string', units: null},
  'getDriveState.speed': {ignore: false, type: 'number', units: 'miles'},
  'getDriveState.latitude': {ignore: true, type: 'number', units: null},
  'getDriveState.longitude': {ignore: true, type: 'number', units: null},
  'getDriveState.heading': {ignore: true, type: 'number', units: null},
  'getDriveState.gps_as_of': {ignore: true, type: 'number', units: null},
  'getVehicleState.api_version': {ignore: false, type: 'number', units: null},
  'getVehicleState.autopark_state': {ignore: false, type: 'string', units: null},
  'getVehicleState.autopark_state_v2': {ignore: false, type: 'string', units: null},
  'getVehicleState.autopark_style': {ignore: false, type: 'string', units: null},
  'getVehicleState.calendar_supported': {ignore: false, type: 'boolean', units: null},
  'getVehicleState.car_type': {ignore: false, type: 'string', units: null},
  'getVehicleState.car_version': {ignore: false, type: 'string', units: null},
  'getVehicleState.center_display_state': {ignore: false, type: 'number', units: null},
  'getVehicleState.dark_rims': {ignore: false, type: 'boolean', units: null},
  'getVehicleState.df': {ignore: false, type: 'number', units: null},
  'getVehicleState.dr': {ignore: false, type: 'number', units: null},
  'getVehicleState.exterior_color': {ignore: false, type: 'string', units: null},
  'getVehicleState.ft': {ignore: false, type: 'number', units: null},
  'getVehicleState.has_spoiler': {ignore: false, type: 'boolean', units: null},
  'getVehicleState.homelink_nearby': {ignore: false, type: 'boolean', units: null},
  'getVehicleState.last_autopark_error': {ignore: false, type: 'string', units: null},
  'getVehicleState.locked': {ignore: false, type: 'boolean', units: null},
  'getVehicleState.notifications_supported': {ignore: false, type: 'boolean', units: null},
  'getVehicleState.odometer': {ignore: false, type: 'number', units: 'miles'},
  'getVehicleState.parsed_calendar_supported': {ignore: false, type: 'boolean', units: null},
  'getVehicleState.perf_config': {ignore: false, type: 'string', units: null},
  'getVehicleState.pf': {ignore: false, type: 'number', units: null},
  'getVehicleState.pr': {ignore: false, type: 'number', units: null},
  'getVehicleState.rear_seat_heaters': {ignore: false, type: 'number', units: null},
  'getVehicleState.rear_seat_type': {ignore: false, type: 'number', units: null},
  'getVehicleState.remote_start': {ignore: false, type: 'boolean', units: null},
  'getVehicleState.remote_start_supported': {ignore: false, type: 'boolean', units: null},
  'getVehicleState.rhd': {ignore: false, type: 'boolean', units: null},
  'getVehicleState.roof_color': {ignore: false, type: 'string', units: null},
  'getVehicleState.rt': {ignore: false, type: 'number', units: null},
  'getVehicleState.seat_type': {ignore: false, type: 'number', units: null},
  'getVehicleState.spoiler_type': {ignore: false, type: 'string', units: null},
  'getVehicleState.sun_roof_installed': {ignore: false, type: 'number', units: null},
  'getVehicleState.sun_roof_percent_open': {ignore: false, type: 'number', units: null},
  'getVehicleState.sun_roof_state': {ignore: false, type: 'string', units: null},
  'getVehicleState.third_row_seats': {ignore: false, type: 'string', units: null},
  'getVehicleState.valet_mode': {ignore: false, type: 'boolean', units: null},
  'getVehicleState.valet_pin_needed': {ignore: false, type: 'boolean', units: null},
  'getVehicleState.vehicle_name': {ignore: false, type: 'string', units: null},
  'getVehicleState.wheel_type': {ignore: false, type: 'string', units: null}
}
