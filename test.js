const fs = require("fs");
const papaparse = require("papaparse");
const test = require("flug");

const { calculate } = require("./zonal.js");

const loadJSON = fp => JSON.parse(fs.readFileSync(fp, "utf-8"));

const nam_admin2 = loadJSON("./data/nam_admin2.json");
const wind_buffers = loadJSON(
  "./data/wld_nhr_adamtsbufferscurrent_wfp.geojson"
);
const louisiana_parishes = loadJSON("./data/louisiana_parishes.geojson");
const cone = loadJSON("./data/ida.geojson");
const caddo = loadJSON("./data/louisiana_parish_caddo.geojson");
const concordia = loadJSON("./data/louisiana_parish_concordia.geojson");
const vernon = loadJSON("./data/louisiana_parish_vernon.geojson");

const windhoek = {
  type: "Feature",
  properties: {
    name: "Event"
  },
  geometry: {
    type: "Point",
    // [longitude, latitude] for Windhoek the capital of Namibia
    coordinates: [17.083611, -22.57]
  }
};

function saveAsCSV(filepath, rows) {
  fs.writeFileSync(filepath, papaparse.unparse(rows, { quotes: true }));
}

test("polygon zones and point class", ({ eq }) => {
  const result = calculate({
    zones: nam_admin2,
    classes: windhoek
  });
  eq(result.table, [{ "zone:index": 104, "class:index": 0, "stat:count": 1 }]);
});

test("polygon zones, zone properties, point class", ({ eq }) => {
  const result = calculate({
    zones: nam_admin2,
    zone_properties: ["ADM2_EN"],
    classes: windhoek
  });
  eq(result.table, [
    { "zone:ADM2_EN": "Windhoek East", "class:index": 0, "stat:count": 1 }
  ]);
});

test("polygon zones, zone properties, class properties, point class", ({
  eq
}) => {
  const result = calculate({
    zones: nam_admin2,
    zone_properties: ["ADM2_EN"],
    classes: windhoek,
    class_properties: ["name"]
  });
  eq(result.table, [
    { "zone:ADM2_EN": "Windhoek East", "class:name": "Event", "stat:count": 1 }
  ]);
});

test("1 polygon zone completely inside 1 class", ({ eq }) => {
  const result = calculate({ zones: vernon, classes: cone });
  eq(result.table, [
    {
      "zone:index": 0,
      "class:index": 0,
      "stat:area": 3479698791,
      "stat:percentage": 1
    }
  ]);
});

test("1 polygon zone completely inside 1 class (with properties)", ({ eq }) => {
  const result = calculate({
    zones: vernon,
    zone_properties: ["ParishName"],
    classes: cone,
    class_properties: ["wind_speed"]
  });
  eq(result.table, [
    {
      "zone:ParishName": "Vernon",
      "class:wind_speed": "60 km/h",
      "stat:area": 3479698791,
      "stat:percentage": 1
    }
  ]);
});

test("1 polygon zone partially intersects ", ({ eq }) => {
  const result = calculate({
    zones: caddo,
    zone_properties: ["ParishName"],
    classes: cone,
    class_properties: ["wind_speed"],
    include_zero_area: false
  });

  eq(result.table, [
    {
      "zone:ParishName": "Caddo",
      "class:wind_speed": "60 km/h",
      "stat:area": 1425010850,
      "stat:percentage": 0.5836591002138494
    },
    {
      "zone:ParishName": "Caddo",
      "class:wind_speed": null,
      "stat:area": 1016501412,
      "stat:percentage": 0.41634089978615063
    }
  ]);
});

test("1 polygon zone partially intersects (include_zero_area) ", ({ eq }) => {
  const result = calculate({
    zones: caddo,
    zone_properties: ["ParishName"],
    classes: cone,
    class_properties: ["wind_speed"],
    include_zero_area: true
  });
  eq(result.table, [
    {
      "zone:ParishName": "Caddo",
      "class:wind_speed": "60 km/h",
      "stat:area": 1425010850,
      "stat:percentage": 0.5836591002138494
    },
    {
      "zone:ParishName": "Caddo",
      "class:wind_speed": null,
      "stat:area": 1016501412,
      "stat:percentage": 0.41634089978615063
    }
  ]);
});

// wind_buffers has intersecting polygons
// so sometimes percentages don't add up to 1 if overlapping classes
// percentage is the stat:area / the total area of the zone
test("1 polygon zone partially intersects multiple overlapping classes", ({
  eq
}) => {
  const result = calculate({
    zones: concordia,
    zone_properties: ["ParishName"],
    classes: wind_buffers,
    class_properties: ["wind_speed"],
    include_zero_area: true
  });
  eq(result.table, [
    {
      "zone:ParishName": "Concordia",
      "class:wind_speed": "60 km/h",
      "stat:area": 1947712532,
      "stat:percentage": 1
    },
    {
      "zone:ParishName": "Concordia",
      "class:wind_speed": "90 km/h",
      "stat:area": 32134688,
      "stat:percentage": 0.01649868113083538
    },
    {
      "zone:ParishName": "Concordia",
      "class:wind_speed": null,
      "stat:area": 0,
      "stat:percentage": 0
    }
  ]);
});

test("admin boundaries with wind cones", ({ eq }) => {
  const results = calculate({
    zones: louisiana_parishes,
    zone_properties: ["ParishName"],
    classes: wind_buffers,
    class_properties: ["wind_speed"],
    preserve_features: true
  });
  const feature = results.geojson.features[0];
  eq(feature.properties, {
    "zonal:zone_id": ["Acadia"],
    "zonal:stat:area": 1708349991,
    "zonal:stat:minority": "60 km/h",
    "zonal:stat:majority": "60 km/h",
    "zonal:stat:percentage": 1,
    "zonal:stat:sum": 1708349991,
    "zonal:stat:classes": {
      "60 km/h": {
        area: 1708349991,
        percentage: 1
      },
      null: {
        area: 0,
        percentage: 0
      }
    }
  });
});
