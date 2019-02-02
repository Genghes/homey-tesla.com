'use strict'

const Homey = require('homey')
// const Geofences = require('./lib/geofences.js')
const FlowActions = require('./lib/flow/actions.js')
const FlowConditions = require('./lib/flow/conditions.js')
// const FlowTriggers = require('./lib/flow/triggers.js')

class TeslaApp extends Homey.App {
  onInit () {
    // Geofences.geofencesInitiationOnAppStart()
    // FlowTriggers.init()
    FlowConditions.init()
    FlowActions.init()
  }
}

module.exports = TeslaApp
