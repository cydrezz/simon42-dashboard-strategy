// ====================================================================
// VIEW STRATEGY - RAUM (generiert Raum-Details mit Sensor-Badges) - OPTIMIERT + KAMERAS
// ====================================================================
import { stripAreaName, isEntityHiddenOrDisabled, sortByLastChanged } from '../utils/simon42-helpers.js';

class Simon42ViewRoomStrategy {
  static async generate(config, hass) {
                // Hilfsfunktion: Gehört Entity zum aktuellen Bereich?
                function belongsToCurrentArea(entity) {
                  if (entity.area_id) {
                    return entity.area_id === area.area_id;
                  } else if (entity.device_id && areaDevices.has(entity.device_id)) {
                    return true;
                  }
                  return false;
                }
            // Hilfsfunktion: Entity ausblenden?
            function isEntityExcluded(entityId) {
              return excludeLabels.has(entityId) || isEntityHiddenOrDisabled(hass, entityId);
            }
        // Hilfsfunktion: Batterie-Farbe (rot, gelb, grau, grün)
        function getBatteryColor(state) {
          if (state && state.state && !isNaN(Number(state.state))) {
            const value = Number(state.state);
            if (value > 60 && value <= 100) return "green";
            if (value > 30 && value <= 60) return "grey";
            if (value > 20 && value <= 30) return "yellow";
            if (value > 0 && value <= 20) return "red";
          }
          return undefined;
        }

        // Hilfsfunktion: Fenster/Tür-Farbe
        function getWindowColor(state) {
          if (state && (state.state === 'on' || state.state === 'open')) {
            return "red";
          }
          return "green";
        }
    const { area, devices, entities } = config;
    
    // Hole Dashboard-Config für Raum-Pins (wird über ViewBuilder übergeben)
    const dashboardConfig = config.dashboardConfig || {};
    
    // Hole groups_options aus der Dashboard-Config (falls vorhanden)
    const groupsOptions = config.groups_options || {};
    
    // Finde alle Geräte im Raum - als Set für O(1) Lookup
    const areaDevices = new Set();
    const areaDeviceObjects = []; // Speichere Device-Objekte für Reolink-Check
    for (const device of devices) {
      if (device.area_id === area.area_id) {
        areaDevices.add(device.id);
        areaDeviceObjects.push(device);
      }
    }

    // Finde alle Entitäten im Raum und gruppiere nach Domain
    const roomEntities = {
      lights: [],
      covers: [],
      covers_curtain: [],
      scenes: [],
      climate: [],
      media_player: [],
      vacuum: [],
      fan: [],
      switches: [],
      numbers: [], // NEU: Für input_number, number
      cameras: [] // NEU: Kameras
    };

    // Sensor-Kategorien für Badges
    const sensorEntities = {
      temperature: [],
      humidity: [],
      pm25: [],        // Feinstaub PM2.5
      pm10: [],        // Feinstaub PM10
      co2: [],         // CO2
      voc: [],         // VOC (flüchtige organische Verbindungen)
      motion: [],      // Bewegungsmelder
      occupancy: [],   // Präsenzmelder
      windows: [],     // Fenster/Türen (NEU)
      illuminance: [], // Helligkeit
      battery: [],     // Batterie (nur niedrige Werte)
      energy: [],      // NEU: Energie/Leistung
      sys_status: []   // NEU: System Status
    };

    // Labels für Filterung - als Set für O(1) Lookup
    const excludeLabels = new Set(
      entities
        .filter(e => e.labels?.includes("no_dboard"))
        .map(e => e.entity_id)
    );
    
    const showDboardLabels = new Set(
      entities
        .filter(e => e.labels?.includes("show_dboard"))
        .map(e => e.entity_id)
    );

    // Map für Device-ID zu Entity-ID (für Reolink-Zuordnung)
    const entityDeviceMap = new Map();
    for (const entity of entities) {
      if (entity.device_id) {
        if (!entityDeviceMap.has(entity.device_id)) {
          entityDeviceMap.set(entity.device_id, []);
        }
        entityDeviceMap.get(entity.device_id).push(entity.entity_id);
      }
    }

    // NEU: Intelligente Zuordnung loser Entities zu Devices anhand des Namens
    for (const entity of entities) {
      // Nur Entities prüfen, die im Raum sind, aber kein Device haben
      if (!entity.device_id && entity.area_id === area.area_id) {
        const state = hass.states[entity.entity_id];
        if (!state) continue;
        
        const friendlyName = state.attributes?.friendly_name || '';
        let bestMatchDevice = null;
        let maxMatchLength = 0;
        
        // Prüfe gegen alle Geräte im Raum und finde den längsten Match
        for (const device of areaDeviceObjects) {
          const deviceName = device.name_by_user || device.name;
          if (!deviceName) continue;

          const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
          const deviceNameNorm = normalize(deviceName);
          const friendlyNameNorm = normalize(friendlyName);
          const entityIdNorm = normalize(entity.entity_id);

          // Prüfe Friendly Name UND Entity ID
          // 1. Exakter Substring-Match (wie bisher)
          // 2. Normalisierter Match (ignoriert Leerzeichen, Bindestriche, etc.)
          if (
            friendlyName.toLowerCase().includes(deviceName.toLowerCase()) || 
            entity.entity_id.toLowerCase().includes(deviceName.toLowerCase()) || 
            (deviceNameNorm.length > 2 && friendlyNameNorm.includes(deviceNameNorm)) ||
            (deviceNameNorm.length > 2 && entityIdNorm.includes(deviceNameNorm))
          ) {
            if (deviceName.length > maxMatchLength) {
              maxMatchLength = deviceName.length;
              bestMatchDevice = device;
            }
          }
        }

        if (bestMatchDevice) {
          if (!entityDeviceMap.has(bestMatchDevice.id)) {
            entityDeviceMap.set(bestMatchDevice.id, []);
          }
          // Vermeide Duplikate
          const devEntities = entityDeviceMap.get(bestMatchDevice.id);
          if (!devEntities.includes(entity.entity_id)) {
            devEntities.push(entity.entity_id);
          }
        }
      }
    }

    // OPTIMIERT: Hauptfilter-Loop
    for (const entity of entities) {
      const entityId = entity.entity_id;
      
      // 1. Prüfe ob Entität zum Raum gehört (früh ausschließen)
      let belongsToArea = false;
      
      if (entity.area_id) {
        belongsToArea = entity.area_id === area.area_id;
      } else if (entity.device_id && areaDevices.has(entity.device_id)) {
        belongsToArea = true;
      }
      
      if (!belongsToArea) continue;
      
      // 2. Exclude-Check (Set-Lookup = O(1))
      if (excludeLabels.has(entityId)) continue;

      // 3. State-Existence-Check
      const state = hass.states[entityId];
      if (!state) continue;

      // 4. Hidden/Disabled-Check
      // Batterie-Sensoren: Ignoriere 'hidden_by' (oft von Integrations gesetzt), aber respektiere manuelles 'hidden'
      const isBatterySensor = entityId.includes('battery') || state.attributes?.device_class === 'battery';
      
      if (isBatterySensor) {
        // Für Batterie-Sensoren: Nur prüfen auf manuelles Hidden (konsistent mit Battery-View und Summary)
        if (entity.hidden === true) continue;
        // hidden_by wird ignoriert für kritische Batterien (wichtige Info!)
      } else {
        // Für alle anderen: Vollständige Hidden-Prüfung
        if (isEntityHiddenOrDisabled(entity, hass)) continue;
      }

      // 5. Domain-basierte Kategorisierung
      const domain = entityId.split('.')[0];
      const deviceClass = state.attributes?.device_class;
      const unit = state.attributes?.unit_of_measurement;

      // Kategorisiere nach Domain (frühe Returns für Performance)
      if (domain === 'light') {
        roomEntities.lights.push(entityId);
        continue;
      }
      
      if (domain === 'cover') {
        if (deviceClass === 'curtain' || deviceClass === 'blind') {
          roomEntities.covers_curtain.push(entityId);
        } else {
          roomEntities.covers.push(entityId);
        }
        continue;
      }
      
      if (domain === 'scene') {
        roomEntities.scenes.push(entityId);
        continue;
      }
      
      if (domain === 'climate') {
        roomEntities.climate.push(entityId);
        continue;
      }
      
      if (domain === 'media_player') {
        roomEntities.media_player.push(entityId);
        continue;
      }
      
      if (domain === 'vacuum') {
        roomEntities.vacuum.push(entityId);
        continue;
      }
      
      if (domain === 'fan') {
        roomEntities.fan.push(entityId);
        continue;
      }
      
      if (domain === 'switch') {
        roomEntities.switches.push(entityId);
        continue;
      }

      // NEU: Controls (Numbers, Selects, Buttons, Text, Datetime) -> zu Steuerung
      if (['number', 'input_number', 'select', 'input_select', 'button', 'input_button', 'text', 'input_text', 'datetime', 'input_datetime'].includes(domain)) {
        roomEntities.numbers.push(entityId);
        continue;
      }

      // NEU: Water Heater -> zu Klima
      if (domain === 'water_heater') {
        roomEntities.climate.push(entityId);
        continue;
      }
      
      // NEU: Kamera-Erkennung
      if (domain === 'camera') {
        roomEntities.cameras.push(entityId);
        continue;
      }
      
      // === SENSOREN FÜR BADGES ===
      if (domain === 'sensor') {
        const friendlyName = state.attributes?.friendly_name?.toLowerCase() || '';
        // Batterie: Zeige ALLE Batterien an (Test-Modus)
        if ((entityId.includes('battery') || deviceClass === 'battery') && unit === '%' && !entityId.includes('limit') && !entityId.includes('health')) {
          const batteryLevel = parseFloat(state.state);
          // Limit auf 101 erhöht, damit du beide Sensoren zum Testen siehst!
          if (!isNaN(batteryLevel) && batteryLevel <= 100) {
            sensorEntities.battery.push(entityId);
          }
          continue;
        }
        // Temperatur
        const unitLower = unit ? unit.toLowerCase() : '';
        if ((deviceClass === 'temperature' || unit === '°C' || unit === '°F') && deviceClass !== 'power' && deviceClass !== 'energy' && !['w', 'kw', 'wh', 'kwh', 'va', 'var', 'watt', 'watts'].includes(unitLower)) {
          sensorEntities.temperature.push(entityId);
          continue;
        }
        // Luftfeuchtigkeit
        if (deviceClass === 'humidity' || deviceClass === 'moisture' || unit === '%' || unit === 'g/m³' || unit === 'g/m3' || friendlyName.includes('humidity') || friendlyName.includes('feuchtigkeit')) {
          sensorEntities.humidity.push(entityId);
          continue;
        }
        // Feinstaub PM2.5 (String-includes ist schneller als komplexe Checks)
        if (deviceClass === 'pm25' || entityId.includes('pm_2_5') || entityId.includes('pm25')) {
          sensorEntities.pm25.push(entityId);
          continue;
        }
        // Feinstaub PM10
        if (deviceClass === 'pm10' || entityId.includes('pm_10') || entityId.includes('pm10')) {
          sensorEntities.pm10.push(entityId);
          continue;
        }
        // CO2
        if (deviceClass === 'carbon_dioxide' || entityId.includes('co2') || entityId.includes('carbon_dioxide') || friendlyName.includes('co2') || friendlyName.includes('carbon dioxide') || unit === 'ppm') {
          sensorEntities.co2.push(entityId);
          continue;
        }
        // VOC
        if (deviceClass === 'volatile_organic_compounds' || entityId.includes('voc')) {
          sensorEntities.voc.push(entityId);
          continue;
        }
        // Helligkeit
        if (deviceClass === 'illuminance' || unit === 'lx') {
          sensorEntities.illuminance.push(entityId);
          continue;
        }
        // NEU: System Status (Uptime, Health, Starts, Notifications)
        if (
          deviceClass === 'duration' || 
          deviceClass === 'timestamp' || 
          deviceClass === 'enum' ||
          entityId.includes('uptime') || 
          entityId.includes('health') || 
          entityId.includes('status') || 
          entityId.includes('notification') ||
          entityId.includes('dhw') || // NEU: DHW / Warmwasser
          entityId.includes('hot_water') || // NEU: Hot Water
          entityId.includes('starts') ||
          entityId.includes('duration') || // NEU: Charge duration
          ['min', 'mins', 'h', 'hr', 'hrs'].includes(unitLower) // NEU: Zeit-Einheiten
        ) {
          sensorEntities.sys_status.push(entityId);
          continue;
        }
        // NEU: Energie / Leistung (W, kW, Wh, kWh)
        if (deviceClass === 'energy' || deviceClass === 'power' || ['w', 'kw', 'wh', 'kwh', 'va', 'var'].includes(unitLower)) {
          sensorEntities.energy.push(entityId);
          continue;
        }
      }
      
      // Binäre Sensoren
      if (domain === 'binary_sensor') {
        // Bewegung
        if (deviceClass === 'motion') {
          sensorEntities.motion.push(entityId);
          continue;
        }
        // Präsenz
        if (deviceClass === 'presence') {
          sensorEntities.occupancy.push(entityId);
          continue;
        }
        // Fenster / Türen / Garage (NEU)
        if (['window', 'door', 'garage_door', 'opening'].includes(deviceClass)) {
          sensorEntities.windows.push(entityId);
          continue; // Wichtig: continue, damit es nicht woanders reinrutscht
        }
      }
    }

    // === WENDE GROUPS_OPTIONS AN ===
    // Filtere versteckte Entities aus groups_options
    const applyGroupFilter = (groupKey) => {
      const groupOptions = groupsOptions[groupKey];
      if (!groupOptions) return roomEntities[groupKey];
      
      let filtered = roomEntities[groupKey];
      
      // Filtere versteckte Entities
      if (groupOptions.hidden && groupOptions.hidden.length > 0) {
        const hiddenSet = new Set(groupOptions.hidden);
        filtered = filtered.filter(e => !hiddenSet.has(e));
      }
      
      // Sortiere nach order (falls vorhanden)
      if (groupOptions.order && groupOptions.order.length > 0) {
        const orderMap = new Map(groupOptions.order.map((id, index) => [id, index]));
        filtered.sort((a, b) => {
          const indexA = orderMap.has(a) ? orderMap.get(a) : 9999;
          const indexB = orderMap.has(b) ? orderMap.get(b) : 9999;
          return indexA - indexB;
        });
      }
      
      return filtered;
    };

    // Wende Filter auf alle Gruppen an
    roomEntities.lights = applyGroupFilter('lights');
    roomEntities.covers = applyGroupFilter('covers');
    roomEntities.covers_curtain = applyGroupFilter('covers_curtain');
    roomEntities.scenes = applyGroupFilter('scenes');
    roomEntities.climate = applyGroupFilter('climate');
    roomEntities.media_player = applyGroupFilter('media_player');
    roomEntities.vacuum = applyGroupFilter('vacuum');
    roomEntities.fan = applyGroupFilter('fan');
    roomEntities.switches = applyGroupFilter('switches');
    roomEntities.numbers = applyGroupFilter('numbers'); // NEU
    roomEntities.cameras = applyGroupFilter('cameras'); // NEU

    // Priorisiere Temperatur und Luftfeuchtigkeit aus area.temperature_entity_id und area.humidity_entity_id
    let primaryTempSensor = null;
    let primaryHumiditySensor = null;

    if (area.temperature_entity_id && 
        hass.states[area.temperature_entity_id] && 
        !excludeLabels.has(area.temperature_entity_id)) {
      const entityRegistry = hass.entities?.[area.temperature_entity_id];
      if (!entityRegistry || (!entityRegistry.hidden_by && !entityRegistry.disabled_by)) {
        primaryTempSensor = area.temperature_entity_id;
      }
    }

    if (area.humidity_entity_id && 
        hass.states[area.humidity_entity_id] && 
        !excludeLabels.has(area.humidity_entity_id)) {
      const entityRegistry = hass.entities?.[area.humidity_entity_id];
      if (!entityRegistry || (!entityRegistry.hidden_by && !entityRegistry.disabled_by)) {
        primaryHumiditySensor = area.humidity_entity_id;
      }
    }

    // === BADGES ERSTELLEN (DEAKTIVIERT) ===
    const badges = [];
    
    // Wir nutzen jetzt Sections für alles!
    
    // === HAUPTINHALT - SECTIONS ===
    const sections = [];

    // NEU: Section "Klima & Status" (Sortiert nach Geräten)
    const statusCards = [];
    const processedEntities = new Set(); // Damit wir nichts doppelt hinzufügen

    // 1. Iteriere über alle Geräte im Raum
    areaDeviceObjects.forEach(device => {
        const deviceEntitiesList = entityDeviceMap.get(device.id) || [];
        // Sammle relevante Sensoren für dieses Gerät
        const devSensors = {
          temp: [],
          hum: [],
          window: [],
          battery: [],
          energy: [], // NEU
          sys_status: [], // NEU
          other: [] // CO2, PM, etc.
        };

        deviceEntitiesList.forEach(entityId => {
          if (processedEntities.has(entityId) || isEntityExcluded(entityId)) return;

          // Prüfe, ob die Entität explizit einem anderen Raum zugeordnet ist
          const entityReg = hass.entities?.[entityId];
          if (entityReg && entityReg.area_id && entityReg.area_id !== area.area_id) return;

          let assigned = false;
          // Prüfe Kategorie
          if (sensorEntities.temperature.includes(entityId)) { devSensors.temp.push(entityId); assigned = true; }
          else if (sensorEntities.humidity.includes(entityId)) { devSensors.hum.push(entityId); assigned = true; }
          else if (sensorEntities.windows.includes(entityId)) { devSensors.window.push(entityId); assigned = true; }
          else if (sensorEntities.battery.includes(entityId)) { devSensors.battery.push(entityId); assigned = true; }
          else if (sensorEntities.energy.includes(entityId)) { devSensors.energy.push(entityId); assigned = true; }
          else if (sensorEntities.sys_status.includes(entityId)) { devSensors.sys_status.push(entityId); assigned = true; }
          else if ([...sensorEntities.co2, ...sensorEntities.pm25, ...sensorEntities.pm10, ...sensorEntities.voc, ...sensorEntities.illuminance].includes(entityId)) {
            devSensors.other.push(entityId); assigned = true;
          }

          if (assigned) processedEntities.add(entityId);
        });

        // Prüfe, ob das Gerät mindestens einen Sensor hat
        const hasAnySensor = devSensors.temp.length || devSensors.hum.length || devSensors.window.length || devSensors.battery.length || devSensors.energy.length || devSensors.sys_status.length || devSensors.other.length;
        if (hasAnySensor) {
            // Füge vor die Karten für dieses Gerät ein Heading ein
            statusCards.push({
                type: "heading",
                heading: device.name_by_user || device.name || "Gerät",
                heading_style: "section",
                icon: device.icon || undefined
            });

            // Füge Karten in logischer Reihenfolge hinzu (Temp -> Hum -> Window -> Other -> Bat)
                        // ...existing code...
                        if (devSensors.misc && devSensors.misc.length > 0) {
                          devSensors.misc.forEach(id => {
                            const state = hass.states[id];
                            statusCards.push({
                              type: "tile",
                              entity: id,
                              name: stripAreaName(id, area, hass),
                              state_content: "state"
                            });
                          });
                        }
            devSensors.temp.forEach(id => statusCards.push({
              type: "tile", entity: id, name: stripAreaName(id, area, hass), icon: "mdi:thermometer", color: "red", state_content: "state"
            }));
            devSensors.hum.forEach(id => statusCards.push({
              type: "tile", entity: id, name: stripAreaName(id, area, hass), icon: "mdi:water-percent", color: "indigo", state_content: "state"
            }));
            devSensors.window.forEach(id => {
                const state = hass.states[id];
                statusCards.push({
                  type: "tile",
                  entity: id,
                  name: stripAreaName(id, area, hass),
                  color: getWindowColor(state),
                  state_content: "state"
                });
            });
            devSensors.other.forEach(id => statusCards.push({
              type: "tile", entity: id, name: stripAreaName(id, area, hass), state_content: ["state", "last_changed"]
            }));
            devSensors.energy.forEach(id => statusCards.push({
              type: "tile", entity: id, name: stripAreaName(id, area, hass), icon: "mdi:lightning-bolt", state_content: "state"
            }));
            devSensors.sys_status.forEach(id => statusCards.push({
              type: "tile", entity: id, name: stripAreaName(id, area, hass), icon: "mdi:information-outline", state_content: "state"
            }));
            devSensors.battery.forEach(id => {
                const state = hass.states[id];
                statusCards.push({
                  type: "tile",
                  entity: id,
                  name: stripAreaName(id, area, hass),
                  color: getBatteryColor(state),
                  state_content: "state"
                });
            });
        }
    });

    // 2. Füge restliche Sensoren hinzu (die keinem Device zugeordnet waren)
    const allStatusSensors = [
        ...sensorEntities.temperature, ...sensorEntities.humidity, ...sensorEntities.windows, 
        ...sensorEntities.battery, ...sensorEntities.energy, ...sensorEntities.sys_status, ...sensorEntities.co2, ...sensorEntities.pm25, 
        ...sensorEntities.pm10, ...sensorEntities.voc, ...sensorEntities.illuminance
    ];

    allStatusSensors.forEach(entityId => {
        if (!processedEntities.has(entityId) && !isEntityExcluded(entityId)) {
            // Generische Karte für den Rest
            const state = hass.states[entityId];
            let color = undefined;
            if (sensorEntities.windows.includes(entityId)) {
              color = getWindowColor(state);
            } else if (sensorEntities.battery.includes(entityId)) {
              color = getBatteryColor(state);
            }
            statusCards.push({
              type: "tile",
              entity: entityId,
              name: stripAreaName(entityId, area, hass),
              color: color,
              state_content: "state"
            });
            processedEntities.add(entityId);
        }
    });

    // Wenn Karten vorhanden, füge Section GANZ OBEN hinzu
    if (statusCards.length > 0) {
        sections.push({
          type: "grid",
          style: "max-height: 80vh; overflow-y: auto;",
          cards: [
            {
              type: "heading",
              heading: "Klima & Status",
              heading_style: "title",
              icon: "mdi:home-thermometer"
            },
            ...statusCards
          ]
        });
    }



    // NEU: Kameras-Section (ganz oben nach Badges)
    if (roomEntities.cameras.length > 0) {
      const cameraCards = [];
      
      roomEntities.cameras.forEach(cameraId => {
        const cameraState = hass.states[cameraId];
        if (!cameraState) return;
        
        // Finde Device-ID der Kamera
        const cameraEntity = entities.find(e => e.entity_id === cameraId);
        const deviceId = cameraEntity?.device_id;
        
        // Prüfe ob es ein Reolink-Gerät ist
        let isReolink = false;
        if (deviceId) {
          const device = devices.find(d => d.id === deviceId);
          if (device) {
            // Prüfe Manufacturer oder Model
            const manufacturer = device.manufacturer?.toLowerCase() || '';
            const model = device.model?.toLowerCase() || '';
            isReolink = manufacturer.includes('reolink') || model.includes('reolink');
          }
        }
        
        if (isReolink && deviceId) {
          // Reolink: picture-glance mit zusätzlichen Entitäten
          const deviceEntities = entityDeviceMap.get(deviceId) || [];
          
          // Suche spezifische Entitäten des gleichen Geräts
          const spotlightEntity = deviceEntities.find(id => 
            id.startsWith('light.') && 
            hass.states[id] && 
            !excludeLabels.has(id)
          );
          
          const motionEntity = deviceEntities.find(id => 
            id.startsWith('binary_sensor.') && 
            hass.states[id]?.attributes?.device_class === 'motion' &&
            !excludeLabels.has(id)
          );
          
          const sirenEntity = deviceEntities.find(id => 
            id.startsWith('siren.') && 
            hass.states[id] &&
            !excludeLabels.has(id)
          );
          
          // Baue entities-Array (nur verfügbare Entities)
          const glanceEntities = [];
          if (spotlightEntity) glanceEntities.push({ entity: spotlightEntity });
          if (motionEntity) glanceEntities.push({ entity: motionEntity });
          if (sirenEntity) glanceEntities.push({ entity: sirenEntity });
          
          cameraCards.push({
            type: "picture-glance",
            camera_image: cameraId,
            camera_view: "auto",
            fit_mode: "cover",
            title: stripAreaName(cameraId, area, hass),
            entities: glanceEntities
          });
        } else {
          // Standard-Kamera: picture-entity
          cameraCards.push({
            type: "picture-entity",
            entity: cameraId,
            camera_image: cameraId,
            camera_view: "auto",
            name: stripAreaName(cameraId, area, hass),
            show_name: true,
            show_state: false
          });
        }
      });
      
      if (cameraCards.length > 0) {
        sections.push({
          type: "grid",
          cards: [
            {
              type: "heading",
              heading: "Kameras",
              heading_style: "title",
              icon: "mdi:cctv"
            },
            ...cameraCards
          ]
        });
      }
    }

    // Sortiere Lights nach last_changed (nur wenn keine custom order vorhanden)
    if (!groupsOptions.lights?.order) {
      roomEntities.lights.sort((a, b) => sortByLastChanged(a, b, hass));
    }

    // Licht-Section
    if (roomEntities.lights.length > 0) {
      sections.push({
        type: "grid",
        cards: [
          {
            type: "heading",
            heading: "Beleuchtung",
            heading_style: "title",
            icon: "mdi:lightbulb"
          },
          ...roomEntities.lights.map(entity => ({
            type: "tile",
            entity: entity,
            name: stripAreaName(entity, area, hass),
            features: [{ type: "light-brightness" }],
            vertical: false,
            features_position: "inline",
            state_content: "last_changed"
          }))
        ]
      });
    }

    // Klima-Section
    if (roomEntities.climate.length > 0) {
      sections.push({
        type: "grid",
        cards: [
          {
            type: "heading",
            heading: "Klima",
            heading_style: "title",
            icon: "mdi:thermostat"
          },
          ...roomEntities.climate.map(entity => {
            const domain = entity.split('.')[0];
            // Unterscheidung zwischen Climate und Water Heater Features
            const features = domain === 'water_heater' 
              ? [{ type: "water-heater-operation-modes" }]
              : [{ type: "climate-hvac-modes" }];
            
            return {
              type: "tile",
              entity: entity,
              name: stripAreaName(entity, area, hass),
              features: features,
              features_position: "inline",
              vertical: false,
              state_content: domain === 'water_heater' ? ["operation_mode", "current_temperature"] : ["hvac_action", "current_temperature"]
            };
          })
        ]
      });
    }

    // Rollos/Jalousien
    if (roomEntities.covers.length > 0) {
      sections.push({
        type: "grid",
        cards: [
          {
            type: "heading",
            heading: "Rollos & Jalousien",
            heading_style: "title",
            icon: "mdi:window-shutter"
          },
          ...roomEntities.covers.map(entity => ({
            type: "tile",
            entity: entity,
            name: stripAreaName(entity, area, hass),
            features: [{ type: "cover-open-close" }],
            vertical: false,
            features_position: "inline",
            state_content: ["current_position", "last_changed"]
          }))
        ]
      });
    }

    // Vorhänge
    if (roomEntities.covers_curtain.length > 0) {
      sections.push({
        type: "grid",
        cards: [
          {
            type: "heading",
            heading: "Vorhänge",
            heading_style: "title",
            icon: "mdi:curtains"
          },
          ...roomEntities.covers_curtain.map(entity => ({
            type: "tile",
            entity: entity,
            name: stripAreaName(entity, area, hass),
            features: [{ type: "cover-open-close" }],
            vertical: false,
            features_position: "inline",
            state_content: ["current_position", "last_changed"]
          }))
        ]
      });
    }

    // Media Player
    if (roomEntities.media_player.length > 0) {
      sections.push({
        type: "grid",
        cards: [
          {
            type: "heading",
            heading: "Medien",
            heading_style: "title",
            icon: "mdi:speaker"
          },
          ...roomEntities.media_player.map(entity => ({
            type: "tile",
            entity: entity,
            name: stripAreaName(entity, area, hass),
            vertical: false,
            features: [{ type: "media-player-playback" }],
            features_position: "inline",
            state_content: ["media_title", "media_artist"]
          }))
        ]
      });
    }

    // Szenen
    if (roomEntities.scenes.length > 0) {
      sections.push({
        type: "grid",
        cards: [
          {
            type: "heading",
            heading: "Szenen",
            heading_style: "title",
            icon: "mdi:palette"
          },
          ...roomEntities.scenes.map(entity => ({
            type: "tile",
            entity: entity,
            name: stripAreaName(entity, area, hass),
            vertical: false,
            state_content: "last_changed"
          }))
        ]
      });
    }

    // Sonstiges (Vacuum, Fan, Switches)
    const miscCards = [];

    // Vacuum mit Commands
    roomEntities.vacuum.forEach(entity => {
      miscCards.push({
        type: "tile",
        entity: entity,
        name: stripAreaName(entity, area, hass),
        features: [{ type: "vacuum-commands" }],
        features_position: "inline",
        vertical: false,
        state_content: "last_changed"
      });
    });

    // Fan mit Speed Control
    roomEntities.fan.forEach(entity => {
      miscCards.push({
        type: "tile",
        entity: entity,
        name: stripAreaName(entity, area, hass),
        features: [{ type: "fan-speed" }],
        features_position: "inline",
        vertical: false,
        state_content: "last_changed"
      });
    });

    // Switches
    roomEntities.switches.forEach(entity => {
      miscCards.push({
        type: "tile",
        entity: entity,
        name: stripAreaName(entity, area, hass),
        vertical: false,
        state_content: "last_changed"
      });
    });

    // Numbers (NEU)
    roomEntities.numbers.forEach(entity => {
      miscCards.push({
        type: "tile",
        entity: entity,
        name: stripAreaName(entity, area, hass),
        vertical: false,
        state_content: "state"
      });
    });

    // Sortiere miscCards nach last_changed
    miscCards.sort((a, b) => {
      const stateA = hass.states[a.entity];
      const stateB = hass.states[b.entity];
      if (!stateA || !stateB) return 0;
      const dateA = new Date(stateA.last_changed);
      const dateB = new Date(stateB.last_changed);
      return dateB - dateA;
    });

    if (miscCards.length > 0) {
      sections.push({
        type: "grid",
        cards: [
          {
            type: "heading",
            heading: "Steuerung",
            heading_style: "title",
            icon: "mdi:gamepad-variant"
          },
          ...miscCards
        ]
      });
    }

    // === RAUM-PINS SECTION (am Ende) ===
    // Filtere Raum-Pins für diesen Raum
    const roomPinEntities = dashboardConfig.room_pin_entities || [];
    const roomPinsForThisArea = roomPinEntities.filter(entityId => {
      const entity = entities.find(e => e.entity_id === entityId);
      if (!entity) return false;
      
      // Prüfe ob Entity diesem Raum zugeordnet ist
      if (entity.area_id === area.area_id) return true;
      
      // Oder über Device zugeordnet
      if (entity.device_id && areaDevices.has(entity.device_id)) return true;
      
      return false;
    });

    if (roomPinsForThisArea.length > 0) {
      sections.push({
        type: "grid",
        cards: [
          {
            type: "heading",
            heading: "Raum-Pins",
            heading_style: "title",
            icon: "mdi:pin"
          },
          ...roomPinsForThisArea.map(entity => ({
            type: "tile",
            entity: entity,
            name: stripAreaName(entity, area, hass),
            vertical: false,
            state_content: "last_changed"
          }))
        ]
      });
    }
    // Wenn keine Sections vorhanden sind, Raum-View komplett ausblenden
    if (sections.length === 0) {
      return null;
    }
    return {
      type: "sections",
      header: {
        badges_position: "bottom"
      },
      sections: sections,
      badges: badges
    };
  }
}

// Registriere Custom Element
customElements.define("ll-strategy-simon42-view-room", Simon42ViewRoomStrategy);