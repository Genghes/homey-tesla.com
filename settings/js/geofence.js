// todo: rewrite javascript


let map
let drawingManager
var newGeofenceName
// var vehicles = {}
var vehicleMarkers = []
var geofences = []
var geofenceOverlays = []
var homeyMarkers = []
// var routes = []
var startMarkers = []
var endMarkers = []
var routeMarkers = []
var activeGeofenceId

async function initGeofences () {
  createMap()
  await loadHomeyLocation()
  await loadGeofences()
  loadVehicles()
  subscribeVehicleUpdates()
  // checkRoutes()
}

function centerMap (markersCollection) {
  var latlngbounds = new google.maps.LatLngBounds()
  for (var i = 0; i < markersCollection.length; i++) {
    latlngbounds.extend(markersCollection[i].position)
  }
  map.setCenter(latlngbounds.getCenter())
  map.fitBounds(latlngbounds)
}

function createMap () {
  var mapOptions = {
    zoom: 15,
    maxZoom: 20,
    center: {lat: 52, lng: 5},
    mapTypeId: 'hybrid',
    streetViewControl: false,
    fullscreenControl: false,
    rotateControl: false,
    zoomControl: true,
    tilt: 0
  }
  map = new google.maps.Map(document.getElementById('map-canvas'), mapOptions)
  google.maps.event.addListener(map, 'click', () => deselectGeofences() )

  drawingManager = new google.maps.drawing.DrawingManager({
    drawingMode: null,
    drawingControl: false,
    drawingControlOptions: {
      position: google.maps.ControlPosition.TOP_CENTER,
      drawingModes: [
        google.maps.drawing.OverlayType.CIRCLE,
        google.maps.drawing.OverlayType.POLYGON,
        google.maps.drawing.OverlayType.RECTANGLE
      ]
    },
    polygonOptions: {
      disableDoubleClickZoom: true,
      editable: false,
      draggable: false,
      strokeColor: '#00FF00',
      strokeOpacity: 0.8,
      strokeWeight: 2,
      fillColor: '#00FF00',
      fillOpacity: 0.25
    },
    circleOptions: {
      disableDoubleClickZoom: true,
      editable: false,
      draggable: false,
      strokeColor: '#FF0000',
      strokeOpacity: 0.8,
      strokeWeight: 2,
      fillColor: '#FF0000',
      fillOpacity: 0.25
    },
    rectangleOptions: {
      disableDoubleClickZoom: true,
      editable: false,
      draggable: false,
      strokeColor: '#0000FF',
      strokeOpacity: 0.8,
      strokeWeight: 2,
      fillColor: '#0000FF',
      fillOpacity: 0.25
    }
  })
  google.maps.event.addListener(drawingManager, 'rectanglecomplete', (rectangle) => {
    drawingManager.setOptions({
      drawingMode: null,
      drawingControl: false
    })
    var newGeofenceId = new Date().getTime()
    rectangle.geofenceId = newGeofenceId
    geofenceOverlays.push(rectangle)
    var newGeofence = {
      id: newGeofenceId,
      version: 2,
      name: newGeofenceName,
      source: 'USER',
      type: 'RECTANGLE',
      rectangle: {},
      active: true,
      isHome: false
    }

    if (!geofences) geofences = []
    geofences.push(newGeofence)
    activeGeofenceId = newGeofenceId
    saveGeofence(newGeofenceId)
    loadGeofences()
  })
  google.maps.event.addListener(drawingManager, 'circlecomplete', function (circle) {
    drawingManager.setOptions({
      drawingMode: null,
      drawingControl: false
    })
    // drawingManager.setMap(null)
    var newGeofenceId = new Date().getTime().toString()
    console.log('circlecomplete', newGeofenceId)
    circle.geofenceId = newGeofenceId
    geofenceOverlays.push(circle)

    var newGeofence = {
      id: newGeofenceId,
      version: 2,
      name: newGeofenceName,
      source: 'USER',
      type: 'CIRCLE',
      circle: {},
      active: true,
      isHome: false
    }
    if (!geofences) geofences = []
    geofences.push(newGeofence)
    activeGeofenceId = newGeofenceId
    saveGeofence(newGeofenceId)
    loadGeofences()
  })
  google.maps.event.addListener(drawingManager, 'polygoncomplete', function (polygon) {
    drawingManager.setOptions({
      drawingMode: null,
      drawingControl: false
    })
    var newGeofenceId = new Date().getTime()
    console.log('polygoncomplete', newGeofenceId)
    polygon.geofenceId = newGeofenceId
    geofenceOverlays.push(polygon)

    var newGeofence = {
      id: newGeofenceId,
      version: 2,
      name: newGeofenceName,
      source: 'USER',
      type: 'POLYGON',
      polygon: {},
      active: true,
      isHome: false
    }
    if (!geofences) geofences = []
    geofences.push(newGeofence)
    activeGeofenceId = newGeofenceId
    saveGeofence(newGeofenceId)
    loadGeofences()
  })
  drawingManager.setMap(map)

  google.maps.Polygon.prototype.getBounds = function () {
    var bounds = new google.maps.LatLngBounds()
    this.getPath().forEach(function (element, index) { bounds.extend(element) })
    return bounds
  }
}

