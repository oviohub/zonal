const calculateArea = require("@turf/area").default;
const clone = require("@turf/clone").default;
const difference = require("@turf/difference").default;
const dissolve = require("@turf/dissolve").default;
const booleanPointInPolygon = require("@turf/boolean-point-in-polygon").default;
const { featureEach, geomEach } = require("@turf/meta");

// replacement for Object.entries in case Object.entries
// isn't defined
function entries(object) {
  const results = [];
  for (let key in object) {
    results.push([key, object[key]]);
  }
  return results;
}

function values(object) {
  const results = [];
  for (let key in object) {
    results.push(object[key]);
  }
  return results;
}

function getClassGeometryType(geom) {
  switch (geom.type) {
    case "Polygon":
    case "MultiPolygon":
      return "Polygon";
    case "Point":
    case "MultiPoint":
      return "Point";
  }
}

function getArrayKey({ feature, index, geometry, props }) {
  if (props) {
    const key = [];
    props.forEach(prop => {
      if (typeof prop === "string") {
        key.push(feature.properties[prop]);
      } else if (typeof prop === "function") {
        key.push(prop({ feature, geometry }));
      }
    });
    return key;
  } else {
    return [index];
  }
}

function unarray(arr) {
  return arr.length === 1 ? arr[0] : arr;
}

// https://stackoverflow.com/questions/6122571/simple-non-secure-hash-function-for-javascript
function hash(string) {
  let hash = 0;
  for (let i = 0; i < string.length; i++) {
    const chr = string.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
  }
  return hash;
}

// randomly returns either 1 or -1
const randSign = () => (Math.random() < 0.5 ? 1 : -1);
const shift = () => randSign() * Math.random() * 1e-7;
const shiftRing = ring => ring.map(([x, y]) => [x + shift(), y + shift()]);
const shiftPolygon = rings => rings.map(shiftRing);
const shiftMultiPolygon = polygons => polygons.map(shiftPolygon);
function shiftGeometry(geom) {
  if (geom.type === "Polygon") {
    geom.coordinates = shiftPolygon(geom.coordinates);
  } else if (geom.type === "MultiPolygon") {
    geom.coordinates = shiftMultiPolygon(geom.coordinates);
  }
  return geom;
}

