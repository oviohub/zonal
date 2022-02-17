const area = require("@turf/area").default;
const clone = require("@turf/clone").default;
const difference = require("@turf/difference");
const intersect = require("@turf/intersect").default;
const booleanPointInPolygon = require("@turf/boolean-point-in-polygon").default;
const { featureEach, geomEach } = require("@turf/meta");

function getClassGeometryType (geom) {
  switch (geom.type) {
    case "Polygon":
    case "MultiPolygon":
      return "Polygon";
    case "Point":
    case "MultiPoint":
      return "Point"
  }
}

function getKey ({ feature, index, geometry, props }) {
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

// assumptions
// - zones is a GeoJSON with polygons
// - classes are either all polygons/multi-polygons or all points (not mix of polygons and points)
function calculate ({
  zones,
  zone_properties,
  classes,
  class_properties,
  class_geometry_type,
  include_zero_count = false,
  include_zero_area = false
}) {
  if (!(Array.isArray(zone_properties) && zone_properties.length > 0)) {
    console.warn("[zonal] you didn't pass in zone_properties, so defaulting to the zonal feature index number");
  }

  if (!(Array.isArray(class_properties) && class_properties.length > 0)) {
    console.warn("[zonal] you didn't pass in class_properties, so defaulting to the class feature index number");
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
          if (!class_geometry_type) class_geometry_type = getClassGeometryType(class_geometry);

          // unexpected class geometry change, like a point within a collection of polygons
          if (getClassGeometryType(class_geometry) !== class_geometry_type) {
            console.warn("[zonal] we encountered an unexpected class geometry, so we're skipping it");
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
  
                // // cut feature area out of zone
                // console.log("diff area (before): ", remaining_zone_geometry ? area(remaining_zone_geometry) : 0);
                // // diff = difference(diff, new_feature);
                // remaining_zone_geometry = difference(remaining_zone_geometry, new_feature)
                // console.log("diff area (after): ", remaining_zone_geometry ? area(remaining_zone_geometry) : 0);
              });
            }
          }
        });

        // if (class_geometry_type === "Polygon") {
        //   // if (remaining_zone_geometry) 
        //   // const unclassed = intersect(zone_geometry, diff);

        //   const unclassed_id = JSON.stringify([zone_id, null]);

        //   // make sure unclasses appears in stats
        //   if (!(unclassed_id in stats)) stats[unclassed_id] = { area: 0 };

        //   if (unclassed) {
        //     geomEach(unclassed, unclassed_geom => {
        //       const diff_area = Math.round(area(unclassed_geom));

        //       stats[diff_id].area += diff_area;

        //       // // console.log({zone_id});
        //       const new_diff_feature = {
        //         type: "Feature",
        //         properties: {
        //           zone_id,
        //           class_id: null // null for parts of zone not intersecting a class
        //         },
        //         geometry: unclassed_geom
        //       };
        //       collection.push(new_diff_feature);
        //     });
        //   }
        // }
      });
    });
  });

  // calculate percentages
  for (let combo_id in stats) {
    const combo_stats = stats[combo_id];
    const [zone_id, class_id] = JSON.parse(combo_id);
    if ("area" in combo_stats) {
      // console.log("calculating percentage:", [combo_stats.area, zone_to_area[zone_id]]);
      combo_stats.percentage = combo_stats.area / zone_to_area[zone_id];
    }
  }

  // console.log("stats:", stats);

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
      const key = Array.isArray(class_properties) ? class_properties[i] : "index";
      row["class:" + key] = it;
    });
    for (let stat_name in combo_stats) {
      row["stat:" + stat_name] = combo_stats[stat_name]
    }
    table.push(row);
  }

  if (!include_zero_count) {
    table = table.filter(row => row["stat:count"] !== 0);
  }

  if (!include_zero_area) {
    table = table.filter(row => row["stat:area"] !== 0);
  }

  // console.dir(table, {'maxArrayLength': 5});

  return { table };
}

const zonal = { calculate };

if (typeof define === "function" && define.amd)
  define(function () {
    return zonal;
  });
if (typeof module === "object") module.exports = zonal;
if (typeof window === "object") window.zonal = zonal;
if (typeof self === "object") self.zonal = zonal;
