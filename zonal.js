const area = require("@turf/area").default;
const clone = require("@turf/clone").default;
const difference = require("@turf/difference");
const intersect = require("@turf/intersect").default;
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

function getKey({ feature, index, geometry, props }) {
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
  preserve_features = false,
  class_properties_delimiter = ","
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
    throw new Error(
      "[zonal] zone_properties is a string.  it should be an array."
    );
  }
  if (typeof class_properties === "string") {
    throw new Error(
      "[zonal] class_properties is a string.  it should be an array."
    );
  }

  if ([undefined, null].includes(zone_properties)) {
    console.warn(
      "[zonal] you didn't pass in zone_properties, so defaulting to the zonal feature index number"
    );
  }

  if ([undefined, null].includes(class_properties)) {
    console.warn(
      "[zonal] you didn't pass in class_properties, so defaulting to the class feature index number"
    );
  }

  // collection of features with polygon geometries
  // this will store the map representation of the results
  const collection = [];

  // stats keyed by the unique zone+class combo id
  // e.g. { '["AK","Hot"]': 10, '["AK","Cold"]': 342 }
  // e.g. { [combo_id]: { area: <Number> }}
  const stats = {};

  // { [zone_id]: <total_area_of_zone_in_square_meters> }
  const zone_to_area = {};

  // zones must be one or more features with polygon geometries
  // like administrative districts
  featureEach(zones, (zone_feature, zone_feature_index) => {
    geomEach(zone_feature, (zone_geometry, geometry_index) => {
      // sometimes the same zone could be split up amonst multiple features
      // for example, you could have a country with multiple islands
      const zone_id = getKey({
        feature: zone_feature,
        geometry: zone_geometry,
        props: zone_properties,
        index: zone_feature_index
      });

      if (preserve_features) {
        if (!("properties" in zone_feature)) zone_feature.properties = {};
        zone_feature.properties["zonal:zone_id"] = zone_id;
      }

      // track the total area of the zone across all its features
      if (!(zone_id in zone_to_area)) zone_to_area[zone_id] = 0;
      zone_to_area[zone_id] += Math.round(area(zone_geometry));

      // this is the remaining polygonal area of the zone
      // after you have subtracted the overlap with classes
      // it will be used to compute the area without a class
      // for example, if you have wind speed polygons
      // you might want to know how much area is unaffected
      let remaining_zone_geometry = clone(zone_geometry);

      // for vector classes
      // after getting zone, get all intersecting classes
      featureEach(classes, (class_feature, class_feature_index) => {
        geomEach(class_feature, (class_geometry, class_geometry_index) => {
          const class_id = getKey({
            feature: class_feature,
            geometry: class_geometry,
            props: class_properties,
            index: class_feature_index
          });

          // unique identifier for the zone + class combo
          // there will be a row in the table for each zone + class combo
          const combo_id = JSON.stringify([zone_id, class_id]);

          // is the class type points, lines or polygons?
          if (!class_geometry_type)
            class_geometry_type = getClassGeometryType(class_geometry);

          // unexpected class geometry change, like a point within a collection of polygons
          if (getClassGeometryType(class_geometry) !== class_geometry_type) {
            console.warn(
              "[zonal] we encountered an unexpected class geometry, so we're skipping it"
            );
            return;
          }

          if (class_geometry_type === "Point") {
            // initialize stats for the combo
            if (!(combo_id in stats)) {
              stats[combo_id] = {
                count: 0
              };
            }

            const xy = class_geometry.coordinates;
            const inside = booleanPointInPolygon(xy, zone_geometry);
            if (inside) {
              any_contained = true;

              // increase number of times the combo is found
              stats[combo_id].count++;
            }
          } else if (class_geometry_type === "Polygon") {
            const intersection = intersect(zone_geometry, class_geometry);
            if (intersection) {
              // require("fs").writeFileSync("intersection.geojson", JSON.stringify(intersection), "utf-8");

              // just in case intersection is a multi-polygon
              geomEach(intersection, polygon => {
                // add to result table
                if (!(combo_id in stats)) stats[combo_id] = { area: 0 };

                // rounding because area function, because TurfJS area calculation
                // uses floating-point arithmetic and isn't super precise
                stats[combo_id].area += Math.round(area(polygon));

                const new_feature = {
                  type: "Feature",
                  properties: {
                    zone_id,
                    class_id
                  },
                  geometry: polygon
                };

                // add to map-based result
                collection.push(new_feature);

                if (remaining_zone_geometry) {
                  remaining_zone_geometry = difference(
                    remaining_zone_geometry,
                    new_feature
                  );
                }
              });
            }
          }
        });
      });

      // after we've gone through all the classes
      // see what's left and save the area of the part of the zone
      // that aren't overlapped by a class
      if (class_geometry_type === "Polygon") {
        const zone_without_class_id = JSON.stringify([zone_id, null]);

        if (!(zone_without_class_id in stats))
          stats[zone_without_class_id] = { area: 0 };

        if (remaining_zone_geometry) {
          geomEach(remaining_zone_geometry, remaining_zone_polygon => {
            const diff_area = Math.round(area(remaining_zone_polygon));

            stats[zone_without_class_id].area += diff_area;

            const new_feature = {
              type: "Feature",
              properties: {
                zone_id,
                class_id: null // null for parts of zone not intersecting a class
              },
              geometry: remaining_zone_polygon
            };
            collection.push(new_feature);
          });
        }
      }
    });
  });

  // calculate percentages
  for (let combo_id in stats) {
    const combo_stats = stats[combo_id];
    const [zone_id, class_id] = JSON.parse(combo_id);
    if ("area" in combo_stats) {
      combo_stats.percentage = combo_stats.area / zone_to_area[zone_id];
    }
  }

  // reformat stats for return
  let table = [];
  for (let combo_id in stats) {
    const combo_stats = stats[combo_id];
    const [zone_id, class_id] = JSON.parse(combo_id);

    const row = {};
    zone_id.map((it, i) => {
      const key = Array.isArray(zone_properties) ? zone_properties[i] : "index";
      row["zone:" + key] = it;
    });
    (class_id || [null]).map((it, i) => {
      const key = Array.isArray(class_properties)
        ? class_properties[i]
        : "index";
      row["class:" + key] = it;
    });
    for (let stat_name in combo_stats) {
      row["stat:" + stat_name] = combo_stats[stat_name];
    }
    table.push(row);
  }

  if (!include_zero_count) {
    table = table.filter(row => row["stat:count"] !== 0);
  }

  if (!include_zero_area) {
    table = table.filter(row => row["stat:area"] !== 0);
  }

  const results = { table };

  if (preserve_features) {
    results.geojson = zones;

    // group stats by zone
    const zone_id_to_stats = {};
    for (let combo_id in stats) {
      const combo_stats = stats[combo_id];
      const [zone_id, class_id] = JSON.parse(combo_id);
      if (!(zone_id in zone_id_to_stats)) zone_id_to_stats[zone_id] = {};
      zone_id_to_stats[zone_id][JSON.stringify(class_id)] = combo_stats;
    }

    // aggregate statistics
    const agg_stats = {};
    for (let zone_id in zone_id_to_stats) {
      const zone_stats = {};
      const pairs = entries(zone_id_to_stats[zone_id]);
      const sorted_by_area = pairs
        .filter(it => !["null", '["null"]'].includes(it[0]))
        .sort((a, b) => a[1].area - b[1].area);
      if (sorted_by_area.length > 0) {
        zone_stats.minority = unarray(JSON.parse(sorted_by_area[0][0]));
        zone_stats.majority = unarray(
          JSON.parse(sorted_by_area[sorted_by_area.length - 1][0])
        );
      }
      const zone_area = zone_to_area[zone_id];
      const unclassed_percentage = pairs.find(pair => pair[0] === "null")[1]
        .percentage;
      zone_stats.percentage = 1 - unclassed_percentage;
      zone_stats.sum = Math.round(zone_stats.percentage * zone_area);
      agg_stats[zone_id] = zone_stats;
    }

    featureEach(zones, (zone_feature, zone_feature_index) => {
      const props = zone_feature.properties;
      const zone_id = props["zonal:zone_id"];
      props["zonal:stat:area"] = zone_to_area[zone_id];
      entries(agg_stats[zone_id]).forEach(([stat_name, stat_value]) => {
        props["zonal:stat:" + stat_name] = stat_value;
      });
      props["zonal:stat:classes"] = entries(zone_id_to_stats[zone_id]).reduce(
        (acc, [key, stats]) => {
          key = JSON.parse(key);
          key = Array.isArray(key) ? key.join(class_properties_delimiter) : key;
          acc[key] = stats;
          return acc;
        },
        {}
      );
    });
    results.geojson = zones;
  } else {
    results.geojson = { type: "FeatureCollection", features: collection };
  }

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
