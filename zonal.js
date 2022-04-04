"use strict";

function _typeof(obj) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (obj) { return typeof obj; } : function (obj) { return obj && "function" == typeof Symbol && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }, _typeof(obj); }

function _slicedToArray(arr, i) { return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _unsupportedIterableToArray(arr, i) || _nonIterableRest(); }

function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }

function _unsupportedIterableToArray(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen); }

function _arrayLikeToArray(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) { arr2[i] = arr[i]; } return arr2; }

function _iterableToArrayLimit(arr, i) { var _i = arr == null ? null : typeof Symbol !== "undefined" && arr[Symbol.iterator] || arr["@@iterator"]; if (_i == null) return; var _arr = []; var _n = true; var _d = false; var _s, _e; try { for (_i = _i.call(arr); !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"] != null) _i["return"](); } finally { if (_d) throw _e; } } return _arr; }

function _arrayWithHoles(arr) { if (Array.isArray(arr)) return arr; }

var calculateArea = require("@turf/area")["default"];

var clone = require("@turf/clone")["default"];

var difference = require("@turf/difference")["default"];

var booleanPointInPolygon = require("@turf/boolean-point-in-polygon")["default"];

var _require = require("@turf/meta"),
    featureEach = _require.featureEach,
    geomEach = _require.geomEach; // replacement for Object.entries in case Object.entries
// isn't defined


function entries(object) {
  var results = [];

  for (var key in object) {
    results.push([key, object[key]]);
  }

  return results;
}

function values(object) {
  var results = [];

  for (var key in object) {
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

function getArrayKey(_ref) {
  var feature = _ref.feature,
      index = _ref.index,
      geometry = _ref.geometry,
      props = _ref.props;

  if (props) {
    var key = [];
    props.forEach(function (prop) {
      if (typeof prop === "string") {
        key.push(feature.properties[prop]);
      } else if (typeof prop === "function") {
        key.push(prop({
          feature: feature,
          geometry: geometry
        }));
      }
    });
    return key;
  } else {
    return [index];
  }
}

function unarray(arr) {
  return arr.length === 1 ? arr[0] : arr;
} // assumptions
// - zones is a GeoJSON with polygons
// - classes are either all polygons/multi-polygons or all points (not mix of polygons and points)


function calculate(_ref2) {
  var zones = _ref2.zones,
      zone_properties = _ref2.zone_properties,
      classes = _ref2.classes,
      class_properties = _ref2.class_properties,
      class_geometry_type = _ref2.class_geometry_type,
      _ref2$include_zero_co = _ref2.include_zero_count,
      include_zero_count = _ref2$include_zero_co === void 0 ? false : _ref2$include_zero_co,
      _ref2$include_zero_ar = _ref2.include_zero_area,
      include_zero_area = _ref2$include_zero_ar === void 0 ? false : _ref2$include_zero_ar,
      _ref2$include_null_cl = _ref2.include_null_class_rows,
      include_null_class_rows = _ref2$include_null_cl === void 0 ? true : _ref2$include_null_cl,
      _ref2$class_propertie = _ref2.class_properties_delimiter,
      class_properties_delimiter = _ref2$class_propertie === void 0 ? "," : _ref2$class_propertie,
      _ref2$preserve_featur = _ref2.preserve_features,
      preserve_features = _ref2$preserve_featur === void 0 ? true : _ref2$preserve_featur,
      _ref2$remove_features = _ref2.remove_features_with_no_overlap,
      remove_features_with_no_overlap = _ref2$remove_features === void 0 ? false : _ref2$remove_features,
      _ref2$debug_level = _ref2.debug_level,
      debug_level = _ref2$debug_level === void 0 ? 0 : _ref2$debug_level;
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
  } // stats keyed by the unique zone+class combo id
  // e.g. { '["AK","Hot"]': 10, '["AK","Cold"]': 342 }
  // e.g. { [combo_id]: { area: <Number> }}


  var stats = {}; // { [zone_id]: <total_area_of_zone_in_square_meters> }

  var zone_to_area = {}; // { [class_id]: [<array of polygons or points>] }

  var class_to_geometries = {}; // group class geometries into dictionary objects

  featureEach(classes, function (class_feature, class_feature_index) {
    geomEach(class_feature, function (class_geometry, class_geometry_index) {
      var _class_to_geometries$;

      var class_array = getArrayKey({
        feature: class_feature,
        geometry: class_geometry,
        props: class_properties,
        index: class_feature_index
      }); // convert class id array to string

      var class_id = JSON.stringify(class_array); // is the class type points, lines or polygons?

      if (!class_geometry_type) class_geometry_type = getClassGeometryType(class_geometry); // unexpected class geometry change, like a point within a collection of polygons

      if (getClassGeometryType(class_geometry) !== class_geometry_type) {
        console.warn("[zonal] we encountered an unexpected class geometry, so we're skipping it");
        return;
      }

      (_class_to_geometries$ = class_to_geometries[class_id]) !== null && _class_to_geometries$ !== void 0 ? _class_to_geometries$ : class_to_geometries[class_id] = [];
      class_to_geometries[class_id].push(class_geometry);
    });
  }); // zones must be one or more features with polygon geometries
  // like administrative districts

  featureEach(zones, function (zone_feature, zone_feature_index) {
    geomEach(zone_feature, function (zone_geometry, geometry_index) {
      var _zone_feature$propert, _zone_to_area$zone_id;

      // sometimes the same zone could be split up amonst multiple features
      // for example, you could have a country with multiple islands
      var zone_array = getArrayKey({
        feature: zone_feature,
        geometry: zone_geometry,
        props: zone_properties,
        index: zone_feature_index
      });
      var zone_id = JSON.stringify(zone_array);
      (_zone_feature$propert = zone_feature.properties) !== null && _zone_feature$propert !== void 0 ? _zone_feature$propert : zone_feature.properties = {};
      zone_feature.properties["zonal:zone_id"] = zone_array; // track the total area of the zone across all its features

      (_zone_to_area$zone_id = zone_to_area[zone_id]) !== null && _zone_to_area$zone_id !== void 0 ? _zone_to_area$zone_id : zone_to_area[zone_id] = 0;
      var zone_geometry_area = calculateArea(zone_geometry);
      zone_to_area[zone_id] += zone_geometry_area; // this is the remaining polygonal area of the zone
      // after you have subtracted the overlap with classes
      // it will be used to compute the area without a class
      // for example, if you have wind speed polygons
      // you might want to know how much area is unaffected

      var remaining_zone_geometry_for_all_classes = zone_geometry;
      entries(class_to_geometries).forEach(function (_ref3) {
        var _ref4 = _slicedToArray(_ref3, 2),
            class_id = _ref4[0],
            class_geometries = _ref4[1];

        // unique identifier for the zone + class combo
        // there will be a row in the table for each zone + class combo
        var combo_id = JSON.stringify([zone_id, class_id]);
        var remaining_zone_geometry_for_specific_class = zone_geometry;
        class_geometries.forEach(function (class_geometry) {
          if (class_geometry_type === "Point") {
            var _stats$combo_id;

            (_stats$combo_id = stats[combo_id]) !== null && _stats$combo_id !== void 0 ? _stats$combo_id : stats[combo_id] = {
              count: 0
            };
            var xy = class_geometry.coordinates;
            var inside = booleanPointInPolygon(xy, zone_geometry);

            if (inside) {
              // increase number of times the combo is found
              stats[combo_id].count++;
            }
          } else if (class_geometry_type === "Polygon") {
            if (remaining_zone_geometry_for_all_classes) {
              remaining_zone_geometry_for_all_classes = difference(remaining_zone_geometry_for_all_classes, class_geometry);
            }

            if (remaining_zone_geometry_for_specific_class) {
              remaining_zone_geometry_for_specific_class = difference(remaining_zone_geometry_for_specific_class, class_geometry);
            }
          }
        });

        if (class_geometry_type === "Polygon") {
          var _stats$combo_id2;

          (_stats$combo_id2 = stats[combo_id]) !== null && _stats$combo_id2 !== void 0 ? _stats$combo_id2 : stats[combo_id] = {
            area: 0
          };
          var remaining_area = remaining_zone_geometry_for_specific_class ? calculateArea(remaining_zone_geometry_for_specific_class) : 0; // there's no way you can have more remaining than the actual size of the zone
          // this happens because of floating point arithmetic issues

          if (remaining_area > zone_geometry_area) remaining_area = zone_geometry_area; // area where zone geometry and class overlap

          stats[combo_id].area += Math.round(zone_geometry_area - remaining_area);
        }
      }); // after we've gone through all the classes
      // see what's left and save the area of the part of the zone
      // that aren't overlapped by a class

      if (class_geometry_type === "Polygon") {
        var _stats$zone_without_c;

        var zone_without_class_id = JSON.stringify([zone_id, null]);
        (_stats$zone_without_c = stats[zone_without_class_id]) !== null && _stats$zone_without_c !== void 0 ? _stats$zone_without_c : stats[zone_without_class_id] = {
          area: 0
        };
        stats[zone_without_class_id].area += remaining_zone_geometry_for_all_classes ? Math.round(calculateArea(remaining_zone_geometry_for_all_classes)) : 0;
      }
    });
  }); // calculate percentages

  entries(stats).forEach(function (_ref5) {
    var _ref6 = _slicedToArray(_ref5, 2),
        combo_id = _ref6[0],
        combo_stats = _ref6[1];

    var _JSON$parse = JSON.parse(combo_id),
        _JSON$parse2 = _slicedToArray(_JSON$parse, 2),
        zone_id = _JSON$parse2[0],
        class_id = _JSON$parse2[1];

    if ("area" in combo_stats) {
      combo_stats.percentage = combo_stats.area / Math.round(zone_to_area[zone_id]);
    }
  }); // reformat stats for return

  var columns = [];
  var first_pass = true;
  var rows = [];

  var _loop = function _loop(combo_id) {
    var combo_stats = stats[combo_id];

    var _JSON$parse5 = JSON.parse(combo_id),
        _JSON$parse6 = _slicedToArray(_JSON$parse5, 2),
        zone_id = _JSON$parse6[0],
        class_id = _JSON$parse6[1]; // convert zone_id from string to array


    zone_id = JSON.parse(zone_id); // convert class id from string to array

    class_id = JSON.parse(class_id);

    if (include_null_class_rows === false && class_id === null) {
      return "continue";
    }

    var row = {};
    zone_id.map(function (it, i) {
      var key = Array.isArray(zone_properties) ? zone_properties[i] : "index";
      var zone_key = "zone:" + key;
      row[zone_key] = it;
      if (first_pass) columns.push(zone_key);
    });
    (class_id || [null]).map(function (it, i) {
      var key = Array.isArray(class_properties) ? class_properties[i] : "index";
      var class_key = "class:" + key;
      row[class_key] = it;
      if (first_pass) columns.push(class_key);
    });

    for (var stat_name in combo_stats) {
      var stat_key = "stat:" + stat_name;
      row[stat_key] = combo_stats[stat_name];
      if (first_pass) columns.push(stat_key);
    }

    rows.push(row);
    first_pass = false;
  };

  for (var combo_id in stats) {
    var _ret = _loop(combo_id);

    if (_ret === "continue") continue;
  }

  if (!include_zero_count) {
    rows = rows.filter(function (row) {
      return row["stat:count"] !== 0;
    });
  }

  if (!include_zero_area) {
    rows = rows.filter(function (row) {
      return row["stat:area"] !== 0;
    });
  } // sort rows by columns from left to right


  rows.sort(function (a, b) {
    for (var c = 0; c < columns.length; c++) {
      var col = columns[c];
      var aval = a[col];
      var bval = b[col];
      if (aval === null && bval !== null) return 1;else if (aval !== null && bval === null) return -1;
      if (a[col] > b[col]) return 1;else if (a[col] < b[col]) return -1;
    }

    return 0;
  });
  var results = {
    table: {
      columns: columns,
      rows: rows
    }
  };
  results.geojson = zones; // group stats by zone

  var zone_id_to_stats = {};

  for (var _combo_id in stats) {
    var _zone_id_to_stats$zon;

    var combo_stats = stats[_combo_id];

    var _JSON$parse3 = JSON.parse(_combo_id),
        _JSON$parse4 = _slicedToArray(_JSON$parse3, 2),
        zone_id = _JSON$parse4[0],
        class_id = _JSON$parse4[1];

    (_zone_id_to_stats$zon = zone_id_to_stats[zone_id]) !== null && _zone_id_to_stats$zon !== void 0 ? _zone_id_to_stats$zon : zone_id_to_stats[zone_id] = {};
    zone_id_to_stats[zone_id][class_id] = combo_stats;
  } // aggregate statistics


  var agg_stats = {};

  for (var _zone_id in zone_id_to_stats) {
    var zone_stats = {};
    var pairs = entries(zone_id_to_stats[_zone_id]);
    var sorted_by_area = pairs.filter(function (it) {
      return !["null", '["null"]'].includes(it[0]);
    }).filter(function (it) {
      return it[1].area !== 0;
    }) // filter out zone-class combinations that don't exist
    .sort(function (a, b) {
      return a[1].area - b[1].area;
    });

    if (sorted_by_area.length > 0) {
      zone_stats.minority = unarray(JSON.parse(sorted_by_area[0][0]));
      zone_stats.majority = unarray(JSON.parse(sorted_by_area[sorted_by_area.length - 1][0]));
    }

    var zone_area = zone_to_area[_zone_id];

    if (class_geometry_type === "Polygon") {
      var unclassed_percentage = pairs.find(function (pair) {
        return pair[0] === "null";
      })[1].percentage;
      zone_stats.percentage = 1 - unclassed_percentage;
      zone_stats.sum = Math.round(zone_stats.percentage * zone_area);
      agg_stats[_zone_id] = zone_stats;
    }
  }

  if (!preserve_features) zones = clone(zones);
  var delete_these_features = [];
  featureEach(zones, function (zone_feature, zone_feature_index) {
    var props = zone_feature.properties;
    var zone_id = JSON.stringify(props["zonal:zone_id"]);
    props["zonal:stat:area"] = Math.round(zone_to_area[zone_id]);
    entries(agg_stats[zone_id]).forEach(function (_ref7) {
      var _ref8 = _slicedToArray(_ref7, 2),
          stat_name = _ref8[0],
          stat_value = _ref8[1];

      props["zonal:stat:" + stat_name] = stat_value;
    });
    props["zonal:stat:classes"] = entries(zone_id_to_stats[zone_id]).reduce(function (acc, _ref9) {
      var _ref10 = _slicedToArray(_ref9, 2),
          key = _ref10[0],
          stats = _ref10[1];

      key = JSON.parse(key);
      key = Array.isArray(key) ? key.join(class_properties_delimiter) : key;
      if (stats.area > 0) acc[key] = stats;
      return acc;
    }, {});

    if (remove_features_with_no_overlap) {
      var class_keys = Object.keys(props["zonal:stat:classes"]);

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
      zones.features = zones.features.filter(function (_, i) {
        return !delete_these_features.includes(i);
      });
    }
  }

  results.geojson = zones;
  return results;
}

var zonal = {
  calculate: calculate
};
if (typeof define === "function" && define.amd) define(function () {
  return zonal;
});
if ((typeof module === "undefined" ? "undefined" : _typeof(module)) === "object") module.exports = zonal;
if ((typeof window === "undefined" ? "undefined" : _typeof(window)) === "object") window.zonal = zonal;
if ((typeof self === "undefined" ? "undefined" : _typeof(self)) === "object") self.zonal = zonal;