async function loadHomeyLocation () {
  let home = await api('GET', '/geofence/self')
  var icon = {
    url: 'images/homey.webp',
    scaledSize: new google.maps.Size(30, 30),
    anchor: new google.maps.Point(15, 15)
  }
  var marker = new google.maps.Marker({
    map: map,
    icon: icon,
    position: new google.maps.LatLng(home.latitude, home.longitude),
    draggable: false
  })
  homeyMarkers.push(marker)
  centerMap(homeyMarkers)
}

function addGeofence () {
  // todo make homey settings compliant
  newGeofenceName = $('#newGeofence').val() // window.prompt(__('settings.geofences.labelNameGeofence'), __('settings.geofences.newGeofenceName'))
  if (!newGeofenceName) return
  if (geofenceNameExists(newGeofenceName)) {
    Homey.alert(__('settings.geofences.errorGeofenceNameUnique'))
    return addGeofence()
  }
  drawingManager.setOptions({
    drawingMode: null,
    drawingControl: true
  })
}

function changeGeofenceList () {
  deselectGeofences()
  var geofenceId = $('#listGeofences').val()
  var index = getGeofenceOverlaysIndexById(geofenceId)
  map.setCenter(geofenceOverlays[index].getBounds().getCenter())
  selectGeofence(geofenceId)
}

function deselectGeofences () {
  geofenceOverlays.forEach((gO, i) => {
    geofenceOverlays[i].setEditable(false)
    geofenceOverlays[i].setDraggable(false)
  })
  activeGeofenceId = null
}

function geofenceNameExists (checkName) {
  return (geofences.find(x => x.name.toString().toUpperCase() === checkName.toString().toUpperCase())) !== undefined
}

function saveGeofence (geofenceId) {
  if (geofenceId) {
    var index = getGeofenceOverlaysIndexById(geofenceId)
    var geoindex = getGeofenceIndexById(geofenceId)
    var path = []
    switch (geofences[geoindex].type) {
      case 'CIRCLE':
        geofences[geoindex].circle.center = {
          lat: geofenceOverlays[index].getCenter().lat(),
          lng: geofenceOverlays[index].getCenter().lng()
        }
        geofences[geoindex].circle.radius = geofenceOverlays[index].getRadius()
        break
      case 'POLYGON':
        geofenceOverlays[index].getPath().getArray().forEach(function (point) {
          path.push({lat: point.lat(), lng: point.lng()})
        })
        geofences[geoindex].polygon.path = path
        break
      case 'RECTANGLE':
        path.push({lat: geofenceOverlays[index].getBounds().getNorthEast().lat(), lng: geofenceOverlays[index].getBounds().getNorthEast().lng()})
        path.push({lat: geofenceOverlays[index].getBounds().getNorthEast().lat(), lng: geofenceOverlays[index].getBounds().getSouthWest().lng()})
        path.push({lat: geofenceOverlays[index].getBounds().getSouthWest().lat(), lng: geofenceOverlays[index].getBounds().getSouthWest().lng()})
        path.push({lat: geofenceOverlays[index].getBounds().getSouthWest().lat(), lng: geofenceOverlays[index].getBounds().getNorthEast().lng()})
        geofences[geoindex].rectangle.path = path
        break
    }
  }
  api('PUT', '/geofences', geofences)
}