// assumptions
// - zones is a GeoJSON with polygons
// - classes are either all polygons/multi-polygons or all points (not mix of polygons and points)
function calculate({
  zones,
  zone_properties,
  classes,
  class_properties,
  class_geometry_type,
  include_zero_count = false,
  include_zero_area = false,
  include_null_class_rows = true,
  class_properties_delimiter = ",",
  dissolve_classes = false,
  preserve_features = true,
  remove_features_with_no_overlap = false,
  on_before_each_zone_feature,
  on_after_each_zone_feature,
  feature_filter,
  debug_level = 0
}) {
  if (!classes) throw new Error("[zonal] classes are missing or empty");
  if (!zones) throw new Error("[zonal] zones are missing or empty");

  if (Array.isArray(zone_properties) && zone_properties.length === 0) {
    throw new Error("[zonal] zone_properties is an empty array");
  }
  if (Array.isArray(class_properties) && class_properties.length === 0) {
    throw new Error("[zonal] class_properties is an empty array");
  }

  if (typeof zone_properties === "string") {
    throw new Error("[zonal] zone_properties is a string.  it should be an array.");
  }
  if (typeof class_properties === "string") {
    throw new Error("[zonal] class_properties is a string.  it should be an array.");
  }

  if (preserve_features && remove_features_with_no_overlap) {
    throw new Error("[zonal] you can't preserve features while also removing features that don't overlap classes");
  }

  if ([undefined, null].includes(zone_properties)) {
    console.warn("[zonal] you didn't pass in zone_properties, so defaulting to the zonal feature index number");
  }

  if ([undefined, null].includes(class_properties)) {
    console.warn("[zonal] you didn't pass in class_properties, so defaulting to the class feature index number");
  }

  // stats keyed by the unique zone+class combo id
  // e.g. { '["AK","Hot"]': 10, '["AK","Cold"]': 342 }
  // e.g. { [combo_id]: { area: <Number> }}
  const stats = {};

  // { [zone_id]: <total_area_of_zone_in_square_meters> }
  const zone_to_area = {};

  // { [class_id]: [<array of polygons or points>] }
  const class_to_geometries = {};

  if (Array.isArray(class_properties) && class_properties.length === 1 && dissolve_classes) {
    classes = dissolve(classes, { propertyName: class_properties[0] });
    if (debug_level >= 1) console.log("[zonal] dissolved classes");
  }

  // group class geometries into dictionary objects
  featureEach(classes, (class_feature, class_feature_index) => {
    geomEach(class_feature, (class_geometry, class_geometry_index) => {
      const class_array = getArrayKey({
        feature: class_feature,
        geometry: class_geometry,
        props: class_properties,
        index: class_feature_index
      });

      // convert class id array to string
      const class_id = JSON.stringify(class_array);

      // is the class type points, lines or polygons?
      if (!class_geometry_type) class_geometry_type = getClassGeometryType(class_geometry);

      // unexpected class geometry change, like a point within a collection of polygons
      if (getClassGeometryType(class_geometry) !== class_geometry_type) {
        console.warn("[zonal] we encountered an unexpected class geometry, so we're skipping it");
        return;
      }

      const class_geometry_hash = hash(JSON.stringify(class_geometry.coordinates));

      class_to_geometries[class_id] ??= {};
      class_to_geometries[class_id][class_geometry_hash] = class_geometry;
    });
  });

  if (debug_level >= 1) console.log("[zonal] grouped geometries by class");

  // zones must be one or more features with polygon geometries
  // like administrative districts
  featureEach(zones, (zone_feature, zone_feature_index) => {
    if (feature_filter && feature_filter({ feature: zone_feature, index: zone_feature_index }) === false) {
      return;
    }

    if (typeof on_before_each_zone_feature === "function") {
      on_before_each_zone_feature({
        feature: zone_feature,
        feature_index: zone_feature_index,
        stats,
        zone_to_area
      });
    }
    geomEach(zone_feature, (zone_geometry, geometry_index) => {
      // sometimes the same zone could be split up amonst multiple features
      // for example, you could have a country with multiple islands
      const zone_array = getArrayKey({
        feature: zone_feature,
        geometry: zone_geometry,
        props: zone_properties,
        index: zone_feature_index
      });

      const zone_id = JSON.stringify(zone_array);

      zone_feature.properties ??= {};
      zone_feature.properties["zonal:zone_id"] = zone_array;

      // track the total area of the zone across all its features
      zone_to_area[zone_id] ??= 0;
      const zone_geometry_area = calculateArea(zone_geometry);
      zone_to_area[zone_id] += zone_geometry_area;

      // this is the remaining polygonal area of the zone
      // after you have subtracted the overlap with classes
      // it will be used to compute the area without a class
      // for example, if you have wind speed polygons
      // you might want to know how much area is unaffected
      let remaining_zone_geometry_for_all_classes = zone_geometry;

      entries(class_to_geometries).forEach(([class_id, class_geometries]) => {
        // unique identifier for the zone + class combo
        // there will be a row in the table for each zone + class combo
        const combo_id = JSON.stringify([zone_id, class_id]);

        let remaining_zone_geometry_for_specific_class = zone_geometry;
        Object.values(class_geometries).forEach(class_geometry => {
          if (class_geometry_type === "Point") {
            stats[combo_id] ??= { count: 0 };

            const xy = class_geometry.coordinates;
            const inside = booleanPointInPolygon(xy, zone_geometry);
            if (inside) {
              // increase number of times the combo is found
              stats[combo_id].count++;
            }
          } else if (class_geometry_type === "Polygon") {
            if (remaining_zone_geometry_for_all_classes) {
              try {
                remaining_zone_geometry_for_all_classes = difference(
                  remaining_zone_geometry_for_all_classes,
                  class_geometry
                );
              } catch (error) {
                remaining_zone_geometry_for_all_classes = difference(
                  remaining_zone_geometry_for_all_classes,
                  shiftGeometry(clone(class_geometry))
                );
              }
            }
            if (remaining_zone_geometry_for_specific_class) {
              try {
                remaining_zone_geometry_for_specific_class = difference(
                  remaining_zone_geometry_for_specific_class,
                  class_geometry
                );
              } catch (error) {
                remaining_zone_geometry_for_all_classes = difference(
                  remaining_zone_geometry_for_specific_class,
                  shiftGeometry(clone(class_geometry))
                );
              }
            }
          }
        });

        if (class_geometry_type === "Polygon") {
          stats[combo_id] ??= { area: 0 };
          let remaining_area = remaining_zone_geometry_for_specific_class
            ? calculateArea(remaining_zone_geometry_for_specific_class)
            : 0;

          // there's no way you can have more remaining than the actual size of the zone
          // this happens because of floating point arithmetic issues
          if (remaining_area > zone_geometry_area) remaining_area = zone_geometry_area;

          // area where zone geometry and class overlap
          stats[combo_id].area += Math.round(zone_geometry_area - remaining_area);
        }
      });

      // after we've gone through all the classes
      // see what's left and save the area of the part of the zone
      // that aren't overlapped by a class
      if (class_geometry_type === "Polygon") {
        const zone_without_class_id = JSON.stringify([zone_id, null]);
        stats[zone_without_class_id] ??= { area: 0 };
        stats[zone_without_class_id].area += remaining_zone_geometry_for_all_classes
          ? Math.round(calculateArea(remaining_zone_geometry_for_all_classes))
          : 0;
      }
    });
    if (typeof on_after_each_zone_feature === "function") {
      on_after_each_zone_feature({
        feature: zone_feature,
        feature_index: zone_feature_index,
        stats,
        zone_to_area
      });
    }
  });

  // calculate percentages
  entries(stats).forEach(([combo_id, combo_stats]) => {
    const [zone_id, class_id] = JSON.parse(combo_id);
    if ("area" in combo_stats) {
      combo_stats.percentage = combo_stats.area / Math.round(zone_to_area[zone_id]);
    }
  });

  // reformat stats for return
  const columns = [];
  let first_pass = true;
  let rows = [];
  for (let combo_id in stats) {
    const combo_stats = stats[combo_id];
    let [zone_id, class_id] = JSON.parse(combo_id);

    // convert zone_id from string to array
    zone_id = JSON.parse(zone_id);

    // convert class id from string to array
    class_id = JSON.parse(class_id);

    if (include_null_class_rows === false && class_id === null) {
      continue;
    }

    const row = {};
    zone_id.map((it, i) => {
      const key = Array.isArray(zone_properties) ? zone_properties[i] : "index";
      const zone_key = "zone:" + key;
      row[zone_key] = it;
      if (first_pass) columns.push(zone_key);
    });
    (class_id || [null]).map((it, i) => {
      const key = Array.isArray(class_properties) ? class_properties[i] : "index";
      const class_key = "class:" + key;
      row[class_key] = it;
      if (first_pass) columns.push(class_key);
    });
    for (let stat_name in combo_stats) {
      const stat_key = "stat:" + stat_name;
      row[stat_key] = combo_stats[stat_name];
      if (first_pass) columns.push(stat_key);
    }
    rows.push(row);
    first_pass = false;
  }

  if (!include_zero_count) {
    rows = rows.filter(row => row["stat:count"] !== 0);
  }

  if (!include_zero_area) {
    rows = rows.filter(row => row["stat:area"] !== 0);
  }

  // sort rows by columns from left to right
  rows.sort((a, b) => {
    for (let c = 0; c < columns.length; c++) {
      const col = columns[c];
      const aval = a[col];
      const bval = b[col];
      if (aval === null && bval !== null) return 1;
      else if (aval !== null && bval === null) return -1;
      if (a[col] > b[col]) return 1;
      else if (a[col] < b[col]) return -1;
    }
    return 0;
  });

  const results = {
    table: {
      columns,
      rows
    }
  };

  results.geojson = zones;

  // group stats by zone
  const zone_id_to_stats = {};
  for (let combo_id in stats) {
    const combo_stats = stats[combo_id];
    const [zone_id, class_id] = JSON.parse(combo_id);
    zone_id_to_stats[zone_id] ??= {};
    zone_id_to_stats[zone_id][class_id] = combo_stats;
  }

  // aggregate statistics
  const agg_stats = {};
  for (let zone_id in zone_id_to_stats) {
    const zone_stats = {};
    const pairs = entries(zone_id_to_stats[zone_id]);
    const sorted_by_area = pairs
      .filter(it => !["null", '["null"]'].includes(it[0]))
      .filter(it => it[1].area !== 0) // filter out zone-class combinations that don't exist
      .sort((a, b) => a[1].area - b[1].area);
    if (sorted_by_area.length > 0) {
      zone_stats.minority = unarray(JSON.parse(sorted_by_area[0][0]));
      zone_stats.majority = unarray(JSON.parse(sorted_by_area[sorted_by_area.length - 1][0]));
    }
    const zone_area = zone_to_area[zone_id];
    if (class_geometry_type === "Polygon") {
      const unclassed_percentage = pairs.find(pair => pair[0] === "null")[1].percentage;
      zone_stats.percentage = 1 - unclassed_percentage;
      zone_stats.sum = Math.round(zone_stats.percentage * zone_area);
      agg_stats[zone_id] = zone_stats;
    }
  }

  if (!preserve_features) zones = clone(zones);

  const delete_these_features = [];
  featureEach(zones, (zone_feature, zone_feature_index) => {
    const props = zone_feature.properties;
    const zone_id = JSON.stringify(props["zonal:zone_id"]);
    props["zonal:stat:area"] = Math.round(zone_to_area[zone_id]);
    entries(agg_stats[zone_id]).forEach(([stat_name, stat_value]) => {
      props["zonal:stat:" + stat_name] = stat_value;
    });
    props["zonal:stat:classes"] = entries(zone_id_to_stats[zone_id]).reduce((acc, [key, stats]) => {
      key = JSON.parse(key);
      key = Array.isArray(key) ? key.join(class_properties_delimiter) : key;
      if (stats.area > 0) acc[key] = stats;
      return acc;
    }, {});

    if (remove_features_with_no_overlap) {
      const class_keys = Object.keys(props["zonal:stat:classes"]);
      if (class_keys.length === 0 || class_keys[0] === "null") {
        // don't want to delete in the middle of a for loop
        // so save the index to delete later
        delete_these_features.push(zone_feature_index);
      }
    }
  });

  if (delete_these_features.length > 0) {
    if (zones.type === "Feature") {
      zones = null;
    } else if (zones.type === "FeatureCollection") {
      zones.features = zones.features.filter((_, i) => !delete_these_features.includes(i));
    }
  }

  results.geojson = zones;

  return results;
}

const zonal = { calculate };

if (typeof define === "function" && define.amd)
  define(function () {
    return zonal;
  });
if (typeof module === "object") module.exports = zonal;
if (typeof window === "object") window.zonal = zonal;
if (typeof self === "object") self.zonal = zonal;
