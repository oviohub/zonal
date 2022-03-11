const fs = require("fs");
const papaparse = require("papaparse");
const test = require("flug");

const { calculate } = require("./zonal.js");

const loadJSON = fp => JSON.parse(fs.readFileSync(fp, "utf-8"));

// test buffers file created by running the following
// require("fs").writeFileSync("earthquake_buffers.geojson", JSON.stringify(require("@turf/buffer").default(JSON.parse(require("fs").readFileSync("./wld_nhrpub_adameqepic14days_wfp.geojson", "utf-8")), 100)));
const earthquake_bufers = loadJSON("./data/earthquake_buffers.geojson");

const indonesia_admin_boundaries = loadJSON("./data/admin_idn.json");

const mmr_admin1_boundaries = loadJSON("./data/mmr_admin1_boundaries.json");
const nam_admin2 = loadJSON("./data/nam_admin2.json");
const wind_buffers = loadJSON(
  "./data/wld_nhr_adamtsbufferscurrent_wfp.geojson"
);
const louisiana_parishes = loadJSON("./data/louisiana_parishes.geojson");
const cone = loadJSON("./data/ida.geojson");
const caddo = loadJSON("./data/louisiana_parish_caddo.geojson");
const concordia = loadJSON("./data/louisiana_parish_concordia.geojson");
const vernon = loadJSON("./data/louisiana_parish_vernon.geojson");

// generated from
// https://geonode.wfp.org/geoserver/wfs?SERVICE=WFS&request=GetFeature&typeNames=mmr_gdacs_buffers&outputFormat=application%2Fjson
const tropical_storm_wind_buffers = loadJSON(
  "./data/mmr_gdacs_buffers.geojson"
);

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

test("earthquake buffers", ({ eq }) => {
  const results = calculate({
    debug_level: 2,
    zones: indonesia_admin_boundaries,
    zone_properties: ["A2NAME"],
    classes: earthquake_bufers,
    class_properties: ["mag"],
    preserve_features: true
  });
  const jayapura_rows = results.table.filter(
    row => row["zone:A2NAME"] === "JAYAPURA"
  );

  // there are 2 buffers close to each other
  // with 5 mag and 5.5 mag
  eq(jayapura_rows, [
    {
      "zone:A2NAME": "JAYAPURA",
      "class:mag": 5.5,
      "stat:area": 10108102039,
      "stat:percentage": 0.6996874816842877
    },
    {
      "zone:A2NAME": "JAYAPURA",
      "class:mag": 5,
      "stat:area": 9000877103,
      "stat:percentage": 0.623044861325013
    },
    {
      "zone:A2NAME": "JAYAPURA",
      "class:mag": null,
      "stat:area": 4338493485,
      "stat:percentage": 0.3003125185233737
    }
  ]);

  const jayapura_props = results.geojson.features.find(
    f => f.properties["A2NAME"] === "JAYAPURA"
  ).properties;
  eq(jayapura_props["zonal:stat:minority"], 5);
  eq(jayapura_props["zonal:stat:majority"], 5.5);
  eq(jayapura_props, {
    A1NAME: "PAPUA",
    A1CODE: 94,
    NSO_CODE: 9403,
    A2NAME: "JAYAPURA",
    TYPE: "Kabupaten",
    A2TEXT: "9403",
    Hectares: 1439000,
    "zonal:zone_id": ["JAYAPURA"],
    "zonal:stat:area": 14446595521,
    "zonal:stat:minority": 5,
    "zonal:stat:majority": 5.5,
    "zonal:stat:percentage": 0.6996874814766263,
    "zonal:stat:sum": 10108102036,
    "zonal:stat:classes": {
      5: { area: 9000877103, percentage: 0.623044861325013 },
      5.5: { area: 10108102039, percentage: 0.6996874816842877 },
      null: { area: 4338493485, percentage: 0.3003125185233737 }
    }
  });
});

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
    OBJECTID: 385,
    ParishName: "Acadia",
    ParishNumber: "01",
    DMV_ParishCode: "ACD",
    DesignatedCulturalArea: "Acadiana",
    TourismRegionCode: 3,
    TourismRegionName: "Cajun Country",
    ParishSeatName: "Crowley",
    DOTD_DistrictNumber: "03",
    DOTD_DistrictName: "District 03",
    created_user: null,
    created_date: null,
    created_date_UTCOffset: null,
    last_edited_user: "CRNH0007",
    last_edited_date: 1486841361000,
    last_edited_date_UTCOffset: "-06:00",
    service_last_updated: 1558289999000,
    service_last_updated_UTCOffset: "-05:00",
    GlobalID: "{7DBC1C81-D0D8-45EB-9A72-4CFCA3E7A246}",
    ParishFIPS: "001",
    "zonal:zone_id": ["Acadia"],
    "zonal:stat:area": 1708349991,
    "zonal:stat:minority": "60 km/h",
    "zonal:stat:majority": "60 km/h",
    "zonal:stat:percentage": 1,
    "zonal:stat:sum": 1708349991,
    "zonal:stat:classes": {
      "60 km/h": { area: 1708349991, percentage: 1 },
      null: { area: 0, percentage: 0 }
    }
  });
});

test("internal difference calls don't throw errors", ({ eq }) => {
  calculate({
    zones: mmr_admin1_boundaries,
    zone_properties: ["ST"],
    classes: tropical_storm_wind_buffers,
    preserve_features: true
  });
});