function getGeofenceIndexById (geofenceId) {
  return geofences.findIndex(x => x.id == geofenceId) // eslint-disable-line
}

function getGeofenceOverlaysIndexById (geofenceId) {
  return geofenceOverlays.findIndex(x => x.geofenceId == geofenceId) // eslint-disable-line
}

async function loadGeofences () {
  let result = await api('GET', '/geofences')
  geofenceOverlays.forEach((gO, i) => geofenceOverlays[i].setMap(null))
  geofenceOverlays = []

  if (!result) return console.warn('No geofences to load!')
  geofences = result
  $('#listGeofences').find('option').remove()
  geofences.forEach(geofence => {
    $('#listGeofences').append(`<option value=${geofence.id}>${geofence.name}</option>`)
    if (geofence.type === 'CIRCLE') {
      var circle = new google.maps.Circle({
        geofenceId: geofence.id,
        disableDoubleClickZoom: true,
        editable: false,
        draggable: false,
        map: map,
        center: new google.maps.LatLng(geofence.circle.center.lat, geofence.circle.center.lng),
        strokeColor: '#FF0000',
        strokeOpacity: 0.8,
        strokeWeight: 2,
        fillColor: '#FF0000',
        fillOpacity: 0.25,
        radius: geofence.circle.radius
      })
      geofenceOverlays.push(circle)
      google.maps.event.addListener(circle, 'radius_changed', () => saveGeofence(circle.geofenceId))
      google.maps.event.addListener(circle, 'center_changed', () => saveGeofence(circle.geofenceId))
      google.maps.event.addListener(circle, 'click', () => selectGeofence(circle.geofenceId))
      google.maps.event.addListener(circle, 'dblclick', event => {
        selectGeofence(circle.geofenceId)
        renameGeofence(circle.geofenceId)
        event.stop()
      })
    } // end if circle
    if (geofence.type === 'POLYGON') {
      var polygon = new google.maps.Polygon({
        geofenceId: geofence.id,
        isDragging: false,
        disableDoubleClickZoom: true,
        editable: false,
        draggable: false,
        map: map,
        paths: geofence.polygon.path,
        strokeColor: '#00FF00',
        strokeOpacity: 0.8,
        strokeWeight: 2,
        fillColor: '#00FF00',
        fillOpacity: 0.25
      })
      geofenceOverlays.push(polygon)
      google.maps.event.addListener(polygon, 'rightclick', function (mev) {
        console.log('rightclick')
        if (mev.vertex != null && polygon.getPath().getLength() > 3) {
          this.getPath().removeAt(mev.vertex)
        }
        saveGeofence(polygon.geofenceId)
      })
      google.maps.event.addListener(polygon.getPath(), 'set_at', () => {
        console.log('set_at')
        if (!polygon.isDragging) saveGeofence(polygon.geofenceId)
      })
      google.maps.event.addListener(polygon.getPath(), 'insert_at', () => {
        console.log('insert_at')
        saveGeofence(polygon.geofenceId)
      })
      google.maps.event.addListener(polygon.getPath(), 'remove_at', () => {
        console.log('remove_at')
        saveGeofence(polygon.geofenceId)
      })
      google.maps.event.addListener(polygon, 'dragstart', () => {
        console.log('dragstart')
        polygon.isDragging = true
      })
      google.maps.event.addListener(polygon, 'dragend', () => {
        console.log('dragend')
        polygon.isDragging = false
        saveGeofence(polygon.geofenceId)
      })
      google.maps.event.addListener(polygon, 'click', () => selectGeofence(polygon.geofenceId))
      google.maps.event.addListener(polygon, 'dblclick', (event) => {
        selectGeofence(polygon.geofenceId)
        renameGeofence(polygon.geofenceId)
        event.stop()
      })
    } // end if polygon
    if (geofence.type === 'RECTANGLE') {
      var rectangle = new google.maps.Rectangle({
        geofenceId: geofence.id,
        isDragging: false,
        disableDoubleClickZoom: true,
        editable: false,
        draggable: false,
        map: map,
        bounds: {
          north: geofence.rectangle.path[0].lat,
          south: geofence.rectangle.path[2].lat,
          east: geofence.rectangle.path[0].lng,
          west: geofence.rectangle.path[2].lng
        },
        strokeColor: '#0000FF',
        strokeOpacity: 0.8,
        strokeWeight: 2,
        fillColor: '#0000FF',
        fillOpacity: 0.25
      })
      geofenceOverlays.push(rectangle)
      google.maps.event.addListener(rectangle, 'bounds_changed', () => {
        console.log('bounds_changed')
        if (!rectangle.isDragging) saveGeofence(rectangle.geofenceId)
      })
      google.maps.event.addListener(rectangle, 'dragstart', () => {
        console.log('dragstart')
        rectangle.isDragging = true
      })
      google.maps.event.addListener(rectangle, 'dragend', () => {
        console.log('dragend')
        rectangle.isDragging = false
        saveGeofence(rectangle.geofenceId)
      })
      google.maps.event.addListener(rectangle, 'click', () => selectGeofence(rectangle.geofenceId))
      google.maps.event.addListener(rectangle, 'dblclick', (event) => {
        selectGeofence(rectangle.geofenceId)
        renameGeofence(rectangle.geofenceId)
        event.stop()
      })
    } // end if rectangle
  })
  if (geofences) $('#listGeofences').val(activeGeofenceId || geofenceOverlays[0].geofenceId)
}

function selectGeofence (geofenceId) {
  deselectGeofences(activeGeofenceId)
  activeGeofenceId = geofenceId
  $('#listGeofences').val(activeGeofenceId)
  var index = getGeofenceOverlaysIndexById(activeGeofenceId)
  var geoIndex = getGeofenceIndexById(activeGeofenceId)
  geofenceOverlays[index].setEditable(true)
  if (geofences[geoIndex].type === 'POLYGON' ||
      geofences[geoIndex].type === 'RECTANGLE') {
    geofenceOverlays[index].setDraggable(true)
  }
}

function loadVehicles () {
  vehicleMarkers = []
  // vehicles allready in vehicles
  vehicles.forEach((vehicle, index) => {
    if (vehicle.location && vehicle.location.latitude) {
      var vehicleLocation = new google.maps.LatLng(vehicle.location.latitude, vehicle.location.longitude)
      var vehicleMarker = new google.maps.Marker({
        position: vehicleLocation,
        map: null,
        draggable: false
      })
      vehicleMarker.vehicleId = vehicle.id
      vehicleMarker.infowindow = new google.maps.InfoWindow({
        content: vehicleInfoWindow(vehicle)
      })
      google.maps.event.addListener(vehicleMarker, 'click', function () {
        vehicleMarker.infowindow.open(map, vehicleMarker)
      })
      vehicleMarkers.push(vehicleMarker)
    }
  })
  showVehicles()
}

function showVehicles () {
  vehicleMarkers.forEach(function (marker) {
    marker.setMap(map)
      // icon: new google.maps.MarkerImage('https://maps.google.com/mapfiles/ms/icons/green-dot.png'),
    if (vehicles.find(x => x.id === marker.vehicleId).moving) {
      marker.setIcon('https://maps.google.com/mapfiles/ms/icons/green-dot.png')
    } else {
      marker.setIcon('https://maps.google.com/mapfiles/ms/icons/red-dot.png')
    }
  })
  // todo: this recenter is annoying
  centerMap(vehicleMarkers.concat(homeyMarkers))
}

function vehicleInfoWindow (vehicle) {
  return `<strong>${vehicle.name}</strong><br>${vehicle.location.city} - ${vehicle.location.place}`
}

function subscribeVehicleUpdates () {
  // todo normalise vehicle update / new vehicle / etc
  if (mode !== 'private') return
  Homey.on('updateLocation', function (data) {
    console.log('Vehicle: new location ', data)
    vehicles[vehicles.findIndex(x => x.id === data.id)] = data
    let x = vehicleMarkers.find(marker => marker.vehicleId === data.id)
    if (!x) return

    x.setPosition(new google.maps.LatLng(data.location.latitude, data.location.longitude))
    x.infowindow.setContent(vehicleInfoWindow(data))
    showVehicles()
    // todo: rename
    vehicleTable.clear()
    showVehicle(data)
  })
}
